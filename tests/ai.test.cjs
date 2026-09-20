const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTS } = require('./load-ts.cjs');
const settings = {
	aiApiUrl: 'https://example.test/v1',
	aiApiKey: 'test-key',
	aiModel: 'custom-model',
	aiPrompt: '',
	aiTemperature: 0,
	aiMaxTokens: 300,
	aiUseResponseFormat: true,
	aiVisionMode: 'auto'
};
const options = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const image = 'data:image/png;base64,iVBORw0KGgo=';
function makeAI(responses) {
	const storage = new Map();
	global.GM_getValue = (key, value) => storage.get(key) || value;
	global.GM_setValue = (key, value) => storage.set(key, value);
	const calls = [],
		webCalls = [];
	const api = loadTS('packages/scripts/src/utils/ai.ts', {
		'./web-ai': {
			getWebBridgeState: () => undefined,
			requestWebAnswer: async (prompt, timeout, images) => {
				webCalls.push({ prompt, timeout, images });
				return JSON.stringify({ answer: 'F', answers: ['F'] });
			}
		},
		'@xuexitong-ai-helper/core/src/core/utils/request': {
			request: async (url, config) => {
				calls.push({ url, ...config });
				const result = responses.shift();
				if (result instanceof Error) throw result;
				assert.notEqual(result, undefined, 'unexpected extra API request');
				return result;
			}
		}
	});
	return {
		api,
		calls,
		webCalls,
		storage,
		markVision: () =>
			loadTS('packages/scripts/src/utils/vision.ts').rememberVisionCapability(settings, 'supported', 'metadata')
	};
}
const reply = (answer) => ({
	choices: [{ message: { content: JSON.stringify({ answer, answers: answer.split('#') }) }, finish_reason: 'stop' }],
	usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
});

test('choice answers support E/F and do not confuse position with option text', () => {
	const { api } = makeAI([]);
	assert.equal(api.normalizeAnswerByQuestionType('F', 'single', undefined, options), 'F');
	assert.equal(api.normalizeAnswerByQuestionType('A', 'single', undefined, ['C', 'A', 'B']), 'A');
	assert.equal(api.normalizeAnswerByQuestionType('42', 'single', undefined, ['7', '42', '5']), 'B');
	assert.equal(api.normalizeAnswerByQuestionType('Z', 'single', undefined, options), '');
	assert.equal(api.normalizeAnswerByQuestionType('F,A,C,A', 'multiple', undefined, options), 'A#C#F');
	assert.equal(api.normalizeAnswerByQuestionType('a c f', 'multiple', undefined, options), 'A#C#F');
	assert.equal(api.normalizeAnswerByQuestionType('A#Z', 'multiple', undefined, options), '');
	assert.equal(api.normalizeAnswerByQuestionType('false', 'judgement', undefined, ['正确', '错误']), 'B');
});

test('confirmed vision model sends option images and uses the full dynamic choice range', async () => {
	const { api, calls, markVision } = makeAI([reply('F')]);
	markVision();
	const result = await api.queryAIAnswerer(settings, {
		title: 'Pick an image',
		type: 'single',
		options: [...options.slice(0, 5), '[图片1]'],
		imageUrls: [image],
		hasImage: true
	});
	assert.equal(result[0].results[0].answer, 'F');
	const content = calls[0].data.messages[1].content;
	assert.match(content[0].text, /A\/B\/C\/D\/E\/F/);
	assert.match(content[0].text, /F\.\[图片1\]/);
	assert.equal(content[1].image_url.url, image);
	assert.doesNotMatch(
		JSON.stringify(result[0].data),
		/iVBORw0KGgo=/,
		'raw image data must not be saved in work result diagnostics'
	);
});

test('format repair is bounded and rejects out-of-range answers instead of filling guesses', async () => {
	const { api, calls } = makeAI([reply('Z'), reply('F')]);
	const result = await api.queryAIAnswerer(settings, { title: 'six choices', type: 'single', options });
	assert.equal(result[0].results[0].answer, 'F');
	assert.equal(calls.length, 2);
	assert.equal(result[0].results[0].extra_data.token_usage.total_tokens, 10);
	const failed = makeAI([reply('Z'), reply('Q')]);
	const bad = await failed.api.queryAIAnswerer(settings, { title: 'six choices', type: 'single', options });
	assert.equal(bad[0].results.length, 0);
	assert.ok(bad[0].error);
});

test('multi-select may have one correct option; no forced or billable extra guess', async () => {
	const { api, calls } = makeAI([reply('A')]);
	const result = await api.queryAIAnswerer(settings, { title: 'multi', type: 'multiple', options });
	assert.equal(result[0].results[0].answer, 'A');
	assert.equal(result[0].error, undefined);
	assert.equal(calls.length, 1);
});

test('explicit vision rejection is learned; auth/network failures do not classify the model', async () => {
	const failed = makeAI([new Error('This model does not support image inputs')]);
	failed.markVision();
	const question = { title: 'image', type: 'single', options, imageUrls: [image] };
	await failed.api.queryAIAnswerer(settings, question);
	const repeated = await failed.api.queryAIAnswerer(settings, question);
	assert.equal(repeated[0].data.reason, 'model_without_vision');
	assert.equal(failed.calls.length, 1);
	const auth = makeAI([new Error('HTTP 401: invalid API key'), reply('B')]);
	auth.markVision();
	await auth.api.queryAIAnswerer(settings, question);
	const good = await auth.api.queryAIAnswerer(settings, question);
	assert.equal(good[0].results[0].answer, 'B');
	assert.equal(auth.calls.length, 2);
});

test('manual text-only mode and unreadable images never send an incomplete text-only question', async () => {
	const { api, calls } = makeAI([]);
	const disabled = await api.queryAIAnswerer(
		{ ...settings, aiVisionMode: 'unsupported' },
		{ title: 'image', imageUrls: [image] }
	);
	assert.equal(disabled[0].results.length, 0);
	const missing = await api.queryAIAnswerer(
		{ ...settings, aiVisionMode: 'support' },
		{ title: 'image', hasImage: true }
	);
	assert.match(missing[0].error, /图片地址/);
	assert.equal(calls.length, 0);
});

test('model capabilities use explicit input metadata, not names or output image support', () => {
	const { api } = makeAI([]);
	const infos = api.parseModelInfos({
		data: [
			{ id: 'custom-1', capabilities: { vision: false } },
			{ id: 'custom-2', architecture: { input_modalities: ['text', 'image'] } },
			{ id: 'famous-vision-name', output_modalities: ['image'] },
			{ id: 'custom-3', input_modalities: ['text'] }
		]
	});
	assert.equal(infos.find((x) => x.id === 'custom-1').supportsVision, false);
	assert.equal(infos.find((x) => x.id === 'custom-2').supportsVision, true);
	assert.equal(infos.find((x) => x.id === 'famous-vision-name').supportsVision, undefined);
	assert.equal(infos.find((x) => x.id === 'custom-3').supportsVision, false);
});

test('invalid API URL is a recoverable result, not an unhandled rejection', async () => {
	const { api } = makeAI([]);
	const result = await api.queryAIAnswerer({ ...settings, aiApiUrl: 'not a url' }, { title: 'test' });
	assert.equal(result[0].results.length, 0);
	assert.match(result[0].error, /接口地址/);
});

test('worker accepts more than eight choice letters and rejects nonletters', () => {
	const { isPlainAnswer, resolvePlainAnswer } = loadTS('packages/core/src/core/worker/utils.ts');
	assert.equal(isPlainAnswer('ABCDEFGHIJ'), true);
	assert.equal(isPlainAnswer('A['), false);
	assert.equal(resolvePlainAnswer('A#C#F#J'), 'ACFJ');
});

test('Anthropic-compatible image requests contain base64 image blocks', async () => {
	const { api, calls } = makeAI([{ content: [{ type: 'text', text: '{"answer":"F","answers":["F"]}' }] }]);
	const result = await api.queryAIAnswerer(
		{ ...settings, aiVisionMode: 'support', aiApiUrl: 'https://gateway.test/v1/messages' },
		{ title: 'image', type: 'single', options, imageUrls: [image] }
	);
	assert.equal(result[0].results[0].answer, 'F');
	const block = calls[0].data.messages[0].content[1];
	assert.equal(block.type, 'image');
	assert.equal(block.source.type, 'base64');
	assert.equal(block.source.media_type, 'image/png');
	assert.equal(calls[0].headers['x-api-key'], settings.aiApiKey);
});
test('a JSON error sent with HTTP 200 is not treated as a successful answer', async () => {
	const { api } = makeAI([{ error: { message: 'API quota exceeded' } }]);
	const result = await api.queryAIAnswerer(settings, { title: 'question', type: 'single', options });
	assert.equal(result[0].results.length, 0);
	assert.match(result[0].error, /quota exceeded/);
});

test('Claude-named models on OpenAI-compatible gateways do not change the wire protocol', async () => {
	const { api, calls } = makeAI([reply('A')]);
	await api.queryAIAnswerer(
		{ ...settings, aiModel: 'claude-custom', aiApiUrl: 'https://gateway.test/v1/chat/completions' },
		{ title: 'test', type: 'single', options }
	);
	assert.equal(calls[0].url, 'https://gateway.test/v1/chat/completions');
	assert.equal(calls[0].headers.Authorization, 'Bearer test-key');
	assert.equal(calls[0].data.messages[0].role, 'system');
});

test('partially loaded images prevent incomplete requests', async () => {
	const { api, calls } = makeAI([]);
	const result = await api.queryAIAnswerer(
		{ ...settings, aiVisionMode: 'support' },
		{
			title: 'images',
			options,
			type: 'single',
			imageUrls: [image],
			hasImage: true,
			unresolvedImageCount: 1
		}
	);
	assert.equal(result[0].results.length, 0);
	assert.match(result[0].error, /图片地址/);
	assert.equal(calls.length, 0);
});

test('unknown capability skips real image questions without sending any API request', async () => {
	const { api, calls } = makeAI([]);
	for (const question of [
		{ title: 'plain stem', options: ['text', '[图片1]'], imageUrls: [image] },
		{ title: 'plain', unresolvedImageCount: 1 }
	]) {
		const result = await api.queryAIAnswerer(settings, question);
		assert.equal(result[0].data.reason, 'vision_unknown');
	}
	assert.equal(calls.length, 0);
});
test('empty-content retry cannot cascade into a third format-repair request', async () => {
	const { api, calls } = makeAI([
		{ choices: [{ message: { content: '', reasoning_content: 'thinking' }, finish_reason: 'length' }] },
		reply('Z')
	]);
	const result = await api.queryAIAnswerer(settings, { title: 'six', type: 'single', options });
	assert.equal(calls.length, 2);
	assert.ok(result[0].error);
});
test('DeepSeek web skips unresolved stem/option images without sending a partial question', async () => {
	const { api, calls, webCalls } = makeAI([]);
	for (const question of [
		{ title: 'image', hasImage: true },
		{ title: 'plain', options: ['text', '[图片1]'], imageUrls: [image], unresolvedImageCount: 1 },
		{ title: 'plain', unresolvedImageCount: 1 }
	]) {
		const result = await api.queryAIAnswerer({ ...settings, aiProvider: 'deepseek-web' }, question);
		assert.equal(result[0].data.skipped, true);
	}
	assert.equal(calls.length, 0);
	assert.equal(webCalls.length, 0);
});

test('DeepSeek web forwards stem AND option images with ordered markers, independent of API vision setting', async () => {
	const { api, calls, webCalls } = makeAI([]);
	const optionImage = 'data:image/png;base64,AQIDBA==';
	const result = await api.queryAIAnswerer(
		{ ...settings, aiProvider: 'deepseek-web', aiVisionMode: 'unsupported' },
		{
			title: '题干 ' + image,
			type: 'single',
			options: ['text', optionImage, 'C', 'D', 'E', 'F'],
			hasImage: true,
			imageUrls: [image, optionImage, image]
		}
	);
	assert.equal(result[0].results[0].answer, 'F');
	assert.equal(calls.length, 0);
	assert.equal(webCalls.length, 1);
	assert.deepEqual(webCalls[0].images, [
		{ name: 'xth-image-1.png', dataUrl: image },
		{ name: 'xth-image-2.png', dataUrl: optionImage }
	]);
	assert.match(webCalls[0].prompt, /题干.*图片1/);
	assert.match(webCalls[0].prompt, /B\..*图片2/);
	assert.ok(!webCalls[0].prompt.includes('base64,'));
});

test('grouped answers must be complete and valid for each specific group', () => {
	const { api } = makeAI([]);
	const groups = [
		{ index: 0, options: [{ value: 'a', text: 'A' }] },
		{ index: 1, options: [{ value: 'b', text: 'B' }] }
	];
	assert.equal(api.normalizeAnswerByQuestionType('a#b', 'line', groups), 'a#b');
	assert.equal(api.normalizeAnswerByQuestionType('a#a', 'line', groups), '');
	assert.equal(api.normalizeAnswerByQuestionType('a', 'line', groups), '');
	assert.equal(api.normalizeAnswerByQuestionType('a#b#extra', 'reader', groups), '');
});

test('fixed output instructions appear once and ignore legacy custom prompt settings in API and web modes', async () => {
	const { api, calls, webCalls } = makeAI([reply('F')]);
	const q = { title: 'six options', type: 'single', options };
	for (const aiProvider of ['api', 'deepseek-web']) {
		await api.queryAIAnswerer(
			{ ...settings, aiProvider, aiPrompt: api.DEFAULT_AI_PROMPT + '\nLEGACY_CUSTOM_OUTPUT' },
			q
		);
	}
	for (const prompt of [calls[0].data.messages[0].content, webCalls[0].prompt]) {
		assert.equal(prompt.split('你是在线课程答题助手。').length - 1, 1);
		assert.ok(!prompt.includes('LEGACY_CUSTOM_OUTPUT'));
		assert.match(prompt, /不能超出实际选项范围/);
	}
});
