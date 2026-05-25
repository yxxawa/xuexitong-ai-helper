"use strict";
/* global  EventListener  */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Script = exports.BaseScript = void 0;
const common_1 = require("../utils/common");
const store_1 = require("../utils/store");
const common_2 = require("./common");
const events_1 = __importDefault(require("events"));
class BaseScript extends common_2.CommonEventEmitter {
}
exports.BaseScript = BaseScript;
/**
 * 脚本
 */
class Script extends BaseScript {
    get configs() {
        if (!this._resolvedConfigs) {
            this._resolvedConfigs = typeof this._configs === 'function' ? this._configs() : this._configs;
        }
        return this._resolvedConfigs;
    }
    set configs(c) {
        this._configs = c;
    }
    constructor({ name, namespace, matches, excludes, configs, hideInPanel, onstart, onactive, oncomplete, onbeforeunload, onrender, onhistorychange, methods, priority }) {
        super();
        /** 排除的链接 [链接的解释,链接/正则表达式][] */
        this.excludes = [];
        /** 通过 configs 映射并经过解析后的配置对象 */
        this.cfg = {};
        /** 脚本暴露给外部调用的方法 */
        this.methods = Object.create({});
        /** 自定义事件触发器，避免使用 script.emit , script.on 导致与原有的事件冲突，使用 script.event.emit 和 script.event.on */
        this.event = new events_1.default();
        this.name = name;
        this.namespace = namespace;
        this.matches = matches;
        this.excludes = excludes;
        this._configs = configs;
        this.hideInPanel = hideInPanel;
        this.onstart = this.errorHandler(onstart);
        this.onactive = this.errorHandler(onactive);
        this.oncomplete = this.errorHandler(oncomplete);
        this.onbeforeunload = this.errorHandler(onbeforeunload);
        this.onrender = this.errorHandler(onrender);
        this.onhistorychange = this.errorHandler(onhistorychange);
        this.methods = (methods === null || methods === void 0 ? void 0 : methods.bind(this)()) || Object.create({});
        this.priority = priority !== null && priority !== void 0 ? priority : 0;
        if (this.methods) {
            for (const key in methods) {
                if (Reflect.has(this.methods, key) && typeof this.methods[key] !== 'function') {
                    Reflect.set(this.methods, key, this.errorHandler(this.methods[key]));
                }
            }
        }
    }
    onConfigChange(key, handler) {
        const _key = common_1.$.namespaceKey(this.namespace, key.toString());
        return store_1.$store.addChangeListener(_key, (curr, pre, remote) => {
            handler(curr, pre, !!remote);
        });
    }
    offConfigChange(listener) {
        store_1.$store.removeChangeListener(listener);
    }
    /**
     * 获取全路径名
     */
    fullName() {
        return this.projectName ? `${this.projectName}-${this.name}` : this.name;
    }
    errorHandler(func) {
        return (...args) => {
            try {
                return func === null || func === void 0 ? void 0 : func.apply(this, args);
            }
            catch (err) {
                console.error(err);
                if (err instanceof Error) {
                    this.emit('scripterror', err.message);
                }
                else {
                    this.emit('scripterror', String(err));
                }
            }
        };
    }
}
exports.Script = Script;
