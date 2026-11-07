import { assertStudyActive, studyControl, studyPaused, studyStatus } from './study';

function muteStudyVideo(media: HTMLMediaElement) {
	// Course players can belong to a different iframe realm.
	if (media.tagName.toLowerCase() !== 'video') return;
	if (!media.muted) media.muted = true;
	if (media.volume !== 0) media.volume = 0;
}

/** Use the same settings policy for playback and live configuration changes. */
export function applyStudyMediaSettings(media: HTMLMediaElement, settings: { playbackRate: number; volume: number }) {
	if (media.tagName.toLowerCase() === 'video') muteStudyVideo(media);
	else {
		// Range controls in existing installs store their value as a string.
		const volume = Number(settings.volume);
		media.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
	}
	const { playbackRate } = settings;
	media.playbackRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
}

/** Serialize playback, recover transient failures, and release every listener on exit. */
export function runStudyMedia(media: HTMLMediaElement, options: {
	signal?: AbortSignal;
	settings: () => { playbackRate: number; volume: number };
	play: (play: () => Promise<void>, signal: AbortSignal) => Promise<boolean>;
	beforePlay?: (signal: AbortSignal) => Promise<void>;
	isBlocked?: () => boolean;
	onTick?: () => void;
	findMedia?: () => HTMLMediaElement | undefined;
	onMediaChange?: (media: HTMLMediaElement) => void;
	maxRecoveries?: number;
	recoveryDelay?: number;
	stallTimeout?: number;
}) {
	return new Promise<void>((resolve, reject) => {
		assertStudyActive(options.signal);
		let finished = false, busy = false, waiting = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let poll: ReturnType<typeof setInterval> | undefined;
		let attempt: AbortController | undefined;
		let lastTime = media.currentTime, progressAt = Date.now(), lastPollAt = Date.now();
		let recoveryAt: number | undefined, recoveries = 0, restorePosition: number | undefined;
		const maxRecoveries = options.maxRecoveries ?? 2;
		const view = media.ownerDocument.defaultView;
		let unsubscribe: (() => void) | undefined;
		const keepMuted = () => muteStudyVideo(media);
		const detach = () => {
			media.removeEventListener('pause', resume);
			media.removeEventListener('ended', ended);
			media.removeEventListener('error', failed);
			media.removeEventListener('volumechange', keepMuted);
		};
		const attach = () => {
			media.addEventListener('pause', resume);
			media.addEventListener('ended', ended);
			media.addEventListener('error', failed);
			media.addEventListener('volumechange', keepMuted);
			keepMuted();
		};
		const finish = (error?: unknown) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer); clearInterval(poll); detach(); unsubscribe?.();
			view?.removeEventListener('pagehide', leave);
			options.signal?.removeEventListener('abort', leave);
			attempt?.abort();
			if (error) {
				try { media.pause(); } catch { /* Detached player. */ }
				reject(error);
			} else resolve();
		};
		const leave = () => finish(new Error('播放页面已离开或学习已停止，已取消当前任务。'));
		const ended = () => finish();
		const blocked = () => studyPaused(options.signal) || !!options.isBlocked?.();
		const recover = (reason: string) => {
			if (finished || recoveryAt !== undefined) return;
			if (recoveries >= maxRecoveries) { finish(new Error(reason + '；自动恢复未成功，请检查后重试。')); return; }
			recoveries++;
			recoveryAt = Date.now() + (options.recoveryDelay ?? 1500);
			restorePosition = restorePosition ?? lastTime;
			clearTimeout(timer); timer = undefined;
			attempt?.abort(); attempt = undefined; busy = waiting = false;
			try { media.pause(); } catch { /* Detached player. */ }
			studyStatus(options.signal, 'recovering', `${reason}，正在恢复播放（${recoveries}/${maxRecoveries}）`);
		};
		const failed = () => {
			const code = media.error?.code;
			// Offline source requests can surface as MEDIA_ERR_SRC_NOT_SUPPORTED (4).
			if (view?.navigator.onLine === false || code === 1 || code === 2) recover(`音视频加载失败（错误码 ${code}）`);
			else finish(new Error(`音视频加载失败（错误码 ${code || '未知'}），请检查网络或手动播放。`));
		};
		const applySettings = () => applyStudyMediaSettings(media, options.settings());
		const start = async () => {
			timer = undefined;
			if (finished || busy || recoveryAt !== undefined || studyPaused(options.signal) || view?.navigator.onLine === false) return;
			busy = true;
			const current = new AbortController(); attempt = current;
			try {
				waiting = true;
				await options.beforePlay?.(current.signal);
				waiting = false;
				if (finished || current.signal.aborted || blocked()) return;
				applySettings();
				const playing = await options.play(async () => {
					assertStudyActive(current.signal);
					if (blocked()) return;
					try { await media.play(); }
					catch (error) {
						assertStudyActive(current.signal);
						// DOMException may originate in the player's frame.
						if (typeof error !== 'object' || error === null || !('name' in error) || error.name !== 'AbortError') throw error;
					}
				}, current.signal);
				if (!finished && !current.signal.aborted) {
					if (!playing) throw new Error('视频无法播放，请手动播放或点击重试。');
					applySettings();
				}
			} catch (error) { if (!current.signal.aborted) finish(error); }
			finally { if (attempt === current) { busy = waiting = false; attempt = undefined; } }
		};
		const resume = () => {
			if (!finished && !busy && !studyPaused(options.signal) && recoveryAt === undefined && timer === undefined && !media.ended) {
				timer = setTimeout(() => { void start(); }, 200);
			}
		};
		attach();
		view?.addEventListener('pagehide', leave);
		options.signal?.addEventListener('abort', leave, { once: true });
		let wasPaused = studyPaused(options.signal);
		unsubscribe = studyControl(options.signal)?.subscribe(() => {
			const paused = studyPaused(options.signal);
			if (paused === wasPaused) return;
			wasPaused = paused;
			if (paused) {
				clearTimeout(timer); timer = undefined;
				attempt?.abort(); attempt = undefined; busy = waiting = false;
				media.pause();
			} else { progressAt = Date.now(); resume(); }
		});
		poll = setInterval(() => {
			try {
				const now = Date.now();
				// Background suspension is not evidence that the player has failed.
				if (now - lastPollAt > 5000) progressAt = now;
				lastPollAt = now;
				if (studyPaused(options.signal)) { progressAt = now; if (!media.paused) media.pause(); return; }
				options.onTick?.();
				if (finished) return;
				if (options.isBlocked?.()) { progressAt = now; studyStatus(options.signal, 'waiting', '等待页面题目或验证处理完成'); return; }
				if (view?.navigator.onLine === false) { progressAt = now; studyStatus(options.signal, 'waiting', '网络已断开，等待连接恢复'); return; }
				if (!media.isConnected) {
					if (!options.findMedia) throw new Error('播放器已被页面替换，请刷新后重试。');
					recover('播放器已更新');
				}
				if (finished) return;
				if (recoveryAt !== undefined) {
					if (now < recoveryAt) return;
					const replacement = options.findMedia?.();
					if (!media.isConnected && !replacement?.isConnected) {
						if (now - recoveryAt > 10000) throw new Error('更新后的播放器未能加载，请重试。');
						return;
					}
					if (replacement && replacement !== media) {
						detach(); media = replacement; attach(); options.onMediaChange?.(media);
						// The replacement player may already have restored its native resume position.
						if (media.currentTime > 0) restorePosition = undefined;
					} else media.load();
					recoveryAt = undefined; progressAt = now; lastTime = media.currentTime;
					resume(); return;
				}
				if (media.error) { failed(); return; }
				if (restorePosition !== undefined && media.readyState >= 1) {
					if (restorePosition > 0 && Number.isFinite(media.duration) && restorePosition < media.duration) media.currentTime = restorePosition;
					restorePosition = undefined;
				}
				if (media.currentTime !== lastTime || waiting) { lastTime = media.currentTime; progressAt = now; }
				if (now - progressAt >= (options.stallTimeout ?? 120000)) { recover('音视频长时间没有播放进展'); return; }
				if (media.paused) resume();
				studyStatus(options.signal, 'running', media.paused ? '正在恢复视频播放' : '正在播放课程视频/音频');
			} catch (error) { finish(error); }
		}, 1000);
		try {
			if (media.error) { failed(); return; }
			if (media.ended) media.currentTime = 0;
			resume();
		} catch (error) { finish(error); }
	});
}
