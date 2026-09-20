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
const BRIDGE = 'xth.web.bridge.v1';
const MAX_AGE = 45000;
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
			Date.now() - request.updatedAt < MAX_AGE
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
		if (!request || Date.now() - request.updatedAt > MAX_AGE) {
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
export async function acquireWebActivity(kind: WebActivityKind): Promise<WebActivityLease> {
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
	try {
		while (Date.now() - request.createdAt < 15000) {
			const state = GM_getValue<ActivityRequest | undefined>(key, undefined);
			if (!state || receiver()?.id !== bridge.id) throw new Error('网页任务连接已中断，未发送题目。');
			if (state.status === 'rejected') throw new Error(state.error || '网页正在处理另一项任务。');
			if (state.status === 'granted' && getWebActivity()?.id === id) {
				let released = false;
				const renew = setInterval(() => {
					const current = GM_getValue<ActivityRequest | undefined>(key, undefined);
					if (current?.status === 'granted' && getWebActivity()?.id === id)
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
			}
			await sleep(100);
		}
		throw new Error('专用网页未及时响应任务占用，请保持标签页运行后重试。');
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
