import type { WorkContext, ResolverResult } from '@xuexitong-ai-helper/core/src/core/worker/interface';
import type { SearchInformation } from '@xuexitong-ai-helper/core/src/core/worker/search.interface';
import type { AIQuestionPayload } from './ai';
import { fillProgrammingAnswer } from './answer-writer';
import { getProgramEditor, readProgrammingAnswer, type ProgramPageWindow } from './programming';
import { waitForAI, type AIRequestControl } from './request-control';

export const MAX_PROGRAM_RUNS = 3;
const validated = new WeakMap<HTMLElement, string>();
export interface ProgrammingRunResult {
	passed: boolean;
	output: string;
	retryable: boolean;
}
export interface ProgrammingRunAttempt extends ProgrammingRunResult {
	attempt: number;
	answer: string;
}
function fingerprint(root: HTMLElement, answer: string) {
	return JSON.stringify([root.id, root.querySelector<HTMLInputElement>('.languageSelect')?.value || '', answer]);
}
export function programmingRunWasPassed(root: HTMLElement, answer: string): boolean {
	return validated.get(root) === fingerprint(root, answer);
}
function runOutput(output: HTMLElement) {
	const nodes = Array.from(output.querySelectorAll<HTMLElement>('.runResult'));
	const values = nodes.map((node) => ((node as HTMLTextAreaElement).value ?? node.textContent ?? '').trim());
	return {
		nodes,
		signature: JSON.stringify(nodes.map((node, i) => [node.className, values[i]])),
		text: values.filter(Boolean).join('\n'),
		passed: nodes.length > 0 && values.some(Boolean) && nodes.every((node) => node.classList.contains('result_right')),
		failed: nodes.some((node) => node.classList.contains('result_wrong'))
	};
}

/** Click the actual page button and wait for this invocation's output, never a prior green result. */
export async function runProgrammingAnswer(
	root: HTMLElement,
	answer: string,
	control: AIRequestControl & { timeoutMs?: number; pollMs?: number } = {},
	pageWindow?: ProgramPageWindow
): Promise<ProgrammingRunResult> {
	await waitForAI(control);
	const editor = getProgramEditor(root, pageWindow).editor;
	const initialFingerprint = fingerprint(root, answer);
	const target = () => {
		if (
			!root.isConnected ||
			!editor ||
			getProgramEditor(root, pageWindow).editor !== editor ||
			editor.getValue() !== answer ||
			fingerprint(root, answer) !== initialFingerprint
		)
			throw new Error('程序题页面或代码已变化，已停止运行和自动纠错，请重新读取本题。');
	};
	target();
	validated.delete(root);
	const button = root.querySelector<HTMLElement>('#runBtn');
	const output = root.querySelector<HTMLElement>('#output') || root.querySelector<HTMLElement>('#runresult');
	const status = root.querySelector<HTMLElement>('#runstatus');
	if (!button || !output)
		return { passed: false, retryable: false, output: '未找到程序题的运行按钮或结果区域，已跳过。' };
	if (button.matches(':disabled,[aria-disabled="true"],.disabled,.jb_btn_92_disable'))
		return { passed: false, retryable: false, output: '程序题运行按钮尚未就绪，已跳过，未重复启动运行。' };
	const before = runOutput(output);
	let remaining = Math.max(1, control.timeoutMs ?? 60000);
	const pollMs = Math.max(1, control.pollMs ?? 100);
	button.click();
	for (;;) {
		await waitForAI(control);
		target();
		if (!root.contains(button) || !root.contains(output)) throw new Error('程序题运行控件已被替换，请重新读取本题。');
		const current = runOutput(output);
		const fresh =
			current.signature !== before.signature ||
			current.nodes.length !== before.nodes.length ||
			current.nodes.some((node, i) => node !== before.nodes[i]);
		const busy =
			status && !status.hidden && root.ownerDocument.defaultView!.getComputedStyle(status).display !== 'none';
		if (fresh && !busy && current.text && (current.passed || current.failed)) {
			if (current.passed) validated.set(root, fingerprint(root, answer));
			return { passed: Boolean(current.passed), retryable: !current.passed, output: current.text };
		}
		if (remaining <= 0)
			return { passed: false, retryable: false, output: '等待本次程序运行结果超时，已跳过，未把旧结果当作通过。' };
		const start = Date.now();
		await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
		remaining -= Math.max(1, Date.now() - start);
	}
}

export interface ProgrammingAnswerOptions {
	question: AIQuestionPayload;
	pageWindow?: ProgramPageWindow;
	correct(question: AIQuestionPayload): Promise<SearchInformation[]>;
	onPassed?(infos: SearchInformation[]): void | Promise<void>;
	onFailed?(): void | Promise<void>;
	onProgress?(message: string, state: 'running' | 'correcting' | 'passed' | 'skipped'): void;
	run?: typeof runProgrammingAnswer;
}
function validInfos(infos: SearchInformation[]) {
	return infos.filter(
		(info) => !info.error && !info.data?.skipped && info.results.some((result) => result.answer?.trim())
	);
}
/** Initial answer + at most two corrected answers = at most three actual runs for this question. */
export async function answerProgrammingQuestion(
	ctx: WorkContext<any>,
	options: ProgrammingAnswerOptions
): Promise<ResolverResult> {
	const attempts: ProgrammingRunAttempt[] = [];
	const record = (state: 'passed' | 'failed' | 'skipped') => {
		for (const info of ctx.searchInfos)
			for (const result of info.results)
				result.extra_data = {
					...result.extra_data,
					programming_run: { state, maxAttempts: MAX_PROGRAM_RUNS, attempts: [...attempts] }
				};
	};
	const skip = async (error: string) => {
		validated.delete(ctx.root);
		record('skipped');
		await options.onFailed?.();
		options.onProgress?.(error, 'skipped');
		return { finish: false, skipped: true, error, programmingAttempts: attempts.length };
	};
	for (let attempt = 1; attempt <= MAX_PROGRAM_RUNS; attempt++) {
		await waitForAI(ctx);
		const filled = await fillProgrammingAnswer(ctx, options.pageWindow);
		if (!filled.finish) return skip('程序题未取得完整代码，已跳过。');
		const answer = readProgrammingAnswer(ctx.root, options.pageWindow)!;
		options.onProgress?.('正在运行程序（' + attempt + '/' + MAX_PROGRAM_RUNS + '）…', 'running');
		const result = await (options.run || runProgrammingAnswer)(ctx.root, answer, ctx, options.pageWindow);
		await waitForAI(ctx);
		if (!ctx.root.isConnected || readProgrammingAnswer(ctx.root, options.pageWindow) !== answer)
			throw new Error('程序题页面或代码已变化，已停止自动纠错。');
		attempts.push({ attempt, answer, ...result });
		record(result.passed ? 'passed' : 'failed');
		if (result.passed) {
			validated.set(ctx.root, fingerprint(ctx.root, answer));
			await options.onPassed?.(ctx.searchInfos);
			options.onProgress?.('程序运行通过（' + attempt + '/' + MAX_PROGRAM_RUNS + '）', 'passed');
			return { finish: true, programmingAttempts: attempt, programmingOutput: result.output };
		}
		if (!result.retryable) return skip(result.output);
		if (attempt === MAX_PROGRAM_RUNS)
			return skip('程序题已运行 ' + MAX_PROGRAM_RUNS + ' 次仍未通过，已跳过本题。\n' + result.output);
		options.onProgress?.('运行未通过，正在请求 AI 修正（' + attempt + '/' + MAX_PROGRAM_RUNS + '）…', 'correcting');
		await waitForAI(ctx);
		const corrected = await options.correct({
			...options.question,
			programmingFeedback: { answer, output: result.output, attempt, maxAttempts: MAX_PROGRAM_RUNS }
		});
		await waitForAI(ctx);
		if (!ctx.root.isConnected || readProgrammingAnswer(ctx.root, options.pageWindow) !== answer)
			throw new Error('等待纠错期间题目或代码已变化，未回填旧答案。');
		const infos = validInfos(corrected || []);
		if (!infos.length)
			return skip('AI 未返回可用的程序纠错代码，已跳过本题。' + (corrected?.find((info) => info.error)?.error || ''));
		ctx.searchInfos = infos;
	}
	return skip('程序题已达到运行次数上限，已跳过。');
}
