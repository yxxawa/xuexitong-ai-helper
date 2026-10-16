const test=require('node:test');
const assert=require('node:assert/strict');
const {Clock,domRuntime,loadTS}=require('./helpers/runtime.cjs');
test('cancelling an API request aborts the GM transport and clears its cancellation timer',async t=>{
  const e=domRuntime();t.after(()=>e.window.close());const clock=new Clock();let cancelled=false,aborted=0;
  const {request}=loadTS('packages/core/src/core/utils/request.ts',{...e.globals,...clock.globals(),
    GM_xmlhttpRequest:()=>({abort(){aborted++;}})});
  const task=assert.rejects(request('https://example.com/test',{type:'GM_xmlhttpRequest',isCancelled:()=>cancelled}),/取消/);
  await clock.advance(100);cancelled=true;await clock.advance(100);await task;
  assert.equal(aborted,1);assert.equal(clock.timers.size,0);
});
test('API requests that finish normally also release their cancellation timer',async t=>{
  const e=domRuntime();t.after(()=>e.window.close());const clock=new Clock();
  const {request}=loadTS('packages/core/src/core/utils/request.ts',{...e.globals,...clock.globals(),
    GM_xmlhttpRequest:opts=>{clock.setTimeout(()=>opts.onload({status:200,response:{ok:true}}),50);return {abort(){assert.fail('unexpected abort');}};}});
  const task=request('https://example.com/test',{type:'GM_xmlhttpRequest',isCancelled:()=>false});
  await clock.advance(100);assert.equal((await task).ok,true);assert.equal(clock.timers.size,0);
});
