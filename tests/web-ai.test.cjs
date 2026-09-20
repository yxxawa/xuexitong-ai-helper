const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./load-ts.cjs');
const { extractBridgeAnswer, validateWebImages } = loadTS('packages/scripts/src/utils/deepseek-web.ts');
test('web bridge accepts only a complete JSON answer with its own request nonce', () => {
	const content =
		'```json\n' + JSON.stringify({ _bridge_id: 'one', answer: 'F', solution: 'a {brace} and "quote"' }) + '\n```';
	assert.equal(JSON.parse(extractBridgeAnswer(content, 'one')).answer, 'F');
	assert.equal(extractBridgeAnswer(content, 'two'), undefined);
	assert.equal(extractBridgeAnswer('{"_bridge_id":"one","answer":"F"', 'one'), undefined);
	assert.equal(extractBridgeAnswer('{"answer":"F"}', 'one'), undefined);
});
test('web requests have independent mailboxes and clean up question content after completion', async () => {
	const store = new Map(),
		web = loadTS('packages/scripts/src/utils/web-ai.ts');
	store.set(web.WEB_BRIDGE_STATE, {
		id: 'test',
		instance: 'page',
		provider: 'deepseek-web',
		supportsImages: true,
		status: 'ready',
		updatedAt: Date.now()
	});
	global.GM_getValue = (key, fallback) => store.get(key) || fallback;
	global.GM_setValue = (key, value) => store.set(key, value);
	global.GM_deleteValue = (key) => store.delete(key);
	const images = [{ name: 'xth-image-1.png', dataUrl: 'data:image/png;base64,AQIDBA==' }];
	const a = web.requestWebAnswer('first', 180, images),
		b = web.requestWebAnswer('second');
	const keys = [...store.keys()].filter((k) => k.startsWith('xth.web.request'));
	assert.equal(keys.length, 2);
	assert.deepEqual(store.get(keys[0]).images, images);
	await assert.rejects(
		web.requestWebAnswer('bad attachment', 180, [
			{ name: 'xth-image-1.png', dataUrl: 'https://untrusted.test/image.png' }
		]),
		/图片格式/
	);
	assert.equal([...store.keys()].filter((k) => k.startsWith('xth.web.request')).length, 2);
	for (const key of keys) {
		const req = store.get(key);
		store.set(key, {
			...req,
			status: 'done',
			answer: JSON.stringify({ _bridge_id: req.id, answer: req.prompt.startsWith('first') ? 'A' : 'B' })
		});
	}
	assert.deepEqual(
		(await Promise.all([a, b])).map((text) => JSON.parse(text).answer),
		['A', 'B']
	);
	assert.equal(store.size, 1);
	store.set(web.WEB_BRIDGE_STATE, { ...store.get(web.WEB_BRIDGE_STATE), supportsImages: false });
	await assert.rejects(web.requestWebAnswer('old receiver', 180, images), /旧版/);
	assert.equal(store.size, 1);
	store.set(web.WEB_BRIDGE_STATE, { ...store.get(web.WEB_BRIDGE_STATE), updatedAt: Date.now() - 60000 });
	await assert.rejects(web.requestWebAnswer('not sent'), /未连接/);
	assert.equal(store.size, 1);
});

test('bridge limits reject unsupported/corrupt/excess images rather than silently dropping them', () => {
	const image = { name: 'xth-image-1.png', dataUrl: 'data:image/png;base64,AQIDBA==' };
	assert.doesNotThrow(() => validateWebImages([image]));
	assert.throws(() => validateWebImages([image, image]), /重复/);
	assert.throws(() => validateWebImages(Array(11).fill(image)), /10 张/);
	assert.throws(() => validateWebImages([{ ...image, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }]), /图片格式/);
	assert.throws(() => validateWebImages([{ ...image, dataUrl: 'data:image/png;base64,?invalid' }]), /图片格式/);
});
