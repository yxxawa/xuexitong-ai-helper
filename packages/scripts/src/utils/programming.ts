/** CodeMirror 5 is the platform's program editor; its input textarea is not the answer model. */
export interface ProgramEditor {
	getValue(): string;
	setValue(value: string): void;
	getOption(name: string): unknown;
	getTextArea?(): HTMLTextAreaElement;
	getWrapperElement?(): HTMLElement;
	replaceSelection(value: string, select?: string, origin?: string): void;
	save?(): void;
}
export interface ProgramPageWindow {
	document?: Document;
	codeEditors?: Record<string, ProgramEditor>;
}
type EditorElement = HTMLElement & { CodeMirror?: ProgramEditor };

/** Strip only an enclosing Markdown fence. Code indentation, comments and operators are literal. */
export function normalizeProgramAnswer(value: string): string {
	const text = String(value ?? '').replace(/\r\n?/g, '\n');
	const fenced = text.match(/^[ \t\n]*(\x60{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1[ \t\n]*$/);
	return fenced ? fenced[2] : text;
}

export function getProgramEditor(root: HTMLElement, pageWindow?: ProgramPageWindow) {
	const source = root.querySelector<HTMLTextAreaElement>('textarea.code-editor');
	const wrapper = (root.matches('.CodeMirror') ? root : root.querySelector('.CodeMirror')) as EditorElement | null;
	const id =
		source?.getAttribute('data-business-id') ||
		root.querySelector('.proceduralQue')?.getAttribute('data') ||
		(root.matches('.proceduralQue') ? root.getAttribute('data') : '') ||
		root.querySelector<HTMLInputElement>('input[id^="answertype"]')?.id.replace(/^answertype/, '') ||
		'';
	const page = pageWindow || (root.ownerDocument.defaultView as ProgramPageWindow | null);
	const editor = page?.codeEditors?.[id] || wrapper?.CodeMirror;
	const text = editor?.getTextArea?.() || source;
	return { editor, wrapper: editor?.getWrapperElement?.() || wrapper, text, id };
}

export function programLanguage(root: HTMLElement): string {
	const selected = root.querySelector<HTMLElement>('.selectBoxLang, .langList');
	return (
		selected?.getAttribute('codename') ||
		selected?.querySelector('p')?.textContent?.trim() ||
		root.querySelector<HTMLElement>('.code-language')?.textContent?.trim() ||
		''
	);
}

function writable(root: HTMLElement, editor: ProgramEditor, text?: HTMLTextAreaElement | null) {
	return (
		root.isConnected &&
		!root.matches('[aria-disabled="true"]') &&
		!root.closest('fieldset[disabled]') &&
		!editor.getOption('readOnly') &&
		!text?.readOnly &&
		!text?.disabled
	);
}
function changed(element: HTMLInputElement | HTMLTextAreaElement) {
	const EventType = element.ownerDocument.defaultView!.Event;
	element.dispatchEvent(new EventType('input', { bubbles: true }));
	element.dispatchEvent(new EventType('change', { bubbles: true }));
}
/** Same encoding as the platform's setProceduralAnswer(), scoped to this question. */
function programSavedValue(root: HTMLElement, id: string, code: string) {
	const input = root.querySelector<HTMLInputElement>('input[id="answer' + id + '"]');
	if (!input) return;
	const languageField = root.querySelector<HTMLInputElement>('.languageSelect, input[id^="languageSelect"]');
	let previous: Record<string, unknown> = {};
	try {
		previous = JSON.parse(input.value)?.[0] || {};
	} catch {
		/* Initial empty field. */
	}
	const language = Number(languageField?.value || previous.language);
	if (!Number.isInteger(language) || language < 0) throw new Error('请先选择程序语言，再填写代码。');
	const pre = root.ownerDocument.createElement('pre');
	pre.className = 'line-numbers hover newProcedure';
	const node = root.ownerDocument.createElement('code');
	node.className = 'language-plain';
	node.setAttribute('lang', 'Plain Text');
	node.textContent = code;
	pre.append(node);
	const entities: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" };
	const answerTxt = code.replace(/&(?:lt|gt|amp|quot|#39);/g, (value) => entities[value]);
	return { input, value: JSON.stringify([{ ...previous, language, answer: pre.outerHTML, answerTxt }]) };
}
function syncProgramAnswer(root: HTMLElement, pageWindow?: ProgramPageWindow) {
	const { editor, text, id } = getProgramEditor(root, pageWindow);
	if (!editor) throw new Error('程序题编辑器尚未加载，请等待后重试。');
	editor.save?.();
	if (text) {
		text.value = editor.getValue();
		changed(text);
	}
	const saved = programSavedValue(root, id, editor.getValue());
	if (saved) {
		saved.input.value = saved.value;
		changed(saved.input);
	}
}
export function readProgrammingAnswer(root: HTMLElement, pageWindow?: ProgramPageWindow): string | undefined {
	const value = getProgramEditor(root, pageWindow).editor?.getValue();
	return value?.trim() ? value : undefined;
}

export function writeProgrammingAnswer(root: HTMLElement, answer: string, pageWindow?: ProgramPageWindow) {
	const code = normalizeProgramAnswer(answer);
	const { editor, text } = getProgramEditor(root, pageWindow);
	if (!editor) throw new Error('程序题编辑器尚未加载，请等待后重试。');
	if (!writable(root, editor, text)) throw new Error('程序题输入框不可编辑，未标记为完成。');
	if (!code.trim()) throw new Error('程序题答案为空，未标记为完成。');
	// Validate the language and saved-field shape before changing the visible editor.
	programSavedValue(root, getProgramEditor(root, pageWindow).id, code);
	editor.setValue(code);
	syncProgramAnswer(root, pageWindow);
	const saved = programSavedValue(root, getProgramEditor(root, pageWindow).id, code);
	if (
		!root.isConnected ||
		getProgramEditor(root, pageWindow).editor !== editor ||
		editor.getValue() !== code ||
		(text && text.value !== code) ||
		(saved && saved.input.value !== saved.value)
	)
		throw new Error('未能确认程序题已保存完整代码，请检查本题后重试。');
}

/** Intercept this editor's native clipboard event, then use its public editing API.
 * No async Clipboard API/HTTPS permission is needed, and other beforeChange validation stays installed. */
export function enableProgrammingPaste(root: Document | HTMLElement, pageWindow?: ProgramPageWindow): number {
	let count = 0;
	for (const wrapper of Array.from(root.querySelectorAll<EditorElement>('.CodeMirror'))) {
		if (wrapper.dataset.xthProgrammingPaste === '1') continue;
		const question =
			wrapper.closest<HTMLElement>('.questionLi, .TiMu') ||
			wrapper.closest<HTMLElement>('.proceduralQue') ||
			wrapper.parentElement;
		if (
			!question ||
			(!question.querySelector('textarea.code-editor, .proceduralQue') && !question.matches('.proceduralQue'))
		)
			continue;
		const { editor, text } = getProgramEditor(question, pageWindow);
		if (!editor || !editor.replaceSelection) continue;
		wrapper.addEventListener(
			'paste',
			(event: ClipboardEvent) => {
				if (!event.clipboardData || !writable(question, editor, text)) return;
				const value = event.clipboardData.getData('text/plain');
				if (!value) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				// A distinct origin bypasses only the site's origin === 'paste' restriction and retains undo history.
				editor.replaceSelection(value.replace(/\r\n?/g, '\n'), 'end', 'xth-paste');
				syncProgramAnswer(question, pageWindow);
			},
			true
		);
		wrapper.dataset.xthProgrammingPaste = '1';
		count++;
	}
	return count;
}

/** Question pagination and delayed editor construction must also receive paste support. */
export function watchProgrammingPaste(root: Document, pageWindow?: ProgramPageWindow): () => void {
	enableProgrammingPaste(root, pageWindow);
	const view = root.defaultView;
	if (!view || !root.documentElement) return () => {};
	const observer = new view.MutationObserver((records) => {
		if (
			records.some((record) =>
				Array.from(record.addedNodes).some(
					(node) =>
						node.nodeType === 1 &&
						((node as Element).matches('.CodeMirror') || (node as Element).querySelector('.CodeMirror'))
				)
			)
		)
			enableProgrammingPaste(root, pageWindow);
	});
	observer.observe(root.documentElement, { childList: true, subtree: true });
	const hide = (event: PageTransitionEvent) => {
		if (!event.persisted) stop();
	};
	const stop = () => {
		observer.disconnect();
		view.removeEventListener('pagehide', hide);
	};
	view.addEventListener('pagehide', hide);
	return stop;
}
