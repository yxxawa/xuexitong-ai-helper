const test = require('node:test');
const assert = require('node:assert/strict');
const { Clock, domRuntime, loadTS } = require('./helpers/runtime.cjs');
const STUDY = 'packages/scripts/src/utils/study.ts';
const MEDIA = 'packages/scripts/src/utils/study-media.ts';
function capture(promise) {
  const state = { done: false };
  state.promise = promise.then(value => { state.done = true; state.value = value; },
    error => { state.done = true; state.error = error; });
  return state;
}
function setup(t, html = '') {
  const env = domRuntime(html, 'https://mooc1.chaoxing.com/knowledge/cards');
  const clock = new Clock();
  t.after(() => env.window.close());
  const globals = { ...env.globals, ...clock.globals(), AbortController };
  return { ...env, clock, globals, api: loadTS(STUDY, globals) };
}
function mediaSetup(t, options = {}) {
  const e = setup(t, '<video></video>');
  const media = e.document.querySelector('video');
  let paused = true, ended = false, calls = 0, stops = 0;
  Object.defineProperties(media, { paused: { get: () => paused }, ended: { get: () => ended } });
  media.currentTime = 57;
  media.play = async () => { calls++; paused = false; };
  media.pause = () => { paused = true; stops++; };
  const settings = { playbackRate: 1.5, volume: 0.2 };
  const api = loadTS(MEDIA, e.globals);
  const controller = new AbortController();
  const task = capture(api.runStudyMedia(media, { signal: controller.signal, settings: () => settings,
    play: async play => { await play(); return true; }, ...options }));
  return { ...e, media, settings, task, controller, get calls() { return calls; }, get stops() { return stops; },
    pause() { paused = true; media.dispatchEvent(new e.window.Event('pause')); },
    end() { ended = true; media.dispatchEvent(new e.window.Event('ended')); } };
}
test('media filtering checks all players rather than getting stuck on the first unmatched element', async t => {
  const e = setup(t, '<video id="advert"></video><audio id="task"></audio>');
  const media = await e.api.waitForMedia({ filter: media => media.id === 'task' });
  assert.equal(media.id, 'task'); assert.equal(e.clock.timers.size, 0);
});
test('polling handles immediate results and predicate errors without leaked timers', async t => {
  const e = setup(t);
  assert.equal(await e.api.waitFor(() => 42), 42);
  await assert.rejects(e.api.waitFor(() => { throw new Error('broken predicate'); }), /broken predicate/);
  assert.equal(e.clock.timers.size, 0);
});
test('attachment lookup climbs arbitrary nested frames and survives malformed child data', t => {
  const e = setup(t, '<iframe id="outer"></iframe>'), outer = e.document.querySelector('iframe');
  outer.setAttribute('data', JSON.stringify({ _jobid: 123 }));
  outer.contentDocument.body.innerHTML = '<iframe></iframe>';
  const inner = outer.contentDocument.querySelector('iframe'); inner.setAttribute('data', '{');
  const attachments = [{ jobid: '123', property: { mid: 'same' } }, { jobid: '456', property: { mid: 'same' } }];
  assert.equal(e.api.findStudyAttachment(inner, attachments), attachments[0]);
  assert.notEqual(e.api.studyJobId(attachments[0]), e.api.studyJobId(attachments[1]));
  assert.deepEqual(Array.from(e.api.searchStudyFrames(e.document)), [outer, inner]);
});
test('inaccessible frames do not prevent discovery in their accessible siblings', t => {
  const e = setup(t, '<iframe id="blocked"></iframe><iframe id="valid"></iframe>');
  Object.defineProperty(e.document.querySelector('#blocked'), 'contentWindow', { configurable: true, get() { throw new Error('cross origin'); } });
  assert.deepEqual(Array.from(e.api.searchStudyFrames(e.document)).map(frame => frame.id), ['valid']);
  delete e.document.querySelector('#blocked').contentWindow;
});
test('late attachment metadata and a task mounted after twelve seconds are not skipped', async t => {
  const e = setup(t); let mounted = false, ready = false, ran = 0;
  const task = capture(e.api.runStudyJobs({ discover: () => mounted && !ran ? { func: async () => { ran++; } } : undefined,
    snapshot: () => ({ ready, signature: ready ? 'task' : 'loading', pending: ready && !ran ? ['job'] : [] }) }));
  await e.clock.advance(12000); assert.equal(task.done, false);
  ready = true; await e.clock.advance(6000); assert.equal(task.done, false);
  mounted = true; await e.clock.advance(4000); await task.promise;
  assert.equal(task.error, undefined); assert.equal(ran, 1); assert.equal(e.clock.timers.size, 0);
});
test('unknown or unmounted required tasks time out as a failure rather than completion', async t => {
  const e = setup(t), task = capture(e.api.runStudyJobs({ discover: () => undefined,
    snapshot: () => ({ ready: true, signature: 'missing', pending: ['job'] }), timeout: 1000 }));
  await e.clock.advance(1000); await task.promise; assert.match(task.error.message, /1 个任务/);
  assert.equal(e.clock.timers.size, 0);
});
test('missing metadata and execution errors stop scheduling; later tasks cannot run', async t => {
  const e = setup(t); let calls = 0;
  const missing = capture(e.api.runStudyJobs({ discover: () => undefined,
    snapshot: () => ({ ready: false, signature: 'loading', pending: [] }), timeout: 500 }));
  await e.clock.advance(500); await missing.promise; assert.match(missing.error.message, /列表加载超时/);
  await assert.rejects(e.api.runStudyJobs({ discover: () => { calls++; return { func: async () => { throw new Error('play failed'); } }; },
    snapshot: () => ({ ready: true, signature: '', pending: [] }) }), /play failed/);
  assert.equal(calls, 1); assert.equal(e.clock.timers.size, 0);
});
test('a skipped non-task does not hide the task immediately after it', async t => {
  const e = setup(t), queue = [{}, { func: async () => { calls++; } }]; let calls = 0;
  const task = capture(e.api.runStudyJobs({ discover: () => queue.shift(),
    snapshot: () => ({ ready: true, signature: 'two', pending: [] }), settle: 250 }));
  await e.clock.advance(2000); await task.promise;
  assert.equal(task.error, undefined); assert.equal(calls, 1); assert.equal(e.clock.timers.size, 0);
});
test('leaving a loading chapter cancels its poll and all future work', async t => {
  const e = setup(t), controller = new AbortController();
  const task = capture(e.api.runStudyJobs({ signal: controller.signal, discover: () => undefined,
    snapshot: () => ({ ready: false, signature: '', pending: [] }) }));
  await e.clock.advance(500); controller.abort(); await task.promise;
  assert.equal(task.error.name, 'AbortError'); assert.equal(e.clock.timers.size, 0);
});
test('playback preserves resume time, serializes repeated pause events and uses the latest settings', async t => {
  const e = mediaSetup(t); await e.clock.advance(300);
  assert.equal(e.calls, 1); assert.equal(e.media.currentTime, 57); assert.equal(e.media.playbackRate, 1.5);
  e.settings.playbackRate = 1; e.settings.volume = 0.7;
  e.pause(); e.pause(); e.pause(); await e.clock.advance(300);
  assert.equal(e.calls, 2); assert.equal(e.media.playbackRate, 1); assert.equal(e.media.volume, 0.7);
  e.end(); await e.task.promise; assert.equal(e.task.error, undefined); assert.equal(e.clock.timers.size, 0);
});
test('native media errors reject instead of advancing, including an already-present error', async t => {
  const e = mediaSetup(t); await e.clock.advance(300);
  Object.defineProperty(e.media, 'error', { value: { code: 4 } });
  e.media.dispatchEvent(new e.window.Event('error')); await e.task.promise;
  assert.match(e.task.error.message, /错误码 4/); assert.equal(e.stops, 1); assert.equal(e.clock.timers.size, 0);
  const b = setup(t, '<video></video>'), broken = b.document.querySelector('video'); let plays = 0;
  broken.play = async () => { plays++; }; broken.pause = () => {};
  Object.defineProperty(broken, 'error', { value: { code: 3 } });
  await assert.rejects(loadTS(MEDIA, b.globals).runStudyMedia(broken, {
    settings: () => ({ playbackRate: 1, volume: 0 }), play: async play => { await play(); return true; }
  }), /错误码 3/);
  assert.equal(plays, 0); assert.equal(b.clock.timers.size, 0);
});
test('stalled media stops with an actionable error and releases timers', async t => {
  const e = mediaSetup(t, { stallTimeout: 3000 }); await e.clock.advance(3000); await e.task.promise;
  assert.match(e.task.error.message, /没有播放进展/); assert.equal(e.clock.timers.size, 0);
});
test('manual quiz waits are not treated as buffering and resume after the native dialog closes', async t => {
  let blocked = true;
  const e = mediaSetup(t, { isBlocked: () => blocked, stallTimeout: 2000 });
  await e.clock.advance(6000); assert.equal(e.task.done, false); assert.equal(e.calls, 0);
  blocked = false; await e.clock.advance(1300); assert.equal(e.calls, 1);
  e.end(); await e.task.promise; assert.equal(e.clock.timers.size, 0);
});
test('aborting a manual face-recognition wait releases both the wait and media polling', async t => {
  const e = setup(t, '<video></video>'), controller = new AbortController();
  const media = e.document.querySelector('video'); let calls = 0;
  media.play = async () => { calls++; }; media.pause = () => {};
  const task = capture(loadTS(MEDIA, e.globals).runStudyMedia(media, { signal: controller.signal,
    settings: () => ({ playbackRate: 1, volume: 0 }),
    beforePlay: signal => e.api.studySleep(100000, signal), play: async play => { await play(); return true; } }));
  await e.clock.advance(500); controller.abort(); await task.promise; await e.clock.flush();
  assert.ok(task.error); assert.equal(calls, 0); assert.equal(e.clock.timers.size, 0);
});
test('pagehide and player replacement are failures, never successful media completion', async t => {
  const a = mediaSetup(t); await a.clock.advance(300);
  a.window.dispatchEvent(new a.window.Event('pagehide')); await a.task.promise;
  assert.match(a.task.error.message, /页面已离开/); assert.equal(a.stops, 1); assert.equal(a.clock.timers.size, 0);
  const b = mediaSetup(t); await b.clock.advance(300); b.media.remove(); await b.clock.advance(1000); await b.task.promise;
  assert.match(b.task.error.message, /播放器已被页面替换/); assert.equal(b.clock.timers.size, 0);
});
function autoplaySetup(t, play) {
  const e = setup(t), prompts = [];
  const api = loadTS('packages/scripts/src/utils/index.ts', e.globals, {
    'easy-us': { $modal: { alert(attrs) { const el = e.document.createElement('div'); e.document.body.append(el); prompts.push({ attrs, el }); return el; } } },
    '@xuexitong-ai-helper/core/src/utils/common': { $: {} }, './work': {}, './ai': {}
  });
  const controller = new AbortController();
  const task = capture(api.playMedia(play, controller.signal));
  return { ...e, prompts, controller, task };
}
test('NotAllowedError stays pending until a successful user retry; closing the modal is not success', async t => {
  let calls = 0;
  const e = autoplaySetup(t, async () => { if (++calls === 1) { const error = new Error('本地化提示'); error.name = 'NotAllowedError'; throw error; } });
  await e.clock.flush(); assert.equal(e.task.done, false); assert.equal(e.prompts.length, 1);
  await e.prompts[0].attrs.onConfirm(); e.prompts[0].attrs.onClose(); await e.task.promise;
  assert.equal(e.task.value, true); assert.equal(calls, 2); assert.equal(e.prompts[0].el.isConnected, false);
  const b = autoplaySetup(t, async () => { const error = new Error('blocked'); error.name = 'NotAllowedError'; throw error; });
  await b.clock.flush(); b.prompts[0].attrs.onClose(); await b.task.promise; assert.equal(b.task.value, false);
});
test('a stale autoplay confirmation after cancellation cannot restart playback', async t => {
  let calls = 0;
  const e = autoplaySetup(t, async () => { calls++; const error = new Error('blocked'); error.name = 'NotAllowedError'; throw error; });
  await e.clock.flush(); e.controller.abort(); await e.task.promise;
  await e.prompts[0].attrs.onConfirm(); assert.equal(e.task.value, false); assert.equal(calls, 1);
  assert.equal(e.prompts[0].el.isConnected, false); assert.equal(e.clock.timers.size, 0);
});

test('reader timing supports relative URLs and never turns invalid timing into immediate completion', t => {
  const e = setup(t), base = 'https://mooc1.chaoxing.com/knowledge/cards';
  for (const value of ['', '?timing=oops', '?timing=-1', '?timing=0', '?timing=Infinity'])
    assert.equal(e.api.studyReaderTiming(value, base), 60);
  assert.equal(e.api.studyReaderTiming('/readsvr/book/mooc?timing=90', base), 90);
  assert.equal(e.api.studyReaderTiming('?timing=1.5', base), 2);
});
test('CSS-hidden or detached verification elements are not treated as active challenges', t => {
  const e = setup(t, '<style>.hidden-by-css {display:none}.invisible {visibility:hidden}</style><div class="hidden-by-css"></div><div class="invisible"></div><div id="visible"></div>');
  assert.equal(e.api.isStudyElementVisible(e.document.querySelector('.hidden-by-css')), false);
  assert.equal(e.api.isStudyElementVisible(e.document.querySelector('.invisible')), false);
  const visible = e.document.querySelector('#visible'); assert.equal(e.api.isStudyElementVisible(visible), true);
  visible.remove(); assert.equal(e.api.isStudyElementVisible(visible), false);
});
