const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./load-ts.cjs');
const { QuestionAnswerCache, questionCacheKey } = loadTS('packages/scripts/src/utils/answer-cache.ts');
const config = {
	aiApiUrl: 'https://api.test/v1',
	aiModel: 'test',
	aiApiKey: 'secret',
	aiPrompt: '',
	aiTemperature: 0,
	aiMaxTokens: 300,
	aiUseResponseFormat: true
};
const question = { title: 'same title', type: 'single', options: ['yes', 'no'] };
const result = [
	{
		name: 'AI',
		results: [
			{
				question: question.title,
				answer: 'B',
				extra_data: { ai: true, solution: 'short explanation', token_usage: { total_tokens: 25 } }
			}
		]
	}
];
function setup(initial = []) {
	let entries = initial,
		enabled = true;
	const cache = new QuestionAnswerCache({
		get: () => entries,
		set: (value) => {
			entries = value;
		},
		enabled: () => enabled
	});
	return {
		cache,
		values: () => entries,
		enable: (value) => {
			enabled = value;
		}
	};
}
test('key isolates options/order/type/images/model/endpoint and contains no credentials', () => {
	const key = questionCacheKey(config, question);
	for (const patch of [
		{ options: ['no', 'yes'] },
		{ type: 'multiple' },
		{ imageUrls: ['https://img.test/a'] },
		{ lineOptions: [{ index: 0, options: [{ value: 'x', text: 'x' }] }] }
	])
		assert.notEqual(questionCacheKey(config, { ...question, ...patch }), key);
	for (const patch of [
		{ aiApiKey: 'new-key' },
		{ aiModel: 'other' },
		{ aiApiUrl: 'https://other.test/v1' },
		{ aiShowSolution: true }
	])
		assert.notEqual(questionCacheKey({ ...config, ...patch }, question), key);
	assert.doesNotMatch(key, /secret/);
	assert.equal(questionCacheKey({ ...config, aiPrompt: 'retired custom prompt' }, question), key);
});
test('cache hits preserve explanation but count zero new tokens; cache is bounded/persistent', async () => {
	const { cache, values } = setup();
	let calls = 0;
	await cache.search(config, question, async () => {
		calls++;
		return result;
	});
	const hit = await cache.search(config, question, async () => {
		calls++;
		return result;
	});
	assert.equal(calls, 1);
	assert.equal(hit[0].results[0].answer, 'B');
	assert.equal(hit[0].results[0].extra_data.solution, 'short explanation');
	assert.equal(hit[0].results[0].extra_data.token_usage.total_tokens, 0);
	assert.equal(values().length, 1);
	assert.doesNotMatch(JSON.stringify(values()), /secret|token_usage/);
	for (let i = 0; i < 205; i++) await cache.search(config, { ...question, title: 'q' + i }, async () => result);
	assert.equal(values().length, 200);
	const restored = setup(values());
	const again = await restored.cache.search(config, { ...question, title: 'q204' }, async () => {
		throw new Error('must hit');
	});
	assert.equal(again[0].data.cache_hit, true);
});
test('disabled cache neither reads nor writes; errors and legacy entries are not reused', async () => {
	const { cache, enable, values } = setup([{ title: 'same title', answer: 'A' }]);
	assert.equal(cache.list().length, 0);
	enable(false);
	let calls = 0;
	for (let i = 0; i < 2; i++)
		await cache.search(config, question, async () => {
			calls++;
			return result;
		});
	assert.equal(calls, 2);
	assert.equal(values().length, 1);
	enable(true);
	await cache.search(config, question, async () => [{ name: 'AI', error: 'bad', results: [] }]);
	assert.equal(cache.list().length, 0);
});
test('expired entries are not used', async () => {
	const { cache } = setup([
		{
			version: 2,
			key: questionCacheKey(config, question),
			title: question.title,
			answer: 'A',
			createdAt: Date.now() - 8 * 86400000
		}
	]);
	assert.equal(cache.list().length, 0);
	const answer = await cache.search(config, question, async () => result);
	assert.equal(answer[0].results[0].answer, 'B');
});
test('concurrent identical requests deduplicate and clear prevents in-flight repopulation', async () => {
	const { cache, values } = setup();
	let release,
		calls = 0;
	const fetch = () => {
		calls++;
		return new Promise((resolve) => {
			release = resolve;
		});
	};
	const one = cache.search(config, question, fetch),
		two = cache.search(config, question, fetch);
	await Promise.resolve();
	assert.equal(calls, 1);
	cache.clear();
	release(result);
	const [first, second] = await Promise.all([one, two]);
	assert.equal(first[0].results[0].extra_data.token_usage.total_tokens, 25);
	assert.equal(second[0].results[0].extra_data.token_usage.total_tokens, 0);
	assert.equal(values().length, 0);
	await cache.search(config, question, async () => result);
	assert.equal(values().length, 1);
});

test('disabling or clearing stored cache does not duplicate a live request', async () => {
	const { cache, enable, values } = setup();
	enable(false);
	let calls = 0,
		release;
	const query = () => {
		calls++;
		return new Promise((r) => (release = r));
	};
	const a = cache.search(config, question, query);
	await Promise.resolve();
	cache.clear();
	const b = cache.search(config, question, query);
	assert.equal(calls, 1);
	release(result);
	await Promise.all([a, b]);
	assert.equal(values().length, 0);
	assert.notEqual(
		questionCacheKey(config, question),
		questionCacheKey({ ...config, aiProvider: 'deepseek-web' }, question)
	);
});
