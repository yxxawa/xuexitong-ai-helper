/**
 * 等待视频加载并获取视频
 */
export async function waitForMedia(options?: {
	/**
	 * 视频选择器
	 */
	videoSelector?: string;
	/**
	 * 音频选择器
	 */
	audioSelector?: string;
	/**
	 * 根元素
	 */
	root?: HTMLElement | Document;
	timeout?: number;
	filter?: (video: HTMLVideoElement | HTMLAudioElement) => boolean;
	signal?: AbortSignal;
}) {
	return new Promise<HTMLVideoElement | HTMLAudioElement>((resolve, reject) => {
		let interval: ReturnType<typeof setInterval> | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let settled = false;
		const finish = (error?: unknown, media?: HTMLVideoElement | HTMLAudioElement) => {
			if (settled) return;
			settled = true;
			clearInterval(interval);
			clearTimeout(timeout);
			options?.signal?.removeEventListener('abort', abort);
			if (error) reject(error);
			else resolve(media!);
		};
		const abort = () => finish(new Error('等待视频/音频已取消。'));
		const check = () => {
			try {
				const candidates = (options?.root || document).querySelectorAll<HTMLVideoElement | HTMLAudioElement>(
					`${options?.videoSelector || 'video'},${options?.audioSelector || 'audio'}`
				);
				const media = Array.from(candidates).find((candidate) => !options?.filter || options.filter(candidate));
				if (media) finish(undefined, media);
			} catch (error) {
				finish(error);
			}
		};
		if (options?.signal?.aborted) {
			abort();
			return;
		}
		options?.signal?.addEventListener('abort', abort, { once: true });
		interval = setInterval(check, 200);
		timeout = setTimeout(() => finish(new Error('视频/音频未找到，或者加载超时。')), options?.timeout ?? 3 * 60 * 1000);
		check();
	});
}

export function waitForElement(
	selector: string | { (): HTMLElement | undefined },
	opts?: { timeout_seconds?: number; check_period_ms?: number }
) {
	return waitFor(() => {
		return typeof selector === 'function' ? selector() : document.querySelector<HTMLElement>(selector);
	}, opts);
}

export function waitFor<T>(predicate: () => T, opts?: { timeout_seconds?: number; check_period_ms?: number }) {
	return new Promise<T>((resolve, reject) => {
		let interval: ReturnType<typeof setInterval> | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const finish = (value?: T, error?: unknown) => {
			clearInterval(interval);
			clearTimeout(timeout);
			if (error) reject(error);
			else resolve(value as T);
		};
		const check = () => {
			try { const value = predicate(); if (value) finish(value); }
			catch (error) { finish(undefined, error); }
		};
		interval = setInterval(check, opts?.check_period_ms ?? 1000);
		if (opts?.timeout_seconds) timeout = setTimeout(() => finish(), opts.timeout_seconds * 1000);
		check();
	});
}

/** 中止不会被误认为任务完成。 */
export function assertStudyActive(signal?: AbortSignal) {
	if (signal?.aborted) {
		const error = new Error('学习页面已离开，当前任务已取消。');
		error.name = 'AbortError';
		throw error;
	}
}

export type StudyPhase = 'running' | 'waiting' | 'recovering' | 'confirming' | 'done' | 'error' | 'stopped';

const studyControls = new WeakMap<AbortSignal, StudyControl>();

/** One control owns the chapter, its media, waits and navigation. */
export class StudyControl {
	private controller = new AbortController();
	private listeners = new Set<() => void>();
	private pausedAt: number | undefined;
	private pausedTotal = 0;
	readonly signal = this.controller.signal;
	phase: StudyPhase = 'running';
	detail = '正在查找课程任务';
	readonly history: string[] = [];
	constructor() { studyControls.set(this.signal, this); }
	get paused() { return this.pausedAt !== undefined; }
	get activeTime() { return Date.now() - this.pausedTotal - (this.pausedAt === undefined ? 0 : Date.now() - this.pausedAt); }
	subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
	private notify() { for (const listener of this.listeners) listener(); }
	pause() {
		if (this.signal.aborted || this.paused || this.phase === 'done' || this.phase === 'error') return;
		this.pausedAt = Date.now(); this.notify();
	}
	resume() {
		if (this.pausedAt === undefined || this.signal.aborted) return;
		this.pausedTotal += Date.now() - this.pausedAt;
		this.pausedAt = undefined; this.notify();
	}
	setStatus(phase: StudyPhase, detail: string) {
		if (this.signal.aborted || (this.phase === phase && this.detail === detail)) return;
		this.phase = phase; this.detail = detail;
		this.history.push(new Date().toLocaleTimeString() + ' ' + detail);
		if (this.history.length > 30) this.history.shift();
		this.notify();
	}
	stop() { this.setStatus('stopped', '学习已停止'); this.dispose(); }
	dispose() { this.controller.abort(); this.listeners.clear(); }
}

export function studyControl(signal?: AbortSignal) { return signal ? studyControls.get(signal) : undefined; }
export function studyActiveTime(signal?: AbortSignal) { return studyControl(signal)?.activeTime ?? Date.now(); }
export function studyPaused(signal?: AbortSignal) { return studyControl(signal)?.paused ?? false; }
export function studyStatus(signal: AbortSignal | undefined, phase: StudyPhase, detail: string) {
	studyControl(signal)?.setStatus(phase, detail);
}

function studyDelay(ms: number, signal?: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		assertStudyActive(signal);
		const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
		const abort = () => { finish(); try { assertStudyActive(signal); } catch (error) { reject(error); } };
		const timer = setTimeout(() => { finish(); resolve(); }, ms);
		signal?.addEventListener('abort', abort, { once: true });
	});
}

export async function studyCheckpoint(signal?: AbortSignal) {
	assertStudyActive(signal);
	while (studyPaused(signal)) await studyDelay(200, signal);
	assertStudyActive(signal);
}

export async function studySleep(ms: number, signal?: AbortSignal) {
	if (!studyControl(signal)) return studyDelay(ms, signal);
	const until = studyActiveTime(signal) + ms;
	do {
		await studyCheckpoint(signal);
		const remaining = until - studyActiveTime(signal);
		if (remaining <= 0) return;
		await studyDelay(Math.min(200, remaining), signal);
	} while (true);
}

/** Newer catalogs use an explicit completed icon instead of a hidden count. */
export function studyChapterRemaining(chapter: Element | null) {
	const raw = chapter?.querySelector<HTMLInputElement>('.jobUnfinishCount')?.value.trim();
	if (raw !== undefined) return /^\d+$/.test(raw) ? Number(raw) : NaN;
	return chapter?.querySelector('.icon_Completed') ? 0 : NaN;
}

/** Only positive platform evidence counts as completion; absence is unknown. */
export function studyTaskComplete(frame: HTMLIFrameElement, attachment?: { isPassed?: boolean }) {
	if (attachment?.isPassed === true) return true;
	let current: Element | null = frame;
	while (current) {
		const card = current.closest('.ans-attach-ct');
		if (card) return card.classList.contains('ans-job-finished');
		try { current = current.ownerDocument.defaultView?.frameElement || null; } catch { return false; }
	}
	return false;
}

export async function waitForStudyCompletion(check: () => boolean, signal?: AbortSignal, timeout = 30000) {
	studyStatus(signal, 'confirming', '等待平台更新任务完成标记');
	const startedAt = studyActiveTime(signal);
	while (true) {
		await studyCheckpoint(signal);
		if (check()) return;
		if (studyActiveTime(signal) - startedAt >= timeout) {
			throw new Error('平台尚未确认任务完成，已停止自动跳转；请检查任务标记后重试。');
		}
		await studySleep(500, signal);
	}
}

export interface StudyAttachment {
	jobid?: string | number;
	property?: { _jobid?: string | number };
}

/** 按 jobid 去重，避免相同 mid 的不同任务互相覆盖。 */
export function studyJobId(attachment: StudyAttachment) {
	return String(attachment.jobid || attachment.property?._jobid || '');
}

/** 兼容嵌套 frame，隔离坏 JSON 与跨域读取。 */
export function findStudyAttachment<T extends StudyAttachment>(frame: HTMLIFrameElement, attachments: T[]): T | undefined {
	const visited = new Set<Element>();
	let current: Element | null = frame;
	while (current && !visited.has(current)) {
		visited.add(current);
		try {
			const data = JSON.parse(current.getAttribute('data') || '{}');
			const id = data && String(data.jobid || data._jobid || '');
			const attachment = id && attachments.find((item) => studyJobId(item) === id);
			if (attachment) return attachment;
		} catch { /* Incomplete or cross-origin frame. */ }
		try { current = current.ownerDocument.defaultView?.frameElement || null; }
		catch { break; }
	}
}

export function searchStudyFrames(root: Document) {
	const queue = Array.from(root.querySelectorAll('iframe'));
	const result: HTMLIFrameElement[] = [];
	const visited = new Set<HTMLIFrameElement>();
	while (queue.length) {
		const frame = queue.shift()!;
		if (visited.has(frame)) continue;
		visited.add(frame);
		try {
			const doc = frame.contentWindow?.document;
			if (!doc) continue;
			result.push(frame);
			queue.push(...Array.from(doc.querySelectorAll('iframe')));
		} catch { /* Incomplete or cross-origin frame. */ }
	}
	return result;
}

/** 等待实际任务挂载，不把附件数量当作轮询次数扣减。 */
export async function runStudyJobs(options: {
	discover: () => { func?: () => Promise<unknown> } | undefined;
	snapshot: () => { ready: boolean; signature: string; pending: string[] };
	signal?: AbortSignal;
	timeout?: number;
	settle?: number;
}) {
	let changedAt = studyActiveTime(options.signal);
	let signature: string | undefined;
	while (true) {
		await studyCheckpoint(options.signal);
		const job = options.discover();
		if (job) {
			await job.func?.();
			assertStudyActive(options.signal);
			changedAt = studyActiveTime(options.signal);
			await studySleep(250, options.signal);
			continue;
		}
		const snapshot = options.snapshot();
		if (snapshot.signature !== signature) {
			signature = snapshot.signature;
			changedAt = studyActiveTime(options.signal);
		}
		const elapsed = studyActiveTime(options.signal) - changedAt;
		if (snapshot.ready && snapshot.pending.length === 0 && elapsed >= (options.settle ?? 3000)) return;
		if (elapsed >= (options.timeout ?? 30000)) {
			throw new Error(snapshot.ready
				? `仍有 ${snapshot.pending.length} 个任务未加载或无法识别，已暂停自动跳转，请检查页面后刷新。`
				: '任务列表加载超时，已暂停自动跳转，请检查网络后刷新。');
		}
		await studySleep(250, options.signal);
	}
}

export function isStudyElementVisible(element: HTMLElement | null | undefined) {
	if (!element?.isConnected || !element.getClientRects().length) return false;
	const style = element.ownerDocument.defaultView?.getComputedStyle(element);
	return style?.display !== 'none' && style?.visibility !== 'hidden' && style?.visibility !== 'collapse';
}

export function studyReaderTiming(src: string, base: string) {
	const value = Number(new URL(src || '.', base).searchParams.get('timing') || 60);
	return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 60;
}
