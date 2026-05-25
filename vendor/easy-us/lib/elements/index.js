"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.definedCustomElements = exports.ScriptPanelElement = exports.ModalElement = exports.MessageElement = exports.HeaderElement = exports.ContainerElement = exports.ConfigElement = void 0;
const config_1 = require("./config");
const container_1 = require("./container");
const dropdown_1 = require("./dropdown");
const header_1 = require("./header");
const message_1 = require("./message");
const modal_1 = require("./modal");
const script_panel_1 = require("./script.panel");
var config_2 = require("./config");
Object.defineProperty(exports, "ConfigElement", { enumerable: true, get: function () { return config_2.ConfigElement; } });
var container_2 = require("./container");
Object.defineProperty(exports, "ContainerElement", { enumerable: true, get: function () { return container_2.ContainerElement; } });
var header_2 = require("./header");
Object.defineProperty(exports, "HeaderElement", { enumerable: true, get: function () { return header_2.HeaderElement; } });
var message_2 = require("./message");
Object.defineProperty(exports, "MessageElement", { enumerable: true, get: function () { return message_2.MessageElement; } });
var modal_2 = require("./modal");
Object.defineProperty(exports, "ModalElement", { enumerable: true, get: function () { return modal_2.ModalElement; } });
var script_panel_2 = require("./script.panel");
Object.defineProperty(exports, "ScriptPanelElement", { enumerable: true, get: function () { return script_panel_2.ScriptPanelElement; } });
exports.definedCustomElements = [
    config_1.ConfigElement,
    container_1.ContainerElement,
    header_1.HeaderElement,
    modal_1.ModalElement,
    message_1.MessageElement,
    script_panel_1.ScriptPanelElement,
    dropdown_1.DropdownElement
];
