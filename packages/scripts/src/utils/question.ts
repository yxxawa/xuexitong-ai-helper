/** Extract images before flattening question/option DOM; never mutate the live question. */
export function getQuestionImageURL(img: HTMLImageElement): string {
	const candidates = ['data-original', 'data-src', 'data-lazy-src', 'data-url'].map((name) => img.getAttribute(name));
	candidates.push(img.currentSrc, img.getAttribute('src'));
	for (const candidate of candidates) {
		if (!candidate?.trim()) continue;
		try {
			const url = new URL(candidate.trim(), img.ownerDocument.baseURI);
			if (
				/^https?:$/.test(url.protocol) ||
				url.protocol === 'blob:' ||
				url.href.toLowerCase().startsWith('data:image/')
			)
				return url.href;
		} catch {
			/* Try the next source. */
		}
	}
	return '';
}

const NON_QUESTION_CONTENT = [
	'head',
	'script',
	'style',
	'template',
	'noscript',
	'[hidden]',
	'[data-xth-image-ref]',
	// Checked icons and native choice controls are answer state, not stem/option content.
	// Their backgrounds (and child SVGs/images) may change after every click.
	'input[type="radio"]',
	'input[type="checkbox"]',
	'.num_option',
	'.num_option_dx',
	'.edui-editor-toolbarbox',
	'.edui-toolbar',
	'[role="toolbar"]',
	'.CodeMirror',
	'.ace_editor',
	'.monaco-editor',
	'.xth-programming-run-note',
	'.xth-answer-review'
].join(',');

/** Exam mark actions are UI chrome; keep their icons and captions out of both text and images. */
function isQuestionMarkControl(element: Element): boolean {
	// A selectable answer may itself be named “标记”; it is never the exam toolbar action.
	if (element.closest('.answerBg,.answer_p,.after,.reading_answer,.filling_answer,.firstUlList,.secondUlList')) return false;
	if (!element.matches('button,a[href^="javascript:"],a[href="#"],a:not([href]),[role="button"],[onclick],.marking,.mark'))
		return false;
	const label = element.textContent?.trim() || element.getAttribute('aria-label') || element.getAttribute('title') || '';
	return /^(?:取消|已|添加)?(?:标记|標記)(?:此题|本题|此題|本題)?$/.test(label.replace(/\s+/g, ''));
}

/**
 * Ignore visually hidden templates and editor chrome, including hidden ancestors.
 * Chaoxing marks visible question stems and options aria-hidden for accessibility;
 * that attribute alone must not exclude their text or images.
 */
export function isQuestionContentElement(element: Element, cache = new Map<Element, boolean>()): boolean {
	const cached = cache.get(element);
	if (cached !== undefined) return cached;
	const style = element.ownerDocument.defaultView?.getComputedStyle(element);
	const visible =
		!element.matches(NON_QUESTION_CONTENT) &&
		!isQuestionMarkControl(element) &&
		style?.display !== 'none' &&
		style?.visibility !== 'hidden' &&
		style?.visibility !== 'collapse' &&
		(!element.parentElement || isQuestionContentElement(element.parentElement, cache));
	cache.set(element, visible);
	return visible;
}

interface QuestionVisual {
	element: Element;
	sources: string[];
	background: boolean;
}
function imageURL(value: string, element: Element) {
	try {
		const url = new URL(value.trim(), element.ownerDocument.baseURI);
		return /^(?:https?:|blob:)$/.test(url.protocol) || url.href.startsWith('data:image/') ? url.href : '';
	} catch {
		return '';
	}
}
/** Inspect the connected source nodes: stylesheet backgrounds disappear on detached clones. */
function questionVisuals(root: HTMLElement): QuestionVisual[] {
	const visuals: QuestionVisual[] = [];
	const visibility = new Map<Element, boolean>();
	for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
		if (element.parentElement?.closest('svg') || !isQuestionContentElement(element, visibility)) continue;
		const tag = element.tagName.toUpperCase();
		try {
			if (tag === 'IMG')
				visuals.push({ element, sources: [getQuestionImageURL(element as HTMLImageElement)], background: false });
			else if (tag === 'CANVAS')
				visuals.push({ element, sources: [(element as HTMLCanvasElement).toDataURL('image/png')], background: false });
			else if (tag === 'SVG')
				visuals.push({
					element,
					sources: [
						'data:image/svg+xml;charset=utf-8,' +
							encodeURIComponent(new element.ownerDocument.defaultView!.XMLSerializer().serializeToString(element))
					],
					background: false
				});
			else {
				const style = element.ownerDocument.defaultView?.getComputedStyle(element);
				const background = style?.backgroundImage || (element as HTMLElement).style?.background || '';
				const sources = Array.from(background.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g), (match) =>
					imageURL(match[1] ?? match[2] ?? match[3], element)
				);
				if (sources.length) visuals.push({ element, sources, background: true });
			}
		} catch {
			if (tag === 'CANVAS' || tag === 'SVG' || tag === 'IMG')
				visuals.push({ element, sources: [''], background: false });
		}
	}
	return visuals;
}
export function inspectQuestionImages(...groups: (HTMLElement | undefined)[][]) {
	const visuals = new Map<Element, QuestionVisual>();
	for (const root of groups.flat())
		if (root) for (const visual of questionVisuals(root)) visuals.set(visual.element, visual);
	const sources = [...visuals.values()].flatMap((visual) => visual.sources);
	return {
		imageUrls: Array.from(new Set(sources.filter(Boolean))),
		hasImage: visuals.size > 0,
		unresolvedImageCount: sources.filter((source) => !source).length
	};
}
export function collectQuestionImageUrls(...groups: (HTMLElement | undefined)[][]): string[] {
	return inspectQuestionImages(...groups).imageUrls;
}
export function questionElementText(root: HTMLElement, imageUrls: string[]): string {
	const visibility = new Map<Element, boolean>();
	if (!isQuestionContentElement(root, visibility)) return '';
	const originals = [root, ...Array.from(root.querySelectorAll('*'))];
	const clone = root.cloneNode(true) as HTMLElement;
	const copies = [clone, ...Array.from(clone.querySelectorAll('*'))];
	const visuals = questionVisuals(root);
	for (let index = 1; index < originals.length; index++)
		if (!isQuestionContentElement(originals[index], visibility)) copies[index].remove();
	clone.querySelectorAll<HTMLElement>('[data-xth-image-ref], span').forEach((node) => {
		if (
			node.hasAttribute('data-xth-image-ref') ||
			(node.style.fontSize === '0px' &&
				visuals.some((visual) => visual.sources.includes(node.textContent?.trim() || '')))
		)
			node.remove();
	});
	for (const visual of visuals) {
		const copy = copies[originals.indexOf(visual.element)];
		if (copy !== clone && !clone.contains(copy)) continue;
		const marker = visual.sources
			.map((source) => {
				const index = source ? imageUrls.indexOf(source) : -1;
				return index >= 0 ? '[图片' + (index + 1) + ']' : '[图片无法读取]';
			})
			.join(' ');
		if (visual.background) copy.prepend(root.ownerDocument.createTextNode(marker + ' '));
		else if (copy === clone) return marker;
		else copy.replaceWith(root.ownerDocument.createTextNode(marker));
	}
	// Rich-text blanks are often underlined NBSPs, which textContent otherwise flattens away.
	// Mark only empty underline runs; underlined words (for example SQL primary keys) stay literal.
	for (let index = 0; index < originals.length; index++) {
		const original = originals[index],
			copy = copies[index];
		if (
			(copy !== clone && !clone.contains(copy)) ||
			!original.textContent ||
			original.textContent.trim() ||
			copy.textContent?.trim()
		)
			continue;
		const style = original.ownerDocument.defaultView?.getComputedStyle(original);
		if (
			original.tagName === 'U' ||
			/\bunderline\b/.test((style?.textDecorationLine || '') + ' ' + (style?.textDecoration || ''))
		)
			copy.textContent = '\uFFF0blank\uFFF1';
	}
	clone.querySelectorAll('script, style').forEach((node) => node.remove());
	// Source formatting whitespace collapses inline; visible line breaks must still separate blanks.
	const lineBoundary = '\uFFF0line\uFFF1';
	for (let index = 0; index < originals.length; index++) {
		const original = originals[index],
			copy = copies[index];
		if (copy !== clone && !clone.contains(copy)) continue;
		const whiteSpace =
			original.ownerDocument.defaultView?.getComputedStyle(original).whiteSpace ||
			(original.tagName === 'PRE' ? 'pre' : '');
		if (/^(?:pre|pre-wrap|pre-line|break-spaces)$/.test(whiteSpace))
			copy.childNodes.forEach((node) => {
				if (node.nodeType === 3) node.nodeValue = (node.nodeValue || '').replace(/\r\n?|\n/g, lineBoundary);
			});
	}
	clone.querySelectorAll('br').forEach((node) => node.replaceWith(root.ownerDocument.createTextNode(lineBoundary)));
	clone.querySelectorAll('p,div,li,pre,table,tr,td,dt,dd,h1,h2,h3,h4,h5,h6,blockquote').forEach((node) => {
		node.prepend(lineBoundary);
		node.append(lineBoundary);
	});
	return (clone.textContent || '')
		.replace(/\uFFF0blank\uFFF1(?:\s*\uFFF0blank\uFFF1)+/g, '\uFFF0blank\uFFF1')
		.replace(/\uFFF0blank\uFFF1/g, ' ____ ')
		.replace(/\uFFF0line\uFFF1/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}
/** Option images can be siblings of the text label; include the row only if it contains one option. */
export function questionOptionRoot(option: HTMLElement, options: HTMLElement[]): HTMLElement {
	const row = option.closest('li') || option.parentElement;
	return row && options.filter((item) => row.contains(item)).length === 1 && !row.querySelector('h3,.Zy_TItle')
		? (row as HTMLElement)
		: option;
}
export function questionOptionText(option: HTMLElement, options: HTMLElement[], imageUrls: string[]): string {
	return questionElementText(questionOptionRoot(option, options), imageUrls).replace(/^[A-Z][.、．]\s*/, '');
}

export function collectGroupedOptions(groups: HTMLElement[], selector: string, imageUrls: string[]) {
	return groups.map((group, index) => ({
		index,
		title: questionElementText(group, imageUrls),
		options: Array.from(group.querySelectorAll<HTMLElement>(selector))
			.map((item) => ({
				value: item.getAttribute('data') || '',
				text: questionElementText(item.closest('li') || item, imageUrls)
			}))
			.filter((option) => option.value)
	}));
}

/** Render model/question text without interpreting embedded HTML. Only explicit HTTP image URLs become images. */
export function questionDisplayHTML(text: string, doc: Document = document): string {
	const container = doc.createElement('span');
	const pattern = /https?:\/\/[^\s<>"']+?\.(?:png|jpe?g|gif|webp)(?:\?[^\s<>"']*)?/gi;
	let offset = 0;
	for (const match of text.matchAll(pattern)) {
		const index = match.index!;
		container.append(doc.createTextNode(text.slice(offset, index)));
		const image = doc.createElement('img');
		image.src = match[0];
		image.alt = '题目图片';
		image.loading = 'lazy';
		container.append(image);
		offset = index + match[0].length;
	}
	container.append(doc.createTextNode(text.slice(offset)));
	return container.innerHTML;
}
