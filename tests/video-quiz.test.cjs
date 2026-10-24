const test = require('node:test');
const assert = require('node:assert/strict');
const { Clock, domRuntime, loadTS } = require('./helpers/runtime.cjs');
function markup(type = 'radio', title = 'Question one', count = 3) {
  return '<div class="ans-videoquiz"><div class="ans-videoquiz-title">' + title + '</div><div class="ans-videoquiz-opt">' +
    Array.from({ length: count }, (_, i) => '<label><input type="' + type + '" name="quiz" value="' + String.fromCharCode(65 + i) + '">' + String.fromCharCode(65 + i) + '</label>').join('') +
    '</div><div class="ans-videoquiz-feedback" role="alert"></div><button id="videoquiz-submit">submit</button></div>';
}
function setup(t, type = 'radio', settings = {}) {
  const e = domRuntime(markup(type)), clock = new Clock(), abort = new AbortController(), notifications = [];
  t.after(() => e.window.close()); let automatic = true;
  const api = loadTS('packages/scripts/src/utils/video-quiz.ts', { ...e.globals, ...clock.globals() });
  const controller = api.createVideoQuizController(e.document, { signal: abort.signal, automatic: () => automatic,
    onQuestion: value => notifications.push(value), ...settings });
  const selected = () => [...e.document.querySelectorAll('.ans-videoquiz:not([hidden]) input:checked')].map(input => input.value).join('');
  const attempts = [];
  let onSubmit = () => {};
  function bind() {
    e.document.querySelector('#videoquiz-submit').onclick = () => { attempts.push(selected()); onSubmit(selected()); };
  }
  bind();
  return { ...e, clock, abort, controller, notifications, attempts, selected, bind,
    manual(value = true) { automatic = !value; }, onSubmit(fn) { onSubmit = fn; },
    async retry() { await clock.advance(3000); controller.tick(); } };
}
test('a wrong single choice is replaced by B then C, and a native hide ends all submissions', async t => {
  const e = setup(t); e.onSubmit(answer => {
    if (answer === 'C') e.document.querySelector('.ans-videoquiz').style.display = 'none';
    else e.document.querySelector('[role="alert"]').textContent = '回答错误，请重新选择';
  });
  assert.equal(e.controller.isBlocked(), true); e.controller.tick(); assert.deepEqual(e.attempts, ['A']);
  await e.retry(); assert.deepEqual(e.attempts, ['A', 'B']);
  await e.retry(); assert.deepEqual(e.attempts, ['A', 'B', 'C']); assert.equal(e.controller.isBlocked(), false);
  await e.retry(); assert.deepEqual(e.attempts, ['A', 'B', 'C']); assert.equal(e.notifications.length, 1);
  assert.equal(e.clock.timers.size, 0);
});
test('repeated polling cannot submit more often than every three seconds', async t => {
  const e = setup(t); e.controller.tick();
  for (let i = 0; i < 10; i++) e.controller.tick();
  await e.clock.advance(2999); e.controller.tick(); assert.deepEqual(e.attempts, ['A']);
  await e.clock.advance(1); e.controller.tick(); assert.deepEqual(e.attempts, ['A', 'B']);
});
test('all wrong options rotate without repeating the same choice and keep retrying until the question disappears', async t => {
  const e = setup(t); e.controller.tick(); for (let i = 0; i < 4; i++) await e.retry();
  assert.deepEqual(e.attempts, ['A', 'B', 'C', 'A', 'B']);
  e.document.querySelector('.ans-videoquiz').remove(); await e.retry(); await e.retry();
  assert.equal(e.attempts.length, 5); assert.equal(e.controller.isBlocked(), false);
});
test('multiple choice enumerates combinations and clears previously wrong checkbox selections', async t => {
  const e = setup(t, 'checkbox'); e.onSubmit(answer => {
    if (answer === 'BC') e.document.querySelector('.ans-videoquiz').remove();
  });
  e.controller.tick(); for (let i = 0; i < 7; i++) await e.retry();
  assert.deepEqual(e.attempts, ['A', 'B', 'AB', 'C', 'AC', 'BC']);
  assert.equal(e.controller.isBlocked(), false); assert.equal(e.clock.timers.size, 0);
});
test('native disabled or busy submissions do not consume the next answer', async t => {
  const e = setup(t), button = e.document.querySelector('button'); e.controller.tick();
  button.disabled = true; await e.retry(); assert.deepEqual(e.attempts, ['A']);
  button.disabled = false; button.setAttribute('aria-busy', 'true'); await e.retry(); assert.deepEqual(e.attempts, ['A']);
  button.removeAttribute('aria-busy'); await e.retry(); assert.deepEqual(e.attempts, ['A', 'B']);
});
test('a submit button initially disabled until selection is enabled by the native option event', t => {
  const e = setup(t), button = e.document.querySelector('button'); button.disabled = true;
  e.document.querySelectorAll('input').forEach(input => input.onchange = () => { button.disabled = false; });
  e.controller.tick(); assert.deepEqual(e.attempts, ['A']);
});
test('a wrong-answer rerender does not reset the choice cursor back to A', async t => {
  const e = setup(t); e.onSubmit(answer => {
    if (answer === 'A') { e.document.body.innerHTML = markup(); e.bind(); }
    else e.document.querySelector('.ans-videoquiz').remove();
  });
  e.controller.tick(); await e.retry(); assert.deepEqual(e.attempts, ['A', 'B']);
});
test('reusing the same submit element for a new question resets options and attempts independently', async t => {
  const e = setup(t), button = e.document.querySelector('button'); e.controller.tick(); await e.retry();
  e.document.querySelector('.ans-videoquiz-title').textContent = 'A different question';
  e.controller.tick(); assert.equal(e.document.querySelector('button'), button);
  assert.deepEqual(e.attempts, ['A', 'B', 'A']); assert.equal(e.notifications.length, 2);
});
test('hidden stale questions are ignored in favor of the visible native submit button', t => {
  const e = setup(t); e.document.body.innerHTML = '<div style="display: none">' + markup() + '</div>' + markup('radio', 'Visible');
  const buttons = e.document.querySelectorAll('button'), attempts = [];
  buttons[0].onclick = () => assert.fail('hidden submit was clicked');
  buttons[1].onclick = () => attempts.push('visible');
  e.controller.tick(); assert.deepEqual(attempts, ['visible']);
});
test('manual mode leaves the native question untouched, and switching automatic mode starts retrying', async t => {
  const e = setup(t); e.manual(); e.controller.tick(); await e.retry();
  assert.equal(e.selected(), ''); assert.deepEqual(e.attempts, []); assert.equal(e.controller.isBlocked(), true);
  e.manual(false); e.controller.tick(); assert.deepEqual(e.attempts, ['A']);
});
test('leaving the page cancels any further selection and submission without keeping a timer', async t => {
  const e = setup(t); e.controller.tick(); e.abort.abort(); await e.retry(); await e.retry();
  assert.deepEqual(e.attempts, ['A']); assert.equal(e.selected(), 'A');
  assert.equal(e.controller.isBlocked(), false); assert.equal(e.clock.timers.size, 0);
});
test('cancelling from an option handler does not click any subsequent checkbox or submit', t => {
  const e = setup(t, 'checkbox'); e.document.querySelector('input').onclick = () => e.abort.abort();
  e.controller.tick(); assert.deepEqual(e.attempts, []); assert.equal(e.selected(), 'A');
});
test('the controller does not remove or hide native questions, error messages or unrelated verification overlays', async t => {
  const e = setup(t); const overlay = e.document.createElement('div'); overlay.className = 'x-component-default';
  overlay.textContent = 'manual verification'; e.document.body.append(overlay);
  e.onSubmit(() => { e.document.querySelector('[role="alert"]').textContent = 'wrong'; });
  e.controller.tick(); await e.retry();
  assert.ok(e.document.querySelector('.ans-videoquiz')); assert.equal(e.document.querySelector('[role="alert"]').textContent, 'wrong');
  assert.equal(overlay.style.display, ''); assert.equal(overlay.isConnected, true);
});
