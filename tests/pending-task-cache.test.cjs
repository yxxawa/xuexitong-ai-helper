const test = require('node:test');
const assert = require('node:assert/strict');
const { Clock, domRuntime, loadTS, plain, storage } = require('./helpers/runtime.cjs');
const PANEL = 'packages/scripts/src/elements/pending.tasks.ts';
const CACHE = 'packages/scripts/src/utils/pending-task-cache.ts';
const KEY = 'xth.pending-tasks.v1:user:42';
const NOW = 100000;
function task(id = '1', changes = {}) {
  return { id, kind: 'work', state: 'pending', title: '作业' + id, status: '未交',
    course: { key: '1:11:7', name: '示例课程', closed: false, url: 'https://mooc1.chaoxing.com/course/1' },
    url: 'https://mooc1.chaoxing.com/work/' + id, timeText: '剩余1小时', remainingUntil: NOW + 3600000,
    tip: '', fetchedAt: NOW, ...changes };
}
function report(tasks = [task()], changes = {}) {
  return { tasks, courseCount: 1, completedCourses: 0, pagesRead: 3, errors: [], fetchedAt: NOW,
    cancelled: false, source: 'summary', ...changes };
}
function setup(t, store = storage(), now = NOW, moduleStubs = {}) {
  const env = domRuntime('', 'https://i.chaoxing.com/base'), clock = new Clock(now);
  env.document.cookie = '_uid=42; path=/';
  env.window.Element.prototype.replaceChildren = function (...nodes) {
    while (this.firstChild) this.removeChild(this.firstChild); this.append(...nodes);
  };
  const globals = { ...env.globals, ...clock.globals(), ...store.globals, DOMParser: env.window.DOMParser,
    MutationObserver: env.window.MutationObserver, AbortController, queueMicrotask };
  const stubs = { '@xuexitong-ai-helper/core/src/core/utils/request': {
    request() { throw new Error('Unexpected live request'); }
  } };
  const api = loadTS(PANEL, globals, { ...stubs, ...moduleStubs }), cache = loadTS(CACHE, globals);
  t.after(() => { env.window.dispatchEvent(new env.window.Event('pagehide')); env.window.close(); });
  return { ...env, clock, store, api, cache, open(scan, full) {
    const root = api.createPendingTasksPanel(scan, full); env.document.body.append(root); return root;
  } };
}
function click(root, label) { [...root.querySelectorAll('button')].find(button => button.textContent === label).click(); }

test('opening the panel defers the first summary read and persists only its final snapshot', async t => {
  const e = setup(t); let calls = 0;
  const root = e.open(async options => {
    calls++; options.onProgress(report([], { pagesRead: 0 }));
    assert.equal(root.querySelectorAll('article').length, 0);
    assert.equal(e.store.writes.length, 0);
    return report();
  });
  assert.equal(calls, 0);
  await e.clock.advance(0);
  assert.equal(calls, 1); assert.equal(root.querySelectorAll('article').length, 1);
  assert.deepEqual(e.store.values.get(KEY), { version: 1, report: report() });
  assert.equal(e.clock.timers.size, 1);
});

test('a fresh page immediately renders persisted tasks and computes remaining time from the cached deadline', async t => {
  const store = storage(), first = setup(t, store);
  const original = first.open(async () => report()); await first.clock.advance(0);
  original.remove(); await first.clock.flush(); assert.equal(first.clock.timers.size, 0);
  const next = setup(t, store, NOW + 1800000); let calls = 0;
  const root = next.open(() => { calls++; return new Promise(() => {}); });
  assert.equal(calls, 0); assert.equal(root.querySelectorAll('article').length, 1);
  assert.equal(root.querySelector('.pending-task-time').textContent, '30分钟');
  const snapshot = root.innerHTML;
  await next.clock.advance(0);
  assert.equal(calls, 1); assert.equal(root.innerHTML, snapshot);
});

test('reopening reuses the view and filters, while equal reordered responses cause no list mutations', async t => {
  const e = setup(t); let calls = 0, finish, progress;
  const items = [task(), task('2', { kind: 'exam' })];
  const scan = async options => {
    if (++calls === 1) return report(items);
    progress = options.onProgress;
    return new Promise(resolve => { finish = resolve; });
  };
  const root = e.open(scan); await e.clock.advance(0);
  root.querySelector('[data-filter="exam"]').click();
  const search = root.querySelector('input'); search.value = '作业'; search.dispatchEvent(new e.window.Event('input'));
  const row = root.querySelector('article'), footer = root.querySelector('.pending-task-footer').textContent;
  const list = root.querySelector('.pending-task-list'), changes = [];
  const observer = new e.window.MutationObserver(records => changes.push(...records));
  observer.observe(list, { subtree: true, childList: true, attributes: true, characterData: true });
  root.remove(); await e.clock.flush(); assert.equal(e.clock.timers.size, 0);
  const reopened = e.open(scan); assert.equal(reopened, root);
  assert.equal(root.querySelector('article'), row); assert.equal(search.value, '作业');
  await e.clock.advance(0);
  progress(report([], { pagesRead: 0 })); await e.clock.flush();
  assert.equal(root.querySelector('article'), row);
  finish(report([...items].reverse().map(item => ({ ...item, fetchedAt: NOW + 20000,
    timeText: '剩余59分钟', remainingUntil: item.remainingUntil + 20000 })), { fetchedAt: NOW + 20000 }));
  await e.clock.flush(); observer.disconnect();
  assert.equal(calls, 2); assert.equal(root.querySelector('article'), row);
  assert.equal(root.querySelector('.pending-task-footer').textContent, footer);
  assert.equal(changes.length, 0); assert.equal(e.store.writes.length, 1);
});

test('changed results appear atomically and retain unchanged task nodes and the current search', async t => {
  const e = setup(t); let calls = 0, finish, progress;
  const scan = options => {
    if (++calls === 1) return Promise.resolve(report([task(), task('2'), task('3')]));
    progress = options.onProgress; return new Promise(resolve => { finish = resolve; });
  };
  const root = e.open(scan); await e.clock.advance(0);
  const first = root.querySelector('article'), search = root.querySelector('input');
  search.value = '作业'; search.dispatchEvent(new e.window.Event('input'));
  root.remove(); await e.clock.flush(); e.open(scan); await e.clock.advance(0);
  progress(report([task('4')], { pagesRead: 1 })); await e.clock.flush();
  assert.equal(root.querySelectorAll('article').length, 3); assert.equal(root.querySelector('article'), first);
  assert.ok(!root.querySelector('.pending-task-list').textContent.includes('作业4'));
  finish(report([task(), task('2', { status: '待重做' }), task('4')], { fetchedAt: NOW + 1000 }));
  await e.clock.flush();
  assert.equal(root.querySelectorAll('article').length, 3); assert.equal(root.querySelector('article'), first);
  assert.match(root.querySelector('.pending-task-list').textContent, /待重做/);
  assert.ok(!root.querySelector('.pending-task-list').textContent.includes('作业3'));
  assert.equal(search.value, '作业'); assert.equal(e.store.writes.length, 2);
});

test('countdown ticks update only time text and never restart requests or rebuild task links', async t => {
  const e = setup(t); let calls = 0;
  const root = e.open(async () => { calls++; return report([task('1', { remainingUntil: NOW + 61000 })]); });
  await e.clock.advance(0);
  const row = root.querySelector('article'), link = root.querySelector('.pending-task-title'), time = root.querySelector('.pending-task-time');
  assert.equal(time.textContent, '2分钟'); await e.clock.advance(1000); assert.equal(time.textContent, '1分钟');
  await e.clock.advance(60000); assert.match(time.textContent, /时间已到/);
  assert.equal(root.querySelector('article'), row); assert.equal(root.querySelector('.pending-task-title'), link);
  assert.equal(root.querySelector('.pending-task-time'), time); assert.equal(calls, 1);
  assert.equal(e.store.writes.length, 1);
  root.remove(); await e.clock.flush(); assert.equal(e.clock.timers.size, 0);
});

for (const mode of ['failure', 'partial', 'verification', 'cancelled']) {
  test(mode + ' during refresh retains the last complete view and persistent cache', async t => {
    const e = setup(t); let calls = 0;
    const root = e.open(async options => {
      if (++calls === 1) return report();
      options.onProgress(report([]));
      if (mode === 'failure') throw new Error('请重新登录');
      return report([], mode === 'partial' ? { errors: [{ course: '示例课程', message: '网络失败' }] }
        : mode === 'verification' ? { verificationUrl: 'https://i.chaoxing.com/verify' } : { cancelled: true });
    });
    await e.clock.advance(0); const row = root.querySelector('article'), saved = plain(e.store.values.get(KEY));
    click(root, '刷新待办'); await e.clock.flush();
    assert.equal(root.querySelector('article'), row);
    assert.match(root.querySelector('[role="status"]').textContent, /保留上次/);
    assert.deepEqual(e.store.values.get(KEY), saved); assert.equal(e.store.writes.length, 1);
    await e.clock.advance(1000); assert.match(root.querySelector('[role="status"]').textContent, /保留上次/);
  });
}

test('manual full recheck can interrupt background refresh and ignores its late response', async t => {
  const e = setup(t); let calls = 0, finish, signal, full = 0;
  const scan = options => {
    if (++calls === 1) return Promise.resolve(report());
    signal = options.signal; return new Promise(resolve => { finish = resolve; });
  };
  const complete = async () => { full++; return report([task('full')], { source: 'courses' }); };
  const root = e.open(scan, complete); await e.clock.advance(0);
  root.remove(); await e.clock.flush(); e.open(scan, complete); await e.clock.advance(0);
  click(root, '完整补查'); await e.clock.flush();
  assert.equal(signal.aborted, true); assert.equal(full, 1); assert.match(root.textContent, /作业full/);
  finish(report([task('late')])); await e.clock.flush();
  assert.ok(!root.textContent.includes('作业late')); assert.match(root.textContent, /作业full/);
  assert.equal(e.store.writes.length, 2);
});

test('detaching cancels a pending refresh and a late response cannot replace a newer view', async t => {
  const e = setup(t); let calls = 0, finish, signal;
  const scan = options => {
    calls++;
    if (calls !== 2) return Promise.resolve(report([task(calls === 1 ? '1' : 'new')]));
    signal = options.signal; return new Promise(resolve => { finish = resolve; });
  };
  const root = e.open(scan); await e.clock.advance(0);
  root.remove(); await e.clock.flush(); e.open(scan); await e.clock.advance(0);
  root.remove(); await e.clock.flush(); assert.equal(signal.aborted, true); assert.equal(e.clock.timers.size, 0);
  e.open(scan); await e.clock.advance(0); assert.match(root.textContent, /作业new/);
  finish(report([task('late')])); await e.clock.flush();
  assert.ok(!root.textContent.includes('作业late')); assert.match(root.textContent, /作业new/);
});

test('cache scopes separate signed-in users and reject malformed or incomplete snapshots', async t => {
  const e = setup(t), scan = async () => report();
  const root = e.open(scan); await e.clock.advance(0);
  assert.equal(e.cache.pendingTaskCacheScope(), 'user:42');
  root.remove(); await e.clock.flush(); e.document.cookie = '_uid=43; path=/';
  const other = e.open(scan);
  assert.notEqual(other, root); assert.equal(other.querySelectorAll('article').length, 0);
  assert.equal(e.cache.readPendingTaskCache('user:43'), undefined);
  e.store.values.set('xth.pending-tasks.v1:user:43', { version: 1, report: report([{}]) });
  assert.equal(e.cache.readPendingTaskCache('user:43'), undefined);
  e.store.values.set('xth.pending-tasks.v1:user:43', { version: 1, report: report([], { cancelled: true }) });
  assert.equal(e.cache.readPendingTaskCache('user:43'), undefined);
  e.cache.writePendingTaskCache('user:43', report([], { errors: [{ course: '', message: '读取失败' }] }));
  assert.equal(e.store.writes.length, 1);
});

test('semantic comparison ignores fetch times and countdown rounding but detects task or deadline changes', t => {
  const { cache } = setup(t), original = report([task(), task('2')]);
  assert.equal(cache.sameTaskReport(original, report([task('2'), task()], { fetchedAt: NOW + 1000 })), true);
  assert.equal(cache.samePendingTask(task(), task('1', { remainingUntil: NOW + 3600000 + 59999, timeText: '剩余59分钟' })), true);
  for (const changes of [{ title: '新任务名' }, { status: '待重做' }, { remainingUntil: NOW + 7200000 },
    { deadline: NOW + 3600000 }, { url: 'https://mooc1.chaoxing.com/work/changed' }]) {
    assert.equal(cache.samePendingTask(task(), task('1', changes)), false);
  }
  assert.equal(cache.samePendingTask(task('1', { remainingUntil: undefined, timeText: '尚未开放' }),
    task('1', { remainingUntil: undefined, timeText: '平台未显示截止时间' })), false);
});


test('rapid repeated opens schedule one refresh and detaching clears every deferred timer', async t => {
  const e = setup(t); let calls = 0;
  const scan = async () => { calls++; return report(); };
  const first = e.open(scan), second = e.open(scan);
  assert.equal(first, second); await e.clock.flush();
  assert.equal(e.clock.timers.size, 2);
  second.remove(); await e.clock.flush();
  assert.equal(e.clock.timers.size, 0); assert.equal(calls, 0);
});

test('reopening after a failed refresh clears its message when unchanged data is confirmed', async t => {
  const e = setup(t); let calls = 0;
  const scan = async () => {
    if (++calls === 2) throw new Error('暂时断网');
    return report();
  };
  const root = e.open(scan); await e.clock.advance(0);
  click(root, '刷新待办'); await e.clock.flush(); assert.match(root.textContent, /暂时断网/);
  const row = root.querySelector('article');
  root.remove(); await e.clock.flush(); e.open(scan); await e.clock.advance(0);
  assert.ok(!root.textContent.includes('暂时断网')); assert.equal(root.querySelector('article'), row);
  assert.equal(e.store.writes.length, 1);
});

test('a cancelled link lookup cannot clear a new lookup for the same cached task after reopening', async t => {
  const requests = [], popups = [];
  const e = setup(t, storage(), NOW, { '../utils/pending-task-navigation': {
    resolveDesktopTaskURL: (task, options) => new Promise(resolve => requests.push({ signal: options.signal, resolve }))
  } });
  e.window.open = () => {
    const popup = { closed: false, opener: {}, document: e.document.implementation.createHTMLDocument(''),
      location: { replace() {} }, close() { this.closed = true; } };
    popups.push(popup); return popup;
  };
  const scan = async () => report([task('1', { desktopWorkId: '9' })]);
  const root = e.open(scan); await e.clock.advance(0);
  const link = root.querySelector('.pending-task-title'); link.click(); await e.clock.flush();
  root.remove(); await e.clock.flush();
  assert.equal(requests[0].signal.aborted, true); assert.equal(popups[0].closed, true);
  assert.equal(link.hasAttribute('aria-busy'), false);
  assert.equal(root.querySelectorAll('.pending-task-status')[1].hidden, true);
  e.open(scan); await e.clock.advance(0); link.click(); await e.clock.flush();
  assert.equal(requests.length, 2); assert.equal(link.getAttribute('aria-busy'), 'true');
  requests[0].resolve('https://mooc1.chaoxing.com/work/old'); await e.clock.flush();
  link.click(); await e.clock.flush();
  assert.equal(requests.length, 2); assert.equal(link.getAttribute('aria-busy'), 'true');
  requests[1].resolve('https://mooc1.chaoxing.com/work/new'); await e.clock.flush();
  assert.equal(link.hasAttribute('aria-busy'), false); assert.equal(popups[1].closed, false);
});


test('an interrupted silent retry cannot leave a stale failure message after a later successful check', async t => {
  const e = setup(t); let calls = 0, finish;
  const scan = async () => {
    calls++;
    if (calls === 2) throw new Error('暂时断网');
    if (calls === 3) return new Promise(resolve => { finish = resolve; });
    return report();
  };
  const root = e.open(scan); await e.clock.advance(0);
  click(root, '刷新待办'); await e.clock.flush(); assert.match(root.textContent, /暂时断网/);
  root.remove(); await e.clock.flush(); e.open(scan); await e.clock.advance(0);
  assert.match(root.textContent, /暂时断网/);
  root.remove(); await e.clock.flush(); e.open(scan); await e.clock.advance(0);
  assert.ok(!root.textContent.includes('暂时断网')); assert.equal(e.store.writes.length, 1);
  finish(report()); await e.clock.flush(); assert.ok(!root.textContent.includes('暂时断网'));
});
