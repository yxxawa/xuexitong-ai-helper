"use strict";
/* global GM_getValue GM_setValue GM_deleteValue GM_listValues GM_getTab GM_addValueChangeListener GM_saveTab EventListener  */
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
exports.GMStoreProvider = exports.MemoryStoreProvider = exports.LocalStoreChangeEvent = void 0;
const const_1 = require("../utils/const");
class LocalStoreChangeEvent extends Event {
    constructor() {
        super(...arguments);
        this.key = '';
    }
}
exports.LocalStoreChangeEvent = LocalStoreChangeEvent;
/**
 * 内存存储提供器
 */
class MemoryStoreProvider {
    get(key, defaultValue) {
        var _a;
        return (_a = Reflect.get(MemoryStoreProvider._source.store, key)) !== null && _a !== void 0 ? _a : defaultValue;
    }
    set(key, value) {
        var _a;
        const pre = Reflect.get(MemoryStoreProvider._source.store, key);
        Reflect.set(MemoryStoreProvider._source.store, key, value);
        (_a = MemoryStoreProvider.storeListeners.get(key)) === null || _a === void 0 ? void 0 : _a.forEach((lis) => lis(value, pre));
    }
    delete(key) {
        Reflect.deleteProperty(MemoryStoreProvider._source.store, key);
    }
    list() {
        return Object.keys(MemoryStoreProvider._source.store);
    }
    getTab(key) {
        return __awaiter(this, void 0, void 0, function* () {
            return Reflect.get(MemoryStoreProvider._source.tab, key);
        });
    }
    setTab(key, value) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            Reflect.set(MemoryStoreProvider._source.tab, key, value);
            (_a = MemoryStoreProvider.tabListeners.get(key)) === null || _a === void 0 ? void 0 : _a.forEach((lis) => lis(value, this.getTab(key)));
        });
    }
    addChangeListener(key, listener) {
        const listeners = MemoryStoreProvider.storeListeners.get(key) || [];
        listeners.push(listener);
        MemoryStoreProvider.storeListeners.set(key, listeners);
    }
    removeChangeListener(listener) {
        MemoryStoreProvider.tabListeners.forEach((lis, key) => {
            const index = lis.findIndex((l) => l === listener);
            if (index !== -1) {
                lis.splice(index, 1);
                MemoryStoreProvider.tabListeners.set(key, lis);
            }
        });
    }
    addTabChangeListener(key, listener) {
        const listeners = MemoryStoreProvider.tabListeners.get(key) || [];
        listeners.push(listener);
        MemoryStoreProvider.tabListeners.set(key, listeners);
    }
    removeTabChangeListener(key, listener) {
        const listeners = MemoryStoreProvider.tabListeners.get(key) || [];
        const index = listeners.findIndex((l) => l === listener);
        if (index !== -1) {
            listeners.splice(index, 1);
            MemoryStoreProvider.tabListeners.set(key, listeners);
        }
    }
}
MemoryStoreProvider._source = { store: {}, tab: {} };
MemoryStoreProvider.storeListeners = new Map();
MemoryStoreProvider.tabListeners = new Map();
exports.MemoryStoreProvider = MemoryStoreProvider;
/**
 * 油猴存储器
 */
class GMStoreProvider {
    constructor() {
        // 当页面首次加载时删除之前的监听数据
        if (self === top && typeof globalThis.GM_listValues !== 'undefined') {
            for (const val of GM_listValues()) {
                if (val.startsWith('_tab_change_')) {
                    GM_deleteValue(val);
                }
            }
        }
    }
    /** 获取本地能够触发 tab 监听的key */
    getTabChangeHandleKey(tabUid, key) {
        return `_tab_change_${tabUid}_${key}`;
    }
    get(key, defaultValue) {
        return GM_getValue(key, defaultValue);
    }
    set(key, value) {
        GM_setValue(key, value);
    }
    delete(key) {
        GM_deleteValue(key);
    }
    list() {
        return GM_listValues();
    }
    getTab(key) {
        return new Promise((resolve, reject) => {
            GM_getTab((tab = {}) => resolve(Reflect.get(tab, key)));
        });
    }
    setTab(key, value) {
        return new Promise((resolve, reject) => {
            GM_getTab((tab = {}) => {
                Reflect.set(tab, key, value);
                GM_saveTab(tab);
                this.set(this.getTabChangeHandleKey(Reflect.get(tab, const_1.$const.TAB_UID), key), value);
                resolve();
            });
        });
    }
    addChangeListener(key, listener) {
        return GM_addValueChangeListener(key, (_, pre, curr, remote) => {
            listener(curr, pre, remote);
        });
    }
    removeChangeListener(listenerId) {
        if (typeof listenerId === 'number') {
            // eslint-disable-next-line no-undef
            GM_removeValueChangeListener(listenerId);
        }
    }
    addTabChangeListener(key, listener) {
        return __awaiter(this, void 0, void 0, function* () {
            const uid = (yield this.getTab(const_1.$const.TAB_UID));
            return GM_addValueChangeListener(this.getTabChangeHandleKey(uid, key), (_, pre, curr) => {
                listener(curr, pre);
            });
        });
    }
    removeTabChangeListener(key, listener) {
        return this.removeChangeListener(listener);
    }
}
exports.GMStoreProvider = GMStoreProvider;
