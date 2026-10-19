import { createDefaultQuestionResolver } from '@xuexitong-ai-helper/core/src/core/worker/question.resolver';
import type { WorkContext } from '@xuexitong-ai-helper/core/src/core/worker/interface';
import { fillTextAnswer, isOptionChecked, optionRow, readPageAnswer } from './answer-input';
import {
	normalizeProgramAnswer,
	writeProgrammingAnswer,
	readProgrammingAnswer,
	type ProgramPageWindow
} from './programming';

/** Resolve first, validate all targets, then verify the answer actually persisted on the page. */
export async function fillStandardAnswer(
	ctx: WorkContext<any>,
	type: 'single' | 'multiple' | 'judgement' | 'completion',
	delay: () => Promise<unknown>
) {
	const options = ctx.elements.options as HTMLElement[];
	const writes: { option: HTMLElement; answer: string }[] = [];
	const result = await createDefaultQuestionResolver(ctx)[type](ctx.searchInfos, options, (_type, answer, option) => {
		writes.push({ option, answer });
	});
	if (!result.finish || !writes.length) return { ...result, finish: false };
	const writable = (option: HTMLElement) => {
		const row = optionRow(option);
		return (
			option.isConnected &&
			ctx.root.contains(option) &&
			!row.matches(':disabled,[aria-disabled="true"]') &&
			!row.closest('fieldset[disabled]') &&
			!row.querySelector('input:disabled,textarea:disabled,input[readonly],textarea[readonly]')
		);
	};
	if (
		writes.some(({ option, answer }) => !writable(option) || !answer.trim()) ||
		(type === 'completion' && writes.length !== options.length)
	)
		return { finish: false };
	const selected = new Set(writes.map(({ option }) => options.indexOf(option)));
	if (selected.has(-1)) return { finish: false };
	const ready = async (option: HTMLElement) => {
		await ctx.waitUntilReady?.();
		if (ctx.isCancelled?.()) throw new Error('答题已取消');
		if (!writable(option)) throw new Error('答题控件已变化或不可编辑，请重新读取题目。');
	};
	if (type === 'multiple') {
		for (const [index, option] of options.entries()) {
			if (!selected.has(index) && isOptionChecked(option)) {
				await ready(option);
				option.click();
				await delay();
			}
		}
	}
	for (const { option, answer } of writes) {
		await ready(option);
		if (type === 'completion') {
			fillTextAnswer(option, answer);
			const save = option.parentElement?.parentElement?.querySelector<HTMLElement>('[onclick*=saveQuestion]');
			if (save) {
				await ready(option);
				save.click();
			}
		} else if (!isOptionChecked(option)) option.click();
		await delay();
	}
	await ctx.waitUntilReady?.();
	if (ctx.isCancelled?.()) throw new Error('答题已取消');
	const expected =
		type === 'completion'
			? options.map((option) => writes.find((write) => write.option === option)!.answer.trim()).join('#')
			: [...selected]
					.sort((a, b) => a - b)
					.map((index) => String.fromCharCode(65 + index))
					.join('#');
	const finish =
		options.every((option) => option.isConnected && ctx.root.contains(option)) &&
		readPageAnswer(type, options, ctx.root) === expected;
	if (!finish) throw new Error('未能确认网页已保存完整答案，请检查本题后重试。');
	return { ...result, finish };
}

/** Program code is one answer. Never split Python comments, operators or source lines into blanks. */
export async function fillProgrammingAnswer(ctx: WorkContext<any>, pageWindow?: ProgramPageWindow) {
	const result = ctx.searchInfos
		.filter((info) => !info.error && !(info.data as any)?.skipped)
		.flatMap((info) => info.results)
		.find((result) => result.answer?.trim());
	if (!result) return { finish: false };
	await ctx.waitUntilReady?.();
	if (ctx.isCancelled?.()) throw new Error('答题已取消');
	const answer = normalizeProgramAnswer(result.answer);
	writeProgrammingAnswer(ctx.root, answer, pageWindow);
	if (readProgrammingAnswer(ctx.root, pageWindow) !== answer)
		throw new Error('未能确认程序题已保存完整代码，请检查本题后重试。');
	return { finish: true };
}
