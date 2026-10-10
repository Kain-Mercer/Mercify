const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (cb) => {
	const handler = (_e, payload) => cb(payload);
	ipcRenderer.on(channel, handler);
	return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("overlay", {
	cmd: (action, args) => ipcRenderer.invoke("cmd", { action, args }),
	setInteractive: (on) => ipcRenderer.send("set-interactive", on),
	releaseFocus: () => ipcRenderer.send("release-focus"),
	wantFocus: () => ipcRenderer.send("want-focus"),
	giveBackFocus: () => ipcRenderer.send("give-back-focus"),
	setEdit: (on) => ipcRenderer.send("set-edit", on),
	loadLayout: () => ipcRenderer.invoke("load-layout"),
	saveLayout: (layout) => ipcRenderer.send("save-layout", layout),
	getInfo: () => ipcRenderer.invoke("get-info"),
	onBridge: on("bridge"),
	onBridgeStatus: on("bridge-status"),
	onOverlay: on("overlay"),
	onFocusSearch: on("focus-search"),
	onResetLayout: on("reset-layout"),
	onToast: on("toast"),
	onInteractiveReset: on("interactive-reset"),
	lobbyGet: () => ipcRenderer.invoke("lobby:get"),
	lobbyGenerate: () => ipcRenderer.invoke("lobby:generate"),
	lobbySetName: (name) => ipcRenderer.invoke("lobby:set-name", name),
	lobbyJoin: (code) => ipcRenderer.invoke("lobby:join", code),
	lobbyLeave: () => ipcRenderer.invoke("lobby:leave"),
	lobbyQueueAdd: (track) => ipcRenderer.invoke("lobby:queue-add", track),
	lobbyQueueRemove: (qid) => ipcRenderer.send("lobby:queue-remove", qid),
	lobbyQueueTop: (qid) => ipcRenderer.send("lobby:queue-top", qid),
	lobbyQueuePlay: (qid) => ipcRenderer.send("lobby:queue-play", qid),
	lobbyNext: () => ipcRenderer.invoke("lobby:next"),
	lobbyCopy: () => ipcRenderer.send("lobby:copy"),
	onLobby: on("lobby"),
});
