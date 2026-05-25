import type { SimplifyWorkResult, WorkerEvents, WorkResult } from '@xuexitong-ai-helper/core/src/core/worker/interface';
import { $ui, $message, MessageElement, Script, h, CommonEventEmitter, cors, $elements } from 'easy-us';
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
	// 置顶当前脚本
	CommonProject.scripts.render.methods.pin(script);
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

	/** 显示答题控制按钮 */
	const createWorkControlPanel = () => {
		const { completeBtn, controlBtn, restartBtn, startBtn } = createWorkerControl({
			workerProvider: () => worker,
			onStart: async () => {
				startBtnPressed = true;
				if (checkMessage instanceof MessageElement) {
					checkMessage.remove();
				}
				await closeAIConfigEmptyWarning();
				start();
			},
			onRestart: async () => {
				worker?.emit('close');
				await options.onRestart?.();
				start();
			},
			onCompleteUnfinished: async () => {
				const indexes = await getUnfinishedQuestionIndexes();
				if (indexes.length === 0) {
					$message.info('没有检测到未完成题。');
					return;
				}
				worker?.emit('close');
				await options.onRestart?.();
				start(indexes);
			}
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

	for (const script of sync_script) {
		script.on('render', () => {
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
					...(options.enable_control_panel ? [globalControlPanel || createWorkControlPanel().container] : []),
					workResultPanel()
				])
			);
		});
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

	['aiApiUrl', 'aiApiKey', 'aiModel'].forEach((key) => {
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

	const start = async (questionIndexes?: number[]) => {
		const workOptions = {
			...getWorkOptions(),
			questionIndexes,
			appendOnly: Boolean(questionIndexes?.length)
		};
		if (hasAnswerProvider(workOptions) === false) {
			checkFailed = true;
			aiConfigEmptyWarning(0);
			return;
		}

		checkFailed = false;
		await closeAIConfigEmptyWarning();
		await options.beforeRunning?.();
		running = true;
		worker = options.workerProvider(workOptions);

		if (worker) {
			options.onWorkerCreated?.(worker);
		}

		const { container, controlBtn } = createWorkControlPanel();
		// 更新状态
		script.panel?.body?.replaceChildren(container, workResultPanel());

		worker?.once('done', () => {
			running = false;
			globalControlPanel = null;
			controlBtn.disabled = true;
		});
	};
}

/**
 * 答题控制
 */
export function createWorkerControl(options: {
	workerProvider: () => CommonEventEmitter<WorkerEvents> | undefined;
	onStart: () => void;
	onRestart: () => void;
	onCompleteUnfinished: () => void;
}) {
	let stop = false;
	let stopMessage: MessageElement | undefined;
	const startBtn = $ui.button('▶️开始答题');
	const completeBtn = $ui.button('🧩补全未完成');
	const restartBtn = $ui.button('🔃重新答题');
	const controlBtn = $ui.button('⏸暂停');

	startBtn.onclick = () => {
		startBtn.remove();
		options.onStart();
	};
	restartBtn.onclick = () => {
		// 重新答题时，清除暂停提示
		stopMessage?.remove();
		options.onRestart();
	};
	completeBtn.onclick = () => {
		stopMessage?.remove();
		options.onCompleteUnfinished();
	};
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

async function getUnfinishedQuestionIndexes() {
	const results = (await CommonProject.scripts.workResults.methods.getResults?.()) || [];
	return results.reduce<number[]>((indexes, result, index) => {
		const hasAnswer = result.searchInfos.some((info) => info.results.some((answer) => answer[1]?.trim()));
		if (
			result.requested === false ||
			result.resolved === false ||
			result.finish !== true ||
			Boolean(result.error?.trim()) ||
			hasAnswer === false
		) {
			indexes.push(index);
		}
		return indexes;
	}, []);
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
				(e) => e.style.fontSize === '0px' && e.textContent?.includes(img.src)
			)
		) {
			continue;
		}

		const src = document.createElement('span');
		src.innerText = img.src;
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
	src.innerText = img.src;
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
		setTimeout(() => {
			$elements.root?.querySelector<HTMLElement>('[value="点击配置"]')?.click();
		}, 500);
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
