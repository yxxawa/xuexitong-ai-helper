import { HeaderElement } from './header';
import { IElement } from './interface';
/** 面板主体元素 */
export declare class ContainerElement extends IElement {
    /** 头部 */
    header: HeaderElement;
    /** 内容 */
    body: HTMLDivElement;
    /** 底部 */
    footer: HTMLDivElement;
    connectedCallback(): void;
}
