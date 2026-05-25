"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageElement = void 0;
const dom_1 = require("../utils/dom");
const interface_1 = require("./interface");
/**
 * 消息元素
 */
class MessageElement extends interface_1.IElement {
    constructor() {
        super(...arguments);
        /** 关闭按钮 */
        this.closer = (0, dom_1.h)('span', { className: 'message-closer' }, 'x');
        /** 内容外部元素 */
        this.contentContainer = (0, dom_1.h)('span', { className: 'message-content-container' });
        /**  消息类型 */
        this.type = 'info';
        /** 内容 */
        this.content = '';
        /** 是否允许关闭 */
        this.closeable = true;
    }
    connectedCallback() {
        var _a;
        this.classList.add(this.type);
        if (typeof this.content === 'string') {
            this.contentContainer.innerHTML = this.content;
        }
        else {
            this.contentContainer.append(this.content);
        }
        this.duration = Math.max((_a = this.duration) !== null && _a !== void 0 ? _a : 5, 0);
        this.append(this.contentContainer);
        if (this.closeable) {
            this.append(this.closer);
            this.closer.addEventListener('click', () => {
                var _a;
                (_a = this.onClose) === null || _a === void 0 ? void 0 : _a.call(this);
                this.remove();
            });
        }
        if (this.duration) {
            setTimeout(() => {
                var _a;
                (_a = this.onClose) === null || _a === void 0 ? void 0 : _a.call(this);
                this.remove();
            }, this.duration * 1000);
        }
    }
}
exports.MessageElement = MessageElement;
