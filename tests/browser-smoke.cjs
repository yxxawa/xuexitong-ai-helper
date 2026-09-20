const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..');
const candidates = [
	process.env.CHROME_PATH,
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/usr/bin/chromium',
	'/usr/bin/google-chrome'
].filter(Boolean);
const executablePath = candidates.find((file) => fs.existsSync(file));
const source = fs.readFileSync(path.join(root, 'dist/xuexitong-ai-helper.common.user.js'), 'utf8');
(async () => {
	const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
	try {
		async function fixture(url) {
			const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
			const errors = [];
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('console', (message) => {
				if (message.type() === 'error') errors.push(message.text());
			});
			await page.route('**/*', (route) =>
				route.fulfill({
					contentType: 'text/html; charset=utf-8',
					body: '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>'
				})
			);
			await page.goto(url);
			await page.evaluate(() => {
				const attach = Element.prototype.attachShadow;
				Element.prototype.attachShadow = function (init) {
					return attach.call(this, { ...init, mode: 'open' });
				};
				window.unsafeWindow = window;
				const fillText = CanvasRenderingContext2D.prototype.fillText;
				CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
					window.__probeText = String(text);
					return fillText.call(this, text, ...args);
				};
				const values = new Map(),
					listeners = new Map();
				let tab = {},
					next = 1;
				window.__stored = values;
				window.__requests = [];
				window.GM_info = { scriptHandler: 'Tampermonkey', script: { version: 'regression-test' } };
				window.GM_getValue = (key, fallback) => (values.has(key) ? structuredClone(values.get(key)) : fallback);
				// Deliberately suppress change callbacks: clicking a tab must still render it immediately.
				window.GM_setValue = (key, value) => {
					values.set(key, structuredClone(value));
				};
				window.GM_deleteValue = (key) => values.delete(key);
				window.GM_listValues = () => [...values.keys()];
				window.GM_getTab = (callback) => setTimeout(() => callback(structuredClone(tab)), 5);
				window.GM_saveTab = (value) => {
					tab = structuredClone(value);
				};
				window.GM_addValueChangeListener = (key, fn) => {
					const id = next++;
					listeners.set(id, { key, fn });
					return id;
				};
				window.GM_removeValueChangeListener = (id) => listeners.delete(id);
				window.GM_notification = () => {};
				window.GM_getResourceText = () => '';
				window.GM_xmlhttpRequest = (opts) => {
					window.__requests.push({ url: opts.url, data: opts.data });
					const hasImage = String(opts.data || '').includes('image_url');
					const answer = hasImage ? window.__probeText : '测试答案';
					const response = opts.url.endsWith('/models')
						? { data: Array.from({ length: 120 }, (_, i) => ({ id: 'custom-model-' + i })) }
						: {
								choices: [{ message: { content: JSON.stringify({ answer, answers: [answer] }) } }],
								usage: { total_tokens: 5 }
						  };
					setTimeout(() => opts.onload?.({ status: 200, response, responseText: JSON.stringify(response) }), 120);
					return { abort() {} };
				};
			});
			await page.addScriptTag({ content: '(function(){' + source + '\n})();' });
			return { page, errors };
		}
		const { page, errors } = await fixture('https://i.chaoxing.com/base');
		await page.waitForSelector('.xth-shell-nav-item');
		const container = page.locator('container-element');
		for (const [label, expected] of [
			['手动搜题', '手动搜题'],
			['网课', '课程学习'],
			['作业/考试', '答题结果'],
			['首页', '首页']
		]) {
			await page.getByRole('button', { name: label, exact: true }).click();
			await page.waitForFunction(
				(name) =>
					[...document.querySelectorAll('*')].some(
						(el) => el.shadowRoot?.querySelector('container-element')?.getAttribute('data-panel-name') === name
					),
				expected
			);
		}
		assert.ok((await page.locator('.cx-ai-home').innerText()).length < 260, 'home must stay concise');
		const light = await container.evaluate((el) => getComputedStyle(el).backgroundColor);
		await page.emulateMedia({ colorScheme: 'dark' });
		const dark = await container.evaluate((el) => getComputedStyle(el).backgroundColor);
		assert.notEqual(dark, light);
		assert.equal(dark, 'rgb(23, 29, 40)');
		fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
		await page.screenshot({ animations: 'disabled', path: path.join(root, 'test-results/home-dark.png') });
		await page.emulateMedia({ colorScheme: 'light' });
		await page.screenshot({ animations: 'disabled', path: path.join(root, 'test-results/home-light.png') });
		await page.getByRole('button', { name: '设置', exact: true }).click();
		const field = (id) => page.locator('[id="common.settings.' + id + '"]');
		await page.emulateMedia({ colorScheme: 'dark' });
		await field('aiApiUrl').focus();
		assert.ok(
			['rgb(23, 29, 40)', 'rgb(32, 41, 56)'].includes(
				await field('aiApiUrl').evaluate((el) => getComputedStyle(el).backgroundColor)
			),
			'focused fields must stay dark'
		);
		await field('aiModelFetchButton').evaluate((el) => {
			el.disabled = true;
		});
		assert.notEqual(
			await field('aiModelFetchButton').evaluate((el) => getComputedStyle(el).backgroundColor),
			'rgb(255, 255, 255)',
			'disabled buttons must stay dark'
		);
		await field('aiModelFetchButton').evaluate((el) => {
			el.disabled = false;
		});
		// Check the formerly bright-red high-specificity config buttons and long error copy.
		await field('aiModelFetchButton').evaluate((el) => el.classList.add('danger'));
		const dangerColors = await field('aiModelFetchButton').evaluate((el) => {
			const css = getComputedStyle(el);
			return { color: css.color, background: css.backgroundColor, border: css.borderColor };
		});
		assert.deepEqual(dangerColors, {
			color: 'rgb(224, 199, 205)',
			background: 'rgb(48, 40, 48)',
			border: 'rgb(103, 80, 91)'
		});
		await field('aiModelFetchButton').hover();
		assert.equal(
			await field('aiModelFetchButton').evaluate((el) => getComputedStyle(el).backgroundColor),
			'rgb(60, 48, 59)'
		);
		await field('aiModelFetchButton').evaluate((el) => {
			el.disabled = true;
		});
		assert.equal(await field('aiModelFetchButton').evaluate((el) => getComputedStyle(el).color), 'rgb(165, 178, 197)');
		await field('aiModelFetchButton').evaluate((el) => {
			el.disabled = false;
			el.classList.remove('danger');
		});
		const errorColor = await container.evaluate((el) => {
			const box = document.createElement('div');
			box.className = 'alert-info-wrapper';
			box.innerHTML = '<span class="error">错误详情应保持可读，避免整段亮红色</span>';
			el.getRootNode().append(box);
			const color = getComputedStyle(box.firstChild).color;
			box.remove();
			return color;
		});
		assert.equal(errorColor, 'rgb(229, 234, 243)');
		assert.equal(
			await page.locator('[id="common.settings.aiPrompt"]').count(),
			0,
			'custom output prompt is no longer configurable'
		);
		await field('aiProvider').selectOption('deepseek-web');
		await page.waitForTimeout(80);
		assert.equal(await field('aiModel').isDisabled(), true);
		assert.equal(await field('aiWebConnectButton').isVisible(), true);
		assert.match(await page.locator('#xth-vision-status').innerText(), /网页未连接/);
		await field('aiProvider').selectOption('api');
		await page.waitForTimeout(80);
		assert.equal(await field('aiModel').isDisabled(), false);
		assert.equal(await field('aiWebConnectButton').isVisible(), false);
		await field('aiApiUrl').fill('https://gateway.test/v1');
		await field('aiApiUrl').blur();
		await field('aiApiKey').fill('fixture-key');
		await field('aiApiKey').blur();
		await field('aiModel').fill('my-unlisted-model');
		await field('aiModel').blur();
		assert.equal(await page.evaluate(() => window.__stored.get('common.settings.aiModel')), 'my-unlisted-model');
		await field('aiModelFetchButton').click();
		await page.waitForFunction(() =>
			[...document.querySelectorAll('*')].some(
				(el) => el.shadowRoot?.querySelectorAll('#xth-ai-models option').length === 120
			)
		);
		assert.equal(
			await field('aiModel').inputValue(),
			'my-unlisted-model',
			'fetching models must not overwrite manual input'
		);
		await field('aiVisionTestButton').click();
		await page.waitForSelector('modal-element');
		assert.match(await page.locator('modal-element').innerText(), /检测通过/);
		assert.match(await page.locator('#xth-vision-status').innerText(), /图片检测通过/);
		assert.notEqual(
			await page.locator('modal-element').evaluate((el) => getComputedStyle(el).backgroundColor),
			'rgb(255, 255, 255)'
		);
		assert.notEqual(
			await page.locator('.modal-confirm-button').evaluate((el) => getComputedStyle(el).backgroundColor),
			'rgb(255, 255, 255)'
		);
		await page.locator('.modal-confirm-button').evaluate((el) => el.classList.add('danger'));
		await page.mouse.move(0, 0);
		assert.equal(
			await page.locator('.modal-confirm-button').evaluate((el) => getComputedStyle(el).backgroundColor),
			'rgb(48, 40, 48)'
		);
		await page.screenshot({ animations: 'disabled', path: path.join(root, 'test-results/settings-dark.png') });
		await page.locator('.modal-confirm-button').click();
		await page.getByRole('button', { name: '手动搜题', exact: true }).click();
		const textarea = page.locator('[id="common.online-search.searchValue"]');
		await textarea.fill('  测试题目  ');
		await textarea.blur();
		await page.getByRole('button', { name: '搜索', exact: true }).click();
		await page.waitForTimeout(180);
		await page.getByRole('button', { name: '搜索', exact: true }).click();
		await page.waitForTimeout(180);
		const requestCount = await page.evaluate(
			() =>
				window.__requests.filter(
					(item) => item.url.endsWith('/chat/completions') && String(item.data).includes('测试题目')
				).length
		);
		assert.equal(requestCount, 1, 'second search should hit cache');
		await page.getByRole('button', { name: '首页', exact: true }).click();
		await page.setViewportSize({ width: 375, height: 700 });
		await page.emulateMedia({ colorScheme: 'dark' });
		await page.waitForTimeout(150);
		const rect = await container.boundingBox();
		assert.ok(rect.x >= 0 && rect.x + rect.width <= 376, 'panel should fit a narrow viewport');
		await page.screenshot({ animations: 'disabled', path: path.join(root, 'test-results/home-mobile.png') });
		assert.deepEqual(errors, []);
		await page.close();
		for (const url of [
			'https://school.edu.cn/',
			'https://notchaoxing.com/',
			'https://chaoxing.com.attacker.test/',
			'https://chat.deepseek.com/'
		]) {
			const { page, errors } = await fixture(url);
			assert.equal(await page.locator('container-element').count(), 0, 'must not run on ' + url);
			assert.equal(await page.evaluate(() => window.XUEXITONG_AI_HELPER_BOOTED), undefined);
			assert.deepEqual(errors, []);
			await page.close();
		}
		console.log(
			'PASS: direct navigation without storage callbacks, empty-page mounting, system theme switching, model free input/filtering, cache hits, narrow screens and learning-platform-only scope.'
		);
	} finally {
		await browser.close();
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
