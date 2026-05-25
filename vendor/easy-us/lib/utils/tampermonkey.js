"use strict";
/* global Tampermonkey GM_getTab GM_notification */
Object.defineProperty(exports, "__esModule", { value: true });
exports.$gm = void 0;
/**
 * 油猴封装库
 *
 * 在对本地持久化存储时可以使用 getValue , setValue 等方法
 * 在对当前标签页中的临时变量，可以使用 getTab , setTab 的方法
 *
 * 例如设置信息则使用本地持久化存储
 * 而对于消息推送，弹窗通知等临时，但是需要跨域的变量，可以使用标签页去存储临时信息
 */
exports.$gm = {
    /** 全局 unsafeWindow 对象 */
    unsafeWindow: (typeof globalThis.unsafeWindow === 'undefined'
        ? globalThis.window
        : globalThis.unsafeWindow),
    isInGMContext() {
        return typeof GM_info !== 'undefined';
    },
    /** 获取 GM_info */
    getInfos() {
        // eslint-disable-next-line no-undef
        return typeof GM_info === 'undefined' ? undefined : GM_info;
    },
    /** 与 $store.getTab 不同的是这个直接获取全部 tab 对象 */
    getTab(callback) {
        return typeof GM_getTab === 'undefined' ? undefined : GM_getTab(callback);
    },
    /**
     * 发送系统通知
     * @param content 内容
     * @param options 选项
     */
    notification(content, options) {
        var _a;
        const { onclick, ondone, important, duration = 30, silent = true, extraTitle = '' } = options || {};
        const { icon, name } = ((_a = exports.$gm.getInfos()) === null || _a === void 0 ? void 0 : _a.script) || {};
        GM_notification({
            title: name + (extraTitle ? '-' + extraTitle : ''),
            text: content,
            image: icon || '',
            highlight: important,
            onclick,
            ondone,
            silent: silent,
            timeout: duration * 1000
        });
    },
    getMetadataFromScriptHead(key) {
        var _a, _b;
        const metadataString = (_a = this.getInfos()) === null || _a === void 0 ? void 0 : _a.scriptMetaStr;
        if (!metadataString) {
            return [];
        }
        else {
            const metadata = ((_b = metadataString.match(/\/\/\s+==UserScript==([\s\S]+)\/\/\s+==\/UserScript==/)) === null || _b === void 0 ? void 0 : _b[1]) || '';
            const metadataList = (metadata.match(/\/\/\s+@(.+?)\s+(.*?)(?:\n|$)/g) || []).map((line) => {
                const words = line.match(/[\S]+/g) || [];
                return {
                    key: (words[1] || '').replace('@', ''),
                    value: words.slice(2).join(' ')
                };
            });
            return metadataList.filter((l) => l.key === key).map((l) => l.value);
        }
    }
};
