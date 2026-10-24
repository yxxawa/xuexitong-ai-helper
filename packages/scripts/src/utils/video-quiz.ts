import { isStudyElementVisible } from './study';

type QuizOption = { label: HTMLLabelElement; input?: HTMLInputElement };

type QuizSnapshot = {
	submit: HTMLElement;
	key: string;
	options: QuizOption[];
	multiple: boolean;
};

function readQuiz(doc: Document): QuizSnapshot | undefined {
	const submit = Array.from(doc.querySelectorAll<HTMLElement>('#videoquiz-submit')).find(isStudyElementVisible);
	if (!submit) return;
	const root = submit.closest<HTMLElement>('.ans-videoquiz') || doc;
	const seen = new Set<HTMLElement>();
	const options: QuizOption[] = [];
	for (const label of Array.from(root.querySelectorAll<HTMLLabelElement>('.ans-videoquiz-opt label'))) {
		if (!isStudyElementVisible(label)) continue;
		const control = label.control || label.querySelector('input');
		const input = control?.tagName === 'INPUT' ? control as HTMLInputElement : undefined;
		if (input?.disabled || label.getAttribute('aria-disabled') === 'true') continue;
		const target = input || label;
		if (seen.has(target)) continue;
		seen.add(target);
		options.push({ label, input });
	}
	const title = root.querySelector('.ans-videoquiz-title,.ans-videoquiz-tit,.ans-videoquiz-question')?.textContent || '';
	const id = root.nodeType === 1 ? (root as HTMLElement).getAttribute('data-question-id') || '' : '';
	const key = JSON.stringify([id, title, options.map(({ label, input }) =>
		[label.textContent, input?.name, input?.value, input?.type])]);
	return { submit, key, options, multiple: options.some(({ input }) => input?.type === 'checkbox') };
}

/** Reuse the media poll, so no retry timer can outlive the player. */
export function createVideoQuizController(doc: Document, settings: {
	automatic: () => boolean;
	signal?: AbortSignal;
	retryMs?: number;
	onQuestion?: (automatic: boolean) => void;
}) {
	let state: { key: string; single: number; bits: boolean[]; lastAttemptAt: number } | undefined;
	const retryMs = settings.retryMs ?? 3000;
	return {
		isBlocked: () => !settings.signal?.aborted && !!readQuiz(doc),
		tick() {
			if (settings.signal?.aborted) { state = undefined; return; }
			const quiz = readQuiz(doc);
			if (!quiz) { state = undefined; return; }
			if (!state || state.key !== quiz.key) {
				state = { key: quiz.key, single: 0, bits: quiz.options.map(() => false), lastAttemptAt: -Infinity };
				settings.onQuestion?.(settings.automatic());
			}
			if (!settings.automatic() || !quiz.options.length || Date.now() - state.lastAttemptAt < retryMs) return;
			if (quiz.submit.getAttribute('aria-busy') === 'true') return;
			// A checkbox question needs real inputs to clear a previously wrong combination.
			if (quiz.multiple && quiz.options.some(({ input }) => input?.type !== 'checkbox')) return;
			state.lastAttemptAt = Date.now();
			let selected: boolean[];
			if (quiz.multiple) {
				// Binary counter without materializing an exponential list of combinations.
				const next = state.bits.slice();
				let index = 0;
				while (index < next.length && next[index]) { next[index] = false; index++; }
				if (index < next.length) next[index] = true;
				else next[0] = true;
				selected = next;
			} else {
				selected = quiz.options.map((_, index) => index === state!.single);
			}
			for (let index = 0; index < quiz.options.length; index++) {
				if (settings.signal?.aborted) return;
				const { label, input } = quiz.options[index];
				const needsClick = input
					? input.checked !== selected[index] && (quiz.multiple || selected[index])
					: selected[index];
				if (needsClick) {
					label.click();
					if (input && input.checked !== selected[index]) input.click();
				}
			}
			if (settings.signal?.aborted || !isStudyElementVisible(quiz.submit)) return;
			if (quiz.submit.hasAttribute('disabled') || quiz.submit.getAttribute('aria-disabled') === 'true' ||
				quiz.submit.getAttribute('aria-busy') === 'true') return;
			if (quiz.options.some(({ input }, index) => input && input.checked !== selected[index])) return;
			if (quiz.multiple) state.bits = selected;
			else state.single = (state.single + 1) % quiz.options.length;
			quiz.submit.click();
		}
	};
}
