const test=require('node:test');
const assert=require('node:assert/strict');
const {Clock,domRuntime,loadTS,plain}=require('./helpers/runtime.cjs');
const ENTRY='packages/scripts/src/utils/deepseek-web.ts';
const ID='0123456789abcdef0123456789abcdef';

function setup(t) {
  const env=domRuntime('<main id="messages"></main><form><textarea id="chat-input" placeholder="给 DeepSeek 发送消息"></textarea><button type="button" data-testid="send-button">Send</button></form>');
  t.after(()=>env.window.close());
  const clock=new Clock(), api=loadTS(ENTRY,{...env.globals,...clock.globals()});
  const adapter=api.createDeepSeekAdapter();
  let sent=0,retries=0;
  const messages=env.document.getElementById('messages');
  const input=env.document.getElementById('chat-input');
  let onSend=()=>{};
  env.document.querySelector('[data-testid="send-button"]').addEventListener('click',()=>{sent++;input.value='';onSend();});
  function addPending(id=ID, error='请求频率过高') {
    const row=env.document.createElement('div');
    row.setAttribute('data-virtual-list-item-key','-'+(messages.children.length+2));
    row.innerHTML='<div class="ds-message"><div class="ds-collapsible-text"><span></span></div><button class="ds-button ds-button--warning ds-button--circle" type="button"><svg></svg></button></div><div><span class="hint"></span><button aria-label="Copy">Copy</button><button aria-label="Edit">Edit</button></div>';
    row.querySelector('.ds-collapsible-text span').textContent='A test question; _bridge_id='+id;
    row.querySelector('.hint').textContent=error;
    row.querySelector('.ds-button--warning').addEventListener('click',()=>retries++);
    messages.append(row);
    return row;
  }
  async function submit(action=()=>addPending()) {
    onSend=action;
    const promise=adapter.submit('Test question. _bridge_id='+ID,()=>false,[],ID);
    await clock.advance(100);await promise;
  }
  return {...env,clock,api,adapter,messages,input,addPending,submit,get sent(){return sent;},get retries(){return retries;}};
}

test('explicit rate-limit phrases (including the real new UI and English RPD message) are recognized', t=>{
  const {api}=setup(t);
  for(const text of ['请求频率过高','请求太过频繁，请稍后重试','操作过于频繁，请稍后再试','RPD rate limit reached','Too many requests. Try again later.'])
    assert.equal(api.isDeepSeekRateLimit(text),true,text);
  for(const text of ['服务器繁忙，请稍后再试。','请先登录','验证码错误','每日额度已用完','网络异常','A'])
    assert.equal(api.isDeepSeekRateLimit(text),false,text);
});
test('new native pending-message retry waits 3000 ms and never re-submits the prompt', async t=>{
  const e=setup(t);await e.submit();
  assert.equal(e.sent,1);
  assert.equal(e.adapter.retryRateLimited(ID,()=>false).attempts,0);
  await e.clock.advance(2999);e.adapter.retryRateLimited(ID,()=>false);assert.equal(e.retries,0);
  await e.clock.advance(1);assert.equal(e.adapter.retryRateLimited(ID,()=>false).attempts,1);assert.equal(e.retries,1);
  for(let i=0;i<10;i++)e.adapter.retryRateLimited(ID,()=>false);
  assert.equal(e.retries,1);
  await e.clock.advance(3000);e.adapter.retryRateLimited(ID,()=>false);
  assert.equal(e.retries,2);assert.equal(e.sent,1);
});
test('disabled native retry buttons are respected and still reported as waiting', async t=>{
  const e=setup(t);await e.submit();
  const button=e.document.querySelector('.ds-button--warning');button.setAttribute('aria-disabled','true');
  assert.ok(e.adapter.retryRateLimited(ID,()=>false));
  await e.clock.advance(6000);assert.ok(e.adapter.retryRateLimited(ID,()=>false));assert.equal(e.retries,0);
  button.setAttribute('aria-disabled','false');e.adapter.retryRateLimited(ID,()=>false);assert.equal(e.retries,1);
});
test('cancellation and generation stop retries immediately', async t=>{
  const e=setup(t);await e.submit();e.adapter.retryRateLimited(ID,()=>false);
  await e.clock.advance(3000);
  assert.equal(e.adapter.retryRateLimited(ID,()=>true),undefined);assert.equal(e.retries,0);
  const stop=e.document.createElement('button');stop.setAttribute('aria-label','停止生成');e.document.body.append(stop);
  assert.equal(e.adapter.retryRateLimited(ID,()=>false),undefined);assert.equal(e.retries,0);
  stop.remove();e.adapter.retryRateLimited(ID,()=>false);assert.equal(e.retries,1);
});
test('never touches a previous pending rate-limited message or a different request nonce', async t=>{
  const e=setup(t);const previous=e.addPending('previous-nonce');
  await e.submit(()=>{});
  assert.equal(e.adapter.retryRateLimited(ID,()=>false),undefined);
  await e.clock.advance(5000);assert.equal(e.adapter.retryRateLimited('wrong-nonce',()=>false),undefined);
  assert.equal(e.retries,0);
  previous.remove();
});
test('a newer manual user turn prevents retrying the active old message', async t=>{
  const e=setup(t);await e.submit();e.adapter.retryRateLimited(ID,()=>false);
  e.addPending('manual-user-turn');await e.clock.advance(3000);
  assert.equal(e.adapter.retryRateLimited(ID,()=>false),undefined);assert.equal(e.retries,0);
});
test('mentioning a rate limit inside the question is not a service error', async t=>{
  const e=setup(t);await e.submit(()=>{
    const row=e.addPending(ID,'');
    row.querySelector('.ds-collapsible-text span').textContent='请解释请求频率过高，_bridge_id='+ID;
  });
  assert.equal(e.adapter.retryRateLimited(ID,()=>false),undefined);assert.equal(e.retries,0);
});
test('ordinary service/login errors and missing retry controls cannot trigger a send or unrelated action', async t=>{
  const e=setup(t);await e.submit(()=>e.addPending(ID,'请先登录'));
  assert.equal(e.adapter.retryRateLimited(ID,()=>false),undefined);
  e.document.querySelector('.hint').textContent='请求频率过高';
  e.document.querySelector('.ds-button--warning').remove();
  e.adapter.retryRateLimited(ID,()=>false);await e.clock.advance(3000);e.adapter.retryRateLimited(ID,()=>false);
  assert.equal(e.retries,0);assert.equal(e.sent,1);
});
test('legacy assistant markdown error retries only that new reply', async t=>{
  const e=setup(t);let clicks=0;
  await e.submit(()=>{
    e.messages.innerHTML='<section><div class="ds-markdown">请求频率过高</div><button aria-label="重试">Retry</button></section>';
    e.messages.querySelector('button').addEventListener('click',()=>clicks++);
  });
  e.adapter.retryRateLimited(ID,()=>false);await e.clock.advance(3000);e.adapter.retryRateLimited(ID,()=>false);
  assert.equal(clicks,1);assert.equal(e.sent,1);
});
test('old reply retry controls are never borrowed for a new reply with no action bar', async t=>{
  const e=setup(t);let clicks=0;
  e.messages.innerHTML='<section><div class="ds-markdown">请求频率过高</div><button aria-label="重试">Retry</button></section>';
  e.messages.querySelector('button').addEventListener('click',()=>clicks++);
  await e.submit(()=>{const section=e.document.createElement('section');section.innerHTML='<div class="ds-markdown">请求频率过高</div>';e.messages.append(section);});
  assert.equal(e.adapter.retryRateLimited(ID,()=>false),undefined);
  await e.clock.advance(3000);assert.equal(e.adapter.retryRateLimited(ID,()=>false),undefined);assert.equal(clicks,0);
});
test('completed responses require matching nonce and a completion toolbar, never a reasoning block', t=>{
  const e=setup(t);
  const answer=JSON.stringify({_bridge_id:ID,answer:'b#a',answers:['b','a']});
  e.messages.innerHTML='<div data-virtual-list-item-key="2"><div class="ds-message"><div class="ds-markdown ds-assistant-message-main-content"></div></div><nav><div role="button" class="ds-button"></div><div role="button" class="ds-button"></div><div role="button" class="ds-button"></div></nav></div>';
  e.messages.querySelector('.ds-markdown').textContent=answer;
  assert.deepEqual(plain(JSON.parse(e.adapter.readCompleted(ID))),JSON.parse(answer));
  assert.equal(e.adapter.readCompleted('another-id'),undefined);
  e.messages.querySelector('.ds-markdown').setAttribute('data-role','reasoning');
  assert.equal(e.adapter.readCompleted(ID),undefined);
  e.messages.querySelector('.ds-markdown').removeAttribute('data-role');e.messages.querySelector('nav').remove();
  assert.equal(e.adapter.readCompleted(ID),undefined);
});
test('bridge JSON parser rejects partial JSON and wrong nonces and handles fenced JSON', t=>{
  const {api}=setup(t);
  assert.equal(api.extractBridgeAnswer('{"answer":"A","_bridge_id":"'+ID+'"',ID),undefined);
  assert.equal(api.extractBridgeAnswer('{"answer":"A","_bridge_id":"old"}',ID),undefined);
  assert.equal(JSON.parse(api.extractBridgeAnswer('```json\n{"answer":"A","_bridge_id":"'+ID+'"}\n```',ID)).answer,'A');
});
test('native image validation limits and unique attachment names remain enforced', t=>{
  const {api}=setup(t);
  const image={name:'xth-image-1.png',dataUrl:'data:image/png;base64,AA=='};
  assert.doesNotThrow(()=>api.validateWebImages([image]));
  assert.throws(()=>api.validateWebImages([image,image]),/重复/);
  assert.throws(()=>api.validateWebImages(Array.from({length:11},()=>image)),/10 张/);
  assert.throws(()=>api.validateWebImages([{name:'bad.svg',dataUrl:'data:image/svg+xml;base64,AA=='}]),/格式/);
});

test('a fresh adapter reattaches to the original limited message and preserves the retry spacing without sending',async t=>{
  const e=setup(t);await e.submit();
  const resumed=e.api.createDeepSeekAdapter();
  assert.equal(resumed.resume(ID,4),true);
  assert.equal(resumed.retryRateLimited(ID,()=>false).attempts,4);
  await e.clock.advance(2999);resumed.retryRateLimited(ID,()=>false);assert.equal(e.retries,0);
  await e.clock.advance(1);assert.equal(resumed.retryRateLimited(ID,()=>false).attempts,5);
  assert.equal(e.retries,1);assert.equal(e.sent,1);
});
test('resuming never adopts a different latest user message or creates a missing original message',async t=>{
  const e=setup(t);const resumed=e.api.createDeepSeekAdapter();
  assert.equal(resumed.resume(ID),false);assert.equal(e.sent,0);
  e.addPending('some-other-message');assert.equal(resumed.resume(ID),false);
  await e.clock.advance(6000);assert.equal(resumed.retryRateLimited(ID,()=>false),undefined);
  assert.equal(e.retries,0);assert.equal(e.sent,0);
});
