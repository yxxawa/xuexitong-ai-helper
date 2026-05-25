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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModalElement = void 0;
const common_1 = require("../utils/common");
const dom_1 = require("../utils/dom");
const tampermonkey_1 = require("../utils/tampermonkey");
const interface_1 = require("./interface");
/**
 * 弹窗元素
 */
class ModalElement extends interface_1.IElement {
    constructor() {
        super(...arguments);
        /** 弹窗标题 */
        this._title = (0, dom_1.h)('div', { className: 'modal-title' });
        /** 弹窗主体  */
        this.body = (0, dom_1.h)('div', { className: 'modal-body' });
        /** 弹窗底部 */
        this.footerContainer = (0, dom_1.h)('div', { className: 'modal-footer' });
        /** 弹窗底部输入框 */
        this.modalInput = (0, dom_1.h)('input', { className: 'modal-input' });
        this.modalInputType = 'input';
        /**
         * 弹窗类型
         * prompt : 询问弹窗，并带有输入框
         * confirm : 确认弹窗，带有取消按钮
         * alert : 默认弹窗，只有确认按钮
         */
        this.type = 'alert';
        /** 弹窗内容 */
        this.content = '';
        /** 输入框默认内容 */
        this.inputDefaultValue = '';
        /** 输入框提示 */
        this.placeholder = '';
        /** 弹窗元素样式 */
        this.modalStyle = {};
    }
    connectedCallback() {
        var _a;
        /**
         * 通过 class 来区分弹窗类型
         * prompt : 下方带有输入框
         * confirm : 输入框将被隐藏
         * alert : 取消框和输入框都将被隐藏
         */
        this.classList.add(this.type);
        /**
         * 合并样式
         */
        Object.assign(this.style, this.modalStyle || {});
        // 弹窗来源
        const profile = (0, dom_1.h)('div', {
            innerText: this.profile || '弹窗来自: 学习通AI辅助插件 ' + (((_a = tampermonkey_1.$gm.getInfos()) === null || _a === void 0 ? void 0 : _a.script.version) || ''),
            className: 'modal-profile'
        });
        // 标题
        this._title.innerText = this.title;
        // 模态框内容
        this.body.append(typeof this.content === 'string' ? (0, dom_1.h)('div', { innerHTML: this.content }) : this.content);
        // 输入框
        if (this.modalInputType === 'textarea') {
            this.modalInput = (0, dom_1.h)('textarea', { className: 'modal-input', style: { height: '100px' } });
        }
        this.modalInput.placeholder = this.placeholder || '';
        this.modalInput.value = this.inputDefaultValue || '';
        // 添加到模态框
        this.append(profile, this._title, this.body, this.footerContainer);
        // 设置模态框宽度
        this.style.width = (this.width || 400) + 'px';
        // 底部
        // 如果没有自定义底部，则按照类型来添加
        if (this.footer === undefined) {
            this.footerContainer.append(this.modalInput);
            if (this.cancelButton === undefined) {
                this.cancelButton = (0, dom_1.h)('button', { className: 'modal-cancel-button' });
                this.cancelButton.innerText = this.cancelButtonText || '取消';
                this.cancelButton.onclick = () => {
                    var _a, _b;
                    (_a = this.onCancel) === null || _a === void 0 ? void 0 : _a.call(this);
                    (_b = this.onClose) === null || _b === void 0 ? void 0 : _b.call(this);
                    this.remove();
                };
            }
            if (this.confirmButton === undefined) {
                this.confirmButton = (0, dom_1.h)('button', { className: 'modal-confirm-button' });
                this.confirmButton.innerText = this.confirmButtonText || '确定';
                this.confirmButton.onclick = () => __awaiter(this, void 0, void 0, function* () {
                    var _b, _c;
                    if ((yield ((_b = this.onConfirm) === null || _b === void 0 ? void 0 : _b.call(this, this.modalInput.value))) !== false) {
                        this.remove();
                        (_c = this.onClose) === null || _c === void 0 ? void 0 : _c.call(this, this.modalInput.value);
                    }
                });
            }
            this.cancelButton && this.footerContainer.append(this.cancelButton);
            this.confirmButton && this.footerContainer.append(this.confirmButton);
            if (this.type === 'simple') {
                this.footerContainer.remove();
            }
            else if (this.type === 'prompt') {
                this.modalInput.focus();
            }
        }
        else {
            this.footerContainer.append(this.footer);
        }
        common_1.$.onresize(this.body, (modal) => {
            this.body.style.maxHeight = window.innerHeight - 100 + 'px';
            this.body.style.maxWidth = window.innerWidth - 50 + 'px';
        });
    }
}
exports.ModalElement = ModalElement;
