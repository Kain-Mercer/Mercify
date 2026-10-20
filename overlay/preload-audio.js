// Bridge for the hidden audio-sender window (audio/sender.js <-> main's audio.js).
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld("audio", {
	onStart: on("audio:start"),
	onPcm: (cb) => ipcRenderer.on("audio:pcm", (_e, chunk) => cb(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))),
	onAnswer: on("audio:answer"),
	onIce: on("audio:ice"),
	onStop: on("audio:stop"),
	offer: (sdp) => ipcRenderer.send("audio:offer", { sdp }),
	ice: (candidate) => ipcRenderer.send("audio:ice", { candidate }),
	error: (message) => ipcRenderer.send("audio:error", { message: String(message) }),
});
