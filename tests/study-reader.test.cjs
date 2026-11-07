const test = require('node:test');
const assert = require('node:assert/strict');
const { Clock, domRuntime, loadTS } = require('./helpers/runtime.cjs');
function setup(t, html = '') {
  const e = domRuntime(html, 'https://mooc1.chaoxing.com/readsvr/book/mooc?timing=1');
  const clock = new Clock(), controller = new AbortController(), calls = [];
  t.after(() => { controller.abort(); e.window.close(); });
  let enabled = true;
  const api = loadTS('packages/scripts/src/utils/study-reader.ts', { ...e.globals, ...clock.globals() });
  const run = () => {
    const result = { done: false };
    result.promise = api.runStudyReader(e.window, controller.signal, () => enabled).then(
      () => { result.done = true; }, error => { result.done = true; result.error = error; });
    return result;
  };
  return { ...e, clock, controller, calls, run, disable() { enabled = false; } };
}
const timedReader = '<style>.readerPager{position:relative;z-index:101}</style><div id="reader"></div><select id="pagejump"><option value="1">Start</option><option value="5">Body</option><option value="7">End</option></select><button class="readerPager">Next page</button>';
test('ordinary reading waits for its reader and turns the last page once', async t => {
  const e = setup(t); const task = e.run(); await e.clock.advance(1000);
  e.window.readweb = { goto: page => e.calls.push(page) }; e.window.epage = 7;
  await e.clock.advance(5000); assert.equal(e.calls.length, 0);
  await e.clock.advance(300); await task.promise;
  assert.deepEqual(e.calls, [7]); assert.equal(task.error, undefined); assert.equal(e.clock.timers.size, 0);
});
test('disabling automatic reading during its delay prevents a late page turn', async t => {
  const e = setup(t); e.window.readweb = { goto: page => e.calls.push(page) }; e.window.epage = 7;
  const task = e.run(); await e.clock.advance(1000); e.disable(); await e.clock.advance(5000); await task.promise;
  assert.equal(task.error.name, 'AbortError'); assert.equal(e.calls.length, 0); assert.equal(e.clock.timers.size, 0);
});
test('missing reader dependencies time out without leaving polls alive', async t => {
  const e = setup(t), task = e.run(); await e.clock.advance(31000); await task.promise;
  assert.match(task.error.message, /加载超时/); assert.equal(e.clock.timers.size, 0);
});
test('invalid ordinary reader page numbers fail without calling the platform reader', async t => {
  const e = setup(t); e.window.readweb = { goto: page => e.calls.push(page) }; e.window.epage = NaN;
  const task = e.run(); await e.clock.advance(6000); await task.promise;
  assert.match(task.error.message, /页码未就绪/); assert.equal(e.calls.length, 0); assert.equal(e.clock.timers.size, 0);
});
test('timed reading preserves waits and finds a pager styled through CSS', async t => {
  const e = setup(t, timedReader);
  e.window.require = (names, ready) => ready({ goPage() {} });
  e.document.querySelector('select').onchange = event => e.calls.push(event.target.value);
  e.document.querySelector('button').onclick = () => e.calls.push('next');
  const task = e.run(); await e.clock.advance(6900); assert.deepEqual(e.calls, []);
  await e.clock.advance(200); assert.deepEqual(e.calls, ['5']);
  await e.clock.advance(4000); assert.deepEqual(e.calls, ['5', '7']);
  await e.clock.advance(4000); await task.promise;
  assert.deepEqual(e.calls, ['5', '7', 'next']); assert.equal(task.error, undefined); assert.equal(e.clock.timers.size, 0);
});
test('a timed reader cancelled between page turns cannot turn again', async t => {
  const e = setup(t, timedReader);
  e.window.require = (names, ready) => ready({ goPage() {} });
  e.document.querySelector('select').onchange = event => e.calls.push(event.target.value);
  const task = e.run(); await e.clock.advance(7500); e.controller.abort();
  await task.promise; await e.clock.advance(20000);
  assert.deepEqual(e.calls, ['5']); assert.equal(task.error.name, 'AbortError'); assert.equal(e.clock.timers.size, 0);
});
test('a stale reader-module callback after cancellation cannot restart timed reading', async t => {
  const e = setup(t, timedReader); let ready;
  e.window.require = (names, callback) => { ready = callback; };
  const task = e.run(); await e.clock.flush(); e.controller.abort(); await task.promise;
  ready({ goPage() {} }); await e.clock.advance(40000);
  assert.equal(task.error.name, 'AbortError'); assert.equal(e.document.querySelector('select').value, '1'); assert.equal(e.clock.timers.size, 0);
});
test('a missing module callback fails visibly and releases its initialization timeout', async t => {
  const e = setup(t, timedReader); e.window.require = () => {};
  const task = e.run(); await e.clock.advance(31000); await task.promise;
  assert.match(task.error.message, /初始化超时/); assert.equal(e.clock.timers.size, 0);
});
test('missing timed-reader page options never dispatch a change with an empty value', async t => {
  const e = setup(t, timedReader.replace('<option value="7">End</option>', ''));
  e.window.require = (names, ready) => ready({ goPage() {} });
  e.document.querySelector('select').onchange = event => e.calls.push(event.target.value);
  const task = e.run(); await e.clock.advance(31000); await task.promise;
  assert.match(task.error.message, /加载超时/); assert.deepEqual(e.calls, []); assert.equal(e.clock.timers.size, 0);
});
test('ordinary reading accepts the legacy page number stored as a numeric string', async t => {
  const e = setup(t); e.window.readweb = { goto: page => e.calls.push(page) }; e.window.epage = '7';
  const task = e.run(); await e.clock.advance(6000); await task.promise;
  assert.deepEqual(e.calls, [7]); assert.equal(task.error, undefined); assert.equal(e.clock.timers.size, 0);
});
