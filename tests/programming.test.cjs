const test = require('node:test');
const assert = require('node:assert/strict');
const { domRuntime, loadTS, plain } = require('./helpers/runtime.cjs');
const ENTRY = 'packages/scripts/src/utils/programming.ts';
const code = 'if True:\n    print("# <tag> & \\\\path")\n    # keep this comment\n';
function question(id) {
  return '<div class="questionLi" id="q'+id+'"><input id="answertype'+id+'" value="17" type="hidden">'+
    '<input id="answer'+id+'" type="hidden"><input class="languageSelect" value="16" type="hidden">'+
    '<strong class="selectBoxLang" codename="Python 3.6.9"><p>Python 3.6.9</p></strong>'+
    '<div class="proceduralQue" data="'+id+'"><textarea class="code-editor" data-business-id="'+id+'"></textarea>'+
    '<div class="CodeMirror"><textarea class="cm-input"></textarea></div><textarea class="runResult" readonly></textarea></div></div>';
}
function attachEditor(env, root, options = {}) {
  const wrapper = root.querySelector('.CodeMirror'), backing = root.querySelector('.code-editor');
  let value = '', selection = [0, 0]; const origins = [];
  const editor = {
    options: {readOnly:false}, getValue:()=>value, getOption:key=>editor.options[key],
    getTextArea:()=>backing, getWrapperElement:()=>wrapper, save(){backing.value=value;},
    select(from,to=from){selection=[from,to];},
    setValue(next){ if (!options.reject) { value = options.alter ? next.replace(/ /g,'') : next; selection=[value.length,value.length]; } },
    replaceSelection(next,select,origin){ origins.push(origin); if(origin==='paste') return;
      value=value.slice(0,selection[0])+next+value.slice(selection[1]); selection=[selection[0]+next.length,selection[0]+next.length]; }
  };
  if (!options.isolated) wrapper.CodeMirror=editor;
  env.window.codeEditors ||= {}; env.window.codeEditors[backing.dataset.businessId]=editor;
  wrapper.addEventListener('paste', event=>editor.replaceSelection(event.clipboardData.getData('text/plain'),'end','paste'));
  return {editor,backing,wrapper,origins};
}
function setup(t, options={}) {
  const env=domRuntime(question('1')+question('2'), 'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork');
  t.after(()=>env.window.close()); const root=env.document.querySelector('#q1'), sibling=env.document.querySelector('#q2');
  const first=attachEditor(env,root,options), second=attachEditor(env,sibling);
  const api=loadTS(ENTRY,env.globals), writer=loadTS('packages/scripts/src/utils/answer-writer.ts',env.globals);
  const ctx={root,elements:{options:[]},type:'programming',searchInfos:[{name:'fixture',results:[{answer:code}]}],answerMatchMode:'similar'};
  return {...env,root,sibling,...first,second,api,writer,ctx};
}
function paste(env, text) {
  const event=new env.window.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'clipboardData',{value:{getData:()=>text}});
  env.wrapper.querySelector('textarea').dispatchEvent(event); return event;
}
test('programming type 17 and program markup override generic completion heuristics',t=>{
  const e=setup(t), api=loadTS('packages/scripts/src/utils/cx-question.ts',e.globals);
  assert.equal(api.getQuestionType(17),'programming');
  assert.equal(api.resolveQuestionType({type:[e.root.querySelector('input')]},{root:e.root,type:'completion'}),'programming');
  assert.equal(api.resolveQuestionType({},{root:e.root,type:'completion'}),'programming');
  assert.equal(api.resolveQuestionType({}, {}, '12. (程序题, 25分)'),'programming');
  assert.equal(e.api.programLanguage(e.root),'Python 3.6.9');
});
test('code keeps indentation, hashes, quotes, tags, backslashes and trailing newline',async t=>{
  const e=setup(t); assert.equal((await e.writer.fillProgrammingAnswer(e.ctx)).finish,true);
  assert.equal(e.editor.getValue(),code); assert.equal(e.backing.value,code);
  const saved=JSON.parse(e.root.querySelector('#answer1').value)[0];
  assert.equal(saved.language,16); assert.equal(saved.answerTxt,code);
  const temp=e.document.createElement('div');temp.innerHTML=saved.answer;
  assert.equal(temp.querySelector('code').textContent,code); assert.equal(temp.querySelector('tag'),null);
  assert.equal(e.second.editor.getValue(),''); assert.equal(e.root.querySelector('.runResult').value,'');
  assert.equal(e.api.readProgrammingAnswer(e.root),code);
});
test('reads the editor model for already-answered protection and supports page-world codeEditors',async t=>{
  const e=setup(t,{isolated:true}); const input=loadTS('packages/scripts/src/utils/answer-input.ts',e.globals);
  e.backing.value='stale'; assert.equal(input.readPageAnswer('programming',[],e.root),undefined);
  await e.writer.fillProgrammingAnswer(e.ctx,e.window);
  e.backing.value='outdated'; assert.equal(input.readPageAnswer('programming',[],e.root,e.window),code);
});
test('empty, unloaded, detached, readonly and cancelled program writes cannot be marked complete',async t=>{
  const e=setup(t); e.editor.options.readOnly=true;
  await assert.rejects(e.writer.fillProgrammingAnswer(e.ctx),/不可编辑/); assert.equal(e.editor.getValue(),'');
  e.editor.options.readOnly=false; e.ctx.isCancelled=()=>true;
  await assert.rejects(e.writer.fillProgrammingAnswer(e.ctx),/取消/); assert.equal(e.editor.getValue(),'');
  e.ctx.isCancelled=()=>false; e.root.querySelector('.languageSelect').value='-1';
  await assert.rejects(e.writer.fillProgrammingAnswer(e.ctx),/程序语言/); assert.equal(e.editor.getValue(),'');
  e.root.querySelector('.languageSelect').value='16'; e.ctx.searchInfos[0].results[0].answer='';
  assert.equal((await e.writer.fillProgrammingAnswer(e.ctx)).finish,false);
  e.ctx.searchInfos[0].results[0].answer=code; delete e.wrapper.CodeMirror;delete e.window.codeEditors['1'];
  await assert.rejects(e.writer.fillProgrammingAnswer(e.ctx),/尚未加载/);
  const detached=setup(t);detached.root.remove();
  await assert.rejects(detached.writer.fillProgrammingAnswer(detached.ctx),/不可编辑/);
  assert.equal(detached.editor.getValue(),'');
});
test('a rejected or altered editor mutation and saved-field rollback are detected',async t=>{
  const e=setup(t,{reject:true}); await assert.rejects(e.writer.fillProgrammingAnswer(e.ctx),/保存完整代码/);
  const f=setup(t,{alter:true});await assert.rejects(f.writer.fillProgrammingAnswer(f.ctx),/保存完整代码/);
  const g=setup(t);g.root.querySelector('#answer1').addEventListener('change',()=>{g.root.querySelector('#answer1').value='';});
  await assert.rejects(g.writer.fillProgrammingAnswer(g.ctx),/保存完整代码/);
});
test('native clipboard capture permits paste, replaces only the selection, and registers once',t=>{
  const e=setup(t);paste(e,code);assert.equal(e.editor.getValue(),'');
  assert.equal(e.api.enableProgrammingPaste(e.document),2);assert.equal(e.api.enableProgrammingPaste(e.document),0);
  e.editor.setValue('before OLD after');e.editor.select(7,10);
  const event=paste(e,code);assert.equal(event.defaultPrevented,true);
  assert.equal(e.editor.getValue(),'before '+code+' after');assert.equal(e.origins.at(-1),'xth-paste');
  assert.equal(e.second.editor.getValue(),'');assert.equal(JSON.parse(e.root.querySelector('#answer1').value)[0].answerTxt,e.editor.getValue());
});
test('paste never enables readonly editors or mutates an unrelated editor',t=>{
  const e=setup(t);e.api.enableProgrammingPaste(e.document);e.editor.options.readOnly=true;
  assert.equal(paste(e,code).defaultPrevented,false);assert.equal(e.editor.getValue(),'');
  assert.equal(e.second.editor.getValue(),'');
});
test('dynamically rendered questions receive paste support without a reload',async t=>{
  const e=setup(t);const stop=e.api.watchProgrammingPaste(e.document,e.window);t.after(stop);
  const box=e.document.createElement('div');box.innerHTML=question('3');
  const root=box.firstElementChild; const third=attachEditor(e,root);e.document.body.append(root);
  await Promise.resolve();await Promise.resolve();assert.equal(third.wrapper.dataset.xthProgrammingPaste,'1');
});
test('only enclosing code fences are stripped; block indentation and source text stay literal',t=>{
  const e=setup(t);const fence=String.fromCharCode(96).repeat(3);
  assert.equal(e.api.normalizeProgramAnswer(fence+'python\n'+code+'\n'+fence),code);
  assert.equal(e.api.normalizeProgramAnswer('    x = "#;|"\r\n'),'    x = "#;|"\n');
});
function aiSetup(t, raw, provider='api') {
  const e=setup(t);const calls=[];
  const ai=loadTS('packages/scripts/src/utils/ai.ts',e.globals,{
    './web-ai':{getWebBridgeState:()=>({id:'fixture'}),requestWebAnswer:async(prompt)=>{calls.push(prompt);return raw;}},
    './web-task':{reportWebTaskStatus(){}},'./vision':{getVisionCapability:()=>({state:'unsupported'})},
    '@xuexitong-ai-helper/core/src/core/utils/request':{request:async(url,options)=>{calls.push(plain(options.data));return {choices:[{message:{content:raw},finish_reason:'stop'}]};}}
  });
  const opts={aiProvider:provider,aiApiUrl:'https://example.test/v1',aiApiKey:'fixture-key',aiModel:'fixture-model',aiTemperature:0,aiUseResponseFormat:false};
  return {...e,ai,calls,opts};
}
for(const provider of ['api','deepseek-web'])test(provider+' uses program prompts and a single complete JSON code string',async t=>{
  const e=aiSetup(t,JSON.stringify({answer:code,answers:[code]}),provider);
  const infos=await e.ai.queryAIAnswerer(e.opts,{type:'programming',title:'编程语言：Python 3.6.9',options:[]});
  assert.equal(infos[0].results[0]?.answer,code,JSON.stringify(infos));
  const prompt=JSON.stringify(e.calls[0]);assert.match(prompt,/程序题/);assert.match(prompt,/完整.*代码/);assert.match(prompt,/不要用 # 分割/);
  assert.equal(infos[0].results[0].extra_data.answer_parts,undefined);
});
test('JSON code parsing preserves escapes exactly and raw fenced code cannot be mistaken for an embedded answer object',async t=>{
  const source='name = "x"\ntext = "\\n"\nprint({"answer":"not the answer"})\n';
  const e=aiSetup(t,JSON.stringify({answer:source}));
  assert.equal((await e.ai.queryAIAnswerer(e.opts,{type:'programming',title:'test'}))[0].results[0]?.answer,source);
  const fence=String.fromCharCode(96).repeat(3);const f=aiSetup(t,fence+'python\n'+source+'\n'+fence);
  assert.equal((await f.ai.queryAIAnswerer(f.opts,{type:'programming',title:'test'}))[0].results[0]?.answer,source);
});
test('multiple code answers and malformed JSON are rejected instead of joining source with hash separators',async t=>{
  for(const raw of ['{"answers":["print(1)","print(2)"]}', '{"answer":"unfinished']) {
    const e=aiSetup(t,raw);const infos=await e.ai.queryAIAnswerer(e.opts,{type:'programming',title:'test'});
    assert.equal(infos[0].results.length,0);
  }
});

test('cached page restore retains paste support for subsequently rendered questions',async t=>{
  const e=setup(t);const stop=e.api.watchProgrammingPaste(e.document,e.window);t.after(stop);
  const hidden=new e.window.Event('pagehide');Object.defineProperty(hidden,'persisted',{value:true});e.window.dispatchEvent(hidden);
  e.window.dispatchEvent(new e.window.Event('pageshow'));
  const box=e.document.createElement('div');box.innerHTML=question('4');
  const root=box.firstElementChild;const fourth=attachEditor(e,root);e.document.body.append(root);
  await Promise.resolve();await Promise.resolve();assert.equal(fourth.wrapper.dataset.xthProgrammingPaste,'1');
});

for(const provider of ['api','deepseek-web'])test(provider+' correction carries original question, code and full run error, and defaults to no comments',async t=>{
  const title='输入一个整数并输出结果，Python 3.6.9';
  const answer='print(value)\n',output='Traceback (most recent call last):\nNameError: value is not defined';
  const e=aiSetup(t,JSON.stringify({answer:'print(1)\n'}),provider);
  const result=await e.ai.queryAIAnswerer(e.opts,{type:'programming',title,programmingFeedback:{answer,output,attempt:1,maxAttempts:3}});
  assert.equal(result[0].results[0].answer,'print(1)\n');
  const prompt=typeof e.calls[0]==='string'?e.calls[0]:e.calls[0].messages.map(m=>m.content).join('\n');
  assert.ok(prompt.includes(title));assert.ok(prompt.includes(answer));assert.ok(prompt.includes(output));
  assert.match(prompt,/除非题目明确要求注释，否则源代码不写注释/);assert.match(prompt,/已运行 1\/3 次/);
});
