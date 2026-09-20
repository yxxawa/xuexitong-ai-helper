import { getWebBridgeState } from './web-ai';
import md5 from 'md5';
import type { SearchInformation } from '@xuexitong-ai-helper/core/src/core/worker/search.interface';
import type { AIAnswererOptions, AIQuestionPayload } from './ai';

export interface QuestionCache {
	version: 2;
	key: string;
	title: string;
	answer: string;
	answerParts?: string[];
	from: string;
	homepage: string;
	solution: string;
	createdAt: number;
}
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const normalize = (text: unknown) =>
	String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim();
export function questionCacheKey(opts: AIAnswererOptions, question: AIQuestionPayload): string {
	const options = Array.isArray(question.options) ? question.options : (question.options || '').split('\n');
	return md5(
		JSON.stringify({
			version: 2,
			provider: opts.aiProvider || 'api',
			webSession: opts.aiProvider === 'deepseek-web' ? getWebBridgeState()?.id : undefined,
			credential: opts.aiProvider === 'deepseek-web' ? 'web-session' : md5(opts.aiApiKey || ''),
			title: normalize(question.title),
			type: question.type || 'unknown',
			options: options.map(normalize),
			images: question.imageUrls || [],
			hasImage: Boolean(question.hasImage),
			unresolvedImageCount: question.unresolvedImageCount || 0,
			lineOptions: question.lineOptions || [],
			endpoint:
				opts.aiProvider === 'deepseek-web' ? 'https://chat.deepseek.com' : opts.aiApiUrl.trim().replace(/\/+$/, ''),
			model: opts.aiProvider === 'deepseek-web' ? 'web' : opts.aiModel.trim(),
			promptVersion: 'fixed-json-v5-unlimited-output',
			temperature: opts.aiTemperature,
			solution: Boolean(opts.aiShowSolution),
			format: opts.aiUseResponseFormat,
			vision: opts.aiVisionMode || 'auto'
		})
	);
}

export class QuestionAnswerCache {
	private generation = 0;
	private pending = new Map<string, Promise<SearchInformation[]>>();
	constructor(private store: { get(): unknown; set(entries: QuestionCache[]): void; enabled(): boolean }) {}
	list(): QuestionCache[] {
		const entries = this.store.get();
		return Array.isArray(entries)
			? entries
					.filter(
						(entry): entry is QuestionCache =>
							entry?.version === 2 &&
							typeof entry.key === 'string' &&
							typeof entry.title === 'string' &&
							typeof entry.answer === 'string' &&
							Boolean(entry.answer.trim()) &&
							Number.isFinite(entry.createdAt) &&
							Date.now() - entry.createdAt < MAX_AGE &&
							entry.createdAt <= Date.now()
					)
					.slice(0, 200)
			: [];
	}
	clear() {
		this.generation++;
		// Keep in-flight deduplication: clearing stored answers must not duplicate a live request.
		this.store.set([]);
	}
	/** Explicitly accepted corrections replace old entries and cannot be overwritten by older in-flight results. */
	replaceAnswer(
		opts: AIAnswererOptions,
		question: AIQuestionPayload,
		infos: SearchInformation[],
		previousKeys: string[] = []
	) {
		const info = infos.find(
			(info) => !info.error && !(info.data as any)?.skipped && info.results.some((result) => result.answer?.trim())
		);
		const result = info?.results.find((result) => result.answer?.trim());
		if (!info || !result) throw new Error('检验结果无有效答案，缓存未更新。');
		this.generation++;
		const key = questionCacheKey(opts, question),
			keys = new Set([key, ...previousKeys]);
		const entries = this.list();
		const corrected = {
			answer: result.answer,
			answerParts: safeAnswerParts(result.extra_data, result.answer),
			solution: String((result.extra_data as any)?.solution || ''),
			from: info.name,
			homepage: info.homepage || '',
			createdAt: Date.now()
		};
		// Even if cache is disabled now, correct an existing saved entry so later re-enabling cannot revive the old answer.
		const updated = entries.map((entry) => (keys.has(entry.key) ? { ...entry, ...corrected } : entry));
		this.store.set(
			(this.store.enabled()
				? [
						{ version: 2 as const, key, title: question.title, ...corrected },
						...updated.filter((entry) => entry.key !== key)
				  ]
				: updated
			).slice(0, 200)
		);
	}

	async search(
		opts: AIAnswererOptions,
		question: AIQuestionPayload,
		query: () => Promise<SearchInformation[]>
	): Promise<SearchInformation[]> {
		const key = questionCacheKey(opts, question);
		const hit = this.store.enabled() ? this.list().find((entry) => entry.key === key) : undefined;
		if (hit) {
			this.store.set([hit, ...this.list().filter((entry) => entry.key !== key)]);
			return [
				{
					name: 'AI【答案缓存】',
					homepage: hit.homepage,
					data: { cache_hit: true },
					results: [
						{
							question: question.title,
							answer: hit.answer,
							extra_data: {
								ai: true,
								cache_hit: true,
								parsed_answer: hit.answer,
								answer_parts: hit.answerParts,
								solution: hit.solution,
								token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
							}
						}
					]
				}
			];
		}
		const existing = this.pending.get(key);
		if (existing)
			return existing.then((infos) =>
				infos.map((info) => ({
					...info,
					data: { ...(info.data as any), cache_hit: true, deduplicated: true },
					results: info.results.map((result) => ({
						...result,
						extra_data: {
							...result.extra_data,
							cache_hit: true,
							token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
						}
					}))
				}))
			);
		const generation = this.generation;
		const task = Promise.resolve()
			.then(query)
			.then((infos) => {
				const info = infos.find(
					(item) => !item.error && !(item.data as any)?.skipped && item.results.some((result) => result.answer?.trim())
				);
				const result = info?.results.find((item) => item.answer?.trim());
				if (info && result && this.store.enabled() && generation === this.generation) {
					const entry: QuestionCache = {
						version: 2,
						key,
						title: question.title,
						answer: result.answer,
						answerParts: safeAnswerParts(result.extra_data, result.answer),
						from: info.name,
						homepage: info.homepage || '',
						solution: String((result.extra_data as any)?.solution || ''),
						createdAt: Date.now()
					};
					this.store.set([entry, ...this.list().filter((item) => item.key !== key)].slice(0, 200));
				}
				return infos;
			})
			.finally(() => {
				if (this.pending.get(key) === task) this.pending.delete(key);
			});
		this.pending.set(key, task);
		return task;
	}
}

function safeAnswerParts(extra: any, answer: string): string[] | undefined {
	const parts = extra?.answer_parts;
	return Array.isArray(parts) &&
		parts.length &&
		parts.every((part) => typeof part === 'string' && part.trim()) &&
		parts.join('#') === answer
		? [...parts]
		: undefined;
}
