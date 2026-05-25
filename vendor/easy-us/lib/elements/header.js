"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HeaderElement = void 0;
const interface_1 = require("./interface");
class HeaderElement extends interface_1.IElement {
    connectedCallback() {
        this.append(this.visualSwitcher || '');
    }
}
exports.HeaderElement = HeaderElement;
