import { assertStudyActive, isStudyElementVisible, studyActiveTime, studyReaderTiming, studySleep } from './study';

type ReaderWindow = Window & {
	readweb?: { goto: (page: number) => void };
	epage?: number | string;
	require?: (modules: string[], ready: (reader: { goPage?: unknown }) => void) => void;
};

/** Reader callbacks and delays belong to the reading page and end when it leaves. */
export async function runStudyReader(win: ReaderWindow, signal: AbortSignal, enabled: () => boolean) {
	const check = () => {
		assertStudyActive(signal);
		if (!enabled()) {
			const error = new Error('自动阅读已关闭。');
			error.name = 'AbortError';
			throw error;
		}
	};
	const wait = async (ms: number) => { check(); await studySleep(ms, signal); check(); };
	const until = async <T>(read: () => T) => {
		const start = studyActiveTime(signal);
		while (true) {
			check();
			const value = read();
			if (value) return value;
			if (studyActiveTime(signal) - start >= 30000) throw new Error('阅读器加载超时，请刷新或手动阅读。');
			await wait(250);
		}
	};
	const doc = win.document;
	await until(() => doc.querySelector('#reader') || win.readweb?.goto);
	if (!doc.querySelector('#reader')) {
		await wait(5000);
		const lastPage = Number(win.epage);
		if (!win.readweb?.goto || !Number.isInteger(lastPage) || lastPage < 1) {
			throw new Error('阅读页码未就绪，请刷新或手动阅读。');
		}
		win.readweb.goto(lastPage);
		return;
	}

	const load = await until(() => typeof win.require === 'function' ? win.require : undefined);
	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer); signal.removeEventListener('abort', abort);
			if (error) reject(error); else resolve();
		};
		const abort = () => { try { assertStudyActive(signal); } catch (error) { finish(error as Error); } };
		const timer = setTimeout(() => finish(new Error('阅读器初始化超时，请刷新或手动阅读。')), 30000);
		signal.addEventListener('abort', abort, { once: true });
		try {
			check();
			load.call(win, ['reader'], (reader) => {
				if (settled) return;
				try {
					check();
					finish(reader?.goPage ? undefined : new Error('阅读器接口未就绪，请手动阅读。'));
				} catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
			});
		} catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
	});
	const pageJump = () => {
		const select = doc.querySelector<HTMLSelectElement>('#pagejump');
		return select && ['5', '7'].every((page) => Array.from(select.options).some((option) => option.value === page)) ? select : undefined;
	};
	await until(() => pageJump() && doc.querySelector('.readerPager'));
	await wait(3000);
	const timing = (studyReaderTiming(win.location.href, doc.baseURI) + 3) * 1000;
	for (const page of ['5', '7']) {
		await wait(timing);
		const select = pageJump();
		if (!select?.isConnected) throw new Error('阅读页码已变化，请手动阅读。');
		select.value = page;
		select.dispatchEvent(new Event('change', { bubbles: true }));
	}
	await wait(timing);
	const visible = Array.from(doc.querySelectorAll<HTMLElement>('.readerPager')).filter(isStudyElementVisible);
	const pager = visible.find((el) => win.getComputedStyle(el).zIndex === '101') || (visible.length === 1 ? visible[0] : undefined);
	if (!pager) throw new Error('未找到可用的阅读翻页按钮，请手动阅读。');
	pager.click();
}