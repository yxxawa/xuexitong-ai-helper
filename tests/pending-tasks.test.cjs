const test = require('node:test');
const assert = require('node:assert/strict');
const { Clock, domRuntime, loadTS, plain } = require('./helpers/runtime.cjs');
const CATALOG = 'https://fycourse.fanya.chaoxing.com/fyportal/courselist/course';
const BASE = 'https://mooc1.chaoxing.com/mooc2/work/list?courseId=1&classId=11&cpi=7&enc=fixture';
function course(id = 1, name = '示例课程') {
  return { key: id + ':' + (id + 10) + ':7', name, closed: false,
    url: 'https://fycourse.fanya.chaoxing.com/fyportal/courselist/entercoursenewfy?courseId=' + id + '&clazzId=' + (id + 10) + '&cpi=7' };
}
function catalog(courses) {
  return '<ul>' + courses.map(item => '<li class="w_couritem"><h3><a href="' + item.url + '">' + item.name + '</a></h3>' + (item.closed ? '<span>本课程已结课</span>' : '') + '</li>').join('') + '</ul>';
}
function fields(values) { return Object.entries(values).map(([id, value]) => '<input id="' + id + '" type="hidden" value="' + value + '">').join(''); }
function courseHTML(id = 1) {
  return fields({ courseid: id, clazzid: id + 10, cpi: 7, workEnc: 'work-fixture', examEnc: 'exam-fixture', openc: 'open-fixture' }) +
    '<li dataname="zy"><a data-url="https://mooc1.chaoxing.com/mooc2/work/list">作业 NEW</a></li>' +
    '<li dataname="ks"><a data-url="https://mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list">考试 NEW</a></li>';
}
function work(id, status = '未交', time = '', title = '作业' + id, url) {
  return '<li onclick="goTask(this)" data="' + (url || '/mooc-ans/mooc2/work/task?workId=' + id + '&answerId=' + id) + '">' +
    '<div class="right-content"><p>' + title + '</p><p class="status">' + status + '</p></div><div class="time">' + time + '</div></li>';
}
function exam(id = 9, status = '待做', stopped = 0) {
  return '<li><div onclick="goTest(\'1\',' + id + ',0,\'2026-12-27 23:59:59.0\',4,false,\'fixture\',\'' + stopped + '\');">' +
    '<div class="right-content"><p>期末考试</p><p class="status">' + status + '</p><div class="span_tip" title="完成100%任务点可参加考试"></div></div></div><div class="time">剩余3小时20分钟</div></li>';
}
function list(rows = '', pages = 1) {
  return fields({ courseId: 1, classId: 11, cpi: 7, status: 0, topicId: 'topic-fixture' }) +
    '<div class="bottomList"><ul>' + rows + '</ul>' + (!rows ? '暂无作业' : '') + '</div>' +
    '<script>$("#page").paging({nowPage:1,pageNum:' + pages + '});</script>';
}
function setup(t, extras = {}) {
  const e = domRuntime('', 'https://i.chaoxing.com/base'); t.after(() => e.window.close()); const clock = new Clock();
  e.window.Element.prototype.replaceChildren = function (...nodes) { while (this.firstChild) this.removeChild(this.firstChild); this.append(...nodes); };
  const globals = { ...e.globals, ...clock.globals(), DOMParser: e.window.DOMParser,
    MutationObserver: e.window.MutationObserver, AbortController, queueMicrotask, ...extras };
  const api = loadTS('packages/scripts/src/utils/pending-tasks.ts', globals, {
    '@xuexitong-ai-helper/core/src/core/utils/request': { request: extras.request || (() => { throw new Error('Unexpected live transport'); }) }
  });
  return { ...e, clock, globals, api };
}
function report(tasks = [], changes = {}) {
  return { tasks, courseCount: 1, completedCourses: 1, pagesRead: 2, errors: [], fetchedAt: 100000, cancelled: false, ...changes };
}
function pendingTask(id, changes = {}) {
  return { id: String(id), kind: 'work', state: 'pending', title: '作业' + id, course: course(), status: '未交',
    url: 'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/task?workId=' + id, timeText: '', tip: '', fetchedAt: 100000, ...changes };
}
test('discovers the course catalog from both the portal iframe and inert inline source, without running scripts', t => {
  const { api, window } = setup(t);
  assert.equal(api.findCourseListURL('<iframe src="' + CATALOG + '?type=1&amp;term=all"></iframe>'), CATALOG + '?type=1&term=all');
  assert.equal(api.findCourseListURL('<script>window.SHOULD_NOT_RUN=true;$("iframe").attr("src","' + CATALOG + '?type=1&term=all")</script>'), CATALOG + '?type=1&term=all');
  assert.equal(window.SHOULD_NOT_RUN, undefined);
  assert.throws(() => api.findCourseListURL('<title>用户登录</title>'), /登录/);
});
test('course parsing keeps distinct classes with the same name, closed courses, and deduplicates repeated entries', t => {
  const { api } = setup(t), first = course(1), second = { ...course(2), closed: true };
  const courses = api.parseTaskCourses(catalog([first, second, first]), CATALOG);
  assert.equal(courses.length, 2); assert.equal(courses[1].closed, true); assert.notEqual(courses[0].key, courses[1].key);
  assert.throws(() => api.parseTaskCourses('<div>Loading</div>', CATALOG), /未加载/);
  assert.throws(() => api.parseTaskCourses(catalog([first]) + '<script>({pageNum:2})</script>', CATALOG), /分页/);
  assert.deepEqual(plain(api.parseTaskCourses('<p>暂无课程</p>', CATALOG)), []);
});
test('uses native work/exam navigation fields and never mistakes a NEW badge for a different menu', t => {
  const { api } = setup(t), links = api.parseCourseTaskLinks(courseHTML());
  assert.equal(links.length, 2);
  for (const entry of links) {
    const url = new URL(entry.url);
    assert.equal(url.searchParams.get('cpi'), '7');
    assert.equal(url.searchParams.get('enc'), entry.kind === 'work' ? 'work-fixture' : 'exam-fixture');
    assert.equal(url.searchParams.get(entry.kind === 'work' ? 'classId' : 'clazzid'), '11');
  }
  assert.equal(new URL(links[1].url).searchParams.get('openc'), 'open-fixture');
  assert.throws(() => api.parseCourseTaskLinks('<title>认证中</title>'), /学生课程/);
});
test('pending states include unopened work and peer reviews but exclude submitted, reviewed, and graded work', t => {
  const { api } = setup(t), statuses = ['未交','未开始','待互评','待做','待批阅','已完成','已互评','已提交','已过期'];
  const parsed = api.parseTaskList(list(statuses.map((status, index) => work(index + 1, status)).join('')), course(), 'work', BASE);
  assert.deepEqual(plain(parsed.tasks.map(item => item.status)), ['未交','未开始','待互评','待做','已过期']);
  assert.equal(parsed.tasks[1].state, 'upcoming'); assert.equal(parsed.tasks[2].kind, 'review'); assert.equal(parsed.tasks[4].state, 'expired');
  assert.equal(parsed.tasks[4].url, BASE); assert.deepEqual(plain(parsed.unknownStates), []);
});
test('exam links open native notes, preserve prerequisites and accurate Beijing deadlines, without starting the exam', t => {
  const { api } = setup(t), base = 'https://mooc1.chaoxing.com/exam-ans/mooc2/exam/exam-list?enc=fixture';
  const task = api.parseTaskList(list(exam()), course(), 'exam', base).tasks[0], url = new URL(task.url);
  assert.equal(url.pathname, '/exam-ans/exam/test/examcode/examnotes');
  assert.equal(url.searchParams.get('examId'), '9'); assert.equal(url.searchParams.get('classId'), '11');
  assert.equal(task.deadline, Date.parse('2026-12-27T23:59:59+08:00'));
  assert.match(task.tip, /100%/);
  const stopped = api.parseTaskList(list(exam(9, '待做', 1)), course(), 'exam', base).tasks[0];
  assert.equal(stopped.url, base); assert.match(stopped.tip, /停止考试/);
});
test('nested native peer-review links are retained and unsupported destinations fall back to the original list', t => {
  const { api } = setup(t), peer = '<li><div onclick="goTask(this)" data="/exam-ans/exam/test/evaluation-marklist?relationid=8"><div class="right-content"><p>同伴互评</p><p class="status">待互评</p></div></div></li>';
  const task = api.parseTaskList(list(peer), course(), 'exam', BASE).tasks[0];
  assert.match(task.url, /evaluation-marklist\?relationid=8$/);
  const invalid = api.parseTaskList(list(work(1, '未交', '', 'invalid', 'javascript:alert(1)')), course(), 'work', BASE).tasks[0];
  assert.equal(invalid.url, BASE);
  for (const value of ['', 'javascript:alert(1)', 'https://chaoxing.com.attacker.test/', 'https://evilchaoxing.com/']) assert.equal(api.taskURL(value), '');
});
test('relative deadlines advance from fetch time, missing deadlines stay unknown, and complete timestamps take precedence', t => {
  const { api } = setup(t), now = 100000;
  const task = api.parseTaskList(list(work(1, '未交', '剩余25小时2分钟')), course(), 'work', BASE, now).tasks[0];
  assert.equal(api.taskRemaining(task, now), 25 * 3600000 + 2 * 60000);
  assert.equal(api.formatTaskRemaining(task, now + 60000), '1天 1小时 1分钟');
  assert.equal(api.formatTaskRemaining({ ...task, remainingUntil: undefined, timeText: '' }, now), '平台未显示截止时间');
  assert.equal(api.formatTaskRemaining({ ...task, state: 'upcoming', remainingUntil: undefined, timeText: '' }, now), '尚未开放');
  assert.match(api.formatTaskRemaining(task, task.remainingUntil), /平台确认/);
});
test('unrecognized or loading pages cannot silently appear as an empty task list', t => {
  const { api } = setup(t);
  for (const html of ['<p>Loading</p>', '<div class="bottomList"><ul></ul></div>', '<input type="password">'])
    assert.throws(() => api.parseTaskList(html, course(), 'work', BASE));
  const parsed = api.parseTaskList(list(work(1, '平台新状态')), course(), 'work', BASE);
  assert.deepEqual(plain(parsed.unknownStates), ['平台新状态']); assert.equal(parsed.tasks.length, 0);
});
test('full scan completes both native task-list pagination and explicit empty lists, with one read in flight at a time', async t => {
  const { api } = setup(t), requested = [], progress = []; let current = 0, max = 0;
  const result = await api.scanPendingTasks({ currentTermOnly: false, onProgress: value => progress.push(value), loadText: async url => {
    requested.push(url); current++; max = Math.max(max, current); await Promise.resolve(); current--;
    const parsed = new URL(url);
    if (parsed.hostname === 'i.chaoxing.com') return '<iframe src="' + CATALOG + '"></iframe>';
    if (parsed.pathname.endsWith('/course')) return catalog([course(1), course(2, '另一门课')]);
    if (parsed.pathname.endsWith('/entercoursenewfy')) return courseHTML(Number(parsed.searchParams.get('courseId')));
    if (parsed.pathname.includes('exam-list')) return list('');
    if (parsed.searchParams.get('courseId') === '2') return list('');
    const page = Number(parsed.searchParams.get('pageNum') || 1);
    return list(work(page, page === 1 ? '已完成' : '未交', '剩余3小时'), 3);
  } });
  assert.equal(result.courseCount, 2); assert.equal(result.completedCourses, 2); assert.equal(result.pagesRead, 6);
  assert.equal(result.tasks.length, 2); assert.equal(result.errors.length, 0); assert.equal(max, 1);
  const pages = requested.filter(url => new URL(url).searchParams.has('pageNum'));
  assert.equal(pages.length, 2); for (const url of pages) {
    const parsed = new URL(url); assert.equal(parsed.pathname, '/mooc-ans/mooc2/work/list');
    assert.equal(parsed.searchParams.get('status'), '0'); assert.equal(parsed.searchParams.get('topicId'), 'topic-fixture');
  }
  assert.ok(progress.length > 3); assert.equal(progress[0].tasks.length, 0);
});
test('one failed course leaves the scan explicitly incomplete while successful courses retain their tasks', async t => {
  const { api } = setup(t);
  const result = await api.scanPendingTasks({ currentTermOnly: false, courseListUrl: CATALOG, loadText: async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/course')) return catalog([course(1), course(2)]);
    if (parsed.pathname.endsWith('/entercoursenewfy')) {
      if (parsed.searchParams.get('courseId') === '2') throw new Error('Request failed https://mooc1.chaoxing.com/?enc=SECRET');
      return courseHTML();
    }
    return parsed.pathname.includes('exam-list') ? list('') : list(work(1));
  } });
  assert.equal(result.tasks.length, 1); assert.equal(result.errors.length, 1); assert.equal(result.completedCourses, 2);
  assert.ok(!result.errors[0].message.includes('SECRET'));
});
test('a server returning page one again produces an incomplete-result error rather than fabricated complete pagination', async t => {
  const { api } = setup(t);
  const result = await api.scanPendingTasks({ currentTermOnly: false, courseListUrl: CATALOG, loadText: async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/course')) return catalog([course()]);
    if (path.endsWith('/entercoursenewfy')) return courseHTML();
    return path.includes('exam-list') ? list('') : list(work(1), 4);
  } });
  assert.equal(result.tasks.length, 1); assert.equal(result.errors.length, 1); assert.match(result.errors[0].message, /分页没有切换/);
});
test('cancellation retains only completed reads and never schedules the next course or list', async t => {
  const { api } = setup(t), controller = new AbortController(), requested = [];
  const result = await api.scanPendingTasks({ currentTermOnly: false, signal: controller.signal, courseListUrl: CATALOG, loadText: async url => {
    requested.push(url); const path = new URL(url).pathname;
    if (path.endsWith('/course')) return catalog([course(1), course(2), course(3), course(4)]);
    controller.abort(); return courseHTML();
  } });
  assert.equal(result.cancelled, true); assert.equal(result.tasks.length, 0); assert.ok(requested.length <= 3);
  assert.equal(result.completedCourses, 0); assert.equal(result.errors.length, 0);
});
function panelSetup(t, scan) {
  const e = setup(t);
  const { createPendingTasksPanel } = loadTS('packages/scripts/src/elements/pending.tasks.ts', e.globals, { '../utils/pending-tasks': e.api });
  const root = createPendingTasksPanel(scan); e.document.body.append(root);
  t.after(() => e.window.dispatchEvent(new e.window.Event('pagehide')));
  const click = text => [...root.querySelectorAll('button')].find(button => button.textContent === text).click();
  return { ...e, root, createPendingTasksPanel, click };
}
test('the panel defers its initial read, filters by subject and type, and safely displays literal task text', async t => {
  let calls = 0;
  const tasks = [pendingTask(1, { title: '<img src=x onerror=alert(1)>', remainingUntil: 100000 + 3600000 }),
    pendingTask(2, { kind: 'exam', status: '待做', course: course(2, '另一门课') }),
    pendingTask(3, { state: 'expired', status: '已过期' }), pendingTask(4, { kind: 'review', status: '待互评' })];
  const e = panelSetup(t, async () => { calls++; return report(tasks); });
  assert.equal(calls, 0); e.click('刷新待办'); await e.clock.flush();
  assert.equal(calls, 1); assert.equal(e.root.querySelectorAll('article').length, 3); assert.equal(e.root.querySelector('img'), null);
  assert.match(e.root.textContent, /<img src=x/);
  for (const anchor of e.root.querySelectorAll('.pending-task-title')) { assert.equal(anchor.target, '_blank'); assert.equal(anchor.rel, 'noopener noreferrer'); }
  e.root.querySelector('[data-filter="exam"]').click(); assert.equal(e.root.querySelectorAll('article').length, 1);
  assert.match(e.root.querySelector('.pending-task-open').textContent, /考试说明/);
  e.root.querySelector('[data-filter="all"]').click();
  const select = e.root.querySelector('[aria-label="筛选科目"]'); select.value = '另一门课'; select.dispatchEvent(new e.window.Event('change'));
  assert.equal(e.root.querySelectorAll('article').length, 1);
  e.root.querySelector('[data-filter="expired"]').click(); assert.equal(e.root.querySelectorAll('article').length, 0);
});
test('refresh failure survives countdown updates and keeps the previous snapshot visibly stale', async t => {
  let calls = 0;
  const e = panelSetup(t, async () => { if (++calls === 1) return report([pendingTask(1)]); throw new Error('请重新登录'); });
  e.click('刷新待办'); await e.clock.flush(); e.click('刷新待办'); await e.clock.flush();
  assert.match(e.root.querySelector('[role="status"]').textContent, /读取失败.*上次/);
  await e.clock.advance(60000);
  assert.match(e.root.querySelector('[role="status"]').textContent, /请重新登录/);
  assert.equal(e.root.querySelectorAll('article').length, 1);
});
test('stopping, detaching, and replacing a panel abort its scan and release its countdown timer', async t => {
  let signal;
  const e = panelSetup(t, options => { signal = options.signal; return new Promise(resolve => signal.addEventListener('abort', () => resolve(report([], { cancelled: true })))); });
  e.click('刷新待办'); await e.clock.flush(); e.click('停止读取'); await e.clock.flush();
  assert.equal(signal.aborted, true); assert.equal(e.root.querySelector('button').disabled, false);
  e.click('刷新待办'); await e.clock.flush(); const running = signal;
  e.root.remove(); await e.clock.flush(); assert.equal(running.aborted, true); assert.equal(e.clock.timers.size, 0);
  const next = e.createPendingTasksPanel(async () => report()); e.document.body.append(next); await e.clock.advance(0);
  assert.equal(e.clock.timers.size, 1); const replacement = e.createPendingTasksPanel(async () => report()); e.document.body.append(replacement);
  await e.clock.advance(0); assert.equal(e.clock.timers.size, 1);
  e.window.dispatchEvent(new e.window.Event('pagehide')); assert.equal(e.clock.timers.size, 0);
});
test('dynamic catalogs use the native all-term student list and also include courses inside folders', async t => {
  const { api } = setup(t), urls = [];
  const result = await api.scanPendingTasks({ currentTermOnly: false, courseListUrl: CATALOG, loadText: async url => {
    urls.push(url); const parsed = new URL(url), path = parsed.pathname;
    if (path.endsWith('/course')) return '<div class="spaceBox" uid="fixture-user"></div><div id="stuCourseList"></div>';
    if (path.endsWith('/getStudyCourse')) {
      for (const key of ['sectionId','coursesource','searchkkstatus','belongSchoolId']) assert.equal(parsed.searchParams.get(key), '0');
      assert.equal(parsed.searchParams.get('semesterNum'), ''); assert.equal(parsed.searchParams.get('coursename'), '');
      return catalog([course(1)]);
    }
    if (path.endsWith('/getFolderList')) return JSON.stringify({ data: [{ id: 4, ckenc: 'fixture-folder', foldername: '学习文件夹' }], rootenc: 'fixture-root' });
    if (path.endsWith('/getFolderCourse')) {
      assert.equal(parsed.searchParams.get('uid'), 'fixture-user'); assert.equal(parsed.searchParams.get('folderid'), '4');
      return catalog([course(1), course(2, '文件夹内课程')]);
    }
    if (path.endsWith('/entercoursenewfy')) return courseHTML(Number(parsed.searchParams.get('courseId')));
    return path.includes('exam-list') ? list('') : list(work(parsed.searchParams.get('courseId')));
  } });
  assert.equal(result.courseCount, 2); assert.equal(result.tasks.length, 2); assert.equal(result.errors.length, 0);
  assert.equal(urls.filter(url => new URL(url).pathname.endsWith('/getFolderCourse')).length, 1);
});
test('an unreadable folder cannot turn a partial catalog into an apparent complete result', async t => {
  const { api } = setup(t);
  const result = await api.scanPendingTasks({ currentTermOnly: false, courseListUrl: CATALOG, loadText: async url => {
    const parsed = new URL(url), path = parsed.pathname;
    if (path.endsWith('/course')) return '<div class="spaceBox" uid="fixture-user"></div><div id="stuCourseList"></div>';
    if (path.endsWith('/getStudyCourse')) return catalog([course(1)]);
    if (path.endsWith('/getFolderList')) return JSON.stringify({ data: [{ id: 4, ckenc: 'fixture-folder', foldername: '不可用文件夹' }] });
    if (path.endsWith('/getFolderCourse')) throw new Error('folder unavailable');
    if (path.endsWith('/entercoursenewfy')) return courseHTML();
    return list('');
  } });
  assert.equal(result.completedCourses, 1); assert.equal(result.errors.length, 1); assert.match(result.errors[0].course, /不可用文件夹/);
});
test('a native verification page pauses the whole queue and exposes its original entry without retrying or solving it', async t => {
  const { api } = setup(t), urls = [];
  const result = await api.scanPendingTasks({ currentTermOnly: false, courseListUrl: CATALOG, loadText: async url => {
    urls.push(url);
    if (new URL(url).pathname.endsWith('/course')) return catalog([course(1),course(2),course(3)]);
    return '<title>提示页面</title><p>【9010】操作异常，请输入图片中的验证码</p>';
  } });
  assert.equal(urls.length, 2); assert.equal(result.completedCourses, 0); assert.equal(result.errors.length, 1);
  assert.equal(result.verificationUrl, course(1).url); assert.match(result.errors[0].message, /验证码/);
  assert.equal(result.cancelled, false);
});
test('production reads are paced and a stop during the interval prevents the next transport request', async t => {
  const calls = [], controller = new AbortController();
  const e = setup(t, { request: async url => { calls.push(url); return '<iframe src="' + CATALOG + '"></iframe>'; } });
  const stopped = assert.rejects(e.api.scanPendingTasks({ currentTermOnly: false, signal: controller.signal }), /已停止/);
  await e.clock.flush(); assert.equal(calls.length, 1); assert.equal(e.clock.timers.size, 1);
  controller.abort(); await stopped; assert.equal(calls.length, 1); assert.equal(e.clock.timers.size, 0);
});
test('successful production reads leave a gap between requests without leaking the pacing timer', async t => {
  const calls = []; let e;
  e = setup(t, { request: async url => {
    calls.push({ url, at: e.clock.now }); const path = new URL(url).pathname;
    if (path === '/base') return '<iframe src="' + CATALOG + '"></iframe>';
    if (path.endsWith('/course')) return catalog([course()]);
    if (path.endsWith('/entercoursenewfy')) return courseHTML();
    return list('');
  } });
  const scan = e.api.scanPendingTasks({ currentTermOnly: false }); await e.clock.advance(3000); const result = await scan;
  assert.equal(result.completedCourses, 1); assert.equal(calls.length, 5);
  for (let index = 1; index < calls.length; index++) assert.ok(calls[index].at - calls[index - 1].at >= 600);
  assert.equal(e.clock.timers.size, 0);
});