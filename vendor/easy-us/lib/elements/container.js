"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContainerElement = void 0;
const common_1 = require("../utils/common");
const ui_1 = require("../utils/ui");
const dom_1 = require("../utils/dom");
const interface_1 = require("./interface");
/** 面板主体元素 */
class ContainerElement extends interface_1.IElement {
    constructor() {
        super(...arguments);
        /** 头部 */
        this.header = ui_1.$ui.tooltip((0, dom_1.h)('header-element', { title: '菜单栏-可拖动区域' }));
        /** 内容 */
        this.body = (0, dom_1.h)('div', { className: 'body', clientHeight: window.innerHeight / 2 });
        /** 底部 */
        this.footer = (0, dom_1.h)('div', { className: 'footer' });
    }
    connectedCallback() {
        this.append(this.header, this.body, this.footer);
        common_1.$.onresize(this, (cont) => {
            cont.style.maxHeight = window.innerHeight - 24 + 'px';
            cont.style.maxWidth = window.innerWidth - 24 + 'px';
        });
    }
}
exports.ContainerElement = ContainerElement;
