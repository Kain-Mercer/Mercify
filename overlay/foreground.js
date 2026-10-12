// Which app is in front? (Windows only. Elsewhere getForeground() returns null and the
// overlay just stays visible.)
//
// Runs the small native helper bin/fgwatch.exe (source in native/fgwatch.c), which prints a
// JSON line whenever the foreground window changes (and every 2 s):
//   {"pid":1234,"hwnd":5678,"mon":<monitor handle>,"exe":"Wow.exe","title":"...",
//    "anchor":{"hwnd":..,"alive":1,"iconic":0,"visible":1,"mon":..}}
// "anchor" describes a window we asked about by writing "anchor <hwnd>" to the helper's stdin
// (the game the overlay belongs to), so the overlay can stay up while you use another monitor.

const { app } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

let latest = null; // { pid, hwnd, mon, exe, title, anchor, at }
let child = null;
let anchorHwnd = 0;
let started = false;
let restarts = 0;

function helperPath() {
	return app.isPackaged ? path.join(process.resourcesPath, "fgwatch.exe") : path.join(__dirname, "bin", "fgwatch.exe");
}

function start() {
	// Testing off Windows: read the "window in front" from a JSON file instead of the helper.
	if (process.env.OVERLAY_DEBUG_FG_FILE) {
		started = true;
		let lastRaw = "";
		setInterval(() => {
			try {
				const raw = fs.readFileSync(process.env.OVERLAY_DEBUG_FG_FILE, "utf8");
				if (raw !== lastRaw) (lastRaw = raw), (debugActivated = 0); // a new scene overrides an activate
				const j = JSON.parse(raw);
				// like the real helper: an activated window is in front until something else is
				if (debugActivated && j.windows?.[debugActivated]) Object.assign(j, { pid: 1, hwnd: debugActivated, exe: "activated.exe", title: "", cls: "", ...(j.windows[debugActivated].fg || {}) });
				// windows by handle, for the anchor: {"windows":{"111":{"alive":1,"iconic":0,"visible":1,"mon":2}}}
				const w = anchorHwnd && j.windows ? j.windows[String(anchorHwnd)] : null;
				latest = toInfo({ ...j, pid: j.pid === "self" ? process.pid : j.pid, anchor: anchorHwnd ? { hwnd: anchorHwnd, alive: 0, ...(w || {}) } : undefined });
			} catch (_) {}
		}, 100);
		return;
	}
	if (process.platform !== "win32") return;
	const exe = helperPath();
	if (!fs.existsSync(exe)) {
		console.error("[overlay] foreground helper missing:", exe);
		return;
	}
	started = true;
	// The helper exits by itself when this process ends (it watches our pid).
	child = spawn(exe, [String(process.pid)], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
	child.stdin.on("error", () => {}); // helper gone; the exit handler restarts it
	if (anchorHwnd) sendAnchor();
	zoneSent = ""; // a new helper has no zone yet
	let buf = "";
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (d) => {
		buf += d;
		let i;
		while ((i = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, i).trim();
			buf = buf.slice(i + 1);
			if (!line) continue;
			try {
				const j = JSON.parse(line);
				if (j.zone !== undefined) {
					zoneListener?.({ type: String(j.zone), x: Number(j.x) || 0, y: Number(j.y) || 0, d: Number(j.d) || 0 });
					continue;
				}
				if (j.activate !== undefined) {
					// the helper's answer to "activate <hwnd>"
					const p = activations.shift();
					if (p) p.resolve({ ok: !!j.ok, via: String(j.via || "") });
					continue;
				}
				latest = toInfo(j);
				restarts = 0;
			} catch (_) {}
		}
	});
	const onGone = () => {
		child = null;
		latest = null;
		for (const p of activations.splice(0)) p.resolve(null);
		if (restarts++ < 5) setTimeout(start, 1000 * restarts); // back off; give up after a few tries
	};
	child.on("exit", onGone);
	child.on("error", (e) => {
		console.error("[overlay] foreground helper failed:", e.message);
	});
}

function toInfo(j) {
	const a = j.anchor && anchorHwnd && Number(j.anchor.hwnd) === anchorHwnd ? j.anchor : null;
	return {
		pid: j.pid,
		hwnd: Number(j.hwnd) || 0,
		mon: j.mon ?? null,
		exe: j.exe || null,
		title: j.title || "",
		cls: j.cls || "",
		// the anchor is usable while it exists, is shown and isn't minimised
		anchor: a ? { hwnd: anchorHwnd, mon: a.mon ?? null, up: !!a.alive && !!a.visible && !a.iconic } : null,
		at: Date.now(),
	};
}

function sendAnchor() {
	try {
		child?.stdin?.write(`anchor ${anchorHwnd}\n`);
	} catch (_) {}
}

// Bring a window back to the front (hand the keyboard back to the game). Resolves with the
// helper's answer, { ok, via }, or null if the helper isn't running or didn't answer.
const activations = []; // waiting for answers, in order
let debugActivated = 0;

function activate(hwnd) {
	hwnd = Number(hwnd) || 0;
	if (!hwnd) return Promise.resolve(null);
	if (process.env.OVERLAY_DEBUG_FG_FILE) {
		// tests: OVERLAY_DEBUG_ACTIVATE=fail makes Windows refuse
		if (process.env.OVERLAY_DEBUG_ACTIVATE === "fail") return Promise.resolve({ ok: false, via: "none" });
		if (process.env.OVERLAY_DEBUG_ACTIVATE === "slow") return new Promise((r) => setTimeout(() => r({ ok: true, via: "debug" }, (debugActivated = hwnd)), 700));
		debugActivated = hwnd;
		return Promise.resolve({ ok: true, via: "debug" });
	}
	if (!child?.stdin?.writable) return Promise.resolve(null);
	return new Promise((resolve) => {
		const entry = { resolve };
		activations.push(entry);
		setTimeout(() => {
			const i = activations.indexOf(entry);
			if (i >= 0) activations.splice(i, 1), resolve(null);
		}, 1500);
		try {
			child.stdin.write(`activate ${hwnd}\n`);
		} catch (_) {
			activations.splice(activations.indexOf(entry), 1);
			resolve(null);
		}
	});
}

// True when activate() can reach a helper (so blur() isn't needed as a fallback).
function canActivate() {
	return !!process.env.OVERLAY_DEBUG_FG_FILE || !!child?.stdin?.writable;
}

// Ask the helper to keep reporting on this window (0 to stop).
function setAnchor(hwnd) {
	hwnd = Number(hwnd) || 0;
	if (hwnd === anchorHwnd) return;
	anchorHwnd = hwnd;
	if (latest) latest.anchor = null; // until the helper reports on the new one
	sendAnchor();
}

// Click zone: while the overlay is hidden, clicks on the Now Playing widget are caught by the
// helper (so the overlay window never takes the keyboard from the game) and reported here as
// { type: "down"|"move"|"up"|"cancel"|"wheel", x, y, d } in physical screen pixels.
let zoneListener = null;
let zoneSent = "";
function onZone(fn) {
	zoneListener = fn;
}
// True when the helper can run a click zone.
function canZone() {
	return !!child?.stdin?.writable;
}
// rect: { x, y, width, height } in physical screen pixels, or null for no zone.
function setClickZone(rect) {
	const line = rect ? `zone ${Math.round(rect.x)} ${Math.round(rect.y)} ${Math.round(rect.width)} ${Math.round(rect.height)}` : "zone off";
	if (line === zoneSent || !child?.stdin?.writable) return;
	if (!zoneSent && !rect) return; // nothing set yet
	zoneSent = line;
	try {
		child.stdin.write(line + "\n");
	} catch (_) {}
}

// { pid, hwnd, mon, exe, title, anchor } for the window in front, or null if unknown.
function getForeground() {
	if (!latest || Date.now() - latest.at > 5000) return null; // helper stalled
	return latest;
}

// True once the helper is running and reporting (Windows only).
function supported() {
	if (process.env.OVERLAY_DEBUG_FG_FILE) return started;
	return process.platform === "win32" && started && (child !== null || latest !== null);
}

function stop() {
	if (child) child.kill();
	child = null;
}

module.exports = { start, stop, getForeground, supported, setAnchor, activate, canActivate, canZone, setClickZone, onZone, _toInfo: toInfo };

// ------------------------------------------------------------------ hide / show another program's window
// Used to send Spotify to the tray: the helper waits for the program's main window, hides it,
// and reports the window handles so they can be shown again later.

function runHelper(args, timeoutMs) {
	return new Promise((resolve) => {
		if (process.platform !== "win32") return resolve("");
		const exe = helperPath();
		if (!fs.existsSync(exe)) return resolve("");
		let out = "";
		const child = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
		const timer = setTimeout(() => child.kill(), timeoutMs + 5000);
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (d) => (out += d));
		child.on("error", () => resolve(""));
		child.on("exit", () => {
			clearTimeout(timer);
			resolve(out);
		});
	});
}

async function hideWindowsOf(exeName, waitMs = 0) {
	const out = await runHelper(["--hide", exeName, String(waitMs)], waitMs);
	try {
		return JSON.parse(out.trim()).hidden || [];
	} catch (_) {
		return [];
	}
}

function showWindows(hwnds) {
	if (!hwnds || !hwnds.length) return Promise.resolve();
	return runHelper(["--show", ...hwnds.map(String)], 2000);
}

module.exports.hideWindowsOf = hideWindowsOf;
module.exports.showWindows = showWindows;
