const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld("player", {
	event: (e) => ipcRenderer.send("player:event", e),
	onLoad: on("player:load"),
	onPlay: on("player:play"),
	onPause: on("player:pause"),
	onSeek: on("player:seek"),
	onVolume: on("player:volume"),
	onStop: on("player:stop"),
});
