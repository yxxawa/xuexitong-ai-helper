import { waitForAI, type AIRequestControl } from './request-control';
import { assertWebActivity, ensureWebActivity, serviceWebActivities } from './web-activity';
import { reportWebTaskStatus, waitForWebBridge } from './web-task';
import { deepSeekAdapter, validateWebImages, type WebChatAdapter, type WebImage } from './deepseek-web';

import {
	WEB_BRIDGE_STATE,
	WEB_BRIDGE_MAX_AGE,
	WEB_BRIDGE_RECOVERY_TIMEOUT,
	getWebBridgeState,
	type BridgeState,
	WEB_BRIDGE_WAKE,
	WEB_RATE_LIMIT_MAX_WAIT,
	wakeWebBridge
} from './web-bridge-state';
export { WEB_BRIDGE_STATE, getWebBridgeState } from './web-bridge-state';
export type { BridgeState } from './web-bridge-state';
const REQUEST_PREFIX = 'xth.web.request.v1.';
const SESSION_KEY = 'xth.web.dedicated-tab';
const CONTEXT_KEY = 'xth.web.dedicated-context.v1';
export const WEB_CONVERSATION_LIMIT = 50;
const HEARTBEAT_AGE = WEB_BRIDGE_MAX_AGE;
const QUEUE_TIMEOUT = 30 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const uuid = () =>
	Array.from(crypto.getRandomValues(new Uint32Array(4)), (v) => v.toString(16).padStart(8, '0')).join('');
interface WebRequest {
	id: string;
	activityId?: string;
	bridgeId: string;
	status: 'queued' | 'processing' | 'done' | 'error' | 'cancelled';
	createdAt: number;
	startedAt?: number;
	deadlineAt?: number;
	rateLimitRetries?: number;
	paused?: boolean;
	pausedAt?: number;
	pausedTotal?: number;
	recoveryAt?: number;
	recoveryTotal?: number;
	timeout: number;
	prompt?: string;
	images?: WebImage[];
	answer?: string;
	error?: string;
}
export function openDeepSeekBridge() {
	const url = 'https://chat.deepseek.com/#xth-bridge';
	if (typeof GM_openInTab === 'function') GM_openInTab(url, { active: true, insert: true });
	else window.open(url, '_blank', 'noopener,noreferrer');
}

function beginRecovery(key: string, since = Date.now()) {
	const current = GM_getValue<WebRequest | undefined>(key, undefined);
	if (current && current.recoveryAt === undefined)
		GM_setValue(key, { ...current, recoveryAt: Math.max(current.startedAt || current.createdAt, since) });
}
function recoverMailbox(key: string): WebRequest | undefined {
	const current = GM_getValue<WebRequest | undefined>(key, undefined);
	if (!current || current.recoveryAt === undefined) return current;
	const pausedOverlap =
		current.paused && current.pausedAt ? Math.max(0, Date.now() - Math.max(current.recoveryAt, current.pausedAt)) : 0;
	const elapsed = Math.max(0, Date.now() - current.recoveryAt - pausedOverlap);
	const total = (current.recoveryTotal || 0) + elapsed;
	if (total > WEB_BRIDGE_RECOVERY_TIMEOUT) throw new Error('断线恢复等待已超过 30 分钟，请检查专用标签页后继续。');
	const next = {
		...current,
		recoveryAt: undefined,
		recoveryTotal: total,
		createdAt: current.createdAt + elapsed,
		deadlineAt: current.deadlineAt ? current.deadlineAt + elapsed : undefined
	};
	GM_setValue(key, next);
	return next;
}
/** Keep the same mailbox and nonce while a receiver is temporarily unavailable. */
export async function requestWebAnswer(
	prompt: string,
	timeoutSeconds = 180,
	images: WebImage[] = [],
	activityId?: string,
	control: AIRequestControl = {}
): Promise<string> {
	await waitForAI(control);
	if (!prompt.trim() || prompt.length > 60000) throw new Error('网页请求为空或过长（上限 60000 字符）。');
	validateWebImages(images);
	await ensureWebActivity(activityId, control);
	const bridge = await waitForWebBridge(control);
	assertWebActivity(activityId);
	if (bridge.supportsRecovery !== true)
		throw new Error('请刷新 DeepSeek 专用标签页并重新启用，以使用断线恢复；本题未发送。');
	if (control.isPaused && bridge.supportsPause !== true)
		throw new Error('请刷新 DeepSeek 专用标签页并重新启用，以使用暂停/停止控制。');
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
	reportWebTaskStatus('answering', '已排队，正在等待 DeepSeek 回答当前题目。');
	wakeWebBridge();
	let lastWake = Date.now(),
		lastPoll = Date.now(),
		lastPollAccounted = 0;
	try {
		for (;;) {
			if (control.isCancelled?.()) throw new Error('请求已取消，已停止重试。');
			let current = GM_getValue<WebRequest | undefined>(key, undefined);
			if (!current) throw new Error('网页请求已取消。');
			if (current.status === 'done' && typeof current.answer === 'string') {
				reportWebTaskStatus('idle', '当前题目的回答已收到。');
				return current.answer;
			}
			if (current.status === 'error' || current.status === 'cancelled')
				throw new Error(current.error || '网页请求已中断。');
			const paused = Boolean(control.isPaused?.());
			if (paused !== Boolean(current.paused)) {
				const elapsed = !paused && current.pausedAt ? Date.now() - current.pausedAt : 0;
				current = {
					...current,
					paused,
					pausedAt: paused ? Date.now() : undefined,
					pausedTotal: (current.pausedTotal || 0) + elapsed,
					recoveryAt:
						current.recoveryAt === undefined
							? undefined
							: current.recoveryAt +
							  (!paused && current.pausedAt
									? Math.max(0, Date.now() - Math.max(current.recoveryAt, current.pausedAt))
									: 0),
					createdAt: current.createdAt + elapsed,
					deadlineAt: current.deadlineAt ? current.deadlineAt + elapsed : undefined
				};
				GM_setValue(key, current);
				wakeWebBridge();
			}
			const accounted = (current.pausedTotal || 0) + (current.recoveryTotal || 0);
			const gap = Date.now() - lastPoll - Math.max(0, accounted - lastPollAccounted);
			if (gap > HEARTBEAT_AGE && !paused) beginRecovery(key, Date.now() - gap);
			lastPoll = Date.now();
			const receiver = getWebBridgeState();
			const raw = GM_getValue<BridgeState | undefined>(WEB_BRIDGE_STATE, undefined);
			if (raw?.status === 'disabled' || (raw && raw.id !== bridge.id))
				throw new Error('专用页已停止或更换，请检查当前消息后继续；本题不会重复发送。');
			const expired = current.startedAt && Date.now() > (current.deadlineAt || current.startedAt + request.timeout);
			const unavailable =
				!receiver || receiver.status === 'reloading' || (expired && Date.now() - receiver.updatedAt > 5000);
			if (unavailable) {
				beginRecovery(key, raw?.updatedAt || Date.now());
				current = GM_getValue<WebRequest>(key);
				if (!paused && (current.recoveryTotal || 0) + Date.now() - current.recoveryAt! > WEB_BRIDGE_RECOVERY_TIMEOUT)
					throw new Error('断线恢复等待已超过 30 分钟，请检查专用标签页后继续。');
				reportWebTaskStatus('waiting', 'DeepSeek 连接暂时无响应，正在等待恢复；保留当前题目，不重复发送。');
				if (Date.now() - lastWake >= 3000) {
					lastWake = Date.now();
					wakeWebBridge();
				}
			} else {
				const recovering = current.recoveryAt !== undefined;
				current = recoverMailbox(key)!;
				if (recovering) reportWebTaskStatus('answering', 'DeepSeek 连接已恢复，继续等待原题目的回答。');
				if (
					!paused &&
					(Date.now() - current.createdAt > QUEUE_TIMEOUT ||
						(current.startedAt && Date.now() > (current.deadlineAt || current.startedAt + request.timeout)))
				)
					throw new Error('网页回答等待超时；请检查登录、验证码或页面兼容性。限流会在当前消息上每 3 秒重试。');
				if (current.rateLimitRetries !== undefined && !paused)
					reportWebTaskStatus(
						'retrying',
						'DeepSeek 请求频率受限，正在每 3 秒重试原消息；已重试 ' + current.rateLimitRetries + ' 次。'
					);
			}
			lastPollAccounted = (current.pausedTotal || 0) + (current.recoveryTotal || 0);
			await sleep(350);
		}
	} catch (error) {
		if (!control.isCancelled?.())
			reportWebTaskStatus('attention', error instanceof Error ? error.message : String(error));
		throw error;
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
			'<style>:host{color-scheme:light dark;position:fixed;top:12px;right:12px;z-index:2147483647;font:13px/1.6 system-ui;width:min(340px,calc(100vw - 24px));--bg:#fff;--fg:#243247;--border:#cdd7e3;--button:#edf5ff;--accent:#176dcc}@media(prefers-color-scheme:dark){:host{--bg:#171d28;--fg:#e5eaf3;--border:#354258;--button:#203651;--accent:#8bbcff}}section{background:var(--bg);color:var(--fg);padding:14px;border:1px solid var(--border);border-radius:10px;box-shadow:0 4px 18px #0004}p{margin:6px 0}button,a{font:inherit;color:var(--accent);background:var(--button);border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer}button:disabled{opacity:.5}nav{display:flex;gap:8px;margin-top:10px}a{text-decoration:none}</style><section><strong>学习通 · DeepSeek 网页桥接（实验）</strong><p>支持题干及选项图片。此标签页会上传图片、发送题目，每个会话最多使用 50 次，并保存在当前账号历史中。遇到请求频率限制会每 3 秒点击当前消息的重试按钮（最多额外等待 10 分钟）。启用后请勿在此页手动聊天。</p><p role="status"></p><nav><button type="button">启用此标签页</button><a href="https://chat.deepseek.com/#xth-bridge">空白新对话</a></nav></section>';
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
			conversationPath = '',
			suspended = false;
		let saved: { owner?: string; uses?: number; lastId?: string; path?: string } = {};
		try {
			saved = JSON.parse(sessionStorage.getItem(CONTEXT_KEY) || '{}');
		} catch {
			/* Older receiver. */
		}
		if (remembered && saved?.owner === remembered) {
			conversationUses = Math.max(0, Math.min(WEB_CONVERSATION_LIMIT, Number(saved.uses) || 0));
			lastAnswerId = typeof saved.lastId === 'string' ? saved.lastId : '';
			conversationPath = typeof saved.path === 'string' ? saved.path : '';
		}
		const saveContext = () =>
			sessionStorage.setItem(
				CONTEXT_KEY,
				JSON.stringify({
					owner,
					uses: conversationUses,
					lastId: lastAnswerId,
					path: conversationPath
				})
			);
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
				supportsPause: true,
				supportsRecovery: true,
				conversationUses,
				status: state,
				updatedAt: Date.now()
			});
		const stop = (message: string) => {
			enabled = false;
			sessionStorage.removeItem(SESSION_KEY);
			sessionStorage.removeItem(CONTEXT_KEY);
			if (ownsLease()) publish('disabled');
			toggle.textContent = '启用此标签页';
			say(message);
		};
		const failPending = (message: string) => {
			if (!activeKey || !ownsLease()) return;
			const req = GM_getValue<WebRequest | undefined>(activeKey, undefined);
			if (req && req.status === 'processing')
				GM_setValue(activeKey, { ...req, status: 'error', prompt: undefined, images: undefined, error: message });
		};
		const consume = async () => {
			if (!enabled || busy || suspended) return;
			if (!ownsLease()) {
				stop('另一个标签页接管了连接，请重新确认。');
				return;
			}
			const now = Date.now();
			const waiting: [string, WebRequest][] = [];
			for (const key of GM_listValues().filter((key) => key.startsWith(REQUEST_PREFIX))) {
				const req = GM_getValue<WebRequest | undefined>(key, undefined);
				if (req && req.bridgeId !== owner) continue;
				if (!req || (!req.paused && req.recoveryAt === undefined && now - req.createdAt > QUEUE_TIMEOUT)) {
					GM_deleteValue(key);
					continue;
				}
				if (req.bridgeId === owner && (req.status === 'queued' || req.status === 'processing') && !req.paused)
					waiting.push([key, req]);
			}
			waiting.sort(
				(a, b) =>
					Number(b[1].status === 'processing') - Number(a[1].status === 'processing') || a[1].createdAt - b[1].createdAt
			);
			if (!waiting.length) return;
			const [key, req] = waiting[0];
			const resumeOnly = req.status === 'processing';
			if (!resumeOnly && (!req.prompt || req.prompt.length > 61000)) {
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
				let startedAt = req.startedAt || Date.now();
				let deadlineAt = req.deadlineAt || startedAt + req.timeout;
				if (resumeOnly) {
					if (!adapter.resume) throw new Error('当前网页适配器不支持恢复，请检查原消息后补全未完成。');
					const mountDeadline = Date.now() + 30000;
					while (!cancelled() && !adapter.resume(req.id, req.rateLimitRetries)) {
						if (Date.now() >= mountDeadline) throw new Error('未找到原题目消息，请检查登录或原对话；不会重复发送。');
						await sleep(500);
					}
					if (cancelled()) return;
					deadlineAt = recoverMailbox(key)?.deadlineAt || deadlineAt;
					conversationUses = Math.max(1, conversationUses);
				} else {
					assertWebActivity(req.activityId);
					validateWebImages(req.images || []);
					if (conversationUses === 0) adapter.assertEmpty();
					else {
						adapter.assertReady();
						if (location.pathname !== conversationPath || !adapter.readCompleted(lastAnswerId))
							throw new Error('专用页对话已改变或上一回答无法确认，请从空白新对话重新启用。');
					}
					startedAt = Date.now();
					deadlineAt = startedAt + req.timeout;
					// Claim before calling submit: a refresh here can only reattach, never submit twice.
					GM_setValue(key, { ...req, status: 'processing', startedAt, deadlineAt });
					await adapter.submit(req.prompt!, cancelled, req.images, req.id);
					if (cancelled()) throw new Error('请求已取消，已停止重试。');
					deadlineAt = Math.max(deadlineAt, GM_getValue<WebRequest>(key).deadlineAt || 0);
					GM_setValue(key, {
						...GM_getValue<WebRequest>(key),
						status: 'processing',
						startedAt,
						deadlineAt,
						prompt: undefined,
						images: undefined
					});
					conversationUses++;
				}
				conversationPath = location.pathname;
				saveContext();
				let lastLoopAt = Date.now();
				let lastLoopAccounted = (req.pausedTotal || 0) + (req.recoveryTotal || 0);
				let previous = '',
					stableAt = 0,
					limitedAt = 0,
					rateLimitRetries = req.rateLimitRetries || 0;
				while (!cancelled()) {
					if (suspended) {
						await sleep(300);
						continue;
					}
					const snapshot = GM_getValue<WebRequest>(key);
					const accounted = (snapshot.pausedTotal || 0) + (snapshot.recoveryTotal || 0);
					const gap = Date.now() - lastLoopAt - Math.max(0, accounted - lastLoopAccounted);
					if (gap > HEARTBEAT_AGE && !snapshot.paused) beginRecovery(key, Date.now() - gap);
					lastLoopAt = Date.now();
					const current = recoverMailbox(key)!;
					lastLoopAccounted = (current.pausedTotal || 0) + (current.recoveryTotal || 0);
					deadlineAt = Math.max(deadlineAt, current.deadlineAt || 0);
					if (current.paused) {
						await sleep(300);
						continue;
					}
					const answer = adapter.readCompleted(req.id);
					if (!answer && Date.now() >= deadlineAt) break;
					const recovery = answer ? undefined : adapter.retryRateLimited?.(req.id, cancelled);
					if (recovery) {
						const now = Date.now();
						// Reserve the bounded retry budget immediately. Extending by tiny timer deltas
						// makes foreground callers time out if this receiver is background-throttled.
						const extendedDeadline =
							startedAt +
							req.timeout +
							WEB_RATE_LIMIT_MAX_WAIT +
							(current.pausedTotal || 0) +
							(current.recoveryTotal || 0);
						if (deadlineAt !== extendedDeadline || rateLimitRetries !== recovery.attempts) {
							deadlineAt = extendedDeadline;
							rateLimitRetries = recovery.attempts;
							const current = GM_getValue<WebRequest | undefined>(key, undefined);
							if (current?.status === 'processing') GM_setValue(key, { ...current, deadlineAt, rateLimitRetries });
						}
						limitedAt = now;
						say('DeepSeek 请求频率受限 · 每 3 秒重试当前消息 · 已重试 ' + rateLimitRetries + ' 次；可随时停止。');
					} else if (limitedAt) {
						limitedAt = 0;
						say('限流提示已消失，正在等待当前回答完成…');
					}
					if (answer && answer === previous && Date.now() - stableAt >= 1200) {
						GM_setValue(key, {
							...GM_getValue<WebRequest>(key),
							status: 'done',
							startedAt,
							prompt: undefined,
							images: undefined,
							answer
						});
						activeKey = '';
						lastAnswerId = req.id;
						conversationPath = location.pathname;
						saveContext();
						if (conversationUses >= WEB_CONVERSATION_LIMIT) {
							resetting = true;
							conversationUses = 0;
							lastAnswerId = '';
							conversationPath = '';
							saveContext();
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
				throw new Error(
					cancelled()
						? '请求已取消，已停止重试。'
						: limitedAt
						? '限流等待已达上限；请稍后检查专用页，不会重新发送题目。'
						: '回答超时。请检查登录、验证码或网页结构；不会重新发送题目。'
				);
			} catch (error) {
				if (!ownsLease()) return;
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
				const pending = GM_listValues().some(
					(key) =>
						key.startsWith(REQUEST_PREFIX) &&
						GM_getValue<WebRequest | undefined>(key, undefined)?.bridgeId === owner &&
						GM_getValue<WebRequest>(key).status === 'processing'
				);
				if (!resume || (!pending && conversationUses === 0)) adapter.assertEmpty();
				else if (!pending) {
					adapter.assertReady();
					if (location.pathname !== conversationPath || !lastAnswerId || !adapter.readCompleted(lastAnswerId))
						throw new Error('原专用会话尚未加载，等待恢复。');
				}
				const existing = getWebBridgeState();
				if (existing && (existing.id !== owner || (existing.instance !== instance && existing.status !== 'reloading')))
					throw new Error('已有另一个专用标签页连接，请先在原标签页停止。');
				if (!resume) {
					owner = uuid();
					conversationUses = 0;
					lastAnswerId = '';
					conversationPath = '';
				}
				suspended = false;
				publish('ready');
				await sleep(150); // Confirm exclusive ownership before consuming a mailbox.
				if (!ownsLease()) throw new Error('连接被其他标签页占用。');
				sessionStorage.setItem(SESSION_KEY, owner);
				saveContext();
				enabled = true;
				toggle.textContent = '停止桥接';
				say(idleMessage());
			} catch (error) {
				if (resume) throw error;
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
		// Prior explicit consent is kept in this tab only. Reattach by nonce after a reload.
		if (remembered) {
			const prior = GM_getValue<BridgeState | undefined>(WEB_BRIDGE_STATE, undefined);
			if (!prior || prior.id !== owner || prior.status === 'disabled')
				stop('此标签页需要重新启用；不接管其他正在运行的标签页。');
			else
				void (async () => {
					for (let i = 0; i < 60; i++) {
						if (sessionStorage.getItem(SESSION_KEY) !== owner) return;
						try {
							await enable(true);
							return;
						} catch {
							await sleep(500);
						}
					}
					stop('原会话未能恢复，请检查登录、验证码及原题目消息后重新启用。');
				})();
		} else say('未启用。请先登录并打开空白新对话。');

		const tick = () => {
			try {
				if (enabled && !suspended && ownsLease()) {
					publish(resetting ? 'reloading' : busy ? 'busy' : 'ready');
					serviceWebActivities(owner, busy);
				}
				void consume().catch((error) => stop(String(error)));
			} catch (error) {
				failPending(String(error));
				stop(String(error));
			}
		};
		let wakeListener: number | undefined;
		let servicing = false;
		const startServices = () => {
			if (servicing) return;
			servicing = true;
			heartbeat = setInterval(tick, 1000);
			wakeListener =
				typeof GM_addValueChangeListener === 'function'
					? GM_addValueChangeListener(WEB_BRIDGE_WAKE, () => tick())
					: undefined;
			document.addEventListener('visibilitychange', tick);
		};
		const stopServices = () => {
			servicing = false;
			clearInterval(heartbeat);
			document.removeEventListener('visibilitychange', tick);
			if (wakeListener !== undefined && typeof GM_removeValueChangeListener === 'function')
				GM_removeValueChangeListener(wakeListener);
			wakeListener = undefined;
		};
		startServices();
		window.addEventListener('pageshow', () => {
			suspended = false;
			try {
				if (activeKey && ownsLease()) recoverMailbox(activeKey);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				failPending(message);
				stop(message);
			}
			startServices();
			tick();
		});

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
		window.addEventListener('pagehide', () => {
			stopServices();
			suspended = true;
			if (enabled && ownsLease()) {
				if (activeKey) beginRecovery(activeKey);
				saveContext();
				publish('reloading');
				say('页面暂时离开，保留原请求；恢复后自动继续，不重复发送。');
			}
		});
	};
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
	else mount();
}
