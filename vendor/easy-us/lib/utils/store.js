"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.$store = exports.MemoryStoreProvider = exports.GMStoreProvider = void 0;
const store_provider_1 = require("../interfaces/store.provider");
var store_provider_2 = require("../interfaces/store.provider");
Object.defineProperty(exports, "GMStoreProvider", { enumerable: true, get: function () { return store_provider_2.GMStoreProvider; } });
Object.defineProperty(exports, "MemoryStoreProvider", { enumerable: true, get: function () { return store_provider_2.MemoryStoreProvider; } });
exports.$store = typeof globalThis.unsafeWindow === 'undefined' ? new store_provider_1.MemoryStoreProvider() : new store_provider_1.GMStoreProvider();
