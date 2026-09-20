import { queryAIAnswerer, normalizeAnswerByQuestionType, type AIAnswererOptions, type AIQuestionPayload } from './ai';
import { acquireWebActivity, type WebActivityLease } from './web-activity';
import type { SearchInformation } from '@xuexitong-ai-helper/core/src/core/worker/search.interface';

export type ReviewAction = 'check' | 'accept' | 'reject';
export interface ReviewFeedback {
	status: 'same' | 'different' | 'applied' | 'rejected';
	message: string;
	answer?: string;
	previousAnswer?: string;
	proposalId?: string;
}
export interface ReviewTarget {
	available(): void;
	snapshot(): { question: AIQuestionPayload; answer: string };
	options(): AIAnswererOptions;
	apply(infos: SearchInformation[]): Promise<boolean>;
	commit(opts: AIAnswererOptions, question: AIQuestionPayload, infos: SearchInformation[]): Promise<void>;
	query?: typeof queryAIAnswerer;
}
const uuid = () =>
	Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('');
function canonical(answer: string, question: AIQuestionPayload) {
	return normalizeAnswerByQuestionType(
		answer,
		question.type,
		question.lineOptions,
		Array.isArray(question.options) ? question.options : question.options?.split('\n') || []
	).trim();
}
/** Proposals never change a page or enter the answer cache until explicitly accepted. */
export class AnswerReview {
	busy = false;
	private proposal?: {
		id: string;
		before: { question: AIQuestionPayload; answer: string };
		answer: string;
		infos: SearchInformation[];
		opts: AIAnswererOptions;
	};
	constructor(private target: ReviewTarget) {}
	private snapshot() {
		this.target.available();
		const state = this.target.snapshot();
		state.answer = canonical(state.answer, state.question);
		if (!state.answer) throw new Error('本题尚未完整作答，无法检验。');
		return state;
	}
	private unchanged(before: { question: AIQuestionPayload; answer: string }) {
		const now = this.snapshot();
		if (JSON.stringify(now) !== JSON.stringify(before))
			throw new Error('题目或当前答案已变化，请重新检验，未采用旧建议。');
	}
	async run(action: ReviewAction, proposalId?: string): Promise<ReviewFeedback> {
		if (this.busy) throw new Error('本题正在检验或写入，请勿重复操作。');
		this.busy = true;
		let lease: WebActivityLease | undefined;
		try {
			if (action === 'reject') {
				if (!this.proposal || this.proposal.id !== proposalId) throw new Error('建议已失效，请重新检验。');
				this.proposal = undefined;
				return { status: 'rejected', message: '已放弃新答案，保持当前答案。' };
			}
			const opts = action === 'accept' ? this.proposal?.opts : this.target.options();
			if (!opts) throw new Error('建议已失效，请重新检验。');
			this.target.available();
			if (opts.aiProvider === 'deepseek-web') lease = await acquireWebActivity('search');
			if (action === 'check') {
				this.proposal = undefined;
				const before = this.snapshot();
				// Deliberately bypass QuestionAnswerCache: a check must be a fresh AI request.
				const infos = await (this.target.query || queryAIAnswerer)(
					{ ...opts, webActivityId: lease?.id },
					{ ...before.question, reviewAnswer: before.answer }
				);
				this.unchanged(before);
				const info = infos.find(
					(info) => !info.error && !(info.data as any)?.skipped && info.results.some((result) => result.answer?.trim())
				);
				const result = info?.results.find((result) => result.answer?.trim());
				if (!result)
					throw new Error(infos.find((info) => info.error)?.error || 'AI 未返回可用的检验答案，保持当前答案。');
				const answer = canonical(result.answer, before.question);
				if (!answer) throw new Error('检验答案格式无效，保持当前答案。');
				result.answer = answer;
				if (answer === before.answer) return { status: 'same', message: '检验成功，保持当前答案', answer };
				const id = uuid();
				this.proposal = { id, before, answer, infos: [info!], opts: { ...opts } };
				return {
					status: 'different',
					message: 'AI 给出了不同答案，请确认是否采用。',
					previousAnswer: before.answer,
					answer,
					proposalId: id
				};
			}
			const proposal = this.proposal;
			if (!proposal || proposal.id !== proposalId) throw new Error('建议已失效，请重新检验。');
			this.unchanged(proposal.before);
			lease?.assertActive();
			const applied = await this.target.apply(proposal.infos);
			const after = this.snapshot();
			if (
				!applied ||
				JSON.stringify(after.question) !== JSON.stringify(proposal.before.question) ||
				after.answer !== proposal.answer
			)
				throw new Error('未能确认网页已完整写入新答案，缓存未更新，请检查本题。');
			await this.target.commit(proposal.opts, proposal.before.question, proposal.infos);
			this.proposal = undefined;
			return { status: 'applied', message: '已采用新答案，网页、答题结果与缓存已同步。', answer: proposal.answer };
		} finally {
			lease?.release();
			this.busy = false;
		}
	}
}

const targets = new Map<string, AnswerReview>();
const rootIds = new WeakMap<HTMLElement, string>();
const views = new Map<string, { busy?: boolean; feedback?: ReviewFeedback; error?: string }>();
const PREFIX = 'xth.review.request.v1.';
const FRAME = uuid();
let listening = false;
interface Mailbox {
	target: string;
	action: ReviewAction;
	proposalId?: string;
	createdAt: number;
	status: 'queued' | 'processing' | 'done' | 'error';
	response?: ReviewFeedback;
	error?: string;
}
export function assertQuestionReviewIdle() {
	if ([...targets.values()].some((target) => target.busy)) throw new Error('正在检验或采用答案，请等待完成后再答题。');
}
export function registerAnswerReview(root: HTMLElement, target: ReviewTarget): string {
	const previous = rootIds.get(root);
	if (previous) targets.delete(previous);
	const id = FRAME + '.' + uuid();
	rootIds.set(root, id);
	targets.set(id, new AnswerReview(target));
	if (!listening && typeof GM_listValues === 'function') {
		listening = true;
		const timer = setInterval(() => {
			for (const key of GM_listValues().filter((key) => key.startsWith(PREFIX + FRAME + '.'))) {
				const message = GM_getValue<Mailbox | undefined>(key, undefined);
				if (!message || Date.now() - message.createdAt > 12 * 60 * 1000) {
					GM_deleteValue(key);
					continue;
				}
				if (message.status !== 'queued') continue;
				GM_setValue(key, { ...message, status: 'processing' });
				void (async () => {
					try {
						const target = targets.get(message.target);
						if (!target) throw new Error('原题页面已变化，请重新读取题目后检验。');
						const response = await target.run(message.action, message.proposalId);
						if (GM_getValue(key, undefined)) GM_setValue(key, { ...message, status: 'done', response });
					} catch (error) {
						if (GM_getValue(key, undefined))
							GM_setValue(key, {
								...message,
								status: 'error',
								error: error instanceof Error ? error.message : String(error)
							});
					}
				})();
			}
		}, 250);
		window.addEventListener(
			'pagehide',
			() => {
				clearInterval(timer);
				targets.clear();
			},
			{ once: true }
		);
	}
	return id;
}
export const getAnswerReviewView = (id: string) => views.get(id);
/** Route actions to the frame that owns the question instead of trying to write its parent page. */
export async function requestAnswerReview(id: string, action: ReviewAction, proposalId?: string) {
	if (views.get(id)?.busy) return;
	views.set(id, { ...views.get(id), busy: true, error: undefined });
	let key: string | undefined;
	try {
		let response: ReviewFeedback;
		const local = targets.get(id);
		if (local) response = await local.run(action, proposalId);
		else {
			key = PREFIX + id.split('.')[0] + '.' + uuid();
			const message: Mailbox = { target: id, action, proposalId, createdAt: Date.now(), status: 'queued' };
			GM_setValue(key, message);
			for (;;) {
				const current = GM_getValue<Mailbox | undefined>(key, undefined);
				if (!current || current.status === 'error')
					throw new Error(current?.error || '原题页面已离开，请重新打开后检验。');
				if (current.status === 'done') {
					response = current.response!;
					break;
				}
				if (
					(current.status === 'queued' && Date.now() - message.createdAt > 8000) ||
					Date.now() - message.createdAt > 11 * 60 * 1000
				)
					throw new Error('原题页面未响应，请保持题目页打开并重试。');
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
		}
		views.set(id, { feedback: response });
		return response;
	} catch (error) {
		views.set(id, { error: error instanceof Error ? error.message : String(error) });
	} finally {
		const view = views.get(id);
		if (view) view.busy = false;
		if (key) GM_deleteValue(key);
	}
}
