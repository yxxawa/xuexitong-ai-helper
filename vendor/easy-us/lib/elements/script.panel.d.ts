import { IElement } from './interface';
/**
 * 脚本的面板，创建于悬浮窗下，每当切换页面，或者展开时会重新渲染面板。
 *
 * 主要结构为：
 * 分隔符
 * 提示板块
 * 设置表单板块
 * 主体
 *
 */
export declare class ScriptPanelElement extends IElement {
    /** 分隔符 */
    separator: HTMLDivElement;
    /** 创建提示板块 */
    notesContainer: HTMLDivElement;
    /** 创建设置板块 */
    configsContainer: HTMLDivElement;
    /** 主体 */
    body: HTMLDivElement;
    /** 锁定配置板块 */
    lockWrapper: HTMLDivElement;
    /** 面板名字 */
    name?: string;
    connectedCallback(): void;
}
