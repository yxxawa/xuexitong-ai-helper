import { assertWebActivity, serviceWebActivities } from './web-activity';
import { deepSeekAdapter, validateWebImages, type WebChatAdapter, type WebImage } from './deepseek-web';

export const WEB_BRIDGE_STATE = 'xth.web.bridge.v1';
const REQUEST_PREFIX = 'xth.web.request.v1.';
const SESSION_KEY = 'xth.web.dedicated-tab';
export const WEB_CONVERSATION_LIMIT = 50;
const HEARTBEAT_AGE = 45000;
const QUEUE_TIMEOUT = 30 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const uuid = () =>
	Array.from(crypto.getRandomValues(new Uint32Array(4)), (v) => v.toString(16).padStart(8, '0')).join('');
export interface BridgeState {
	id: string;
	supportsImages?: boolean;
	supportsActivities?: boolean;
	conversationUses?: number;
	provider: string;
	instance: string;
	status: 'ready' | 'busy' | 'reloading' | 'disabled';
	updatedAt: number;
}
interface WebRequest {
	id: string;
	activityId?: string;
	bridgeId: string;
	status: 'queued' | 'processing' | 'done' | 'error' | 'cancelled';
	createdAt: number;
	startedAt?: number;
	timeout: number;
	prompt?: string;
	images?: WebImage[];
	answer?: string;
	error?: string;
}
export function getWebBridgeState(): BridgeState | undefined {
	try {
		const state = GM_getValue<BridgeState | undefined>(WEB_BRIDGE_STATE, undefined);
		if (
			state?.provider === 'deepseek-web' &&
			state.id &&
			state.status !== 'disabled' &&
			Date.now() - state.updatedAt < HEARTBEAT_AGE
		)
			return state;
	} catch {
		/* Not in a userscript context. */
	}
}
export function openDeepSeekBridge() {
	const url = 'https://chat.deepseek.com/#xth-bridge';
	if (typeof GM_openInTab === 'function') GM_openInTab(url, { active: true, insert: true });
	else window.open(url, '_blank', 'noopener,noreferrer');
}

/** Mailboxes are per request, so tabs/iframes cannot overwrite one another's prompts or answers. */
export async function requestWebAnswer(
	prompt: string,
	timeoutSeconds = 180,
	images: WebImage[] = [],
	activityId?: string
): Promise<string> {
	const bridge = getWebBridgeState();
	if (!bridge) throw new Error('DeepSeek 网页未连接。请打开专用标签页，登录并点击“启用此标签页”。');
	if (!prompt.trim() || prompt.length > 60000) throw new Error('网页请求为空或过长（上限 60000 字符）。');
	assertWebActivity(activityId);
	validateWebImages(images);
	if (images.length && bridge.supportsImages !== true)
		throw new Error('专用标签页仍是旧版纯文本桥接，请刷新并重新启用；图片题未发送。');
	const id = uuid(),
		key = REQUEST_PREFIX + id;
	const request: WebRequest = {
		id,
		bridgeId: bridge.id,
		activityId,
		images: images.length ? images : undefined,
		status: 'queued',
		createdAt: Date.now(),
		timeout: Math.max(30, Math.min(600, Number(timeoutSeconds) || 180)) * 1000,
		prompt:
			prompt +
			'\n请只输出完整 JSON，包含 answer、answers、solution 字段，并添加字符串字段 _bridge_id，其值必须为：' +
			id
	};
	GM_setValue(key, request);
	try {
		for (;;) {
			const current = GM_getValue<WebRequest | undefined>(key, undefined);
			if (!current) throw new Error('网页请求已取消。');
			if (current.status === 'done' && typeof current.answer === 'string') return current.answer;
			if (current.status === 'error' || current.status === 'cancelled')
				throw new Error(current.error || '网页请求已中断。');
			const receiver = getWebBridgeState();
			if (!receiver || receiver.id !== bridge.id)
				throw new Error('专用网页已断开或被暂停；不会自动重发，请检查该标签页。');
			if (
				Date.now() - request.createdAt > QUEUE_TIMEOUT ||
				(current.startedAt && Date.now() - current.startedAt > request.timeout)
			) {
				GM_setValue(key, { ...current, status: 'cancelled', prompt: undefined, images: undefined });
				throw new Error('网页回答等待超时；请检查登录、验证码、限流或页面兼容性，不会自动重发。');
			}
			await sleep(350);
		}
	} finally {
		GM_deleteValue(key);
	}
}

/** Only the marked, explicitly enabled DeepSeek tab can consume requests. */
export function startDeepSeekBridge(adapter: WebChatAdapter = deepSeekAdapter) {
	if (location.hostname !== 'chat.deepseek.com' || window.top !== window.self) return;
	let remembered = '';
	try {
		remembered = sessionStorage.getItem(SESSION_KEY) || '';
	} catch {
		return;
	}
	if (location.hash !== '#xth-bridge' && !remembered) return;
	const mount = () => {
		if (document.getElementById('xth-deepseek-bridge')) return;
		const host = document.createElement('div');
		host.id = 'xth-deepseek-bridge';
		const shadow = host.attachShadow({ mode: 'open' });
		shadow.innerHTML =
			'<style>:host{color-scheme:light dark;position:fixed;top:12px;right:12px;z-index:2147483647;font:13px/1.6 system-ui;width:min(340px,calc(100vw - 24px));--bg:#fff;--fg:#243247;--border:#cdd7e3;--button:#edf5ff;--accent:#176dcc}@media(prefers-color-scheme:dark){:host{--bg:#171d28;--fg:#e5eaf3;--border:#354258;--button:#203651;--accent:#8bbcff}}section{background:var(--bg);color:var(--fg);padding:14px;border:1px solid var(--border);border-radius:10px;box-shadow:0 4px 18px #0004}p{margin:6px 0}button,a{font:inherit;color:var(--accent);background:var(--button);border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer}button:disabled{opacity:.5}nav{display:flex;gap:8px;margin-top:10px}a{text-decoration:none}</style><section><strong>学习通 · DeepSeek 网页桥接（实验）</strong><p>支持题干及选项图片。此标签页会上传图片、发送题目，每个会话最多使用 50 次，并保存在当前账号历史中。启用后请勿在此页手动聊天。</p><p role="status"></p><nav><button type="button">启用此标签页</button><a href="https://chat.deepseek.com/#xth-bridge">空白新对话</a></nav></section>';
		document.body.append(host);
		const status = shadow.querySelector<HTMLElement>('[role="status"]')!;
		const toggle = shadow.querySelector<HTMLButtonElement>('button')!;
		const instance = uuid();
		let owner = remembered || uuid(),
			enabled = false,
			busy = false,
			activeKey = '',
			resetting = false,
			conversationUses = 0,
			lastAnswerId = '',
			conversationPath = '';
		const idleMessage = () =>
			'已连接 · 本会话 ' + conversationUses + '/' + WEB_CONVERSATION_LIMIT + ' · 串行等待请求。';
		let heartbeat: ReturnType<typeof setInterval>;
		const say = (text: string) => {
			status.textContent = text;
		};
		const ownsLease = () => {
			const value = GM_getValue<BridgeState | undefined>(WEB_BRIDGE_STATE, undefined);
			return value?.id === owner && value.instance === instance;
		};
		const publish = (state: BridgeState['status']) =>
			GM_setValue(WEB_BRIDGE_STATE, {
				id: owner,
				instance,
				provider: adapter.id,
				supportsImages: adapter.supportsImages === true,
				supportsActivities: true,
				conversationUses,
				status: state,
				updatedAt: Date.now()
			});
		const stop = (message: string) => {
			enabled = false;
			sessionStorage.removeItem(SESSION_KEY);
			if (ownsLease()) publish('disabled');
			toggle.textContent = '启用此标签页';
			say(message);
		};
		const failPending = (message: string) => {
			if (!activeKey) return;
			const req = GM_getValue<WebRequest | undefined>(activeKey, undefined);
			if (req && req.status === 'processing')
				GM_setValue(activeKey, { ...req, status: 'error', prompt: undefined, images: undefined, error: message });
		};
		const consume = async () => {
			if (!enabled || busy) return;
			if (!ownsLease()) {
				stop('另一个标签页接管了连接，请重新确认。');
				return;
			}
			const now = Date.now();
			const waiting: [string, WebRequest][] = [];
			for (const key of GM_listValues().filter((key) => key.startsWith(REQUEST_PREFIX))) {
				const req = GM_getValue<WebRequest | undefined>(key, undefined);
				if (!req || now - req.createdAt > QUEUE_TIMEOUT) {
					GM_deleteValue(key);
					continue;
				}
				if (req.bridgeId === owner && req.status === 'queued') waiting.push([key, req]);
			}
			waiting.sort((a, b) => a[1].createdAt - b[1].createdAt);
			if (!waiting.length) return;
			const [key, req] = waiting[0];
			if (!req.prompt || req.prompt.length > 61000) {
				GM_setValue(key, { ...req, status: 'error', prompt: undefined, images: undefined, error: '无效网页请求' });
				return;
			}
			busy = true;
			activeKey = key;
			publish('busy');
			say('正在回答；请保持标签页打开，不要编辑或切换对话…');
			const cancelled = () =>
				!enabled ||
				!ownsLease() ||
				!GM_getValue<WebRequest | undefined>(key, undefined) ||
				GM_getValue<WebRequest>(key).status === 'cancelled';
			try {
				assertWebActivity(req.activityId);
				validateWebImages(req.images || []);
				if (conversationUses === 0) adapter.assertEmpty();
				else {
					adapter.assertReady();
					if (location.pathname !== conversationPath || !adapter.readCompleted(lastAnswerId))
						throw new Error('专用页对话已改变或上一回答无法确认，请从空白新对话重新启用。');
				}
				const startedAt = Date.now();
				GM_setValue(key, { ...req, status: 'processing', startedAt });
				await adapter.submit(req.prompt, cancelled, req.images);
				conversationUses++;
				let previous = '',
					stableAt = 0;
				while (!cancelled() && Date.now() - startedAt < req.timeout) {
					const answer = adapter.readCompleted(req.id);
					if (answer && answer === previous && Date.now() - stableAt >= 1200) {
						GM_setValue(key, { ...req, status: 'done', startedAt, prompt: undefined, images: undefined, answer });
						activeKey = '';
						lastAnswerId = req.id;
						conversationPath = location.pathname;
						if (conversationUses >= WEB_CONVERSATION_LIMIT) {
							resetting = true;
							publish('reloading');
							say('本会话已使用 50 次，正在新建对话…');
							await sleep(100);
							if (enabled) adapter.reset();
						} else {
							publish('ready');
							say(idleMessage());
						}
						return;
					}
					if (answer !== previous) {
						previous = answer || '';
						stableAt = Date.now();
					}
					await sleep(300);
				}
				throw new Error('请求取消或回答超时。请检查登录、验证码、限流或网页结构；不会自动重发。');
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				failPending(message);
				stop(message);
			} finally {
				busy = resetting;
				if (!resetting) activeKey = '';
			}
		};
		const enable = async (resume = false) => {
			if (enabled) {
				failPending('用户停止了网页桥接。');
				stop('已停止；网页仍在生成的内容请自行检查。');
				return;
			}
			try {
				adapter.assertEmpty();
				const existing = getWebBridgeState();
				if (existing && (existing.id !== owner || (existing.instance !== instance && existing.status !== 'reloading')))
					throw new Error('已有另一个专用标签页连接，请先在原标签页停止。');
				if (!resume) owner = uuid();
				publish('ready');
				await sleep(150); // Confirm exclusive ownership before consuming a mailbox.
				if (!ownsLease()) throw new Error('连接被其他标签页占用。');
				sessionStorage.setItem(SESSION_KEY, owner);
				enabled = true;
				toggle.textContent = '停止桥接';
				say(idleMessage());
			} catch (error) {
				stop(error instanceof Error ? error.message : String(error));
			}
		};
		toggle.onclick = async () => {
			toggle.disabled = true;
			try {
				await enable();
			} finally {
				toggle.disabled = false;
			}
		};
		shadow.querySelector('a')!.addEventListener('click', (event) => {
			event.preventDefault();
			stop('准备打开空白页。');
			adapter.reset();
		});
		// A reload during a sent request must never cause that request to be sent again.
		if (remembered) {
			let interrupted = false;
			for (const key of GM_listValues().filter((key) => key.startsWith(REQUEST_PREFIX))) {
				const req = GM_getValue<WebRequest | undefined>(key, undefined);
				if (req?.bridgeId === owner && req.status === 'processing') {
					GM_setValue(key, {
						...req,
						status: 'error',
						prompt: undefined,
						images: undefined,
						error: '网页在回答时刷新；为防止重复请求，已停止。'
					});
					interrupted = true;
				}
			}
			if (interrupted) stop('上一请求因刷新中断，请检查网页后重新启用。');
			else if (getWebBridgeState()?.id !== owner || getWebBridgeState()?.status !== 'reloading') {
				stop('此标签页需要重新启用；不接管其他正在运行的标签页。');
			} else {
				// Wait for the SPA to mount after our own new-conversation navigation.
				void (async () => {
					for (let i = 0; i < 60; i++) {
						if (sessionStorage.getItem(SESSION_KEY) !== owner) return;
						try {
							adapter.assertEmpty();
							await enable(true);
							return;
						} catch {
							await sleep(500);
						}
					}
					stop('未识别到空白对话，请检查登录状态后手动启用。');
				})();
			}
		} else say('未启用。请先登录并打开空白新对话。');
		heartbeat = setInterval(() => {
			if (enabled && ownsLease()) {
				publish(resetting ? 'reloading' : busy ? 'busy' : 'ready');
				serviceWebActivities(owner, busy);
			}
			void consume().catch((error) => stop(String(error)));
		}, 1000);
		document.addEventListener(
			'input',
			(event) => {
				if (enabled && event.isTrusted && !event.composedPath().includes(host)) {
					failPending('检测到手动编辑，已停止桥接。');
					stop('检测到手动编辑，已停止桥接以避免混入其他聊天。');
				}
			},
			true
		);
		window.addEventListener(
			'pagehide',
			() => {
				clearInterval(heartbeat);
				if (activeKey) {
					failPending('网页离开或刷新，已停止本次请求。');
					stop('页面已离开。');
				} else if (enabled && !resetting) stop('页面已离开。');
			},
			{ once: true }
		);
	};
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
	else mount();
}
