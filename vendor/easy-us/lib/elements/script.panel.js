"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScriptPanelElement = void 0;
const dom_1 = require("../utils/dom");
const interface_1 = require("./interface");
/**
 * 脚本的面板，创建于悬浮窗下，每当切换页面，或者展开时会重新渲染面板。
 *
 * 主要结构为：
 * 分隔符
 * 提示板块
 * 设置表单板块
 * 主体
 *
 */
class ScriptPanelElement extends interface_1.IElement {
    constructor() {
        super(...arguments);
        /** 分隔符 */
        this.separator = (0, dom_1.h)('div', { className: 'separator' });
        /** 创建提示板块 */
        this.notesContainer = (0, dom_1.h)('div', { className: 'notes card' });
        /** 创建设置板块 */
        this.configsContainer = (0, dom_1.h)('div', { className: 'configs-container card' });
        /** 主体 */
        this.body = (0, dom_1.h)('div', { className: 'script-panel-body' });
        /** 锁定配置板块 */
        this.lockWrapper = (0, dom_1.h)('div', { className: 'lock-wrapper' });
    }
    connectedCallback() {
        this.separator.innerText = this.name || '';
        this.append(this.separator);
        this.append(this.notesContainer);
        this.append(this.configsContainer);
        this.append(this.body);
    }
}
exports.ScriptPanelElement = ScriptPanelElement;
