/** Input mutations must notify the platform, and never interpret a model answer as executable HTML. */
export function fillTextAnswer(option: HTMLElement, answer: string) {
	const root = option.matches('textarea,input,[contenteditable="true"]') ? option.parentElement || option : option;
	const text = (
		option.matches('textarea,input') ? option : root.querySelector('textarea,input:not([type="hidden"])')
	) as HTMLTextAreaElement | HTMLInputElement | null;
	const frame = root.querySelector<HTMLIFrameElement>('iframe');
	let changed = false;
	if (text) {
		text.value = answer;
		const EventType = text.ownerDocument.defaultView!.Event;
		text.dispatchEvent(new EventType('input', { bubbles: true }));
		text.dispatchEvent(new EventType('change', { bubbles: true }));
		changed = true;
	}
	let body: HTMLElement | null | undefined;
	try {
		body =
			frame?.contentDocument?.body ||
			(option.matches('[contenteditable="true"]')
				? option
				: root.querySelector<HTMLElement>('[contenteditable="true"]'));
	} catch {
		/* Cross-origin editor. */
	}
	if (body) {
		body.textContent = answer;
		body.style.whiteSpace = 'pre-wrap';
		body.dispatchEvent(new body.ownerDocument.defaultView!.Event('input', { bubbles: true }));
		body.dispatchEvent(new body.ownerDocument.defaultView!.Event('change', { bubbles: true }));
		changed = true;
	}
	if (!changed) throw new Error('未找到可填写的输入框，未标记为完成，请手动检查。');
}
export function isOptionChecked(option: HTMLElement): boolean {
	const root = option.closest('li') || option.parentElement || option;
	const input = root.querySelector<HTMLInputElement>('input[type="checkbox"],input[type="radio"]');
	return Boolean(
		input?.checked ||
			root.getAttribute('aria-checked') === 'true' ||
			root.querySelector('[aria-checked="true"],[class*="check_answer"]')
	);
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
