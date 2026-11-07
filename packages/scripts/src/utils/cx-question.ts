import type { AILineOptionGroup } from './ai';
import { isQuestionContentElement, questionElementText } from './question';

export type CXQuestionType =
	| 'single'
	| 'multiple'
	| 'judgement'
	| 'completion'
	| 'line'
	| 'fill'
	| 'reader'
	| 'programming';

const LINE_CONTROLS = '.line_answer_ct .selectBox, .line_answer_ct select, .thirdUlList select, select.dept_select';
const LEFT_COLUMN = '.firstUlList, .line_wid_half.fl, .line_wid_400.fl';
const RIGHT_COLUMN = '.secondUlList, .line_wid_half.fr, .line_wid_400.fr';

/** Old custom menus and the new native/Chosen selects are alternative renderers, not separate blanks. */
export function lineSelectBoxes(root: HTMLElement | Document): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(LINE_CONTROLS)).filter(
		(box) => box.tagName === 'SELECT' || !box.querySelector('select')
	);
}

/** Read the stem in document order without pulling answer inputs or editor UI into the prompt. */
export function cxQuestionTitles(
	root: HTMLElement | Document,
	titleSelector: string,
	optionSelector = '.answerBg .answer_p, .textDIV, .eidtDiv'
): HTMLElement[] {
	const titles: HTMLElement[] = [];
	const columns = LEFT_COLUMN + ', ' + RIGHT_COLUMN;
	const answers = [
		'.answerBg',
		'.stem_answer',
		'.mark_answer',
		'.line_answer',
		'.line_answer_ct',
		'.thirdUlList',
		'.reading_answer',
		'.filling_answer',
		'.proceduralQue',
		'.textDIV',
		'.eidtDiv',
		'.answer_p',
		optionSelector,
		'.selectBoxLang',
		'.edui-editor',
		'input',
		'textarea',
		'select',
		'button',
		'iframe',
		'[contenteditable="true"]'
	].join(',');
	const visibility = new Map<Element, boolean>();
	const visit = (element: HTMLElement) => {
		if (!isQuestionContentElement(element, visibility)) return;
		if (element.matches(columns)) {
			titles.push(element);
			return;
		}
		if (element.matches(answers)) return;
		if (element.matches(titleSelector) || !element.querySelector(answers)) {
			titles.push(element);
			return;
		}
		for (const child of Array.from(element.children)) visit(child as HTMLElement);
	};
	for (const child of Array.from(root.children)) visit(child as HTMLElement);
	// Matching columns can live inside an answer container, but are still part of the stem.
	for (const column of Array.from(root.querySelectorAll<HTMLElement>(columns)))
		if (isQuestionContentElement(column, visibility) && !titles.some((title) => title.contains(column)))
			titles.push(column);
	return titles;
}

export function getQuestionType(value: number): CXQuestionType | undefined {
	if (value === 0) return 'single';
	if (value === 1) return 'multiple';
	if (value === 3) return 'judgement';
	if ([2, 4, 5, 6, 7, 8, 9, 10].includes(value)) return 'completion';
	if (value === 11) return 'line';
	if (value === 14) return 'fill';
	if (value === 15) return 'reader';
	if (value === 17) return 'programming';
}

/** Numbered fields belong to this question; bare type/typeFlag inputs may describe the exam UI. */
export function cxQuestionTypeInput(inputs: HTMLInputElement[]): HTMLInputElement | undefined {
	return inputs.find((input) => /^(?:answertype|type)\d+$/i.test(input.name) || /^(?:answertype|type)\d+$/i.test(input.id)) ||
		inputs.find((input) => /^(?:answertype|type)$/i.test(input.name) || /^(?:answertype|type)$/i.test(input.id));
}

export function resolveQuestionType(
	elements: { type?: HTMLElement[]; options?: HTMLElement[] },
	ctx?: { type?: CXQuestionType; root?: HTMLElement },
	title = ''
): CXQuestionType | undefined {
	const inputs = (elements.type || []) as HTMLInputElement[];
	const typeInput = cxQuestionTypeInput(inputs) || inputs[0];
	const parsed = typeInput ? getQuestionType(Number(typeInput.value.trim() || NaN)) : undefined;
	if (parsed) return parsed;
	// Specific matching markup must win over generic textarea/radio heuristics.
	if (ctx?.root && lineSelectBoxes(ctx.root).length) return 'line';
	if (/连线题|連線題|匹配题|配对题|matching(?:\s+question)?/i.test(title)) return 'line';
	if (
		ctx?.root?.querySelector('textarea.code-editor, .proceduralQue') ||
		/程序题|编程题|programming(?: question)?/i.test(title)
	)
		return 'programming';
	if (ctx?.type) return ctx.type;
	if (/判断题|true or false|对错题|判斷題/i.test(title)) return 'judgement';
	if (/多选题|多選題|multiple choice/i.test(title)) return 'multiple';
	if (/单选题|單選題|single choice/i.test(title)) return 'single';
	if (/填空题|填空題|completion|blank/i.test(title)) return 'completion';
	if (ctx?.root?.querySelector('input[type=checkbox]')) return 'multiple';
	if (ctx?.root?.querySelector('textarea,[contenteditable=true]')) return 'completion';
	const options = elements.options || [];
	const optionText = options.map((option) => (option?.textContent || '').trim()).filter(Boolean);
	if (optionText.length === 2 && optionText.every((text) => /^(正确|错误|对|错|√|×|true|false|是|否)$/i.test(text)))
		return 'judgement';
	if (ctx?.root?.querySelector('input[type=radio]')) return 'single';
}

function columnItems(root: HTMLElement | Document, selector: string, imageUrls: string[]): string[] {
	const column = root.querySelector<HTMLElement>(selector);
	if (!column) return [];
	const items = Array.from(column.querySelectorAll<HTMLElement>('li, .lineCt')).filter(
		(item) => !item.parentElement?.closest('li, .lineCt') || !column.contains(item.parentElement.closest('li, .lineCt'))
	);
	return (items.length ? items : (Array.from(column.children) as HTMLElement[])).map((item) =>
		questionElementText(item, imageUrls)
	);
}

function isPlaceholder(value: string, text: string): boolean {
	return (
		!value.trim() ||
		value === '-1' ||
		/^(?:[-—=\s]*请选择(?:答案|一项)?[-—=\s]*|[-—=\s]*(?:select|choose)(?: an? (?:option|answer))?[-—=\s]*)$/i.test(
			text
		)
	);
}

function lineOptions(box: HTMLElement, imageUrls: string[]) {
	if (box.tagName === 'SELECT') {
		return Array.from((box as HTMLSelectElement).options)
			.filter((option) => !option.disabled && !option.closest('optgroup[disabled]'))
			.map((option) => ({ value: option.value, text: (option.textContent || '').trim() }))
			.filter((option) => !isPlaceholder(option.value, option.text));
	}
	return Array.from(box.querySelectorAll<HTMLElement>('li[data]'))
		.filter((item) => !item.matches('[aria-disabled="true"],.disabled'))
		.map((item) => ({
			value: item.getAttribute('data') || '',
			// A closed menu is hidden by design; its semantic labels still map to the visible right column.
			text: questionElementText(item, imageUrls) || (item.querySelector('a')?.textContent || item.textContent || '').trim()
		}))
		.filter((option) => !isPlaceholder(option.value, option.text));
}

export function collectLineOptionGroups(root: HTMLElement, imageUrls: string[] = []): AILineOptionGroup[] {
	const left = columnItems(root, LEFT_COLUMN, imageUrls);
	const right = columnItems(root, RIGHT_COLUMN, imageUrls);
	const boxes = lineSelectBoxes(root);
	if (
		!boxes.length ||
		(root.querySelector(LEFT_COLUMN) && (left.length !== boxes.length || left.some((text) => !text.trim()))) ||
		(root.querySelector(RIGHT_COLUMN) && (!right.length || right.some((text) => !text.trim())))
	)
		return [];
	let incomplete = false;
	const groups = boxes.map((box, index) => ({
		index,
		title: left[index] || `第 ${index + 1} 个连线项`,
		options: lineOptions(box, imageUrls).map((option) => {
			const label = option.text.replace(/[.、．:：)）\s]+$/g, '');
			const matches = right.filter((text) => {
				const key = text.match(/^\s*([A-Za-z]+|\d+)[.、．:：)）\s]/)?.[1];
				return key && (key.toLowerCase() === label.toLowerCase() || key === option.value);
			});
			// A menu containing only labels is meaningful only when its column text is available.
			if (!option.text.trim() || (/^[A-Za-z]$/.test(label) && matches.length !== 1)) incomplete = true;
			return { value: option.value, text: matches.length === 1 ? matches[0] : option.text };
		})
	}));
	return incomplete || groups.some((group) => !group.options.length) ? [] : groups;
}

function legacyAnswerInputs(root: HTMLElement): HTMLInputElement[] {
	return Array.from(root.querySelectorAll<HTMLInputElement>('.line_answer input[name^="answer"]')).filter(
		(input) => !/answertype/i.test(input.name + input.id)
	);
}

/** Never treat a placeholder or a partially answered set as a finished question. */
export function readLineAnswer(root: HTMLElement): string | undefined {
	const boxes = lineSelectBoxes(root);
	if (!boxes.length || collectLineOptionGroups(root).length !== boxes.length) return;
	const legacy = boxes.filter((box) => box.tagName !== 'SELECT');
	const inputs = legacyAnswerInputs(root);
	let legacyAnswers = inputs.map((input) => input.value.trim());
	if (legacy.length && inputs.length !== legacy.length) {
		// Current homework menus save all pairs in #answer<qid> and mirror each value on a span.
		const questionId = legacy[0].closest('.line_answer')?.getAttribute('data');
		const saved = questionId && Array.from(root.querySelectorAll<HTMLInputElement>('input'))
			.find((input) => input.id === 'answer' + questionId);
		if (!saved) return;
		try {
			const pairs: { name: string; content: string }[] = JSON.parse(saved.value);
			if (!Array.isArray(pairs) || pairs.length !== legacy.length) return;
			legacyAnswers = legacy.map((box) => {
				const field = box.querySelector('p span[value][data]');
				const matches = pairs.filter((pair) => pair && String(pair.name) === field?.getAttribute('data'));
				const value = matches.length === 1 && typeof matches[0].content === 'string' ? matches[0].content.trim() : '';
				return field && value === field.getAttribute('value')?.trim() ? value : '';
			});
		} catch { return; }
	}
	let legacyIndex = 0;
	const answers = boxes.map((box) =>
		box.tagName === 'SELECT' ? (box as HTMLSelectElement).value : legacyAnswers[legacyIndex++]
	);
	if (answers.every((answer, index) => lineOptions(boxes[index], []).some((option) => option.value === answer)))
		return answers.join('#');
}

/** Validate the entire answer before writing anything, then use native events so Chaoxing saves it. */
export async function fillLineAnswer(
	answer: string,
	root: HTMLElement,
	delay: () => Promise<unknown>,
	cancelled: () => boolean = () => false,
	beforeWrite?: () => Promise<void>
): Promise<{ finish: boolean }> {
	const boxes = lineSelectBoxes(root);
	const answers = answer.split('#').map((value) => value.trim());
	const writable = (box: HTMLElement) =>
		box.isConnected &&
		root.contains(box) &&
		!box.matches(':disabled,[disabled]') &&
		!box.closest('[aria-disabled="true"],.disabled') &&
		(box.tagName === 'SELECT' || !box.closest('fieldset[disabled]'));
	if (
		!boxes.length ||
		collectLineOptionGroups(root).length !== boxes.length ||
		boxes.some((box) => !writable(box)) ||
		answers.length !== boxes.length ||
		answers.some((value, index) => !lineOptions(boxes[index], []).some((option) => option.value === value))
	)
		return { finish: false };
	for (let index = 0; index < boxes.length; index++) {
		await beforeWrite?.();
		if (cancelled()) throw new Error('答题已取消');
		const box = boxes[index];
		if (!writable(box) || !lineOptions(box, []).some((option) => option.value === answers[index]))
			return { finish: false };
		if (box.tagName === 'SELECT') {
			const select = box as HTMLSelectElement;
			select.value = answers[index];
			const EventType = select.ownerDocument.defaultView!.Event;
			select.dispatchEvent(new EventType('input', { bubbles: true }));
			select.dispatchEvent(new EventType('change', { bubbles: true }));
			select.dispatchEvent(new EventType('chosen:updated', { bubbles: true }));
			// Also synchronize the visible label when Chosen isn't listening for native custom events.
			const chosen = select.nextElementSibling;
			const label = chosen?.matches('.chosen-container') ? chosen.querySelector('.chosen-single span') : null;
			if (label) label.textContent = select.selectedOptions[0]?.textContent || '';
		} else {
			const target = Array.from(box.querySelectorAll<HTMLElement>('li[data]')).find(
				(item) => item.getAttribute('data') === answers[index]
			)!;
			(target.querySelector<HTMLElement>('a') || target).click();
		}
		await delay();
	}
	await beforeWrite?.();
	return { finish: !cancelled() && readLineAnswer(root) === answers.join('#') };
}
