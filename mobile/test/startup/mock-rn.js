// Stand-in for react-native: the native module and event emitter, nothing else.
const store = {};
const listeners = {};
const MercifySpotify = {
	hasAccess: async () => true, openAccessSettings() {}, isInstalled: async () => true, start: async () => true,
	getState: async () => null, describe: async () => null, play: async () => true, pause: async () => true,
	resume: async () => true, seek: async () => true, next: async () => true, previous: async () => true,
	keepAlive() {}, getItem: async (k) => (k in store ? store[k] : null), setItem(k, v) { store[k] = v; },
	addListener() {}, removeListeners() {},
};
class NativeEventEmitter { constructor() {} addListener(e, fn) { (listeners[e] = listeners[e] || []).push(fn); return { remove() {} }; } }
module.exports = { NativeModules: { MercifySpotify }, NativeEventEmitter, TurboModuleRegistry: { getEnforcing: () => ({ getRandomBase64: (n) => require("buffer").Buffer.from(globalThis.__nodeRandom(n)).toString("base64") }) } };
