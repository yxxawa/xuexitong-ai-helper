const test=require('node:test');
const assert=require('node:assert/strict');
const {Clock,domRuntime,loadTS,plain}=require('./helpers/runtime.cjs');
const settings=loadTS('packages/scripts/src/utils/settings-transfer.ts');
const schema=settings.settingsSchema([{namespace:'user',configs:{
  enabled:{label:'Enabled',defaultValue:true},zero:{label:'Zero',defaultValue:1,attrs:{min:0,max:8,step:1}},
  empty:{label:'Empty',defaultValue:'default'},token:{label:'Key',defaultValue:''},
  button:{label:'Action',defaultValue:'Go',attrs:{type:'button'}},hidden:{defaultValue:[],attrs:{type:'hidden'}},
  cache:{label:'Cache',defaultValue:[],extra:{appConfigSync:false}}
}}]);
test('settings backups round-trip false, zero and empty strings without runtime mailboxes or caches',()=>{
  const store={'user.enabled':false,'user.zero':0,'user.empty':'','user.token':'SYNTHETIC-KEY',
    'xth.web.request.v1.secret':{prompt:'never export'},'user.cache':['never export']};
  const backup=settings.exportSettings(schema,key=>store[key]);
  assert.deepEqual(plain(backup.values),{'user.enabled':false,'user.zero':0,'user.empty':'','user.token':'SYNTHETIC-KEY'});
  assert.deepEqual(plain(settings.parseSettings(JSON.stringify(backup),schema).values),plain(backup.values));
});
test('settings import validates the whole file and safely handles legacy dictionaries and unknown keys',()=>{
  assert.deepEqual(plain(settings.parseSettings('{"user.enabled":false,"xth.web.bridge.v1":{}}',schema)),
    {values:{'user.enabled':false},ignored:1});
  for(const value of ['{','[]','{"version":999,"values":{}}','{"user.enabled":"false"}',
    '{"user.enabled":false,"user.zero":99}','{"user.zero":0.5}','{"unknown":1}'])
    assert.throws(()=>settings.parseSettings(value,schema));
  assert.equal(settings.parseSettings('{"user.zero":"0"}',schema).values['user.zero'],0);
});
test('stylesheet and shorthand background images appear in the multimodal payload and text markers without losing text',t=>{
  const e=domRuntime('<style>.sheet{background-image:url("https://example.com/sheet.png")}.short{background:url("https://example.com/short.png")}</style><div id="q"><span class="sheet">first</span><span class="short">second</span></div>');
  t.after(()=>e.window.close());const api=loadTS('packages/scripts/src/utils/question.ts',e.globals),root=e.document.querySelector('#q');
  const images=api.inspectQuestionImages([root]);
  assert.equal(images.hasImage,true);assert.equal(images.unresolvedImageCount,0);
  assert.deepEqual(plain(images.imageUrls),['https://example.com/sheet.png','https://example.com/short.png']);
  assert.equal(api.questionElementText(root,images.imageUrls),'[图片1] first[图片2] second');
  assert.equal(root.querySelector('.sheet').textContent,'first');
});
test('media polling releases every timer after timeout, success, cancellation and predicate failure',async t=>{
  const e=domRuntime();t.after(()=>e.window.close());const clock=new Clock();
  const {waitForMedia}=loadTS('packages/scripts/src/utils/study.ts',{...e.globals,...clock.globals()});
  const tasks=Array.from({length:3},()=>waitForMedia({timeout:1000}).then(()=>assert.fail('unexpected media'),error=>assert.match(error.message,/超时/)));
  await clock.advance(1000);await Promise.all(tasks);assert.equal(clock.timers.size,0);
  e.document.body.innerHTML='<video></video>';
  assert.equal((await waitForMedia()).tagName,'VIDEO');assert.equal(clock.timers.size,0);
  await assert.rejects(waitForMedia({filter(){throw new Error('predicate error');}}),/predicate error/);
  assert.equal(clock.timers.size,0);
  e.document.body.innerHTML='';const controller=new AbortController();
  const task=waitForMedia({signal:controller.signal});const rejected=assert.rejects(task,/已取消/);controller.abort();await rejected;
  assert.equal(clock.timers.size,0);
});
