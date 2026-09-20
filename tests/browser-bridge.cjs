// All pages and AI replies are local fixtures: no account, token, or remote service is used.
const fs = require('node:fs'),
	path = require('node:path'),
	assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const executablePath =
	process.env.CHROME_PATH ||
	[
		'C:/Program Files/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
		'/usr/bin/chromium',
		'/usr/bin/google-chrome'
	].find((p) => fs.existsSync(p));
const source = fs.readFileSync(path.join(__dirname, '../dist/xuexitong-ai-helper.common.user.js'), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, message, timeout = 30000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (await fn()) return;
		await wait(100);
	}
	throw Error(message);
}
(async () => {
	const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
	try {
		const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' });
		const store = new Map([['common.settings.aiProvider', 'deepseek-web']]),
			prompts = [],
			errors = [];
		await context.exposeBinding('__gmBroadcast', async ({ page }, key, value, remove) => {
			if (remove) store.delete(key);
			else store.set(key, value);
			await Promise.all(
				context
					.pages()
					.filter((p) => p !== page && !p.isClosed())
					.map((p) =>
						p
							.evaluate(({ key, value, remove }) => window.__accept?.(key, value, remove, true), { key, value, remove })
							.catch(() => {})
					)
			);
		});
		await context.exposeBinding('__sent', (_, prompt) => {
			prompts.push(prompt);
		});
		await context.route('**/*', (route) => {
			const url = new URL(route.request().url());
			if (url.pathname === '/__app.js')
				return route.fulfill({ contentType: 'application/javascript', body: '(function(){' + source + '\n})();' });
			if (url.pathname === '/__init.js')
				return route.fulfill({
					contentType: 'application/javascript',
					body:
						'window.__seed=' +
						JSON.stringify([...store]).replace(/</g, '\\u003c') +
						';(' +
						function () {
							const attach = Element.prototype.attachShadow;
							Element.prototype.attachShadow = function (opts) {
								return attach.call(this, { ...opts, mode: 'open' });
							};
							const values = new Map(window.__seed),
								listeners = new Map();
							let next = 1,
								tab = {};
							window.unsafeWindow = window;
							window.typrMapping = { fixture: 65 };
							window.__accept = (key, value, remove, remote) => {
								const old = values.get(key);
								if (remove) values.delete(key);
								else values.set(key, value);
								for (const { name, fn } of listeners.values()) if (name === key) fn(key, old, value, remote);
							};
							window.GM_getValue = (key, fallback) => (values.has(key) ? structuredClone(values.get(key)) : fallback);
							window.GM_setValue = (key, value) => {
								window.__accept(key, structuredClone(value), false, false);
								void window.__gmBroadcast(key, value, false);
							};
							window.GM_deleteValue = (key) => {
								window.__accept(key, undefined, true, false);
								void window.__gmBroadcast(key, undefined, true);
							};
							window.GM_listValues = () => [...values.keys()];
							window.GM_getTab = (fn) => setTimeout(() => fn({ ...tab }), 1);
							window.GM_saveTab = (value) => {
								tab = value;
							};
							window.GM_addValueChangeListener = (name, fn) => {
								const id = next++;
								listeners.set(id, { name, fn });
								return id;
							};
							window.GM_removeValueChangeListener = (id) => listeners.delete(id);
							window.GM_info = { scriptHandler: 'Tampermonkey', script: { version: 'bridge-fixture' } };
							window.GM_getResourceText = () => '';
							window.GM_notification = () => {};
							window.GM_xmlhttpRequest = () => {
								throw Error('Web mode must not call an API');
							};
						}.toString() +
						')();'
				});
			const deep = url.hostname === 'chat.deepseek.com';
			const html = deep
				? '<form><textarea id="chat-input" placeholder="给 DeepSeek 发送消息"></textarea><button type="submit">发送</button></form><main id="messages"></main><script>(' +
				  function () {
						document.querySelector('form').onsubmit = (event) => {
							event.preventDefault();
							const input = document.querySelector('textarea'),
								prompt = input.value;
							if (!prompt) return;
							input.value = '';
							void window.__sent(prompt);
							const nonce = prompt.match(/([a-f0-9]{32})$/)?.[1];
							const stop = document.createElement('button');
							stop.setAttribute('aria-label', 'Stop generating');
							document.body.append(stop);
							setTimeout(() => {
								stop.remove();
								const section = document.createElement('section'),
									markdown = document.createElement('div');
								markdown.className = 'ds-markdown';
								markdown.textContent = JSON.stringify({ _bridge_id: nonce, answer: 'A', answers: ['A'] });
								section.append(markdown);
								for (let i = 0; i < 3; i++) {
									const b = document.createElement('button');
									b.className = 'ds-icon-button';
									b.textContent = '操作';
									section.append(b);
								}
								document.getElementById('messages').append(section);
							}, window.__replyDelay || 500);
						};
				  }.toString() +
				  ')();</script>'
				: url.pathname === '/mooc2/work/dowork'
				? [1, 2]
						.map(
							(i) =>
								'<div class="questionLi"><h3>自动测试题 ' +
								i +
								'</h3><input type="hidden" id="answertype' +
								i +
								'" value="0"><div class="answerBg"><div class="answer_p">选项甲</div><div class="answer_p">选项乙</div></div></div>'
						)
						.join('')
				: '';
			return route.fulfill({
				contentType: 'text/html; charset=utf-8',
				body:
					'<!doctype html><html><head><script src="/__init.js"></script></head><body>' +
					html +
					'<script src="/__app.js"></script></body></html>'
			});
		});
		const receiver = await context.newPage();
		receiver.on('pageerror', (e) => errors.push(e.message));
		await receiver.goto('https://chat.deepseek.com/#xth-bridge');
		assert.equal(await receiver.locator('container-element').count(), 0);
		await receiver.getByRole('button', { name: '启用此标签页', exact: true }).click();
		await until(() => store.get('xth.web.bridge.v1')?.status === 'ready', 'bridge not ready');
		const receiver2 = await context.newPage();
		await receiver2.goto('https://chat.deepseek.com/#xth-bridge');
		await receiver2.getByRole('button', { name: '启用此标签页', exact: true }).click();
		assert.match(await receiver2.locator('[role=status]').innerText(), /已有另一个/);
		await receiver2.close();
		const clients = [];
		for (let i = 0; i < 2; i++) {
			const p = await context.newPage();
			p.on('pageerror', (e) => errors.push(e.message));
			await p.goto('https://i.chaoxing.com/base');
			await p.getByRole('button', { name: '手动搜题', exact: true }).click();
			await p.locator('[id="common.online-search.searchValue"]').fill('网页题目 ' + i);
			await p.locator('[id="common.online-search.searchValue"]').blur();
			clients.push(p);
		}
		for (const [i, p] of clients.entries()) {
			await p.getByRole('button', { name: '手动搜题', exact: true }).click();
			await p.locator('[id="common.online-search.searchValue"]').fill('网页题目 ' + i);
			await p.locator('[id="common.online-search.searchValue"]').blur();
			await p.getByRole('button', { name: '搜索', exact: true }).click();
			await until(() => prompts.length === i + 1, 'manual prompt not sent');
			await until(
				() =>
					![...store.keys()].some((k) => k.startsWith('xth.web.request') || k.startsWith('xth.web.activity.request')),
				'search lease did not release'
			);
			await clients[1 - i].getByRole('button', { name: '搜索', exact: true }).waitFor();
		}
		await until(() => prompts.length === 2, 'both prompts were not sent').catch(async (e) => {
			console.log(
				'bridge diagnostic',
				{
					prompts: prompts.length,
					state: store.get('xth.web.bridge.v1'),
					queue: [...store]
						.filter(([k]) => k.startsWith('xth.web.request'))
						.map(([k, v]) => ({ id: k, status: v.status, error: v.error }))
				},
				await receiver.locator('[role=status]').innerText()
			);
			throw e;
		});
		await until(() => ![...store.keys()].some((k) => k.startsWith('xth.web.request')), 'request content did not clear');
		await until(() => store.get('xth.web.bridge.v1')?.status === 'ready', 'receiver did not recover after new chat');
		assert.equal(prompts.filter((p) => p.includes('网页题目 0')).length, 1);
		assert.equal(prompts.filter((p) => p.includes('网页题目 1')).length, 1);
		assert.notEqual(prompts[0].match(/[a-f0-9]{32}$/)[0], prompts[1].match(/[a-f0-9]{32}$/)[0]);
		assert.equal(await receiver.locator('.ds-markdown').count(), 2, 'first two questions must share one conversation');
		assert.equal(store.get('xth.web.bridge.v1').conversationUses, 2);
		for (const p of clients)
			assert.ok(
				(await p.locator('search-infos-element, .search-info-details').count()) > 0,
				'client should show an answer'
			);

		// Local work-page fixture: show all questions while its AI response is pending.
		await receiver.evaluate(() => {
			window.__replyDelay = 3000;
		});
		const workPage = await context.newPage();
		workPage.on('pageerror', (error) => {
			errors.push(error.message);
			console.error('work fixture', error.stack);
		});
		await workPage.goto('https://mooc1.chaoxing.com/mooc2/work/dowork');
		await workPage.getByText('点击取消', { exact: true }).click();
		await workPage.getByRole('button', { name: '作业/考试', exact: true }).click();
		const startWork = workPage.getByRole('button', { name: '▶️开始答题', exact: true });
		await startWork.waitFor();
		await clients[0].locator('[id="common.online-search.searchValue"]').fill('互斥验证题');
		await clients[0].locator('[id="common.online-search.searchValue"]').blur();
		await clients[0].getByRole('button', { name: '搜索', exact: true }).click();
		await until(() => prompts.length === 3, 'manual test question not sent');
		await until(() => startWork.isDisabled(), 'automatic work should be disabled during manual search');
		await until(
			() => ![...store.keys()].some((k) => k.startsWith('xth.web.activity.request')),
			'manual lease not released'
		);
		await until(async () => !(await startWork.isDisabled()), 'automatic start should recover');
		await startWork.click();
		await until(() => prompts.length === 4, 'work question not sent');
		assert.equal(await workPage.locator('.work-result-list .search-infos-num').count(), 2);
		assert.equal(await workPage.locator('.work-result-list .search-infos-num.requested').count(), 0);
		await until(
			async () => clients[0].getByRole('button', { name: '自动答题中，暂不可搜索', exact: true }).isDisabled(),
			'search button should be disabled'
		);
		await until(() => prompts.length === 5, 'second work question not sent');
		await until(
			() => ![...store.keys()].some((k) => k.startsWith('xth.web.activity.request')),
			'worker did not release lease'
		);
		await workPage.close();
		await receiver.evaluate(() => {
			window.__replyDelay = 500;
		});
		// The next question is interrupted. It must fail rather than being sent again or using another answer.
		const p = clients[0];
		await p.locator('[id="common.online-search.searchValue"]').fill('第三题取消');
		await p.locator('[id="common.online-search.searchValue"]').blur();
		await p.getByRole('button', { name: '搜索', exact: true }).click();
		await until(() => prompts.length === 6, 'final prompt not sent');
		await receiver.getByRole('button', { name: '停止桥接', exact: true }).click();
		await until(
			() => ![...store.keys()].some((k) => k.startsWith('xth.web.request')),
			'cancelled request did not clean up'
		);
		await wait(1500);
		assert.equal(prompts.length, 6);
		assert.deepEqual(errors, []);
		console.log(
			'PASS: opt-in web bridge, exclusive receiver, two cross-origin clients, serial reuse of one chat, pending work panel, two-way cross-tab activity exclusion, request nonce matching, cleanup and cancellation without retry.'
		);
	} finally {
		await browser.close();
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
