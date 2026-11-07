const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Clock, domRuntime, loadTS, plain } = require('./helpers/runtime.cjs');
const ENTRY = 'packages/scripts/src/utils/answer-writer.ts';
const infos = answer => [{ name:'fixture', results:[{ answer, extra_data:{ai:true} }] }];
const delay = async () => {};
function setup(t, html, answer) {
  const env=domRuntime('<div id="q">'+html+'</div>'); t.after(()=>env.window.close());
  const root=env.document.querySelector('#q');
  const options=[...root.querySelectorAll('.option,textarea')];
  return {...env, root, options, ctx:{root,elements:{options},searchInfos:infos(answer),answerMatchMode:'similar'},
    api:loadTS(ENTRY,env.globals)};
}
function choices(type='radio', disabled='') {
  return ['Alpha','Beta','Gamma'].map((text,i)=>`<li><input type="${type}" name="a" id="o${i}" ${disabled}><label class="option" for="o${i}">${text}</label></li>`).join('');
}
test('ordinary choice completion requires the intended checked state, including removal of stale multiple choices',async t=>{
  const e=setup(t,choices('checkbox'),'A#C'); e.root.querySelector('#o1').checked=true;
  assert.equal((await e.api.fillStandardAnswer(e.ctx,'multiple',delay)).finish,true);
  assert.deepEqual([...e.root.querySelectorAll(':checked')].map(el=>el.id),['o0','o2']);
});
test('disabled and no-op choice controls cannot count toward successful completion',async t=>{
  const disabled=setup(t,choices('radio','disabled'),'B');
  assert.equal((await disabled.api.fillStandardAnswer(disabled.ctx,'single',delay)).finish,false);
  const noop=setup(t,choices(),'B'); noop.options[1].addEventListener('click',event=>event.preventDefault());
  await assert.rejects(noop.api.fillStandardAnswer(noop.ctx,'single',delay),/保存完整答案/);
});
test('completion verifies retained literal input and refuses values reverted by the platform',async t=>{
  const e=setup(t,'<textarea></textarea>','<b>literal</b>');
  assert.equal((await e.api.fillStandardAnswer(e.ctx,'completion',delay)).finish,true);
  assert.equal(e.options[0].value,'<b>literal</b>'); assert.equal(e.root.querySelector('b'),null);
  e.options[0].addEventListener('change',()=>{e.options[0].value='old';});
  await assert.rejects(e.api.fillStandardAnswer(e.ctx,'completion',delay),/保存完整答案/);
});
test('detached answer targets and a partially loaded second blank cannot be marked complete',async t=>{
  const e=setup(t,'<textarea></textarea><textarea></textarea>','one#two');
  e.options[1].remove();
  assert.equal((await e.api.fillStandardAnswer(e.ctx,'completion',delay)).finish,false);
  assert.equal(e.options[0].value,'');
});
test('grouped reading choices require every hidden saved value to match the requested answer',async t=>{
  const e=setup(t,'<div class="group"><input name="answer1"><span data="b">B</span></div>','');
  const {fillGroupedChoices}=loadTS('packages/scripts/src/utils/answer-input.ts',e.globals);
  const group=e.root.querySelector('.group');
  assert.equal((await fillGroupedChoices('b',[group],'span[data]',delay)).finish,false);
  group.querySelector('span').onclick=()=>{group.querySelector('input').value='b';};
  assert.equal((await fillGroupedChoices('b',[group],'span[data]',delay)).finish,true);
});
test('pausing within a multiple answer suspends the next write until resume, and the verified writer respects the same pause',async t=>{
  const e=setup(t,choices('checkbox'),'A#B'),clock=new Clock();
  const {CourseWorker}=loadTS('packages/core/src/core/worker/worker.ts',{...e.globals,...clock.globals()},
    {'easy-us':{CommonEventEmitter:EventEmitter,$:{sleep:ms=>new Promise(resolve=>clock.setTimeout(resolve,ms))}}});
  let writes=0,worker,lastUpdate;
  worker=new CourseWorker({root:[e.root],elements:{options:'.option'},thread:1,answerer:async()=>infos('A#B'),
    work:{type:'multiple',handler:async()=>{if(++writes===1)worker.emit('stop');}}});
  const task=worker.doWork(); await clock.advance(500);
  assert.equal(writes,1); assert.equal(worker.isRunning,true);
  worker.emit('continuate'); await clock.advance(200); await task;
  assert.equal(writes,2);
  let stopped=false;
  const ctx={...e.ctx, waitUntilReady:async()=>{while(stopped)await new Promise(resolve=>clock.setTimeout(resolve,100));}};
  let clicks=0;e.options[0].addEventListener('click',()=>{clicks++;stopped=true;});
  const filling=e.api.fillStandardAnswer(ctx,'multiple',delay); await clock.advance(300);
  assert.equal(clicks,1); assert.equal(e.root.querySelector('#o1').checked,false);
  stopped=false; await clock.advance(100); assert.equal((await filling).finish,true);
});
test('failed writes do not increase the chapter upload completion rate',async t=>{
  const e=setup(t,choices('radio','disabled'),'A');
  const {CourseWorker}=loadTS('packages/core/src/core/worker/worker.ts',e.globals,
    {'easy-us':{CommonEventEmitter:EventEmitter,$:{sleep:async()=>{}}}});
  const worker=new CourseWorker({root:[e.root],elements:{options:'.option'},thread:1,answerer:async()=>infos('A'),
    work:ctx=>e.api.fillStandardAnswer(ctx,'single',delay)});
  const results=await worker.doWork(); let observed;
  worker.uploadHandler({results,type:80,callback:(rate,uploadable)=>{observed={rate,uploadable};}});
  assert.deepEqual(observed,{rate:0,uploadable:false});
});

test('stopping a paused worker releases it without performing the second write',async t=>{
  const e=setup(t,choices('checkbox'),'A#B'),clock=new Clock();
  const {CourseWorker}=loadTS('packages/core/src/core/worker/worker.ts',{...e.globals,...clock.globals()},
    {'easy-us':{CommonEventEmitter:EventEmitter,$:{sleep:ms=>new Promise(resolve=>clock.setTimeout(resolve,ms))}}});
  let writes=0,worker,lastUpdate;
  worker=new CourseWorker({root:[e.root],elements:{options:'.option'},thread:1,answerer:async()=>infos('A#B'),
    work:{type:'multiple',handler:async()=>{writes++;worker.emit('stop');}},onResultsUpdate:(_current,_index,results)=>{lastUpdate=results;}});
  const task=worker.doWork();await clock.advance(500);assert.equal(writes,1);
  worker.emit('close');await clock.advance(200);const results=await task;
  assert.equal(writes,1);assert.equal(results[0].result.finish,false);assert.equal(worker.isRunning,false);
  assert.match(results[0].error,/取消/);assert.equal(lastUpdate[0].resolved,true);assert.match(lastUpdate[0].error,/取消/);
});
test('a pause before page navigation can be cancelled without advancing the question',async t=>{
  const e=setup(t,'<button>next</button>',''),clock=new Clock();let paused=true,closed=false,clicks=0;
  const {runQuestionPages}=loadTS('packages/scripts/src/utils/pagination.ts',{...e.globals,...clock.globals()});
  const button=e.root.querySelector('button');button.onclick=()=>clicks++;
  const task=runQuestionPages({closed:()=>closed,identity:()=> 'one',answer:async()=>{},next:()=>button,
    wait:ms=>new Promise(resolve=>clock.setTimeout(resolve,ms)),
    beforeNavigate:async()=>{while(paused&&!closed)await new Promise(resolve=>clock.setTimeout(resolve,100));}});
  await clock.advance(500);assert.equal(clicks,0);closed=true;await clock.advance(200);await task;
  assert.equal(clicks,0);
});


test('two structured AI answer parts cannot be silently pasted into one blank', async t=>{
  const e=setup(t,'<textarea></textarea>','one#two');
  e.ctx.searchInfos[0].results[0].extra_data.answer_parts=['one','two'];
  await assert.rejects(e.api.fillStandardAnswer(e.ctx,'completion',delay),/1.*2/);
  assert.equal(e.options[0].value,'');
});
test('a literal hash in one structured answer remains one editable blank', async t=>{
  const e=setup(t,'<textarea></textarea>','value#literal');
  e.ctx.searchInfos[0].results[0].extra_data.answer_parts=['value#literal'];
  assert.equal((await e.api.fillStandardAnswer(e.ctx,'completion',delay)).finish,true);
  assert.equal(e.options[0].value,'value#literal');
});
test('completion verification compares individual blanks even when their joined text collides', async t=>{
  const e=setup(t,'<textarea></textarea><textarea></textarea>','alpha#beta#gamma');
  e.ctx.searchInfos[0].results[0].extra_data.answer_parts=['alpha#beta','gamma'];
  e.options[1].addEventListener('change',()=>{e.options[0].value='alpha';e.options[1].value='beta#gamma';});
  await assert.rejects(e.api.fillStandardAnswer(e.ctx,'completion',delay),/保存完整答案/);
});
test('an upload control before the editor is not mistaken for a text-answer field', async t=>{
  const e=setup(t,'<div class="blank"><input type="file"><textarea></textarea></div>','answer');
  e.ctx.elements.options=[e.root.querySelector('.blank')];
  assert.equal((await e.api.fillStandardAnswer(e.ctx,'completion',delay)).finish,true);
  assert.equal(e.root.querySelector('textarea').value,'answer');
  assert.equal(e.root.querySelector('input[type=file]').value,'');
});


test('an upload control does not break a textarea and iframe editor pair', async t=>{
  const e=setup(t,'<input type="file"><textarea></textarea><iframe></iframe>','value#literal');
  const body=e.root.querySelector('iframe').contentDocument.body;body.contentEditable='true';
  assert.equal((await e.api.fillStandardAnswer(e.ctx,'completion',delay)).finish,true);
  assert.equal(e.options[0].value,'value#literal');assert.equal(body.textContent,'value#literal');
});
test('sibling blank fields never borrow a shared iframe or each other', async t=>{
  const e=setup(t,'<textarea></textarea><textarea></textarea><iframe></iframe>','first#second');
  const body=e.root.querySelector('iframe').contentDocument.body;body.textContent='unrelated';
  assert.equal((await e.api.fillStandardAnswer(e.ctx,'completion',delay)).finish,true);
  assert.deepEqual(e.options.map(option=>option.value),['first','second']);assert.equal(body.textContent,'unrelated');
});
test('a blank with only an upload control rejects the whole fill before changing earlier answers', async t=>{
  const e=setup(t,'<div class="blank"><textarea></textarea></div><div class="blank"><input type="file"></div>','one#two');
  e.ctx.elements.options=[...e.root.querySelectorAll('.blank')];
  assert.equal((await e.api.fillStandardAnswer(e.ctx,'completion',delay)).finish,false);
  assert.equal(e.root.querySelector('textarea').value,'');
});

test('all stale multiselect choices are validated before clearing any of them', async t => {
  const e = setup(t, choices('checkbox'), 'C');
  e.root.querySelector('#o0').checked = true;
  e.root.querySelector('#o1').checked = true;
  e.root.querySelector('#o1').disabled = true;
  const result = await e.api.fillStandardAnswer(e.ctx, 'multiple', delay);
  assert.equal(result.finish, false);
  assert.deepEqual([...e.root.querySelectorAll(':checked')].map(input => input.id), ['o0', 'o1']);
});
