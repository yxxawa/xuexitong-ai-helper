import { assertQuestionReviewIdle } from './answer-review';
import {
	acquireWebActivity,
	getWebActivity,
	webActivityMessage,
	watchWebActivity,
	type WebActivityLease
} from './web-activity';
import { getQuestionImageURL } from './question';
import type { SimplifyWorkResult, WorkerEvents, WorkResult } from '@xuexitong-ai-helper/core/src/core/worker/interface';
import { $ui, $message, MessageElement, Script, h, CommonEventEmitter, cors } from 'easy-us';
import { CommonProject } from '../projects/common';
import { CommonWorkOptions, workPreCheckMessage } from '.';
import { hasAnswerProvider } from './ai';

export let globalControlPanel: HTMLElement | null = null;

/**
 * 通用作业考试工具方法
 */
export function commonWork(
	script: Script,
	options: {
		start_delay_seconds?: number;
		enable_control_panel?: boolean;
		workerProvider: (opts: CommonWorkOptions) => CommonEventEmitter<WorkerEvents> | undefined;
		beforeRunning?: () => void | Promise<void>;
		onRestart?: () => void | Promise<void>;
		onWorkerCreated?: (worker: CommonEventEmitter<WorkerEvents>) => void | Promise<void>;
	}
) {
	let worker: CommonEventEmitter<WorkerEvents> | undefined;

	/**
	 * 是否已经按下了开始按钮
	 */
	let startBtnPressed = false;
	/**
	 * 是否检查失败
	 */
	let checkFailed = false;

	/**
	 * 是否正在运行
	 */
	let running = false;
	let starting = false;
	let activity: WebActivityLease | undefined;
	globalControlPanel = null;

	/** 显示答题控制按钮 */
	const createWorkControlPanel = () => {
		const { completeBtn, controlBtn, restartBtn, startBtn } = createWorkerControl({
			workerProvider: () => worker,
			activityId: () => activity?.id,
			onStart: async () => {
				startBtnPressed = true;
				if (checkMessage instanceof MessageElement) {
					checkMessage.remove();
				}
				await closeAIConfigEmptyWarning();
				return start();
			},
			onRestart: () => start(undefined, true),
			onCompleteUnfinished: () => start(undefined, true, true)
		});

		startBtn.style.flex = '1';
		startBtn.style.padding = '4px';
		restartBtn.style.flex = '1';
		restartBtn.style.padding = '4px';
		completeBtn.style.flex = '1.2';
		completeBtn.style.padding = '4px';
		controlBtn.style.flex = '1';
		controlBtn.style.padding = '4px';

		const container = h(
			'div',
			{ style: { marginTop: '12px', display: 'flex', gap: '6px' } },
			running ? [controlBtn, completeBtn, restartBtn] : [startBtn, completeBtn]
		);

		globalControlPanel = container;

		return { container, startBtn, restartBtn, controlBtn };
	};
	const workResultPanel = () => CommonProject.scripts.workResults.methods.createWorkResultsPanel();

	const sync_script = [script];
	if (options.enable_control_panel) {
		sync_script.push(CommonProject.scripts.workResults);
	}

	const renderPanels: (() => void)[] = [];
	for (const script of sync_script) {
		const renderPanel = () => {
			let gotoSettingsBtnContainer: string | HTMLElement = '';
			if (checkFailed) {
				const gotoSettingsBtn = $ui.button('👉 前往AI设置', {
					className: 'base-style-button',
					style: { flex: '1', padding: '4px' }
				});
				gotoSettingsBtn.style.flex = '1';
				gotoSettingsBtn.style.padding = '4px';
				gotoSettingsBtn.onclick = () => {
					CommonProject.scripts.render.methods.pin(CommonProject.scripts.settings);
				};
				gotoSettingsBtnContainer = h('div', { style: { display: 'flex' } }, [gotoSettingsBtn]);
			}

			script.panel?.body?.replaceChildren(
				h('div', { style: { marginTop: '12px' } }, [
					gotoSettingsBtnContainer,
					...(options.enable_control_panel ? [createWorkControlPanel().container] : []),
					workResultPanel()
				])
			);
		};
		script.on('render', renderPanel);
		renderPanels.push(renderPanel);
	}

	const getWorkOptions = () => CommonProject.scripts.settings.methods.getWorkOptions();

	/**
	 * 检查 AI 是否配置，并询问是否开始答题
	 */
	let checkMessage = workPreCheckMessage({
		onrun: () => startBtnPressed === false && start(),
		onclose: (_, closedMsg) => (checkMessage = closedMsg),
		onNoAIConfig: () => {
			checkFailed = true;
		},
		...getWorkOptions(),
		start_delay_seconds: options.start_delay_seconds
	});

	['aiApiUrl', 'aiApiKey', 'aiModel', 'aiProvider'].forEach((key) => {
		(CommonProject.scripts.settings as any).onConfigChange(key, () => {
			if (hasAnswerProvider(getWorkOptions())) {
				checkFailed = false;
				closeAIConfigEmptyWarning();
				if (checkMessage instanceof MessageElement) {
					checkMessage.remove();
				}
			}
		});
	});

	const start = async (questionIndexes?: number[], replace = false, unfinished = false) => {
		if (starting || (running && !replace)) return;
		starting = true;
		try {
			assertQuestionReviewIdle();
			if (replace) {
				if (running) $message.info('正在停止；等待已发出的请求返回后重启，避免重复请求。');
				worker?.emit('close');
				// Let an already sent request settle before replacing its worker; do not send it twice.
				await (worker as any)?.waitForIdle?.();
				running = false;

				await options.onRestart?.();
			}
			const workOptions: CommonWorkOptions = {
				...getWorkOptions(),
				questionIndexes,
				appendOnly: Boolean(questionIndexes?.length),
				forceAnswer: replace && !unfinished
			};
			if (!hasAnswerProvider(workOptions)) {
				checkFailed = true;
				aiConfigEmptyWarning(0);
				return;
			}
			checkFailed = false;
			await closeAIConfigEmptyWarning();
			await options.beforeRunning?.();
			if (workOptions.aiProvider === 'deepseek-web' && !activity) activity = await acquireWebActivity('work');
			workOptions.webActivityId = activity?.id;
			activity?.assertActive();
			running = true;
			worker = options.workerProvider(workOptions);
			const currentWorker = worker;
			const { container, controlBtn } = createWorkControlPanel();
			script.panel?.body?.replaceChildren(container, workResultPanel());
			worker?.once('done', () => {
				if (worker !== currentWorker) return;
				running = false;
				if (!starting) {
					activity?.release();
					activity = undefined;
				}
				globalControlPanel = null;
				controlBtn.disabled = true;
			});
			if (worker) await options.onWorkerCreated?.(worker);
			else running = false;
		} catch (error) {
			running = false;
			$message.error(error instanceof Error ? error.message : String(error));
		} finally {
			starting = false;
			if (!running) {
				activity?.release();
				activity = undefined;
			}
		}
	};
	// Register render handlers BEFORE pinning; otherwise the initial render is missed.
	CommonProject.scripts.render.methods.pin(script);
	renderPanels[0]?.();
}

/**
 * 答题控制
 */
export function createWorkerControl(options: {
	workerProvider: () => CommonEventEmitter<WorkerEvents> | undefined;
	onStart: () => void | Promise<void>;
	onRestart: () => void | Promise<void>;
	onCompleteUnfinished: () => void | Promise<void>;
	activityId?: () => string | undefined;
}) {
	let stop = Boolean((options.workerProvider() as any)?.isStop);
	let stopMessage: MessageElement | undefined;
	const startBtn = $ui.button('▶️开始答题');
	const completeBtn = $ui.button('🧩补全未完成');
	const restartBtn = $ui.button('🔃重新答题');
	const controlBtn = $ui.button(stop ? '▶️继续' : '⏸暂停');

	let actionPending = false;
	const refresh = () => {
		const active = CommonProject.scripts.settings.cfg.aiProvider === 'deepseek-web' ? getWebActivity() : undefined;
		const blocked = active && active.id !== options.activityId?.();
		[startBtn, restartBtn, completeBtn].forEach((button) => {
			button.disabled = actionPending || Boolean(blocked);
			button.title = blocked ? webActivityMessage(active!) : '';
		});
	};
	watchWebActivity(completeBtn, refresh);
	const action = (run: () => void | Promise<void>) => async () => {
		if (actionPending) return;
		const active = CommonProject.scripts.settings.cfg.aiProvider === 'deepseek-web' ? getWebActivity() : undefined;
		if (active && active.id !== options.activityId?.()) {
			$message.warn(webActivityMessage(active));
			return;
		}
		actionPending = true;
		[startBtn, restartBtn, completeBtn].forEach((button) => {
			button.disabled = true;
		});
		stopMessage?.remove();
		try {
			await run();
		} finally {
			actionPending = false;
			refresh();
		}
	};
	startBtn.onclick = action(options.onStart);
	restartBtn.onclick = action(options.onRestart);
	completeBtn.onclick = action(options.onCompleteUnfinished);

	controlBtn.onclick = () => {
		stop = !stop;
		const worker = options.workerProvider();
		worker?.emit?.(stop ? 'stop' : 'continuate');
		controlBtn.value = stop ? '▶️继续' : '⏸️暂停';
		if (stop) {
			stopMessage = $message.warn({ duration: 0, content: '暂停中...' });
		} else {
			stopMessage?.remove();
		}
	};

	return { startBtn, completeBtn, restartBtn, controlBtn };
}

/**
 * 图片识别，将图片链接追加到 text 中
 * 返回一个克隆的节点
 */
export function optimizationElementWithImage(root: HTMLElement, clone_node: boolean = false): HTMLElement {
	const clone = clone_node ? (root.cloneNode(true) as HTMLElement) : root;
	for (const img of Array.from(clone.querySelectorAll('img'))) {
		// 如果已经存在识别结果，则不处理
		if (
			Array.from(img.parentElement!.querySelectorAll('span')).some(
				(e) => e.style.fontSize === '0px' && e.textContent?.includes(getQuestionImageURL(img))
			)
		) {
			continue;
		}

		const src = document.createElement('span');
		src.setAttribute('data-xth-image-ref', '');
		src.innerText = getQuestionImageURL(img);
		// 隐藏图片，但不影响 innerText 的获取
		src.style.fontSize = '0px';
		img.after(src);
	}
	return clone;
}

/**
 * 创建一个不可见的文本节点，追加到图片后面，便于文本获取
 */
export function createUnVisibleTextOfImage(img: HTMLImageElement) {
	const src = document.createElement('span');
	src.innerText = getQuestionImageURL(img);
	// 隐藏图片，但不影响 innerText 的获取
	src.style.fontSize = '0px';
	img.after(src);
}

/** 将 {@link WorkResult} 转换成 {@link SimplifyWorkResult} */
export function simplifyWorkResult(
	results: WorkResult<any>[],
	/**
	 * 标题处理方法
	 * 在答题时使用相同的处理方法，可以使答题结果显示的题目与搜题的题目保持一致
	 */
	titleTransform?: (title: (HTMLElement | undefined)[], index: number) => string
): SimplifyWorkResult[] {
	const res: SimplifyWorkResult[] = [];
	let i = 0;
	for (const wr of results) {
		const ques =
			titleTransform?.(wr.ctx?.elements.title || [], i) ||
			wr.ctx?.elements.title
				?.map((e) => e?.innerText.trim())
				.filter(Boolean)
				.join('<br>') ||
			'';
		res.push({
			reviewId: wr.ctx?.reviewId,
			requested: wr.requested,
			resolved: wr.resolved,
			error: wr.error,
			type: wr.ctx?.type,
			question: ques,
			finish: wr.result?.finish,
			searchInfos:
				wr.ctx?.searchInfos.map((sr) => ({
					error: sr.error,
					name: sr.name,
					homepage: sr.homepage,
					response: sr.response,
					data: sr.data,
					results: sr.results.map((ans) => [ans.question, ans.answer, ans.extra_data || {}])
				})) || []
		});
		i++;
	}

	return res;
}

/**
 * 从题目中移除指定的冗余词
 */
export function removeRedundantWords(str: string, words: string[]) {
	for (const word of words.map((w) => w.trim())) {
		str = str.replace(word, '');
	}
	return str;
}

let aiConfigEmptyMessage: MessageElement | undefined;

export const aiConfigEmptyWarning = cors.defineTopFunction((duration: number) => {
	const setting = h('button', { className: 'base-style-button-secondary' }, 'AI设置');
	setting.onclick = () => {
		CommonProject.scripts.render.methods.pin(CommonProject.scripts.settings);
	};

	aiConfigEmptyMessage?.remove();
	aiConfigEmptyMessage = $message.warn({
		content: h('span', {}, ['你还没设置 AI，无法自动答题，请切换到 ', setting, ' 页面进行配置。']),
		duration: duration
	});
});

export const closeAIConfigEmptyWarning = cors.defineTopFunction(() => {
	aiConfigEmptyMessage?.remove();
	aiConfigEmptyMessage = undefined;
});
