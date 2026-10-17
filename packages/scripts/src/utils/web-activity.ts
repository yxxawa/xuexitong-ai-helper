import { WEB_BRIDGE_STATE, WEB_BRIDGE_MAX_AGE, WEB_BRIDGE_RECOVERY_TIMEOUT, wakeWebBridge } from './web-bridge-state';
import { waitForAI, type AIRequestControl } from './request-control';
import { reportWebTaskStatus, waitForWebBridge } from './web-task';

/** One enabled receiver arbitrates work/search leases across all learning tabs and iframes. */
export type WebActivityKind = 'work' | 'search';
export interface WebActivity {
	id: string;
	bridgeId: string;
	kind: WebActivityKind;
}
interface ActivityRequest extends WebActivity {
	status: 'pending' | 'granted' | 'rejected';
	createdAt: number;
	updatedAt: number;
	error?: string;
}
export interface WebActivityLease extends WebActivity {
	assertActive(): void;
	release(): void;
}
export const WEB_ACTIVITY_STATE = 'xth.web.activity.v1';
const PREFIX = 'xth.web.activity.request.v1.';
const BRIDGE = WEB_BRIDGE_STATE;
const MAX_AGE = WEB_BRIDGE_MAX_AGE;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function receiver() {
	const state = GM_getValue<
		{ id: string; updatedAt: number; status: string; supportsActivities?: boolean } | undefined
	>(BRIDGE, undefined);
	return state && state.status !== 'disabled' && Date.now() - state.updatedAt < MAX_AGE ? state : undefined;
}
export function getWebActivity(): WebActivity | undefined {
	try {
		const state = GM_getValue<WebActivity | undefined>(WEB_ACTIVITY_STATE, undefined);
		if (!state || receiver()?.id !== state.bridgeId) return;
		const request = GM_getValue<ActivityRequest | undefined>(PREFIX + state.id, undefined);
		if (
			request?.status === 'granted' &&
			request.bridgeId === state.bridgeId &&
			Date.now() - request.updatedAt < WEB_BRIDGE_RECOVERY_TIMEOUT
		)
			return state;
	} catch {
		/* Not in a userscript. */
	}
}
export function webActivityMessage(activity: WebActivity): string {
	return activity.kind === 'work'
		? 'DeepSeek 网页正在自动答题，完成或停止后才能手动搜题。'
		: 'DeepSeek 网页正在手动搜题，请等待搜索结束后再开始答题或再次搜题。';
}
export function assertWebActivity(id?: string): void {
	const activity = getWebActivity();
	if (activity && activity.id !== id) throw new Error(webActivityMessage(activity));
	if (id && activity?.id !== id) throw new Error('网页任务占用已失效，已停止发送，请重新开始。');
}
/** Only call from the receiver holding the bridge lease; clients must never grant themselves ownership. */
export function serviceWebActivities(bridgeId: string, requestInFlight = false): void {
	const pending: ActivityRequest[] = [];
	for (const key of GM_listValues().filter((key) => key.startsWith(PREFIX))) {
		const request = GM_getValue<ActivityRequest | undefined>(key, undefined);
		if (
			!request ||
			Date.now() - request.updatedAt > (request.status === 'granted' ? WEB_BRIDGE_RECOVERY_TIMEOUT : MAX_AGE)
		) {
			GM_deleteValue(key);
			continue;
		}
		if (request.bridgeId === bridgeId && request.status === 'pending') pending.push(request);
	}
	let active = getWebActivity();
	pending.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
	for (const request of pending) {
		if (!active && requestInFlight) {
			GM_setValue(PREFIX + request.id, { ...request, status: 'rejected', error: '网页上一请求尚未结束，请稍后再试。' });
			continue;
		}
		if (!active) {
			active = { id: request.id, bridgeId, kind: request.kind };
			GM_setValue(PREFIX + request.id, { ...request, status: 'granted', updatedAt: Date.now() });
			GM_setValue(WEB_ACTIVITY_STATE, active);
		} else GM_setValue(PREFIX + request.id, { ...request, status: 'rejected', error: webActivityMessage(active) });
	}
	if (!active) GM_deleteValue(WEB_ACTIVITY_STATE);
}
async function waitForActivityGrant(key: string, bridgeId: string, control: AIRequestControl) {
	// The owner may pause while waiting for a background receiver to grant the lease.
	const keepAlive = setInterval(() => {
		const current = GM_getValue<ActivityRequest | undefined>(key, undefined);
		if (current?.bridgeId === bridgeId && current.status !== 'rejected' && !control.isCancelled?.())
			GM_setValue(key, { ...current, updatedAt: Date.now() });
	}, 5000);
	try {
		let startedAt = Date.now(),
			lastWake = Date.now();
		while (Date.now() - startedAt < WEB_BRIDGE_RECOVERY_TIMEOUT) {
			const pausedAt = Date.now();
			await waitForAI(control);
			startedAt += Date.now() - pausedAt;
			const state = GM_getValue<ActivityRequest | undefined>(key, undefined);
			const currentBridge = GM_getValue<{ id: string; status: string } | undefined>(BRIDGE, undefined);
			if (!state || currentBridge?.status === 'disabled' || (currentBridge && currentBridge.id !== bridgeId))
				throw new Error('网页任务连接已停止或更换，未发送题目。');
			if (state.status === 'rejected') throw new Error(state.error || '网页正在处理另一项任务。');
			if (state.status === 'granted' && getWebActivity()?.id === state.id) return;
			if (Date.now() - lastWake >= 3000) {
				lastWake = Date.now();
				GM_setValue(key, { ...state, updatedAt: Date.now() });
				wakeWebBridge();
			}
			if (Date.now() - startedAt > 15000)
				reportWebTaskStatus('waiting', '等待 DeepSeek 专用页确认任务，恢复响应后自动开始；可随时停止。');
			await sleep(100);
		}
		throw new Error('专用网页超过 30 分钟未确认任务，请检查登录、验证码或休眠后重新开始。');
	} finally {
		clearInterval(keepAlive);
	}
}
export async function acquireWebActivity(
	kind: WebActivityKind,
	control: AIRequestControl = {}
): Promise<WebActivityLease> {
	await waitForWebBridge(control);
	const bridge = receiver();
	if (!bridge) throw new Error('DeepSeek 网页未连接，请先启用专用标签页。');
	if (!bridge.supportsActivities) throw new Error('请刷新 DeepSeek 专用标签页并重新启用，以使用新版任务互斥。');
	const active = getWebActivity();
	if (active) throw new Error(webActivityMessage(active));
	const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
		value.toString(16).padStart(8, '0')
	).join('');
	const key = PREFIX + id;
	const request: ActivityRequest = {
		id,
		bridgeId: bridge.id,
		kind,
		status: 'pending',
		createdAt: Date.now(),
		updatedAt: Date.now()
	};
	GM_setValue(key, request);
	wakeWebBridge();
	try {
		await waitForActivityGrant(key, bridge.id, control);
		let released = false;
		const renew = setInterval(() => {
			const current = GM_getValue<ActivityRequest | undefined>(key, undefined);
			if (
				current?.status === 'granted' &&
				GM_getValue<WebActivity | undefined>(WEB_ACTIVITY_STATE, undefined)?.id === id
			)
				GM_setValue(key, { ...current, updatedAt: Date.now() });
		}, 5000);
		const release = () => {
			if (released) return;
			released = true;
			clearInterval(renew);
			GM_deleteValue(key);
			if (typeof window !== 'undefined') window.removeEventListener('pagehide', release);
		};
		if (typeof window !== 'undefined') window.addEventListener('pagehide', release, { once: true });
		return { id, bridgeId: bridge.id, kind, assertActive: () => assertWebActivity(id), release };
	} catch (error) {
		GM_deleteValue(key);
		throw error;
	}
}
/** Refresh visible controls across tabs; stop observing when their panel is discarded. */
export function watchWebActivity(element: HTMLElement, update: () => void) {
	let mounted = element.isConnected;
	const mountDeadline = Date.now() + 10000;
	const timer = setInterval(() => {
		mounted ||= element.isConnected;
		if (!element.isConnected && (mounted || Date.now() > mountDeadline)) {
			clearInterval(timer);
			return;
		}
		update();
	}, 300);
	update();
}

/** Reconfirm an existing task after its receiver reloads; only the receiver can grant it. */
export async function ensureWebActivity(id: string | undefined, control: AIRequestControl = {}) {
	const bridge = await waitForWebBridge(control);
	if (!id) {
		assertWebActivity();
		return;
	}
	const key = PREFIX + id;
	const request = GM_getValue<ActivityRequest | undefined>(key, undefined);
	if (!request) throw new Error('网页任务占用已失效，请停止后补全未完成。');
	if (getWebActivity()?.id === id) return;
	const active = getWebActivity();
	if (active) throw new Error(webActivityMessage(active));
	GM_setValue(key, { ...request, bridgeId: bridge.id, status: 'pending', updatedAt: Date.now() });
	wakeWebBridge();
	await waitForActivityGrant(key, bridge.id, control);
}
