import { ConfigElement } from '../elements/config';
import { Script, StoreProvider } from '../interfaces';
import { Config } from '../interfaces/config';
/**
 * 元素创建器
 */
export declare const $creator: {
    /** 创建多行的文本，支持 字符串，元素，以及包含字符串元素的列表，最多二维数组 */
    notes(lines: (string | HTMLElement | (string | HTMLElement)[])[], tag?: 'ul' | 'ol'): HTMLOListElement | HTMLUListElement;
    /**
     * 启动元素提示气泡，根据元素 title 即时显示，（兼容手机端的提示）
     * @param target
     */
    tooltip<T extends HTMLElement>(target: T): T;
    scriptPanel(script: Script, store: StoreProvider, opts?: {
        onload?: ((el: ConfigElement) => void) | undefined;
    } | undefined): import("..").ScriptPanelElement;
    /** 创建独立的设置区域 */
    configsArea(configElements: Record<string, ConfigElement<any>>): HTMLDivElement;
    /** 创建设置元素 */
    configs<T_1 extends Record<string, Config<any, any>>>(namespace: string | undefined, store: StoreProvider, configs: T_1, onload?: ((el: ConfigElement) => void) | undefined): { [K in keyof T_1]: ConfigElement<T_1[K]["tag"]>; };
};
