import { CustomElementTagMap } from '../elements/interface';
/**
 * 可自定义元素样式的属性
 */
export type CustomElementStyleAttrs<E extends Record<string, any>> = {
    [K in keyof E]: K extends 'style' ? Partial<CSSStyleDeclaration> : E[K];
};
export type AllElementTagMaps = HTMLElementTagNameMap & CustomElementTagMap;
export type AllElementTagKeys = keyof AllElementTagMaps;
/** 子元素 */
export type ElementChildren = (string | Node | {
    new (): HTMLElement;
})[] | string;
/** 元素属性 */
export type ElementAttrs<K extends AllElementTagKeys> = CustomElementStyleAttrs<Partial<AllElementTagMaps[K]>>;
/** 元素处理回调 */
export type ElementHandler<K extends AllElementTagKeys | CustomElementConstructor> = (this: K extends AllElementTagKeys ? AllElementTagMaps[K] : AllElementTagMaps['div'], el: K extends AllElementTagKeys ? AllElementTagMaps[K] : AllElementTagMaps['div']) => void;
type CustomElementConstructor = {
    new (): HTMLElement;
};
/**
 * ==================== 两个参数的情况 ====================
 */
/**
 * 创建元素，效果等同于 document.createElement
 * @param element  	标签名或者自定义元素构造函数
 * @param attrs  	元素属性
 */
export declare function h<K extends AllElementTagKeys | CustomElementConstructor>(element: K, attrs?: K extends AllElementTagKeys ? ElementAttrs<K> : K extends abstract new () => any ? Partial<CustomElementStyleAttrs<InstanceType<K>>> : unknown): K extends AllElementTagKeys ? AllElementTagMaps[K] : K;
/**
 * 创建元素，效果等同于 document.createElement
 * @param element	标签名或者自定义元素构造函数
 * @param children	子元素列表
 */
export declare function h<K extends AllElementTagKeys | CustomElementConstructor>(element: K, children?: ElementChildren): K extends AllElementTagKeys ? AllElementTagMaps[K] : K;
/**
 * 创建元素，效果等同于 document.createElement
 * @param element  				标签名或者自定义元素构造函数
 * @param attrsOrChildren 		元素属性，或者子元素列表，或者字符串
 */
export declare function h<K extends AllElementTagKeys | CustomElementConstructor>(element: K, attrsOrChildren?: (K extends AllElementTagKeys ? ElementAttrs<K> : K extends abstract new () => any ? Partial<CustomElementStyleAttrs<InstanceType<K>>> : unknown) | ElementChildren): K extends AllElementTagKeys ? AllElementTagMaps[K] : K;
/**
 * ==================== 三个参数的情况 ====================
 */
/**
 * 创建元素，效果等同于 document.createElement
 * @param element 	标签名或者自定义元素构造函数
 * @param attrs 	元素属性
 * @param children 	子元素列表
 */
export declare function h<K extends AllElementTagKeys | CustomElementConstructor>(element: K, attrs: K extends AllElementTagKeys ? ElementAttrs<K> : K extends abstract new () => any ? Partial<CustomElementStyleAttrs<InstanceType<K>>> : unknown, children?: ElementChildren): K extends AllElementTagKeys ? AllElementTagMaps[K] : K;
/**
 * 创建元素，效果等同于 document.createElement
 * @param element  	标签名或者自定义元素构造函数
 * @param attrs  	元素属性
 * @param handler  	元素生成的回调函数
 */
export declare function h<K extends AllElementTagKeys | CustomElementConstructor>(element: K, attrs: K extends AllElementTagKeys ? ElementAttrs<K> : K extends abstract new () => any ? Partial<CustomElementStyleAttrs<InstanceType<K>>> : unknown, handler?: ElementHandler<K extends AllElementTagKeys ? K : typeof HTMLDivElement>): K extends AllElementTagKeys ? AllElementTagMaps[K] : K;
/**
 * 创建元素，效果等同于 document.createElement
 * @param element  	标签名或者自定义元素构造函数
 * @param children 	子元素列表
 * @param handler 	元素生成的回调函数
 */
export declare function h<K extends AllElementTagKeys | CustomElementConstructor>(element: K, children: ElementChildren, handler?: ElementHandler<K extends AllElementTagKeys ? K : typeof HTMLDivElement>): K extends AllElementTagKeys ? AllElementTagMaps[K] : K;
/**
 * 选择元素，效果等同于 document.querySelector(selector)
 */
export declare function $el<T extends HTMLElement>(selector: string, root?: HTMLElement | Document): (T & {
    [x: string]: any;
}) | undefined;
/**
 * 选择元素列表，效果等同于 document.querySelectorAll(selector)
 */
export declare function $$el<T extends HTMLElement>(selector: string, root?: HTMLElement | Document): (T & {
    [x: string]: any;
})[];
/**
 * 使元素可以被拖动
 * @param header 拖动块
 * @param target 移动块
 */
export declare function enableElementDraggable(header: HTMLElement, target: HTMLElement, ondrag?: () => void): void;
/**
 * 支持元素移动端拖动支持
 */
export declare function enableElementTouchDraggable(header: HTMLElement, target: HTMLElement, ondrag?: () => void): void;
export {};
