import { Config } from '../interfaces/config';
import { Project } from '../interfaces/project';
import { Script } from '../interfaces/script';
/**
 * 公共的工具库
 */
export declare const $: {
    /**
     * 构造 config 配置对象， 可进行响应式存储
     * @param script 脚本
     */
    createConfigProxy(script: Script): {
        [x: string]: any;
        readonly notes?: unknown;
    } & {
        notes?: string | undefined;
    };
    /**
     * 获取所有原生（未处理的）脚本配置
     * @param scripts 脚本列表
     */
    getAllRawConfigs(scripts: Script[]): Record<string, Config>;
    /**
     * 获取匹配到的脚本
     * @param projects 程序列表
     */
    getMatchedScripts(projects: Project[], urls: string[]): Script<import("../interfaces/script").ScriptConfigs, import("../interfaces/script").ScriptMethods>[];
    /**
     * 获取具名键
     * @param namespace 命名空间
     * @param key 键
     */
    namespaceKey(namespace: string | undefined, key: any): any;
    /** 创建唯一id ， 不带横杠 */
    uuid(): string;
    /**
     * 生成随机数， 使用 Math.round 取整
     * @param min 最小值
     * @param max 最大值
     */
    random(min: number, max: number): number;
    /**
     * 暂停
     * @param period 毫秒
     */
    sleep(period: number): Promise<void>;
    /**
     * 当前是否处于浏览器环境
     */
    isInBrowser(): boolean;
    /**
     * 监听页面宽度变化
     * @param el 任意元素，如果此元素被移除，则不执行 resize 回调
     * @param handler resize 回调
     */
    onresize<E extends HTMLElement>(el: E, handler: (el: E) => void): void;
    /** 加载自定义元素 */
    loadCustomElements(elements: {
        new (): HTMLElement;
    }[]): void;
    /** 是否处于顶级 window ，而不是子 iframe */
    isInTopWindow(): boolean;
    /**
     * 创建弹出窗口
     * @param url 地址
     * @param winName 窗口名
     * @param w 宽
     * @param h 高
     * @param scroll 滚动条
     */
    createCenteredPopupWindow(url: string, winName: string, opts: {
        width: number;
        height: number;
        scrollbars: boolean;
        resizable: boolean;
    }): Window | null;
};
/**
 * 将每个驼峰前面添加目标字符串，用于自定义元素名的转换
 * @param el  自定义元素
 * @param target 目标字符串
 */
export declare function resolveCustomElementName<T extends HTMLElement = HTMLElement>(el: {
    new (): T;
}, target: string): string;
