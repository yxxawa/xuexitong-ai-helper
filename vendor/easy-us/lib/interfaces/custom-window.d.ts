import { Project, Script, StoreProvider } from '.';
import { ContainerElement, MessageElement, ModalElement } from '../elements';
export type ModalAttrs = Pick<ModalElement, 'content' | 'onConfirm' | 'onCancel' | 'onClose' | 'cancelButtonText' | 'confirmButtonText' | 'placeholder' | 'width' | 'cancelButton' | 'confirmButton' | 'inputDefaultValue' | 'profile' | 'modalInputType' | 'modalStyle'> & {
    /** 点击遮罩层是否可以关闭弹窗，默认 true */
    maskCloseable?: boolean;
    /** 弹窗标题 */
    title?: ModalElement['title'];
    /** 伴随系统通知一起弹出 */
    notification?: boolean;
    notificationOptions?: {
        /** 是否为重要通知 */
        important?: boolean;
        /** 消息显示时间（秒） */
        duration?: number;
    };
    footer?: HTMLDivElement;
    /** 持续时间，单位秒 */
    duration?: number;
};
export type MessageAttrs = string | Pick<MessageElement, 'duration' | 'onClose' | 'content' | 'closeable'>;
/**
 * Script唯一识别码，通过 namespace 或者 projectName-name 来进行判断
 */
export type ScriptIdentify = {
    namespace?: string;
    projectName?: string;
    name?: string;
} | Script;
export type VisualType = 'normal' | 'minimize' | 'hidden';
export type CustomWindowRenderConfig = {
    render: {
        /**
         * 窗口标题
         */
        title: string;
        /**
         * 默认面板名
         */
        defaultPanelName: string;
        /**
         * 窗口样式
         */
        styles: string[];
        /**
         * 窗口显示连点（次数）
         */
        switchPoint: number;
        /**
         * 窗口显示快捷键
         */
        switchKey: string;
        /**
         * 字体大小
         */
        fontsize: number;
    };
    store: {
        getVisual(): VisualType;
        setVisual(value: VisualType): void;
        setPosition: (x: number, y: number) => void;
        getPosition: () => {
            x: number;
            y: number;
        };
        getRenderURLs: () => string[] | Promise<string[]>;
        setRenderURLs: (urls: string[]) => void | Promise<void>;
        getCurrentPanelName: () => string | Promise<string>;
        setCurrentPanelName: (name: string) => void | Promise<void>;
    };
};
export declare class CustomWindow {
    projects: Project[];
    config: CustomWindowRenderConfig;
    inputStoreProvider: StoreProvider;
    /** 外部面板元素 */
    wrapper: HTMLDivElement;
    /** ShadowRoot 根元素 */
    root: ShadowRoot;
    /** 内部容器元素 */
    container: ContainerElement;
    /** 消息内容元素 */
    messageContainer: HTMLDivElement;
    /** 额外的菜单栏 */
    extraMenuBar: HTMLDivElement;
    /** 默认值 */
    defaults: {
        /** 当前页面存在默认页面 */
        urls: (urls: string[]) => string[];
        /** 默认面板名 */
        panelName: (name: string) => string;
    };
    constructor(projects: Project[], inputStoreProvider: StoreProvider, config: CustomWindowRenderConfig);
    private rerender;
    private initHeader;
    private renderBody;
    setFontSize(fontsize: number): void;
    setVisual(value: VisualType): void;
    changeRenderURLs(urls: string[]): Promise<void>;
    changePanel(currentPanelName: string): Promise<void>;
    /**
     * 将当前的脚本置顶
     * @param script 脚本
     */
    pin(script: ScriptIdentify): Promise<void>;
    /**
     * 最小化窗口
     */
    minimize(): void;
    normal(): void;
    hidden(): void;
    /**
     * 消息推送
     */
    message(type: MessageElement['type'], attrs: MessageAttrs): MessageElement;
    /**
     * 注册额外菜单栏
     * @param label	名称
     * @param config 设置
     */
    menu(label: string, config: {
        scriptPanelLink?: ScriptIdentify;
    }): Promise<HTMLButtonElement>;
    /**
     * 随机挂载到指定的父元素
     * @param parent 挂载的父元素
     */
    mount(parent: Element | HTMLElement | Document): void;
}
/**
 * 创建一个模态框代替原生的 alert, confirm, prompt
 * 如果已经调用了 start 函数那么则会挂载到自定义窗口中，否则可以挂载到全局元素中（可以修改 $elements.root 实现自定义挂载位置），或者 document.body 上
 */
export declare function modal(type: ModalElement['type'], attrs: ModalAttrs, parent?: HTMLElement | Document | ShadowRoot): HTMLDivElement;
