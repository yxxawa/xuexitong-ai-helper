import { Script } from './script';
export interface ProjectOptions<T extends Record<string, Script>> {
    name: string;
    /**
     * 限定此项目中的所有脚本的匹配域名，如果为空则不限制
     */
    domains?: string[];
    scripts: T;
}
export declare class Project<T extends Record<string, Script> = Record<string, Script>> implements ProjectOptions<T> {
    name: string;
    domains?: string[];
    scripts: T;
    constructor({ name, domains, scripts }: ProjectOptions<T>);
    static create<T extends Record<string, Script>>(opts: ProjectOptions<T>): Project<T>;
}
