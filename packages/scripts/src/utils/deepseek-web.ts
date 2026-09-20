/** Native page uploads/submission; no cookies, access tokens, or CAPTCHA handling. */
export interface WebImage {
	name: string;
	dataUrl: string;
}
/** These are bridge memory limits, not claims about the website's quota. */
export function validateWebImages(images: WebImage[]): void {
	if (!Array.isArray(images) || images.length > 10) throw new Error('网页桥接每题最多支持 10 张图片；未发送题目。');
	let bytes = 0;
	for (const image of images) {
		if (
			!image ||
			typeof image.dataUrl !== 'string' ||
			image.dataUrl.length > 14 * 1024 * 1024 ||
			!/^xth-image-\d+\.(png|jpeg|webp|gif)$/.test(image.name) ||
			!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)
		)
			throw new Error('网页图片格式无效或单张超过 10 MB；未发送题目。');
		const size = Math.ceil((image.dataUrl.slice(image.dataUrl.indexOf(',') + 1).length * 3) / 4);
		if (size > 10 * 1024 * 1024) throw new Error('网页图片单张超过 10 MB；未发送题目。');
		bytes += size;
	}
	if (bytes > 20 * 1024 * 1024 || new Set(images.map((image) => image.name)).size !== images.length)
		throw new Error('网页图片总计超过 20 MB 或文件名重复；未发送题目。');
}
export interface WebChatAdapter {
	id: string;
	supportsImages?: boolean;
	assertEmpty(): void;
	assertReady(): void;
	submit(prompt: string, cancelled: () => boolean, images?: WebImage[]): Promise<void>;
	readCompleted(requestId: string): string | undefined;
	reset(): void;
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const visible = (element: HTMLElement) => !element.hidden && element.getClientRects().length > 0;

/** Accept only a complete JSON object with the exact request nonce, never an old conversation's answer. */
export function extractBridgeAnswer(text: string, requestId: string): string | undefined {
	for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
		let depth = 0,
			quoted = false,
			escaped = false;
		for (let i = start; i < text.length; i++) {
			const char = text[i];
			if (quoted) {
				if (escaped) escaped = false;
				else if (char === '\\') escaped = true;
				else if (char === '"') quoted = false;
			} else if (char === '"') quoted = true;
			else if (char === '{') depth++;
			else if (char === '}' && --depth === 0) {
				try {
					const value = JSON.parse(text.slice(start, i + 1));
					if (value._bridge_id === requestId && (value.answer !== undefined || Array.isArray(value.answers)))
						return JSON.stringify(value);
				} catch {
					/* Not a final JSON answer. */
				}
				break;
			}
		}
	}
	return undefined;
}

function editor(): HTMLTextAreaElement | undefined {
	return Array.from(
		document.querySelectorAll<HTMLTextAreaElement>(
			'textarea#chat-input, textarea[placeholder*="DeepSeek"], textarea[placeholder*="发送消息"], textarea[placeholder*="Message"]'
		)
	).find((element) => visible(element) && !element.disabled && !element.readOnly);
}
function stopButton(): HTMLElement | undefined {
	return Array.from(
		document.querySelectorAll<HTMLElement>(
			'[data-testid="stop-button"], [aria-label*="停止生成"], [aria-label*="Stop generating"], [title*="停止生成"], .ds-icon-button:has(#停止生成), [role="button"]:has(#停止生成)'
		)
	).find(visible);
}
function hasCompletedToolbar(markdown: HTMLElement): boolean {
	let node = markdown.parentElement;
	for (let level = 0; node && level < 4; level++, node = node.parentElement) {
		// Do not borrow controls from the composer or another conversation message.
		if (node.querySelector('textarea')) return false;
		// Do not borrow the previous turn's toolbar while the current answer is streaming.
		if (
			Array.from(node.querySelectorAll('.ds-markdown')).some(
				(block) =>
					block !== markdown && !block.closest('[data-role="reasoning"], [class*="thinking"], .ds-think-content')
			)
		)
			return false;
		if (node.querySelector('#重新生成, [aria-label*="Regenerate"], [aria-label*="重新生成"]')) return true;
		const buttons = Array.from(
			node.querySelectorAll<HTMLElement>('.ds-icon-button,button,[role="button"].ds-button')
		).filter(visible);
		// Final answer actions (copy/regenerate/feedback) appear as a toolbar. Thinking alone is insufficient.
		if (buttons.length >= 3) return true;
	}
	return false;
}
/** The attachment tray is a sibling of the editor/file-input row in the current site. */
function composer(input: HTMLTextAreaElement): HTMLElement {
	let node: HTMLElement | null = input.parentElement;
	for (let level = 0; node && level < 5; level++, node = node.parentElement) {
		if (node.querySelector('input[type="file"]')) return node.parentElement || node;
	}
	return input.closest('form') || input.parentElement!;
}
function sendButton(input: HTMLTextAreaElement): HTMLElement | undefined {
	return Array.from(
		composer(input).querySelectorAll<HTMLElement>(
			'button[type="submit"], [data-testid="send-button"], [aria-label="发送"], [aria-label="Send message"], [aria-label="Send"], [role="button"].ds-button--primary.ds-button--circle'
		)
	).find(visible);
}
const disabled = (element: HTMLElement) => element.matches(':disabled,[aria-disabled="true"],.ds-button--disabled');
async function attachImages(input: HTMLTextAreaElement, images: WebImage[], cancelled: () => boolean) {
	validateWebImages(images);
	if (!images.length) return;
	const root = composer(input),
		fileInput = root.querySelector<HTMLInputElement>('input[type="file"]');
	if (!fileInput || fileInput.disabled || (images.length > 1 && !fileInput.multiple))
		throw new Error('网页未提供可用的多图上传入口；未发送题目。');
	const transfer = new DataTransfer();
	for (const image of images) {
		const [header, base64] = image.dataUrl.split(',');
		const binary = atob(base64),
			bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		transfer.items.add(new File([bytes], image.name, { type: header.slice(5, header.indexOf(';')) }));
	}
	if (cancelled()) throw new Error('请求已取消，未上传图片。');
	fileInput.files = transfer.files;
	fileInput.dispatchEvent(new Event('change', { bubbles: true }));
	// The site clears input.files immediately. Verify every named thumbnail AND the
	// site's all-files-sendable button; never mistake a cleared input for upload success.
	const deadline = Date.now() + 90000;
	let readySince = 0;
	while (Date.now() < deadline && !cancelled()) {
		if (!input.isConnected) throw new Error('上传期间页面发生变化，未发送题目。');
		const currentRoot = composer(input),
			send = sendButton(input);
		const names = Array.from(currentRoot.querySelectorAll<HTMLImageElement>('img[alt]')).map((image) => image.alt);
		const allPresent = names.length === images.length && images.every((image) => names.includes(image.name));
		if (allPresent && send && !disabled(send)) {
			if (!readySince) readySince = Date.now();
			if (Date.now() - readySince >= 800) return;
		} else readySince = 0;
		await sleep(200);
	}
	throw new Error(
		cancelled() ? '请求已取消，未发送题目。' : '图片未全部上传成功或网页未允许发送；已停止，未发送残缺题目。'
	);
}
export const deepSeekAdapter: WebChatAdapter = {
	id: 'deepseek-web',
	supportsImages: true,
	assertEmpty() {
		this.assertReady();
		if (document.querySelector('.ds-markdown')) throw new Error('请从空白新对话启用桥接，不能接管已有聊天。');
	},
	assertReady() {
		const input = editor();
		if (!input) throw new Error('请先在此页登录 DeepSeek；当前未识别到输入框。');
		if (
			input.value.trim() ||
			composer(input).querySelector('img[alt], .ds-animated-size-item') ||
			stopButton() ||
			Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).some((el) => el.files?.length)
		)
			throw new Error('输入框有已有输入、附件或聊天仍在生成，已停止以避免混入其他内容。');
	},
	async submit(prompt, cancelled, images = []) {
		this.assertReady();
		const input = editor()!;
		const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
		if (!setter) throw new Error('浏览器无法设置网页输入框。');
		setter.call(input, prompt);
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await sleep(100);
		await attachImages(input, images, cancelled);
		if (cancelled()) throw new Error('请求已取消，未点击发送。');
		const send = sendButton(input);
		if ((send && disabled(send)) || (images.length && !send))
			throw new Error('网页尚未允许发送，已停止；不会用回车绕过附件检查。');
		// Exactly one submission attempt. Never click after Enter as a fallback: it can send twice.
		if (send) send.click();
		else {
			input.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Enter',
					code: 'Enter',
					keyCode: 13,
					which: 13,
					bubbles: true,
					cancelable: true
				})
			);
			input.dispatchEvent(
				new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })
			);
		}
		const deadline = Date.now() + 10000;
		while (Date.now() < deadline && !cancelled()) {
			if (!input.isConnected || !input.value.trim() || stopButton()) return;
			await sleep(200);
		}
		throw new Error('未能确认网页已发送；为防止重复请求不会重发。请检查专用标签页。');
	},
	readCompleted(requestId) {
		if (stopButton()) return;
		const blocks = Array.from(document.querySelectorAll<HTMLElement>('.ds-markdown')).reverse();
		for (const block of blocks) {
			if (!visible(block) || block.closest('[data-role="reasoning"], [class*="thinking"], .ds-think-content')) continue;
			const result = extractBridgeAnswer(block.innerText || block.textContent || '', requestId);
			if (result && hasCompletedToolbar(block)) return result;
		}
	},
	reset() {
		if (location.pathname === '/' && location.hash === '#xth-bridge') location.reload();
		else location.assign('https://chat.deepseek.com/#xth-bridge');
	}
};
