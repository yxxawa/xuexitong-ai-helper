import { IElement } from './interface';
export declare class DropdownElement extends IElement {
    /** 触发元素 */
    triggerElement: HTMLElement;
    /** 下拉框内容 */
    content: HTMLDivElement;
    trigger: 'hover' | 'click';
    connectedCallback(): void;
}
