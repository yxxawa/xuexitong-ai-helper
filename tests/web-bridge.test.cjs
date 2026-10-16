const test=require('node:test');
const assert=require('node:assert/strict');
const {Clock,domRuntime,loadTS,storage,plain}=require('./helpers/runtime.cjs');
const ENTRY='packages/scripts/src/utils/web-ai.ts';
const STATE='xth.web.bridge.v1';
const PREFIX='xth.web.request.v1.';
function capture(promise){const state={done:false};state.promise=promise.then(value=>{state.done=true;state.value=value;},error=>{state.done=true;state.error=error;});return state;}
async function setup(t,options={}) {
  const env=domRuntime();const clock=new Clock();const mem=storage();
  const globals={...env.globals,...clock.globals(),...mem.globals};
  const bridge=loadTS(ENTRY,globals),activities=loadTS('packages/scripts/src/utils/web-activity.ts',globals);
  const calls=[],answers=new Map();let resets=0;
  const adapter={
    id:'deepseek-web',supportsImages:true,assertEmpty(){},assertReady(){},
    async submit(prompt,cancelled,images,id){
      const call={prompt,id,at:clock.now};calls.push(call);
      if(options.onSubmit)await options.onSubmit({clock,mem,call,cancelled});
      answers.set(id,JSON.stringify({_bridge_id:id,answer:'A',answers:['A'],solution:''}));
    },
    readCompleted(id){
      if(options.rateLimit && !options.delay)return;
      const call=calls.find(c=>c.id===id);
      if(call && clock.now-call.at>=(options.delay||0))return answers.get(id);
    },
    retryRateLimited(id,cancelled){
      const call=calls.find(c=>c.id===id);
      if(cancelled()||!call)return;
      if(options.rateLimit && clock.now-call.at<(options.delay||Infinity))
        return {attempts:Math.floor((clock.now-call.at)/3000),nextRetryAt:clock.now+3000};
    },
    reset(){resets++;}
  };
  bridge.startDeepSeekBridge(adapter);
  env.document.dispatchEvent(new env.window.Event('DOMContentLoaded'));
  const host=env.document.getElementById('xth-deepseek-bridge');
  assert.ok(host);
  const toggle=host.shadowRoot.querySelector('button');toggle.click();
  await clock.advance(150);
  assert.equal(bridge.getWebBridgeState().status,'ready');
  t.after(()=>{env.window.dispatchEvent(new env.window.Event('pagehide'));env.window.close();});
  return {...env,clock,mem,bridge,activities,calls,toggle,host,adapter,get resets(){return resets;}};
}

test('storage wakeup services requests immediately, without waiting for the one-second timer',async t=>{
  const e=await setup(t);
  const task=capture(e.bridge.requestWebAnswer('test',30));
  await e.clock.flush();
  assert.equal(e.calls.length,1);
  assert.ok(e.calls[0].prompt.includes(e.calls[0].id));
  assert.equal(e.bridge.getWebBridgeState().status,'busy');
  await e.clock.advance(2000);
  assert.equal(task.done,true);assert.equal(task.error,undefined);assert.equal(JSON.parse(task.value).answer,'A');
  assert.equal(e.bridge.getWebBridgeState().status,'ready');
  assert.equal([...e.mem.values.keys()].filter(k=>k.startsWith(PREFIX)).length,0);
});
test('native rate retries keep the bridge connected and extend the request budget past its normal timeout',async t=>{
  const e=await setup(t,{rateLimit:true,delay:45000});
  const task=capture(e.bridge.requestWebAnswer('rate-limited question',30));
  await e.clock.advance(35000);
  assert.equal(task.done,false);assert.equal(e.bridge.getWebBridgeState().status,'busy');
  const request=[...e.mem.values.entries()].find(([k])=>k.startsWith(PREFIX))[1];
  assert.ok(request.deadlineAt>=request.startedAt+630000);
  assert.ok(request.rateLimitRetries>=10);
  assert.equal(request.prompt,undefined);assert.equal(request.images,undefined);
  assert.match(e.host.shadowRoot.querySelector('[role="status"]').textContent,/每 3 秒/);
  await e.clock.advance(14000);
  assert.equal(task.done,true);assert.equal(task.error,undefined);assert.equal(JSON.parse(task.value).answer,'A');
  assert.equal(e.calls.length,1);assert.equal(e.bridge.getWebBridgeState().status,'ready');
  assert.equal(e.mem.writes.filter(x=>x.key===STATE&&x.value.status==='disabled').length,0);
});
test('reserving the whole retry budget avoids a caller timing out during a background receiver timer gap',async t=>{
  const e=await setup(t,{rateLimit:true,delay:90000});
  const task=capture(e.bridge.requestWebAnswer('background rate limit',30));
  await e.clock.advance(300);
  const request=[...e.mem.values.entries()].find(([k])=>k.startsWith(PREFIX))[1];
  assert.equal(request.deadlineAt-request.startedAt,630000);
  await e.clock.advance(93000);
  assert.equal(task.done,true);assert.equal(task.error,undefined);assert.equal(e.calls.length,1);
});
test('a successful retry can be followed by another question in the same conversation',async t=>{
  const e=await setup(t,{rateLimit:true,delay:5000});
  const first=capture(e.bridge.requestWebAnswer('one',30));await e.clock.advance(7500);
  assert.equal(first.done,true);assert.equal(first.error,undefined);
  const second=capture(e.bridge.requestWebAnswer('two',30));await e.clock.advance(7500);
  assert.equal(second.done,true);assert.equal(second.error,undefined);
  assert.equal(e.calls.length,2);assert.equal(e.resets,0);
  assert.equal(e.bridge.getWebBridgeState().conversationUses,2);
});
test('user stop cancels a rate-limited request and does not resurrect or re-send it',async t=>{
  const e=await setup(t,{rateLimit:true,delay:60000});
  const task=capture(e.bridge.requestWebAnswer('stop this',30));await e.clock.advance(3500);
  e.toggle.click();await e.clock.advance(1000);
  assert.equal(task.done,true);assert.match(task.error.message,/停止|取消|中断/);
  assert.equal(e.bridge.getWebBridgeState(),undefined);
  await e.clock.advance(9000);
  assert.equal(e.calls.length,1);assert.equal([...e.mem.values.keys()].filter(k=>k.startsWith(PREFIX)).length,0);
});
test('cancellation during asynchronous submit/upload cannot re-create a deleted mailbox',async t=>{
  const e=await setup(t,{onSubmit:async({clock})=>new Promise(resolve=>clock.setTimeout(resolve,5000))});
  const task=capture(e.bridge.requestWebAnswer('upload pending',30));await e.clock.advance(500);
  e.toggle.click();await e.clock.advance(6500);
  assert.equal(task.done,true);assert.ok(task.error);
  assert.equal([...e.mem.values.keys()].filter(k=>k.startsWith(PREFIX)).length,0);
  assert.equal(e.calls.length,1);
});
test('persistent limits stop at the bounded extra wait budget, never an infinite retry loop',async t=>{
  const e=await setup(t,{rateLimit:true});
  const task=capture(e.bridge.requestWebAnswer('always limited',30));
  await e.clock.advance(633000);
  assert.equal(task.done,true);assert.ok(task.error);assert.match(task.error.message,/上限/);
  assert.equal(e.calls.length,1);assert.equal(e.bridge.getWebBridgeState(),undefined);
  assert.equal([...e.mem.values.keys()].filter(k=>k.startsWith(PREFIX)).length,0);
});
test('non-rate-limited requests retain their original timeout',async t=>{
  const e=await setup(t,{delay:60000});
  const task=capture(e.bridge.requestWebAnswer('slow response',30));await e.clock.advance(32000);
  assert.equal(task.done,true);assert.ok(task.error);assert.match(task.error.message,/超时/);
  assert.equal(e.calls.length,1);
});
test('one minute of background heartbeat delay is not a disconnect; genuinely stale leases still expire',()=>{
  const clock=new Clock(500000),mem=storage();
  const bridge=loadTS(ENTRY,{...clock.globals(),...mem.globals});
  mem.values.set(STATE,{id:'bridge',provider:'deepseek-web',instance:'tab',status:'ready',updatedAt:clock.now-65000});
  assert.equal(bridge.getWebBridgeState().id,'bridge');
  mem.values.get(STATE).updatedAt=clock.now-180001;
  assert.equal(bridge.getWebBridgeState(),undefined);
  mem.values.get(STATE).updatedAt=clock.now;mem.values.get(STATE).status='disabled';
  assert.equal(bridge.getWebBridgeState(),undefined);
});
test('activity grants also use storage wakeup and reject a concurrent search/work activity',async t=>{
  const e=await setup(t);
  const leaseState=capture(e.activities.acquireWebActivity('work'));
  await e.clock.advance(100);
  assert.equal(leaseState.done,true);assert.equal(leaseState.error,undefined);
  const lease=leaseState.value;assert.equal(e.activities.getWebActivity().id,lease.id);
  await assert.rejects(e.activities.acquireWebActivity('search'),/正在自动答题/);
  lease.release();
  assert.equal(e.activities.getWebActivity(),undefined);
});
test('background-delayed activity renewal does not lose its mutex',()=>{
  const clock=new Clock(500000),mem=storage();
  const api=loadTS('packages/scripts/src/utils/web-activity.ts',{...clock.globals(),...mem.globals});
  const active={id:'task',bridgeId:'bridge',kind:'work'};
  mem.values.set(STATE,{id:'bridge',status:'busy',updatedAt:clock.now-65000,supportsActivities:true});
  mem.values.set('xth.web.activity.v1',active);
  mem.values.set('xth.web.activity.request.v1.task',{...active,status:'granted',createdAt:clock.now-120000,updatedAt:clock.now-65000});
  assert.equal(api.getWebActivity().id,'task');
  assert.throws(()=>api.assertWebActivity('different-task'),/正在自动答题/);
});
test('50 successful requests still rotate the conversation exactly once',async t=>{
  const e=await setup(t);
  for(let i=0;i<50;i++){
    const task=capture(e.bridge.requestWebAnswer('question '+i,30));
    await e.clock.advance(2200);
    assert.equal(task.done,true,'request '+i);assert.equal(task.error,undefined);
  }
  assert.equal(e.calls.length,50);assert.equal(e.resets,1);
  assert.equal(e.bridge.getWebBridgeState().status,'reloading');
});

test('pausing the question owner stops native retry attempts and preserves the remaining request budget until resume',async t=>{
  const e=await setup(t,{rateLimit:true,delay:45000});let paused=false,retries=0;
  const retry=e.adapter.retryRateLimited;e.adapter.retryRateLimited=(...args)=>{retries++;return retry(...args);};
  const task=capture(e.bridge.requestWebAnswer('pause long retry',30,[],undefined,{isPaused:()=>paused}));
  await e.clock.advance(3000);paused=true;await e.clock.advance(700);
  const before=retries;await e.clock.advance(1900000);
  assert.equal(retries,before);assert.equal(task.done,false);assert.equal(e.calls.length,1);
  paused=false;await e.clock.advance(2500);
  assert.equal(task.done,true);assert.equal(task.error,undefined);assert.equal(e.calls.length,1);
});
test('owner cancellation during upload removes the mailbox and stops all retries without re-sending',async t=>{
  const e=await setup(t,{onSubmit:async({clock})=>{await new Promise(resolve=>clock.setTimeout(resolve,1500));}});
  let cancelled=false;const task=capture(e.bridge.requestWebAnswer('cancel upload',30,[],undefined,{isCancelled:()=>cancelled}));
  await e.clock.advance(500);cancelled=true;await e.clock.advance(2500);
  assert.equal(task.done,true);assert.match(task.error.message,/取消/);assert.equal(e.calls.length,1);
  assert.equal([...e.mem.values.keys()].filter(key=>key.startsWith(PREFIX)).length,0);
  await e.clock.advance(1000);assert.equal(e.calls.length,1);
});
test('repeated cached page restores reinstall bridge heartbeat and storage wakeups exactly once',async t=>{
  const e=await setup(t);
  for(let i=0;i<2;i++) {
    for(const name of ['pagehide','pageshow']) {const event=new e.window.Event(name);Object.defineProperty(event,'persisted',{value:true});e.window.dispatchEvent(event);}
    assert.equal(e.bridge.getWebBridgeState(),undefined);
    e.toggle.click();await e.clock.advance(150);const updated=e.bridge.getWebBridgeState().updatedAt;
    await e.clock.advance(181000);assert.ok(e.bridge.getWebBridgeState().updatedAt>updated);
    const task=capture(e.bridge.requestWebAnswer('restored '+i,30));await e.clock.advance(2000);
    assert.equal(task.done,true);assert.equal(task.error,undefined);
  }
  assert.equal(e.calls.length,2);
});

test('a task requiring pause support asks to refresh an older receiver before sending anything',async t=>{
  const e=await setup(t);const state=e.mem.globals.GM_getValue(STATE);
  delete state.supportsPause;e.mem.globals.GM_setValue(STATE,state);
  await assert.rejects(e.bridge.requestWebAnswer('old receiver',30,[],undefined,{isPaused:()=>false}),/刷新/);
  assert.equal(e.calls.length,0);assert.equal([...e.mem.values.keys()].filter(key=>key.startsWith(PREFIX)).length,0);
});
