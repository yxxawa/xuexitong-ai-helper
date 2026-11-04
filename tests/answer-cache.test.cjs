const test = require('node:test');
const assert = require('node:assert/strict');
const { domRuntime, loadTS, plain } = require('./helpers/runtime.cjs');
const opts = { aiProvider:'api', aiApiUrl:'https://model.example.test/v1', aiApiKey:'fixture', aiModel:'fixture', aiTemperature:0 };
const question = { title:'甲 ____ 乙 ____', type:'completion', blankCount:2 };
const infos = parts => [{name:'fixture',results:[{answer:parts.join('#'),extra_data:{ai:true,answer_parts:parts}}]}];
function setup(t) {
  const env=domRuntime(); t.after(()=>env.window.close());
  const api=loadTS('packages/scripts/src/utils/answer-cache.ts',env.globals,{'./web-ai':{getWebBridgeState(){}}});
  let entries=[];
  const cache=new api.QuestionAnswerCache({get:()=>entries,set:value=>{entries=plain(value);},enabled:()=>true});
  return {...api,cache,get entries(){return entries;},seed(value){entries=value;}};
}
test('an incomplete completion response does not trap subsequent retries in the answer cache', async t=>{
  const e=setup(t); let calls=0;
  const query=async()=>++calls===1?infos(['one']):infos(['one','two']);
  await e.cache.search(opts,question,query);
  assert.equal(e.entries.length,0);
  const fresh=await e.cache.search(opts,question,query);
  assert.equal(calls,2); assert.equal(fresh[0].results[0].answer,'one#two');
  await e.cache.search(opts,question,query); assert.equal(calls,2);
});
test('a previously stored completion with the wrong count is evicted before retrying AI', async t=>{
  const e=setup(t); let calls=0;
  e.seed([{version:2,key:e.questionCacheKey(opts,question),title:question.title,answer:'one',answerParts:['one'],from:'old',homepage:'',solution:'',createdAt:Date.now()}]);
  const result=await e.cache.search(opts,question,async()=>{calls++;return infos(['one','two']);});
  assert.equal(calls,1); assert.equal(result[0].results[0].answer,'one#two');
  assert.equal(e.entries.length,1); assert.equal(e.entries[0].answer,'one#two');
});
test('explicit correction cannot replace a complete cached answer with missing blanks', async t=>{
  const e=setup(t); await e.cache.search(opts,question,async()=>infos(['one','two']));
  const before=JSON.stringify(e.entries);
  assert.throws(()=>e.cache.replaceAnswer(opts,question,infos(['one'])),/填空|数量/);
  assert.equal(JSON.stringify(e.entries),before);
});
test('structured answers containing a literal hash remain valid in multi-blank and single-blank caches', async t=>{
  const e=setup(t); let calls=0;
  for (const [q,parts] of [[question,['#tag','two']],[{...question,blankCount:1},['value#literal']]]) {
    const query=async()=>{calls++;return infos(parts);};
    await e.cache.search(opts,q,query);
    const cached=await e.cache.search(opts,q,query);
    assert.equal(cached[0].data.cache_hit,true);
    assert.deepEqual(plain(cached[0].results[0].extra_data.answer_parts),parts);
  }
  assert.equal(calls,2);
});


test('unstructured completion caches reject empty blanks and extra answers but preserve single literal hashes', async t=>{
  const e=setup(t);let calls=0;
  for(const answer of ['one#','one#two#three']) {
    const query=async()=>{calls++;return [{name:'fixture',results:[{answer,extra_data:{ai:true}}]}];};
    await e.cache.search(opts,question,query);await e.cache.search(opts,question,query);
    assert.equal(e.entries.length,0);
  }
  assert.equal(calls,4);
  const single={...question,blankCount:1}, query=async()=>[{name:'fixture',results:[{answer:'value#literal',extra_data:{ai:true}}]}];
  await e.cache.search(opts,single,query);
  assert.equal((await e.cache.search(opts,single,query))[0].data.cache_hit,true);
});
test('simultaneous failed completion searches deduplicate once then allow a fresh retry', async t=>{
  const e=setup(t);let calls=0,resolve;
  const query=()=>{calls++;return new Promise(done=>{resolve=done;});};
  const first=e.cache.search(opts,question,query), second=e.cache.search(opts,question,query);
  await Promise.resolve();resolve(infos(['one']));
  const results=await Promise.all([first,second]);
  assert.equal(calls,1);assert.equal(results[1][0].data.deduplicated,true);assert.equal(e.entries.length,0);
  await e.cache.search(opts,question,async()=>{calls++;return infos(['one','two']);});
  assert.equal(calls,2);assert.equal(e.entries.length,1);
});
