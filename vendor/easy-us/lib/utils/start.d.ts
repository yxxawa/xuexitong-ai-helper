import { Script } from '../interfaces';
import { CustomWindow } from '../interfaces/custom-window';
import { Project } from '../interfaces/project';
export declare let $win: CustomWindow | undefined;
/**
 * 启动配置
 */
export interface StartConfig {
    /** 项目列表 */
    projects: Project[];
    mountElement?: HTMLElement | Element;
    renderConfig?: {
        renderScript: Script;
        title: string;
        styles: string[];
        defaultPanelName: string;
    };
    onRender?: () => CustomWindow;
    [x: string]: any;
}
/**
 * 启动项目
 * @param startConfig 启动配置
 */
export declare function start(startConfig: StartConfig): Promise<void>;
/**
 * 添加事件调用监听器
 */
export declare function addFunctionEventListener(obj: any, type: string): (...args: any[]) => any;
