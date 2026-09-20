// Local fixture mirrors native file-input clearing, attachment previews and current role=button controls.
const assert = require('node:assert/strict'),
	fs = require('node:fs'),
	path = require('node:path');
const ts = require('typescript'),
	{ chromium } = require('playwright-core');
const executablePath =
	process.env.CHROME_PATH ||
	[
		'C:/Program Files/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
		'/usr/bin/chromium',
		'/usr/bin/google-chrome'
	].find((p) => fs.existsSync(p));
const source = ts.transpileModule(
	fs.readFileSync(path.join(__dirname, '../packages/scripts/src/utils/deepseek-web.ts'), 'utf8'),
	{ compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }
).outputText;
(async () => {
	const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
	try {
		const page = await browser.newPage();
		async function fixture(mode = 'success') {
			await page.setContent(
				'<main><form><div id="attachments"></div><div><textarea id="chat-input"></textarea><input type="file" multiple hidden><div role="button" class="ds-button ds-button--primary ds-button--circle" style="width:30px;height:30px">发送</div></div></form></main>'
			);
			await page.evaluate(
				({ source, mode }) => {
					const exports = {};
					new Function('exports', source)(exports);
					window.adapter = exports.deepSeekAdapter;
					window.sent = [];
					window.keys = 0;
					const input = document.querySelector('textarea'),
						fileInput = document.querySelector('input'),
						send = document.querySelector('[role="button"]');
					input.onkeydown = () => window.keys++;
					fileInput.onchange = () => {
						const files = [...fileInput.files];
						fileInput.value = ''; // Real site clears immediately, before completion.
						send.classList.add('ds-button--disabled');
						for (const [index, file] of files.entries())
							setTimeout(() => {
								if (mode === 'missing' && index === 1) {
									send.classList.remove('ds-button--disabled');
									return;
								}
								const img = document.createElement('img');
								img.alt = file.name;
								img.src = URL.createObjectURL(file);
								document.getElementById('attachments').append(img);
								if (index === files.length - 1 && mode !== 'failed') send.classList.remove('ds-button--disabled');
							}, 150 + 250 * index);
					};
					send.onclick = () => {
						window.sent.push({
							prompt: input.value,
							names: [...document.querySelectorAll('#attachments img')].map((i) => i.alt)
						});
						input.value = '';
						const response = document.createElement('section');
						response.innerHTML =
							'<div class="ds-markdown ds-assistant-message-main-content">{"answer":"F","_bridge_id":"fixture"}</div>' +
							'<div role="button" class="ds-button">操作</div>'.repeat(3);
						document.body.append(response);
					};
				},
				{ source, mode }
			);
		}
		const images = [1, 2].map((index) => ({
			name: 'xth-image-' + index + '.png',
			dataUrl:
				'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
		}));
		await fixture();
		const pending = page.evaluate((images) => window.adapter.submit('two images', () => false, images), images);
		await page.waitForTimeout(320);
		assert.equal(await page.evaluate(() => window.sent.length), 0, 'no send while second image is processing');
		await pending;
		assert.deepEqual(await page.evaluate(() => window.sent), [
			{ prompt: 'two images', names: images.map((i) => i.name) }
		]);
		assert.equal(await page.evaluate(() => window.keys), 0, 'no second Enter submission');
		assert.equal(await page.evaluate(() => JSON.parse(window.adapter.readCompleted('fixture')).answer), 'F');
		assert.equal(await page.evaluate(() => window.adapter.readCompleted('another-request')), undefined);
		await page.evaluate(() => {
			const section = document.createElement('section');
			section.innerHTML = '<div class="ds-markdown">{"answer":"B","_bridge_id":"new-stream"}</div>';
			document.body.append(section);
		});
		assert.equal(
			await page.evaluate(() => window.adapter.readCompleted('new-stream')),
			undefined,
			'streaming reply cannot borrow the preceding turn toolbar'
		);
		for (const mode of ['failed', 'missing']) {
			await fixture(mode);
			const error = await page.evaluate(async (images) => {
				const deadline = Date.now() + 1800;
				try {
					await window.adapter.submit('must not send', () => Date.now() > deadline, images);
				} catch (error) {
					return error.message;
				}
			}, images);
			assert.match(error, /取消/);
			assert.equal(
				await page.evaluate(() => window.sent.length),
				0,
				mode + ' upload must never send a text-only fallback'
			);
		}
		await fixture();
		assert.match(
			await page.evaluate(() => {
				const image = document.createElement('img');
				image.alt = 'existing.png';
				document.getElementById('attachments').append(image);
				try {
					window.adapter.assertEmpty();
				} catch (error) {
					return error.message;
				}
			}),
			/已有输入、附件或聊天/
		);
		await fixture();
		assert.match(
			await page.evaluate(async () => {
				document.querySelector('[role="button"]').classList.add('ds-button--disabled');
				try {
					await window.adapter.submit('do not bypass disabled send', () => false);
				} catch (error) {
					return error.message;
				}
			}),
			/不会用回车/
		);
		assert.equal(await page.evaluate(() => window.sent.length + window.keys), 0);
		console.log(
			'PASS: two-image native upload, processing gate, partial/failed uploads never send, single submission, current DeepSeek toolbar, stale nonce and existing attachment protection.'
		);
	} finally {
		await browser.close();
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
