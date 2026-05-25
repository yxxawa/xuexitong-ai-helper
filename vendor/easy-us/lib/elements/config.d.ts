import { StoreProvider } from '../interfaces';
import { CustomElementStyleAttrs } from '../utils/dom';
import { ConfigTagMap } from './configs/interface';
import { IElement } from './interface';
/**
 * 配置表单元素
 *
 * 可以根据 {@link Script.configs} 在面板中生成设置表单，并对数据进行双向绑定。
 *
 */
export declare class ConfigElement<T extends keyof ConfigTagMap = 'input'> extends IElement {
    /**  存储器 */
    store: StoreProvider;
    /** 描述 */
    label: HTMLLabelElement;
    /** 外层 */
    wrapper: HTMLDivElement;
    key: string;
    tag?: T;
    /** 默认值 */
    defaultValue: any;
    /** 表单元素 input 或者 textarea 等 */
    provider: ConfigTagMap[keyof ConfigTagMap];
    /**
     * 将本地修改后的值同步到元素中
     */
    sync?: boolean;
    /** 元素属性 */
    attrs?: CustomElementStyleAttrs<Partial<ConfigTagMap[T]>>;
    /** tag 为 select 时的选项 */
    options?: string[][] | {
        label: string;
        value: string;
        title?: string;
    }[];
    /**
     * 控制元素是否可见，提供从 store 中的值来决定
     */
    showIf?: string | [string, {
        (curr: any, pre: any, store: StoreProvider): boolean;
    }];
    /** 启用 for 属性 */
    enableForAttribute?: boolean;
    elementClassName?: string;
    labelClassName?: string;
    providerClassName?: string;
    _onload?: (this: ConfigTagMap[T], el: this) => void;
    constructor(store: StoreProvider);
    /**
     * 注意这里的 value 和 provider.value 是不同的，provider 是真正的输入元素，而 ConfigElement 只是外层元素。
     */
    get value(): any;
    set value(value: any);
    connectedCallback(): void;
}
