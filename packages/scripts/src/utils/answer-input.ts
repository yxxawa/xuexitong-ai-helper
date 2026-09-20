/** Keep each blank scoped to its own editor; never borrow a sibling blank's textarea. */
function textAnswerElements(option: HTMLElement) {
	const directText = option.matches('textarea,input');
	const directEditable = option.matches('[contenteditable="true"]');
	const root = directText ? option.parentElement || option : option;
	const text = (
		directText ? option : directEditable ? null : root.querySelector('textarea,input:not([type="hidden"])')
	) as HTMLTextAreaElement | HTMLInputElement | null;
	let body: HTMLElement | null | undefined = directEditable ? option : undefined;
	if (!directEditable) {
		try {
			// A textarea and iframe may be the backing field/editor pair. Multiple text
			// fields in their parent instead belong to different blanks.
			const frame =
				!directText || root.querySelectorAll('textarea,input:not([type="hidden"])').length === 1
					? root.querySelector<HTMLIFrameElement>('iframe')
					: null;
			body =
				frame?.contentDocument?.body ||
				(!directText ? root.querySelector<HTMLElement>('[contenteditable="true"]') : null);
		} catch {
			/* Cross-origin editor: use the backing field. */
		}
	}
	return { text, body };
}
/** Input mutations must notify the platform, and never interpret a model answer as executable HTML. */
export function fillTextAnswer(option: HTMLElement, answer: string) {
	const { text, body } = textAnswerElements(option);
	if (!text && !body) throw new Error('未找到可填写的输入框，未标记为完成，请手动检查。');
	if (text) {
		text.value = answer;
		const EventType = text.ownerDocument.defaultView!.Event;
		text.dispatchEvent(new EventType('input', { bubbles: true }));
		text.dispatchEvent(new EventType('change', { bubbles: true }));
	}
	if (body) {
		body.textContent = answer;
		body.style.whiteSpace = 'pre-wrap';
		body.dispatchEvent(new body.ownerDocument.defaultView!.Event('input', { bubbles: true }));
		body.dispatchEvent(new body.ownerDocument.defaultView!.Event('change', { bubbles: true }));
	}
}
function optionRow(option: HTMLElement): HTMLElement {
	const row = option.closest('li') || option.parentElement || option;
	// Some versions render all answer_p elements directly in one answerBg. Never
	// borrow another option's checked input/marker from that shared container.
	return row.querySelectorAll('.answer_p').length > 1 ||
		row.querySelectorAll('input[type="radio"],input[type="checkbox"]').length > 1
		? option
		: (row as HTMLElement);
}
export function isOptionChecked(option: HTMLElement): boolean {
	const root = optionRow(option);
	const input = root.matches('input[type="checkbox"],input[type="radio"]')
		? (root as HTMLInputElement)
		: root.querySelector<HTMLInputElement>('input[type="checkbox"],input[type="radio"]');
	return input
		? input.checked
		: Boolean(
				root.matches('[aria-checked="true"],[class*="check_answer"]') ||
					root.querySelector('[aria-checked="true"],[class*="check_answer"]')
		  );
}
export function readTextAnswer(option: HTMLElement): string {
	const { text, body } = textAnswerElements(option);
	return (body ? body.textContent || '' : text?.value || '').trim();
}
/** Completion here means the page already contains an answer, not that it is correct. */
export function readPageAnswer(
	type: string | undefined,
	options: HTMLElement[],
	root: HTMLElement
): string | undefined {
	if (type === 'single' || type === 'multiple' || type === 'judgement') {
		const selected = options.flatMap((option, index) =>
			isOptionChecked(option) ? [String.fromCharCode(65 + index)] : []
		);
		if (selected.length) return type === 'multiple' || selected.length === 1 ? selected.join('#') : undefined;
		// Legacy pages can store the selected letters only in an answer input.
		if (root.querySelector('input[type="radio"],input[type="checkbox"]')) return;
		const input = Array.from(root.querySelectorAll<HTMLInputElement>('input[name^="answer"],input[id^="answer"]')).find(
			(input) => !/answertype/i.test(input.name + input.id)
		);
		const letters =
			input?.value
				.trim()
				.toUpperCase()
				.replace(/[,;，、\s#]+/g, '') || '';
		if (
			letters &&
			/^[A-Z]+$/.test(letters) &&
			[...letters].every((letter) => letter.charCodeAt(0) - 65 < options.length) &&
			(type === 'multiple' || letters.length === 1)
		)
			return [...new Set(letters)].sort().join('#');
	} else if (type === 'completion') {
		const values = options.map(readTextAnswer);
		if (values.length && values.every(Boolean)) return values.join('#');
	} else if (type === 'line' || type === 'fill' || type === 'reader') {
		const inputs = Array.from(
			root.querySelectorAll<HTMLInputElement>(
				'.line_answer input[name^="answer"], .reading_answer input[name^="answer"], .filling_answer input[name^="answer"]'
			)
		);
		const groups = Array.from(
			root.querySelectorAll<HTMLElement>(
				type === 'line' ? '.line_answer_ct .selectBox' : type === 'reader' ? '.reading_answer' : '.filling_answer'
			)
		);
		if (
			groups.length &&
			(groups.length !== inputs.length ||
				groups.some(
					(group, index) =>
						!Array.from(group.querySelectorAll(type === 'line' ? 'li[data]' : 'span.saveSingleSelect[data]')).some(
							(option) => option.getAttribute('data') === inputs[index].value.trim()
						)
				))
		)
			return;
		if (inputs.length && inputs.every((input) => input.value.trim()))
			return inputs.map((input) => input.value.trim()).join('#');
	}
}
export function clearOtherMultipleOptions(options: HTMLElement[], answer: string) {
	if (!/^[A-Z](?:#[A-Z])*$/.test(answer)) return;
	const selected = new Set(answer.split('#').map((letter) => letter.charCodeAt(0) - 65));
	if ([...selected].some((index) => index >= options.length)) return;
	options.forEach((option, index) => {
		if (!selected.has(index) && isOptionChecked(option)) option.click();
	});
}
export async function fillGroupedChoices(
	answer: string,
	groups: HTMLElement[],
	selector: string,
	delay: () => Promise<unknown>,
	cancelled: () => boolean = () => false
) {
	const answers = answer.split('#').map((value) => value.trim());
	if (!groups.length || answers.length !== groups.length || answers.some((value) => !value)) return { finish: false };
	const targets = groups.map((group, index) =>
		Array.from(group.querySelectorAll<HTMLElement>(selector)).find((el) => el.getAttribute('data') === answers[index])
	);
	if (targets.some((target) => !target)) return { finish: false };
	for (const target of targets) {
		if (cancelled()) throw new Error('答题已取消');
		(target!.querySelector<HTMLElement>('a') || target!).click();
		await delay();
	}
	return { finish: true };
}
