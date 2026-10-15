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
	lobbyStart: () => ipcRenderer.invoke("settings:lobby-start"),
	lobbyJoin: (code) => ipcRenderer.invoke("settings:lobby-join", code),
	lobbyCopy: () => ipcRenderer.send("settings:lobby-copy"),
	pickAvatar: () => ipcRenderer.invoke("settings:pick-avatar"),
	clearAvatar: () => ipcRenderer.invoke("settings:clear-avatar"),
	player: (action) => ipcRenderer.invoke("settings:player", action),
	friendJoin: (fid, cancel) => ipcRenderer.invoke("settings:friend-join", fid, !!cancel),
	hotkeyCapture: (on) => ipcRenderer.invoke("settings:hotkey-capture", !!on),
	setHotkey: (name, accel) => ipcRenderer.invoke("settings:set-hotkey", name, accel),
	resetHotkeys: () => ipcRenderer.invoke("settings:reset-hotkeys"),
	onPlayer: on("settings:player"),
	onFriends: on("settings:friends"),
	onPage: on("settings:page"),
	onLog: on("settings:log"),
	onChanged: on("settings:changed"),
	onGate: on("settings:gate"),
	onSetupProgress: on("settings:setup-progress"),
	onSetupDetail: on("settings:setup-detail"),
});
