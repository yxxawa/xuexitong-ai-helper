import { IElement } from './interface';
/**
 * 弹窗元素
 */
export declare class ModalElement extends IElement {
    /** 弹窗简介 */
    profile?: string;
    /** 弹窗标题 */
    _title: HTMLDivElement;
    /** 弹窗主体  */
    body: HTMLDivElement;
    /** 弹窗底部 */
    footerContainer: HTMLDivElement;
    footer?: HTMLDivElement;
    /** 弹窗确认按钮 */
    confirmButton?: HTMLButtonElement | null;
    /** 弹窗取消按钮 */
    cancelButton?: HTMLButtonElement | null;
    /** 弹窗底部输入框 */
    modalInput: HTMLInputElement | HTMLTextAreaElement;
    modalInputType?: 'input' | 'textarea';
    /**
     * 弹窗类型
     * prompt : 询问弹窗，并带有输入框
     * confirm : 确认弹窗，带有取消按钮
     * alert : 默认弹窗，只有确认按钮
     */
    type: 'prompt' | 'alert' | 'confirm' | 'simple';
    /** 弹窗内容 */
    content: string | HTMLElement | Node;
    /** 输入框默认内容 */
    inputDefaultValue?: string;
    /** 输入框提示 */
    placeholder?: string;
    /** 弹窗宽度 */
    width?: number;
    /** 取消按钮的文本 */
    cancelButtonText?: string;
    /** 确认按钮的文本 */
    confirmButtonText?: string;
    /** 弹窗元素样式 */
    modalStyle?: Partial<CSSStyleDeclaration>;
    /** 返回 false 则不会关闭模态框 */
    onConfirm?: (value?: string) => boolean | void | Promise<boolean | void>;
    /** 点击取消的回调 */
    onCancel?: () => void;
    /** 点击取消或者确认都会执行 */
    onClose?: (value?: string) => void;
    connectedCallback(): void;
}
