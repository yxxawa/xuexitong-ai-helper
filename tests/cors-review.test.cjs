const test=require('node:test');
const assert=require('node:assert/strict');
const {Clock,domRuntime,loadTS,storage,plain}=require('./helpers/runtime.cjs');
function corsPage(uid,clock,mem,counter) {
  const win={onload:()=> 'site-handler'},self={};
  const store={list:mem.globals.GM_listValues,get:mem.globals.GM_getValue,set:mem.globals.GM_setValue,
    delete:mem.globals.GM_deleteValue,getTab:async()=>uid,
    addChangeListener:(key,fn)=>mem.globals.GM_addValueChangeListener(key,(_key,pre,curr,remote)=>fn(curr,pre,remote)),
    removeChangeListener:mem.globals.GM_removeValueChangeListener};
  const stubs={'../utils':{$gm:{isInGMContext:()=>true}},
    '../utils/common':{$:{uuid:()=>String(++counter.value).padStart(32,'0')}},
    '../utils/const':{$const:{TAB_UID:'uid'}},'../utils/store':{$store:store}};
  const api=loadTS('vendor/easy-us/lib/interfaces/cors.js',{...clock.globals(),window:win,self,top:self,
    GM_listValues:mem.globals.GM_listValues},stubs);
  return {...api,win};
}
test('opening a second tab preserves an in-flight callback and the site onload handler',async()=>{
  const clock=new Clock(),mem=storage(),counter={value:0};const a=corsPage('a',clock,mem,counter);
  let result,finished=false;
  await a.cors.on('read-results',async()=>{await new Promise(resolve=>clock.setTimeout(resolve,2000));finished=true;return ['expected'];});
  a.cors.emit('read-results',[],value=>{result=value;});await clock.advance(150);
  const keys=[...mem.values.keys()];const b=corsPage('b',clock,mem,counter);
  assert.equal(b.win.onload(),'site-handler');await clock.flush();
  assert.deepEqual([...mem.values.keys()],keys);assert.equal(result,undefined);assert.equal(finished,false);
  await clock.advance(2000);assert.deepEqual(plain(result),['expected']);assert.equal(finished,true);
  assert.equal(mem.values.size,0);assert.equal(clock.timers.size,0);
});
test('deleted or waiting CORS states never invoke success callbacks; abandoned calls time out and clean themselves',async()=>{
  const clock=new Clock(),mem=storage(),a=corsPage('a',clock,mem,{value:0});let called=0,error;
  a.cors.emit('unhandled',[],()=>{called++;},value=>{error=value;});await clock.flush();
  const state=[...mem.values.keys()].find(key=>key.endsWith('.state'));
  mem.globals.GM_setValue(state,0);mem.globals.GM_deleteValue(state);await clock.flush();assert.equal(called,0);
  await clock.advance(30*60*1000);assert.match(error.message,/超时/);assert.equal(called,0);
  assert.equal(mem.values.size,0);assert.equal(clock.timers.size,0);
});
test('concurrent CORS messages each run once, handler failures reject, and off removes scoped listeners',async()=>{
  const clock=new Clock(),mem=storage(),counter={value:0};const receiver=corsPage('a',clock,mem,counter),sender=corsPage('a',clock,mem,counter);
  const seen=[];await receiver.cors.on('queue',async args=>{seen.push(args[0]);await new Promise(resolve=>clock.setTimeout(resolve,100));return args[0];});
  const values=[];for(const n of [1,2,3])sender.cors.emit('queue',[n],value=>values.push(value));
  await clock.advance(500);assert.deepEqual(seen.sort(),[1,2,3]);assert.deepEqual(values.sort(),[1,2,3]);assert.equal(mem.values.size,0);
  await receiver.cors.on('bad',()=>{throw new Error('handler failed');});let error;
  sender.cors.emit('bad',[],()=>assert.fail('unexpected success'),e=>{error=e;});await clock.flush();
  assert.match(error.message,/handler failed/);receiver.cors.off('bad');assert.equal(receiver.cors.eventMap.size,1);
});
const ENTRY='packages/scripts/src/utils/answer-review.ts';
function reviewSetup(t,query) {
  const env=domRuntime(),clock=new Clock(),mem=storage();let released=0;
  const globals={...env.globals,...clock.globals(),...mem.globals};
  const owner=loadTS(ENTRY,globals,{'./web-activity':{acquireWebActivity:async()=>({id:'test',assertActive(){},release(){released++;}})}});
  const client=loadTS(ENTRY,globals);
  const target={available(){},snapshot(){return {question:{title:'Synthetic',type:'single',options:['first','second']},answer:'A'};},
    options(){return {aiProvider:'deepseek-web',aiApiUrl:'',aiApiKey:'',aiModel:'',aiTemperature:0,aiUseResponseFormat:true,aiAnswerTimeout:120};},
    query:(opts,question,control)=>query({opts,question,control,clock,mem}),async apply(){throw new Error('must not auto-apply');},async commit(){throw new Error('must not auto-commit');}};
  const id=owner.registerAnswerReview(env.document.createElement('div'),target);
  t.after(()=>{env.window.dispatchEvent(new env.window.Event('pagehide'));env.window.close();});
  return {...env,clock,mem,owner,client,id,target,get released(){return released;}};
}
test('a 700-second cross-frame web review retains its result and lease rather than timing out at eleven minutes',async t=>{
  const e=reviewSetup(t,async({clock})=>{await new Promise(resolve=>clock.setTimeout(resolve,700000));return [{name:'test',results:[{answer:'A'}]}];});
  let done=false;const task=e.client.requestAnswerReview(e.id,'check').then(value=>{done=true;return value;});
  await e.clock.advance(660500);assert.equal(done,false);assert.equal(e.released,0);
  await e.clock.advance(41000);assert.equal((await task).status,'same');assert.equal(e.released,1);
  assert.equal([...e.mem.values.keys()].filter(key=>key.startsWith('xth.review.request.')).length,0);
  assert.doesNotThrow(()=>e.owner.assertQuestionReviewIdle());
});
test('cancelling a cross-frame review reaches the query, releases the lease and cannot resurrect its mailbox',async t=>{
  let cancelled=false;
  const e=reviewSetup(t,async({clock,control})=>{while(!control.isCancelled())await new Promise(resolve=>clock.setTimeout(resolve,100));cancelled=true;throw new Error('cancelled');});
  const task=e.client.requestAnswerReview(e.id,'check');await e.clock.advance(500);
  e.client.cancelAnswerReview(e.id);await e.clock.advance(500);await task;
  assert.equal(cancelled,true);assert.match(e.client.getAnswerReviewView(e.id).error,/取消/);assert.equal(e.released,1);
  assert.equal(e.mem.values.size,0);assert.doesNotThrow(()=>e.owner.assertQuestionReviewIdle());
  await e.clock.advance(1000);assert.equal(e.mem.values.size,0);
});
test('review services resume after a cached page restore without losing the registered target',async t=>{
  const e=reviewSetup(t,async()=>[{name:'test',results:[{answer:'A'}]}]);
  for(const name of ['pagehide','pageshow']) { const event=new e.window.Event(name);Object.defineProperty(event,'persisted',{value:true});e.window.dispatchEvent(event); }
  const task=e.client.requestAnswerReview(e.id,'check');await e.clock.advance(1000);
  assert.equal((await task).status,'same');assert.equal(e.released,1);
});

test('expired CORS cleanup is scoped to the current tab owner',async()=>{
  const clock=new Clock(),mem=storage(),counter={value:0};
  for(const [uid,id]of [['a','a'.repeat(32)],['b','b'.repeat(32)]]) {
    mem.globals.GM_setValue('_temp_.event.'+id+'.meta',{owner:uid,expiresAt:clock.now-1});
    mem.globals.GM_setValue('_temp_.event.'+id+'.arguments',['old']);
  }
  const a=corsPage('a',clock,mem,counter);await a.cors.on('ready',()=>{});
  assert.deepEqual([...mem.values.keys()].sort(),['_temp_.event.'+'b'.repeat(32)+'.arguments','_temp_.event.'+'b'.repeat(32)+'.meta']);
});
