import { Script } from '../interfaces/script';
import { MessageAttrs, ModalAttrs, ScriptIdentify, VisualType } from '../interfaces/custom-window';
export declare const createRenderScript: (config?: {
    name?: string;
    matches?: (string | RegExp)[] | [string, string | RegExp][];
}) => Script<{
    notes: {
        defaultValue: string;
    };
    x: {
        defaultValue: number;
    };
    y: {
        defaultValue: number;
    };
    /**
     * - minimize: 最小化
     * - hidden: 隐藏
     * - normal: 正常
     */
    visual: {
        defaultValue: VisualType;
    };
    firstCloseAlert: {
        defaultValue: boolean;
    };
    fontsize: {
        label: string;
        attrs: {
            type: string;
            min: number;
            max: number;
            step: number;
        };
        defaultValue: number;
    };
    switchPoint: {
        label: string;
        attrs: {
            type: string;
            min: number;
            max: number;
            step: number;
            title: string;
        };
        defaultValue: number;
    };
}, {
    /**
     * 将当前的脚本置顶
     * @param script 脚本
     */
    pin: (script: any) => Promise<void> | undefined;
    /**
     * 最小化窗口
     */
    minimize: () => void | undefined;
    /**
     * 将窗口最小化，并移动至窗口边缘
     */
    setPosition: (x: number, y: number) => void;
    /**
     * 还原窗口
     */
    normal: () => void;
}>;
/**
 * 打开弹窗，如果调用时不在顶级窗口，则会通过跨域通信发送消息
 */
export declare const $modal: {
    confirm: (attrs: ModalAttrs, parent?: HTMLElement | Document | ShadowRoot) => HTMLDivElement | undefined;
    alert: (attrs: ModalAttrs, parent?: HTMLElement | Document | ShadowRoot) => HTMLDivElement | undefined;
    prompt: (attrs: ModalAttrs, parent?: HTMLElement | Document | ShadowRoot) => HTMLDivElement | undefined;
    simple: (attrs: ModalAttrs, parent?: HTMLElement | Document | ShadowRoot) => HTMLDivElement | undefined;
};
/**
 * 消息提示，如果调用时不在顶级窗口，则会通过跨域通信发送消息
 */
export declare const $message: {
    info: (attrs: MessageAttrs) => import("../elements").MessageElement | undefined;
    success: (attrs: MessageAttrs) => import("../elements").MessageElement | undefined;
    warn: (attrs: MessageAttrs) => import("../elements").MessageElement | undefined;
    error: (attrs: MessageAttrs) => import("../elements").MessageElement | undefined;
};
/**
 * 注册菜单
 * @param label 菜单名称
 * @param config 菜单配置
 */
export declare function $menu(label: string, config: {
    scriptPanelLink?: ScriptIdentify;
}): Promise<HTMLButtonElement> | undefined;
