const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { JSDOM } = require('jsdom');
const { loadTS } = require('./load-ts.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { CourseWorker } = loadTS('packages/core/src/core/worker/worker.ts', {
	'easy-us': { CommonEventEmitter: EventEmitter, $: { sleep: wait } }
});
const { runQuestionPages } = loadTS('packages/scripts/src/utils/pagination.ts');
const hit = () => [{ name: 'AI', results: [{ question: 'q', answer: 'A' }] }];
function worker(count, overrides = {}) {
	const dom = new JSDOM(
		'<main>' +
			Array.from(
				{ length: count },
				(_, i) => '<section id="q' + i + '"><h3>Q' + i + '</h3><button>A</button><button>B</button></section>'
			).join('') +
			'</main>'
	);
	return new CourseWorker({
		root: [...dom.window.document.querySelectorAll('section')],
		elements: { title: 'h3', options: 'button' },
		thread: 2,
		answerer: async () => hit(),
		work: async () => ({ finish: true }),
		...overrides
	});
}
test('same worker start is single-flight; every result is awaited and filled exactly once', async () => {
	let requests = 0,
		fills = 0,
		release;
	const pending = new Promise((resolve) => (release = resolve));
	const w = worker(3, {
		answerer: async () => {
			requests++;
			await pending;
			return hit();
		},
		work: async () => {
			fills++;
			return { finish: true };
		}
	});
	const a = w.doWork(),
		b = w.doWork();
	assert.equal(a, b);
	await wait(20);
	assert.equal(requests, 2);
	assert.equal(fills, 0);
	release();
	const results = await a;
	assert.equal(requests, 3);
	assert.equal(fills, 3);
	assert.ok(results.every((r) => r.resolved && r.result.finish));
	assert.equal(w.isRunning, false);
	await w.doWork();
	assert.equal(w.listenerCount('stop'), 1);
	assert.equal(w.listenerCount('close'), 1);
});
test('pause then close releases queued tasks; late results cannot fill or emit result updates', async () => {
	let requested = 0,
		filled = 0,
		release;
	const w = worker(2, {
		thread: 1,
		answerer: () => {
			requested++;
			return new Promise((resolve) => (release = () => resolve(hit())));
		},
		work: async () => {
			filled++;
			return { finish: true };
		}
	});
	const run = w.doWork();
	await wait(15);
	w.emit('stop');
	w.emit('close');
	release();
	await run;
	assert.equal(requested, 1);
	assert.equal(filled, 0);
	assert.equal(w.isRunning, false);
	assert.deepEqual(await w.doWork(), []);
});
test('concurrent requests obey a single rate gate; request failures do not strand later questions', async () => {
	const times = [];
	let fills = 0;
	const w = worker(4, {
		thread: 4,
		requestPeriod: 35,
		answerer: async () => {
			times.push(Date.now());
			if (times.length === 2) throw Error('network failure');
			return hit();
		},
		work: async () => {
			fills++;
			return { finish: true };
		}
	});
	const results = await w.doWork();
	for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 30);
	assert.equal(results.length, 4);
	assert.equal(fills, 3);
	assert.match(results[1].error, /network failure/);
	assert.equal(results[1].result.finish, false);
});
test('missing question roots reset worker state, and skipped/error answers never fill', async () => {
	const empty = worker(0);
	await assert.rejects(empty.doWork(), /未找到/);
	assert.equal(empty.isRunning, false);
	let fills = 0;
	const w = worker(1, {
		answerer: async () => [{ name: 'AI', results: [{ answer: 'A' }], error: 'do not fill', data: { skipped: true } }],
		work: async () => {
			fills++;
			return { finish: true };
		}
	});
	const res = await w.doWork();
	assert.equal(fills, 0);
	assert.equal(res[0].result.finish, false);
});
test('pagination answers the only/last page even without a Next button', async () => {
	let page = 0,
		answers = [];
	const button = { matches: () => false, hidden: false, click: () => page++ };
	await runQuestionPages({
		closed: () => false,
		identity: () => String(page),
		answer: async () => {
			answers.push(page);
		},
		next: () => (page < 2 ? button : null),
		wait: async () => {}
	});
	assert.deepEqual(answers, [0, 1, 2]);
	answers = [];
	await runQuestionPages({
		closed: () => false,
		identity: () => 'single',
		answer: async () => {
			answers.push(1);
		},
		next: () => null,
		wait: async () => {}
	});
	assert.deepEqual(answers, [1]);
});
test('failed pagination is stopped instead of querying the same page forever', async () => {
	let queries = 0;
	await assert.rejects(
		runQuestionPages({
			closed: () => false,
			identity: () => 'unchanged',
			answer: async () => {
				queries++;
			},
			next: () => ({ matches: () => false, hidden: false, click() {} }),
			wait: () => wait(2),
			transitionTimeout: 10
		}),
		/没有变化/
	);
	assert.equal(queries, 1);
});

test('close during a multi-option fill prevents subsequent option clicks', async () => {
	let clicks = 0,
		release;
	const hold = new Promise((resolve) => (release = resolve));
	const w = worker(1, {
		answerer: async () => [{ name: 'AI', results: [{ answer: 'A#B' }] }],
		work: {
			type: 'multiple',
			handler: async () => {
				clicks++;
				await hold;
			}
		}
	});
	const run = w.doWork();
	await wait(15);
	assert.equal(clicks, 1);
	w.emit('close');
	release();
	const result = await run;
	assert.equal(clicks, 1);
	assert.equal(result[0].result.finish, false);
});

test('pending question list is published before the very first slow AI response', async () => {
	let release,
		started = false;
	const snapshots = [];
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const w = worker(3, {
		thread: 1,
		answerer: async () => {
			started = true;
			await pending;
			return hit();
		},
		onResultsUpdate: async (_, index, results) =>
			snapshots.push({ index, count: results.length, requested: results.filter((r) => r.requested).length, started })
	});
	const run = w.doWork();
	await wait(20);
	assert.deepEqual(snapshots, [{ index: 0, count: 3, requested: 0, started: false }]);
	assert.equal(started, true);
	release();
	await run;
});
