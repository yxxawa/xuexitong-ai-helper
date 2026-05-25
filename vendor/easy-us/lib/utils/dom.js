"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enableElementTouchDraggable = exports.enableElementDraggable = exports.$$el = exports.$el = exports.h = void 0;
const common_1 = require("./common");
/**
 * 创建元素，效果等同于 document.createElement(tagName, options)
 * @param element 标签名或者自定义元素构造函数
 * @param attrsOrChildren 元素属性，或者子元素列表，或者字符串
 * @param childrenOrHandler 子元素列表，或者元素生成的回调函数
 */
function h(element, attrsOrChildren, childrenOrHandler) {
    let name = '';
    if (typeof element === 'function') {
        name = (0, common_1.resolveCustomElementName)(element, '-');
    }
    else {
        name = element;
    }
    const el = document.createElement(name);
    if (attrsOrChildren) {
        if (Array.isArray(attrsOrChildren)) {
            for (const child of attrsOrChildren) {
                if (typeof child === 'function') {
                    el.append(document.createElement(child.name));
                }
                else {
                    el.append(child);
                }
            }
        }
        else if (typeof attrsOrChildren === 'string') {
            el.append(attrsOrChildren);
        }
        else {
            const attrs = attrsOrChildren;
            /** 设置属性 */
            for (const key in attrs) {
                if (Object.prototype.hasOwnProperty.call(attrs, key)) {
                    if (key === 'style') {
                        Object.assign(el.style, attrs[key]);
                    }
                    else {
                        const value = attrs[key];
                        Reflect.set(el, key, value);
                    }
                }
            }
        }
    }
    if (childrenOrHandler) {
        if (typeof childrenOrHandler === 'function') {
            childrenOrHandler.call(el, el);
        }
        else if (Array.isArray(childrenOrHandler)) {
            for (const child of childrenOrHandler) {
                if (typeof child === 'function') {
                    el.append(document.createElement(child.name));
                }
                else {
                    el.append(child);
                }
            }
        }
        else if (typeof childrenOrHandler === 'string') {
            el.append(childrenOrHandler);
        }
    }
    return el;
}
exports.h = h;
/**
 * 选择元素，效果等同于 document.querySelector(selector)
 */
function $el(selector, root = window.document) {
    const el = root.querySelector(selector);
    return el === null ? undefined : el;
}
exports.$el = $el;
/**
 * 选择元素列表，效果等同于 document.querySelectorAll(selector)
 */
function $$el(selector, root = window.document) {
    return Array.from(root.querySelectorAll(selector));
}
exports.$$el = $$el;
/**
 * 使元素可以被拖动
 * @param header 拖动块
 * @param target 移动块
 */
function enableElementDraggable(header, target, ondrag) {
    let pos1 = 0;
    let pos2 = 0;
    let pos3 = 0;
    let pos4 = 0;
    header.addEventListener('mousedown', dragMouseDown);
    function dragMouseDown(e) {
        e = e || window.event;
        // get the mouse cursor position at startup:
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.addEventListener('mouseup', closeDragElement);
        // call a function whenever the cursor moves:
        document.addEventListener('mousemove', elementDrag);
    }
    function elementDrag(e) {
        // 阻止冒泡
        e.stopPropagation();
        e = e || window.event;
        // calculate the new cursor position:
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        // set the element's new position:
        target.style.top = Math.max(target.offsetTop - pos2, 10) + 'px';
        target.style.left = target.offsetLeft - pos1 + 'px';
    }
    function closeDragElement() {
        ondrag === null || ondrag === void 0 ? void 0 : ondrag();
        // stop moving when mouse button is released:
        document.removeEventListener('mouseup', closeDragElement);
        document.removeEventListener('mousemove', elementDrag);
    }
}
exports.enableElementDraggable = enableElementDraggable;
/**
 * 支持元素移动端拖动支持
 */
function enableElementTouchDraggable(header, target, ondrag) {
    let pos1 = 0;
    let pos2 = 0;
    let pos3 = 0;
    let pos4 = 0;
    header.addEventListener('touchstart', dragTouchStart);
    function dragTouchStart(e) {
        e = e || window.event;
        const touch = e.touches[0];
        // get the mouse cursor position at startup:
        pos3 = touch.clientX;
        pos4 = touch.clientY;
        document.addEventListener('touchend', closeDragElement);
        // call a function whenever the cursor moves:
        document.addEventListener('touchmove', elementDrag);
    }
    function elementDrag(e) {
        // 阻止冒泡
        e.stopPropagation();
        e = e || window.event;
        const touch = e.touches[0];
        // calculate the new cursor position:
        pos1 = pos3 - touch.clientX;
        pos2 = pos4 - touch.clientY;
        pos3 = touch.clientX;
        pos4 = touch.clientY;
        // set the element's new position:
        target.style.top = Math.max(target.offsetTop - pos2, 10) + 'px';
        target.style.left = target.offsetLeft - pos1 + 'px';
    }
    function closeDragElement() {
        ondrag === null || ondrag === void 0 ? void 0 : ondrag();
        // stop moving when mouse button is released:
        document.removeEventListener('touchend', closeDragElement);
        document.removeEventListener('touchmove', elementDrag);
    }
}
exports.enableElementTouchDraggable = enableElementTouchDraggable;
