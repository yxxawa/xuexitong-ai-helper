"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigElement = void 0;
const ui_1 = require("../utils/ui");
const dom_1 = require("../utils/dom");
const interface_1 = require("./interface");
/**
 * 配置表单元素
 *
 * 可以根据 {@link Script.configs} 在面板中生成设置表单，并对数据进行双向绑定。
 *
 */
class ConfigElement extends interface_1.IElement {
    constructor(store) {
        super();
        /** 描述 */
        this.label = (0, dom_1.h)('label');
        /** 外层 */
        this.wrapper = (0, dom_1.h)('div', { className: 'config-wrapper' });
        this.key = '';
        this.store = store;
    }
    /**
     * 注意这里的 value 和 provider.value 是不同的，provider 是真正的输入元素，而 ConfigElement 只是外层元素。
     */
    get value() {
        return this.store.get(this.key, this.defaultValue);
    }
    set value(value) {
        this.provider.value = value;
        this.store.set(this.key, value);
    }
    connectedCallback() {
        var _a, _b, _c;
        switch (this.tag) {
            case 'select': {
                this.provider = (0, dom_1.h)('select');
                // select 表情不能直接设置 value ，需要根据子元素 selected
                const value = this.store.get(this.key, this.defaultValue);
                // 创建选项
                for (const item of this.options || []) {
                    const option = ui_1.$ui.tooltip((0, dom_1.h)('option'));
                    if (Array.isArray(item)) {
                        option.value = item[0];
                        option.textContent = (_a = item[1]) !== null && _a !== void 0 ? _a : item[0];
                        if (item[2]) {
                            option.title = item[2];
                        }
                        if (String(item[0]) === String(value)) {
                            option.selected = true;
                            option.toggleAttribute('selected');
                        }
                        this.provider.add(option);
                    }
                    else {
                        option.value = item.value;
                        option.textContent = (_b = item.label) !== null && _b !== void 0 ? _b : item.value;
                        if (item.title) {
                            option.title = item.title;
                        }
                        if (String(item.value) === String(value)) {
                            option.selected = true;
                            option.toggleAttribute('selected');
                        }
                        this.provider.add(option);
                    }
                }
                this.provider.onchange = () => {
                    this.store.set(this.key, this.provider.value);
                };
                break;
            }
            case 'textarea': {
                this.provider = (0, dom_1.h)('textarea');
                this.provider.value = this.store.get(this.key, this.defaultValue);
                this.provider.onchange = () => {
                    this.store.set(this.key, this.provider.value);
                };
                break;
            }
            default: {
                this.provider = (0, dom_1.h)('input');
                if (['checkbox', 'radio'].some((t) => { var _a; return t === ((_a = this.attrs) === null || _a === void 0 ? void 0 : _a.type); })) {
                    this.provider.checked = this.store.get(this.key, this.defaultValue);
                    const provider = this.provider;
                    provider.onchange = () => {
                        this.store.set(this.key, provider.checked);
                    };
                }
                else {
                    this.provider.value = this.store.get(this.key, this.defaultValue);
                    this.provider.setAttribute('value', this.provider.value);
                    this.provider.onchange = () => {
                        const { min, max, type } = (this.attrs || {});
                        /** 计算属性，不能超过 min 和 max */
                        if (type === 'number') {
                            if (this.provider.value.trim() === '') {
                                this.provider.value = this.defaultValue;
                                this.store.set(this.key, this.defaultValue);
                                return;
                            }
                            const val = parseFloat(this.provider.value);
                            const _min = min ? parseFloat(min) : undefined;
                            const _max = max ? parseFloat(max) : undefined;
                            if (_min && val < _min) {
                                this.provider.value = _min.toString();
                                this.store.set(this.key, parseFloat(this.provider.value));
                            }
                            else if (_max && val > _max) {
                                this.provider.value = _max.toString();
                                this.store.set(this.key, parseFloat(this.provider.value));
                            }
                            else {
                                this.store.set(this.key, val);
                            }
                        }
                        else {
                            this.store.set(this.key, this.provider.value);
                        }
                    };
                }
                break;
            }
        }
        if (this.enableForAttribute) {
            this.provider.setAttribute('id', this.key);
            this.label.setAttribute('for', this.key);
        }
        if (this.labelClassName) {
            this.label.className = this.labelClassName;
        }
        if (this.providerClassName) {
            this.provider.className = this.providerClassName;
        }
        if (this.elementClassName) {
            this.className = this.elementClassName;
        }
        this.wrapper.replaceChildren(this.provider);
        this.append(this.label, this.wrapper);
        // 合并元素属性
        for (const key in this.attrs) {
            if (key === 'style') {
                Object.assign(this.provider.style, this.attrs[key]);
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(this.attrs, key)) {
                Reflect.set(this.provider, key, Reflect.get(this.attrs, key));
            }
        }
        // 处理跨域
        if (this.sync) {
            this.store.addChangeListener(this.key, (curr) => {
                this.provider.value = curr;
            });
        }
        // 处理提示
        ui_1.$ui.tooltip(this.provider);
        // 判断是否可见
        if (this.showIf) {
            let show_if = false;
            if (Array.isArray(this.showIf)) {
                if (typeof this.showIf[0] !== 'string') {
                    throw new Error('EUS Config.showIf first element must be a string');
                }
                const val = this.store.get(this.showIf[0], false) || false;
                const res = this.showIf[1].call(null, val, val, this.store);
                show_if = Boolean(res);
            }
            else {
                show_if = this.store.get(this.showIf, false) || false;
            }
            if (show_if) {
                this.style.display = '';
            }
            else {
                this.style.display = 'none';
            }
            if (Array.isArray(this.showIf)) {
                if (typeof this.showIf[1] !== 'function') {
                    throw new Error('EUS Config.showIf second element must be a function');
                }
                this.store.addChangeListener(this.showIf[0], (curr, pre) => {
                    if (this.isConnected) {
                        if (this.showIf && Array.isArray(this.showIf)) {
                            const res = this.showIf[1].call(null, curr, pre, this.store);
                            if (res) {
                                this.style.display = '';
                            }
                            else {
                                this.style.display = 'none';
                            }
                        }
                    }
                });
            }
            else {
                this.store.addChangeListener(this.showIf, (curr) => {
                    if (this.isConnected) {
                        const res = Boolean(curr);
                        if (res) {
                            this.style.display = '';
                        }
                        else {
                            this.style.display = 'none';
                        }
                    }
                });
            }
        }
        /**
         * 触发输入组件的加载回调
         * 可用于高度定制化组件
         */
        (_c = this._onload) === null || _c === void 0 ? void 0 : _c.call(this.provider, this);
    }
}
exports.ConfigElement = ConfigElement;
