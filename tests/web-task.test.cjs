const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {Clock, domRuntime, loadTS, storage} = require('./helpers/runtime.cjs');
const STATE = 'xth.web.bridge.v1';
const capture = promise => { const task={done:false}; task.promise=promise.then(value=>{task.done=true;task.value=value;},error=>{task.done=true;task.error=error;});return task; };
function setup(t) {
  const env=domRuntime('', 'https://mooc1.chaoxing.com/mooc2/work/dowork');
  if (!env.window.HTMLElement.prototype.replaceChildren) env.window.HTMLElement.prototype.replaceChildren=function(...children){while(this.firstChild)this.removeChild(this.firstChild);this.append(...children);};
  const clock=new Clock(), mem=storage(), globals={...env.globals,...clock.globals(),...mem.globals};
  const taskState=loadTS('packages/scripts/src/utils/web-task.ts',globals);
  const activities=loadTS('packages/scripts/src/utils/web-activity.ts',globals);
  const cfg={aiProvider:'deepseek-web',aiApiUrl:'',aiApiKey:'',aiModel:'',thread:1,period:0,upload:'nomove',
    redundanceWordsText:'',answerSeparators:',',answerMatchMode:'similar',stopSecondWhenFinish:0};
  const configListeners=new Map();
  const settings={cfg,methods:{getWorkOptions:()=>({...cfg})},onConfigChange(key,fn){configListeners.set(key,fn);}};
  const panelBody=env.document.createElement('div');env.document.body.append(panelBody);
  const script=new EventEmitter();script.panel={body:panelBody};
  const messages=[], workers=[], provided=[];
  class MessageElement {
    constructor(content){this.element=env.document.createElement('aside');if(content?.nodeType)this.element.append(content);env.document.body.append(this.element);}
    remove(){this.element.remove();}
  }
  function h(tag,attrs,children) {
    if(Array.isArray(attrs)||typeof attrs==='string'){children=attrs;attrs={};}
    const el=env.document.createElement(tag);
    for(const [key,value] of Object.entries(attrs||{})){
      if(key==='style'&&typeof value==='object')Object.assign(el.style,value);
      else if(key.startsWith('on')||key in el)el[key]=value;
      else el.setAttribute(key,value);
    }
    for(const child of [children].flat(Infinity))if(child!==undefined&&child!==null)el.append(child.nodeType?child:String(child));
    return el;
  }
  const ui={button(text,attrs={}){
    const el=h('button',attrs,text);el.type='button';
    Object.defineProperty(el,'value',{get:()=>el.textContent,set:value=>{el.textContent=value;}});return el;
  },preventText({delay,ondefault,onprevent}){
    const el=h('button',{},'点击取消');let prevented=false;
    el.onclick=()=>{prevented=true;onprevent(el);};
    clock.setTimeout(()=>{if(!prevented)ondefault(el);},delay*1000);return el;
  }};
  const message=kind=>attrs=>{messages.push({kind,text:typeof attrs==='string'?attrs:attrs.content});return new MessageElement(typeof attrs==='string'?h('span',{},attrs):attrs.content);};
  const easy={$ui:ui,$message:{info:message('info'),warn:message('warn'),error:message('error'),success:message('success')},
    MessageElement,h,CommonEventEmitter:EventEmitter,cors:{defineTopFunction:fn=>fn},$modal:{}};
  const hasAnswerProvider=opts=>opts.aiProvider==='deepseek-web' ? Boolean(mem.values.get(STATE)&&mem.values.get(STATE).status!=='disabled') : Boolean(opts.aiApiUrl&&opts.aiApiKey&&opts.aiModel);
  const precheck=loadTS('packages/scripts/src/utils/index.ts',globals,{'easy-us':easy,
    './work':{aiConfigEmptyWarning:()=>new MessageElement(h('span',{},'未设置 AI'))},'./ai':{hasAnswerProvider},
    '@xuexitong-ai-helper/core/src/utils/common':{$:{sleep:ms=>new Promise(resolve=>clock.setTimeout(resolve,ms))}}});
  const common={scripts:{settings,workResults:Object.assign(new EventEmitter(),{methods:{createWorkResultsPanel:()=>h('section',{},'答题结果')}}),render:{methods:{pin(){script.emit('render');}}}}};
  const api=loadTS('packages/scripts/src/utils/work.ts',globals,{'easy-us':easy,'../projects/common':{CommonProject:common},
    './answer-review':{assertQuestionReviewIdle(){}},'./question':{getQuestionImageURL:()=>''},
    './ai':{hasAnswerProvider},'.':{workPreCheckMessage:precheck.workPreCheckMessage},'./web-activity':activities,'./web-task':taskState});
  function start(extra={}){
    api.commonWork(script,{enable_control_panel:true,...extra,workerProvider(opts){
      provided.push(opts);const worker=new EventEmitter();worker.isStop=false;
      worker.on('stop',()=>{worker.isStop=true;});worker.on('continuate',()=>{worker.isStop=false;});
      worker.on('close',()=>{worker.isClose=true;worker.isStop=false;});workers.push(worker);return worker;
    }});
  }
  function connect(){
    const state={id:'test-bridge',instance:'receiver',provider:'deepseek-web',status:'ready',updatedAt:clock.now,supportsActivities:true,supportsPause:true,supportsRecovery:true};
    mem.globals.GM_setValue(STATE,state);
    activities.serviceWebActivities(state.id);
  }
  const service=clock.setInterval(()=>{
    const state=mem.values.get(STATE);if(state&&state.status!=='disabled'){
      mem.globals.GM_setValue(STATE,{...state,updatedAt:clock.now});activities.serviceWebActivities(state.id);
    }
  },100);
  t.after(()=>{env.window.dispatchEvent(new env.window.Event('pagehide'));clock.clearInterval(service);env.window.close();});
  const button=text=>[...panelBody.querySelectorAll('button')].find(el=>el.textContent.includes(text));
  return {...env,clock,mem,taskState,activities,start,connect,button,cfg,workers,provided,panelBody,messages,api};
}
test('opening the learning page before DeepSeek connects automatically starts exactly once when the bridge is ready',async t=>{
  const e=setup(t);e.start();await e.clock.advance(6500);
  assert.equal(e.provided.length,0);assert.ok(e.button('停止'));
  assert.match(e.panelBody.querySelector('[data-xth-web-task]').textContent,/等待.*连接/);
  e.connect();await e.clock.advance(1600);
  assert.equal(e.provided.length,1);assert.ok(e.provided[0].webActivityId);
  await e.clock.advance(6000);assert.equal(e.provided.length,1);
});
test('stopping during the initial connection wait prevents a later bridge connection from starting a worker',async t=>{
  const e=setup(t);e.start();await e.clock.advance(5500);e.button('停止').click();await e.clock.advance(1000);
  e.connect();await e.clock.advance(5000);
  assert.equal(e.provided.length,0);assert.ok(e.button('开始答题'));
  assert.match(e.panelBody.querySelector('[data-xth-web-task]').textContent,/已停止/);
});
test('pausing during startup keeps the task waiting until the user resumes, even after the bridge connects',async t=>{
  const e=setup(t);e.start();await e.clock.advance(5500);e.button('暂停').click();
  e.connect();await e.clock.advance(5000);assert.equal(e.provided.length,0);
  e.button('继续').click();await e.clock.advance(1600);assert.equal(e.provided.length,1);
});
test('cancelling the automatic-start countdown also cancels a later connection-triggered start',async t=>{
  const e=setup(t);e.start();
  [...e.document.querySelectorAll('aside button')].find(el=>el.textContent==='点击取消').click();
  await e.clock.advance(7000);e.connect();await e.clock.advance(3000);assert.equal(e.provided.length,0);
  e.button('开始答题').click();await e.clock.advance(1600);assert.equal(e.provided.length,1);
});
test('a connection error pauses the worker, updates the continue button and leaves a persistent reason',async t=>{
  const e=setup(t);e.connect();e.start();await e.clock.advance(6500);assert.equal(e.workers.length,1);
  e.taskState.reportWebTaskStatus('attention','登录已过期，请处理后继续。');await e.clock.advance(400);
  assert.equal(e.workers[0].isStop,true);assert.ok(e.button('继续'));
  assert.match(e.panelBody.querySelector('[data-xth-web-task]').textContent,/登录已过期/);
  e.button('继续').click();assert.equal(e.workers[0].isStop,false);
});
test('a prolonged initial outage stops waiting visibly rather than quietly reporting a completed task',async t=>{
  const e=setup(t);e.start();await e.clock.advance(1807000);
  assert.equal(e.provided.length,0);assert.ok(e.button('开始答题'));
  assert.match(e.panelBody.querySelector('[data-xth-web-task]').textContent,/30 分钟/);
  e.connect();e.button('开始答题').click();await e.clock.advance(1600);assert.equal(e.provided.length,1);
});
test('the status watchdog exposes elapsed time and actionable advice after three minutes without a result',async t=>{
  const e=setup(t);e.taskState.reportWebTaskStatus('answering','等待当前答案');
  const element=e.taskState.createWebTaskStatus();e.document.body.append(element);await e.clock.advance(181000);
  assert.match(element.textContent,/181 秒/);assert.match(element.textContent,/长时间没有新结果/);
  element.remove();await e.clock.advance(1000);
});
test('cancelled connection waits settle promptly and keep no delayed restart timer',async t=>{
  const e=setup(t);let cancelled=false;
  const task=capture(e.taskState.waitForWebBridge({isCancelled:()=>cancelled}));await e.clock.advance(2000);
  cancelled=true;await e.clock.advance(600);assert.equal(task.done,true);assert.match(task.error.message,/取消/);
  e.connect();await e.clock.advance(1000);assert.equal(task.value,undefined);
});

test('returning to a cached learning page restores its controls and status observer without restarting automatically',async t=>{
  const e=setup(t);e.connect();e.start();await e.clock.advance(6500);assert.equal(e.workers.length,1);
  e.window.dispatchEvent(new e.window.Event('pagehide'));await e.clock.advance(1000);
  e.window.dispatchEvent(new e.window.Event('pageshow'));await e.clock.advance(500);
  assert.equal(e.workers[0].isClose,true);assert.ok(e.button('开始答题'));assert.equal(e.workers.length,1);
  e.button('开始答题').click();await e.clock.advance(1500);assert.equal(e.workers.length,2);
  e.taskState.reportWebTaskStatus('attention','原消息需要检查');await e.clock.advance(400);
  assert.equal(e.workers[1].isStop,true);assert.ok(e.button('继续'));
});
