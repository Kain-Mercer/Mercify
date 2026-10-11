const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("splash", {
	onStatus: (cb) => ipcRenderer.on("splash:status", (_e, payload) => cb(payload)),
});
