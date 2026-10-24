const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, Clock, domRuntime, loadTS } = require('./helpers/runtime.cjs');
function setup(t, options = {}) {
  const env = domRuntime(options.html || '', 'https://mooc1.chaoxing.com/knowledge/cards');
  const clock = new Clock(), messages = [], alerts = [], jumps = [];
  const noop = () => {};
  env.window.HTMLElement.prototype.scrollIntoView = noop;
  env.window.PCount = { next: (...args) => jumps.push(args) };
  if (!options.loading) env.window.attachments = options.attachments || [];
  const stubs = {};
  // Isolate unrelated AI/UI dependencies, not the actual study implementation.
  const source = fs.readFileSync(path.join(ROOT, 'packages/scripts/src/projects/cx.ts'), 'utf8');
  for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) stubs[match[1]] = {};
  delete stubs['../utils/study']; delete stubs['../utils/study-media']; delete stubs['../utils/video-quiz'];
  class Script {
    constructor(options) {
      Object.assign(this, options);
      this.cfg = Object.fromEntries(Object.entries(options.configs || {}).map(([key, value]) => [key, value.defaultValue]));
    }
  }
  const h = (tag, attrs = {}, children) => {
    const el = env.document.createElement(tag); Object.assign(el, attrs);
    if (typeof children === 'string') el.textContent = children;
    return el;
  };
  const ui = { notes: () => h('div'), button: () => h('button') };
  const modal = { alert: attrs => { alerts.push(attrs); return h('div'); } };
  const message = Object.fromEntries(['info', 'warn', 'error', 'success'].map(type => [type, value => {
    messages.push({ type, content: typeof value === 'string' ? value : value.content }); return h('div');
  }]));
  stubs['easy-us'] = { Project: { create: value => value }, Script, h, $ui: ui, $modal: modal, $message: message,
    $gm: { unsafeWindow: env.window }, $store: { getTab: async () => ({}), setTab: async () => {} },
    $el: (selector, root = env.document) => root.querySelector(selector),
    $$el: (selector, root = env.document) => Array.from(root.querySelectorAll(selector)),
    cors: { defineTopFunction: () => noop } };
  stubs['../utils/configs'] = { volume: { defaultValue: 0 }, playbackRate: { defaultValue: 1 }, dropdownStyle: {}, workNotes: {} };
  stubs['./common'] = { CommonProject: { scripts: { settings: { cfg: {}, methods: {
    getWorkOptions: () => ({}), notificationBySetting: noop } } } } };
  stubs['../utils/ai'] = { hasAnswerProvider: () => options.provider !== false };
  stubs['../utils/work'] = { aiConfigEmptyWarning: noop };
  stubs['@xuexitong-ai-helper/core/src/core/utils/dom'] = {
    domSearch: (selectors, root) => Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [key, root.querySelector(selector)]))
  };
  const globals = { ...env.globals, ...clock.globals(), AbortController, top: env.window, console: { ...console, info: noop, warn: noop, error: noop, debug: noop } };
  stubs['../utils'] = loadTS('packages/scripts/src/utils/index.ts', globals, { ...stubs, './work': {}, './ai': {} });
  const api = loadTS('packages/scripts/src/projects/cx.ts', globals, stubs);
  Object.assign(api.CXProject.scripts.study.cfg, options.cfg || {});
  const cfg = api.CXProject.scripts.study.cfg;
  t.after(() => { env.window.dispatchEvent(new env.window.Event('pagehide')); env.window.close(); });
  function addRead(id, callback, data = { jobid: id }) {
    const frame = env.document.createElement('iframe'); frame.setAttribute('data', JSON.stringify(data)); env.document.body.append(frame);
    frame.contentDocument.body.innerHTML = '<img id="img" class="imglook">'; frame.contentWindow.finishJob = callback;
    return frame;
  }
  return { ...env, clock, api, cfg, messages, alerts, jumps, addRead,
    start: () => api.study({ ...cfg, workOptions: {} }) };
}
function attachment(id) { return { jobid: id, job: true, property: { _jobid: id, mid: 'same-mid', module: 'insertdoc', name: id } }; }
const chapterParams = '<input id="curCourseId" value="course"><input id="curChapterId" value="chapter"><input id="curClazzId" value="class">';
function chapter(id, active, count) {
  return `<div class="posCatalog_select ${active ? 'posCatalog_active' : ''}" id="${id}"><input class="jobUnfinishCount" value="${count}"><a class="posCatalog_name" onclick="getTeacherAjax('course','class','${id}')">${id}</a></div>`;
}
test('actual chapter runner executes two distinct job IDs even with the same mid and runs only once', async t => {
  const e = setup(t, { attachments: [attachment('first'), attachment('second')], cfg: { mode: 'manually' } }), calls = [];
  e.addRead('first', () => calls.push('first')); e.addRead('second', () => calls.push('second'));
  const first = e.start(), second = e.start(); assert.equal(first, second);
  await e.clock.advance(30000); await first;
  assert.deepEqual(calls, ['first', 'second']); assert.equal(e.jumps.length, 0);
  assert.equal(e.messages.some(message => message.type === 'error'), false); assert.equal(e.clock.timers.size, 0);
});
test('late metadata and an iframe mounted after twelve seconds are handled by the actual chapter runner', async t => {
  const e = setup(t, { loading: true, cfg: { mode: 'manually' } }); let calls = 0;
  const task = e.start(); await e.clock.advance(12000);
  e.window.attachments = [attachment('late')]; e.addRead('late', () => calls++);
  await e.clock.advance(20000); await task;
  assert.equal(calls, 1); assert.equal(e.messages.some(message => message.type === 'error'), false); assert.equal(e.clock.timers.size, 0);
});
test('malformed frame JSON is isolated while a missing required task prevents false-success navigation', async t => {
  const e = setup(t, { html: chapterParams, attachments: [attachment('bad'), attachment('good')] }); let calls = 0;
  const bad = e.addRead('bad', () => assert.fail('invalid frame ran')); bad.setAttribute('data', '{');
  e.addRead('good', () => calls++); const task = e.start(); await e.clock.advance(50000); await task;
  assert.equal(calls, 1); assert.equal(e.jumps.length, 0);
  assert.match(e.messages.find(message => message.type === 'error').content, /1 个任务/); assert.equal(e.clock.timers.size, 0);
});
test('task execution failure is surfaced and never followed by a chapter jump', async t => {
  const e = setup(t, { html: chapterParams, attachments: [attachment('broken')] });
  e.addRead('broken', () => { throw new Error('fixture read failed'); });
  const task = e.start(); await e.clock.advance(30000); await task;
  assert.equal(e.jumps.length, 0); assert.match(e.messages.find(message => message.type === 'error').content, /fixture read failed/);
  assert.equal(e.clock.timers.size, 0);
});
for (const mode of ['next', 'job']) test(`${mode} mode advances remaining tabs in the final chapter rather than ending early`, async t => {
  const html = chapterParams + chapter('last', true, 1) + '<ul class="prev_ul"><li class="active">one</li><li>two</li></ul>';
  const e = setup(t, { html, cfg: { mode } }), task = e.start();
  await e.clock.advance(20000); await task;
  assert.equal(e.jumps.length, 1); assert.equal(e.alerts.length, 0); assert.equal(e.clock.timers.size, 0);
});
test('job mode wraps to an earlier incomplete chapter even from the final chapter', async t => {
  const e = setup(t, { html: chapter('earlier', false, 2) + chapter('last', true, 0), cfg: { mode: 'job' } }); let clicks = 0;
  e.document.querySelector('#earlier a').onclick = () => clicks++;
  const task = e.start(); await e.clock.advance(20000); await task;
  assert.equal(clicks, 1); assert.equal(e.alerts.length, 0); assert.equal(e.clock.timers.size, 0);
});
test('job mode does not loop when only the current incomplete chapter remains', async t => {
  const e = setup(t, { html: chapter('current', true, 1) + chapter('later', false, 0), cfg: { mode: 'job' } }); let clicks = 0;
  e.document.querySelector('#current a').onclick = () => clicks++;
  const task = e.start(); await e.clock.advance(20000); await task;
  assert.equal(clicks, 0); assert.match(e.alerts[0].content, /当前章节仍有未完成/); assert.equal(e.clock.timers.size, 0);
});
test('pagehide during the navigation countdown cancels the actual chapter jump', async t => {
  const e = setup(t, { html: chapterParams }), task = e.start(); await e.clock.advance(7000);
  e.window.dispatchEvent(new e.window.Event('pagehide')); await task; await e.clock.advance(20000);
  assert.equal(e.jumps.length, 0); assert.equal(e.clock.timers.size, 0);
});

function addMedia(e, id, extra = '') {
  const frame = e.document.createElement('iframe'); frame.setAttribute('data', JSON.stringify({ jobid: id })); e.document.body.append(frame);
  frame.contentDocument.body.innerHTML = '<div id="video"><video></video><div class="vjs-control-bar"></div>' + extra + '</div>';
  const media = frame.contentDocument.querySelector('video');
  let calls = 0, paused = true;
  Object.defineProperties(media, { paused: { get: () => paused }, ended: { get: () => false } });
  media.currentTime = 43;
  media.play = async () => { calls++; paused = false; };
  media.pause = () => { paused = true; };
  return { frame, media, get calls() { return calls; } };
}
function mediaAttachment(id) { const value = attachment(id); value.property.module = 'insertvideo'; return value; }
test('actual media error pauses the chapter and clears the top-level player reference', async t => {
  const e = setup(t, { html: chapterParams, attachments: [mediaAttachment('video')] }), player = addMedia(e, 'video');
  const task = e.start(); await e.clock.advance(4000); assert.equal(player.calls, 1); assert.equal(player.media.currentTime, 43);
  Object.defineProperty(player.media, 'error', { value: { code: 2 } });
  player.media.dispatchEvent(new e.window.Event('error')); await e.clock.advance(1000); await task;
  assert.equal(e.jumps.length, 0); assert.match(e.messages.find(message => message.type === 'error').content, /加载失败/);
  assert.equal(e.window.currentMedia, undefined); assert.equal(e.clock.timers.size, 0);
});
test('video quiz rotates wrong answers until the native question closes and preserves other overlays', async t => {
  const e = setup(t, { attachments: [mediaAttachment('video')], cfg: { mode: 'manually' } });
  const player = addMedia(e, 'video', '<div class="ans-videoquiz"><div class="ans-videoquiz-opt"><label>A</label><label>B</label></div><button id="videoquiz-submit">submit</button></div><div class="x-component-default">keep verification</div>');
  const doc = player.frame.contentDocument; const attempts = []; let selected = '';
  doc.querySelectorAll('label').forEach(label => { label.onclick = () => { selected = label.textContent; }; });
  doc.querySelector('button').onclick = () => { attempts.push(selected); if (selected === 'B') doc.querySelector('.ans-videoquiz').remove(); };
  const task = e.start(); await e.clock.advance(5000);
  assert.deepEqual(attempts, ['A']); assert.equal(player.calls, 0); assert.ok(doc.querySelector('.ans-videoquiz'));
  assert.notEqual(doc.querySelector('.x-component-default').style.display, 'none');
  await e.clock.advance(4000); assert.deepEqual(attempts, ['A', 'B']);
  assert.equal(doc.querySelector('.ans-videoquiz'), null); assert.equal(player.calls, 1);
  await e.clock.advance(3000); assert.deepEqual(attempts, ['A', 'B']);
  player.media.dispatchEvent(new e.window.Event('ended')); await e.clock.advance(8000); await task;
  assert.equal(e.messages.some(message => message.type === 'error'), false); assert.equal(e.clock.timers.size, 0);
});
test('CSS-hidden face verification does not block the actual video runner', async t => {
  const e = setup(t, { html: '<style>.chapterVideoFaceMaskDiv {display:none}</style><div class="chapterVideoFaceMaskDiv"></div>',
    attachments: [mediaAttachment('video')], cfg: { mode: 'manually' } });
  const player = addMedia(e, 'video'), task = e.start(); await e.clock.advance(5000);
  assert.equal(player.calls, 1); player.media.dispatchEvent(new e.window.Event('ended'));
  await e.clock.advance(6000); await task; assert.equal(e.clock.timers.size, 0);
});
test('missing AI configuration for a required chapter test is not reported as task completion', async t => {
  const value = attachment('quiz'); value.property.module = 'work';
  const e = setup(t, { html: chapterParams, provider: false, attachments: [value] });
  const frame = e.document.createElement('iframe'); frame.setAttribute('data', '{"jobid":"quiz"}'); e.document.body.append(frame);
  frame.contentDocument.body.innerHTML = '<div class="TiMu"></div>';
  const task = e.start(); await e.clock.advance(20000); await task;
  assert.equal(e.jumps.length, 0); assert.match(e.messages.find(message => message.type === 'error').content, /未配置可用 AI/);
  assert.equal(e.clock.timers.size, 0);
});
