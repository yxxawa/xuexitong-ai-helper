import { assertStudyActive } from './study';

/** Serialize playback requests and clean up on every terminal path. */
export function runStudyMedia(media: HTMLMediaElement, options: {
	signal?: AbortSignal;
	settings: () => { playbackRate: number; volume: number };
	play: (play: () => Promise<void>, signal: AbortSignal) => Promise<boolean>;
	beforePlay?: (signal: AbortSignal) => Promise<void>;
	isBlocked?: () => boolean;
	onTick?: () => void;
	stallTimeout?: number;
}) {
	return new Promise<void>((resolve, reject) => {
		assertStudyActive(options.signal);
		const controller = new AbortController();
		let finished = false;
		let busy = false;
		let waiting = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let poll: ReturnType<typeof setInterval> | undefined;
		let lastTime = media.currentTime;
		let progressAt = Date.now();
		const view = media.ownerDocument.defaultView;
		const finish = (error?: unknown) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			clearInterval(poll);
			media.removeEventListener('pause', resume);
			media.removeEventListener('ended', ended);
			media.removeEventListener('error', failed);
			view?.removeEventListener('pagehide', leave);
			options.signal?.removeEventListener('abort', leave);
			controller.abort();
			if (error) {
				try { media.pause(); } catch { /* A removed player may no longer expose its native API. */ }
				reject(error);
			}
			else resolve();
		};
		const leave = () => finish(new Error('播放页面已离开，已取消当前任务。'));
		const ended = () => finish();
		const failed = () => finish(new Error(`音视频加载失败（错误码 ${media.error?.code || '未知'}），请检查网络或手动播放。`));
		const applySettings = () => {
			const { playbackRate, volume } = options.settings();
			media.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
			media.playbackRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
		};
		const start = async () => {
			timer = undefined;
			if (finished || busy) return;
			busy = true;
			try {
				waiting = true;
				await options.beforePlay?.(controller.signal);
				waiting = false;
				if (finished || options.isBlocked?.()) return;
				applySettings();
				const playing = await options.play(async () => {
					assertStudyActive(controller.signal);
					await media.play();
				}, controller.signal);
				if (!finished) {
					if (!playing) throw new Error('视频无法播放，请手动播放后刷新页面重试。');
					applySettings();
				}
			} catch (error) { finish(error); }
			finally { busy = false; waiting = false; }
		};
		const resume = () => {
			if (!finished && !busy && timer === undefined && !media.ended) {
				timer = setTimeout(() => { void start(); }, 200);
			}
		};
		media.addEventListener('pause', resume);
		media.addEventListener('ended', ended);
		media.addEventListener('error', failed);
		view?.addEventListener('pagehide', leave);
		options.signal?.addEventListener('abort', leave, { once: true });
		poll = setInterval(() => {
			try {
				if (!media.isConnected) throw new Error('播放器已被页面替换，请刷新后重试。');
				if (media.error) { failed(); return; }
				options.onTick?.();
				if (finished) return;
				if (media.currentTime !== lastTime || waiting || options.isBlocked?.()) {
					lastTime = media.currentTime;
					progressAt = Date.now();
				}
				if (Date.now() - progressAt >= (options.stallTimeout ?? 120000)) {
					throw new Error('音视频连续 2 分钟没有播放进展，已暂停自动跳转，请检查网络或手动播放。');
				}
				if (media.paused) resume();
			} catch (error) { finish(error); }
		}, 1000);
		// Preserve the resume position unless this is already-ended media.
		try {
			if (media.error) { failed(); return; }
			if (media.ended) media.currentTime = 0;
			resume();
		} catch (error) { finish(error); }
	});
}
