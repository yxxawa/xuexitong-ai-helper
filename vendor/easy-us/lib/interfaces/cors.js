"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cors = exports.CorsEventEmitter = void 0;
const utils_1 = require("../utils");
const common_1 = require("../utils/common");
const const_1 = require("../utils/const");
const store_1 = require("../utils/store");
/**
 * 跨域脚本事件通讯
 */
class CorsEventEmitter {
    constructor() {
        this.eventMap = new Map();
    }
    eventKey(name) {
        return 'cors.events.' + name;
    }
    tempKey(...args) {
        return ['_temp_', ...args].join('.');
    }
    keyOfReturn(id) {
        return this.tempKey('event', id, 'return');
    }
    keyOfArguments(id) {
        return this.tempKey('event', id, 'arguments');
    }
    keyOfState(id) {
        return this.tempKey('event', id, 'state');
    }
    /**
     * 提交事件
     * @param name 事件名
     * @param args 事件参数
     * @param callback 事件回调，可以接收返回值
     */
    cleanupExpired(uid) {
        for (const metaKey of store_1.$store.list().filter(key => /^_temp_\.event\.[0-9a-z]{32}\.meta$/.test(key))) {
            const meta = store_1.$store.get(metaKey);
            if (!meta || meta.owner !== uid || meta.expiresAt > Date.now()) continue;
            const id = metaKey.split('.')[2];
            for (const suffix of ['state', 'return', 'arguments', 'meta'])
                store_1.$store.delete(this.tempKey('event', id, suffix));
            if (meta.queue) {
                const remaining = String(store_1.$store.get(meta.queue) || '').split(',').filter(item => item && item !== id);
                if (remaining.length) store_1.$store.set(meta.queue, remaining.join(','));
                else store_1.$store.delete(meta.queue);
            }
        }
    }
    emit(name, args = [], callback, onError) {
        store_1.$store.getTab(const_1.$const.TAB_UID).then((uid) => {
            this.cleanupExpired(uid);
            const id = common_1.$.uuid().replace(/-/g, '');
            const key = uid + '.' + this.eventKey(name);
            const metaKey = this.tempKey('event', id, 'meta');
            let listenerId, timeout;
            let settled = false;
            const finish = (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (listenerId !== undefined) store_1.$store.removeChangeListener(listenerId);
                const value = store_1.$store.get(this.keyOfReturn(id));
                // Only this request's keys and queue entry belong to this sender.
                for (const suffix of ['state', 'return', 'arguments', 'meta'])
                    store_1.$store.delete(this.tempKey('event', id, suffix));
                const pending = String(store_1.$store.get(key) || '').split(',').filter(item => item && item !== id);
                if (pending.length) store_1.$store.set(key, pending.join(','));
                else store_1.$store.delete(key);
                if (error) { if (onError) onError(error); else console.error(error); }
                else if (callback) callback(value);
            };
            store_1.$store.set(metaKey, { owner: uid, queue: key, expiresAt: Date.now() + 30 * 60 * 1000 });
            store_1.$store.set(this.keyOfState(id), 0);
            store_1.$store.set(this.keyOfArguments(id), args);
            timeout = setTimeout(() => finish(new Error('跨页面请求超时，请重试。')), 30 * 60 * 1000);
            // Some managers deliver the initial state=0 after listener registration.
            listenerId = store_1.$store.addChangeListener(this.keyOfState(id), (current) => {
                if (current === 1) finish();
                else if (current === 2) finish(new Error(String(store_1.$store.get(this.keyOfReturn(id)) || '跨页面请求失败')));
            });
            const pending = String(store_1.$store.get(key) || '').split(',').filter(Boolean);
            store_1.$store.set(key, pending.concat(id).join(','));
        }).catch(error => { if (onError) onError(error); else console.error(error); });
    }
    /** Listen only to this tab's queue; completion, deletion and failure are distinct states. */
    on(name, handler) {
        return store_1.$store.getTab(const_1.$const.TAB_UID).then((uid) => {
            this.cleanupExpired(uid);
            const key = uid + '.' + this.eventKey(name);
            if (this.eventMap.has(key)) return this.eventMap.get(key);
            const processing = new Set();
            const consume = async (current) => {
                if (current === undefined) return;
                const ids = store_1.$store.list().filter(metaKey => /^_temp_\.event\.[0-9a-z]{32}\.meta$/.test(metaKey))
                    .filter(metaKey => store_1.$store.get(metaKey)?.queue === key).map(metaKey => metaKey.split('.')[2]);
                for (const id of ids) {
                    const meta = store_1.$store.get(this.tempKey('event', id, 'meta'));
                    if (processing.has(id) || !meta || meta.owner !== uid || meta.expiresAt <= Date.now() ||
                        store_1.$store.get(this.keyOfState(id)) !== 0) continue;
                    processing.add(id);
                    try {
                        const value = await handler(store_1.$store.get(this.keyOfArguments(id)));
                        if (store_1.$store.get(this.keyOfState(id)) === 0) {
                            store_1.$store.set(this.keyOfReturn(id), value);
                            store_1.$store.set(this.keyOfState(id), 1);
                        }
                    } catch (error) {
                        if (store_1.$store.get(this.keyOfState(id)) === 0) {
                            store_1.$store.set(this.keyOfReturn(id), error instanceof Error ? error.message : String(error));
                            store_1.$store.set(this.keyOfState(id), 2);
                        }
                    } finally { processing.delete(id); }
                }
            };
            const listenerId = store_1.$store.addChangeListener(key, current => { void consume(current); });
            this.eventMap.set(key, listenerId);
            void consume(store_1.$store.get(key));
            return listenerId;
        });
    }
    off(name) {
        for (const [key, id] of this.eventMap) {
            if (key.endsWith('.' + this.eventKey(name))) {
                this.eventMap.delete(key);
                store_1.$store.removeChangeListener(id);
            }
        }
    }
    defineTopFunction(func) {
        if (utils_1.$gm.isInGMContext() === false) {
            return (() => { });
        }
        const event_name = '_top_function_.' + getFuncId(func);
        if (self === top) {
            exports.cors.on(event_name, (args) => __awaiter(this, void 0, void 0, function* () {
                return yield func(...args);
            }));
        }
        return (...args) => __awaiter(this, void 0, void 0, function* () {
            if (self === top) {
                return (yield func(...args));
            }
            const res = yield new Promise((resolve, reject) => {
                try {
                    exports.cors.emit(event_name, args, (val) => {
                        resolve(val);
                    }, reject);
                }
                catch (e) {
                    reject(e);
                }
            });
            return res;
        });
    }
}
exports.CorsEventEmitter = CorsEventEmitter;
/**
 * 全局跨域对象
 */
exports.cors = new CorsEventEmitter();
function getFuncId(fn) {
    if (typeof fn !== 'function') {
        throw new Error('first argument in defineTopFunction() is not Function!');
    }
    // 匿名函数：生成 16 位短哈希
    const str = fn.toString();
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0; // 转成整数
    }
    // 转成字母+数字，保证16位
    return Math.abs(hash).toString(36).padStart(16, '0').slice(-16);
}
