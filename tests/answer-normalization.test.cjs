const test = require('node:test');
const assert = require('node:assert/strict');
const { domRuntime, loadTS } = require('./helpers/runtime.cjs');

function setup(t, html = '') {
  const env = domRuntime(html); t.after(() => env.window.close());
  return { ...env, ai: loadTS('packages/scripts/src/utils/ai.ts', env.globals) };
}

for (const [answer, options, expected] of [
  ['1', ['错误', '正确'], 'B'],
  ['0', ['错误', '正确'], 'A'],
  ['T', ['错误', '正确'], 'B'],
  ['F', ['错误', '正确'], 'A'],
  ['答案：正确。', ['×', '√'], 'B'],
  ['判断：錯誤', ['對', '錯'], 'B']
]) test('judgement maps semantic answer ' + answer + ' to the actual option order', t => {
  const e = setup(t);
  assert.equal(e.ai.normalizeAnswerByQuestionType(answer, 'judgement', undefined, options), expected);
});

for (const parts of [['TCP/IP'], ['TCP/IP', 'UDP'], ['C#', 'Rust']]) {
  test('multiple choice preserves punctuation inside answer text: ' + parts.join(' + '), t => {
    const e = setup(t), options = ['TCP/IP', 'UDP', 'C#', 'Rust'];
    const answer = parts.join('#');
    const expected = parts.map(part => String.fromCharCode(65 + options.indexOf(part))).join('#');
    assert.equal(e.ai.normalizeAnswerByQuestionType(answer, 'multiple', undefined, options, {
      rawContent: JSON.stringify({ answer, answers: parts })
    }), expected);
  });
}

for (const [answers, labels, expected] of [
  [['abcdefghijklmnopqrss', 'uvwxyz0123456789abcdef'], ['abcdefghijklmnopqrst', 'uvwxyz0123456789abcdef'], ['uvwxyz0123456789abcdef']],
  [['a completely unknown answer'], ['', 'another option'], []]
]) test('legacy multiple matching ranks confidence and ignores empty image labels: ' + answers[0], async t => {
  const e = setup(t);
  const options = labels.map(label => { const el = e.document.createElement('label'); el.textContent = label; return el; });
  const { createDefaultQuestionResolver } = loadTS('packages/core/src/core/worker/question.resolver.ts', e.globals);
  const seen = [];
  const result = await createDefaultQuestionResolver({ answerMatchMode: 'similar' }).multiple(
    [{ name: 'legacy', results: answers.map(answer => ({ answer })) }], options,
    (_type, answer, option) => { seen.push({ answer, label: option.textContent }); }
  );
  assert.deepEqual(seen.map(item => item.label), expected);
  if (expected.length) assert.equal(seen[0].answer, expected[0]);
  else assert.equal(result.finish, false);
});

for (const provider of ['api', 'deepseek-web', 'api-retry']) test(provider + ' normalizes structured multi answers and writes every choice', async t => {
  const e = setup(t, '<div id="q">' + ['C#', 'Rust', 'Go'].map((label, index) =>
    '<li><input type="checkbox" id="o' + index + '"><label for="o' + index + '">' + label + '</label></li>').join('') + '</div>');
  let calls = 0;
  const raw = JSON.stringify({ answer: 'C##Rust', answers: ['C#', 'Rust'] });
  const ai = loadTS('packages/scripts/src/utils/ai.ts', e.globals, {
    './web-ai': { getWebBridgeState: () => ({ id: 'fixture' }), requestWebAnswer: async () => { calls++; return raw; } },
    './web-task': { reportWebTaskStatus() {} },
    '@xuexitong-ai-helper/core/src/core/utils/request': { request: async (_url, opts) => {
      if (opts.method === 'get') return { max_output_tokens: 4096 };
      return { choices: [{ message: { content: ++calls === 1 && provider === 'api-retry' ? '{"answer":"Z"}' : raw }, finish_reason: 'stop' }] };
    } }
  });
  const infos = await ai.queryAIAnswerer({ aiProvider: provider === 'deepseek-web' ? provider : 'api', aiApiUrl: 'https://example.test/v1', aiApiKey: 'fixture',
    aiModel: 'fixture', aiTemperature: 0, aiUseResponseFormat: false }, { type: 'multiple', title: '选择语言', options: ['C#', 'Rust', 'Go'] });
  assert.equal(infos[0].error, undefined);
  assert.equal(infos[0].results[0]?.answer, 'A#B');
  assert.equal(calls, provider === 'api-retry' ? 2 : 1);
  const root = e.document.querySelector('#q'), options = [...root.querySelectorAll('label')];
  const writer = loadTS('packages/scripts/src/utils/answer-writer.ts', e.globals);
  assert.equal((await writer.fillStandardAnswer({ root, elements: { options }, searchInfos: infos, answerMatchMode: 'similar' }, 'multiple', async () => {})).finish, true);
  assert.deepEqual([...root.querySelectorAll(':checked')].map(input => input.id), ['o0', 'o1']);
});

test('ordinary letters, reversed boolean labels and invalid choices retain strict boundaries', t => {
  const e = setup(t), normalize = e.ai.normalizeAnswerByQuestionType;
  for (const [answer, type, options, expected] of [
    ['B', 'judgement', ['正确', '错误'], 'B'],
    ['1', 'judgement', ['正确', '错误'], 'A'],
    ['0', 'judgement', ['正确', '错误'], 'B'],
    ['1', 'judgement', ['[图片1]', '[图片2]'], ''],
    ['n!', 'single', ['n', 'n!'], 'B'],
    ['C、A', 'multiple', ['甲', '乙', '丙'], 'A#C'],
    ['TCP/IP#UDP', 'multiple', ['TCP/IP', 'UDP'], 'A#B'],
    ['A#Z', 'multiple', ['甲', '乙'], ''],
    ['not an answer', 'judgement', ['正确', '错误'], '']
  ]) assert.equal(normalize(answer, type, undefined, options), expected, answer);
});

for (const type of ['single', 'multiple']) test('legacy ' + type + ' exact formula text wins over punctuation-stripped similarity', async t => {
  const e = setup(t);
  const options = ['2', '-2'].map(text => { const label = e.document.createElement('label'); label.textContent = text; return label; });
  const { createDefaultQuestionResolver } = loadTS('packages/core/src/core/worker/question.resolver.ts', e.globals);
  const selected = [];
  const result = await createDefaultQuestionResolver({ answerMatchMode: 'similar' })[type](
    [{ name: 'legacy', results: [{ answer: '-2' }] }], options,
    (_type, _answer, option) => { selected.push(option.textContent); }
  );
  assert.equal(result.finish, true);
  assert.deepEqual(selected, ['-2']);
});
