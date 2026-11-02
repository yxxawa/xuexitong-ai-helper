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
  const backing = root.querySelector('.code-editor'), queries = [], corrections = [], runs = [], writes = [], tasks = [], messages = [];
  let source = options.source ?? draft, workerOptions,runSignal=Boolean(options.locked);
  const button=root.querySelector('#runBtn'),status=root.querySelector('#runstatus'),notifications=[];
  const changed=()=>{runSignal=false;button.className='jb_btn_92';env.window.isContentChanged=true;};
  const editor = { getValue: () => source, getOption: () => false, getTextArea: () => backing,
    setValue: value => { writes.push(value); source = value;changed(); }, save: () => { backing.value = source; } };
  wrapper.CodeMirror = editor; env.window.codeEditors = { 1: editor };env.window.isContentChanged=false;
  env.window.CodeMirror={signal(target,event){assert.equal(target,editor);assert.equal(event,'change');notifications.push(event);changed();}};
  if(options.locked)button.className='jb_btn_92_disable';
  button.onclick = () => { if(runSignal)return;runs.push(source);button.className='jb_btn_92_disable';status.style.display='inline';clock.setTimeout(() => {
    status.style.display='none';runSignal=true;
    if(options.noOutput)return;
    const passed=options.alwaysFail?false:source===complete;
    root.querySelector('#output').innerHTML = '<textarea class="runResult '+(passed?'result_right':'result_wrong')+'">'+(passed?'全部测试用例通过':'输出不符：程序未输出输入值的两倍')+'</textarea>';
  }, 10); };
  const globals = { ...env.globals, ...clock.globals(), top: env.window, AbortController, queueMicrotask };
  const noop = () => {};
  const easy = { CommonEventEmitter: EventEmitter, $: { sleep: async () => {} } };
  const actualWorker = loadTS('packages/core/src/core/worker/worker.ts', globals, { 'easy-us': easy }).CourseWorker;
  class Worker extends actualWorker { doWork(opts) { const task = super.doWork(opts); tasks.push(task); return task; } }
  const stubs = {};
  for (const match of fs.readFileSync(path.join(ROOT, 'packages/scripts/src/projects/cx.ts'), 'utf8').matchAll(/from ['"]([^'"]+)['"]/g)) stubs[match[1]] = {};
  for (const name of ['../utils/answer-writer','../utils/programming','../utils/programming-runner','../utils/answer-input','../utils/question','../utils/cx-question','../utils/question-guard','@xuexitong-ai-helper/core/src/core/utils/dom']) delete stubs[name];
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
  stubs['../utils/ai'] = { queryAIAnswerer: async (config,payload) => {
    corrections.push(plain(payload));
    return options.correct ? options.correct({payload,editor,clock}) : info(complete);
  }, hasAnswerProvider: () => true };
  const api = loadTS('packages/scripts/src/projects/cx.ts', globals, stubs);
  const defaults = { aiProvider: 'api', aiApiUrl: 'https://model.example.test/v1', aiApiKey: 'fixture', aiModel: 'fixture',
    aiTemperature: 0, aiUseResponseFormat: false, thread: 1, period: 0, redundanceWordsText: '', answerSeparators: '#', answerMatchMode: 'similar' };
  return { ...env, clock, root, editor, queries, corrections, runs, writes, tasks, messages, notifications, api, async start(changes = {}) {
    await api.CXProject.scripts.work.oncomplete.call(api.CXProject.scripts.work);
    const worker = workerOptions.workerProvider({ ...defaults, ...changes });
    for (let tick = 0; tick < 8 && worker.isRunning; tick++) await clock.advance(options.advanceMs || 1000);
    assert.equal(worker.isRunning, false, 'the program attempt must settle within its simulated run budget');
    return { worker, results: await tasks[tasks.length - 1] };
  } };
}
test('an existing correct program runs once without querying AI or rewriting the editor', async t => {
  const e=setup(t,{source:complete}),{results}=await e.start();
  assert.equal(e.queries.length,0);assert.equal(e.corrections.length,0);assert.deepEqual(e.writes,[]);
  assert.deepEqual(e.runs,[complete]);assert.equal(e.editor.getValue(),complete);
  assert.equal(results[0].result.finish,true);assert.equal(results[0].result.preAnswered,true);assert.equal(results[0].result.programmingAttempts,1);
});
test('an existing incomplete program runs first, then sends the full question, source and fresh error for correction', async t => {
  const e=setup(t),{results}=await e.start();
  assert.equal(e.queries.length,0);assert.equal(e.corrections.length,1);assert.match(e.corrections[0].title,/Python 3\.6\.9/);
  assert.equal(e.corrections[0].programmingFeedback.answer,draft);assert.match(e.corrections[0].programmingFeedback.output,/输出不符/);
  assert.equal(e.corrections[0].programmingFeedback.attempt,1);
  assert.deepEqual(e.runs,[draft,complete]);assert.deepEqual(e.writes,[complete]);
  assert.equal(results[0].result.finish,true);assert.equal(results[0].result.programmingAttempts,2);assert.equal(results[0].result.preAnswered,false);
});
test('starting again tests the current saved code once more, and edited failing code is corrected only after a new run', async t => {
  const e=setup(t,{source:complete});await e.start();await e.start();
  assert.equal(e.queries.length,0);assert.equal(e.corrections.length,0);assert.deepEqual(e.runs,[complete,complete]);assert.deepEqual(e.writes,[]);
  const edited='value = int(input())\nprint(value)\n';e.editor.setValue(edited);
  const third=await e.start();assert.equal(e.corrections.length,1);assert.equal(e.runs[2],edited);assert.equal(e.runs[3],complete);
  assert.equal(third.results[0].result.finish,true);
});
test('an empty editor follows the usual AI answer flow, while explicit redo still requests a new answer', async t => {
  const empty=setup(t,{source:''});await empty.start();
  assert.equal(empty.queries.length,1);assert.equal(empty.corrections.length,0);assert.deepEqual(empty.runs,[complete]);
  const redo=setup(t,{source:complete});await redo.start({forceAnswer:true});
  assert.equal(redo.queries.length,1);assert.deepEqual(redo.writes,[complete]);assert.equal(redo.corrections.length,0);
});
test('manual edits while the initial answer request is pending are preserved', async t => {
  const e=setup(t,{source:'',query:({editor})=>{editor.setValue('print("manual edit")\n');return info(complete);}});
  const {results}=await e.start();assert.equal(e.editor.getValue(),'print("manual edit")\n');assert.equal(e.runs.length,0);
  assert.equal(results[0].result.finish,false);assert.match(results[0].error,/手动修改/);
});
test('manual edits during correction cannot be overwritten by an answer to an earlier failed program', async t => {
  const e=setup(t,{correct:({editor})=>{editor.setValue('print("manual edit")\n');return info(complete);}});
  const {results}=await e.start();assert.equal(e.editor.getValue(),'print("manual edit")\n');assert.deepEqual(e.runs,[draft]);
  assert.equal(results[0].result.finish,false);assert.match(results[0].error,/代码已变化/);
});
test('three failing runs of an existing program mean only two AI corrections and no successful completion', async t => {
  const e=setup(t,{alwaysFail:true}),{results}=await e.start();
  assert.equal(e.queries.length,0);assert.equal(e.corrections.length,2);assert.equal(e.runs.length,3);assert.equal(e.writes.length,2);
  assert.equal(results[0].result.finish,false);assert.equal(results[0].result.programmingAttempts,3);assert.match(results[0].error,/3 次仍未通过/);
});
test('an existing program with stale green output is not accepted when its new run returns nothing', async t => {
  const e=setup(t,{source:complete,noOutput:true,advanceMs:61000}),{results}=await e.start();
  assert.equal(e.queries.length,0);assert.equal(e.corrections.length,0);assert.deepEqual(e.writes,[]);assert.deepEqual(e.runs,[complete]);
  assert.equal(results[0].result.finish,false);assert.match(results[0].error,/超时/);
});

test('a previously run correct program with the native grey gate is tested without an AI call or source rewrite',async t=>{
  const e=setup(t,{source:complete,locked:true}),{results}=await e.start();
  assert.equal(results[0].result.finish,true);assert.equal(results[0].result.preAnswered,true);
  assert.deepEqual(e.runs,[complete]);assert.deepEqual(e.writes,[]);assert.equal(e.queries.length,0);assert.equal(e.corrections.length,0);
  assert.deepEqual(e.notifications,['change']);assert.equal(e.window.isContentChanged,false);
});
test('a previously run incomplete program with the native grey gate is tested first, then corrected on fresh failure',async t=>{
  const e=setup(t,{locked:true}),{results}=await e.start();
  assert.equal(results[0].result.finish,true);assert.equal(results[0].result.programmingAttempts,2);
  assert.deepEqual(e.runs,[draft,complete]);assert.deepEqual(e.writes,[complete]);assert.equal(e.queries.length,0);
  assert.equal(e.corrections.length,1);assert.equal(e.corrections[0].programmingFeedback.answer,draft);
  assert.deepEqual(e.notifications,['change']);
});
