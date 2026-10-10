// Mercify: main process
// - one transparent, always-on-top, click-through window covering a monitor
// - a localhost WebSocket server the Spicetify "overlay-bridge" extension connects to
// - shows only while a chosen app (e.g. WoW) is in front
// - global hotkeys, tray menu, Settings window with built-in setup, config + layout persistence

const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, shell, Notification, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const { WebSocketServer } = require("ws");
const foreground = require("./foreground");
const setup = require("./setup");
const updater = require("./updater");
const { createLobby, generateCode, formatCode, DEFAULT_RELAYS } = require("./lobby");

// ------------------------------------------------------------------ config

const DEFAULT_CONFIG = {
	port: 7317,
	display: "primary", // "primary", "cursor" (monitor under the mouse at launch) or a 0-based index
	hotkeys: {
		toggle: "Control+`", // show / hide the overlay (each panel fades to its own "hidden" opacity)
		edit: "Control+Shift+`", // Edit Mode: drag, resize, per-panel settings
		search: "Control+Shift+Space", // show overlay and put the cursor in the search bar
		playPause: "",
		next: "",
		prev: "",
	},
	// Only show the overlay while one of these is the window in front.
	// apps: program file names. titles: exact window titles (for games that hide their process).
	onlyShowOver: {
		enabled: true,
		apps: ["Wow.exe", "WowClassic.exe", "Wow-64.exe", "WowB.exe", "WowT.exe", "Ascension.exe"],
		titles: ["World of Warcraft"],
		stayOnOtherMonitor: true, // keep showing while you use a window on another monitor
	},
	hotkeysOnlyOverApps: true, // toggle/search/media hotkeys are released when you're not in one of those apps
	launchSpotify: true, // start Spotify when the overlay starts
	minimiseSpotify: true, // send Spotify's window to the tray when Mercify opens
	lobbyName: "", // your name in listening lobbies
	// lobbyRelays: ["wss://..."], // optional: use your own MQTT-over-WebSocket relays instead of the public ones
};

// Testing: run a second copy side by side with its own settings.
if (process.env.OVERLAY_DEBUG_USERDATA) app.setPath("userData", process.env.OVERLAY_DEBUG_USERDATA);
const userDir = app.getPath("userData");
const CONFIG_PATH = path.join(userDir, "config.json");
const LAYOUT_PATH = path.join(userDir, "layout.json");

function readJSON(p, fallback) {
	try {
		return JSON.parse(fs.readFileSync(p, "utf8"));
	} catch (_) {
		return fallback;
	}
}

function writeJSON(p, data) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	const tmp = p + ".tmp";
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
	fs.renameSync(tmp, p);
}

// Earlier versions were called "Spotify Overlay"; bring their settings and layout across once.
function migrateOldSettings() {
	const oldDir = path.join(app.getPath("appData"), "Spotify Overlay");
	for (const f of ["config.json", "layout.json"]) {
		const from = path.join(oldDir, f);
		const to = path.join(userDir, f);
		try {
			if (fs.existsSync(from) && !fs.existsSync(to)) {
				fs.mkdirSync(userDir, { recursive: true });
				fs.copyFileSync(from, to);
			}
		} catch (_) {}
	}
}
migrateOldSettings();

let firstRun = false;
function loadConfig() {
	const saved = readJSON(CONFIG_PATH, null);
	firstRun = !saved;
	const cfg = {
		...DEFAULT_CONFIG,
		...(saved || {}),
		hotkeys: { ...DEFAULT_CONFIG.hotkeys, ...(saved?.hotkeys || {}) },
		onlyShowOver: { ...DEFAULT_CONFIG.onlyShowOver, ...(saved?.onlyShowOver || {}) },
	};
	// Write back so new options appear in the file, keeping everything the user set.
	if (JSON.stringify(cfg) !== JSON.stringify(saved)) writeJSON(CONFIG_PATH, cfg);
	return cfg;
}

const config = loadConfig();
const saveConfig = () => writeJSON(CONFIG_PATH, config);

// ------------------------------------------------------------------ single instance

if (!app.requestSingleInstanceLock()) {
	app.quit();
	process.exit(0);
}
app.setAppUserModelId("com.kainmercer.mercify");

// Transparent windows need hardware acceleration off on some Windows GPU drivers
// to avoid a black background. Opt-in via config so the default stays fast.
if (config.disableHardwareAcceleration) app.disableHardwareAcceleration();

const startedAt = Date.now();
// Started by Windows at login (see loginItemOptions) rather than by you: don't pop Settings up then.
const AUTOSTART = process.argv.includes("--autostart");

let win = null;
let settingsWin = null;
let tray = null;
let overlayShown = true;
let editMode = false;

// ------------------------------------------------------------------ overlay window

function pickDisplay() {
	const all = screen.getAllDisplays();
	if (config.display === "cursor") return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	if (Number.isInteger(config.display) && all[config.display]) return all[config.display];
	return screen.getPrimaryDisplay();
}

function createWindow() {
	const b = pickDisplay().bounds;
	win = new BrowserWindow({
		x: b.x,
		y: b.y,
		width: b.width,
		height: b.height,
		transparent: true,
		backgroundColor: "#00000000",
		frame: false,
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		hasShadow: false,
		alwaysOnTop: true,
		// Must stay focusable: on Windows, Chromium throws away clicks on windows that can't be
		// activated (that was the 1.3.0 "can't click anything" bug). Instead, after a click on a
		// button the renderer asks for focus to go straight back to the game (give-back-focus).
		focusable: true,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			backgroundThrottling: false,
		},
	});

	// "screen-saver" is the highest always-on-top level; it keeps us above borderless games.
	win.setAlwaysOnTop(true, "screen-saver");
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	setInteractive(false);

	win.loadFile(path.join(__dirname, "renderer", "index.html"));
	win.once("ready-to-show", () => {
		if (gateOpen) win.showInactive(); // don't steal focus from the game on launch
		sendToRenderer("overlay", { shown: overlayShown, edit: editMode });
		sendToRenderer("bridge-status", { connected: !!bridge });
		if (process.env.OVERLAY_DEBUG_EDIT) setEdit(true);
		if (process.env.OVERLAY_DEBUG_CAPTURE) debugCapture(process.env.OVERLAY_DEBUG_CAPTURE);
	});

	// Windows sometimes drops topmost when another topmost app activates; re-assert.
	win.on("blur", () => {
		if (!win || win.isDestroyed()) return;
		win.setAlwaysOnTop(true, "screen-saver");
	});

	screen.on("display-metrics-changed", () => {
		if (!win || win.isDestroyed()) return;
		win.setBounds(pickDisplay().bounds);
	});
}

// Click-through except where the renderer says the mouse is over a panel.
let interactive = null;
function setInteractive(on) {
	if (!win || win.isDestroyed() || interactive === on) return;
	interactive = on;
	if (on) win.setIgnoreMouseEvents(false);
	else win.setIgnoreMouseEvents(true, { forward: true });
}

function sendToRenderer(channel, payload) {
	if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function setShown(on) {
	overlayShown = on;
	if (!on && editMode) setEdit(false);
	if (!on) releaseFocus();
	sendToRenderer("overlay", { shown: overlayShown, edit: editMode });
}

function setEdit(on) {
	editMode = on;
	if (on) {
		overlayShown = true;
		applyGate(true);
		setInteractive(true);
		takeFocus(); // so arrow-key nudging works
	} else {
		releaseFocus();
	}
	sendToRenderer("overlay", { shown: overlayShown, edit: editMode });
	updateTrayMenu();
}

// Stop taking clicks/keys and hand focus back to the app you were in (usually the game).
function releaseFocus() {
	if (!win || win.isDestroyed()) return;
	setInteractive(false);
	sendToRenderer("interactive-reset");
	if (win.isFocused()) win.blur();
}

// Let the overlay take keyboard input (typing in a search box, Edit Mode arrow keys).
function takeFocus() {
	if (!win || win.isDestroyed()) return;
	setInteractive(true);
	win.focus();
}

// ------------------------------------------------------------------ show only over chosen apps

let gateOpen = true;
let forceOpenUntil = 0; // brief grace period while the search hotkey focuses the overlay

const lower = (s) => String(s || "").toLowerCase();

function matchesApp(fg) {
	const o = config.onlyShowOver;
	if (fg.exe && o.apps.some((a) => lower(a) === lower(fg.exe))) return true;
	if (fg.title && o.titles.some((t) => lower(t) === lower(fg.title))) return true;
	return false;
}

function filterActive() {
	return config.onlyShowOver.enabled && foreground.supported();
}

function applyGate(open) {
	if (!win || win.isDestroyed() || open === gateOpen) return;
	gateOpen = open;
	if (open) {
		win.showInactive();
		win.setAlwaysOnTop(true, "screen-saver");
		sendToRenderer("interactive-reset");
	} else {
		setInteractive(false);
		win.hide();
	}
}

let gameInFront = false; // a chosen app was the last window in front (ignoring our own windows)
let gateWhy = "";

function tickGate() {
	if (!win || win.isDestroyed()) return;
	const fg = foreground.supported() ? foreground.getForeground() : null;
	const ours = fg && fg.pid === process.pid;

	if (fg && !ours) {
		gameInFront = matchesApp(fg);
		// remember the game's window, so we can tell whether it's still up on its own monitor
		if (gameInFront && fg.hwnd) foreground.setAnchor(fg.hwnd);
	}

	let open = true;
	gateWhy = "off";
	if (filterActive()) {
		if (editMode || win.isFocused() || Date.now() < forceOpenUntil) [open, gateWhy] = [true, "overlay"];
		else if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isFocused()) [open, gateWhy] = [false, "settings"];
		else if (!fg || ours) [open, gateWhy] = [gateOpen, "unchanged"]; // tray menu etc.: leave as is
		else if (gameInFront) [open, gateWhy] = [true, "game"];
		else if (onOtherMonitor(fg)) [open, gateWhy] = [true, "other-monitor"];
		else [open, gateWhy] = [false, "other-app"];
	}
	applyGate(open);
	// Hotkeys follow the game itself being in front, so they're yours again in other apps,
	// even while the overlay stays up over the game on another monitor.
	setHotkeysActive(!filterActive() || !config.hotkeysOnlyOverApps || gameInFront || editMode || win.isFocused());
}

// You alt-tabbed to a window on a different monitor while the game is still up (not
// minimised or closed) on its own: keep showing over the game.
function onOtherMonitor(fg) {
	if (!config.onlyShowOver.stayOnOtherMonitor) return false;
	const a = fg.anchor;
	return !!(a && a.up && a.mon != null && fg.mon != null && a.mon !== fg.mon);
}

// ------------------------------------------------------------------ bridge (WebSocket server)

let bridge = null;
let bridgeInfo = null;
let nextId = 1;
const pending = new Map();

function originAllowed(origin) {
	if (!origin) return true; // non-browser clients (the demo mock) send no Origin
	try {
		const host = new URL(origin).hostname;
		return host === "spotify.com" || host.endsWith(".spotify.com");
	} catch (_) {
		return false;
	}
}

function startBridgeServer() {
	const wss = new WebSocketServer({
		host: "127.0.0.1",
		port: config.port,
		verifyClient: (info) => originAllowed(info.origin),
	});

	wss.on("error", (err) => {
		console.error("[overlay] WebSocket server error:", err.message);
		sendToRenderer("toast", { text: `Can't listen on port ${config.port}: ${err.message}`, kind: "error" });
	});

	wss.on("connection", (sock) => {
		// Newest connection wins (e.g. Spotify reloaded its UI).
		if (bridge && bridge !== sock) bridge.close();
		bridge = sock;
		sendToRenderer("bridge-status", { connected: true });
		pushSettings();

		sock.on("message", (raw) => {
			let msg;
			try {
				msg = JSON.parse(raw);
			} catch (_) {
				return;
			}
			if (msg.type === "reply") {
				const p = pending.get(msg.id);
				if (!p) return;
				pending.delete(msg.id);
				clearTimeout(p.timer);
				msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error || "bridge error"));
			} else if (msg.type === "hello") {
				bridgeInfo = msg;
				minimiseSpotifyOnce();
				sendToRenderer("bridge-status", { connected: true, info: msg });
				updateTrayMenu();
			} else if (msg.type === "state" || msg.type === "progress") {
				sendToRenderer("bridge", msg);
				if (msg.type === "state") lobby.onPlayerState(msg.state);
				else lobby.onPlayerProgress(msg.position, msg.at);
			}
		});

		sock.on("close", () => {
			if (bridge !== sock) return;
			bridge = null;
			bridgeInfo = null;
			for (const [, p] of pending) {
				clearTimeout(p.timer);
				p.reject(new Error("Spotify disconnected"));
			}
			pending.clear();
			sendToRenderer("bridge-status", { connected: false });
			updateTrayMenu();
			pushSettings();
		});
	});
}

// ------------------------------------------------------------------ Spotify to the tray

// When Mercify opens, Spotify's own window isn't needed: hide it to the tray once Spotify is
// fully loaded (the extension saying hello means it's logged in, so a login screen is never hidden).
// Only right after Mercify starts, so opening Spotify yourself later is left alone.
let spotifyMinimisedOnce = false;
let hiddenSpotify = [];

async function minimiseSpotifyOnce() {
	if (spotifyMinimisedOnce || !config.minimiseSpotify || !setup.IS_WIN) return;
	if (Date.now() - startedAt > 120 * 1000) return;
	spotifyMinimisedOnce = true;
	hiddenSpotify = await foreground.hideWindowsOf("Spotify.exe", 15000);
	if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) settingsWin.focus();
	updateTrayMenu();
}

async function showSpotify() {
	if (hiddenSpotify.length) {
		await foreground.showWindows(hiddenSpotify);
		hiddenSpotify = [];
		updateTrayMenu();
	} else {
		setup.openSpotify();
	}
}

function bridgeCommand(action, args, timeoutMs = 15000) {
	return new Promise((resolve, reject) => {
		if (!bridge || bridge.readyState !== 1) return reject(new Error("Spotify is not connected"));
		const id = nextId++;
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`"${action}" timed out`));
		}, timeoutMs);
		pending.set(id, { resolve, reject, timer });
		bridge.send(JSON.stringify({ type: "cmd", id, action, args: args || {} }));
	});
}

// ------------------------------------------------------------------ listening lobbies

const lobbyRelays = process.env.OVERLAY_DEBUG_LOBBY_RELAYS
	? process.env.OVERLAY_DEBUG_LOBBY_RELAYS.split(",")
	: Array.isArray(config.lobbyRelays) && config.lobbyRelays.length
		? config.lobbyRelays
		: DEFAULT_RELAYS;

const lobby = createLobby({
	command: (action, args) => bridgeCommand(action, args),
	relays: lobbyRelays,
	log: (m) => console.log("[lobby]", m),
	trace: !!process.env.OVERLAY_DEBUG_LOBBY_TRACE,
});
lobby.setName(config.lobbyName);

const lobbyView = () => ({ ...lobby.state(), name: config.lobbyName });

lobby.on("change", () => {
	sendToRenderer("lobby", lobbyView());
	pushSettings();
	updateTrayMenu();
});
lobby.on("toast", (text) => sendToRenderer("toast", { text }));

function setLobbyName(name) {
	config.lobbyName = String(name || "").trim().slice(0, 24);
	saveConfig();
	lobby.setName(config.lobbyName);
}

ipcMain.handle("lobby:get", () => lobbyView());
ipcMain.handle("lobby:generate", () => formatCode(generateCode()));
ipcMain.handle("lobby:set-name", (_e, name) => {
	setLobbyName(name);
	return lobbyView();
});
ipcMain.handle("lobby:join", async (_e, code) => {
	try {
		await lobby.join(code);
		return { ok: true, state: lobbyView() };
	} catch (err) {
		return { ok: false, error: err.message, state: lobbyView() };
	}
});
ipcMain.handle("lobby:leave", async () => {
	await lobby.leave();
	return lobbyView();
});
ipcMain.handle("lobby:queue-add", async (_e, track) => {
	try {
		await lobby.queueAdd(track);
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err.message };
	}
});
ipcMain.on("lobby:queue-remove", (_e, qid) => lobby.queueRemove(qid));
ipcMain.on("lobby:queue-top", (_e, qid) => lobby.queueMoveTop(qid));
ipcMain.on("lobby:queue-play", (_e, qid) => lobby.playNow(qid));
// Host pressing Next while the session playlist has songs: play the next one from it.
ipcMain.handle("lobby:next", async () => {
	if (!lobby.isHostWithQueue()) return false;
	await lobby.playNext();
	return true;
});
ipcMain.on("lobby:copy", () => {
	const st = lobby.state();
	if (st.displayCode) clipboard.writeText(st.displayCode);
});

// ------------------------------------------------------------------ overlay IPC

// Songs picked in the overlay are deliberate; the session playlist mustn't override them.
const MANUAL_PLAY = new Set(["playTrack", "playContext", "prev", "next"]);

ipcMain.handle("cmd", async (_e, { action, args }) => {
	if (MANUAL_PLAY.has(action)) lobby.markManual();
	try {
		return { ok: true, data: await bridgeCommand(action, args) };
	} catch (err) {
		return { ok: false, error: err.message };
	}
});

// The renderer decides which spots are clickable (including the compact widget while hidden).
ipcMain.on("set-interactive", (_e, on) => {
	if (editMode) return setInteractive(true);
	setInteractive(!!on && gateOpen);
});

ipcMain.on("want-focus", () => takeFocus());

// After a click on a button or list row: keep taking clicks, but give the keyboard back.
// On Windows, blur() activates the next window down, which is normally the game.
let giveBacks = 0; // counted for the debug state file
ipcMain.on("give-back-focus", () => {
	giveBacks++;
	if (!win || win.isDestroyed() || editMode) return;
	if (win.isFocused()) win.blur();
});

ipcMain.on("release-focus", () => {
	if (!editMode) releaseFocus();
});

ipcMain.on("set-edit", (_e, on) => setEdit(!!on));

ipcMain.handle("load-layout", () => readJSON(LAYOUT_PATH, null));
ipcMain.on("save-layout", (_e, layout) => {
	try {
		writeJSON(LAYOUT_PATH, layout);
	} catch (err) {
		console.error("[overlay] could not save layout:", err.message);
	}
});

ipcMain.handle("get-info", () => ({
	hotkeys: config.hotkeys,
	failedHotkeys: [...failedHotkeys],
	connected: !!bridge,
	bridgeInfo,
}));

// ------------------------------------------------------------------ hotkeys

const failedHotkeys = new Set();
const ALWAYS_ON = new Set(["edit"]); // Edit Mode works everywhere, so you can always get back in
let gatedActive = false;

const hotkeyActions = {
	toggle: () => setShown(!overlayShown),
	edit: () => setEdit(!editMode),
	search: () => {
		if (editMode) return;
		forceOpenUntil = Date.now() + 1500;
		overlayShown = true;
		applyGate(true);
		sendToRenderer("overlay", { shown: true, edit: false });
		takeFocus();
		sendToRenderer("focus-search");
	},
	playPause: () => bridgeCommand("togglePlay").catch(() => {}),
	next: () => bridgeCommand("next").catch(() => {}),
	prev: () => bridgeCommand("prev").catch(() => {}),
};

function registerOne(name) {
	const accel = config.hotkeys[name];
	if (!accel || !hotkeyActions[name] || globalShortcut.isRegistered(accel)) return;
	let ok = false;
	try {
		ok = globalShortcut.register(accel, hotkeyActions[name]);
	} catch (_) {}
	if (!ok) failedHotkeys.add(`${name} (${accel})`);
}

function setHotkeysActive(on) {
	if (on === gatedActive) return;
	gatedActive = on;
	for (const name of Object.keys(config.hotkeys)) {
		if (ALWAYS_ON.has(name)) continue;
		const accel = config.hotkeys[name];
		if (!accel) continue;
		if (on) registerOne(name);
		else if (globalShortcut.isRegistered(accel)) globalShortcut.unregister(accel);
	}
}

function registerHotkeys() {
	for (const name of ALWAYS_ON) registerOne(name);
	gatedActive = false;
	setHotkeysActive(true); // the first gate tick turns them off again if needed
}

// ------------------------------------------------------------------ start with Windows

function loginItemOptions(args = ["--autostart"]) {
	// Portable builds run from a temp folder; register the original .exe instead.
	const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
	return app.isPackaged ? { path: exe, args } : { path: exe, args: [path.resolve(__dirname), ...args] };
}

// Versions before 1.3.2 registered "start with Windows" without --autostart; switch it over.
function migrateLoginItem() {
	if (process.platform !== "win32") return;
	const old = loginItemOptions([]);
	if (app.getLoginItemSettings(old).openAtLogin) {
		app.setLoginItemSettings({ openAtLogin: false, ...old });
		app.setLoginItemSettings({ openAtLogin: true, ...loginItemOptions() });
	}
}

function getStartWithWindows() {
	if (process.platform !== "win32") return false;
	return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
}

function setStartWithWindows(on) {
	if (process.platform !== "win32") return;
	app.setLoginItemSettings({ openAtLogin: !!on, ...loginItemOptions() });
}

// ------------------------------------------------------------------ Settings window

function openSettings() {
	if (settingsWin && !settingsWin.isDestroyed()) {
		if (settingsWin.isMinimized()) settingsWin.restore();
		settingsWin.show();
		settingsWin.focus();
		return;
	}
	settingsWin = new BrowserWindow({
		width: 1000,
		height: 660,
		minWidth: 940,
		minHeight: 660,
		useContentSize: true,
		center: true,
		title: "Mercify",
		backgroundColor: "#0f1115",
		autoHideMenuBar: true,
		icon: path.join(__dirname, "assets", "icon.png"),
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload-settings.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	settingsWin.setMenu(null);
	settingsWin.loadFile(path.join(__dirname, "settings", "settings.html"));
	settingsWin.once("ready-to-show", () => settingsWin.show());
	settingsWin.on("closed", () => (settingsWin = null));
	if (process.env.OVERLAY_DEBUG_SETTINGS_CAPTURE) {
		settingsWin.webContents.once("did-finish-load", () =>
			setTimeout(async () => {
				if (process.env.OVERLAY_DEBUG_SETTINGS_JS) {
					const r = await settingsWin.webContents.executeJavaScript(process.env.OVERLAY_DEBUG_SETTINGS_JS).catch((e) => String(e));
					if (process.env.OVERLAY_DEBUG_RESULT) fs.writeFileSync(process.env.OVERLAY_DEBUG_RESULT, JSON.stringify(r));
					await new Promise((res) => setTimeout(res, 300));
				}
				const img = await settingsWin.webContents.capturePage();
				fs.writeFileSync(process.env.OVERLAY_DEBUG_SETTINGS_CAPTURE, img.toPNG());
				app.quit();
			}, 1500)
		);
	}
}

async function settingsState() {
	return {
		lobby: lobbyView(),
		update: updater.state(),
		setup: await setup.status(),
		connected: !!bridge,
		foregroundSupported: foreground.supported(),
		onlyShowOver: config.onlyShowOver,
		hotkeysOnlyOverApps: config.hotkeysOnlyOverApps,
		launchSpotify: config.launchSpotify,
		minimiseSpotify: config.minimiseSpotify,
		startWithWindows: getStartWithWindows(),
		hotkeys: config.hotkeys,
	};
}

async function pushSettings() {
	if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send("settings:changed", await settingsState());
	updateTrayMenu();
}

function settingsLog(line) {
	if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send("settings:log", line);
}

ipcMain.handle("settings:get", () => settingsState());

ipcMain.handle("settings:action", async (_e, name) => {
	const waitForInstaller = (run) =>
		new Promise((resolve) => {
			settingsLog("Installer window opened. Follow its prompts; this page updates when it closes.");
			run(resolve);
		});
	if (name === "spotx") await waitForInstaller(setup.runSpotX);
	else if (name === "spicetify") await waitForInstaller(setup.installSpicetify);
	else if (name === "apply") await setup.applyExtension(settingsLog);
	else if (name === "startSpotify") await setup.startSpotify();
	else if (name === "checkUpdate") updater.check();
	else if (name === "leaveLobby") await lobby.leave();
	else if (name === "installUpdate") updater.installNow();
	return settingsState();
});

ipcMain.handle("settings:set", async (_e, key, value) => {
	if (key === "onlyShowOver.enabled") config.onlyShowOver.enabled = !!value;
	else if (key === "onlyShowOver.stayOnOtherMonitor") config.onlyShowOver.stayOnOtherMonitor = !!value;
	else if (key === "hotkeysOnlyOverApps") config.hotkeysOnlyOverApps = !!value;
	else if (key === "launchSpotify") config.launchSpotify = !!value;
	else if (key === "minimiseSpotify") config.minimiseSpotify = !!value;
	else if (key === "lobbyName") setLobbyName(value);
	else if (key === "startWithWindows") setStartWithWindows(value);
	saveConfig();
	tickGate();
	updateTrayMenu();
	return settingsState();
});

function addApp(value) {
	value = String(value || "").trim();
	if (!value) return;
	const o = config.onlyShowOver;
	const list = /\.exe$/i.test(value) ? o.apps : o.titles;
	if (!list.some((v) => lower(v) === lower(value))) list.push(value);
	saveConfig();
}

ipcMain.handle("settings:add-app", (_e, value) => {
	addApp(value);
	return settingsState();
});

ipcMain.handle("settings:remove-app", (_e, value) => {
	const o = config.onlyShowOver;
	o.apps = o.apps.filter((v) => v !== value);
	o.titles = o.titles.filter((v) => v !== value);
	saveConfig();
	tickGate();
	return settingsState();
});

ipcMain.handle("settings:pick-app", async () => {
	const fg = foreground.getForeground();
	let message;
	if (!fg) message = "Couldn't read which app is in front.";
	else if (fg.pid === process.pid) message = "The Settings window was still in front. Press the button, then click into your game within 5 seconds.";
	else if (/^explorer\.exe$/i.test(fg.exe || "")) message = "That was the desktop or taskbar. Press the button, then click into your game within 5 seconds.";
	else if (fg.exe) {
		addApp(fg.exe);
		message = `Added ${fg.exe}${fg.title ? ` (window "${fg.title}")` : ""}.`;
	} else if (fg.title) {
		addApp(fg.title);
		message = `Couldn't read that app's program name (some anti-cheat blocks it), so added its window title "${fg.title}".`;
	} else message = "That window has no program name or title to match.";
	tickGate();
	return { message, state: await settingsState() };
});

ipcMain.on("settings:open-config", () => shell.openPath(CONFIG_PATH));

// ------------------------------------------------------------------ tray

function trayIcon() {
	const img = nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png"));
	return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function updateTrayMenu() {
	if (!tray) return;
	const status = bridge ? `Connected to Spotify${bridgeInfo?.spotify ? " " + bridgeInfo.spotify : ""}` : "Waiting for Spotify…";
	tray.setToolTip(`Mercify: ${status}`);
	const u = updater.state();
	const updateItems =
		u.status === "ready"
			? [{ label: `Restart to update to ${u.newVersion}`, click: () => updater.installNow() }, { type: "separator" }]
			: u.status === "available"
				? [{ label: `Download Mercify ${u.newVersion}…`, click: () => updater.installNow() }, { type: "separator" }]
				: [];
	tray.setContextMenu(
		Menu.buildFromTemplate([
			...updateItems,
			{ label: status, enabled: false },
			{ type: "separator" },
			{ label: "Settings and setup…", click: openSettings },
			{ label: hiddenSpotify.length ? "Show Spotify window" : "Open Spotify", click: showSpotify, visible: setup.IS_WIN },
			{ label: "Edit Mode", type: "checkbox", checked: editMode, accelerator: config.hotkeys.edit || undefined, click: () => setEdit(!editMode) },
			{ label: "Show / hide overlay", accelerator: config.hotkeys.toggle || undefined, click: () => setShown(!overlayShown) },
			{
				label: "Only show over games",
				type: "checkbox",
				checked: config.onlyShowOver.enabled,
				enabled: foreground.supported(),
				click: (item) => {
					config.onlyShowOver.enabled = item.checked;
					saveConfig();
					tickGate();
					pushSettings();
				},
			},
			...lobbyTrayItems(),
			{ label: "Reset layout", click: () => sendToRenderer("reset-layout") },
			{ type: "separator" },
			{ label: "Quit", click: () => app.quit() },
		])
	);
}

function lobbyTrayItems() {
	const st = lobby.state();
	if (st.status !== "joined") return [];
	const who = st.role === "host" ? "hosting" : `with ${st.hostName || "the host"}`;
	return [
		{ type: "separator" },
		{ label: `Lobby ${st.displayCode} (${who}, ${st.members.length} here)`, enabled: false },
		{ label: "Copy lobby code", click: () => clipboard.writeText(st.displayCode) },
		{ label: "Leave lobby", click: () => lobby.leave() },
		{ type: "separator" },
	];
}

function createTray() {
	tray = new Tray(trayIcon());
	tray.on("click", openSettings);
	updateTrayMenu();
}

// ------------------------------------------------------------------ debug capture (used for testing)

function debugCapture(file) {
	if (process.env.OVERLAY_DEBUG_JS) setTimeout(() => win.webContents.executeJavaScript(process.env.OVERLAY_DEBUG_JS).catch(console.error), 1500);
	setTimeout(async () => {
		if (process.env.OVERLAY_DEBUG_RESULT) {
			const r = await win.webContents.executeJavaScript("document.body.dataset.result || ''").catch((e) => String(e));
			fs.writeFileSync(process.env.OVERLAY_DEBUG_RESULT, r);
		}
		const img = await win.webContents.capturePage();
		fs.writeFileSync(file, img.toPNG());
		app.quit();
	}, Number(process.env.OVERLAY_DEBUG_DELAY || 2500));
}

// ------------------------------------------------------------------ lifecycle

function notify(title, body) {
	if (!Notification.isSupported()) return;
	const n = new Notification({ title, body, icon: path.join(__dirname, "assets", "icon.png") });
	n.on("click", openSettings);
	n.show();
}

updater.on("change", () => {
	pushSettings();
	updateTrayMenu();
});
updater.on("ready", (v) => notify(`Mercify ${v} is ready`, "It installs the next time Mercify closes. To update now, open Settings and choose Restart and update."));
updater.on("available", (v) => notify(`Mercify ${v} is available`, "Click to open Settings and download it."));
updater.on("before-install", () => foreground.stop());

app.whenReady().then(async () => {
	updater.start();
	foreground.start();
	startBridgeServer();
	createWindow();
	createTray();
	registerHotkeys();
	tickGate();
	setInterval(tickGate, 200);
	if (process.env.OVERLAY_DEBUG_STATE_FILE) {
		setInterval(() => {
			const st = { gateOpen, visible: win.isVisible(), toggleHotkey: globalShortcut.isRegistered(config.hotkeys.toggle), editHotkey: globalShortcut.isRegistered(config.hotkeys.edit), edit: editMode, update: updater.state(), giveBacks, gateWhy, gameInFront };
			fs.writeFileSync(process.env.OVERLAY_DEBUG_STATE_FILE, JSON.stringify(st));
		}, 100);
	}

	if (setup.IS_WIN) {
		migrateLoginItem();
		const s = await setup.status();
		if (config.launchSpotify && s.spotify) setup.startSpotify({ minimized: config.minimiseSpotify });
		// Opened by you: bring Mercify into view. Started with Windows: stay in the tray unless setup needs you.
		if (!AUTOSTART || firstRun || setup.needsAttention(s)) openSettings();
	}
	if (process.env.OVERLAY_DEBUG_SETTINGS_CAPTURE) openSettings();
});

app.on("second-instance", openSettings);
app.on("before-quit", () => lobby.leaveNow()); // say goodbye so the lobby doesn't wait for a timeout
app.on("will-quit", () => {
	globalShortcut.unregisterAll();
	foreground.stop();
});
// The overlay lives in the tray; closing Settings must not quit it.
app.on("window-all-closed", (e) => e.preventDefault?.());
