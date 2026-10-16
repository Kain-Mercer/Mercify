// Mercify: main process
// - one transparent, always-on-top, click-through window: the whole monitor while shown,
//   only the panels still visible while hidden
// - a localhost WebSocket server the Spicetify "overlay-bridge" extension connects to
// - shows only while a chosen app (e.g. WoW) is in front
// - global hotkeys, tray menu, Settings window with built-in setup, config + layout persistence

const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, shell, Notification, clipboard, dialog, net } = require("electron");
const path = require("path");
const fs = require("fs");
const { WebSocketServer } = require("ws");
const foreground = require("./foreground");
const setup = require("./setup");
const updater = require("./updater");
const { createLobby, generateCode, formatCode, DEFAULT_RELAYS } = require("./lobby");
const { createFriends } = require("./friends");
const { createYouTube, parseId: parseYouTubeId } = require("./youtube");
const { createDiscordPresence } = require("./discord");
const { pathToFileURL } = require("url");

// ------------------------------------------------------------------ uninstalling
// The uninstaller asks whether to remove the Spotify add-ons too, then runs
// "Mercify.exe --uninstall-cleanup" (everything) or "--uninstall-cleanup=extension" (only
// Mercify's own extension). Do just that, log it to %TEMP%\mercify-uninstall.log, and exit:
// no windows, no tray icon, no single-instance check (Mercify itself may still be closing).
const cleanupArg = process.argv.find((a) => a.startsWith("--uninstall-cleanup"));
if (cleanupArg) {
	const lines = [`Mercify ${app.getVersion()} uninstall cleanup (${cleanupArg}), ${new Date().toISOString()}`];
	app.whenReady().then(async () => {
		try {
			await setup.removeAddons((l) => lines.push(l), { extensionOnly: cleanupArg.endsWith("=extension") });
		} catch (e) {
			lines.push(`failed: ${e.stack || e}`);
		}
		try {
			fs.writeFileSync(path.join(require("os").tmpdir(), "mercify-uninstall.log"), lines.join("\r\n"));
		} catch (_) {}
		app.exit(0);
	});
	return; // the rest of this file is the normal app
}

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
	friendsShareListening: true, // friends see the song you're playing
	friendsAllowJoin: true, // friends can ask to join you (accepting starts a lobby)
	discordYouTube: true, // show the YouTube video playing on your Discord profile
	// Spotify Premium? true / false / null (not known yet). Set in Settings, or by the extension
	// once Spotify says which plan the logged-in account is on. Premium gets SpotX's Premium mode.
	spotifyPremium: null,
	theme: "classic", // the look of Settings and the overlay: "classic", "neon", "light" or "vice"
	// lobbyRelays: ["wss://..."], // optional: use your own MQTT-over-WebSocket relays instead of the public ones
};

// Themes (Settings and the overlay) and Settings' background in each (the window's colour before
// the page paints).
const THEME_BG = { classic: "#0d0f13", neon: "#070908", light: "#f6f5f1", vice: "#140826" };
const themeName = () => (THEME_BG[config.theme] ? config.theme : "classic");

// Testing: run a second copy side by side with its own settings.
if (process.env.OVERLAY_DEBUG_USERDATA) app.setPath("userData", process.env.OVERLAY_DEBUG_USERDATA);
const userDir = app.getPath("userData");
const CONFIG_PATH = path.join(userDir, "config.json");
const LAYOUT_PATH = path.join(userDir, "layout.json");
const FRIENDS_PATH = path.join(userDir, "friends.json");
const AVATAR_PATH = path.join(userDir, "avatar.jpg"); // your profile picture, 96x96
const AVATAR_PNG_PATH = path.join(userDir, "avatar.png"); // instead, for a picture with a transparent background

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

	win.loadFile(path.join(__dirname, "renderer", "index.html"), { query: { theme: themeName() } });
	win.once("ready-to-show", () => {
		placeWindow("shown"); // inactive: doesn't steal focus from the game on launch
		sendToRenderer("overlay", { shown: overlayShown, edit: editMode });
		sendToRenderer("bridge-status", { connected: !!bridge });
		if (process.env.OVERLAY_DEBUG_EDIT) setEdit(true);
		if (process.env.OVERLAY_DEBUG_CAPTURE) debugCapture(process.env.OVERLAY_DEBUG_CAPTURE);
		// tests: shrink the window to the work area minus a taskbar, the way Windows does
		if (process.env.OVERLAY_DEBUG_SHRINK) setTimeout(() => { const b = pickDisplay().bounds; win.setBounds({ ...b, height: b.height - 40 }); }, Number(process.env.OVERLAY_DEBUG_SHRINK));
	});

	// Windows sometimes drops topmost when another topmost app activates; re-assert.
	win.on("blur", () => {
		if (!win || win.isDestroyed()) return;
		win.setAlwaysOnTop(true, "screen-saver");
		syncZone();
	});
	win.on("focus", () => syncZone());

	screen.on("display-metrics-changed", () => {
		if (!win || win.isDestroyed()) return;
		placeWindow("display changed");
	});
	screen.on("display-added", () => placeWindow("display added"));
	screen.on("display-removed", () => placeWindow("display removed"));
}

// Where the overlay window goes. Shown (or in Edit Mode) it covers the whole display, taskbar
// area included. Hidden, it only covers the panels that stay visible while hidden (their
// "opacity when hidden" isn't 0; usually the compact Now Playing and notices), or isn't there
// at all when none do. A full-screen window on top of a game, even a see-through one, makes
// Windows composite every game frame with it instead of letting the game present directly,
// which cost a lot of FPS (160 → 90) and kicked in again after every alt-tab back in. The
// renderer keeps laying panels out in display coordinates and shifts them by the window's
// offset (`viewport`), so the panels don't move on screen when the window changes.
//
// Windows pulls a window that's bigger than the work area (the screen minus the taskbar) back
// inside it when it's shown, so after every show the bounds are put back, and once more a
// moment later. The 200 ms check gives up after a few tries in a row (logged), so it can't
// fight Windows forever; showing the overlay, Edit Mode or a display change start it again.
const HIDDEN_PAD = 24; // room for the panels' shadows
let hiddenArea = []; // display-relative rects of the panels visible while hidden (from the renderer)

function wantedBounds() {
	const d = pickDisplay().bounds;
	if (editMode || overlayShown) return d;
	if (!hiddenArea.length) return null;
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	for (const r of hiddenArea) {
		x0 = Math.min(x0, r.x - HIDDEN_PAD);
		y0 = Math.min(y0, r.y - HIDDEN_PAD);
		x1 = Math.max(x1, r.x + r.w + HIDDEN_PAD);
		y1 = Math.max(y1, r.y + r.h + HIDDEN_PAD);
	}
	x0 = Math.max(0, Math.floor(x0));
	y0 = Math.max(0, Math.floor(y0));
	x1 = Math.min(d.width, Math.ceil(x1));
	y1 = Math.min(d.height, Math.ceil(y1));
	if (x1 - x0 < 1 || y1 - y0 < 1) return null;
	return { x: d.x + x0, y: d.y + y0, width: x1 - x0, height: y1 - y0 };
}

const sameRect = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

// Tell the renderer which part of the display the window shows, then move the window. Growing,
// the renderer goes first and says when it has (so the visible panels don't jump to the
// window's corner for a frame); shrinking, the window goes first.
let viewportSeq = 0;
let pendingBounds = null;
function setViewport(want) {
	const d = pickDisplay().bounds;
	const cur = win.getBounds();
	const msg = { x: want.x - d.x, y: want.y - d.y, dw: d.width, dh: d.height, seq: ++viewportSeq };
	if (want.width * want.height > cur.width * cur.height) {
		pendingBounds = want;
		sendToRenderer("viewport", msg);
		const seq = msg.seq;
		setTimeout(() => viewportApplied(seq), 200); // in case the renderer doesn't answer
	} else {
		pendingBounds = null;
		win.setBounds(want);
		sendToRenderer("viewport", msg);
		syncZone();
	}
}
function viewportApplied(seq) {
	if (seq !== viewportSeq || !pendingBounds || !win || win.isDestroyed()) return;
	win.setBounds(pendingBounds);
	pendingBounds = null;
	syncZone();
}

let fitTries = 0;
let fitLastTry = 0;
function placeWindow(why = "") {
	if (!win || win.isDestroyed()) return;
	const want = gateOpen ? wantedBounds() : null;
	if (!want) {
		if (win.isVisible()) {
			setInteractive(false);
			win.hide();
			if (gateOpen) diag("overlay window hidden: no panels show while hidden");
		}
		syncZone();
		return;
	}
	const cur = win.getBounds();
	if (sameRect(cur, want) || (pendingBounds && sameRect(pendingBounds, want))) fitTries = 0;
	else if (why === "checked" && (Date.now() - fitLastTry < 600 || fitTries >= 4)) {
		// let the last resize land before checking again; stop after a few tries
	} else {
		if (why === "checked" && ++fitTries === 4) diag(`window stays ${cur.width}x${cur.height}; Windows won't let it be ${want.width}x${want.height}`);
		if (why !== "checked") fitTries = 0;
		fitLastTry = Date.now();
		diag(`window was ${cur.width}x${cur.height} at ${cur.x},${cur.y}; set to ${want.width}x${want.height} at ${want.x},${want.y}${why ? " (" + why + ")" : ""}`);
		setViewport(want);
	}
	if (!win.isVisible()) {
		win.showInactive(); // inactive: don't take the keyboard from the game
		win.setAlwaysOnTop(true, "screen-saver");
		lastCursor = null;
		setTimeout(() => placeWindow("after show"), 400);
	}
}

// Click-through except where the renderer says the mouse is over a panel.
// Not setIgnoreMouseEvents(true, { forward: true }): on Windows Electron forwards mouse moves
// with a system-wide low-level mouse hook run on this (main) thread, so every mouse movement,
// the game's included, waited for Mercify's main thread. Whenever it was busy for a moment the
// camera chugged while steering with the right mouse button (up to 1.13.1). Instead, while
// click-through, the cursor is looked at here a few times a second (pollCursor) and the renderer
// says whether it's over a panel; once interactive, the renderer gets real mouse events again.
let interactive = null;
function setInteractive(on) {
	if (!win || win.isDestroyed() || interactive === on) return;
	interactive = on;
	if (on) win.setIgnoreMouseEvents(false);
	else win.setIgnoreMouseEvents(true);
	lastCursor = null; // report the cursor again on the next poll
}

const CURSOR_POLL_MS = 50;
let lastCursor = null;
function pollCursor() {
	if (!win || win.isDestroyed() || interactive || !gateOpen || !win.isVisible()) return;
	const p = screen.getCursorScreenPoint();
	const b = win.getBounds();
	const x = p.x - b.x;
	const y = p.y - b.y;
	const inside = x >= 0 && y >= 0 && x < b.width && y < b.height;
	const key = inside ? x + "," + y : "out";
	if (key === lastCursor) return;
	lastCursor = key;
	if (inside) sendToRenderer("cursor", { x, y });
}

// Clicking a panel must not make the overlay window active: the game would lose the keyboard
// and drop the keys you're holding (you'd stop running mid-WASD). The renderer says where its
// clickable panels are; the helper watches for clicks there and reports them, and they're
// replayed in the renderer. While the overlay has the keyboard anyway (typing in a text box,
// Edit Mode) the window takes clicks itself. Without the helper (or on other systems) panels
// take clicks the old way, by making the window clickable under the mouse.
let zoneRects = []; // in window coordinates, from the renderer
let zoneOn = false;
function syncZone() {
	if (!win || win.isDestroyed()) return;
	const want = zoneRects.length > 0 && !editMode && gateOpen && win.isVisible() && !win.isFocused() && foreground.canZone();
	if (want) {
		const b = win.getBounds();
		foreground.setClickZone(zoneRects.map((r) => screen.dipToScreenRect(win, { x: b.x + r.x, y: b.y + r.y, width: r.w, height: r.h })));
	} else foreground.setClickZone(null);
	if (want === zoneOn) return;
	zoneOn = want;
	if (want) {
		setInteractive(false);
		sendToRenderer("interactive-reset");
	}
	sendToRenderer("zone-state", { on: want });
}

foreground.onZone((e) => {
	if (!zoneOn || !win || win.isDestroyed()) return;
	const p = screen.screenToDipPoint({ x: e.x, y: e.y });
	const b = win.getBounds();
	sendToRenderer("zone-mouse", { type: e.type, x: p.x - b.x, y: p.y - b.y, d: e.d });
});

function sendToRenderer(channel, payload) {
	if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

let shrinkTimer = null;
function setShown(on) {
	overlayShown = on;
	if (!on && editMode) setEdit(false);
	if (!on) releaseFocus();
	clearTimeout(shrinkTimer);
	if (on) placeWindow("overlay shown");
	sendToRenderer("overlay", { shown: overlayShown, edit: editMode });
	// shrink once the panels have faded out (their fade takes about 0.16 s)
	if (!on) shrinkTimer = setTimeout(() => placeWindow("overlay hidden"), 250);
	syncZone();
}

function setEdit(on) {
	editMode = on;
	if (on) {
		overlayShown = true;
		applyGate(true);
		placeWindow("edit mode");
		setInteractive(true);
		takeFocus(); // so arrow-key nudging works
	} else {
		releaseFocus();
	}
	sendToRenderer("overlay", { shown: overlayShown, edit: editMode });
	syncZone();
	updateTrayMenu();
}

// Stop taking clicks/keys and hand focus back to the app you were in (usually the game).
function releaseFocus() {
	if (!win || win.isDestroyed()) return;
	setInteractive(false);
	lastCursor = null;
	sendToRenderer("interactive-reset");
	giveFocusBack("release");
}

// Hand the keyboard back to the window that had it before the overlay (normally the game).
// blur() activates whatever visible window is next below the overlay, which for an always-on-top
// window is often another always-on-top or invisible one (the taskbar, an input-method window):
// the overlay then hid as if you'd switched apps, and the game had no keyboard until you
// alt-tabbed (1.7.0 and 1.7.1 on single-monitor PCs). So the helper activates the window we saw
// in front last, by handle, and reports back. blur() is only used when there's no helper.
let returningTo = 0; // while handing the keyboard back: the window we're waiting to see in front
let returningUntil = 0;

async function giveFocusBack(reason) {
	if (!win || win.isDestroyed()) return;
	const fg = foreground.supported() ? foreground.getForeground() : null;
	const overlayInFront = win.isFocused() || (fg && fg.pid === process.pid);
	if (!overlayInFront) return; // you've already clicked somewhere else: leave it
	if (!foreground.canActivate() || !lastOtherHwnd) {
		diag(`give back (${reason}): no helper, blur()`);
		if (win.isFocused()) win.blur();
		return;
	}
	const target = lastOtherHwnd;
	returningTo = target;
	returningUntil = Date.now() + 1500;
	const r = await foreground.activate(target);
	diag(`give back (${reason}) to ${describeHwnd(target)}: ${r ? (r.ok ? "ok via " + r.via : "refused (" + r.via + ")") : "no answer"}`);
	if (r?.ok) return; // tickGate clears returningTo once the helper sees it in front
	returningTo = 0;
	if (r && !r.ok && r.via !== "minimised" && r.via !== "gone") {
		// Windows wouldn't let us. Keep the overlay up rather than guessing a window with blur().
		sendToRenderer("toast", { text: "Click your game to carry on playing (Windows didn't let Mercify hand the keyboard back)." });
	}
}

// ------------------------------------------------------------------ diagnostics
// A short log of what was in front and what Mercify did about it, for "Copy diagnostics" in the
// tray menu. Window titles are only kept for your chosen apps (browser titles can be private).
const diagLog = [];
const knownWindows = new Map(); // hwnd -> short description
function diag(text) {
	const t = new Date();
	const stamp = t.toTimeString().slice(0, 8) + "." + String(t.getMilliseconds()).padStart(3, "0");
	diagLog.push(`${stamp} ${text}`);
	if (diagLog.length > 200) diagLog.shift();
}
function describeFg(fg) {
	if (!fg) return "unknown";
	const own = fg.pid === process.pid;
	const title = !own && matchesApp(fg) ? ` "${String(fg.title).slice(0, 60)}"` : "";
	return `${own ? "Mercify" : fg.exe || "?"} [${fg.cls || "?"}]${title} hwnd ${fg.hwnd} mon ${fg.mon}`;
}
function describeHwnd(h) {
	return knownWindows.get(h) || `hwnd ${h}`;
}
function diagnosticsText() {
	return [
		`Mercify ${app.getVersion()} diagnostics, ${new Date().toISOString()}`,
		`Windows ${require("os").release()}, displays: ${screen.getAllDisplays().length}, overlay on display ${win ? screen.getDisplayMatching(win.getBounds()).id : "?"}`,
		`Only show over apps: ${config.onlyShowOver.enabled} (${[...config.onlyShowOver.apps, ...config.onlyShowOver.titles].join(", ")}); other monitor: ${config.onlyShowOver.stayOnOtherMonitor}`,
		`Helper: ${foreground.supported() ? "running" : "not running"}; gate ${gateOpen ? "open" : "closed"} (${gateWhy})`,
		(() => {
			if (!win || win.isDestroyed()) return "Window: none";
			const d = pickDisplay();
			const w = win.getBounds();
			const r = (b) => `${b.width}x${b.height} at ${b.x},${b.y}`;
			return `Window ${r(w)}; display ${r(d.bounds)}, work area ${r(d.workArea)}, scale ${d.scaleFactor}`;
		})(),
		"",
		...diagLog,
	].join("\n");
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
	diag(`overlay ${open ? "shown" : "hidden"} (${gateWhy})`);
	if (open) {
		placeWindow("shown");
		lastCursor = null;
		sendToRenderer("interactive-reset");
	} else {
		setInteractive(false);
		win.hide();
	}
	syncZone();
}

let gameInFront = false; // a chosen app was the last window in front (ignoring our own windows)
let lastOtherHwnd = 0; // the last window in front that wasn't ours: where the keyboard goes back to
// The taskbar and Start menu can briefly take the foreground (and did, after a click on the
// overlay): treat them like our own windows and leave the overlay as it is.
const SHELL_CLASSES = new Set(["Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow"]);
let gateWhy = "";
let lastSeenHwnd = -1;

function tickGate() {
	if (!win || win.isDestroyed()) return;
	const fg = foreground.supported() ? foreground.getForeground() : null;
	const ours = fg && (fg.pid === process.pid || SHELL_CLASSES.has(fg.cls));
	if (fg && fg.hwnd !== lastSeenHwnd) {
		lastSeenHwnd = fg.hwnd;
		const d = describeFg(fg);
		if (fg.hwnd && fg.pid !== process.pid) knownWindows.set(fg.hwnd, d.replace(/ hwnd \d+ mon .*/, ""));
		if (knownWindows.size > 50) knownWindows.delete(knownWindows.keys().next().value);
		diag(`in front: ${d}`);
	}
	// Handing the keyboard back: until the window we asked for shows up in front (or we give up),
	// don't let whatever flickers past in between hide the overlay or become "the last window".
	if (returningTo && (Date.now() > returningUntil || fg?.hwnd === returningTo)) {
		if (fg?.hwnd !== returningTo) diag(`give back: ${describeHwnd(returningTo)} never showed up in front`);
		returningTo = 0;
	}
	const passing = returningTo && fg && fg.hwnd !== returningTo;

	if (fg && !ours && !passing) {
		if (fg.hwnd) lastOtherHwnd = fg.hwnd;
		gameInFront = matchesApp(fg);
		// remember the game's window, so we can tell whether it's still up on its own monitor
		if (gameInFront && fg.hwnd) foreground.setAnchor(fg.hwnd);
	}

	let open = true;
	gateWhy = "off";
	if (filterActive()) {
		if (editMode || win.isFocused() || Date.now() < forceOpenUntil) [open, gateWhy] = [true, "overlay"];
		// Settings in front: hide so the overlay doesn't cover it, unless it's on another monitor
		// from the game (it's one of our windows, but the helper still reports its monitor)
		else if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isFocused()) [open, gateWhy] = fg && onOtherMonitor(fg) ? [true, "other-monitor"] : [false, "settings"];
		else if (!fg || ours || passing) [open, gateWhy] = [gateOpen, "unchanged"]; // tray menu etc.: leave as is
		else if (gameInFront) [open, gateWhy] = [true, "game"];
		else if (onOtherMonitor(fg)) [open, gateWhy] = [true, "other-monitor"];
		else [open, gateWhy] = [false, "other-app"];
	}
	applyGate(open);
	if (gateOpen && win.isVisible()) placeWindow("checked");
	reportGate(fg);
	// Hotkeys follow the game itself being in front, so they're yours again in other apps,
	// even while the overlay stays up over the game on another monitor.
	setHotkeysActive(!filterActive() || !config.hotkeysOnlyOverApps || gameInFront || editMode || win.isFocused());
}

// A line for Settings saying why the overlay is showing or hidden right now.
let gateText = null;
function reportGate(fg) {
	let t = gateText;
	const a = fg?.anchor;
	if (gateWhy === "off") t = "";
	else if (gateWhy === "game") t = "Showing: your game is in front.";
	else if (gateWhy === "other-monitor") t = "Showing: your game is still up on its own screen.";
	else if (gateWhy === "settings") t = a?.up && a.mon === fg?.mon ? "Hidden while Settings is on your game's screen." : "Hidden: your game isn't up on another screen.";
	else if (gateWhy === "other-app") {
		if (!a) t = "Hidden: none of these apps has been in front yet.";
		else if (!a.up) t = "Hidden: your game is minimised or closed.";
		else if (!config.onlyShowOver.stayOnOtherMonitor) t = "Hidden: another app is in front.";
		else if (a.mon === fg.mon) t = "Hidden: another window is in front on your game's screen.";
		else t = "Hidden: another app is in front.";
	}
	if (t === gateText) return;
	gateText = t;
	if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send("settings:gate", t);
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
			} else if (msg.type === "account") {
				// The plan Spotify's servers report for the logged-in account (the extension asks
				// the Web API: SpotX's free mode makes the app itself always say "premium").
				const premium = msg.product === "premium" ? true : msg.product ? false : null;
				if (premium !== null && premium !== config.spotifyPremium) {
					diag(`account: Spotify says ${msg.product}; was ${config.spotifyPremium}`);
					config.spotifyPremium = premium;
					saveConfig();
					pushSettings(); // the Spotify row says if SpotX needs setting up again for it
				}
			} else if (msg.type === "queue") {
				sendToRenderer("bridge", msg); // Spotify's own Up next, for the Session Playlist when solo
			} else if (msg.type === "hello") {
				heardFromSpotify();
				bridgeInfo = msg;
				pushSettings(); // "Connected to Spotify" turns green
				minimiseSpotifyOnce();
				sendToRenderer("bridge-status", { connected: true, info: msg });
				updateTrayMenu();
			} else if (msg.type === "state" || msg.type === "progress") {
				heardFromSpotify();
				if (msg.type === "state") spotifyPlaying = !!msg.state?.isPlaying;
				if (spotifyInCharge(msg.type === "state" ? msg.state : null)) emitPlayer(msg);
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
			playerToSettings({ type: "state", state: null });
			playerForFriends(null);
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

// ------------------------------------------------------------------ after logging in to Spotify
// The first time you log in (Spotify sends you to your browser and back), the Spotify window can
// stay blank, and the Mercify extension never loads, until Spotify is restarted. So: once Spotify
// says you're logged in, give it a moment to connect, and if it doesn't, restart it once.
// Already logged in when Mercify started: give a slow PC 30 s to load Spotify. Logged in while
// Mercify watched (setup's first login): the blank window is the expected outcome, so restart soon.
// After a restart, Spotify gets a patient 45 s (1.11.0 judged it after 8 s, too soon for a fresh
// PC, and said it "still hasn't connected" while it was still loading); then one more try.
const LOGIN_GRACE_MS = Number(process.env.OVERLAY_DEBUG_LOGIN_GRACE_MS) || 30000;
const FRESH_LOGIN_GRACE_MS = Number(process.env.OVERLAY_DEBUG_FRESH_LOGIN_GRACE_MS) || 8000;
const AFTER_RESTART_GRACE_MS = Number(process.env.OVERLAY_DEBUG_RESTART_GRACE_MS) || 45000;
const MAX_LOGIN_RESTARTS = 2;
let loggedInSince = 0;
let sawLoggedOut = false; // seen logged out during this run, so a login now is a fresh one
let restartedAt = 0;
let loginRestarts = 0;
let connectNote = ""; // for Settings' "Connected to Spotify" row and the progress line

function setConnectNote(text) {
	if (text === connectNote) return;
	connectNote = text;
	pushSettings();
}

// Bring Settings in front of Spotify and the browser you just logged in with. Windows doesn't let
// an app in the background simply take focus, so: on top for a moment, focus, and have the helper
// activate the window too (it has ways around that rule).
function focusSettings() {
	if (!settingsWin || settingsWin.isDestroyed()) return openSettings();
	if (settingsWin.isMinimized()) settingsWin.restore();
	settingsWin.show();
	settingsWin.setAlwaysOnTop(true, "floating");
	settingsWin.moveTop();
	settingsWin.focus();
	try {
		const h = settingsWin.getNativeWindowHandle();
		foreground.activate(h.length >= 8 ? Number(h.readBigUInt64LE(0)) : h.readUInt32LE(0));
	} catch (_) {}
	setTimeout(() => settingsWin && !settingsWin.isDestroyed() && settingsWin.setAlwaysOnTop(false), 1500);
}

setInterval(async () => {
	if (!setup.IS_WIN && !process.env.OVERLAY_DEBUG_FAKE_LOGGED_IN) return;
	if (bridge) {
		loggedInSince = 0;
		restartedAt = 0;
		if (connectNote) setConnectNote("");
		return;
	}
	if (setup.isSetupRunning()) return;
	if (!setup.spotifyLoggedIn()) {
		loggedInSince = 0;
		sawLoggedOut = true;
		if (setup.spotifyInstalled() && (await setup.isSpotifyRunning())) setConnectNote("Log in to Spotify in its window. Mercify comes back by itself once you have.");
		return;
	}
	if (!(await setup.isSpotifyRunning()) && !restartedAt) return; // nothing to restart; "Open Spotify" handles that
	if (!loggedInSince) {
		loggedInSince = Date.now();
		if (sawLoggedOut) {
			// you've just logged in: Mercify comes straight back to the front
			diag("logged in to Spotify (fresh login): bringing Settings back");
			setConnectNote("You're logged in! Finishing up…");
			focusSettings();
		}
	}
	const waited = Date.now() - (restartedAt || loggedInSince);
	const grace = restartedAt ? AFTER_RESTART_GRACE_MS : sawLoggedOut ? FRESH_LOGIN_GRACE_MS : LOGIN_GRACE_MS;
	if (waited < grace) return;
	if (loginRestarts >= MAX_LOGIN_RESTARTS) {
		setConnectNote("Spotify still hasn't connected. Press Redo next to Mercify extension, or restart your PC.");
		return;
	}
	loginRestarts++;
	restartedAt = Date.now();
	diag(`logged in to Spotify, but it hasn't connected: restarting it (${loginRestarts} of ${MAX_LOGIN_RESTARTS})`);
	setConnectNote(loginRestarts === 1 ? "You're logged in! Restarting Spotify so Mercify can connect…" : "Restarting Spotify once more…");
	await setup.restartSpotify({ minimized: true }); // in the tray, so it doesn't jump back over Mercify
}, 2000);

// ------------------------------------------------------------------ keeping up with a throttled Spotify
// After Spotify's window has been hidden (Mercify tucks it into the tray, or it sits behind the
// game) for about five minutes, Chromium runs the page's timers only about once a minute. The
// extension's own reports (song, position, every second) then nearly stop, and listening lobbies
// drifted apart until someone brought Spotify's window back. Commands still arrive straight away
// (they're messages, not timers), so when the reports go quiet Mercify asks for the state itself,
// and does so right after every playback command too.
const QUIET_MS = 2500;
let lastHeard = 0;
let asking = false;
let quiet = false;
let quietAsks = 0; // for diagnostics
let spotifyPlaying = false; // paused, the extension has nothing to report even when awake

function heardFromSpotify() {
	lastHeard = Date.now();
}

async function askSpotifyState(why) {
	if (!bridge || asking) return;
	asking = true;
	try {
		const st = await bridgeCommand("state", {}, 4000);
		if (!st) return;
		heardFromSpotify();
		spotifyPlaying = !!st.isPlaying;
		if (!spotifyInCharge(st)) return;
		emitPlayer({ type: "state", state: st });
		if (st.isPlaying && Number.isFinite(st.position)) lobby.onPlayerProgress(st.position, st.at);
		if (why === "quiet") quietAsks++;
	} catch (_) {
	} finally {
		asking = false;
	}
}

setInterval(() => {
	if (!bridge || yt.active) return;
	const silent = Date.now() - lastHeard > QUIET_MS;
	if (silent !== quiet && (spotifyPlaying || !silent)) {
		quiet = silent;
		diag(silent ? "Spotify's extension went quiet (its window hidden for a while?); Mercify is asking it directly" : `Spotify's extension is reporting by itself again (asked ${quietAsks} times meanwhile)`);
	}
	if (silent) askSpotifyState("quiet");
}, 1000);

const QUERY_ACTIONS = new Set(["state", "search", "playlists", "playlistTracks"]);

function bridgeCommand(action, args, timeoutMs = 15000) {
	// after anything that changes playback, look again shortly instead of waiting for a report
	if (!QUERY_ACTIONS.has(action)) setTimeout(() => askSpotifyState("after " + action), 350);
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

// What's playing goes to the overlay, Settings, the lobby, friends and Discord, from Spotify or
// YouTube alike.
function emitPlayer(msg) {
	sendToRenderer("bridge", msg);
	playerToSettings(msg);
	if (msg.type === "state") lobby.onPlayerState(msg.state), playerForFriends(msg.state), discord.update(msg.state);
	else lobby.onPlayerProgress(msg.position, msg.at);
}

// Discord: Spotify's own card covers Spotify; this one covers YouTube videos (see discord.js).
// The application (named Mercify on Discord's Developer Portal) only needs its id here.
const DISCORD_CLIENT_ID = "1560470833867268149";
const discord = createDiscordPresence({ clientId: DISCORD_CLIENT_ID, log: (m) => diag(m) });
discord.setEnabled(config.discordYouTube !== false);

// ------------------------------------------------------------------ YouTube (yt-dlp)
//
// A YouTube video is played by Mercify itself (youtube.js fetches it, player/ plays it in a hidden
// window), as "youtube:<id>". While one is the current song, Spotify is paused and its reports
// are held back, so everything shows the video; Spotify takes over again when the video ends (or
// is stopped by picking a Spotify song, or you press play in Spotify). Every playback command
// goes through playerCommand(), which sends it to whichever of the two is in charge.

const youtube = createYouTube({
	dir: path.join(userDir, "yt-dlp"),
	cacheDir: path.join(app.getPath("temp"), "Mercify YouTube"),
	nodePath: process.execPath, // run with ELECTRON_RUN_AS_NODE=1, Mercify is the Node yt-dlp needs
	fetch: (url, opts) => net.fetch(url, opts),
	log: (m) => diag(m),
	debugCommand: process.env.OVERLAY_DEBUG_YTDLP || null, // tests: tools/fake-ytdlp.js
});

const isYouTubeUri = (u) => typeof u === "string" && /^youtube:[A-Za-z0-9_-]{11}$/.test(u);
const yt = {
	active: false, // a YouTube video is the current song (playing, paused or still loading)
	id: null,
	loading: false,
	playing: false,
	wantPlaying: true, // what to do once it's loaded (a lobby may pause it meanwhile)
	position: 0,
	at: 0,
	duration: 0,
	volume: Number.isFinite(config.youtubeVolume) ? config.youtubeVolume : 0.8,
	seq: 0, // which load the player's reports belong to
	graceUntil: 0, // Spotify reporting "playing" before this is our own pause catching up
	resumeSpotify: false, // Spotify was playing when the video took over, so it carries on after
};
const ytWaiters = new Map(); // seq -> { resolve, reject, timer }

let playerWin = null;
let playerLoaded = null;
function playerWindow() {
	if (playerWin && !playerWin.isDestroyed()) return playerLoaded;
	playerWin = new BrowserWindow({
		show: false,
		width: 240,
		height: 120,
		skipTaskbar: true,
		webPreferences: {
			preload: path.join(__dirname, "preload-player.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			backgroundThrottling: false,
			autoplayPolicy: "no-user-gesture-required",
		},
	});
	playerLoaded = new Promise((resolve) => playerWin.webContents.once("did-finish-load", resolve));
	playerWin.loadFile(path.join(__dirname, "player", "player.html"));
	playerWin.on("closed", () => {
		playerWin = null;
		if (yt.active) stopYouTube(false);
	});
	return playerLoaded;
}
const toPlayer = (channel, payload) => playerWin && !playerWin.isDestroyed() && playerWin.webContents.send(channel, payload);

const ytPosition = () => (yt.playing ? Math.min(yt.duration || Infinity, yt.position + (Date.now() - yt.at)) : yt.position);

function ytState() {
	const info = youtube.known(yt.id) || youtube.item(yt.id);
	return {
		uri: `youtube:${yt.id}`,
		name: info.name,
		artists: info.artists,
		image: info.image,
		duration: yt.duration || info.duration || 0,
		position: Math.round(ytPosition()),
		at: Date.now(),
		isPlaying: yt.playing,
		volume: yt.volume,
		shuffle: false,
		repeat: 0,
		liked: false,
		empty: false,
		source: "youtube",
		loading: yt.loading,
	};
}
const emitYouTube = () => yt.active && emitPlayer({ type: "state", state: ytState() });

// Spotify's report: shown, unless a YouTube video is the current song. Spotify starting to play
// anyway (you pressed play in Spotify) ends the video.
function spotifyInCharge(st) {
	if (!yt.active) return true;
	if (st?.isPlaying && Date.now() > yt.graceUntil) {
		diag("youtube: Spotify started playing, so the video stops");
		stopYouTube(false);
		return true;
	}
	return false;
}

async function playYouTube(id, { position = 0 } = {}) {
	const seq = ++yt.seq;
	const wasActive = yt.active;
	if (yt.id && yt.id !== id) youtube.protect(yt.id, false);
	Object.assign(yt, { active: true, id, loading: true, playing: false, wantPlaying: true, position: Math.max(0, position || 0), at: Date.now(), duration: youtube.known(id)?.duration || 0 });
	youtube.protect(id, true);
	yt.graceUntil = Date.now() + 5000;
	if (!wasActive) yt.resumeSpotify = spotifyPlaying;
	if (spotifyPlaying) pauseSpotifyOnly();
	toPlayer("player:stop");
	emitYouTube();
	if (!youtube.installed()) sendToRenderer("toast", { text: "Getting YouTube ready: a one-time download of yt-dlp (about 18 MB)…" });
	youtube
		.lookup(id)
		.then(() => seq === yt.seq && emitYouTube())
		.catch(() => {});
	let file;
	try {
		file = await youtube.prepare(id);
		if (seq !== yt.seq) return false; // something else was picked meanwhile
		await playerWindow();
		const ready = new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				ytWaiters.delete(seq);
				reject(new Error("the video didn't start"));
			}, 20000);
			ytWaiters.set(seq, { resolve, reject, timer });
		});
		toPlayer("player:load", { seq, src: pathToFileURL(file).href, position: yt.position, playing: yt.wantPlaying, volume: yt.volume });
		await ready;
		return true;
	} catch (err) {
		if (seq === yt.seq) {
			diag(`youtube: ${id}: ${err.message}`);
			sendToRenderer("toast", { text: `Couldn't play that YouTube video: ${err.message}`, kind: "error" });
			err.shown = true; // the overlay doesn't need to say it again
			stopYouTube(yt.resumeSpotify); // Spotify carries on if the video interrupted it
		}
		throw err;
	}
}

// Pause Spotify without touching the YouTube player (pauseSpotify() pauses whatever's current).
function pauseSpotifyOnly() {
	bridgeCommand("state", {}, 4000)
		.then((st) => st?.isPlaying && bridgeCommand("togglePlay"))
		.catch(() => {});
}

function stopYouTube(resumeSpotify) {
	if (!yt.active) return;
	diag(`youtube: stop ${yt.id}${resumeSpotify ? ", back to Spotify" : ""}`);
	yt.active = false;
	yt.seq++;
	yt.loading = yt.playing = false;
	if (yt.id) youtube.protect(yt.id, false);
	toPlayer("player:stop");
	if (!bridge) return emitPlayer({ type: "state", state: { empty: true } });
	if (resumeSpotify)
		bridgeCommand("state", {}, 4000)
			.then((st) => (st && !st.empty && !st.isPlaying ? bridgeCommand("togglePlay") : askSpotifyState("youtube stopped")))
			.catch(() => {});
	else askSpotifyState("youtube stopped"); // show Spotify's song again
}

function ytSetPlaying(on) {
	if (!yt.active) return;
	if (yt.loading) {
		yt.wantPlaying = on; // applied once it's loaded
		return emitYouTube();
	}
	yt.position = ytPosition();
	yt.at = Date.now();
	yt.playing = on; // straight away; the player confirms
	if (on) yt.graceUntil = Date.now() + 3000;
	toPlayer(on ? "player:play" : "player:pause");
	emitYouTube();
}

function ytSeek(ms) {
	yt.position = Math.max(0, Math.min(Number(ms) || 0, yt.duration || Infinity));
	yt.at = Date.now();
	if (!yt.loading) toPlayer("player:seek", yt.position);
	emitYouTube();
}

let ytVolumeSave = null;
function ytVolume(level) {
	yt.volume = Math.max(0, Math.min(1, Number(level) || 0));
	toPlayer("player:volume", yt.volume);
	clearTimeout(ytVolumeSave);
	ytVolumeSave = setTimeout(() => {
		config.youtubeVolume = yt.volume;
		saveConfig();
	}, 800);
	emitYouTube();
}

// The video finished. In a lobby the host's session playlist starts its next song by itself
// (just before the end), and listeners follow the host. Otherwise Spotify carries on.
function youTubeEnded() {
	const seq = yt.seq;
	setTimeout(() => {
		if (!yt.active || yt.seq !== seq || yt.playing) return;
		const st = lobby.state();
		if (st.status === "joined" && st.role === "listener") return;
		if (st.status === "joined" && lobby.isHostWithQueue()) return lobby.playNext().catch(() => {});
		stopYouTube(yt.resumeSpotify);
	}, 1200);
}

ipcMain.on("player:event", (_e, ev) => {
	if (!ev || !yt.active || ev.seq !== yt.seq) return;
	if (ev.duration > 0) yt.duration = ev.duration;
	if (Number.isFinite(ev.position)) {
		yt.position = ev.position;
		yt.at = Date.now();
	}
	const waiter = ytWaiters.get(ev.seq);
	switch (ev.type) {
		case "ready":
			yt.loading = false;
			yt.playing = !!ev.playing;
			youtube.remember(yt.id, { duration: yt.duration });
			if (waiter) clearTimeout(waiter.timer), ytWaiters.delete(ev.seq), waiter.resolve();
			emitYouTube();
			break;
		case "play":
		case "pause":
			yt.playing = ev.type === "play";
			emitYouTube();
			break;
		case "time":
			emitPlayer({ type: "progress", position: ev.position, at: Date.now() });
			break;
		case "ended":
			yt.playing = false;
			yt.position = yt.duration;
			emitYouTube();
			youTubeEnded();
			break;
		case "error":
			if (waiter) clearTimeout(waiter.timer), ytWaiters.delete(ev.seq), waiter.reject(new Error(ev.message || "the audio wouldn't play"));
			else {
				sendToRenderer("toast", { text: `The YouTube video stopped: ${ev.message || "the audio wouldn't play"}`, kind: "error" });
				stopYouTube(false);
			}
			break;
	}
});

const SPOTIFY_ONLY = new Set(["toggleShuffle", "toggleRepeat", "toggleLike"]);

// Every playback command, from the overlay, Settings, hotkeys and the lobby.
async function playerCommand(action, args = {}, timeoutMs) {
	if (action === "playTrack" && isYouTubeUri(args.uri)) return playYouTube(args.uri.slice(8), { position: args.position || 0 });
	if (action === "addToQueue" && isYouTubeUri(args.uri)) throw new Error("YouTube videos queue up in a listening lobby's session playlist. Outside a lobby, click the video to play it");
	if (yt.active) {
		if (action === "state") return ytState();
		if (action === "togglePlay") return ytSetPlaying(yt.loading ? !yt.wantPlaying : !yt.playing);
		if (action === "seek") return ytSeek(args.ms);
		if (action === "setVolume") return ytVolume(args.level);
		if (action === "prev") return ytSeek(0);
		if (action === "next") {
			stopYouTube(false);
			return bridgeCommand("next", {}, timeoutMs);
		}
		if (SPOTIFY_ONLY.has(action)) throw new Error("That's for Spotify songs, not YouTube videos");
		if (action === "playTrack" || action === "playContext") stopYouTube(false);
	}
	return bridgeCommand(action, args, timeoutMs);
}

// Lobby members fetch the session playlist's videos ahead, so they play from a local file
// in step with everyone. A video that failed isn't tried again for 10 minutes.
const ytFailed = new Map(); // id -> when
function prefetchLobbyVideos() {
	const st = lobby.state();
	if (st.status !== "joined") return;
	const uris = [st.current?.uri, ...(st.queue || []).slice(0, 4).map((q) => q.uri)];
	for (const it of st.queue || []) if (isYouTubeUri(it.uri)) youtube.remember(it.uri.slice(8), { name: it.name, artists: it.artists, duration: it.duration || undefined });
	for (const uri of uris) {
		if (!isYouTubeUri(uri)) continue;
		const id = uri.slice(8);
		if (Date.now() - (ytFailed.get(id) || 0) < 600000 || youtube.cachedFile(id)) continue;
		youtube.prepare(id, { background: true }).catch((err) => {
			ytFailed.set(id, Date.now());
			diag(`youtube: couldn't fetch ${id} ahead: ${err.message}`);
		});
	}
}

// Search bar: a pasted YouTube link (its audio is fetched straight away, ready to play), or a
// YouTube search.
ipcMain.handle("yt:lookup", async (_e, text) => {
	const id = parseYouTubeId(text);
	if (!id) return { ok: false, notLink: true };
	youtube.prepare(id).catch(() => {});
	try {
		return { ok: true, item: await youtube.lookup(id) };
	} catch (err) {
		return { ok: false, error: err.message, item: youtube.item(id) };
	}
});
// Fetching ahead from the overlay: the top search results (in turn), and a result the mouse
// rests on (ahead of those), so a click usually finds the video ready.
ipcMain.on("yt:prefetch", (_e, ids, front) => {
	for (const id of (Array.isArray(ids) ? ids : []).slice(0, 3)) {
		if (typeof id !== "string" || youtube.cachedFile(id) || Date.now() - (ytFailed.get(id) || 0) < 600000) continue;
		youtube.prepare(id, { background: true, front: !!front }).catch((err) => ytFailed.set(id, Date.now()) && diag(`youtube: couldn't fetch ${id} ahead: ${err.message}`));
	}
});
ipcMain.handle("yt:search", async (_e, query) => {
	try {
		return { ok: true, items: await youtube.search(query) };
	} catch (err) {
		return { ok: false, error: err.message };
	}
});

// ------------------------------------------------------------------ listening lobbies

const lobbyRelays = process.env.OVERLAY_DEBUG_LOBBY_RELAYS
	? process.env.OVERLAY_DEBUG_LOBBY_RELAYS.split(",")
	: Array.isArray(config.lobbyRelays) && config.lobbyRelays.length
		? config.lobbyRelays
		: DEFAULT_RELAYS;

// Friends (friends.js): made first, so lobby heartbeats can carry our friends public key.
const friends = createFriends({
	store: { load: () => readJSON(FRIENDS_PATH, null), save: (d) => writeJSON(FRIENDS_PATH, d) },
	relays: lobbyRelays,
	lobbyCode: codeForFriend,
	log: (m) => console.log("[friends]", m),
});

const lobby = createLobby({
	command: (action, args) => playerCommand(action, args),
	relays: lobbyRelays,
	log: (m) => console.log("[lobby]", m),
	trace: !!process.env.OVERLAY_DEBUG_LOBBY_TRACE,
	friendPub: friends.pub,
});
lobby.setName(config.lobbyName);

const lobbyView = () => ({ ...lobby.state(), name: config.lobbyName });

lobby.on("change", () => {
	sendToRenderer("lobby", lobbyView());
	pushSettings();
	updateTrayMenu();
	updateFriendsPresence();
	prefetchLobbyVideos();
});
lobby.on("toast", (text) => sendToRenderer("toast", { text }));

// Leaving a lobby you were in pauses Spotify, so the lobby's music doesn't carry on by itself.
// Asks for the state first (the cached one can be stale while Spotify is throttled) and only
// toggles when it's actually playing, so works with any version of the extension.
async function leaveLobby() {
	const wasIn = lobby.state().status === "joined";
	const r = await lobby.leave();
	if (wasIn) pauseSpotify().catch(() => {});
	return r;
}

async function pauseSpotify() {
	if (yt.active) return ytSetPlaying(false); // a YouTube video is the current song
	const st = await bridgeCommand("state", {}, 4000);
	if (st?.isPlaying) await bridgeCommand("togglePlay");
}

function setLobbyName(name) {
	config.lobbyName = String(name || "").trim().slice(0, 24);
	saveConfig();
	lobby.setName(config.lobbyName);
	friends.setName(config.lobbyName);
}

// ------------------------------------------------------------------ profile picture
// Chosen in Settings and shrunk to 96x96 (a few KB), so it can go to lobby members and friends
// with the rest of their messages. An opaque picture is cropped to a square and saved as a
// JPEG. One with a transparent background keeps it: trimmed to what's visible, padded to a
// square (so nothing is cut off) and saved as a PNG, since JPEG would turn the background black.

const AVATAR_SIZE = 96;
const AVATAR_PNG_MAX = 17500; // bytes; keeps the data URL under cleanAvatar()'s 24,000 characters
let avatar = null; // data URL
try {
	if (fs.existsSync(AVATAR_PNG_PATH)) avatar = "data:image/png;base64," + fs.readFileSync(AVATAR_PNG_PATH).toString("base64");
	else if (fs.existsSync(AVATAR_PATH)) avatar = "data:image/jpeg;base64," + fs.readFileSync(AVATAR_PATH).toString("base64");
} catch (_) {}

function applyAvatar() {
	lobby.setAvatar(avatar);
	friends.setAvatar(avatar);
	sendToRenderer("lobby", lobbyView());
	sendToRenderer("friends", friendsView());
}

// The visible part of a picture with transparency, centred on a transparent square;
// null when the picture is opaque. Works on the raw 4-bytes-per-pixel bitmap (alpha is
// the 4th byte in both BGRA and RGBA).
function transparentSquare(img) {
	const { width, height } = img.getSize();
	const px = img.toBitmap();
	let x0 = width, y0 = height, x1 = -1, y1 = -1, see = false;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const a = px[(y * width + x) * 4 + 3];
			if (a < 250) see = true;
			if (a > 8) {
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
		}
	}
	if (!see) return null;
	if (x1 < 0) throw new Error("That picture is completely transparent.");
	const w = x1 - x0 + 1, h = y1 - y0 + 1, side = Math.max(w, h);
	const out = Buffer.alloc(side * side * 4); // all transparent
	const ox = Math.floor((side - w) / 2), oy = Math.floor((side - h) / 2);
	for (let y = 0; y < h; y++) {
		const from = ((y0 + y) * width + x0) * 4;
		px.copy(out, ((oy + y) * side + ox) * 4, from, from + w * 4);
	}
	return nativeImage.createFromBitmap(out, { width: side, height: side });
}

// -> { data: Buffer, type: "png" | "jpeg" }
function makeAvatar(file) {
	const img = nativeImage.createFromPath(file);
	if (img.isEmpty()) throw new Error("That file isn't a picture Mercify can read (try a PNG or JPEG).");
	const clear = transparentSquare(img);
	if (clear) {
		// smaller sizes only if the picture is too detailed to fit; it's shown at 52 px at most
		for (const size of [AVATAR_SIZE, 80, 64, 52]) {
			const png = clear.resize({ width: size, height: size, quality: "best" }).toPNG();
			if (png.length <= AVATAR_PNG_MAX) return { data: png, type: "png" };
		}
		throw new Error("That picture is too detailed to send with its transparent background. Try a simpler one, or one without transparency.");
	}
	const { width, height } = img.getSize();
	const side = Math.min(width, height);
	const square = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
	const small = square.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, quality: "best" });
	for (const q of [85, 70, 55, 40]) {
		const jpg = small.toJPEG(q);
		if (jpg.length <= 12000) return { data: jpg, type: "jpeg" };
	}
	throw new Error("Couldn't make that picture small enough.");
}

function removeAvatarFiles() {
	for (const p of [AVATAR_PATH, AVATAR_PNG_PATH]) {
		try {
			fs.unlinkSync(p);
		} catch (_) {}
	}
}

async function pickAvatar() {
	const r = await dialog.showOpenDialog(settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined, {
		title: "Choose a profile picture",
		properties: ["openFile"],
		filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "bmp", "gif", "webp"] }],
	});
	if (r.canceled || !r.filePaths[0]) return null;
	const pic = makeAvatar(r.filePaths[0]);
	fs.mkdirSync(userDir, { recursive: true });
	removeAvatarFiles();
	fs.writeFileSync(pic.type === "png" ? AVATAR_PNG_PATH : AVATAR_PATH, pic.data);
	avatar = `data:image/${pic.type};base64,` + pic.data.toString("base64");
	applyAvatar();
	return avatar;
}

function clearAvatar() {
	removeAvatarFiles();
	avatar = null;
	applyAvatar();
}

ipcMain.handle("settings:pick-avatar", async () => {
	try {
		await pickAvatar();
		return { ok: true, state: await settingsState() };
	} catch (err) {
		return { ok: false, error: err.message, state: await settingsState() };
	}
});
ipcMain.handle("settings:clear-avatar", async () => {
	clearAvatar();
	return settingsState();
});

// ------------------------------------------------------------------ friends

const friendsView = () => ({ ...friends.state(), name: config.lobbyName });
friends.setName(config.lobbyName);
friends.setOptions({ share: config.friendsShareListening, allowJoin: config.friendsAllowJoin });

// What friends see: the song playing (if you share it) and whether you're in a lobby.
let friendsPlayer = null;
function playerForFriends(st) {
	friendsPlayer = st && !st.empty && st.uri ? { uri: st.uri, name: st.name, artists: st.artists, isPlaying: !!st.isPlaying } : null;
	updateFriendsPresence();
}
function updateFriendsPresence() {
	const st = lobby.state();
	const p = friendsPlayer;
	friends.setPresence({
		track: p ? { uri: p.uri, name: p.name, artists: p.artists } : null,
		playing: !!p?.isPlaying,
		inLobby: st.status === "joined",
		host: st.status === "joined" && st.role === "host",
	});
}

// A friend's request to join was accepted: the code of the lobby we're in, or a new one.
async function codeForFriend() {
	if (!String(config.lobbyName || "").trim()) throw new Error("Set your name first (on Settings' Lobby page)");
	let st = lobby.state();
	for (let i = 0; st.status === "connecting" && i < 60; i++) {
		await new Promise((r) => setTimeout(r, 250));
		st = lobby.state();
	}
	if (st.status === "joined" && st.code) return st.code;
	await lobby.join(formatCode(generateCode()));
	st = lobby.state();
	if (st.status !== "joined" || !st.code) throw new Error("Couldn't start a lobby");
	return st.code;
}

let lastFriendRequests = "";
friends.on("change", () => {
	sendToRenderer("friends", friendsView());
	toSettings("settings:friends", friendsView());
	const reqs = JSON.stringify(friends.state().requests.map((r) => r.kind + r.fid));
	if (reqs !== lastFriendRequests) {
		lastFriendRequests = reqs;
		updateTrayMenu();
	}
});
friends.on("toast", (text) => sendToRenderer("toast", { text }));

// Requests show up in the overlay's Notifications panel with Accept / Decline (and in the tray
// menu). While the overlay isn't up over the game, Windows shows a notification too.
friends.on("join-request", ({ name }) => {
	if (!gateOpen || !overlayShown) notify(`${name} wants to listen with you`, "Accept from the overlay over your game, or from Mercify's tray menu.");
});
friends.on("add-request", ({ name }) => {
	if (!gateOpen || !overlayShown) notify(`${name} sent you a friend request`, "Accept from the overlay over your game, or from Mercify's tray menu.");
});

// Our request to join was accepted: join the lobby they sent.
friends.on("join", async ({ name, code }) => {
	sendToRenderer("toast", { text: `${name} accepted. Joining their lobby…` });
	try {
		await lobby.join(code);
	} catch (err) {
		sendToRenderer("toast", { text: `Couldn't join ${name}'s lobby: ${err.message}`, kind: "error" });
	}
});

// Friend requests and answers between lobby members.
lobby.on("friend", ({ ty, memberId, name, fpub }) => {
	if (ty === "friend-add") friends.receiveAdd({ pub: fpub, name }, (type) => lobby.friendSend(memberId, type));
	else friends.receiveAddReply({ pub: fpub, name }, ty === "friend-ok");
});

async function answerJoinRequest(fid, accept) {
	try {
		await friends.answerJoin(fid, accept);
		return { ok: true };
	} catch (err) {
		sendToRenderer("toast", { text: `Couldn't start a lobby for your friend: ${err.message}`, kind: "error" });
		return { ok: false, error: err.message };
	}
}

const ipcResult = (fn) => async (_e, ...args) => {
	try {
		return { ok: true, data: await fn(...args) };
	} catch (err) {
		return { ok: false, error: err.message };
	}
};

ipcMain.handle("friends:get", () => friendsView());
// Right-click a lobby member -> Add friend.
ipcMain.handle(
	"friends:add",
	ipcResult((memberId) => {
		const m = lobby.member(String(memberId || ""));
		if (!m) throw new Error("They've left the lobby");
		if (!m.fpub) throw new Error(`${m.name} needs a newer Mercify to add friends`);
		const r = friends.startAdd({ pub: m.fpub, name: m.name });
		if (r !== "accepted") lobby.friendSend(m.id, "friend-add");
		return r;
	})
);
ipcMain.handle("friends:remove", ipcResult((fid) => friends.removeFriend(String(fid || ""))));
ipcMain.handle("friends:request-join", ipcResult((fid) => friends.requestJoin(String(fid || ""))));
ipcMain.handle("friends:cancel-join", ipcResult((fid) => friends.cancelJoin(String(fid || ""))));
ipcMain.handle("friends:answer-join", (_e, fid, accept) => answerJoinRequest(String(fid || ""), !!accept));
ipcMain.handle("friends:answer-add", ipcResult((fid, accept) => (accept ? friends.acceptAdd(String(fid || "")) : friends.declineAdd(String(fid || "")))));

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
	await leaveLobby();
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
ipcMain.handle("lobby:queue-add-many", async (_e, tracks, label) => {
	try {
		return { ok: true, count: await lobby.queueAddMany(tracks, label) };
	} catch (err) {
		return { ok: false, error: err.message };
	}
});
ipcMain.on("lobby:vote-skip", (_e, on) => lobby.voteSkip(!!on));
ipcMain.on("lobby:queue-remove", (_e, qid) => lobby.queueRemove(qid));
ipcMain.on("lobby:queue-top", (_e, qid) => lobby.queueMoveTop(qid));
ipcMain.on("lobby:queue-play", (_e, qid) => lobby.playNow(qid));
// Host pressing Next while the session playlist has songs: play the next one from it.
ipcMain.handle("lobby:next", async () => {
	if (!lobby.isHostWithQueue()) return false;
	await lobby.playNext();
	return true;
});
// The lobby code for the clipboard. Copied while WoW is in front (or the overlay is, over it):
// "[Mercify:BA78-1XDC]", which K-UI: Forever's chat shows as a click-to-copy link holding just
// the code. Anywhere else (Settings, the tray, another app): the plain code.
function wowInFront() {
	const fg = foreground.supported() ? foreground.getForeground() : null;
	if (!fg) return false;
	if (fg.pid === process.pid) return gameInFront && !!win && !win.isDestroyed() && win.isFocused();
	return matchesApp(fg);
}
function copyLobbyCode() {
	const code = lobby.state().displayCode;
	if (!code) return null;
	const forChat = wowInFront();
	const text = forChat ? `[Mercify:${code}]` : code;
	clipboard.writeText(text);
	return { text, forChat };
}

ipcMain.handle("lobby:copy", () => copyLobbyCode());

// Starting a lobby from outside the overlay (Settings, tray): a fresh random code,
// joined straight away. Nobody else has that code, so you're the host; the code is
// put on the clipboard so it's ready to share.
async function startLobby() {
	await lobby.join(formatCode(generateCode()));
	const st = lobby.state();
	if (st.status !== "joined") return false; // left again while connecting
	copyLobbyCode();
	return true;
}
ipcMain.handle("settings:lobby-start", async () => {
	try {
		const copied = await startLobby();
		return { ok: true, copied, state: await settingsState() };
	} catch (err) {
		return { ok: false, error: err.message, state: await settingsState() };
	}
});
ipcMain.handle("settings:lobby-join", async (_e, code) => {
	try {
		await lobby.join(code);
		return { ok: true, state: await settingsState() };
	} catch (err) {
		return { ok: false, error: err.message, state: await settingsState() };
	}
});
ipcMain.on("settings:lobby-copy", () => copyLobbyCode());

// ------------------------------------------------------------------ overlay IPC

// Songs picked in the overlay are deliberate; the session playlist mustn't override them.
const MANUAL_PLAY = new Set(["playTrack", "playContext", "prev", "next"]);

ipcMain.handle("cmd", async (_e, { action, args }) => {
	if (MANUAL_PLAY.has(action)) lobby.markManual();
	try {
		return { ok: true, data: await playerCommand(action, args) };
	} catch (err) {
		return { ok: false, error: err.message, shown: !!err.shown };
	}
});

// The renderer decides which spots are clickable (including the compact widget while hidden).
ipcMain.on("set-interactive", (_e, on) => {
	if (editMode) return setInteractive(true);
	if (zoneOn) return setInteractive(false); // the helper takes the widget's clicks
	setInteractive(!!on && gateOpen);
});

ipcMain.on("hidden-area", (_e, rects) => {
	hiddenArea = (Array.isArray(rects) ? rects : []).filter((r) => r && r.w > 0 && r.h > 0).map((r) => ({ x: +r.x || 0, y: +r.y || 0, w: +r.w, h: +r.h }));
	if (!overlayShown && !editMode) placeWindow("panels changed");
});
ipcMain.on("viewport-applied", (_e, seq) => viewportApplied(seq));

ipcMain.on("click-zone", (_e, rects) => {
	zoneRects = (Array.isArray(rects) ? rects : []).filter((r) => r && r.w > 0 && r.h > 0).map((r) => ({ x: +r.x || 0, y: +r.y || 0, w: +r.w, h: +r.h }));
	syncZone();
});

// A text box was clicked. With the click zone on, Mercify didn't get the click itself, so
// Windows won't let it take the keyboard by itself: the helper brings the overlay to the front.
ipcMain.on("want-focus", async () => {
	if (zoneOn && foreground.canActivate() && win && !win.isDestroyed()) {
		const h = win.getNativeWindowHandle();
		const r = await foreground.activate(h.length >= 8 ? h.readBigUInt64LE(0) : h.readUInt32LE(0));
		diag(`text box clicked: overlay to the front ${r ? (r.ok ? "ok via " + r.via : "refused (" + r.via + ")") : "no answer"}`);
	}
	takeFocus();
});
ipcMain.on("open-settings", () => openSettings());

// After a click on a button or list row: keep taking clicks, but give the keyboard back.
// On Windows, blur() activates the next window down, which is normally the game.
let giveBacks = 0; // counted for the debug state file
ipcMain.on("give-back-focus", () => {
	giveBacks++;
	if (!win || win.isDestroyed() || editMode) return;
	giveFocusBack("click");
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
		clearTimeout(shrinkTimer);
		applyGate(true);
		placeWindow("search");
		sendToRenderer("overlay", { shown: true, edit: false });
		takeFocus();
		sendToRenderer("focus-search");
	},
	playPause: () => playerCommand("togglePlay").catch(() => {}),
	// In a lobby: a listener's Next votes to skip; the host's plays the next session song.
	next: () => {
		const st = lobby.state();
		if (st.status === "joined" && st.role === "listener") return lobby.voteSkip(!st.skip?.mine);
		if (lobby.isHostWithQueue()) return lobby.playNext().catch(() => {});
		playerCommand("next").catch(() => {});
	},
	prev: () => playerCommand("prev").catch(() => {}),
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
	if (hotkeysSuspended || on === gatedActive) return;
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

// Settings' Hotkeys page changes a hotkey by pressing the new keys. While it listens, every
// hotkey is released: a registered one goes straight to its action and never reaches the window.
// Closing Settings (or it losing focus, in the page) brings them back.
let hotkeysSuspended = false;
function suspendHotkeys(on) {
	if (on === hotkeysSuspended) return;
	if (on) {
		globalShortcut.unregisterAll();
		gatedActive = false;
		hotkeysSuspended = true;
	} else {
		hotkeysSuspended = false;
		failedHotkeys.clear();
		registerHotkeys();
	}
}

const HOTKEY_NAMES = { toggle: "Show / hide panels", edit: "Edit Mode", search: "Search", playPause: "Play / pause", next: "Next track", prev: "Previous track" };
const HOTKEY_REQUIRED = new Set(["toggle", "edit", "search"]);

function setHotkey(name, accel) {
	if (!Object.hasOwn(DEFAULT_CONFIG.hotkeys, name)) throw new Error("Unknown hotkey");
	accel = String(accel || "").trim();
	if (!accel && HOTKEY_REQUIRED.has(name)) throw new Error(`${HOTKEY_NAMES[name]} always needs a hotkey`);
	const old = config.hotkeys[name] || "";
	if (accel && accel.toLowerCase() !== old.toLowerCase()) {
		const clash = Object.entries(config.hotkeys).find(([k, v]) => k !== name && v && v.toLowerCase() === accel.toLowerCase());
		if (clash) throw new Error(`Already used for ${HOTKEY_NAMES[clash[0]] || clash[0]}`);
		// Try it: Windows refuses a combination another program has taken.
		let ok = false;
		try {
			ok = globalShortcut.register(accel, () => {});
		} catch (_) {
			throw new Error("That combination can't be used as a hotkey");
		}
		if (!ok) throw new Error("Another program already uses that combination");
		globalShortcut.unregister(accel);
	}
	if (old && globalShortcut.isRegistered(old)) globalShortcut.unregister(old);
	for (const f of [...failedHotkeys]) if (f.startsWith(name + " (")) failedHotkeys.delete(f);
	config.hotkeys[name] = accel;
	saveConfig();
	if (!hotkeysSuspended && accel && (ALWAYS_ON.has(name) || gatedActive)) registerOne(name);
	updateTrayMenu();
}

function resetHotkeys() {
	for (const v of Object.values(config.hotkeys)) if (v && globalShortcut.isRegistered(v)) globalShortcut.unregister(v);
	failedHotkeys.clear();
	Object.assign(config.hotkeys, DEFAULT_CONFIG.hotkeys);
	saveConfig();
	if (!hotkeysSuspended) {
		const active = gatedActive;
		for (const name of ALWAYS_ON) registerOne(name);
		if (active) for (const name of Object.keys(config.hotkeys)) if (!ALWAYS_ON.has(name)) registerOne(name);
	}
	updateTrayMenu();
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

// page: which of Settings' pages to show ("lobby", "hotkeys", ...); none keeps the one it's on.
function openSettings(page) {
	if (typeof page !== "string") page = null; // also used as a click handler, which passes an event
	if (settingsWin && !settingsWin.isDestroyed()) {
		if (settingsWin.isMinimized()) settingsWin.restore();
		settingsWin.show();
		settingsWin.focus();
		if (page) settingsWin.webContents.send("settings:page", page);
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
		backgroundColor: THEME_BG[themeName()],
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
	// the theme goes in the address too, so the page is drawn in it from the first frame
	settingsWin.loadFile(path.join(__dirname, "settings", "settings.html"), { query: { theme: themeName(), page: page || "home" } });
	settingsWin.once("ready-to-show", () => settingsWin.show());
	settingsWin.on("closed", () => {
		settingsWin = null;
		suspendHotkeys(false); // closed while waiting for new hotkey keys
	});
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
		avatar,
		update: updater.state(),
		setup: await setup.status({ premium: config.spotifyPremium }),
		spotifyPremium: config.spotifyPremium,
		connected: !!bridge,
		foregroundSupported: foreground.supported(),
		onlyShowOver: config.onlyShowOver,
		hotkeysOnlyOverApps: config.hotkeysOnlyOverApps,
		gateText,
		setupRun: setup.isSetupRunning() ? { running: true, steps: setupSteps } : lastSetup,
		setupLog: setupLog.slice(-200),
		connectNote,
		launchSpotify: config.launchSpotify,
		minimiseSpotify: config.minimiseSpotify,
		friendsShareListening: config.friendsShareListening,
		friendsAllowJoin: config.friendsAllowJoin,
		discordYouTube: config.discordYouTube !== false,
		startWithWindows: getStartWithWindows(),
		hotkeys: config.hotkeys,
		hotkeyDefaults: DEFAULT_CONFIG.hotkeys,
		failedHotkeys: [...failedHotkeys],
		theme: themeName(),
		player: settingsPlayer,
		friends: friendsView(),
		version: app.getVersion(),
		youtube: { ...youtube.status(), version: youtubeVersion },
	};
}

// yt-dlp's version for Settings (asking it takes a moment, so it's remembered)
let youtubeVersion = null;
if (youtube.installed()) youtube.getVersion().then((v) => (youtubeVersion = v));

function toSettings(channel, payload) {
	if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send(channel, payload);
}

// Settings' Home shows what's playing, with play/pause and skip buttons.
let settingsPlayer = null;
function playerToSettings(msg) {
	if (msg.type === "state") settingsPlayer = msg.state || null;
	else if (msg.type === "progress" && settingsPlayer) settingsPlayer = { ...settingsPlayer, position: msg.position, at: msg.at || Date.now() };
	toSettings("settings:player", settingsPlayer);
}

// The same as the overlay's buttons: in a lobby, a listener's Next votes to skip and the
// host's plays the next session song; songs picked here count as picked on purpose.
const SETTINGS_PLAYER = {
	playPause: () => playerCommand("togglePlay"),
	prev: () => {
		lobby.markManual();
		return playerCommand("prev");
	},
	next: () => {
		const st = lobby.state();
		if (st.status === "joined" && st.role === "listener") return lobby.voteSkip(!st.skip?.mine);
		if (lobby.isHostWithQueue()) return lobby.playNext();
		lobby.markManual();
		return playerCommand("next");
	},
};
ipcMain.handle("settings:player", async (_e, action) => {
	const run = SETTINGS_PLAYER[action];
	if (!run) return { ok: false, error: "Unknown action" };
	try {
		await run();
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err.message };
	}
});

ipcMain.handle("settings:friend-join", ipcResult((fid, cancel) => (cancel ? friends.cancelJoin(String(fid || "")) : friends.requestJoin(String(fid || "")))));

ipcMain.handle("settings:hotkey-capture", (_e, on) => suspendHotkeys(!!on));
ipcMain.handle("settings:set-hotkey", async (_e, name, accel) => {
	try {
		setHotkey(String(name || ""), accel);
		return { ok: true, state: await settingsState() };
	} catch (err) {
		return { ok: false, error: err.message, state: await settingsState() };
	}
});
ipcMain.handle("settings:reset-hotkeys", async () => {
	resetHotkeys();
	return settingsState();
});

async function pushSettings() {
	if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send("settings:changed", await settingsState());
	updateTrayMenu();
}

function settingsLog(line) {
	if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send("settings:log", line);
}

ipcMain.handle("settings:get", () => settingsState());

// The whole setup in one go (Settings' big button), or one step again (the small buttons).
let lastSetup = null; // { ok, step, why } of the last run, for Settings and "Copy details"
const setupLog = [];
function setupLogLine(line) {
	setupLog.push(line);
	if (setupLog.length > 400) setupLog.shift();
	settingsLog(line);
	// for the progress bar: SpotX's download percentage, and a friendlier line for some stages
	const pct = /(\d{1,3}(?:\.\d)?)%\s*$/.exec(line);
	const detail = pct
		? { pct: Math.min(100, parseFloat(pct[1])) }
		: /Downloading and installing Spotify/i.test(line)
			? { text: "Downloading Spotify…" }
			: /Patching Spotify/i.test(line)
				? { text: "Adding SpotX to Spotify…" }
				: /Patching files \[(\d+)\/(\d+)\]/.test(line)
					? { text: "Adding Mercify to Spotify…", sub: Number(RegExp.$1) / Number(RegExp.$2) }
					: null;
	if (detail && settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send("settings:setup-detail", detail);
}
const setupSteps = {}; // step -> { state, text } of the current run, for a Settings window opened mid-run
function setupProgress(step, state, text) {
	setupSteps[step] = { state, text };
	diag(`setup: ${step} ${state}${text ? ": " + text : ""}`);
	if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send("settings:setup-progress", { step, state, text });
}
async function runSetup(force = {}) {
	setupLog.length = 0;
	for (const k of Object.keys(setupSteps)) delete setupSteps[k];
	lastSetup = { running: true };
	pushSettings();
	const r = await setup.setupAll({ log: setupLogLine, progress: setupProgress, isConnected: () => !!bridge, force, premium: config.spotifyPremium });
	lastSetup = { ok: r.ok, step: r.step, why: r.why };
	if (!r.ok && r.tail?.length) setupLogLine("(last lines above are what went wrong)");
	return r;
}
function setupDetails() {
	return [`Mercify ${app.getVersion()} setup details, ${new Date().toISOString()}`, `Result: ${lastSetup ? (lastSetup.ok ? "OK" : `failed at ${lastSetup.step}: ${lastSetup.why}`) : "not run"}`, "", ...setupLog, "", diagnosticsText()].join("\n");
}

ipcMain.handle("settings:action", async (_e, name) => {
	if (name === "setupAll") await runSetup();
	else if (name === "spotx") await runSetup({ spotx: true });
	else if (name === "spicetify") await runSetup({ spicetify: true });
	else if (name === "copySetupDetails") clipboard.writeText(setupDetails());
	else if (name === "openSpotify") await showSpotify();
	else if (name === "removeAddons") {
		setupLog.length = 0;
		const r = await setup.removeAddons(setupLogLine);
		lastSetup = r.ok ? null : { ok: false, step: "spotify", why: r.why };
	}
	else if (name === "apply") await setup.applyExtension(settingsLog);
	else if (name === "startSpotify") await setup.startSpotify();
	else if (name === "checkUpdate") updater.check();
	else if (name === "leaveLobby") await leaveLobby();
	else if (name === "installUpdate") updater.installNow();
	else if (name === "ytUpdate") {
		try {
			await youtube.ready();
			await youtube.update();
			youtubeVersion = await youtube.getVersion();
		} catch (err) {
			diag(`youtube: ${err.message}`);
		}
	}
	return settingsState();
});

ipcMain.handle("settings:set", async (_e, key, value) => {
	if (key === "onlyShowOver.enabled") config.onlyShowOver.enabled = !!value;
	else if (key === "onlyShowOver.stayOnOtherMonitor") config.onlyShowOver.stayOnOtherMonitor = !!value;
	else if (key === "hotkeysOnlyOverApps") config.hotkeysOnlyOverApps = !!value;
	else if (key === "launchSpotify") config.launchSpotify = !!value;
	else if (key === "minimiseSpotify") config.minimiseSpotify = !!value;
	else if (key === "lobbyName") setLobbyName(value);
	else if (key === "spotifyPremium") config.spotifyPremium = !!value;
	else if (key === "startWithWindows") setStartWithWindows(value);
	else if (key === "theme" && THEME_BG[value]) {
		config.theme = value;
		if (settingsWin && !settingsWin.isDestroyed()) settingsWin.setBackgroundColor(THEME_BG[value]);
		sendToRenderer("theme", value); // the overlay's panels follow straight away
	}
	else if (key === "discordYouTube") {
		config.discordYouTube = !!value;
		discord.setEnabled(config.discordYouTube);
		if (yt.active) emitYouTube(); // show it straight away when turned on
	}
	else if (key === "friendsShareListening" || key === "friendsAllowJoin") {
		config[key] = !!value;
		friends.setOptions({ share: config.friendsShareListening, allowJoin: config.friendsAllowJoin });
	}
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
			...friendTrayItems(),
			...lobbyTrayItems(),
			{ label: "Reset layout", click: () => sendToRenderer("reset-layout") },
			{ label: "Copy diagnostics", click: () => clipboard.writeText(diagnosticsText()) },
			{ type: "separator" },
			{ label: "Quit", click: () => app.quit() },
		])
	);
}

function lobbyTrayItems() {
	const st = lobby.state();
	if (st.status === "connecting") {
		return [
			{ type: "separator" },
			{ label: `Joining lobby ${st.displayCode}…`, enabled: false },
			{ label: "Cancel", click: () => lobby.leave() },
			{ type: "separator" },
		];
	}
	if (st.status !== "joined") {
		return [{ type: "separator" }, { label: "Start a listening lobby", click: startLobbyFromTray }, { type: "separator" }];
	}
	const who = st.role === "host" ? "hosting" : `with ${st.hostName || "the host"}`;
	return [
		{ type: "separator" },
		{ label: `Lobby ${st.displayCode} (${who}, ${st.members.length} here)`, enabled: false },
		{ label: "Copy lobby code", click: () => copyLobbyCode() },
		{ label: "Leave lobby", click: () => leaveLobby() },
		{ type: "separator" },
	];
}

// Friend requests waiting for an answer, so they can be answered without the overlay.
function friendTrayItems() {
	const reqs = friends.state().requests;
	if (!reqs.length) return [];
	return [
		{ type: "separator" },
		...reqs.map((r) =>
			r.kind === "join"
				? {
						label: `${r.name} wants to listen with you`,
						submenu: [
							{ label: "Accept (starts a lobby)", click: () => answerJoinRequest(r.fid, true) },
							{ label: "Decline", click: () => answerJoinRequest(r.fid, false) },
						],
					}
				: {
						label: `${r.name} sent you a friend request`,
						submenu: [
							{ label: "Accept", click: () => friends.acceptAdd(r.fid) },
							{ label: "Decline", click: () => friends.declineAdd(r.fid) },
						],
					}
		),
	];
}

// Tray's "Start a listening lobby": needs a name, which lives in Settings.
async function startLobbyFromTray() {
	if (!String(config.lobbyName || "").trim()) {
		openSettings("lobby");
		notify("Set your lobby name first", "Enter the name friends will see on Settings' Lobby page, then press Start a lobby.");
		return;
	}
	try {
		if (!(await startLobby())) return;
	} catch (err) {
		notify("Couldn't start a lobby", err.message);
		return;
	}
	notify(`Lobby ${lobby.state().displayCode} started`, "The code is copied. Share it so friends can join.");
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

// ------------------------------------------------------------------ launch splash / update gate
//
// Like Discord or Steam: an installed copy checks GitHub before anything else starts. If
// there's a newer version, the splash (the GitHub logo, assets/splash.png) shows it
// downloading, installs it and starts the new version, so Mercify never opens on the old
// one. No update, offline, or GitHub too slow: the splash closes and Mercify starts as usual,
// and the regular background check carries on. Opened by you, the splash shows while it
// checks; started with Windows, it only appears when there's something to install.
// Portable copies and running from source skip all of this.

const SPLASH_MIN_MS = 900; // a quick "no update" doesn't just flash the splash
let splashWin = null;
let splashStatus = { text: "Starting…" };
let launchGateActive = false;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function showSplash() {
	if (splashWin && !splashWin.isDestroyed()) return splashWin;
	splashWin = new BrowserWindow({
		width: 400,
		height: 400,
		useContentSize: true,
		center: true,
		frame: false,
		resizable: false,
		maximizable: false,
		fullscreenable: false,
		title: "Mercify",
		backgroundColor: "#0a0b0a",
		icon: path.join(__dirname, "assets", "icon.png"),
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload-splash.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	splashWin.setMenu(null);
	splashWin.loadFile(path.join(__dirname, "splash", "splash.html"));
	// a status set before the page finished loading
	splashWin.webContents.on("did-finish-load", () => splashWin?.webContents.send("splash:status", splashStatus));
	splashWin.once("ready-to-show", () => splashWin?.show());
	splashWin.on("closed", () => (splashWin = null));
	return splashWin;
}

// percent: a number while downloading; leave it out and the bar sweeps
function setSplash(text, percent) {
	if (text !== splashStatus.text) console.log("[splash]", text);
	splashStatus = { text, percent };
	if (splashWin && !splashWin.isDestroyed()) splashWin.webContents.send("splash:status", splashStatus);
}

function closeSplash() {
	if (splashWin && !splashWin.isDestroyed()) splashWin.destroy();
	splashWin = null;
}

// Testing off Windows: OVERLAY_DEBUG_SPLASH=checking|downloading|installing shows that state
// and writes a screenshot to OVERLAY_DEBUG_SPLASH_CAPTURE, then quits.
function splashScreenshot(kind) {
	const states = {
		checking: ["Checking for updates…"],
		downloading: ["Downloading Mercify 1.13.0… 42%", 42],
		installing: ["Installing Mercify 1.13.0…"],
	};
	setSplash(...(states[kind] || ["Starting…"]));
	showSplash().webContents.once("did-finish-load", () =>
		setTimeout(async () => {
			const img = await splashWin.webContents.capturePage();
			if (process.env.OVERLAY_DEBUG_SPLASH_CAPTURE) fs.writeFileSync(process.env.OVERLAY_DEBUG_SPLASH_CAPTURE, img.toPNG());
			app.exit(0);
		}, 1200)
	);
}

// Resolves true when an update is being installed (Mercify is quitting and the new version
// will start), false to start Mercify as usual.
async function launchUpdateGate() {
	if (process.env.OVERLAY_DEBUG_SPLASH) {
		splashScreenshot(process.env.OVERLAY_DEBUG_SPLASH);
		return true;
	}
	if (updater.state().mode !== "installer") return false;
	launchGateActive = true;
	try {
		const quiet = AUTOSTART;
		const shownAt = Date.now();
		if (!quiet) {
			setSplash("Checking for updates…");
			showSplash();
		}
		const version = await updater.checkAtLaunch();
		if (!version) {
			if (!quiet) await wait(Math.max(0, SPLASH_MIN_MS - (Date.now() - shownAt)));
			closeSplash();
			return false;
		}
		diag(`launch: Mercify ${version} is out, updating before opening`);
		setSplash(`Downloading Mercify ${version}…`, 0);
		showSplash();
		const ok = await updater.waitForDownload((pct) => setSplash(`Downloading Mercify ${version}… ${pct}%`, pct));
		if (!ok) {
			// Download failed or stalled: open this version. The background check tries again,
			// and a download that finishes later installs when Mercify closes.
			diag("launch: update download failed or stalled; opening the current version");
			closeSplash();
			return false;
		}
		setSplash(`Installing Mercify ${version}…`);
		await wait(600); // long enough to read
		updater.installNow();
		return true;
	} finally {
		launchGateActive = false;
	}
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
updater.on("ready", (v) => {
	if (launchGateActive) return; // the splash is installing it right now
	notify(`Mercify ${v} is ready`, "It installs the next time Mercify closes. To update now, open Settings and choose Restart and update.");
});
updater.on("available", (v) => notify(`Mercify ${v} is available`, "Click to open Settings and download it."));
updater.on("before-install", () => foreground.stop());

app.whenReady().then(async () => {
	if (await launchUpdateGate()) return; // updating: the new version starts by itself
	updater.start();
	foreground.start();
	lobby.setAvatar(avatar);
	friends.setAvatar(avatar);
	friends.start();
	youtube.cleanup(); // the cache of played videos
	startBridgeServer();
	createWindow();
	createTray();
	registerHotkeys();
	tickGate();
	setInterval(tickGate, 200);
	setInterval(pollCursor, CURSOR_POLL_MS);
	setInterval(syncZone, 200); // follows the gate, the window and the helper coming and going
	if (process.env.OVERLAY_DEBUG_STATE_FILE) {
		setInterval(() => {
			const st = { gateOpen, visible: win.isVisible(), toggleHotkey: globalShortcut.isRegistered(config.hotkeys.toggle), editHotkey: globalShortcut.isRegistered(config.hotkeys.edit), edit: editMode, update: updater.state(), giveBacks, gateWhy, gameInFront, diagTail: diagLog.slice(-5), diagnostics: diagnosticsText(), bounds: win.getBounds(), display: pickDisplay().bounds };
			fs.writeFileSync(process.env.OVERLAY_DEBUG_STATE_FILE, JSON.stringify(st));
		}, 100);
	}

	if (setup.IS_WIN) {
		migrateLoginItem();
		const s = await setup.status({ premium: config.spotifyPremium });
		if (config.launchSpotify && s.spotify) setup.startSpotify({ minimized: config.minimiseSpotify });
		// Set up, but Spotify hasn't connected: it's probably at its login screen, started minimised
		// where nobody sees it. Bring it up once, so you can log in.
		if (s.spotify && !setup.needsAttention(s))
			setTimeout(async () => {
				if (bridge || !(await setup.isSpotifyRunning())) return;
				diag("Spotify is running but hasn't connected after 25 s (login screen?); showing its window");
				showSpotify();
			}, 25000);
		// Opened by you: bring Mercify into view. Started with Windows: stay in the tray unless setup needs you.
		if (!AUTOSTART || firstRun || setup.needsAttention(s)) openSettings();
	}
	if (process.env.OVERLAY_DEBUG_SETTINGS_CAPTURE) openSettings();
});

// Opened again while the splash is up: bring the splash forward, not a Settings window.
app.on("second-instance", () => (splashWin ? splashWin.focus() : openSettings()));
app.on("before-quit", () => {
	lobby.leaveNow(); // say goodbye so the lobby doesn't wait for a timeout
	friends.stop(); // and tell friends we've gone offline
});
app.on("will-quit", () => {
	globalShortcut.unregisterAll();
	foreground.stop();
});
// The overlay lives in the tray; closing Settings must not quit it.
app.on("window-all-closed", (e) => e.preventDefault?.());
