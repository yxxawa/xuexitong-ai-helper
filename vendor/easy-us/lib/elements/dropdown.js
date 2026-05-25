"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DropdownElement = void 0;
const interface_1 = require("./interface");
const dom_1 = require("../utils/dom");
class DropdownElement extends interface_1.IElement {
    constructor() {
        super(...arguments);
        /** 触发元素 */
        this.triggerElement = (0, dom_1.h)('button');
        /** 下拉框内容 */
        this.content = (0, dom_1.h)('div', { className: 'dropdown-content' });
        this.trigger = 'hover';
    }
    connectedCallback() {
        this.append(this.triggerElement, this.content);
        this.classList.add('dropdown');
        if (this.trigger === 'click') {
            this.triggerElement.onclick = () => {
                this.content.classList.toggle('show');
            };
        }
        else {
            this.triggerElement.onmouseover = () => {
                this.content.classList.add('show');
            };
            this.triggerElement.onmouseout = () => {
                this.content.classList.remove('show');
            };
            this.content.onmouseover = () => {
                this.content.classList.add('show');
            };
            this.content.onmouseout = () => {
                this.content.classList.remove('show');
            };
        }
        this.content.onclick = () => {
            this.content.classList.remove('show');
        };
    }
}
exports.DropdownElement = DropdownElement;
