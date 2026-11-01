const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ROOT, Clock, domRuntime, loadTS, plain } = require('./helpers/runtime.cjs');
const complete = 'value = int(input())\nprint(value * 2)\n';
const draft = 'value = int(input())\n';
function info(answer) { return [{ name: 'AI fixture', results: [{ question: '双倍输出', answer }] }]; }
function setup(t, options = {}) {
  const html = '<div class="questionLi" id="q1"><h3>1. 读入整数并输出两倍（程序题）</h3>' +
    '<input id="answertype1" type="hidden" value="17"><input id="answer1" type="hidden">' +
    '<input class="languageSelect" value="16" type="hidden"><strong class="selectBoxLang" codename="Python 3.6.9"></strong>' +
    '<div class="proceduralQue" data="1"><textarea class="code-editor" data-business-id="1"></textarea><div class="CodeMirror"><textarea></textarea></div>' +
    '<button id="runBtn">运行</button><span id="runstatus" style="display:none"></span><div id="output"><textarea class="runResult result_right">旧的运行成功</textarea></div></div></div>';
  const env = domRuntime(html, 'https://mooc1.chaoxing.com/mooc2/work/dowork');
  t.after(() => env.window.close());
  const clock = new Clock(), root = env.document.querySelector('.questionLi'), wrapper = root.querySelector('.CodeMirror');
  const backing = root.querySelector('.code-editor'), queries = [], runs = [], tasks = [], messages = [];
  let source = options.source ?? draft, workerOptions;
  const editor = { getValue: () => source, getOption: () => false, getTextArea: () => backing,
    setValue: value => { source = value; }, save: () => { backing.value = source; } };
  wrapper.CodeMirror = editor; env.window.codeEditors = { 1: editor };
  root.querySelector('#runBtn').onclick = () => { runs.push(source); clock.setTimeout(() => {
    root.querySelector('#output').innerHTML = '<textarea class="runResult result_right">全部测试用例通过</textarea>';
  }, 10); };
  const globals = { ...env.globals, ...clock.globals(), top: env.window, AbortController, queueMicrotask };
  const noop = () => {};
  const easy = { CommonEventEmitter: EventEmitter, $: { sleep: async () => {} } };
  const actualWorker = loadTS('packages/core/src/core/worker/worker.ts', globals, { 'easy-us': easy }).CourseWorker;
  class Worker extends actualWorker { doWork(opts) { const task = super.doWork(opts); tasks.push(task); return task; } }
  const stubs = {};
  for (const match of fs.readFileSync(path.join(ROOT, 'packages/scripts/src/projects/cx.ts'), 'utf8').matchAll(/from ['"]([^'"]+)['"]/g)) stubs[match[1]] = {};
  for (const name of ['../utils/answer-writer','../utils/programming','../utils/programming-runner','../utils/answer-input','../utils/question','../utils/cx-question']) delete stubs[name];
  class Script { constructor(opts) { Object.assign(this, opts); this.cfg = Object.fromEntries(Object.entries(opts.configs || {}).map(([key, config]) => [key, config.defaultValue])); } }
  const h = tag => env.document.createElement(tag);
  stubs['easy-us'] = { ...easy, Project: { create: value => value }, Script, h, $gm: { unsafeWindow: env.window },
    $ui: { notes: () => h('div') }, $message: Object.fromEntries(['info','warn','error','success'].map(key => [key, value => messages.push(value)])),
    $modal: { alert: noop }, $el: (selector, scope = env.document) => scope.querySelector(selector),
    $$el: (selector, scope = env.document) => [...scope.querySelectorAll(selector)], cors: { defineTopFunction: noop } };
  stubs['@xuexitong-ai-helper/core/src/core/worker'] = { CourseWorker: Worker };
  stubs['@xuexitong-ai-helper/core/src/utils/common'] = { $: { sleep: async () => {} } };
  stubs['../utils/answer-review'] = { registerAnswerReview: () => 'fixture-review' };
  stubs['../utils/answer-cache'] = { questionCacheKey: () => 'fixture-key' };
  stubs['../utils/configs'] = { workNotes: {}, volume: {}, playbackRate: {}, dropdownStyle: {} };
  stubs['../utils/work'] = { commonWork: (script, options) => { workerOptions = options; },
    removeRedundantWords: value => value, simplifyWorkResult: results => results.map(result => ({ finish: result.result?.finish })) };
  stubs['./common'] = { CommonProject: { scripts: {
    settings: { cfg: {} }, render: { methods: { pin: noop } },
    apps: { methods: { searchAnswerInCaches: async (title, details) => {
      queries.push({ title, ...plain(details) });
      return options.query ? options.query({ title, details, editor, clock }) : info(complete);
    }, updateReviewedCache: noop, removeFailedProgramCache: noop } },
    workResults: { cfg: {}, methods: { init: noop, getResults: async () => [], setResults: async () => {}, updateWorkStateByResults: noop } }
  } } };
  stubs['../utils/ai'] = { queryAIAnswerer: async () => info(complete), hasAnswerProvider: () => true };
  const api = loadTS('packages/scripts/src/projects/cx.ts', globals, stubs);
  const defaults = { aiProvider: 'api', aiApiUrl: 'https://model.example.test/v1', aiApiKey: 'fixture', aiModel: 'fixture',
    aiTemperature: 0, aiUseResponseFormat: false, thread: 1, period: 0, redundanceWordsText: '', answerSeparators: '#', answerMatchMode: 'similar' };
  return { ...env, clock, root, editor, queries, runs, tasks, messages, api, async start(changes = {}) {
    await api.CXProject.scripts.work.oncomplete.call(api.CXProject.scripts.work);
    const worker = workerOptions.workerProvider({ ...defaults, ...changes });
    await clock.advance(1000);
    return { worker, results: await tasks[tasks.length - 1] };
  } };
}
test('a syntactically valid half-written program and an old green output request AI completion before running', async t => {
  const e = setup(t), { results } = await e.start();
  assert.equal(e.queries.length, 1); assert.equal(e.queries[0].programmingDraft, draft);
  assert.match(e.queries[0].title, /Python 3\.6\.9/);
  assert.deepEqual(e.runs, [complete]); assert.equal(e.editor.getValue(), complete);
  assert.equal(results[0].result.finish, true); assert.notEqual(results[0].result.preAnswered, true);
});
test('starting again skips only the unchanged program verified after AI completion, and edited drafts run through AI again', async t => {
  const e = setup(t); await e.start();
  const second = await e.start(); assert.equal(second.results[0].result.preAnswered, true);
  assert.equal(e.queries.length, 1); assert.equal(e.runs.length, 1);
  e.editor.setValue('value = int(input())\nprint(value)\n');
  const third = await e.start(); assert.equal(e.queries.length, 2); assert.equal(e.runs.length, 2);
  assert.notEqual(third.results[0].result.preAnswered, true); assert.equal(third.results[0].result.finish, true);
});
test('an empty program still obtains a complete AI answer and explicit redo discards draft reuse', async t => {
  const empty = setup(t, { source: '' }); await empty.start();
  assert.equal(empty.queries.length, 1); assert.equal(empty.queries[0].programmingDraft, undefined);
  const e = setup(t); await e.start({ forceAnswer: true });
  assert.equal(e.queries.length, 1); assert.equal(e.queries[0].programmingDraft, undefined); assert.deepEqual(e.runs, [complete]);
});
test('manual edits while the initial completion request is pending are kept and not marked finished', async t => {
  const e = setup(t, { query: ({ editor }) => { editor.setValue('print("manual edit")\n'); return info(complete); } });
  const { results } = await e.start();
  assert.equal(e.editor.getValue(), 'print("manual edit")\n'); assert.equal(e.runs.length, 0);
  assert.equal(results[0].result?.finish, false); assert.match(results[0].error, /手动修改/);
});