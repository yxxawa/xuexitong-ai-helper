/// <reference types="tampermonkey" />
/**
 * 油猴封装库
 *
 * 在对本地持久化存储时可以使用 getValue , setValue 等方法
 * 在对当前标签页中的临时变量，可以使用 getTab , setTab 的方法
 *
 * 例如设置信息则使用本地持久化存储
 * 而对于消息推送，弹窗通知等临时，但是需要跨域的变量，可以使用标签页去存储临时信息
 */
export declare const $gm: {
    /** 全局 unsafeWindow 对象 */
    unsafeWindow: Window & {
        [x: string]: any;
    };
    isInGMContext(): boolean;
    /** 获取 GM_info */
    getInfos(): Tampermonkey.ScriptInfo | undefined;
    /** 与 $store.getTab 不同的是这个直接获取全部 tab 对象 */
    getTab(callback: (obj: any) => void): void;
    /**
     * 发送系统通知
     * @param content 内容
     * @param options 选项
     */
    notification(content: string, options?: {
        extraTitle?: string;
        /** 通知点击时 */
        onclick?: () => void;
        /** 通知关闭时 */
        ondone?: () => void;
        /** 通知是否重要，会在屏幕下方菜单栏显示动态闪烁 */
        important?: boolean;
        /** 显示时间，单位为秒，默认为 30 秒， 0 则表示一直存在 */
        duration?: number;
        silent?: boolean;
    }): void;
    getMetadataFromScriptHead(key: string): string[];
};
