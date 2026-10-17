import { waitForAI, type AIRequestControl } from './request-control';
import { getWebBridgeState, WEB_BRIDGE_RECOVERY_TIMEOUT, wakeWebBridge } from './web-bridge-state';

export type WebTaskPhase = 'waiting' | 'answering' | 'retrying' | 'attention' | 'idle';
export interface WebTaskStatus {
	phase: WebTaskPhase;
	message: string;
	since: number;
}
let status: WebTaskStatus = { phase: 'idle', message: '', since: Date.now() };
const listeners = new Set<(status: WebTaskStatus) => void>();
export function reportWebTaskStatus(phase: WebTaskPhase, message: string) {
	if (status.phase === phase && status.message === message) return;
	status = { phase, message, since: status.phase === phase ? status.since : Date.now() };
	for (const listener of listeners) {
		try {
			listener(status);
		} catch (error) {
			console.error('答题状态显示失败', error);
		}
	}
}
export function watchWebTaskStatus(listener: (status: WebTaskStatus) => void) {
	listeners.add(listener);
	listener(status);
	return () => {
		listeners.delete(listener);
	};
}
/** Visible even when no question has finished; no repeated transient toast messages. */
export function createWebTaskStatus() {
	const element = document.createElement('p');
	element.setAttribute('role', 'status');
	element.setAttribute('data-xth-web-task', '');
	element.style.cssText = 'line-height:1.6;overflow-wrap:anywhere;white-space:pre-line';
	const render = () => {
		element.hidden = !status.message;
		const seconds = Math.max(0, Math.floor((Date.now() - status.since) / 1000));
		const waiting = status.phase === 'waiting' || status.phase === 'answering' || status.phase === 'retrying';
		element.textContent =
			status.message +
			(waiting ? '\n已等待 ' + seconds + ' 秒。' : '') +
			(waiting && seconds >= 180 ? ' 长时间没有新结果，请检查 DeepSeek 登录、验证码、网络和浏览器休眠。' : '');
	};
	const unsubscribe = watchWebTaskStatus(render);
	let mounted = false;
	const createdAt = Date.now();
	const timer = setInterval(() => {
		mounted ||= element.isConnected;
		if (!element.isConnected && (mounted || Date.now() - createdAt > 10000)) {
			clearInterval(timer);
			unsubscribe();
			return;
		}
		render();
	}, 1000);
	return element;
}
/** Wait before submitting, so opening the learning page before the bridge is harmless. */
export async function waitForWebBridge(control: AIRequestControl = {}, expectedId?: string) {
	let startedAt = Date.now(),
		lastWake = 0;
	for (;;) {
		const pausedAt = Date.now();
		await waitForAI(control);
		startedAt += Date.now() - pausedAt;
		const bridge = getWebBridgeState();
		if (bridge && bridge.status !== 'reloading' && (!expectedId || bridge.id === expectedId)) return bridge;
		if (bridge && expectedId && bridge.id !== expectedId) {
			const message = '专用标签页已更换；当前题目不会重复发送，请检查原消息后补全未完成。';
			reportWebTaskStatus('attention', message);
			throw new Error(message);
		}
		if (Date.now() - startedAt >= WEB_BRIDGE_RECOVERY_TIMEOUT) {
			const message = '等待 DeepSeek 连接已超过 30 分钟。请登录并启用专用标签页，再点击继续或开始答题。';
			reportWebTaskStatus('attention', message);
			throw new Error(message);
		}
		reportWebTaskStatus('waiting', '等待 DeepSeek 专用标签页连接，连接后自动继续；需要登录或验证码时请在该页处理。');
		if (Date.now() - lastWake >= 3000) {
			lastWake = Date.now();
			wakeWebBridge();
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 500));
	}
}
