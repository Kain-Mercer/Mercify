const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (cb) => {
	const handler = (_e, payload) => cb(payload);
	ipcRenderer.on(channel, handler);
	return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("settings", {
	get: () => ipcRenderer.invoke("settings:get"),
	action: (name) => ipcRenderer.invoke("settings:action", name),
	set: (key, value) => ipcRenderer.invoke("settings:set", key, value),
	addApp: (value) => ipcRenderer.invoke("settings:add-app", value),
	removeApp: (value) => ipcRenderer.invoke("settings:remove-app", value),
	pickApp: () => ipcRenderer.invoke("settings:pick-app"),
	openConfig: () => ipcRenderer.send("settings:open-config"),
	onLog: on("settings:log"),
	onChanged: on("settings:changed"),
});
