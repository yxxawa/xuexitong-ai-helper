import { IElement } from './interface';
/**
 * 消息元素
 */
export declare class MessageElement extends IElement {
    /** 关闭按钮 */
    closer: HTMLSpanElement;
    /** 内容外部元素 */
    contentContainer: HTMLSpanElement;
    /**  消息类型 */
    type: 'info' | 'success' | 'warn' | 'error';
    /** 内容 */
    content: string | HTMLElement | Node;
    /** 持续时间(秒)，如果为0的话则一直存在，默认为: 5 */
    duration?: number;
    /** 是否允许关闭 */
    closeable?: boolean;
    /** 关闭回调 */
    onClose?: () => void;
    connectedCallback(): void;
}
