const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const { webcrypto } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const compiled = new Map();
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

class Clock {
  constructor(now = 100000) {
    this.now = now;
    this.next = 1;
    this.timers = new Map();
    const clock = this;
    this.Date = class extends Date {
      constructor(...args) { super(...(args.length ? args : [clock.now])); }
      static now() { return clock.now; }
    };
    this.setTimeout = (fn, ms = 0) => this.add(fn, ms, 0);
    this.setInterval = (fn, ms = 1) => this.add(fn, ms, Math.max(1, ms));
    this.clearTimeout = this.clearInterval = id => this.timers.delete(id);
  }
  add(fn, ms, interval) {
    const id = this.next++;
    this.timers.set(id, { fn, due: this.now + Math.max(0, ms), interval });
    return id;
  }
  async flush() { for (let i = 0; i < 50; i++) await Promise.resolve(); }
  async advance(ms) {
    const until = this.now + ms;
    await this.flush();
    let runs = 0;
    for (;;) {
      let nextId, next;
      for (const [id, timer] of this.timers) {
        if (timer.due <= until && (!next || timer.due < next.due)) { next = timer; nextId = id; }
      }
      if (!next) break;
      if (++runs > 100000) throw new Error('Virtual timer runaway');
      this.now = next.due;
      if (next.interval) next.due += next.interval;
      else this.timers.delete(nextId);
      next.fn();
      await this.flush();
    }
    this.now = until;
    await this.flush();
  }
  globals() {
    return { Date: this.Date, setTimeout: this.setTimeout, clearTimeout: this.clearTimeout,
      setInterval: this.setInterval, clearInterval: this.clearInterval };
  }
}

function domRuntime(html = '', url = 'https://chat.deepseek.com/#xth-bridge') {
  const dom = new JSDOM('<!doctype html><html><body>' + html + '</body></html>', { url });
  const w = dom.window;
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; }, set(value) { this.textContent = value; }, configurable: true
  });
  w.HTMLElement.prototype.getClientRects = function () {
    return this.hidden || this.closest('[hidden], [style*="display: none"]') ? [] : [{}];
  };
  const globals = { window: w, document: w.document, location: w.location, sessionStorage: w.sessionStorage,
    Event: w.Event, KeyboardEvent: w.KeyboardEvent, Node: w.Node, HTMLElement: w.HTMLElement,
    HTMLTextAreaElement: w.HTMLTextAreaElement, HTMLInputElement: w.HTMLInputElement,
    HTMLSelectElement: w.HTMLSelectElement, File: w.File, URL: w.URL, crypto: webcrypto,
    atob: text => Buffer.from(text, 'base64').toString('binary') };
  return { dom, window: w, document: w.document, globals };
}

function loadTS(entry, globals = {}, stubs = {}) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval,
    URL, crypto: webcrypto, ...globals });
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    let code = compiled.get(file);
    if (!code) {
      code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true
      }, fileName: file }).outputText;
      compiled.set(file, code);
    }
    const module = { exports: {} };
    cache.set(file, module);
    const localRequire = name => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      let target;
      if (name.startsWith('.')) target = path.resolve(path.dirname(file), name);
      else if (name.startsWith('@xuexitong-ai-helper/core/'))
        target = path.join(ROOT, 'packages/core', name.slice('@xuexitong-ai-helper/core/'.length));
      if (target) {
        const resolved = [target + '.ts', target + '.js', path.join(target, 'index.ts'), target]
          .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!resolved) throw new Error('Unresolved import: ' + name);
        return load(resolved);
      }
      return require(name);
    };
    const fn = new vm.Script('(function(require, module, exports) {\n' + code + '\n})', { filename: file }).runInContext(context);
    fn(localRequire, module, module.exports);
    return module.exports;
  }
  return load(path.resolve(ROOT, entry));
}

function storage() {
  const values = new Map(), listeners = new Map(), writes = [];
  let next = 1;
  return { values, writes, globals: {
    GM_getValue: (key, fallback) => values.has(key) ? plain(values.get(key)) : fallback,
    GM_setValue: (key, value) => {
      const old = plain(values.get(key));
      values.set(key, plain(value));
      writes.push({key, value:plain(value)});
      for (const [, listener] of listeners) if (listener.key === key)
        queueMicrotask(() => listener.fn(key, old, plain(value), true));
    },
    GM_deleteValue: key => {
      const old = plain(values.get(key));
      values.delete(key);
      for (const [, listener] of listeners) if (listener.key === key)
        queueMicrotask(() => listener.fn(key, old, undefined, true));
    },
    GM_listValues: () => [...values.keys()],
    GM_addValueChangeListener: (key, fn) => { const id = next++; listeners.set(id, {key,fn}); return id; },
    GM_removeValueChangeListener: id => listeners.delete(id)
  }};
}
module.exports = { ROOT, Clock, domRuntime, loadTS, storage, plain };
