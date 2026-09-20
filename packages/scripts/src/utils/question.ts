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

function imagesIn(root: HTMLElement): Element[] {
	const selector = 'img, svg, canvas, [style*="background-image"]';
	return [...(root.matches(selector) ? [root] : []), ...Array.from(root.querySelectorAll(selector))].filter(
		(node) => !node.parentElement?.closest('svg')
	);
}
function visualURL(element: Element): string {
	try {
		if (element.tagName.toUpperCase() === 'IMG') return getQuestionImageURL(element as HTMLImageElement);
		if (element.tagName.toUpperCase() === 'CANVAS') return (element as HTMLCanvasElement).toDataURL('image/png');
		if (element.tagName.toLowerCase() === 'svg')
			return (
				'data:image/svg+xml;charset=utf-8,' +
				encodeURIComponent(new element.ownerDocument.defaultView!.XMLSerializer().serializeToString(element))
			);
		const url = (element as HTMLElement).style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
		return url ? new URL(url, element.ownerDocument.baseURI).href : '';
	} catch {
		return '';
	}
}
export function inspectQuestionImages(...groups: (HTMLElement | undefined)[][]) {
	const nodes = [...new Set(groups.flat().flatMap((root) => (root ? imagesIn(root) : [])))];
	const sources = nodes.map(visualURL);
	return {
		imageUrls: Array.from(new Set(sources.filter(Boolean))),
		hasImage: nodes.length > 0,
		unresolvedImageCount: sources.filter((source) => !source).length
	};
}
export function collectQuestionImageUrls(...groups: (HTMLElement | undefined)[][]): string[] {
	return inspectQuestionImages(...groups).imageUrls;
}
export function questionElementText(root: HTMLElement, imageUrls: string[]): string {
	const sources = imagesIn(root).map(visualURL);
	const clone = root.cloneNode(true) as HTMLElement;
	clone.querySelectorAll<HTMLElement>('[data-xth-image-ref], span').forEach((node) => {
		if (
			node.hasAttribute('data-xth-image-ref') ||
			(node.style.fontSize === '0px' && sources.includes(node.textContent?.trim() || ''))
		)
			node.remove();
	});
	for (const [imageIndex, img] of imagesIn(clone).entries()) {
		const index = imageUrls.indexOf(sources[imageIndex]);
		const marker = index >= 0 ? '[图片' + (index + 1) + ']' : '[图片无法读取]';
		if (img === clone) return marker;
		img.replaceWith(root.ownerDocument.createTextNode(marker));
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
