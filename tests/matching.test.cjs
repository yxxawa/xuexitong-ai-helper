const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {ROOT, domRuntime, loadTS, plain} = require('./helpers/runtime.cjs');
const ENTRY = 'packages/scripts/src/utils/cx-question.ts';
function fixture(t, kind='new') {
  const html=fs.readFileSync(path.join(ROOT, 'tests/fixtures/matching-'+kind+'.html'), 'utf8');
  const env=domRuntime(html, 'https://mooc1.chaoxing.com/mooc2/work/dowork');
  t.after(()=>env.dom.window.close());
  const root=env.document.body.firstElementChild;
  return {...env, root, api:loadTS(ENTRY, env.globals)};
}
const delay=async()=>{};

test('recognizes new matching markup without hidden type and before generic textarea heuristics', t=>{
  const {api,root,document}=fixture(t);
  root.append(document.createElement('textarea'));
  assert.equal(api.resolveQuestionType({}, {root, type:'completion'}), 'line');
});
test('recognizes type 11, matching title, and keeps ordinary question types', t=>{
  const {api,root,document}=fixture(t);
  const input=document.createElement('input'); input.value='11';
  assert.equal(api.resolveQuestionType({type:[input]}, {root}), 'line');
  assert.equal(api.resolveQuestionType({}, {}, '配对题'), 'line');
  assert.equal(api.resolveQuestionType({}, {}, 'Matching question'), 'line');
  assert.equal(api.getQuestionType(0),'single');
  assert.equal(api.getQuestionType(1),'multiple');
  assert.equal(api.getQuestionType(3),'judgement');
  assert.equal(api.getQuestionType(4),'completion');
  assert.equal(api.getQuestionType(14),'fill');
  assert.equal(api.getQuestionType(15),'reader');
  input.value='';
  assert.equal(api.resolveQuestionType({type:[input]}, {}, '单选题'), 'single');
});
test('preserves both columns, per-group stems, actual select values and image markers', t=>{
  const {api,root}=fixture(t);
  const titles=api.cxQuestionTitles(root,'h3');
  assert.equal(titles.length,3);
  assert.match(titles.map(x=>x.textContent).join(' '),/猫/);
  assert.match(titles.map(x=>x.textContent).join(' '),/cat/);
  const groups=plain(api.collectLineOptionGroups(root,['https://example.com/dog.png']));
  assert.equal(groups.length,2);
  assert.equal(groups[0].title,'1. 猫');
  assert.match(groups[1].title,/\[图片1\]/);
  assert.deepEqual(groups[0].options,[{value:'a',text:'A. dog'},{value:'b',text:'B. cat'}]);
});
test('native selects notify saving handlers, update Chosen labels and are recognized as answered', async t=>{
  const {api,root}=fixture(t);
  const events=[];
  for(const select of root.querySelectorAll('select'))
    for(const type of ['input','change','chosen:updated']) select.addEventListener(type,()=>events.push([select.id,type,select.value]));
  assert.equal(api.readLineAnswer(root),undefined);
  assert.equal((await api.fillLineAnswer('b#a',root,delay)).finish,true);
  assert.equal(api.readLineAnswer(root),'b#a');
  assert.equal(events.filter(x=>x[1]==='change').length,2);
  assert.deepEqual(Array.from(root.querySelectorAll('.chosen-single span')).map(x=>x.textContent),['B','A']);
  const inputs=loadTS('packages/scripts/src/utils/answer-input.ts', {window:root.ownerDocument.defaultView, document:root.ownerDocument});
  assert.equal(inputs.readPageAnswer('line',[],root),'b#a');
});
test('native menu with numeric zero value is not confused with an unanswered placeholder', async t=>{
  const {api,root,document}=fixture(t);
  root.querySelectorAll('select').forEach(s=>{s.innerHTML='<option value="-1">请选择</option><option value="0">零</option>';});
  assert.equal((await api.fillLineAnswer('0#0',root,delay)).finish,true);
  assert.equal(api.readLineAnswer(root),'0#0');
});
test('validates all groups before writing: incomplete, invalid and disabled options', async t=>{
  const {api,root}=fixture(t);
  for(const answer of ['a','a#z','a#a#a','a#']) {
    assert.equal((await api.fillLineAnswer(answer,root,delay)).finish,false);
    assert.equal(root.querySelector('select').value,'-1');
  }
  root.querySelectorAll('select')[1].disabled=true;
  assert.equal((await api.fillLineAnswer('a#b',root,delay)).finish,false);
  assert.equal(root.querySelector('select').value,'-1');
});
test('legacy menus include both columns and use native click handlers to save hidden inputs', async t=>{
  const {api,root}=fixture(t,'legacy');
  for(const row of root.querySelectorAll('.line_answer_ct'))
    for(const li of row.querySelectorAll('li[data]')) li.querySelector('a').addEventListener('click',()=>{row.querySelector('input').value=li.getAttribute('data');});
  assert.equal(api.resolveQuestionType({}, {root}),'line');
  assert.equal(api.cxQuestionTitles(root,'.Zy_TItle .clearfix').length,3);
  assert.equal((await api.fillLineAnswer('b#a',root,delay)).finish,true);
  assert.equal(api.readLineAnswer(root),'b#a');
});
test('does not claim completion when legacy handlers fail to save or native handlers revert the value', async t=>{
  const legacy=fixture(t,'legacy');
  assert.equal((await legacy.api.fillLineAnswer('b#a',legacy.root,delay)).finish,false);
  const native=fixture(t);
  native.root.querySelector('select').addEventListener('change',e=>{e.target.value='-1';});
  assert.equal((await native.api.fillLineAnswer('b#a',native.root,delay)).finish,false);
});
test('does not duplicate native selects nested in a legacy-looking wrapper', t=>{
  const {api,root,document}=fixture(t);
  const select=root.querySelector('select');
  const wrapper=document.createElement('div'); wrapper.className='line_answer_ct';
  const box=document.createElement('div'); box.className='selectBox';
  select.before(wrapper);wrapper.append(box);box.append(select);
  assert.equal(api.lineSelectBoxes(root).length,2);
});
test('stops before the next matching write after cancellation', async t=>{
  const {api,root}=fixture(t);
  let cancelled=false;
  await assert.rejects(api.fillLineAnswer('b#a',root,async()=>{cancelled=true;},()=>cancelled),/取消/);
  assert.equal(root.querySelectorAll('select')[1].value,'');
});

test('a missing control or missing right-column text rejects the entire matching question before any write',async t=>{
  const e=fixture(t);e.root.querySelectorAll('select')[1].remove();
  assert.equal(e.api.collectLineOptionGroups(e.root).length,0);assert.equal(e.api.readLineAnswer(e.root),undefined);
  assert.equal((await e.api.fillLineAnswer('b',e.root,delay)).finish,false);
  assert.equal(e.root.querySelector('select').value,'-1');
  const other=fixture(t);other.root.querySelector('.secondUlList').remove();
  assert.equal(other.api.collectLineOptionGroups(other.root).length,0);
});
test('matching pair labels determine source order and duplicates or missing source labels are rejected',t=>{
  const e=fixture(t);const {normalizeAnswerByQuestionType}=loadTS('packages/scripts/src/utils/ai.ts',e.globals);
  const groups=e.api.collectLineOptionGroups(e.root);
  assert.equal(normalizeAnswerByQuestionType('2-a, 1-b','line',groups),'b#a');
  assert.equal(normalizeAnswerByQuestionType('B-a; A-b','line',groups),'b#a');
  for(const value of ['1-a, 1-b','1-a','3-a, 1-b','2-a, 0-b'])
    assert.equal(normalizeAnswerByQuestionType(value,'line',groups),'');
});
