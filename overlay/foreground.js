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
		setInterval(() => {
			try {
				const j = JSON.parse(fs.readFileSync(process.env.OVERLAY_DEBUG_FG_FILE, "utf8"));
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
				latest = { pid: j.pid, exe: j.exe || null, title: j.title || "", at: Date.now() };
				restarts = 0;
			} catch (_) {}
		}
	});
	const onGone = () => {
		child = null;
		latest = null;
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

// Ask the helper to keep reporting on this window (0 to stop).
function setAnchor(hwnd) {
	hwnd = Number(hwnd) || 0;
	if (hwnd === anchorHwnd) return;
	anchorHwnd = hwnd;
	if (latest) latest.anchor = null; // until the helper reports on the new one
	sendAnchor();
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

module.exports = { start, stop, getForeground, supported, setAnchor };

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
