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
	for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
		if (element.parentElement?.closest('svg') || element.closest('script,style,[data-xth-image-ref]')) continue;
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
	const originals = [root, ...Array.from(root.querySelectorAll('*'))];
	const clone = root.cloneNode(true) as HTMLElement;
	const copies = [clone, ...Array.from(clone.querySelectorAll('*'))];
	const visuals = questionVisuals(root);
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
	clone.querySelectorAll('script, style').forEach((node) => node.remove());
	clone.querySelectorAll('br').forEach((node) => node.replaceWith(root.ownerDocument.createTextNode('\n')));
	return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}
/** Option images can be siblings of the text label; include the row only if it contains one option. */
export function questionOptionText(option: HTMLElement, options: HTMLElement[], imageUrls: string[]): string {
	const row = option.closest('li') || option.parentElement;
	const source =
		row && options.filter((item) => row.contains(item)).length === 1 && !row.querySelector('h3,.Zy_TItle')
			? (row as HTMLElement)
			: option;
	return questionElementText(source, imageUrls).replace(/^[A-Z][.、．]\s*/, '');
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
