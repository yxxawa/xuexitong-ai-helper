import { ConfigElement } from '../elements/config';
import { Script, StoreProvider } from '../interfaces';
import { Config } from '../interfaces/config';
import { CustomElementStyleAttrs, ElementHandler } from './dom';
export interface PreventTextOptions {
    /** 按钮文字 */
    name: string;
    /**
     * 执行的延时
     * @default 5
     */
    delay?: number;
    /**
     * 时间到后是否自动删除该文本按钮元素
     * @default true
     */
    autoRemove?: boolean;
    /** 执行的回调 */
    ondefault: (span: HTMLSpanElement) => void;
    /** 不执行的回调 */
    onprevent?: (span: HTMLSpanElement) => void;
}
/**
 * 元素创建器
 */
export declare const $ui: {
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
    /** 创建多行的文本，支持 字符串，元素，以及包含字符串元素的列表，最多二维数组 */
    notes(lines: (string | HTMLElement | (string | HTMLElement)[])[], tag?: 'ul' | 'ol'): HTMLOListElement | HTMLUListElement;
    /**
     * 生成一个复制按钮
     * @param name 按钮名
     * @param value 复制内容
     */
    copy(name: string, value: string): HTMLSpanElement;
    /**
     * 创建一个取消默认事件的文字按钮，如果不点击，则执行默认事件
     * @param  opts 参数
     */
    preventText(opts: PreventTextOptions): HTMLSpanElement;
    /**
     * 将所有子元素隔开
     * x: 默认 12
     * y: 默认 0
     * separator: 默认 ' '
     */
    space(children: HTMLElement[], options?: {
        x?: number;
        y?: number;
        separator?: string;
    }): HTMLDivElement;
    button(text?: string, attrs?: CustomElementStyleAttrs<Omit<Partial<HTMLInputElement>, 'type'>> | undefined, handler?: ElementHandler<'input'> | undefined): HTMLInputElement;
};
