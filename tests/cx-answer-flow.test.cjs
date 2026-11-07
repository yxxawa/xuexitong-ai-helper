const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ROOT, Clock, domRuntime, loadTS, plain, storage } = require('./helpers/runtime.cjs');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6ioAAAAASUVORK5CYII=';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const infos = (answer = 'A') => [{ name: 'audit', results: [{ question: 'audit', answer, extra_data: { ai: true } }] }];
function aiSetup(t, html = '') {
  const env = domRuntime(html, 'https://mooc1.chaoxing.com/mooc2/work/dowork'); t.after(() => env.window.close());
  const clock = new Clock(), store = storage(), calls = [], webCalls = [];
  const globals = { ...env.globals, ...clock.globals(), ...store.globals, AbortController };
  const ai = loadTS('packages/scripts/src/utils/ai.ts', globals, {
    './web-ai': { getWebBridgeState: () => ({ id: 'audit' }), requestWebAnswer: async (...args) => { webCalls.push(args); return '{"answer":"A"}'; } },
    './web-task': { reportWebTaskStatus() {} },
    '@xuexitong-ai-helper/core/src/core/utils/request': { request: async (url, options) => {
      if (options.method === 'get') return { max_output_tokens: 4096 };
      calls.push({ url, data: plain(options.data) });
      return { choices: [{ message: { content: '{"answer":"A","answers":["A"]}' }, finish_reason: 'stop' }],
        content: [{ type: 'text', text: '{"answer":"A","answers":["A"]}' }] };
    } }
  });
  const opts = { aiProvider: 'api', aiApiUrl: 'https://model.example.test/v1', aiApiKey: 'fixture', aiModel: 'fixture',
    aiTemperature: 0, aiUseResponseFormat: false, aiVisionMode: 'support', aiAnswerTimeout: 60 };
  const q = loadTS('packages/scripts/src/utils/question.ts', globals);
  return { ...env, globals, clock, calls, webCalls, ai, q, opts };
}

for (const provider of ['openai', 'anthropic', 'web']) test('two adjacent images remain distinct in ' + provider + ' transport', async t => {
  const e = aiSetup(t, '<h3>题目<img src="' + PNG + '"><img src="' + GIF + '"></h3>');
  const title = e.document.querySelector('h3'), images = e.q.inspectQuestionImages([title]);
  const text = e.q.questionElementText(title, images.imageUrls);
  assert.deepEqual(plain(images.imageUrls), [PNG, GIF]); assert.equal(text, '题目[图片1][图片2]');
  const opts = { ...e.opts, ...(provider === 'anthropic' ? { aiApiUrl: 'https://api.anthropic.com/v1/messages' } : provider === 'web' ? { aiProvider: 'deepseek-web' } : {}) };
  const result = await e.ai.queryAIAnswerer(opts, { title: text, type: 'single', options: ['甲', '乙'], ...images });
  assert.equal(result[0].results[0]?.answer, 'A');
  let payload;
  if (provider === 'web') payload = e.webCalls[0][2].map(image => image.dataUrl);
  else {
    const content = e.calls[0].data.messages.find(message => message.role === 'user').content;
    payload = provider === 'anthropic' ? content.filter(part => part.type === 'image').map(part => 'data:' + part.source.media_type + ';base64,' + part.source.data)
      : content.filter(part => part.type === 'image_url').map(part => part.image_url.url);
  }
  assert.deepEqual(plain(payload), [PNG, GIF]);
});

for (const type of ['single', 'multiple', 'judgement']) test('image-only ' + type + ' options are selected and verified when AI returns a valid letter', async t => {
  const input = type === 'multiple' ? 'checkbox' : 'radio';
  const e = aiSetup(t, '<div id="q"><li><input type="' + input + '" id="a" name="x"><label class="answer_p" for="a"><img src="' + PNG + '"></label></li><li><input type="' + input + '" id="b" name="x"><label class="answer_p" for="b"><img src="' + GIF + '"></label></li></div>');
  const root = e.document.querySelector('#q'), options = [...root.querySelectorAll('.answer_p')];
  const writer = loadTS('packages/scripts/src/utils/answer-writer.ts', e.globals);
  const result = await writer.fillStandardAnswer({ root, elements: { options }, searchInfos: infos('A'), answerMatchMode: 'similar' }, type, async () => {});
  assert.equal(result.finish, true); assert.equal(root.querySelector(':checked').id, 'a');
});

test('hidden empty images do not block a complete text question', async t => {
  const e = aiSetup(t, '<div id="q"><h3>1+1等于几？</h3><div style="display:none"><img></div></div>');
  const images = e.q.inspectQuestionImages([e.document.querySelector('#q')]);
  const result = await e.ai.queryAIAnswerer(e.opts, { title: '1+1等于几？', type: 'single', options: ['2','3'], ...images });
  assert.equal(images.unresolvedImageCount, 0); assert.equal(result[0].results.length, 1); assert.equal(e.calls.length, 1);
});

test('hidden answer text is omitted without mutating the live question', t => {
  const e = aiSetup(t, '<h3>题目<span style="display:none">隐藏的旧题：旧答案A</span></h3>');
  const text = e.q.questionElementText(e.document.querySelector('h3'), []);
  assert.equal(text, '题目'); assert.match(e.document.querySelector('h3').textContent, /隐藏的旧题/);
});

function cxSetup(t, html, settings = {}) {
  const env = domRuntime(html, settings.url || 'https://mooc1.chaoxing.com/mooc2/work/dowork'); t.after(() => env.window.close());
  const clock = new Clock(), queries = [], tasks = [], messages = [], reviews = []; let workOptions;
  const globals = { ...env.globals, ...clock.globals(), top: env.window, AbortController, queueMicrotask };
  const noop = () => {}, easy = { CommonEventEmitter: EventEmitter, $: { sleep: async () => {} } };
  const Base = loadTS('packages/core/src/core/worker/worker.ts', globals, { 'easy-us': easy }).CourseWorker;
  class Worker extends Base { doWork(options) { const promise = super.doWork(options); tasks.push(promise); return promise; } }
  const stubs = {};
  for (const match of fs.readFileSync(path.join(ROOT, 'packages/scripts/src/projects/cx.ts'), 'utf8').matchAll(/from ['"]([^'"]+)['"]/g)) stubs[match[1]] = {};
  for (const name of ['../utils/answer-writer','../utils/programming','../utils/programming-runner','../utils/answer-input','../utils/question','../utils/cx-question','../utils/question-guard','@xuexitong-ai-helper/core/src/core/utils/dom']) delete stubs[name];
  class Script { constructor(options) { Object.assign(this, options); this.cfg = Object.fromEntries(Object.entries(options.configs || {}).map(([key,value]) => [key,value.defaultValue])); } }
  const h = tag => env.document.createElement(tag);
  stubs['easy-us'] = { ...easy, Project: { create: value => value }, Script, h, $gm: { unsafeWindow: env.window },
    $ui: { notes: () => h('div') }, $message: Object.fromEntries(['info','warn','error','success'].map(key => [key, value => messages.push(value)])),
    $modal: { alert: noop }, $el: (selector, scope = env.document) => scope.querySelector(selector),
    $$el: (selector, scope = env.document) => [...scope.querySelectorAll(selector)], cors: { defineTopFunction: noop } };
  stubs['@xuexitong-ai-helper/core/src/core/worker'] = { CourseWorker: Worker };
  stubs['@xuexitong-ai-helper/core/src/utils/common'] = { $: { sleep: async () => {} } };
  stubs['../utils/answer-review'] = { registerAnswerReview: (_root, target) => { reviews.push(target); return 'audit-review'; } };
  stubs['../utils/answer-cache'] = { questionCacheKey: () => 'audit-key' };
  stubs['../utils/configs'] = { workNotes: {}, volume: {}, playbackRate: {}, dropdownStyle: {} };
  stubs['../utils/work'] = { commonWork: (script, options) => { workOptions = options; }, removeRedundantWords: value => value,
    simplifyWorkResult: results => results.map(result => ({ finish: result.result?.finish })) };
  stubs['./common'] = { CommonProject: { scripts: { settings: { cfg: {} }, render: { methods: { pin: noop } },
    apps: { methods: { searchAnswerInCaches: async (title, details) => { queries.push({ title, ...plain(details) }); return settings.query ? settings.query(title, details) : infos(); }, updateReviewedCache: noop } },
    workResults: { cfg: {}, methods: { init: noop, getResults: async () => [], setResults: async () => {}, updateWorkStateByResults: noop } } } } };
  stubs['../utils/ai'] = { queryAIAnswerer: async () => infos(), hasAnswerProvider: () => true };
  if (settings.font) {
    env.window.typrMapping = { '12345678': '23383' };
    stubs.md5 = () => '00000000000000000000000012345678';
    stubs['typr.js'] = { parse: () => [{}], U: { codeToGlyph: () => 1, glyphToPath: () => ({}) } };
  }
  const api = loadTS('packages/scripts/src/projects/cx.ts', globals, stubs);
  const defaults = { aiProvider: 'api', aiApiUrl: 'https://audit.example/v1', aiApiKey: 'audit', aiModel: 'audit',
    thread: 1, period: 0, redundanceWordsText: '', answerSeparators: '#', answerMatchMode: 'similar' };
  return { ...env, clock, queries, tasks, reviews, worker: undefined, async start() {
    await api.CXProject.scripts.work.oncomplete.call(api.CXProject.scripts.work);
    const worker = this.worker = workOptions.workerProvider(defaults);
    await clock.advance(10); return { worker, results: await tasks[tasks.length - 1] };
  } };
}
const choices = '<div class="answerBg"><li><input type="radio" name="a" id="a"><label class="answer_p" for="a">第一项</label></li><li><input type="radio" name="a" id="b"><label class="answer_p" for="b">第二项</label></li></div>';


// Selection chrome changes after the platform saves a choice; it is not question content.
for (const renderer of ['native', 'legacy']) for (const type of ['single', 'multiple', 'judgement']) {
  test('exam ' + type + ' completes when ' + renderer + ' selection icons change', async t => {
    const multiple = type === 'multiple', answer = multiple ? 'A#C' : 'B';
    const labels = type === 'judgement' ? ['正确', '错误'] : ['第一项', '第二项', '第三项'];
    const typeValue = multiple ? 1 : type === 'judgement' ? 3 : 0;
    const rows = labels.map((label, index) => {
      const letter = String.fromCharCode(65 + index);
      const marker = renderer === 'native'
        ? '<input type="' + (multiple ? 'checkbox' : 'radio') + '" name="answer1" id="choice' + letter + '" value="' + letter + '">'
        : '<span class="' + (multiple ? 'num_option_dx' : 'num_option') + '">' + letter + '.</span>';
      return '<li>' + marker + '<label class="answer_p" for="choice' + letter + '">' + label + '</label></li>';
    }).join('');
    const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 选择正确答案</h3><input type="hidden" name="type1" value="' + typeValue + '"><input type="hidden" name="answer" value=""><div class="answerBg">' + rows + '</div></div>', {
      url: 'https://mooc1.chaoxing.com/mooc2/exam/preview', query: () => infos(answer)
    });
    const markers = [...e.document.querySelectorAll('.answerBg input,.num_option,.num_option_dx')];
    const selected = () => markers.flatMap((marker, index) =>
      (renderer === 'native' ? marker.checked : marker.classList.contains('check_answer')) ? [String.fromCharCode(65 + index)] : []);
    for (const marker of markers) {
      marker.style.backgroundImage = 'url("https://static.example.test/unchecked.svg")';
      const target = renderer === 'native' ? marker : marker.parentElement.querySelector('.answer_p');
      target.addEventListener(renderer === 'native' ? 'change' : 'click', () => {
        if (renderer === 'legacy') marker.classList.toggle('check_answer');
        marker.style.backgroundImage = 'url("https://static.example.test/checked.svg")';
        e.document.querySelector('[name="answer"]').value = selected().join('');
      });
    }
    const { results } = await e.start();
    assert.deepEqual(selected(), answer.split('#'));
    assert.equal(results[0].error, undefined);
    assert.equal(results[0].result.finish, true);
    assert.equal(e.queries[0].type, type);
    assert.deepEqual(e.queries[0].options, labels);
    assert.deepEqual(e.queries[0].imageUrls, []);
    assert.equal(e.reviews[0].snapshot().answer, answer);
  });
}

for (const representation of ['img', 'background']) test('choice chrome is excluded while real ' + representation + ' option images remain guarded', async t => {
  let resolveAnswer;
  const picture = representation === 'img' ? '<img class="figure" src="' + PNG + '">' : '<span class="figure" style="background-image:url(&quot;' + PNG + '&quot;)"></span>';
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 选择正确图形</h3><input type="hidden" name="type1" value="0"><div class="answerBg"><li><span class="num_option"><img src="https://static.example.test/radio.png"><svg><path d="M0 0L1 1"></path></svg>A.</span><input type="radio" name="answer1" id="a"><label class="answer_p" for="a">甲</label>' + picture + '</li><li><span class="num_option_dx">B.</span><input type="radio" name="answer1" id="b"><label class="answer_p" for="b">乙</label></li></div></div>', {
    url: 'https://mooc1.chaoxing.com/mooc2/exam/preview', query: () => new Promise(resolve => { resolveAnswer = resolve; })
  });
  const running = e.start(); await e.clock.flush();
  assert.deepEqual(e.queries[0].imageUrls, [PNG]);
  assert.deepEqual(e.queries[0].options, ['甲[图片1]', '乙']);
  const figure = e.document.querySelector('.figure');
  if (representation === 'img') figure.src = GIF;
  else figure.style.backgroundImage = 'url("' + GIF + '")';
  resolveAnswer(infos('A')); await e.clock.advance(1000);
  const { results } = await running;
  assert.equal(results[0].result.finish, false);
  assert.match(results[0].error, /已变化/);
  assert.equal(e.document.querySelector(':checked'), null);
});

test('a real option change after the first exam multiselect write still stops further writes', async t => {
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 多选题</h3><input type="hidden" name="type1" value="1">' + choices.replaceAll('type="radio"', 'type="checkbox"') + '</div>', {
    url: 'https://mooc1.chaoxing.com/mooc2/exam/preview', query: () => infos('A#B')
  });
  e.document.querySelector('#a').addEventListener('change', () => {
    e.document.querySelector('[for="b"]').textContent = '新选项';
  });
  const { results } = await e.start();
  assert.equal(results[0].result.finish, false);
  assert.match(results[0].error, /已变化/);
  assert.equal(e.document.querySelector('#a').checked, true);
  assert.equal(e.document.querySelector('#b').checked, false);
});


for (const renderer of ['link', 'inline-button', 'custom']) test('exam mark action does not become a question image or invalidate a pending answer: ' + renderer, async t => {
  let resolveAnswer;
  const control = renderer === 'link'
    ? '<a id="mark" href="javascript:void(0)"><img src="' + PNG + '">标记</a>'
    : renderer === 'inline-button'
    ? '<button id="mark" type="button" style="background-image:url(&quot;' + PNG + '&quot;)">标记</button>'
    : '<div id="mark" class="marking"><svg><path d="M0 0L1 1"></path></svg>标记</div>';
  const heading = '<h3>1. 选择正确答案' + (renderer === 'inline-button' ? control : '') + '</h3>';
  const footer = renderer === 'inline-button' ? '' : '<div class="question-actions">' + control + '</div>';
  const e = cxSetup(t, '<div class="questionLi" id="q1">' + heading + '<input type="hidden" name="type1" value="0">' + choices + footer + '</div>', {
    url: 'https://mooc1.chaoxing.com/mooc2/exam/preview', query: () => new Promise(resolve => { resolveAnswer = resolve; })
  });
  const running = e.start(); await e.clock.flush();
  const query = e.queries[0];
  assert.equal(query.title, '选择正确答案');
  assert.deepEqual(query.imageUrls, []);
  assert.equal(query.hasImage, false);
  const mark = e.document.querySelector('#mark');
  assert.equal(mark.textContent, '标记');
  mark.innerHTML = '<img src="' + GIF + '">取消标记';
  resolveAnswer(infos('A')); await e.clock.advance(1000);
  const { results } = await running;
  assert.equal(results[0].error, undefined);
  assert.equal(results[0].result.finish, true);
  assert.equal(e.document.querySelector('#a').checked, true);
  assert.equal(mark.textContent, '取消标记');
});

test('real exam images and the word 标记 in stems and options survive mark-control filtering', async t => {
  const e = cxSetup(t, '<div class="questionLi" id="q1"><a href="#" onclick="return false"><img src="' + GIF + '">已标记</a><h3 class="mark_name">1. 标记<img src="' + PNG + '"></h3><p>图中的标记表示什么？</p><input type="hidden" name="type1" value="0">' + choices.replace('第一项', '标记') + '</div>', {
    url: 'https://mooc1.chaoxing.com/mooc2/exam/preview'
  });
  const { results } = await e.start();
  assert.equal(e.queries[0].title, '标记[图片1] 图中的标记表示什么？');
  assert.deepEqual(e.queries[0].imageUrls, [PNG]);
  assert.deepEqual(e.queries[0].options, ['标记', '第二项']);
  assert.equal(results[0].result.finish, true);
});


for (const noise of ['type', 'typeFlag']) test('exam question-specific type wins over the earlier ' + noise + ' input', async t => {
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 选择所有符合条件的选项</h3><input type="hidden" name="' + noise + '" value="0"><input type="hidden" name="type1" value="1">' + choices.replaceAll('type="radio"', 'type="checkbox"') + '</div>', {
    url: 'https://mooc1.chaoxing.com/mooc2/exam/preview', query: () => infos('A#B')
  });
  const { results } = await e.start();
  assert.equal(e.queries[0].type, 'multiple');
  assert.equal(results[0].result.finish, true);
  assert.equal(e.document.querySelectorAll(':checked').length, 2);
});

test('refreshing an exam type helper does not invalidate the real question type', async t => {
  let resolve;
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 选择正确答案</h3><input type="hidden" name="type1" value="0"><input type="hidden" name="typeFlag" value="0">' + choices + '</div>', {
    url: 'https://mooc1.chaoxing.com/mooc2/exam/preview', query: () => new Promise(done => { resolve = done; })
  });
  const running = e.start(); await e.clock.flush();
  e.document.querySelector('[name="typeFlag"]').value = '1';
  resolve(infos('B')); await e.clock.advance(1000);
  const { results } = await running;
  assert.equal(results[0].error, undefined);
  assert.equal(results[0].result.finish, true);
  assert.equal(e.document.querySelector('#b').checked, true);
});

test('an interactive answer option named 标记 is still question content', async t => {
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 选择正确术语</h3><input type="hidden" name="type1" value="0"><div class="answerBg"><li><span class="answer_p" onclick="saveChoice()">标记</span></li><li><span class="answer_p" onclick="saveChoice()">保存</span></li></div></div>', {
    url: 'https://mooc1.chaoxing.com/mooc2/exam/preview', query: () => infos('A')
  });
  const options = [...e.document.querySelectorAll('.answer_p')];
  options.forEach(option => option.addEventListener('click', () => option.setAttribute('aria-checked', 'true')));
  const { results } = await e.start();
  assert.deepEqual(e.queries[0].options, ['标记', '保存']);
  assert.equal(results[0].result.finish, true);
});

test('the actual AI payload includes every stem paragraph outside h3 and excludes the answer area', async t => {
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1.（单选题）请根据以下材料作答</h3><p>关键材料：甲的速度是乙的两倍。</p><p>问题：甲乙谁更快？</p><input id="answertype1" value="0">' + choices + '</div>');
  await e.start(); assert.equal(e.queries.length, 1); assert.match(e.queries[0].title, /甲的速度是乙的两倍/); assert.match(e.queries[0].title, /甲乙谁更快/); assert.ok(!e.queries[0].title.includes('第一项'));
});

test('a sibling paragraph image retains its position and surrounding conditions in the AI payload', async t => {
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1.（单选题）请根据图回答</h3><p>这是已知条件：<img src="' + PNG + '"></p><input id="answertype1" value="0">' + choices + '</div>');
  await e.start(); const query = e.queries[0];
  assert.equal(query.imageUrls.length, 1); assert.ok(query.title.includes('[图片1]')); assert.ok(query.title.includes('已知条件'));
});

test('an image-only stem without h3 reaches AI and can be answered', async t => {
  const e = cxSetup(t, '<div class="questionLi" id="q1"><p><img src="' + PNG + '"></p><input id="answertype1" value="0">' + choices + '</div>');
  const { results } = await e.start();
  assert.equal(e.queries.length, 1); assert.equal(e.queries[0].title, '[图片1]'); assert.equal(results[0].result.finish, true);
});

test('visible Chaoxing homework headings marked aria-hidden still reach AI', async t => {
  const e = cxSetup(t, '<div class="questionLi"><h3 class="mark_name colorDeep fontLabel workTextWrap" aria-hidden="true">1. (填空题, 8分)<p>填写 SQL 查询中的关键字：select sid ___ students</p></h3><input type="hidden" id="answertype1" value="2"><div class="eidtDiv"><textarea></textarea></div></div>', { query: () => infos('from') });
  const { results } = await e.start();
  assert.equal(e.queries.length, 1);
  assert.match(e.queries[0].title, /select sid ___ students/);
  assert.equal(e.queries[0].type, 'completion');
  assert.equal(results[0].result.finish, true);
  assert.equal(e.document.querySelector('textarea').value, 'from');
  assert.equal(e.document.querySelector('h3').getAttribute('aria-hidden'), 'true');
});

test('aria-hidden on a visible question ancestor preserves its image stem and image options', async t => {
  const pictureChoices = choices.replace('第一项', '<img aria-hidden="true" src="' + PNG + '">').replace('第二项', '<img src="' + GIF + '">');
  const e = cxSetup(t, '<div aria-hidden="true"><div class="questionLi"><h3 aria-hidden="true"><img aria-hidden="true" src="' + PNG + '"></h3><input type="hidden" id="answertype1" value="0">' + pictureChoices + '</div></div>');
  const { results } = await e.start();
  assert.equal(e.queries.length, 1);
  assert.equal(e.queries[0].title, '[图片1]');
  assert.deepEqual(e.queries[0].imageUrls, [PNG, GIF]);
  assert.deepEqual(e.queries[0].options, ['[图片1]', '[图片2]']);
  assert.equal(results[0].result.finish, true);
  assert.equal(e.document.querySelector('#a').checked, true);
});

test('secret-font decoding preserves option nodes and native event listeners', async t => {
  const e = cxSetup(t, '<style>@font-face{font-family:font-cxsecret;src:url(data:font/ttf;base64,AQID)}</style><div class="questionLi" id="q1"><h3>1.（单选题）选择字</h3><input id="answertype1" value="0"><div class="answerBg font-cxsecret">' + choices + '漢</div></div>', { font: true });
  const original = e.document.querySelector('.answer_p'); let clicks = 0; original.addEventListener('click', () => clicks++);
  const { results } = await e.start();
  assert.equal(results[0].ctx.elements.options[0], original); assert.equal(original.isConnected, true); assert.equal(results[0].result.finish, true); assert.equal(clicks, 1);
  assert.equal(e.document.querySelectorAll('.answer_p').length, 2);

});

test('a late answer cannot be written after the question changes in place during a real worker request', async t => {
  let finish;
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 旧题</h3><input id="answertype1" value="0">' + choices + '</div>', {
    query: () => new Promise(resolve => { finish = resolve; })
  });
  const running = e.start(); await e.clock.flush();
  assert.equal(e.queries.length, 1);
  e.document.querySelector('h3').textContent = '2. 新题，内容已变更';
  [...e.document.querySelectorAll('.answer_p')].forEach((label, i) => { label.textContent = '新选项' + i; });
  finish(infos('A')); await e.clock.advance(1000);
  const { results } = await running;
  assert.equal(results[0].result.finish, false); assert.equal(e.document.querySelector(':checked'), null); assert.match(results[0].error, /已变化/);
});



for (const hidden of ['hidden', 'style="display:none"', 'style="visibility:hidden"', 'style="visibility:collapse"', 'aria-hidden="true" hidden', 'aria-hidden="true" style="display:none"']) {
  test('hidden question content is ignored for ' + hidden, t => {
    const e = aiSetup(t, '<div id="q"><p>可见内容<img src="' + PNG + '"></p><div ' + hidden + '><img><span>旧题</span></div><img ' + hidden + '></div>');
    const root = e.document.querySelector('#q'), images = e.q.inspectQuestionImages([root]);
    assert.deepEqual(plain(images.imageUrls), [PNG]); assert.equal(images.unresolvedImageCount, 0);
    assert.equal(e.q.questionElementText(root, images.imageUrls), '可见内容[图片1]');
  });
}

test('an unresolved visible image still blocks an incomplete question', async t => {
  const e = aiSetup(t, '<h3>请根据图回答<img></h3>'), root = e.document.querySelector('h3');
  const images = e.q.inspectQuestionImages([root]);
  const result = await e.ai.queryAIAnswerer(e.opts, { title: '请根据图回答', type: 'single', options: ['甲','乙'], ...images });
  assert.equal(images.unresolvedImageCount, 1); assert.equal(e.calls.length, 0);
  assert.match(result[0].error, /图片地址/);
});

test('editor toolbar images and template text are excluded from the real question payload', async t => {
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 选择正确答案</h3><div class="edui-editor-toolbarbox"><img><p>撤销、重做</p></div><template><img><p>隐藏模板</p></template><input id="answertype1" value="0">' + choices + '</div>');
  const { results } = await e.start();
  assert.equal(results[0].result.finish, true); assert.equal(e.queries[0].hasImage, false);
  assert.ok(!e.queries[0].title.includes('撤销')); assert.ok(!e.queries[0].title.includes('隐藏模板'));
});

test('image-only option metadata and markers survive the actual worker from extraction to click', async t => {
  const pictureChoices = choices.replace('第一项', '<img src="' + PNG + '">').replace('第二项', '<img src="' + GIF + '">');
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 选择正确图形</h3><input id="answertype1" value="0">' + pictureChoices + '</div>');
  const { results } = await e.start();
  assert.equal(results[0].result.finish, true); assert.equal(e.document.querySelector('#a').checked, true);
  assert.deepEqual(e.queries[0].imageUrls, [PNG, GIF]); assert.deepEqual(e.queries[0].options, ['[图片1]', '[图片2]']);
});

for (const change of ['choice', 'type', 'id', 'stem', 'image']) test('a queued result is rejected when ' + change + ' changes independently', async t => {
  let finish;
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 原题<img src="' + PNG + '"></h3><p>原条件</p><input id="answertype1" value="0"><input type="hidden" name="questionid" value="1">' + choices + '</div>', {
    query: () => new Promise(resolve => { finish = resolve; })
  });
  const running = e.start(); await e.clock.flush();
  if (change === 'choice') e.document.querySelector('.answer_p').textContent = '新选项';
  if (change === 'type') e.document.querySelector('#answertype1').value = '1';
  if (change === 'id') e.document.querySelector('[name=questionid]').value = '2';
  if (change === 'stem') e.document.querySelector('p').textContent = '新条件';
  if (change === 'image') e.document.querySelector('img').src = GIF;
  finish(infos()); await e.clock.advance(1000); const { results } = await running;
  assert.equal(results[0].result.finish, false); assert.equal(e.document.querySelector(':checked'), null);
  assert.match(results[0].error, /已变化/);
});

test('manual choice selection while AI is pending is retained rather than replaced by its result', async t => {
  let finish;
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 选择正确答案</h3><input id="answertype1" value="0">' + choices + '</div>', {
    query: () => new Promise(resolve => { finish = resolve; })
  });
  const running = e.start(); await e.clock.flush(); e.document.querySelector('#b').checked = true;
  finish(infos('A')); await e.clock.advance(1000); const { results } = await running;
  assert.equal(results[0].result.finish, false); assert.equal(e.document.querySelector('#b').checked, true);
  assert.match(results[0].error, /手动修改/);
});

test('a partially edited blank while AI is pending remains untouched', async t => {
  let finish;
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 填空</h3><input id="answertype1" value="2"><div class="eidtDiv"><textarea></textarea></div><div class="eidtDiv"><textarea></textarea></div></div>', {
    query: () => new Promise(resolve => { finish = resolve; })
  });
  const running = e.start(); await e.clock.flush(); const blanks = e.document.querySelectorAll('textarea'); blanks[0].value = '手动内容';
  finish(infos('one#two')); await e.clock.advance(1000); const { results } = await running;
  assert.equal(results[0].result.finish, false); assert.equal(blanks[0].value, '手动内容'); assert.equal(blanks[1].value, '');
  assert.match(results[0].error, /手动修改/);
});

test('guard permits its own multiselect writes without treating them as a manual edit', async t => {
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 多选题</h3><input id="answertype1" value="1">' + choices.replaceAll('type="radio"', 'type="checkbox"') + '</div>', { query: () => infos('A#B') });
  const { results } = await e.start();
  assert.equal(results[0].result.finish, true); assert.equal(e.document.querySelectorAll(':checked').length, 2);
});

test('guard permits filling both blanks without confusing saved answer values with question identity', async t => {
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 填空题</h3><input id="answertype1" value="2"><div class="eidtDiv"><textarea></textarea></div><div class="eidtDiv"><textarea></textarea></div></div>', { query: () => infos('one#two') });
  const { results } = await e.start();
  assert.equal(results[0].result.finish, true); assert.deepEqual([...e.document.querySelectorAll('textarea')].map(text => text.value), ['one', 'two']);
});

test('matching retains semantic native options when Chosen hides its backing selects', async t => {
  const html = fs.readFileSync(path.join(ROOT, 'tests/fixtures/matching-new.html'), 'utf8');
  const e = cxSetup(t, html, { query: () => infos('b#a') });
  e.document.querySelectorAll('select').forEach(select => { select.style.display = 'none'; });
  const { results } = await e.start();
  assert.equal(results[0].result.finish, true); assert.deepEqual([...e.document.querySelectorAll('select')].map(select => select.value), ['b', 'a']);
});


test('legacy choice markers edited during a pending request are preserved without hidden answer inputs', async t => {
  let finish;
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 单选题</h3><input id="answertype1" value="0"><div class="answerBg"><li><span class="answer_p">甲</span></li><li><span class="answer_p">乙</span></li></div></div>', { query: () => new Promise(resolve => { finish = resolve; }) });
  const running = e.start(); await e.clock.flush();
  const option = e.document.querySelectorAll('.answer_p')[1]; option.setAttribute('aria-checked', 'true');
  finish(infos()); await e.clock.advance(1000); const { results } = await running;
  assert.equal(results[0].result.finish, false); assert.equal(option.getAttribute('aria-checked'), 'true');
  assert.match(results[0].error, /手动修改/);
});

test('refreshing an unrelated hidden autosave token does not invalidate an otherwise unchanged answer', async t => {
  let finish;
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 单选题</h3><input id="answertype1" value="0"><input type="hidden" name="csrf" value="old">' + choices + '</div>', { query: () => new Promise(resolve => { finish = resolve; }) });
  const running = e.start(); await e.clock.flush(); e.document.querySelector('[name=csrf]').value = 'new';
  finish(infos()); await e.clock.advance(1000); const { results } = await running;
  assert.equal(results[0].result.finish, true); assert.equal(e.document.querySelector('#a').checked, true);
});


test('chapter stems exclude custom label options even when no radio inputs are rendered', t => {
  const e = aiSetup(t, '<div class="TiMu"><div class="Zy_TItle"><div class="clearfix">题干</div></div><p>必要的材料</p><ul><li><a class="before">A</a><label class="after">第一项</label></li><li><a class="before">B</a><label class="after">第二项</label></li></ul><input id="answertype1" type="hidden" value="0"></div>');
  const { cxQuestionTitles } = loadTS('packages/scripts/src/utils/cx-question.ts', e.globals);
  const titles = cxQuestionTitles(e.document.querySelector('.TiMu'), '.Zy_TItle .clearfix', 'ul li .after,ul li label:not(.before)');
  const title = titles.map(node => e.q.questionElementText(node, [])).join(' ');
  assert.match(title, /题干/); assert.match(title, /必要的材料/); assert.ok(!title.includes('第一项')); assert.ok(!title.includes('第二项'));
});


test('explicitly accepting an answer-review proposal can replace the saved answer under the same question guard', async t => {
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 单选题</h3><input id="answertype1" value="0">' + choices + '</div>');
  e.document.querySelector('#b').checked = true;
  const { results } = await e.start();
  assert.equal(results[0].result.preAnswered, true); assert.equal(e.queries.length, 0);
  assert.doesNotThrow(() => e.reviews[0].available());
  assert.equal(await e.reviews[0].apply(infos('A')), true);
  assert.equal(e.document.querySelector('#a').checked, true); assert.equal(e.document.querySelector('#b').checked, false);
});

test('an answer-review proposal is rejected after its stem changes', async t => {
  const e = cxSetup(t, '<div class="questionLi" id="q1"><h3>1. 单选题</h3><input id="answertype1" value="0">' + choices + '</div>');
  e.document.querySelector('#b').checked = true; await e.start();
  e.document.querySelector('h3').textContent = '另一道题';
  assert.throws(() => e.reviews[0].available(), /已变化/);
  await assert.rejects(e.reviews[0].apply(infos('A')), /已变化/);
  assert.equal(e.document.querySelector('#b').checked, true);
});

const underlinedCompletion = fs.readFileSync(path.join(ROOT, 'tests/fixtures/completion-underlined.html'), 'utf8');
const sqlAnswers = ['INTERSECT', 'DISTINCT', 'IN', 'JOIN', 'ON', "ch1.cid='10014'"];
test('underlined whitespace reaches the actual worker as six blank positions and six answer fields', async t => {
  const e = cxSetup(t, underlinedCompletion, { query: () => infos(sqlAnswers.join('#')) });
  const originalTitle = e.document.querySelector('h3').innerHTML;
  const { results } = await e.start();
  assert.equal(e.queries[0].blankCount, 6);
  assert.equal((e.queries[0].title.match(/____/g) || []).length, 6);
  assert.match(e.queries[0].title, /select ____ sid/);
  assert.match(e.queries[0].title, /sid ____ \(select sid/);
  assert.equal(results[0].result.finish, true);
  assert.deepEqual([...e.document.querySelectorAll('textarea')].map(input => input.value), sqlAnswers);
  assert.equal(e.document.querySelector('h3').innerHTML, originalTitle);
});

test('five returned answers for six blanks report the mismatch before writing any field', async t => {
  const e = cxSetup(t, underlinedCompletion, { query: () => infos("INTERSECT#IN#JOIN#ON#ch1.cid='10014'") });
  const { results } = await e.start();
  assert.equal(results[0].result.finish, false);
  assert.match(results[0].error, /6.*5/);
  assert.deepEqual([...e.document.querySelectorAll('textarea')].map(input => input.value), Array(6).fill(''));
});

for (const provider of ['openai', 'anthropic', 'web']) test('completion prompts include the actual blank count for ' + provider, async t => {
  const e = aiSetup(t);
  if (provider === 'anthropic') e.opts.aiApiUrl = 'https://api.anthropic.com';
  if (provider === 'web') e.opts.aiProvider = 'deepseek-web';
  await e.ai.queryAIAnswerer(e.opts, { title: 'select ____ sid from choices where sid ____ (select sid from choices)', type: 'completion', blankCount: 2 });
  const prompt = provider === 'web' ? e.webCalls[0][0] : JSON.stringify(e.calls[0].data.messages);
  assert.match(prompt, /本题共有 2 个空/);
  assert.match(prompt, /answers.*2/);
  assert.match(prompt, /select ____ sid/);
});
