"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommonEventEmitter = void 0;
const events_1 = __importDefault(require("events"));
class CommonEventEmitter extends events_1.default {
    on(eventName, listener) {
        return super.on(eventName.toString(), listener);
    }
    once(eventName, listener) {
        return super.once(eventName.toString(), listener);
    }
    emit(eventName, ...args) {
        return super.emit(eventName.toString(), ...args);
    }
    off(eventName, listener) {
        return super.off(eventName.toString(), listener);
    }
}
exports.CommonEventEmitter = CommonEventEmitter;
