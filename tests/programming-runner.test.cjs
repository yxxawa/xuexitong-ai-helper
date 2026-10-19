const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Clock, domRuntime, loadTS, plain } = require('./helpers/runtime.cjs');
const ENTRY = 'packages/scripts/src/utils/programming-runner.ts';
const infos = answer => [{name:'fixture',results:[{question:'program',answer}]}];
const good = {passed:true,output:'全部测试用例通过'};
const bad = {passed:false,output:'NameError: name "value" is not defined\n第 1/1 条运行失败'};
function setup(t, outcomes=[good], options={}) {
  const env=domRuntime('<div class="questionLi" id="q1"><h3>程序题</h3><input id="answertype1" value="17" type="hidden">'+
    '<input id="answer1" type="hidden"><input class="languageSelect" value="16" type="hidden">'+
    '<textarea class="code-editor" data-business-id="1"></textarea><div class="CodeMirror"><textarea></textarea></div>'+
    '<a id="runBtn">运行</a><span id="runstatus" style="display:none">正在运行程序</span><div id="output"></div></div>',
    'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork');
  t.after(()=>env.window.close());const clock=new Clock();const globals={...env.globals,...clock.globals()};
  const root=env.document.querySelector('#q1'),wrapper=root.querySelector('.CodeMirror'),backing=root.querySelector('.code-editor');
  const button=root.querySelector('#runBtn'),output=root.querySelector('#output'),status=root.querySelector('#runstatus');
  let value='',signal=false;const calls=[];
  const editor={getValue:()=>value,getOption:()=>false,getTextArea:()=>backing,getWrapperElement:()=>wrapper,
    setValue(next){value=next;signal=false;button.className='';},replaceSelection(next){value+=next;},save(){backing.value=value;}};
  wrapper.CodeMirror=editor;env.window.codeEditors={1:editor};
  const render=(outcome)=>{output.innerHTML='';for(const text of ['第 1/1 条运行结果',outcome.output]){
    const area=env.document.createElement('textarea');area.className='runResult '+(outcome.passed?'result_right':'result_wrong');area.value=text;output.append(area);}};
  if(options.initial)render(options.initial);
  button.onclick=()=>{if(signal)return;calls.push(editor.getValue());button.className='jb_btn_92_disable';status.style.display='inline';
    const outcome=outcomes[calls.length-1];clock.setTimeout(()=>{if(outcome)render(outcome);status.style.display='none';signal=true;},options.delay??10);};
  const ctx={root,elements:{options:[]},type:'programming',searchInfos:infos('print(value)\n'),answerMatchMode:'similar'};
  const api=loadTS(ENTRY,globals);const writer=loadTS('packages/scripts/src/utils/answer-writer.ts',globals);
  return {...env,clock,globals,root,wrapper,backing,button,output,status,editor,calls,ctx,api,writer,render};
}
function capture(promise){const result={done:false};result.promise=promise.then(value=>{result.done=true;result.value=value;},error=>{result.done=true;result.error=error;});return result;}
const question={title:'输入一个整数并输出它\n编程语言：Python 3.6.9',type:'programming',options:[],imageUrls:['https://example.test/question.png'],hasImage:true};

test('a run waits for fresh native results and records success only for the tested code and language',async t=>{
  const e=setup(t);await e.writer.fillProgrammingAnswer(e.ctx);
  const task=e.api.runProgrammingAnswer(e.root,e.editor.getValue(),{timeoutMs:500,pollMs:5});
  await e.clock.advance(50);const result=await task;
  assert.equal(result.passed,true);assert.equal(e.calls.length,1);assert.match(result.output,/全部测试/);
  assert.equal(e.api.programmingRunWasPassed(e.root,e.editor.getValue()),true);
  e.root.querySelector('.languageSelect').value='2';assert.equal(e.api.programmingRunWasPassed(e.root,e.editor.getValue()),false);
  assert.equal(e.clock.timers.size,0);
});
test('a stale green result is never accepted when this run produces no output',async t=>{
  const e=setup(t,[undefined],{initial:good});await e.writer.fillProgrammingAnswer(e.ctx);
  const task=e.api.runProgrammingAnswer(e.root,e.editor.getValue(),{timeoutMs:50,pollMs:5});
  await e.clock.advance(100);const result=await task;
  assert.equal(result.passed,false);assert.equal(result.retryable,false);assert.match(result.output,/超时/);
});
test('identical repeated errors are fresh when the native page replaces result nodes',async t=>{
  const e=setup(t,[bad],{initial:bad});await e.writer.fillProgrammingAnswer(e.ctx);
  const task=e.api.runProgrammingAnswer(e.root,e.editor.getValue(),{timeoutMs:100,pollMs:5});
  await e.clock.advance(100);const result=await task;
  assert.equal(result.passed,false);assert.equal(result.retryable,true);assert.match(result.output,/NameError/);
});
test('one failed run sends original question, current answer and full output to correction and succeeds on run two',async t=>{
  const e=setup(t,[bad,good]);const corrections=[],passed=[],failed=[],progress=[];
  const task=e.api.answerProgrammingQuestion(e.ctx,{question,correct:async payload=>{corrections.push(plain(payload));return infos('print(1)\n');},
    onPassed:answer=>passed.push(plain(answer)),onFailed:()=>failed.push(true),onProgress:(message,state)=>progress.push(state)});
  await e.clock.advance(1000);const result=await task;
  assert.equal(result.finish,true);assert.equal(result.programmingAttempts,2);
  assert.deepEqual(e.calls,['print(value)\n','print(1)\n']);assert.equal(corrections.length,1);
  assert.equal(corrections[0].title,question.title);assert.deepEqual(corrections[0].imageUrls,question.imageUrls);
  assert.equal(corrections[0].programmingFeedback.answer,'print(value)\n');assert.match(corrections[0].programmingFeedback.output,/NameError/);
  assert.equal(corrections[0].programmingFeedback.attempt,1);assert.equal(corrections[0].programmingFeedback.maxAttempts,3);
  assert.equal(passed[0][0].results[0].answer,'print(1)\n');assert.equal(failed.length,0);assert.ok(progress.includes('correcting'));
  assert.equal(e.ctx.searchInfos[0].results[0].extra_data.programming_run.attempts.length,2);
});
test('three failures mean exactly three button clicks, two correction requests, no cached success and an explicit skip',async t=>{
  const e=setup(t,[bad,bad,bad,good]);let corrections=0,passed=0,failed=0;
  const task=e.api.answerProgrammingQuestion(e.ctx,{question,correct:async()=>infos('print('+ ++corrections +')\n'),
    onPassed:()=>passed++,onFailed:()=>failed++});
  await e.clock.advance(2000);const result=await task;
  assert.equal(result.finish,false);assert.equal(result.skipped,true);assert.equal(result.programmingAttempts,3);
  assert.match(result.error,/3 次仍未通过/);assert.equal(e.calls.length,3);assert.equal(corrections,2);assert.equal(passed,0);assert.equal(failed,1);
  assert.equal(e.api.programmingRunWasPassed(e.root,e.editor.getValue()),false);
});
test('the same corrected source can be run again and cannot revive a prior run result',async t=>{
  const e=setup(t,[bad,bad,good]);let corrections=0;
  const task=e.api.answerProgrammingQuestion(e.ctx,{question,correct:async()=>{corrections++;return infos('print(value)\n');}});
  await e.clock.advance(2000);const result=await task;
  assert.equal(result.finish,true);assert.equal(e.calls.length,3);assert.equal(corrections,2);
});
test('unavailable runtime and empty correction answers skip without extra runs or completion',async t=>{
  const e=setup(t);let corrections=0;e.button.remove();
  const task=e.api.answerProgrammingQuestion(e.ctx,{question,correct:async()=>{corrections++;return infos('print(1)');}});
  await e.clock.advance(100);const result=await task;assert.equal(result.finish,false);assert.equal(result.skipped,true);assert.equal(corrections,0);
  const f=setup(t,[bad]);const other=f.api.answerProgrammingQuestion(f.ctx,{question,correct:async()=>[{name:'error',results:[],error:'model unavailable'}]});
  await f.clock.advance(1000);const skipped=await other;assert.equal(skipped.finish,false);assert.equal(f.calls.length,1);assert.match(skipped.error,/未返回可用/);
});
test('a pause during a run defers correction until resume and does not consume the wait budget',async t=>{
  const e=setup(t,[bad,good]);let paused=false,corrections=0;
  e.ctx.isPaused=()=>paused;e.clock.setTimeout(()=>{paused=true;},2);
  const state=capture(e.api.answerProgrammingQuestion(e.ctx,{question,correct:async()=>{corrections++;return infos('print(1)\n');}}));
  await e.clock.advance(5000);assert.equal(state.done,false);assert.equal(corrections,0);assert.equal(e.calls.length,1);
  paused=false;await e.clock.advance(1000);await state.promise;assert.equal(state.value.finish,true);assert.equal(corrections,1);
});
test('cancelling a paused question makes no write, run or correction request',async t=>{
  const e=setup(t);let cancelled=false,calls=0;e.ctx.isPaused=()=>true;e.ctx.isCancelled=()=>cancelled;
  const state=capture(e.api.answerProgrammingQuestion(e.ctx,{question,correct:async()=>{calls++;return infos('print(1)');}}));
  await e.clock.advance(200);cancelled=true;await e.clock.advance(200);await state.promise;
  assert.match(state.error.message,/取消/);assert.equal(e.editor.getValue(),'');assert.equal(e.calls.length,0);assert.equal(calls,0);
});
test('manual edits while AI is correcting are never overwritten by the old task',async t=>{
  const e=setup(t,[bad]);const state=capture(e.api.answerProgrammingQuestion(e.ctx,{question,correct:()=>new Promise(resolve=>{
    e.clock.setTimeout(()=>{e.editor.setValue('print("manual")');resolve(infos('print("AI")'));},20);
  })}));
  await e.clock.advance(1000);await state.promise;assert.match(state.error.message,/代码已变化/);
  assert.equal(e.editor.getValue(),'print("manual")');assert.equal(e.calls.length,1);
});
test('an active run stops after the source or the question node changes',async t=>{
  const e=setup(t,[good],{delay:100});await e.writer.fillProgrammingAnswer(e.ctx);
  const state=capture(e.api.runProgrammingAnswer(e.root,e.editor.getValue(),{timeoutMs:200,pollMs:5}));
  e.clock.setTimeout(()=>e.root.remove(),10);await e.clock.advance(200);await state.promise;
  assert.match(state.error.message,/已变化/);assert.equal(e.api.programmingRunWasPassed(e.root,'print(value)\n'),false);
});
test('a failed program does not stop the worker from answering the next question, and source whitespace survives the worker',async t=>{
  const e=setup(t,[bad,bad,bad]);const next=e.document.createElement('div');next.innerHTML='<h3>next</h3>';e.document.body.append(next);
  const {CourseWorker}=loadTS('packages/core/src/core/worker/worker.ts',e.globals,
    {'easy-us':{CommonEventEmitter:EventEmitter,$:{sleep:async()=>{}}}});
  let corrections=0;const source='  print(value)\n';
  const worker=new CourseWorker({root:[e.root,next],elements:{title:'h3',options:'.CodeMirror'},thread:1,
    readAnswer:ctx=>{ctx.type='programming';},answerer:async()=>infos(source),
    work:ctx=>ctx.root===e.root?e.api.answerProgrammingQuestion(ctx,{question,correct:async()=>{corrections++;return infos(source);}}):{finish:true}});
  const task=worker.doWork();await e.clock.advance(2000);const results=await task;
  assert.equal(results[0].result.finish,false);assert.match(results[0].error,/3 次仍未通过/);
  assert.equal(results[1].result.finish,true);assert.equal(e.calls[0],source);assert.equal(corrections,2);assert.equal(worker.isRunning,false);
});
test('program answers enter cache only after verified success; removing one failed program keeps unrelated entries',async t=>{
  const e=setup(t);const entries=[];const {QuestionAnswerCache}=loadTS('packages/scripts/src/utils/answer-cache.ts',e.globals,
    {'./web-ai':{getWebBridgeState:()=>undefined}});
  const cache=new QuestionAnswerCache({get:()=>entries,set:value=>entries.splice(0,entries.length,...plain(value)),enabled:()=>true});
  const opts={aiApiUrl:'https://example.test/v1',aiApiKey:'fixture',aiModel:'fixture',aiTemperature:0,aiUseResponseFormat:false};
  await cache.search(opts,question,async()=>infos('bad source'));assert.equal(entries.length,0);
  cache.replaceAnswer(opts,question,infos('passed source'));assert.equal(entries.length,1);
  await cache.search(opts,{title:'ordinary',type:'single'},async()=>infos('A'));assert.equal(entries.length,2);
  cache.removeAnswer(opts,question);assert.equal(entries.length,1);assert.equal(entries[0].answer,'A');
});
