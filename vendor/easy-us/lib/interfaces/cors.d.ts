/**
 * 跨域脚本事件通讯
 */
export declare class CorsEventEmitter {
    eventMap: Map<string, number>;
    private eventKey;
    tempKey(...args: string[]): string;
    keyOfReturn(id: string): string;
    keyOfArguments(id: string): string;
    keyOfState(id: string): string;
    /**
     * 提交事件
     * @param name 事件名
     * @param args 事件参数
     * @param callback 事件回调，可以接收返回值
     */
    emit(name: string, args?: any[], callback?: (returnValue: any) => void): void;
    /**
     * 监听跨域事件
     * @param name 事件名，全局唯一
     * @param handler 处理器，可以通过处理器返回任意值作为另外一端的回调值
     * @returns
     */
    on(name: string, handler: (args: any[]) => any): Promise<number>;
    off(name: string): void;
    defineTopFunction<T extends (...args: any[]) => string | number | boolean | void | Promise<string | number | boolean | void>>(func: T): {
        (...args: Parameters<T>): Promise<ReturnType<T>>;
    };
}
/**
 * 全局跨域对象
 */
export declare const cors: CorsEventEmitter;
