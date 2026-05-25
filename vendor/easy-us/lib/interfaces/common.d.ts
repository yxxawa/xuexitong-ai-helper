/// <reference types="node" />
import EventEmitter from 'events';
export declare class CommonEventEmitter<E extends Record<string | symbol, (...args: any[]) => any>> extends EventEmitter {
    on<K extends keyof E>(eventName: K, listener: E[K]): this;
    once<K extends keyof E>(eventName: K, listener: E[K]): this;
    emit<K extends keyof E>(eventName: K, ...args: Parameters<E[K]>): boolean;
    off<K extends keyof E>(eventName: K, listener: E[K]): this;
}
