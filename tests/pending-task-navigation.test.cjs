const test=require('node:test');
const assert=require('node:assert/strict');
const {Clock,domRuntime,loadTS,plain}=require('./helpers/runtime.cjs');
const ENTRY='https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=1&clazzid=11&cpi=7&ismooc2=1';
const LIST='https://mooc1.chaoxing.com/mooc2/work/list';
const PC='https://mooc1.chaoxing.com/mooc-ans/mooc2/work/task?courseId=1&classId=11&cpi=7&workId=9&answerId=42&enc=SIGNED-NATIVE-PC';
function courseHTML(){return '<input id="courseid" value="1"><input id="clazzid" value="11"><input id="cpi" value="7"><input id="workEnc" value="LIST-PC-SIGNATURE"><li dataname="zy"><a data-url="'+LIST+'">作业</a></li>';}
function row(url,title='重复作业名'){return '<li onclick="goTask(this)" data="'+url.replaceAll('&','&amp;')+'"><div class="right-content"><p>'+title+'</p><p class="status">未交</p></div></li>';}
function listHTML(rows,pages=1){return '<input id="status" value="0"><input id="topicId" value="topic-fixture"><div class="bottomList"><ul>'+rows+'</ul></div><script>({pageNum:'+pages+'})</script>';}
function task(changes={}){return {id:'task-9',desktopWorkId:'9',kind:'work',state:'pending',title:'重复作业名',course:{key:'1:11:7',name:'当前科目',url:ENTRY,closed:false},status:'未提交',url:ENTRY,timeText:'',tip:'',fetchedAt:100000,...changes};}
function setup(t){
 const env=domRuntime('', 'https://i.chaoxing.com/base');t.after(()=>env.window.close());const clock=new Clock();
 env.window.Element.prototype.replaceChildren=function(...nodes){while(this.firstChild)this.removeChild(this.firstChild);this.append(...nodes);};
 const globals={...env.globals,...clock.globals(),DOMParser:env.window.DOMParser,MutationObserver:env.window.MutationObserver,AbortController,queueMicrotask};
 const stubs={'@xuexitong-ai-helper/core/src/core/utils/request':{request(){throw new Error('Unexpected live request');}}};
 const full=loadTS('packages/scripts/src/utils/pending-tasks.ts',globals,stubs);
 const api=loadTS('packages/scripts/src/utils/pending-task-navigation.ts',globals,{...stubs,'./pending-tasks':full});
 return {...env,clock,globals,stubs,full,api};
}
test('opening a summary work reads the native PC list and returns its exact signed link by ID rather than title',async t=>{
 const e=setup(t),calls=[];
 const wrong=PC.replace('workId=9','workId=8');
 const result=await e.api.resolveDesktopTaskURL(task(),{loadText:async url=>{calls.push(url);return calls.length===1?courseHTML():listHTML(row(wrong)+row(PC));}});
 assert.equal(result,PC);assert.equal(calls.length,2);assert.equal(calls[0],ENTRY);
 const list=new URL(calls[1]);assert.equal(list.pathname,'/mooc2/work/list');assert.equal(list.searchParams.get('enc'),'LIST-PC-SIGNATURE');
 assert.ok(calls.every(url=>!/(?:android|phone)/.test(new URL(url).pathname)));
});
test('pagination locates older work and preserves native answer IDs and signatures',async t=>{
 const e=setup(t),calls=[];
 const result=await e.api.resolveDesktopTaskURL(task(),{loadText:async url=>{calls.push(url);if(calls.length===1)return courseHTML();return calls.length===2?listHTML(row(PC.replace('workId=9','workId=8')),2):listHTML(row(PC),2);}});
 assert.equal(result,PC);assert.equal(calls.length,3);const url=new URL(calls[2]);
 assert.equal(url.pathname,'/mooc-ans/mooc2/work/list');assert.equal(url.searchParams.get('pageNum'),'2');assert.equal(url.searchParams.get('status'),'0');assert.equal(url.searchParams.get('topicId'),'topic-fixture');
});
test('a desktop task obtained by full recheck remains a direct link without extra reads',async t=>{
 const e=setup(t);assert.equal(await e.api.resolveDesktopTaskURL(task({url:PC,desktopWorkId:undefined}),{loadText(){assert.fail('No extra lookup');}}),PC);
});
test('a same-number task in another course or class is never selected',async t=>{
 const e=setup(t);let calls=0;
 await assert.rejects(e.api.resolveDesktopTaskURL(task(),{loadText:async()=>++calls===1?courseHTML():listHTML(row(PC.replace('courseId=1','courseId=2'))+row(PC.replace('classId=11','classId=22')))}),/未在电脑端列表找到/);
});
test('two answer records with one task number are treated as ambiguous instead of guessing',async t=>{
 const e=setup(t);let calls=0;
 await assert.rejects(e.api.resolveDesktopTaskURL(task(),{loadText:async()=>++calls===1?courseHTML():listHTML(row(PC)+row(PC.replace('answerId=42','answerId=43')))}),/多个电脑端入口/);
});
test('mobile, unsafe and missing work links do not become an invented PC task URL',async t=>{
 const e=setup(t);let calls=0;
 await assert.rejects(e.api.resolveDesktopTaskURL(task(),{loadText:async()=>++calls===1?courseHTML():listHTML(row('https://mooc1.chaoxing.com/work/phone/doHomeWork?courseId=1&classId=11&workId=9')+row('javascript:alert(1)'))}),/未在电脑端列表找到/);
 await assert.rejects(e.api.resolveDesktopTaskURL(task({desktopWorkId:'invalid'})),/编号无效/);
});
test('native verification halts before reading more pages or navigating to mobile',async t=>{
 const e=setup(t),calls=[];
 await assert.rejects(e.api.resolveDesktopTaskURL(task(),{loadText:async url=>{calls.push(url);return '<title>提示页面</title><p>9010 请输入图片验证码</p>';}}),/验证码/);
 assert.deepEqual(calls,[ENTRY]);
});
test('cancelling an in-flight desktop lookup prevents its response from triggering the next read',async t=>{
 const e=setup(t),controller=new AbortController(),calls=[];
 await assert.rejects(e.api.resolveDesktopTaskURL(task(),{signal:controller.signal,loadText:async url=>{calls.push(url);controller.abort();return courseHTML();}}),/取消/);
 assert.equal(calls.length,1);assert.equal(e.clock.timers.size,0);
});
test('a repeated list page is reported rather than looping through unrelated pages',async t=>{
 const e=setup(t);let count=0;
 await assert.rejects(e.api.resolveDesktopTaskURL(task(),{loadText:async()=>++count===1?courseHTML():listHTML(row(PC.replace('workId=9','workId=8')),3)}),/分页没有切换/);
 assert.equal(count,3);
});
function panel(t,resolver,options={}){
 const e=setup(t),popups=[],resolved=[];
 e.window.open=()=>{if(options.blocked)return null;const popup={closed:false,opener:{},document:e.document.implementation.createHTMLDocument(''),location:{replace:url=>resolved.push(url)},close(){this.closed=true;}};popups.push(popup);return popup;};
 const {createPendingTasksPanel}=loadTS('packages/scripts/src/elements/pending.tasks.ts',e.globals,{...e.stubs,'../utils/pending-tasks':e.full,'../utils/pending-task-navigation':{resolveDesktopTaskURL:resolver}});
 const root=createPendingTasksPanel(async()=>({tasks:[task()],courseCount:1,completedCourses:1,pagesRead:1,errors:[],fetchedAt:100000,cancelled:false}));
 e.document.body.append(root);t.after(()=>e.window.dispatchEvent(new e.window.Event('pagehide')));
 [...root.querySelectorAll('button')].find(node=>node.textContent==='刷新待办').click();
 return {...e,root,popups,resolved};
}
test('both task title and action share one PC lookup, and refreshing the list never looks up individual links',async t=>{
 let finish,calls=0;const e=panel(t,()=>{calls++;return new Promise(resolve=>{finish=resolve;});});await e.clock.flush();
 assert.equal(calls,0);for(const link of e.root.querySelectorAll('.pending-task-title,.pending-task-open'))assert.equal(link.getAttribute('href'),ENTRY);
 e.root.querySelector('.pending-task-title').click();e.root.querySelector('.pending-task-open').click();await e.clock.flush();
 assert.equal(calls,1);assert.equal(e.popups.length,1);assert.equal(e.popups[0].opener,null);
 finish(PC);await e.clock.flush();assert.deepEqual(e.resolved,[PC]);
});
test('a blocked popup does not send lookup requests or fall through to an Android URL',async t=>{
 let calls=0;const e=panel(t,async()=>{calls++;return PC;},{blocked:true});await e.clock.flush();e.root.querySelector('.pending-task-open').click();await e.clock.flush();
 assert.equal(calls,0);assert.equal(e.resolved.length,0);assert.match(e.root.textContent,/浏览器阻止/);
});
test('failed desktop lookup leaves a readable error and native course fallback',async t=>{
 const e=panel(t,async()=>{throw new Error('未找到作业');});await e.clock.flush();e.root.querySelector('.pending-task-open').click();await e.clock.flush();
 assert.match(e.root.textContent,/未找到作业/);assert.equal(e.resolved.length,0);assert.equal(e.popups[0].document.querySelector('a').href,ENTRY);
});
test('leaving the panel aborts pending lookup and closes only its waiting tab',async t=>{
 let signal;const e=panel(t,(task,options)=>{signal=options.signal;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));});
 await e.clock.flush();e.root.querySelector('.pending-task-title').click();await e.clock.flush();e.root.remove();await e.clock.flush();
 assert.equal(signal.aborted,true);assert.equal(e.popups[0].closed,true);assert.equal(e.resolved.length,0);assert.equal(e.clock.timers.size,0);
});