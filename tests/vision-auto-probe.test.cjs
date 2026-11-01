const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, Clock, domRuntime, loadTS, storage, plain } = require('./helpers/runtime.cjs');
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6ioAAAAASUVORK5CYII=';
const defaults = { aiProvider: 'api', aiApiUrl: 'https://api.example.test/v1', aiApiKey: 'fixture-key',
  aiModel: 'fixture-model', aiVisionMode: 'auto', aiTemperature: 0, aiUseResponseFormat: true, aiAnswerTimeout: 60 };
const question = { title: 'PRIVATE COURSE QUESTION [图片1]', type: 'single', options: ['first', 'second'], hasImage: true, imageUrls: [IMAGE] };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function response(answer) { return { choices: [{ message: { content: JSON.stringify({ answer }) }, finish_reason: 'stop' }] }; }
function setup(t, options = {}) {
  const env = domRuntime('', 'https://mooc1.chaoxing.com/work/doHomeWorkNew');
  t.after(() => env.window.close());
  const clock = options.clock || new Clock(), mem = options.mem || storage(), calls = [];
  env.window.HTMLCanvasElement.prototype.getContext = function () {
    return { fillRect() {}, fillText: value => { this.digits = value; } };
  };
  env.window.HTMLCanvasElement.prototype.toDataURL = function () {
    return 'data:image/png;base64,' + Buffer.from(this.digits).toString('base64');
  };
  const globals = { ...env.globals, ...clock.globals(), ...mem.globals };
  const vision = loadTS('packages/scripts/src/utils/vision.ts', globals);
  const ai = loadTS('packages/scripts/src/utils/ai.ts', globals, {
    './web-ai': { getWebBridgeState: () => undefined }, './web-task': { reportWebTaskStatus() {} },
    './vision': vision,
    '@xuexitong-ai-helper/core/src/core/utils/request': { request: async (url, requestOptions) => {
      if (requestOptions.method === 'get') return { max_output_tokens: 1024 };
      const body = plain(requestOptions.data), content = body.messages.find(message => message.role === 'user').content;
      const text = Array.isArray(content) ? content.find(part => part.type === 'text').text : content;
      const dataUrl = Array.isArray(content) ? content.find(part => part.type === 'image_url')?.image_url.url : undefined;
      const isProbe = text.includes('四位数字');
      const digits = isProbe && dataUrl ? Buffer.from(dataUrl.split(',')[1], 'base64').toString() : undefined;
      const call = { url, body, text, dataUrl, isProbe, digits }; calls.push(call);
      if (options.respond) return options.respond(call, calls.length);
      return response(isProbe ? digits : 'A');
    } }
  });
  return { ...env, globals, clock, mem, calls, vision, ai, opts: { ...defaults, ...options.opts } };
}
function settingsSetup(t, options = {}) {
  const e = setup(t, options), notifications = [], listeners = new Map(), source = fs.readFileSync(path.join(ROOT, 'packages/scripts/src/projects/common.ts'), 'utf8');
  const stubs = {};
  for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) stubs[match[1]] = {};
  class Script {
    constructor(options) {
      Object.assign(this, options);
      const values = Object.fromEntries(Object.entries(options.configs || {}).map(([key, config]) => [key, config.defaultValue]));
      if (options.namespace === 'common.settings') Object.assign(values, e.opts);
      this.cfg = new Proxy(values, { set(target, key, value) {
        const previous = target[key]; target[key] = value;
        if (value !== previous) for (const listener of listeners.get(key) || []) listener(value, previous, false);
        return true;
      } });
    }
    onConfigChange(key, callback) { const items = listeners.get(key) || []; items.push(callback); listeners.set(key, items); }
  }
  const h = tag => e.document.createElement(tag);
  stubs['easy-us'] = { Project: { create: value => value }, Script, h, $ui: { notes: () => h('div') },
    $message: Object.fromEntries(['info', 'warn', 'error', 'success'].map(key => [key, value => notifications.push(value)])),
    $modal: { alert: value => notifications.push(value) }, $gm: { isInGMContext: () => false } };
  stubs['../utils/answer-cache'] = { QuestionAnswerCache: class { list() { return []; } } };
  stubs['../utils/vision'] = e.vision; stubs['../utils/ai'] = e.ai;
  stubs['../utils/work'] = { closeAIConfigEmptyWarning() {} };
  stubs['@xuexitong-ai-helper/core/src/core/worker/config'] = { WorkerConfig: {} };
  stubs['lodash/debounce'] = (callback, delay) => {
    let timer;
    const debounced = () => { e.clock.clearTimeout(timer); timer = e.clock.setTimeout(callback, delay); };
    debounced.cancel = () => e.clock.clearTimeout(timer);
    return debounced;
  };
  const { CommonProject } = loadTS('packages/scripts/src/projects/common.ts', e.globals, stubs);
  const settings = CommonProject.scripts.settings;
  settings.panel = h('section'); settings.panel.body = h('div'); settings.panel.append(settings.panel.body);
  settings.panel.body.innerHTML = '<div id="xth-vision-status"></div>';
  e.document.body.append(settings.panel);
  settings.oncomplete.call(settings);
  t.after(() => e.window.dispatchEvent(new e.window.Event('pagehide')));
  return { ...e, settings, cfg: settings.cfg, notifications,
    status: () => settings.panel.body.querySelector('#xth-vision-status').textContent };
}
test('committing a model automatically probes once without a manual button, dialogs, or probing each keystroke', async t => {
  const e = settingsSetup(t, { opts: { aiModel: '' } });
  assert.equal(e.settings.configs.aiVisionTestButton, undefined);
  const input = e.document.createElement('input');
  input.onchange = () => { e.cfg.aiModel = input.value; };
  e.settings.configs.aiModel.onload.call(input);
  input.value = 'new-model'; input.dispatchEvent(new e.window.Event('input'));
  await e.clock.advance(1000); assert.equal(e.calls.length, 0); assert.equal(e.cfg.aiModel, '');
  input.dispatchEvent(new e.window.Event('change'));
  await e.clock.advance(599); assert.equal(e.calls.length, 0);
  await e.clock.advance(1); assert.equal(e.calls.length, 1); assert.equal(e.calls[0].isProbe, true);
  assert.equal(e.calls[0].body.response_format, undefined);
  assert.ok(!e.calls[0].text.includes(e.calls[0].digits)); assert.ok(!e.calls[0].text.includes('PRIVATE COURSE'));
  assert.match(e.status(), /自动验证支持图片/); assert.deepEqual(e.notifications, []);
  await e.clock.advance(10000); assert.equal(e.calls.length, 1);
});
test('saved configurations are automatically tested even when model metadata claims no image support', async t => {
  const e = settingsSetup(t);
  e.vision.rememberVisionCapability(e.opts, 'unsupported', 'metadata');
  await e.clock.advance(600);
  assert.equal(e.calls.length, 1); assert.equal(e.vision.getVisionCapability(e.opts).source, 'probe');
  assert.equal(e.vision.getVisionCapability(e.opts).state, 'supported');
});
test('rapid configuration changes are coalesced and only the final API/key/model is tested', async t => {
  const e = settingsSetup(t);
  e.cfg.aiModel = 'intermediate'; await e.clock.advance(400);
  e.cfg.aiApiUrl = 'https://final.example.test/v1'; e.cfg.aiApiKey = 'final-key'; e.cfg.aiModel = 'final-model';
  await e.clock.advance(600);
  assert.equal(e.calls.length, 1); assert.equal(e.calls[0].body.model, 'final-model');
  assert.match(e.calls[0].url, /^https:\/\/final\.example\.test/); assert.deepEqual(e.notifications, []);
});
test('concurrent requests and separate contexts share a probe; reloading reuses the persisted result', async t => {
  const clock = new Clock(), mem = storage(), gate = deferred();
  const first = setup(t, { clock, mem, respond: async call => { await gate.promise; return response(call.digits); } });
  const second = setup(t, { clock, mem });
  const pending = [first.ai.ensureVisionModelProbed(first.opts), first.ai.ensureVisionModelProbed(first.opts), second.ai.ensureVisionModelProbed(second.opts)];
  await clock.flush(); assert.equal(first.calls.length, 1); assert.equal(second.calls.length, 0);
  assert.equal(first.vision.getVisionProbeStatus(first.opts), 'pending');
  gate.resolve(); await clock.advance(100); await Promise.all(pending);
  const reloaded = setup(t, { clock, mem }); await reloaded.ai.ensureVisionModelProbed(reloaded.opts);
  assert.equal(reloaded.calls.length, 0); assert.equal(reloaded.vision.getVisionProbeStatus(reloaded.opts), 'complete');
  assert.equal(clock.timers.size, 0);
});
test('API URL, key and model identify results independently, while surrounding whitespace does not repeat a probe', async t => {
  const e = setup(t);
  await e.ai.ensureVisionModelProbed(e.opts);
  await e.ai.ensureVisionModelProbed({ ...e.opts, aiApiUrl: '  ' + e.opts.aiApiUrl + '/  ', aiApiKey: '  fixture-key  ', aiModel: '  fixture-model  ' });
  assert.equal(e.calls.length, 1);
  for (const change of [{ aiApiUrl: 'https://other.example.test/v1' }, { aiApiKey: 'other-key' }, { aiModel: 'other-model' }])
    await e.ai.ensureVisionModelProbed({ ...e.opts, ...change });
  assert.equal(e.calls.length, 4);
});
for (const failure of ['wrong-answer', 'network', 'unsupported']) test(failure + ' probe stays silent and is not repeated or replaced by model metadata', async t => {
  const e = setup(t, { respond: () => {
    if (failure === 'network') throw { responseText: 'HTTP 503' };
    if (failure === 'unsupported') throw { responseText: 'This model does not support image input' };
    return response('not the image');
  } });
  await e.ai.ensureVisionModelProbed(e.opts); await e.ai.ensureVisionModelProbed(e.opts);
  assert.equal(e.calls.length, 1);
  const state = failure === 'unsupported' ? 'unsupported' : 'unknown';
  assert.equal(e.vision.getVisionCapability(e.opts).state, state);
  e.vision.rememberVisionCapability(e.opts, 'supported', 'metadata');
  e.vision.rememberVisionCapability(e.opts, 'supported', 'request');
  assert.equal(e.vision.getVisionCapability(e.opts).state, state);
  assert.equal(e.vision.getVisionProbeStatus(e.opts), 'complete');
  const result = await e.ai.queryAIAnswerer(e.opts, question);
  assert.ok(result[0].error); assert.equal(e.calls.length, 1);
});
test('an image question waits for its background test, then sends the real question with the image', async t => {
  const gate = deferred(), e = setup(t, { respond: async call => {
    if (call.isProbe) await gate.promise;
    return response(call.isProbe ? call.digits : 'A');
  } });
  const background = e.ai.ensureVisionModelProbed(e.opts), answer = e.ai.queryAIAnswerer(e.opts, question);
  await e.clock.flush(); assert.equal(e.calls.length, 1); assert.equal(e.calls[0].isProbe, true);
  gate.resolve(); await background; const result = await answer;
  assert.equal(e.calls.length, 2); assert.equal(e.calls[1].isProbe, false); assert.equal(e.calls[1].dataUrl, IMAGE);
  assert.equal(result[0].results[0].answer, 'A');
  await e.ai.ensureVisionModelProbed(e.opts); assert.equal(e.calls.length, 2);
});
test('cancelling a question waiting for the probe promptly stops that question and clears its timer', async t => {
  const gate = deferred(); let cancelled = false;
  const e = setup(t, { respond: async call => { await gate.promise; return response(call.digits); } });
  const background = e.ai.ensureVisionModelProbed(e.opts);
  const rejected = assert.rejects(e.ai.queryAIAnswerer(e.opts, question, { isCancelled: () => cancelled }), /取消/);
  await e.clock.flush(); cancelled = true; await e.clock.advance(100); await rejected;
  gate.resolve(); await background; assert.equal(e.calls.length, 1); assert.equal(e.clock.timers.size, 0);
});
test('late results from an earlier model never replace the active model result', async t => {
  const gate = deferred(), e = setup(t, { respond: async call => {
    if (call.body.model === 'fixture-model') { await gate.promise; return response('wrong'); }
    return response(call.digits);
  } });
  const previous = e.ai.ensureVisionModelProbed(e.opts), current = { ...e.opts, aiModel: 'new-model' };
  await e.ai.ensureVisionModelProbed(current); gate.resolve(); await previous;
  assert.equal(e.vision.getVisionCapability(current).state, 'supported');
  assert.equal(e.vision.getVisionCapability(e.opts).state, 'unknown');
});
test('web mode, incomplete settings and invalid API addresses never trigger API probes', async t => {
  const e = setup(t);
  for (const change of [{ aiProvider: 'deepseek-web' }, { aiApiUrl: '' }, { aiApiKey: '' }, { aiModel: '' }, { aiApiUrl: 'file:///invalid' }])
    await e.ai.ensureVisionModelProbed({ ...e.opts, ...change });
  assert.equal(e.calls.length, 0); assert.equal(e.mem.writes.length, 0);
});
test('expired or abandoned probe reservations can be tested again', async t => {
  const e = setup(t);
  assert.equal(e.vision.claimVisionProbe(e.opts, 1000), true);
  const waiting = e.ai.ensureVisionModelProbed(e.opts);
  await e.clock.advance(1000); await waiting; assert.equal(e.calls.length, 1);
  await e.clock.advance(7 * 24 * 60 * 60 * 1000); await e.ai.ensureVisionModelProbed(e.opts);
  assert.equal(e.calls.length, 2); assert.equal(e.clock.timers.size, 0);
});
test('an inconclusive probe can retry after a short cooldown instead of blocking images for seven days', async t => {
  let unavailable = true;
  const e = setup(t, { respond: call => unavailable ? response('unknown') : response(call.digits) });
  await e.ai.ensureVisionModelProbed(e.opts); unavailable = false;
  await e.clock.advance(5 * 60 * 1000 - 1); await e.ai.ensureVisionModelProbed(e.opts);
  assert.equal(e.calls.length, 1);
  await e.clock.advance(1); await e.ai.ensureVisionModelProbed(e.opts);
  assert.equal(e.calls.length, 2); assert.equal(e.vision.getVisionCapability(e.opts).state, 'supported');
});
test('text-only questions continue immediately while the background image test is pending', async t => {
  const gate = deferred(), e = setup(t, { respond: async call => {
    if (call.isProbe) await gate.promise;
    return response(call.isProbe ? call.digits : 'A');
  } });
  const background = e.ai.ensureVisionModelProbed(e.opts);
  const result = await e.ai.queryAIAnswerer(e.opts, { title: 'A text question', type: 'single', options: ['first', 'second'] });
  assert.equal(result[0].results[0].answer, 'A'); assert.equal(e.calls.length, 2);
  assert.equal(e.vision.getVisionProbeStatus(e.opts), 'pending'); gate.resolve(); await background;
});
