const test = require('node:test');
const assert = require('node:assert/strict');
const { Clock, domRuntime, loadTS, plain } = require('./helpers/runtime.cjs');
const NOW = Date.parse('2026-11-01T12:00:00+08:00');
const TERM = '<div class="spaceBox" sectionId="20" semesterNum="20261"></div><div id="stukc"><select name="xq"><option value="0">全部</option><option value="99" semesterNum="20271">2027-2028第一学期</option><option value="20" semesterNum="20261">2026-2027第一学期</option><option value="10" semesterNum="20252">2025-2026第二学期</option></select></div>';
function setup(t) {
  const env = domRuntime('', 'https://i.chaoxing.com/base'); t.after(() => env.window.close()); const clock = new Clock(NOW);
  env.window.Element.prototype.replaceChildren = function (...nodes) { while (this.firstChild) this.removeChild(this.firstChild); this.append(...nodes); };
  const globals = { ...env.globals, ...clock.globals(), DOMParser: env.window.DOMParser, AbortController, queueMicrotask, MutationObserver: env.window.MutationObserver };
  const stubs = { '@xuexitong-ai-helper/core/src/core/utils/request': { request() { throw new Error('Unexpected live transport'); } } };
  const api = loadTS('packages/scripts/src/utils/pending-task-summary.ts', globals, stubs);
  const full = loadTS('packages/scripts/src/utils/pending-tasks.ts', globals, stubs);
  return { ...env, clock, globals, stubs, api, full, urls: api.TASK_SUMMARY_URLS };
}
function courseItem(id, classId, sectionId = 20, state = 0, name = '完整科目名称') {
  return { cpi: 7, content: { id: classId, cpi: 7, state, roletype: 3, course: { data: [{ id, name, sectionId }] } } };
}
const courseData = JSON.stringify({ result: 1, hasMore: false, channelList: [courseItem(1,11),courseItem(1,12,20,1,'同名课程的已结课班级'),courseItem(2,22,10,0,'往年未结课课程'),courseItem(3,33,0,0,'未归属学期的课程')] });
function workRow(id, state = '未提交', title = '作业' + id, time = '剩余1小时2分钟', raw = '') {
  return '<li onclick="goTask(this)" data="' + (raw || '/mooc-ans/android/mtaskmsgspecial?taskrefId=' + id + '&courseId=1&clazzId=11&enc_task=fixture') + '">' +
    '<div role="option"><p>' + title + '</p><span>' + state + '</span><span>《完整科...》</span><span class="fr">' + time + '</span></div></li>';
}
function workList(rows = '') { return '<title>作业列表</title><ul class="nav">' + rows + '</ul><script>var haveMore="0";</script>'; }
function examRow(id = 9, state = '未交', title = '考试' + id, stop = 0) {
  return '<li onclick="goTask(this)" data-stopexam="' + stop + '" data="/exam-ans/exam/phone/task-exam?taskrefId=' + id + '&courseId=1&classId=11&from=examlist">' +
    '<dl class="ks_text"><dt>' + title + '</dt><dd>剩余2小时</dd></dl><span class="ks_state">' + state + '</span></li>';
}
function examList(rows = '') { return '<title>考试</title><ul class="ks_list">' + rows + '</ul>'; }
function tableRow(id = 9, status = '未交', examStatus = '进行中', end = '2026-12-27 23:59') {
  const refer = encodeURIComponent('/exam-ans/exam/test/examcode/examnotes?courseId=1&classId=11&examId=' + id);
  return '<tr class="dataTr"><td>1</td><td>考试' + id + '</td><td>2026-10-19 12:00 至 ' + end + '</td><td>45</td><td>' + examStatus + '</td><td>' + status + '</td><td>---</td><td>未设置终端</td>' +
    '<td><a onclick="go(\'/exam-ans/mycourse/transfer?moocId=1&clazzid=11&refer=' + refer + '\',\'0\')">开始考试</a></td></tr>';
}
function examTable(rows = '', total = 0, size = 12) { return '<title>考试列表</title><table>' + rows + '</table><script>page.showPage(0/' + size + '+1,Math.ceil(' + total + '/' + size + '),"changePage")</script>'; }
function responses(e, changes = {}) {
  return { [e.urls.courses]: courseData, [e.urls.semester]: TERM, [e.urls.work]: workList(workRow(1)),
    [e.urls.exam]: examList(examRow()), [e.urls.examTable]: examTable(tableRow(), 1), ...changes };
}
test('course JSON supplies full names and distinct class memberships, and school semesters select the current date rather than the latest option', t => {
  const e = setup(t), parsed = e.api.parseSummaryCourses(courseData);
  assert.equal(parsed.courses.length, 4); assert.equal(parsed.courses[0].name, '完整科目名称'); assert.equal(parsed.courses[1].closed, true);
  assert.equal(parsed.courses[0].sectionId, '20'); assert.equal(e.full.parseCurrentTaskSemester(TERM).id, '20');
  assert.throws(() => e.api.parseSummaryCourses('{"result":0}'), /登录/);
  assert.throws(() => e.full.parseCurrentTaskSemester(TERM.replace('20261','20251')), /当前学期/);
});
test('summary work parsing accepts plain status spans and redo or peer-review states, while excluding submitted items', t => {
  const e = setup(t), courses = e.api.parseSummaryCourses(courseData).courses;
  const states = ['未提交','待重做','待互评','已完成','已互评','待批阅'];
  const parsed = e.api.parseSummaryList(workList(states.map((state,index)=>workRow(index,state)).join('')), 'work', courses, NOW);
  assert.deepEqual(plain(parsed.tasks.map(task=>task.status)), states.slice(0,3));
  assert.equal(parsed.tasks[0].course.name,'完整科目名称'); assert.equal(parsed.tasks[2].kind,'review');
  assert.equal(parsed.tasks[0].remainingUntil,NOW+62*60000); assert.equal(new URL(parsed.tasks[0].url).pathname,'/visit/stucoursemiddle'); assert.equal(parsed.tasks[0].desktopWorkId,'0');
});
test('phone exam links become native desktop instructions and stopped exams stay on the list', t => {
  const e = setup(t), courses = e.api.parseSummaryCourses(courseData).courses;
  const parsed = e.api.parseSummaryList(examList(examRow(9)+examRow(10,'未交','暂停的考试',1)), 'exam', courses, NOW);
  const notes = new URL(parsed.tasks[0].url);
  assert.equal(notes.pathname,'/exam-ans/exam/test/examcode/examnotes'); assert.equal(notes.searchParams.get('examId'),'9'); assert.equal(notes.searchParams.get('cpi'),'7');
  assert.equal(parsed.tasks[1].url,e.urls.examTable); assert.match(parsed.tasks[1].tip,/停止考试/);
});
test('fast refresh uses five summary requests without a per-course crawl, artificial interval or duplicate exams', async t => {
  const e=setup(t),bodies=responses(e),calls=[];
  const report=await e.api.scanPendingTaskSummary({loadText:async url=>{calls.push(url);return bodies[url];}});
  assert.equal(calls.length,5); assert.deepEqual(calls,[e.urls.courses,e.urls.semester,e.urls.work,e.urls.exam,e.urls.examTable]);
  assert.equal(e.clock.timers.size,0); assert.equal(report.source,'summary'); assert.match(report.coverageNotice,/互评/);
  assert.equal(report.courseCount,2); assert.equal(report.tasks.length,2); assert.equal(report.errors.length,0);
  assert.equal(report.tasks.find(task=>task.kind==='exam').deadline,Date.parse('2026-12-27T23:59:00+08:00'));
});
test('term filtering retains unassigned electives while excluding closed, explicitly historical and unmatched courses', async t => {
  const e=setup(t),bodies=responses(e,{[e.urls.work]:workList(workRow(1)+workRow(2,'未提交','closed','','/work?taskrefId=2&courseId=1&clazzId=12')+workRow(3,'未提交','old','','/work?taskrefId=3&courseId=2&clazzId=22')+workRow(4,'未提交','unassigned','','/work?taskrefId=4&courseId=3&clazzId=33')+workRow(5,'未提交','unknown','','/work?taskrefId=5&courseId=999&clazzId=999'))});
  const report=await e.api.scanPendingTaskSummary({loadText:async url=>bodies[url]});
  assert.deepEqual(plain(report.tasks.filter(task=>task.kind==='work').map(task=>task.title)),['作业1','unassigned']);
  assert.equal(report.tasks.find(task=>task.title==='unassigned').course.semesterUnassigned,true);
  assert.ok(report.tasks.every(task=>!task.course.closed)); assert.equal(report.semester.name,'2026-2027第一学期');
});
test('a missing current semester fails before task reads instead of displaying historical courses as current', async t => {
  const e=setup(t),calls=[],bodies=responses(e,{[e.urls.semester]:TERM.replace('20261','20251')});
  const report=await e.api.scanPendingTaskSummary({loadText:async url=>{calls.push(url);return bodies[url];}});
  assert.equal(calls.length,2); assert.equal(report.tasks.length,0); assert.equal(report.errors.length,1); assert.match(report.errors[0].message,/当前学期/);
});
test('PC exam deadlines mark expired exams and a completed result removes a stale pending phone entry', async t => {
  const e=setup(t),bodies=responses(e,{[e.urls.exam]:examList(examRow(9)+examRow(10)),[e.urls.examTable]:examTable(tableRow(9,'未交','已结束','2025-12-27 23:59')+tableRow(10,'已完成'),2)});
  const report=await e.api.scanPendingTaskSummary({loadText:async url=>bodies[url]});
  const exams=report.tasks.filter(task=>task.kind==='exam');assert.equal(exams.length,1);assert.equal(exams[0].state,'expired');assert.equal(exams[0].url,e.urls.examTable);
});
test('exam table pagination uses the native start offset without duplicating phone entries', async t => {
  const e=setup(t),bodies=responses(e,{[e.urls.examTable]:examTable(tableRow(9),2,1),[e.urls.examTable+'&start=1']:examTable(tableRow(10),2,1)}),calls=[];
  const report=await e.api.scanPendingTaskSummary({loadText:async url=>{calls.push(url);return bodies[url];}});
  assert.equal(calls.length,6);assert.ok(calls[5].endsWith('&start=1'));assert.equal(report.errors.length,0);assert.equal(report.tasks.filter(task=>task.kind==='exam').length,2);
});
test('a repeated exam table page remains explicitly incomplete', async t => {
  const e=setup(t),bodies=responses(e,{[e.urls.examTable]:examTable(tableRow(9),2,1)});
  const report=await e.api.scanPendingTaskSummary({loadText:async url=>bodies[url.replace('&start=1','')]});
  assert.equal(report.errors.length,1);assert.match(report.errors[0].message,/分页未切换/);
});
test('failed summaries retain successful sources and never silently launch a full course crawl', async t => {
  const e=setup(t),bodies=responses(e),calls=[];
  const report=await e.api.scanPendingTaskSummary({loadText:async url=>{calls.push(url);if(url===e.urls.work)throw new Error('HTTP 500');return bodies[url];}});
  assert.equal(calls.length,5);assert.equal(report.errors.length,1);assert.ok(report.tasks.some(task=>task.kind==='exam'));
  assert.ok(calls.every(url=>!url.includes('entercoursenewfy')&&!url.includes('/mooc2/work/list')));
});
test('cancelling a summary read stops later requests and releases all timers', async t => {
  const e=setup(t),bodies=responses(e),controller=new AbortController(),calls=[];
  const report=await e.api.scanPendingTaskSummary({signal:controller.signal,loadText:async url=>{calls.push(url);if(url===e.urls.work)controller.abort();return bodies[url];}});
  assert.equal(report.cancelled,true);assert.equal(calls.length,3);assert.equal(report.tasks.length,0);assert.equal(e.clock.timers.size,0);
});
test('native verification stops later summary reads and exposes its original platform URL', async t => {
  const e=setup(t),bodies=responses(e),calls=[];
  const report=await e.api.scanPendingTaskSummary({loadText:async url=>{calls.push(url);return url===e.urls.work?'<title>提示页面</title><p>9010 请输入验证码</p>':bodies[url];}});
  assert.equal(calls.length,3);assert.equal(report.verificationUrl,e.urls.work);assert.equal(report.errors.length,1);
});
test('unknown summary states, unsafe destinations and advertised extra content are reported', t => {
  const e=setup(t),courses=e.api.parseSummaryCourses(courseData).courses;
  const parsed=e.api.parseSummaryList(workList(workRow(1,'新状态')+workRow(2,'未提交','invalid','','javascript:alert(1)')).replace('haveMore="0"','haveMore="1"'),'work',courses);
  assert.equal(parsed.tasks.length,0);assert.equal(parsed.warnings.length,3);
  assert.throws(()=>e.api.parseSummaryList('<p>Loading</p>','work',courses),/未能识别/);
});
test('the panel exposes fast refresh and full recheck separately while always excluding ended courses', async t => {
  const e=setup(t);let fast=0,complete=0;
  const {createPendingTasksPanel}=loadTS('packages/scripts/src/elements/pending.tasks.ts',e.globals,e.stubs);
  const base={tasks:[],courseCount:1,completedCourses:0,pagesRead:3,errors:[],fetchedAt:NOW,cancelled:false};
  const root=createPendingTasksPanel(async()=>{fast++;return {...base,source:'summary',coverageNotice:'当前学期，部分互评请完整补查'};},async()=>{complete++;return {...base,source:'courses',completedCourses:1};});
  e.document.body.append(root);t.after(()=>e.window.dispatchEvent(new e.window.Event('pagehide')));
  const click=name=>[...root.querySelectorAll('button')].find(button=>button.textContent===name).click();
  click('刷新待办');await e.clock.flush();assert.equal(fast,1);assert.equal(complete,0);assert.ok(!root.textContent.includes('部分互评请完整补查'));assert.match(root.querySelector('[role="status"]').textContent,/已读取汇总/);
  assert.ok(!root.textContent.includes('包含已结课课程'));
  click('完整补查');await e.clock.flush();assert.equal(complete,1);assert.match(root.querySelector('[role="status"]').textContent,/1\/1/);
});
test('full recheck uses the same current-term and unassigned-elective scope and never opens ended or historical courses', async t => {
  const e=setup(t),calls=[],opened=[];
  const result=await e.full.scanPendingTasks({courseListUrl:e.urls.semester,loadText:async url=>{
    calls.push(url);const parsed=new URL(url);
    if(parsed.pathname.endsWith('/course'))return TERM;
    if(parsed.pathname.endsWith('/backclazzdata'))return courseData;
    if(parsed.pathname.endsWith('/stucoursemiddle')){
      const id=parsed.searchParams.get('courseid');opened.push(id);assert.ok(['1','3'].includes(id));
      return '<input id="courseid" value="'+id+'"><input id="clazzid" value="'+(id==='1'?'11':'33')+'"><input id="cpi" value="7">';
    }
    throw new Error('Unexpected extra request');
  }});
  assert.equal(result.courseCount,2);assert.equal(result.completedCourses,2);assert.equal(result.errors.length,0);
  assert.equal(calls.length,4);assert.deepEqual(opened,['1','3']);assert.equal(result.semester.id,'20');assert.match(result.coverageNotice,/选修/);
});
test('a passed deadline overrides a stale in-progress label and keeps the link on the exam list', t => {
  const e=setup(t),courses=e.api.parseSummaryCourses(courseData).courses;
  const result=e.api.parseSummaryExamTable(examTable(tableRow(9,'未交','进行中','2025-12-27 23:59'),1),courses,NOW);
  assert.equal(result.tasks[0].state,'expired');assert.equal(result.tasks[0].url,e.urls.examTable);
});
test('current semester follows the school-provided ID rather than date, option order or a selected historic filter', t => {
  const e=setup(t);
  assert.equal(e.full.parseCurrentTaskSemester(TERM).id,'20');
  const spring=TERM.replace('sectionId="20" semesterNum="20261"','sectionId="21" semesterNum="20262"').replace('<option value="99"','<option value="21" semesterNum="20262">2026-2027第二学期</option><option value="99"');
  assert.equal(e.full.parseCurrentTaskSemester(spring).id,'21');
  const custom=TERM.replace('sectionId="20" semesterNum="20261"','sectionId="99" semesterNum="20271"');
  assert.equal(e.full.parseCurrentTaskSemester(custom).id,'99');
  assert.throws(()=>e.full.parseCurrentTaskSemester(TERM.replace(/<div class="spaceBox"[^>]*><\/div>/,'')),/当前学期/);
});
test('numeric zero, string zero, missing and empty term IDs remain eligible without claiming a confirmed semester',t=>{
  const e=setup(t),shared=loadTS('packages/scripts/src/utils/pending-task-courses.ts',e.globals,e.stubs);
  const raw=[courseItem(1,11),courseItem(2,22,0),courseItem(3,33,'0'),courseItem(4,44,null),courseItem(5,55,''),courseItem(6,66,10),courseItem(7,77,99),courseItem(8,88,0,1)];
  const parsed=shared.parseSummaryCourses(JSON.stringify({result:1,hasMore:false,channelList:raw}));
  const selected=shared.selectSemesterTaskCourses(parsed.courses,{id:'20',number:'20261',name:'当前学期'});
  assert.deepEqual(plain(selected.map(course=>course.courseId)),['1','2','3','4','5']);
  assert.equal(selected[0].semesterUnassigned,false);assert.ok(selected.slice(1).every(course=>course.semesterUnassigned));
  assert.ok(selected.every(course=>!course.closed));
});
test('an unassigned elective exam survives both phone and PC metadata merging and keeps its desktop instructions',async t=>{
  const e=setup(t),elective=courseItem(1,11,0,0,'选修课'),bodies=responses(e,{[e.urls.courses]:JSON.stringify({result:1,hasMore:false,channelList:[elective]})});
  const result=await e.api.scanPendingTaskSummary({loadText:async url=>bodies[url]});
  const exam=result.tasks.find(task=>task.kind==='exam');assert.ok(exam);assert.equal(exam.course.name,'选修课');
  assert.equal(exam.course.semesterUnassigned,true);assert.equal(new URL(exam.url).pathname,'/exam-ans/exam/test/examcode/examnotes');
});
test('the panel labels an unassigned elective instead of hiding it or calling it a confirmed current-term enrollment',async t=>{
  const e=setup(t),{createPendingTasksPanel}=loadTS('packages/scripts/src/elements/pending.tasks.ts',e.globals,e.stubs);
  const parsed=e.api.parseSummaryCourses(courseData).courses.find(course=>course.courseId==='3');
  const item={id:'elective',kind:'exam',state:'pending',title:'选修期末考试',course:{...parsed,semesterUnassigned:true},status:'未交',url:e.urls.examTable,timeText:'',tip:'',fetchedAt:NOW};
  const root=createPendingTasksPanel(async()=>({tasks:[item],courseCount:2,completedCourses:0,pagesRead:3,errors:[],fetchedAt:NOW,cancelled:false,source:'summary',coverageNotice:'当前学期及未设置学期的未结课课程（含选修）'}));
  e.document.body.append(root);t.after(()=>e.window.dispatchEvent(new e.window.Event('pagehide')));
  [...root.querySelectorAll('button')].find(node=>node.textContent==='刷新待办').click();await e.clock.flush();
  assert.equal(root.querySelectorAll('.pending-task-row').length,1);assert.match(root.querySelector('.pending-task-meta').textContent,/未设置学期/);
  assert.match(root.querySelector('[role="status"]').textContent,/范围内 2 门课/);
});