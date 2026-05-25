"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCustomElementName = exports.$ = void 0;
const debounce_1 = __importDefault(require("lodash/debounce"));
const store_1 = require("./store");
/**
 * 公共的工具库
 */
exports.$ = {
    /**
     * 构造 config 配置对象， 可进行响应式存储
     * @param script 脚本
     */
    createConfigProxy(script) {
        var _a, _b;
        const proxy = new Proxy(script.cfg, {
            set(target, propertyKey, value) {
                const key = exports.$.namespaceKey(script.namespace, propertyKey);
                store_1.$store.set(key, value);
                return Reflect.set(target, propertyKey, value);
            },
            get(target, propertyKey) {
                const value = store_1.$store.get(exports.$.namespaceKey(script.namespace, propertyKey));
                Reflect.set(target, propertyKey, value);
                return value;
            }
        });
        // 为 proxy 创建属性，并设置默认值
        for (const key in script.configs) {
            if (Object.prototype.hasOwnProperty.call(script.configs, key)) {
                const element = Reflect.get(script.configs, key);
                Reflect.set(proxy, key, store_1.$store.get(exports.$.namespaceKey(script.namespace, key), element.defaultValue));
            }
        }
        if (script.namespace) {
            // 重置特殊的 notes 对象
            proxy.notes = (_b = (_a = script.configs) === null || _a === void 0 ? void 0 : _a.notes) === null || _b === void 0 ? void 0 : _b.defaultValue;
        }
        return proxy;
    },
    /**
     * 获取所有原生（未处理的）脚本配置
     * @param scripts 脚本列表
     */
    getAllRawConfigs(scripts) {
        const object = {};
        for (const script of scripts) {
            for (const key in script.configs) {
                if (Object.prototype.hasOwnProperty.call(script.configs, key)) {
                    const _a = script.configs[key], { label } = _a, element = __rest(_a, ["label"]);
                    Reflect.set(object, exports.$.namespaceKey(script.namespace, key), Object.assign({ label: exports.$.namespaceKey(script.namespace, key) }, element));
                }
            }
        }
        return object;
    },
    /**
     * 获取匹配到的脚本
     * @param projects 程序列表
     */
    getMatchedScripts(projects, urls) {
        const scripts = [];
        for (const project of projects) {
            for (const key in project.scripts) {
                if (Object.prototype.hasOwnProperty.call(project.scripts, key)) {
                    const script = project.scripts[key];
                    const script_matches_urls = script.matches.map((u) => (Array.isArray(u) ? u[1] : u));
                    const script_excludes_urls = (script.excludes || []).map((u) => (Array.isArray(u) ? u[1] : u));
                    // 平台域名是否匹配
                    if (project.domains === undefined ||
                        project.domains.length === 0 ||
                        project.domains.some((d) => urls.some((url) => new URL(url).origin.includes(d)))) {
                        // 被排除的网页
                        if (script_excludes_urls.some((u) => urls.some((url) => RegExp(u).test(url)))) {
                            continue;
                        }
                        if (script_matches_urls.some((u) => urls.some((url) => RegExp(u).test(url)))) {
                            scripts.push(script);
                        }
                    }
                }
            }
        }
        return scripts;
    },
    /**
     * 获取具名键
     * @param namespace 命名空间
     * @param key 键
     */
    namespaceKey(namespace, key) {
        return namespace ? namespace + '.' + key.toString() : key.toString();
    },
    /** 创建唯一id ， 不带横杠 */
    uuid() {
        return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    },
    /**
     * 生成随机数， 使用 Math.round 取整
     * @param min 最小值
     * @param max 最大值
     */
    random(min, max) {
        return Math.round(Math.random() * (max - min)) + min;
    },
    /**
     * 暂停
     * @param period 毫秒
     */
    sleep(period) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve) => {
                setTimeout(resolve, period);
            });
        });
    },
    /**
     * 当前是否处于浏览器环境
     */
    isInBrowser() {
        return typeof window !== 'undefined' && typeof window.document !== 'undefined';
    },
    /**
     * 监听页面宽度变化
     * @param el 任意元素，如果此元素被移除，则不执行 resize 回调
     * @param handler resize 回调
     */
    onresize(el, handler) {
        const resize = (0, debounce_1.default)(() => {
            /**
             * 如果元素被删除，则移除监听器
             * 不使用 el.parentElement 是因为如果是顶级元素，例如 shadowRoot 中的一级子元素， el.parentNode 不为空，但是 el.parentElement 为空
             */
            if (el.parentNode === null) {
                window.removeEventListener('resize', resize);
            }
            else {
                handler(el);
            }
        }, 200);
        resize();
        window.addEventListener('resize', resize);
    },
    /** 加载自定义元素 */
    loadCustomElements(elements) {
        for (const element of elements) {
            const name = resolveCustomElementName(element, '-');
            // 不能重复加载
            if (customElements.get(name) === undefined) {
                customElements.define(name, element);
            }
        }
    },
    /** 是否处于顶级 window ，而不是子 iframe */
    isInTopWindow() {
        return self === top;
    },
    /**
     * 创建弹出窗口
     * @param url 地址
     * @param winName 窗口名
     * @param w 宽
     * @param h 高
     * @param scroll 滚动条
     */
    createCenteredPopupWindow(url, winName, opts) {
        const { width, height, scrollbars, resizable } = opts;
        const LeftPosition = screen.width ? (screen.width - width) / 2 : 0;
        const TopPosition = screen.height ? (screen.height - height) / 2 : 0;
        const settings = 'height=' +
            height +
            ',width=' +
            width +
            ',top=' +
            TopPosition +
            ',left=' +
            LeftPosition +
            ',scrollbars=' +
            (scrollbars ? 'yes' : 'no') +
            ',resizable=' +
            (resizable ? 'yes' : 'no');
        return window.open(url, winName, settings);
    }
};
/**
 * 将每个驼峰前面添加目标字符串，用于自定义元素名的转换
 * @param el  自定义元素
 * @param target 目标字符串
 */
function resolveCustomElementName(el, target) {
    return el.name
        .replace(/\$\d+$/, '')
        .replace(/([A-Z])/g, target + '$1')
        .toLowerCase()
        .split(target)
        .slice(1)
        .join(target);
}
exports.resolveCustomElementName = resolveCustomElementName;
