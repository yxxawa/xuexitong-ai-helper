const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, domRuntime, loadTS } = require('./helpers/runtime.cjs');

function setup(t, html) {
  const env = domRuntime(html);
  t.after(() => env.window.close());
  return { ...env, api: loadTS('packages/scripts/src/utils/question.ts', env.globals) };
}

test('empty underline runs merge across inline formatting but retain separate lines and paragraphs', t => {
  const e = setup(t, '<style>.blank {text-decoration: underline}</style><div id="q"><p>甲<span class="blank">&nbsp;</span><u><span> </span></u>乙</p><p><u> </u><br><u> </u></p><p style="text-decoration:underline"> </p><p style="text-decoration:underline"> </p></div>');
  const root = e.document.querySelector('#q'), before = root.innerHTML;
  assert.equal(e.api.questionElementText(root, []), '甲 ____ 乙 ____ ____ ____ ____');
  assert.equal(root.innerHTML, before);
});

test('underlined words, ordinary spacing, hidden blanks, and pictures are not invented blank fields', t => {
  const e = setup(t, '<div id="q">Students(<u>sid</u> char(10)) <span> &nbsp; </span><u hidden> </u><u style="display:none"> </u><u><img src="https://example.test/figure.png"></u></div>');
  const root = e.document.querySelector('#q'), images = e.api.inspectQuestionImages([root]);
  assert.equal(e.api.questionElementText(root, images.imageUrls), 'Students(sid char(10)) [图片1]');
  assert.deepEqual(Array.from(images.imageUrls), ['https://example.test/figure.png']);
});

test('completion answer caches distinguish the page blank count including previously uncounted requests', t => {
  const e = setup(t, '');
  const { questionCacheKey } = loadTS('packages/scripts/src/utils/answer-cache.ts', e.globals, {'./web-ai': { getWebBridgeState() {} }});
  const opts = { aiApiUrl:'https://example.test', aiApiKey:'fixture', aiModel:'fixture', aiTemperature:0 };
  const question = { title:'填写答案', type:'completion', blankCount:6 };
  assert.notEqual(questionCacheKey(opts, question), questionCacheKey(opts, {...question, blankCount:5}));
  assert.notEqual(questionCacheKey(opts, question), questionCacheKey(opts, {...question, blankCount:undefined}));
});

test('the shared cached search forwards the actual blank count to the AI request', async t => {
  const e = setup(t, ''), requests = [], cachedQuestions = [], stubs = {};
  const source = fs.readFileSync(path.join(ROOT, 'packages/scripts/src/projects/common.ts'), 'utf8');
  for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) stubs[match[1]] = {};
  class Script {
    constructor(options) {
      Object.assign(this, options);
      this.cfg = Object.fromEntries(Object.entries(options.configs || {}).map(([key, value]) => [key, value.defaultValue]));
    }
  }
  const h = tag => e.document.createElement(typeof tag === 'string' ? tag : 'div');
  stubs['easy-us'] = { Project:{create:value=>value}, Script, h, $ui:{notes:()=>h('div')}, $message:{error() {}}, $gm:{isInGMContext:()=>false} };
  stubs['@xuexitong-ai-helper/core/src/core/worker/config'] = {WorkerConfig:{}};
  stubs['lodash/debounce'] = callback => callback;
  stubs['../utils/answer-cache'] = {QuestionAnswerCache:class { async search(opts, question, query) { cachedQuestions.push(question); return query(); } }};
  stubs['../utils/ai'] = { queryAIAnswerer:async (_opts, question) => { requests.push(question); return [{name:'fixture', results:[]}]; } };
  const {CommonProject} = loadTS('packages/scripts/src/projects/common.ts', e.globals, stubs);
  const app = CommonProject.scripts.apps;
  await app.methods.call(app).searchAnswerInCaches('select ____ sid', {type:'completion', blankCount:6, providerConfig:{aiProvider:'api'}});
  assert.equal(cachedQuestions[0].blankCount, 6);
  assert.equal(requests[0].blankCount, 6);
});


test('source formatting newlines do not turn one inline underline into multiple blanks', t=>{
  const e=setup(t,'<div id="q">select <u>&nbsp;</u>\n  <u>&nbsp;</u> sid<p><u>&nbsp;</u><br><u>&nbsp;</u></p></div>');
  assert.equal(e.api.questionElementText(e.document.querySelector('#q'),[]),'select ____ sid ____ ____');
});


test('a paragraph boundary before an empty underline cannot merge with an inline blank', t=>{
  const e=setup(t,'<div id="q"><u>&nbsp;</u><p><u>&nbsp;</u></p><u>&nbsp;</u></div>');
  assert.equal(e.api.questionElementText(e.document.querySelector('#q'),[]),'____ ____ ____');
});
test('preformatted text newlines remain visible blank boundaries', t=>{
  for (const wrapper of ['pre','div style="white-space:pre-wrap"','div style="white-space:pre-line"','div style="white-space:break-spaces"']) {
    const tag=wrapper.split(' ')[0];
    const e=setup(t,'<'+wrapper+' id="q"><u>&nbsp;</u>\n  <u>&nbsp;</u></'+tag+'>');
    assert.equal(e.api.questionElementText(e.document.querySelector('#q'),[]),'____ ____',wrapper);
  }
});
