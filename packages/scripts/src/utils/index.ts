import { $ } from '@xuexitong-ai-helper/core/src/utils/common';
import type { AnswerMatchMode, WorkUploadType } from '@xuexitong-ai-helper/core/src/core/worker/interface';
import { $ui, $message, $modal, MessageElement, h } from 'easy-us';
import { aiConfigEmptyWarning } from './work';
import { MessageAttrs } from 'easy-us/lib/interfaces/custom-window';
import { hasAnswerProvider } from './ai';

export interface CommonWorkOptions {
	aiProvider?: 'api' | 'deepseek-web';
	period: number;
	thread: number;
	upload: WorkUploadType;
	aiApiUrl: string;
	aiApiKey: string;
	aiModel: string;
	webActivityId?: string;
	aiTemperature: number;
	aiUseResponseFormat: boolean;
	aiVisionMode?: 'auto' | 'support' | 'unsupported';
	stopSecondWhenFinish: number;
	redundanceWordsText: string;
	answerSeparators: string;
	answerMatchMode: AnswerMatchMode;
	questionIndexes?: number[];
	appendOnly?: boolean;
	forceAnswer?: boolean;
}

/** 创建答题预处理信息 */
export function workPreCheckMessage(
	options: CommonWorkOptions & {
		start_delay_seconds?: number;
		onrun: (opts: CommonWorkOptions) => void;
		/**
		 * 当没有 AI 配置时的回调
		 */
		onNoAIConfig?: (opts: CommonWorkOptions) => void;
		/**
		 * 手动关闭时的回调
		 */
		onclose?: (opts: CommonWorkOptions, closedMessage: MessageElement) => void;
	}
) {
	const { onrun, onNoAIConfig, onclose, ...opts } = options;

	if (hasAnswerProvider(opts) === false && opts.aiProvider !== 'deepseek-web') {
		onNoAIConfig?.(opts);
		return aiConfigEmptyWarning(0);
	} else {
		options.start_delay_seconds = options.start_delay_seconds ?? 5;
		return $message.info({
			duration: options.start_delay_seconds,
			content: h('span', [
				`${options.start_delay_seconds}秒后自动答题，`,
				$ui.preventText({
					name: '点击取消',
					delay: options.start_delay_seconds,
					ondefault: (span) => {
						onrun(opts);
					},
					onprevent(span) {
						const closedMessage = $message.warn({
							content: '已关闭此次的自动答题，请手动开启或者忽略此警告。',
							duration: 0
						});
						if (closedMessage) {
							onclose?.(opts, closedMessage);
						}
					}
				})
			])
		});
	}
}

/**
 * 创造范围选择器的提示
 */
export function createRangeTooltip(
	input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
	defaultValue: string,
	transform: (val: string) => string
) {
	input.addEventListener('change', () => {
		input.setAttribute('data-title', transform(input.value || input.getAttribute('value') || defaultValue));
	});
	input.setAttribute('data-title', transform(input.value || input.getAttribute('value') || defaultValue));
}

// 有些网课会改变 media.play 方法，所以可能不是一个 promise
export async function playMedia(playFunction: () => Promise<void> | undefined | void, signal?: AbortSignal): Promise<boolean> {
	const tryPlayMedia = async () => {
		if (signal?.aborted) throw new Error('播放任务已取消。');
		await playFunction();
	};
	try {
		await tryPlayMedia();
		return !signal?.aborted;
	} catch (error) {
		if (signal?.aborted) return false;
		console.error(error);
		const message = String(error);
		if ((error as { name?: string })?.name === 'NotAllowedError' ||
			/user didn['’]t interact|user (?:interaction|gesture)|not allowed by the user agent/i.test(message)) {
			return new Promise<boolean>((resolve) => {
				let settled = false;
				let retrying = false;
				let modal: HTMLElement | undefined;
				const finish = (playing: boolean) => {
					if (settled) return;
					settled = true;
					signal?.removeEventListener('abort', abort);
					modal?.remove();
					resolve(playing && !signal?.aborted);
				};
				const abort = () => finish(false);
				signal?.addEventListener('abort', abort, { once: true });
				modal = $modal.alert({
					content: '浏览器阻止了自动播放。请先点击播放器或页面，再点击“重试播放”；无法播放时请关闭提示并手动处理。',
					confirmButtonText: '重试播放',
					maskCloseable: false,
					onConfirm: async () => {
						if (settled || retrying) return false;
						retrying = true;
						try { await tryPlayMedia(); finish(true); }
						catch (retryError) { console.error(retryError); finish(false); }
					},
					onCancel: () => finish(false),
					onClose: () => finish(false)
				});
				if (signal?.aborted) abort();
			});
		}
		return false;
	}
}

/**
 * 	解除复制限制功能
 * @param elements 要开启复制功能的元素
 */
export function enableCopy(elements: (HTMLElement | Document)[]) {
	// 将页面上的所有选择方法劫持，并强制返回 true
	function hackSelect(target: HTMLElement | Document) {
		if (target) {
			const _original_select = target.onselectstart;
			const _original_oncopy = target.oncopy;
			const _original_onpaste = target.onpaste;
			const _original_onkeydown = target.onkeydown;

			target.onselectstart = (e: any) => {
				_original_select?.apply(target, [e]);
				e.stopPropagation();
				e.returnValue = true;
				return true;
			};
			target.oncopy = (e: any) => {
				_original_oncopy?.apply(target, [e]);
				e.stopPropagation();
				e.returnValue = true;
				return true;
			};
			target.onpaste = (e: any) => {
				_original_onpaste?.apply(target, [e]);
				e.stopPropagation();
				e.returnValue = true;
				return true;
			};
			target.onkeydown = (e: any) => {
				_original_onkeydown?.apply(target, [e]);
				e.stopPropagation();
				e.returnValue = true;
				return true;
			};
		}
	}

	for (const el of elements) {
		hackSelect(el);
	}
}

let popupWin: Window | null;
window.addEventListener('beforeunload', () => {
	popupWin?.close();
});
/**
 * 创建关于问题题目的拓展功能按钮，包括复制和百度一下
 * @param question 问题
 */
export function createQuestionTitleExtra(question: string) {
	const space = $ui.space(
		[
			$ui.copy('复制', question),
			h('span', { className: 'question-title-extra-btn', innerText: '🌏百度一下' }, (btn) => {
				btn.onclick = () => {
					popupWin?.close();
					popupWin = $.createCenteredPopupWindow(`https://www.baidu.com/s?wd=${question}`, '百度搜索', {
						width: 1000,
						height: 800,
						resizable: true,
						scrollbars: true
					});
				};
			})
		],
		{ x: 4 }
	);
	space.style.marginTop = '6px';
	space.style.textAlign = 'right';
	return h('div', { style: { textAlign: 'right' } }, [space]);
}

function msg(type: keyof typeof $message, attrs: MessageAttrs) {
	$message[type](attrs);
}

export const $msg = {
	info: (attrs: MessageAttrs) => msg('info', attrs),
	warn: (attrs: MessageAttrs) => msg('warn', attrs),
	error: (attrs: MessageAttrs) => msg('error', attrs),
	success: (attrs: MessageAttrs) => msg('success', attrs)
};
