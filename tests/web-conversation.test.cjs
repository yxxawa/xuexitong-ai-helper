const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadTS } = require('./load-ts.cjs');
const { startDeepSeekBridge, WEB_BRIDGE_STATE, WEB_CONVERSATION_LIMIT } = loadTS(
	'packages/scripts/src/utils/web-ai.ts'
);

test('receiver reuses a conversation for 50 sends and resumes the 51st in a new conversation', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
	const previous = Object.fromEntries(['window', 'document', 'location', 'sessionStorage'].map((k) => [k, global[k]]));
	const store = new Map(),
		session = new Map();
	global.GM_getValue = (key, fallback) => store.get(key) ?? fallback;
	global.GM_setValue = (key, value) => store.set(key, value);
	global.GM_deleteValue = (key) => store.delete(key);
	global.GM_listValues = () => [...store.keys()];
	const pages = [],
		sends = [];
	let current = '',
		resets = 0,
		inConversation = 0;
	const adapter = {
		id: 'deepseek-web',
		supportsImages: true,
		assertEmpty() {
			assert.equal(inConversation, 0);
		},
		assertReady() {},
		async submit(prompt) {
			current = prompt;
			sends.push({ prompt, conversation: resets });
			inConversation++;
		},
		readCompleted(id) {
			return current === id ? JSON.stringify({ _bridge_id: id, answer: 'A' }) : undefined;
		},
		reset() {
			global.window.dispatchEvent(new global.window.Event('pagehide'));
			resets++;
			inConversation = 0;
			current = '';
			mount();
		}
	};
	function mount() {
		const dom = new JSDOM('<body></body>', { url: 'https://chat.deepseek.com/#xth-bridge' });
		pages.push(dom);
		global.window = dom.window;
		global.document = dom.window.document;
		global.location = dom.window.location;
		global.sessionStorage = {
			getItem: (k) => session.get(k) || null,
			setItem: (k, v) => session.set(k, v),
			removeItem: (k) => session.delete(k)
		};
		startDeepSeekBridge(adapter);
		document.dispatchEvent(new window.Event('DOMContentLoaded'));
	}
	async function advance(ms = 100) {
		t.mock.timers.tick(ms);
		for (let i = 0; i < 12; i++) await Promise.resolve();
	}
	async function until(predicate) {
		for (let i = 0; i < 120; i++) {
			if (predicate()) return;
			await advance();
		}
		assert.ok(predicate(), 'fake-time bridge did not progress');
	}
	try {
		assert.equal(WEB_CONVERSATION_LIMIT, 50);
		mount();
		document.getElementById('xth-deepseek-bridge').shadowRoot.querySelector('button').click();
		await until(() => store.get(WEB_BRIDGE_STATE)?.status === 'ready');
		await advance(200);
		const owner = store.get(WEB_BRIDGE_STATE).id;
		for (let i = 1; i <= 51; i++) {
			const key = 'xth.web.request.v1.turn-' + i;
			store.set(key, {
				id: 'turn-' + i,
				bridgeId: owner,
				status: 'queued',
				createdAt: Date.now(),
				timeout: 30000,
				prompt: 'turn-' + i
			});
			await until(() => store.get(key)?.status === 'done');
			assert.equal(store.get(key).prompt, undefined);
			store.delete(key);
			await until(() => store.get(WEB_BRIDGE_STATE)?.status === 'ready');
			await advance(200);
			assert.equal(resets, i < 50 ? 0 : 1, 'only reset after the 50th confirmed send');
		}
		assert.equal(sends.length, 51);
		assert.ok(sends.slice(0, 50).every((s) => s.conversation === 0));
		assert.equal(sends[50].conversation, 1);
		assert.equal(store.get(WEB_BRIDGE_STATE).conversationUses, 1);
	} finally {
		window.dispatchEvent(new window.Event('pagehide'));
		pages.forEach((dom) => dom.window.close());
		for (const [key, value] of Object.entries(previous))
			if (value === undefined) delete global[key];
			else global[key] = value;
		t.mock.timers.reset();
	}
});
