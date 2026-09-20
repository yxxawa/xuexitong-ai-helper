const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./load-ts.cjs');
const { acquireWebActivity, serviceWebActivities, getWebActivity, assertWebActivity } = loadTS(
	'packages/scripts/src/utils/web-activity.ts'
);
function storage() {
	const store = new Map([
		['xth.web.bridge.v1', { id: 'bridge', updatedAt: Date.now(), status: 'ready', supportsActivities: true }]
	]);
	global.GM_getValue = (key, fallback) => store.get(key) ?? fallback;
	global.GM_setValue = (key, value) => store.set(key, value);
	global.GM_deleteValue = (key) => store.delete(key);
	global.GM_listValues = () => [...store.keys()];
	return store;
}
test('single receiver arbitrates simultaneous work/search claims and holds ownership across questions', async () => {
	const store = storage();
	const claims = [acquireWebActivity('work'), acquireWebActivity('search')];
	const all = Promise.allSettled(claims);
	serviceWebActivities('bridge');
	const results = await all;
	assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
	assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
	const lease = results.find((r) => r.status === 'fulfilled').value;
	try {
		assert.equal(getWebActivity().id, lease.id);
		lease.assertActive();
		assert.throws(() => assertWebActivity(), /网页正在/);
		await assert.rejects(acquireWebActivity('search'), /网页正在/);
		serviceWebActivities('bridge'); // Question completion does not release a whole worker run.
		assert.equal(getWebActivity().id, lease.id);
	} finally {
		lease.release();
	}
	assert.equal(getWebActivity(), undefined);
	serviceWebActivities('bridge');
	const next = acquireWebActivity('search');
	serviceWebActivities('bridge');
	const search = await next;
	try {
		await assert.rejects(acquireWebActivity('work'), /手动搜题/);
	} finally {
		search.release();
	}
	serviceWebActivities('bridge');
	assert.equal([...store.keys()].filter((k) => k.startsWith('xth.web.activity')).length, 0);
});
test('expired leases recover but old owners cannot send or release the replacement', async () => {
	const store = storage();
	const pending = acquireWebActivity('work');
	serviceWebActivities('bridge');
	const old = await pending;
	const key = 'xth.web.activity.request.v1.' + old.id;
	store.set(key, { ...store.get(key), updatedAt: Date.now() - 60000 });
	serviceWebActivities('bridge');
	assert.equal(getWebActivity(), undefined);
	assert.throws(() => old.assertActive(), /失效/);
	const next = acquireWebActivity('search');
	serviceWebActivities('bridge');
	const current = await next;
	try {
		old.release();
		assert.equal(getWebActivity().id, current.id);
	} finally {
		old.release();
		current.release();
	}
});
test('legacy receiver cannot silently bypass the new activity lock', async () => {
	const store = storage();
	store.get('xth.web.bridge.v1').supportsActivities = false;
	await assert.rejects(acquireWebActivity('work'), /刷新/);
	assert.equal(store.size, 1);
});

test('closing an owner tab does not grant another task while its sent request is still processing', async () => {
	storage();
	const pending = acquireWebActivity('search');
	const rejected = assert.rejects(pending, /上一请求尚未结束/);
	serviceWebActivities('bridge', true);
	await rejected;
	assert.equal(getWebActivity(), undefined);
});
