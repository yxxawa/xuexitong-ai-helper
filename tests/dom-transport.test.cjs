const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./load-ts.cjs');
const { JSDOM } = require('jsdom');
test('extracts question/option/root/lazy images, resolves relative URLs, preserves image-only option positions', () => {
	const doc = new JSDOM(
		'<body><h3 id="title">Question <img src="/title.png"></h3><p id="one"><img src="data:image/gif;base64,R0lG" data-src="/option.png"></p><p id="two">Text<br>line</p><img id="root" data-original="/root.png"></body>',
		{ url: 'https://mooc1.chaoxing.com/work' }
	).window.document;
	const { collectQuestionImageUrls, questionElementText } = loadTS('packages/scripts/src/utils/question.ts');
	const roots = ['title', 'one', 'two', 'root'].map((id) => doc.getElementById(id));
	const urls = collectQuestionImageUrls([roots[0]], roots.slice(1));
	assert.deepEqual(urls, [
		'https://mooc1.chaoxing.com/title.png',
		'https://mooc1.chaoxing.com/option.png',
		'https://mooc1.chaoxing.com/root.png'
	]);
	assert.equal(questionElementText(roots[1], urls), '[图片2]');
	assert.equal(questionElementText(roots[2], urls), 'Text line');
	assert.equal(questionElementText(roots[3], urls), '[图片3]');
	assert.equal(roots[1].querySelectorAll('img').length, 1, 'live options must not be mutated');
});
function transport() {
	return loadTS('packages/core/src/core/utils/request.ts', { '../../utils/common': { $: { isInBrowser: () => true } } })
		.request;
}
test('GM transport accepts JSON object responses and all 2xx statuses', async () => {
	global.GM_xmlhttpRequest = (opts) => opts.onload({ status: 201, response: { ok: true }, responseText: '' });
	assert.deepEqual(await transport()('https://test', { type: 'GM_xmlhttpRequest' }), { ok: true });
});
test('GM transport rejects timeouts, non-2xx statuses and malformed JSON', async () => {
	global.GM_xmlhttpRequest = (opts) => opts.ontimeout();
	await assert.rejects(transport()('https://test', { type: 'GM_xmlhttpRequest' }), /超时/);
	global.GM_xmlhttpRequest = (opts) => opts.onload({ status: 429, responseText: 'rate limit' });
	await assert.rejects(transport()('https://test', { type: 'GM_xmlhttpRequest' }), /429/);
	global.GM_xmlhttpRequest = (opts) => opts.onload({ status: 200, responseText: '<html>' });
	await assert.rejects(transport()('https://test', { type: 'GM_xmlhttpRequest' }), /JSON/);
});

test('responsive currentSrc survives DOM cloning and incomplete images are detected', () => {
	const doc = new JSDOM('<p><img src="/preview.png"><img></p>', { url: 'https://mooc1.chaoxing.com/' }).window.document;
	const root = doc.querySelector('p');
	Object.defineProperty(root.querySelector('img'), 'currentSrc', { value: 'https://mooc1.chaoxing.com/full.png' });
	const { inspectQuestionImages, questionElementText } = loadTS('packages/scripts/src/utils/question.ts');
	const images = inspectQuestionImages([root]);
	assert.deepEqual(images.imageUrls, ['https://mooc1.chaoxing.com/full.png']);
	assert.equal(images.hasImage, true);
	assert.equal(images.unresolvedImageCount, 1);
	assert.match(questionElementText(root, images.imageUrls), /^\[图片1\]/);
});

test('option sibling images and duplicate/unresolved nodes are conservatively detected', () => {
	const { inspectQuestionImages, questionOptionText } = loadTS('packages/scripts/src/utils/question.ts');
	const doc = new JSDOM(
		'<section><h3>Text-only stem</h3><ul><li><label>A. text</label></li><li><label>B.</label><img data-src="/b.png"></li><li><label>C.</label><img></li></ul></section>',
		{ url: 'https://mooc1.chaoxing.com/' }
	).window.document;
	const root = doc.querySelector('section'),
		opts = [...doc.querySelectorAll('label')];
	const found = inspectQuestionImages([root], opts, [root]);
	assert.equal(found.hasImage, true);
	assert.equal(found.unresolvedImageCount, 1);
	assert.equal(questionOptionText(opts[1], opts, found.imageUrls), '[图片1]');
	assert.equal(root.querySelectorAll('img').length, 2);
});
test('completion input emits events, treats HTML as text, and grouped choices cannot falsely finish', async () => {
	const { fillTextAnswer, fillGroupedChoices, isOptionChecked } = loadTS('packages/scripts/src/utils/answer-input.ts');
	const doc = new JSDOM(
		'<div><textarea></textarea></div><div contenteditable="true"></div><li><input type="checkbox" checked><label>option</label></li><section><span data="a">A</span></section><section><span data="b">B</span></section>'
	).window.document;
	const textarea = doc.querySelector('textarea');
	let changed = 0;
	textarea.addEventListener('input', () => changed++);
	fillTextAnswer(textarea, 'value');
	assert.equal(changed, 1);
	const editor = doc.querySelector('[contenteditable]');
	fillTextAnswer(editor, '<img src=x onerror=alert(1)>');
	assert.equal(editor.querySelector('img'), null);
	doc.querySelector('input').checked = false;
	assert.equal(isOptionChecked(doc.querySelector('label')), false);
	let clicks = 0;
	doc.querySelectorAll('span').forEach((el) => (el.onclick = () => clicks++));
	const groups = [...doc.querySelectorAll('section')];
	assert.equal((await fillGroupedChoices('a', groups, 'span[data]', async () => {})).finish, false);
	assert.equal((await fillGroupedChoices('a#not-b', groups, 'span[data]', async () => {})).finish, false);
	assert.equal(clicks, 0);
	assert.equal((await fillGroupedChoices('a#b', groups, 'span[data]', async () => {})).finish, true);
	assert.equal(clicks, 2);
});

test('model answer markup is displayed as text rather than executable HTML', () => {
	const { questionDisplayHTML } = loadTS('packages/scripts/src/utils/question.ts');
	const doc = new JSDOM('<div></div>').window.document;
	doc.querySelector('div').innerHTML = questionDisplayHTML(
		'<img src=x onerror=alert(1)><svg onload=alert(1)> https://images.test/a.png',
		doc
	);
	assert.equal(doc.querySelector('svg'), null);
	assert.equal(doc.querySelectorAll('img').length, 1);
	assert.equal(doc.querySelector('img').hasAttribute('onerror'), false);
	assert.match(doc.querySelector('div').textContent, /onerror/);
});
