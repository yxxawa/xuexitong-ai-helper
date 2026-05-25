/**
 * 存储器提供类
 *
 * 在油猴环境下 getTab 指的是获取当前标签页的唯一全局对象，如果在普通浏览器环境中， getTab 则为 localStorage 里的一个对象
 */
export interface StoreProvider {
    /**
     * 获取存储的值
     * @param key 			键
     * @param defaultValue	默认值
     */
    get(key: string, defaultValue?: any): any;
    /**
     * 设置存储的值
     * @param key 	键
     * @param value	值
     */
    set(key: string, value: any): void;
    /**
     * 删除存储的值
     * @param key 键
     */
    delete(key: string): any;
    /**
     * 获取所有存储的键
     */
    list(): string[];
    /**
     * 获取当前标签页的存储数据
     * @param key 键
     */
    getTab(key: string): Promise<any>;
    /**
     * 设置当前标签页的存储数据
     * @param key	键
     * @param value	值
     */
    setTab(key: string, value: any): Promise<any>;
    addChangeListener(key: string, listener: (curr: any, pre: any, remote?: boolean) => void): number | void;
    removeChangeListener(listener: number | void | EventListener): void;
    /**
     * 原理：在使用 start 后，每个页面会自动分配一个 uid，存储监听器的Key到油猴的本地存储中，通过改变这个的值，可以触发监听
     * 脚本猫和油猴实现有区别，脚本猫相同的值设置后同样会触发 change，油猴不会，截止1.1.2 版本
     */
    addTabChangeListener(key: string, listener: (curr: any, pre: any) => void): void | Promise<number>;
    removeTabChangeListener(key: string, listener: number | EventListener): void;
}
export type StoreListenerType = number | void | EventListener;
export declare class LocalStoreChangeEvent extends Event {
    key: string;
    value: any;
    previousValue: any;
}
/**
 * 内存存储提供器
 */
export declare class MemoryStoreProvider implements StoreProvider {
    static _source: {
        store: object;
        tab: object;
    };
    static storeListeners: Map<string, ((curr: any, pre: any) => void)[]>;
    static tabListeners: Map<string, ((curr: any, pre: any) => void)[]>;
    get(key: string, defaultValue?: any): any;
    set(key: string, value: any): void;
    delete(key: string): void;
    list(): string[];
    getTab(key: string): Promise<any>;
    setTab(key: string, value: any): Promise<void>;
    addChangeListener(key: string, listener: (curr: any, pre: any, remote?: boolean | undefined) => void): void;
    removeChangeListener(listener: EventListener): void;
    addTabChangeListener(key: string, listener: (curr: any, pre: any) => void): void;
    removeTabChangeListener(key: string, listener: EventListener): void;
}
/**
 * 油猴存储器
 */
export declare class GMStoreProvider implements StoreProvider {
    constructor();
    /** 获取本地能够触发 tab 监听的key */
    getTabChangeHandleKey(tabUid: string, key: string): string;
    get(key: string, defaultValue?: any): any;
    set(key: string, value: any): void;
    delete(key: string): void;
    list(): string[];
    getTab(key: string): Promise<unknown>;
    setTab(key: string, value: any): Promise<void>;
    addChangeListener(key: string, listener: (curr: any, pre: any, remote?: boolean) => void): number;
    removeChangeListener(listenerId: number | void): void;
    addTabChangeListener(key: string, listener: (curr: any, pre: any) => void): Promise<number>;
    removeTabChangeListener(key: string, listener: number): void;
}
