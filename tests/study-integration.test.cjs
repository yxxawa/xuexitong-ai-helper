const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, Clock, domRuntime, loadTS } = require('./helpers/runtime.cjs');
function setup(t, options = {}) {
  const env = domRuntime(options.html || '', options.url || 'https://mooc1.chaoxing.com/knowledge/cards');
  Object.assign(env.window, options.readerGlobals || {});
  const clock = new Clock(), messages = [], alerts = [], jumps = [];
  const noop = () => {};
  env.window.HTMLElement.prototype.scrollIntoView = noop;
  env.window.PCount = { next: (...args) => jumps.push(args) };
  if (!options.loading) env.window.attachments = options.attachments || [];
  const stubs = {};
  // Isolate unrelated AI/UI dependencies, not the actual study implementation.
  const source = fs.readFileSync(path.join(ROOT, 'packages/scripts/src/projects/cx.ts'), 'utf8');
  for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) stubs[match[1]] = {};
  delete stubs['../utils/study-controls']; delete stubs['../utils/study']; delete stubs['../utils/study-media']; delete stubs['../utils/study-reader']; delete stubs['../utils/video-quiz'];
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
    messages.push({ type, content: typeof value === 'string' ? value : value.content });
    const note = h('div'); if (value.content instanceof env.window.HTMLElement) note.append(value.content); env.document.body.append(note); return note;
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
  const globals = { ...env.globals, ...clock.globals(), ...options.readerGlobals, AbortController, top: env.window, console: { ...console, info: noop, warn: noop, error: noop, debug: noop } };
  stubs['../utils'] = loadTS('packages/scripts/src/utils/index.ts', globals, { ...stubs, './work': {}, './ai': {} });
  const api = loadTS('packages/scripts/src/projects/cx.ts', globals, stubs);
  Object.assign(api.CXProject.scripts.study.cfg, options.cfg || {});
  const cfg = api.CXProject.scripts.study.cfg;
  t.after(() => { env.window.dispatchEvent(new env.window.Event('pagehide')); env.window.close(); });
  function addRead(id, callback, data = { jobid: id }) {
    const frame = env.document.createElement('iframe'); frame.setAttribute('data', JSON.stringify(data)); env.document.body.append(frame);
    frame.contentDocument.body.innerHTML = '<img id="img" class="imglook">'; frame.contentWindow.finishJob = () => { callback(); if (!options.noConfirm) { const item = env.window.attachments?.find(item => item.jobid === id); if (item) item.isPassed = true; } };
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
const emptyKnowledge = '<div class="ans-cc"><p>暂无内容</p></div>';
for (const mode of ['next', 'job']) test(`an explicitly empty knowledge tab without metadata advances in ${mode} mode`, async t => {
  const html = chapterParams + chapter('last', true, 1) + '<ul class="prev_ul"><li class="active">知识点</li><li>视频</li></ul>' + emptyKnowledge;
  const e = setup(t, { html, loading: true, cfg: { mode } }), task = e.start();
  await e.clock.advance(40000); await task;
  assert.equal(e.jumps.length, 1); assert.equal(e.alerts.length, 0);
  assert.equal(e.messages.some(message => message.type === 'error'), false); assert.equal(e.clock.timers.size, 0);
});
test('an empty knowledge tab respects manual navigation mode', async t => {
  const e = setup(t, { html: emptyKnowledge, loading: true, cfg: { mode: 'manually' } }), task = e.start();
  await e.clock.advance(40000); await task;
  assert.equal(e.jumps.length, 0); assert.equal(e.messages.some(message => message.type === 'error'), false);
  assert.equal(e.clock.timers.size, 0);
});
test('a late empty placeholder is given its own settling window before navigation', async t => {
  const e = setup(t, { html: chapterParams, loading: true }), task = e.start();
  await e.clock.advance(12000); assert.equal(e.jumps.length, 0);
  e.document.body.insertAdjacentHTML('beforeend', emptyKnowledge);
  await e.clock.advance(6000); assert.equal(e.jumps.length, 0);
  await e.clock.advance(22000); await task;
  assert.equal(e.jumps.length, 1); assert.equal(e.messages.some(message => message.type === 'error'), false);
  assert.equal(e.clock.timers.size, 0);
});
test('an empty placeholder cannot override a known required task', async t => {
  const e = setup(t, { html: chapterParams + emptyKnowledge, attachments: [attachment('pending')] }), task = e.start();
  await e.clock.advance(40000); await task;
  assert.equal(e.jumps.length, 0); assert.match(e.messages.find(message => message.type === 'error').content, /1 个任务/);
  assert.equal(e.clock.timers.size, 0);
});
for (const html of ['<p hidden>暂无内容</p>', '<iframe></iframe>' + emptyKnowledge, '<p>该知识点暂无内容时请联系老师</p>']) {
  test(`hidden, contextual or sibling empty text does not prove a chapter is empty: ${html}`, async t => {
    const e = setup(t, { html: chapterParams + html, loading: true }), task = e.start();
    await e.clock.advance(40000); await task;
    assert.equal(e.jumps.length, 0); assert.match(e.messages.find(message => message.type === 'error').content, /任务列表加载超时/);
    assert.equal(e.clock.timers.size, 0);
  });
}
test('a placeholder replaced by real task metadata during settling still executes the task', async t => {
  const e = setup(t, { html: chapterParams + emptyKnowledge, loading: true }); let calls = 0;
  const task = e.start(); await e.clock.advance(4000);
  e.document.querySelector('.ans-cc').remove();
  e.window.attachments = [attachment('late')]; e.addRead('late', () => calls++);
  await e.clock.advance(20000); await task;
  assert.equal(calls, 1); assert.equal(e.jumps.length, 1);
  assert.equal(e.messages.some(message => message.type === 'error'), false); assert.equal(e.clock.timers.size, 0);
});
test('an empty placeholder disappearing during the jump countdown returns to loading instead of navigating', async t => {
  const e = setup(t, { html: chapterParams + emptyKnowledge, loading: true }), task = e.start();
  await e.clock.advance(7000); e.document.querySelector('.ans-cc').remove();
  await e.clock.advance(40000); await task;
  assert.equal(e.jumps.length, 0); assert.match(e.messages.find(message => message.type === 'error').content, /任务列表加载超时/);
  assert.equal(e.clock.timers.size, 0);
});
test('a task arriving during the empty-page countdown runs before navigation', async t => {
  const e = setup(t, { html: chapterParams + emptyKnowledge, loading: true }); let calls = 0;
  const task = e.start(); await e.clock.advance(7000);
  e.document.querySelector('.ans-cc').remove();
  e.window.attachments = [attachment('late')]; e.addRead('late', () => calls++);
  await e.clock.advance(20000); await task;
  assert.equal(calls, 1); assert.equal(e.jumps.length, 1);
  assert.equal(e.messages.some(message => message.type === 'error'), false); assert.equal(e.clock.timers.size, 0);
});
const observedEmptyCourseCard = fs.readFileSync(path.join(__dirname, 'fixtures/knowledge-empty.html'), 'utf8');
for (const mode of ['next', 'job']) test(`the live empty card with hidden audition audio advances in ${mode} mode`, async t => {
  const html = chapterParams + chapter('last', true, 1) + '<ul class="prev_ul"><li class="active">知识点</li><li>视频</li></ul>' + observedEmptyCourseCard;
  const e = setup(t, { html, loading: true, cfg: { mode } });
  const task = e.start(); await e.clock.advance(40000); await task;
  assert.equal(e.jumps.length, 1); assert.equal(e.alerts.length, 0);
  assert.equal(e.messages.some(message => message.type === 'error'), false); assert.equal(e.clock.timers.size, 0);
});
test('hidden course media arriving during the empty-card countdown prevents navigation', async t => {
  const e = setup(t, { html: chapterParams + observedEmptyCourseCard, loading: true });
  const task = e.start(); await e.clock.advance(7000);
  const audio = e.document.createElement('audio'); audio.hidden = true;
  e.document.querySelector('#pageDiv').append(audio);
  await e.clock.advance(40000); await task;
  assert.equal(e.jumps.length, 0); assert.match(e.messages.find(message => message.type === 'error').content, /任务列表加载超时/);
  assert.equal(e.clock.timers.size, 0);
});
test('the observed empty course layout advances even with a hidden auxiliary iframe', async t => {
  const e = setup(t, { html: chapterParams + observedEmptyCourseCard + '<iframe hidden></iframe>', loading: true });
  const task = e.start(); await e.clock.advance(40000); await task;
  assert.equal(e.jumps.length, 1); assert.equal(e.messages.some(message => message.type === 'error'), false);
  assert.equal(e.clock.timers.size, 0);
});
test('an empty card inside a visible wrapper iframe advances after settling', async t => {
  const e = setup(t, { html: chapterParams + '<iframe id="content"></iframe>', loading: true });
  const frame = e.document.querySelector('iframe');
  frame.contentWindow.HTMLElement.prototype.getClientRects = e.window.HTMLElement.prototype.getClientRects;
  frame.contentDocument.body.innerHTML = observedEmptyCourseCard;
  const task = e.start(); await e.clock.advance(40000); await task;
  assert.equal(e.jumps.length, 1); assert.equal(e.messages.some(message => message.type === 'error'), false);
  assert.equal(e.clock.timers.size, 0);
});
test('new nested task metadata cancels an empty-page jump instead of skipping the task', async t => {
  const e = setup(t, { html: chapterParams + '<iframe id="content"></iframe>', loading: true });
  const frame = e.document.querySelector('iframe');
  frame.contentWindow.HTMLElement.prototype.getClientRects = e.window.HTMLElement.prototype.getClientRects;
  frame.contentDocument.body.innerHTML = observedEmptyCourseCard;
  const task = e.start(); await e.clock.advance(7000);
  frame.contentWindow.attachments = [attachment('pending')];
  await e.clock.advance(40000); await task;
  assert.equal(e.jumps.length, 0); assert.match(e.messages.find(message => message.type === 'error').content, /任务列表加载超时/);
  assert.equal(e.clock.timers.size, 0);
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
  media.addEventListener('ended', () => { const item = e.window.attachments?.find(item => item.jobid === id); if (item) item.isPassed = true; });
  media.currentTime = 43;
  media.play = async () => { calls++; paused = false; };
  media.pause = () => { paused = true; };
  return { frame, media, get calls() { return calls; } };
}
function mediaAttachment(id) { const value = attachment(id); value.property.module = 'insertvideo'; return value; }
test('a pause during an in-flight play request resumes through the actual chapter runner', async t => {
  const e = setup(t, { attachments: [mediaAttachment('video')], cfg: { mode: 'manually' } });
  const player = addMedia(e, 'video'), play = player.media.play;
  let rejectPlay, attempts = 0;
  player.media.play = () => {
    if (++attempts === 1) return new Promise((resolve, reject) => { rejectPlay = reject; });
    return play();
  };
  const task = e.start(); await e.clock.advance(3500); assert.equal(attempts, 1);
  player.media.pause(); player.media.dispatchEvent(new e.window.Event('pause'));
  rejectPlay(new player.frame.contentWindow.DOMException('play interrupted by pause', 'AbortError'));
  await e.clock.advance(1500);
  assert.equal(attempts, 2); assert.equal(player.media.paused, false); assert.equal(player.media.currentTime, 43);
  assert.equal(e.window.currentMedia, player.media); assert.equal(e.jumps.length, 0);
  assert.equal(e.messages.some(message => message.type === 'error'), false);
  player.media.pause();
  for (let i = 0; i < 3; i++) player.media.dispatchEvent(new e.window.Event('pause'));
  await e.clock.advance(300); assert.equal(attempts, 3); assert.equal(player.media.paused, false);
  player.media.dispatchEvent(new e.window.Event('ended')); await e.clock.advance(8000); await task;
  assert.equal(e.window.currentMedia, undefined); assert.equal(e.clock.timers.size, 0);
});
test('actual media error pauses the chapter and clears the top-level player reference', async t => {
  const e = setup(t, { html: chapterParams, attachments: [mediaAttachment('video')] }), player = addMedia(e, 'video');
  const task = e.start(); await e.clock.advance(4000); assert.equal(player.calls, 1); assert.equal(player.media.currentTime, 43);
  Object.defineProperty(player.media, 'error', { value: { code: 4 } });
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

test('unconfirmed read completion prevents navigation and exposes a retry control', async t => {
  const e = setup(t, { html: chapterParams, noConfirm: true, attachments: [attachment('read')] });
  let reads = 0; e.addRead('read', () => reads++); const task = e.start();
  await e.clock.advance(45000); await task;
  assert.equal(reads, 1); assert.equal(e.jumps.length, 0);
  assert.match(e.messages.find(message => message.type === 'error').content, /平台尚未确认/);
  const retry = Array.from(e.document.querySelectorAll('button')).find(el => el.textContent === '重试当前页面');
  assert.equal(retry.hidden, false); assert.equal(e.clock.timers.size, 0);
});
test('confirmation arriving late releases the actual task without running it twice', async t => {
  const e = setup(t, { html: chapterParams, noConfirm: true, attachments: [attachment('read')] });
  let reads = 0; e.addRead('read', () => reads++); const task = e.start();
  await e.clock.advance(10000); assert.equal(e.jumps.length, 0); assert.equal(reads, 1);
  e.window.attachments[0].isPassed = true; await e.clock.advance(12000); await task;
  assert.equal(e.jumps.length, 1); assert.equal(reads, 1); assert.equal(e.clock.timers.size, 0);
});
test('study pause and stop controls prevent chapter navigation and retry starts one new runner', async t => {
  const e = setup(t, { html: chapterParams }), task = e.start();
  await e.clock.advance(7000);
  const button = text => Array.from(e.document.querySelectorAll('button')).find(el => el.textContent === text);
  button('暂停学习').click(); await e.clock.advance(20000); assert.equal(e.jumps.length, 0);
  button('继续学习').click(); await e.clock.advance(1000); assert.equal(e.jumps.length, 0);
  button('停止学习').click(); await e.clock.flush(); await task;
  assert.equal(e.clock.timers.size, 0); button('重试当前页面').click(); await e.clock.advance(15000);
  assert.equal(e.jumps.length, 1); assert.equal(e.document.querySelectorAll('.study-controls').length, 1);
  assert.equal(e.clock.timers.size, 0);
});
test('unknown chapter status cannot be counted as a completed course', async t => {
  const e = setup(t, { html: chapter('one', true, 0) + chapter('two', false, 0), cfg: {mode:'job'} });
  e.document.querySelector('#two input').remove(); const task = e.start();
  await e.clock.advance(20000); await task;
  assert.equal(e.jumps.length, 0); assert.match(e.messages.find(message => message.type === 'error').content, /未完成任务数尚未就绪/);
});

test('offline native errors recover despite the player generic format-or-network overlay', async t => {
  const e = setup(t, { attachments: [mediaAttachment('video')], cfg: { mode: 'manually' } });
  const player = addMedia(e, 'video', '<div class="vjs-modal-dialog-content"></div>');
  const modal = player.frame.contentDocument.querySelector('.vjs-modal-dialog-content');
  let online = true, error = null, loads = 0;
  Object.defineProperty(player.frame.contentWindow.navigator, 'onLine', { get: () => online });
  Object.defineProperties(player.media, { error: { get: () => error }, readyState: { get: () => 4 }, duration: { get: () => 100 } });
  player.media.load = () => { loads++; error = null; player.media.currentTime = 0; };
  const task = e.start(); await e.clock.advance(4500); assert.equal(player.calls, 1);
  online = false; error = { code: 4 }; player.media.pause();
  modal.innerText = '视频因格式不支持或者服务器或网络的问题无法加载。';
  player.media.dispatchEvent(new e.window.Event('error')); await e.clock.advance(5000);
  assert.equal(e.messages.some(message => message.type === 'error'), false);
  assert.equal(loads, 0); assert.equal(player.calls, 1); assert.equal(e.jumps.length, 0);
  online = true; await e.clock.advance(4500);
  assert.equal(loads, 1); assert.equal(player.media.paused, false); assert.equal(player.media.currentTime, 43);
  assert.equal(e.messages.some(message => message.type === 'error'), false);
  player.media.dispatchEvent(new e.window.Event('ended')); await e.clock.advance(8000); await task;
  assert.equal(e.clock.timers.size, 0);
});

// Non-assessment regression checks: all pages and platform calls below are local fixtures.
test('retry uses the changed study settings after an unmounted media task times out', async t => {
  const e = setup(t, { attachments: [mediaAttachment('video')], cfg: { mode: 'manually' } });
  const first = e.start(); await e.clock.advance(40000); await first;
  assert.equal(e.document.querySelector('.study-controls').dataset.phase, 'error');
  e.cfg.enableMedia = false;
  Array.from(e.document.querySelectorAll('button')).find(el => el.textContent === '重试当前页面').click();
  await e.clock.advance(40000);
  assert.equal(e.document.querySelector('.study-controls').dataset.phase, 'done');
  assert.equal(e.messages.filter(message => message.type === 'error').length, 1);
  assert.equal(e.jumps.length, 0); assert.equal(e.clock.timers.size, 0);
});
test('switching to manual mode during the next-page countdown finishes without navigation or errors', async t => {
  const e = setup(t, { html: chapterParams }), task = e.start();
  await e.clock.advance(7000); e.cfg.mode = 'manually';
  await e.clock.advance(20000); await task;
  assert.equal(e.jumps.length, 0); assert.equal(e.messages.some(message => message.type === 'error'), false);
  assert.equal(e.document.querySelector('.study-controls').dataset.phase, 'done');
});
test('manual mode also cancels the delayed return to the first chapter', async t => {
  const e = setup(t, { html: chapter('first', false, 0) + chapter('last', true, 0), cfg: { backToFirstWhenFinish: true } });
  let clicks = 0; e.document.querySelector('#first .posCatalog_name').onclick = () => clicks++;
  const task = e.start(); await e.clock.advance(13000); e.cfg.mode = 'manually';
  await e.clock.advance(20000); await task;
  assert.equal(clicks, 0); assert.equal(e.messages.some(message => message.type === 'error'), false);
  assert.equal(e.clock.timers.size, 0);
});
test('the standalone reader respects disabled automatic reading', async t => {
  let turns = 0;
  const e = setup(t, { url: 'https://mooc1.chaoxing.com/readsvr/book/mooc', cfg: { enablePPT: false }, readerGlobals: { readweb: { goto: () => turns++ }, epage: 7 } });
  await e.api.CXProject.scripts.study.onactive(); await e.clock.advance(10000);
  assert.equal(turns, 0); assert.equal(e.clock.timers.size, 0);
});
test('leaving the standalone reader cancels its scheduled page turn', async t => {
  let turns = 0;
  const e = setup(t, { url: 'https://mooc1.chaoxing.com/readsvr/book/mooc', readerGlobals: { readweb: { goto: () => turns++ }, epage: 7 } });
  await e.api.CXProject.scripts.study.onactive(); await e.clock.advance(1000);
  e.window.dispatchEvent(new e.window.Event('pagehide')); await e.clock.advance(10000);
  assert.equal(turns, 0); assert.equal(e.clock.timers.size, 0);
});

test('media execution ignores a hidden preview audio before the actual course player', async t => {
  const e = setup(t, { attachments: [mediaAttachment('video')], cfg: { mode: 'manually' } });
  const player = addMedia(e, 'video'), doc = player.frame.contentDocument;
  const preview = doc.createElement('audio'); preview.id = 'auditionAudio'; preview.style.display = 'none';
  let previewPlays = 0; preview.play = async () => { previewPlays++; }; preview.pause = () => {};
  doc.body.prepend(preview);
  const task = e.start(); await e.clock.advance(4000);
  const observed = { previewPlays, coursePlays: player.calls, selectedCourseMedia: e.window.currentMedia === player.media };
  Array.from(e.document.querySelectorAll('button')).find(el => el.textContent === '停止学习').click(); await e.clock.flush(); await task;
  assert.deepEqual(observed, { previewPlays: 0, coursePlays: 1, selectedCourseMedia: true });
  assert.equal(e.clock.timers.size, 0);
});

test('live volume and speed settings keep the course video in its iframe muted', async t => {
  const e = setup(t, { attachments: [mediaAttachment('video')], cfg: { mode: 'manually', volume: '0.65' } });
  const player = addMedia(e, 'video'), listeners = new Map(), script = e.api.CXProject.scripts.study;
  script.onConfigChange = (key, callback) => listeners.set(key, callback);
  const task = script.onactive(); await e.clock.advance(4000);
  assert.equal(player.calls, 1); assert.equal(player.media.muted, true); assert.equal(player.media.volume, 0);
  e.cfg.volume = '0.9'; player.media.muted = false; player.media.volume = 0.9;
  listeners.get('volume')();
  assert.equal(player.media.muted, true); assert.equal(player.media.volume, 0);
  e.cfg.playbackRate = '1.5'; player.media.muted = false; player.media.volume = 0.9;
  listeners.get('playbackRate')();
  assert.equal(player.media.playbackRate, 1.5); assert.equal(player.media.muted, true); assert.equal(player.media.volume, 0);
  Array.from(e.document.querySelectorAll('button')).find(el => el.textContent === '停止学习').click();
  await e.clock.flush(); await task; assert.equal(e.clock.timers.size, 0);
});
