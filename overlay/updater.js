// Updates from GitHub Releases.
//
// Installed copy: electron-updater checks the latest release, downloads the new installer in the
//   background (only the changed blocks when it can) and installs it when Mercify next quits, or
//   straight away with "Restart and update".
// Portable copy: it can't replace itself, so it only checks the latest version and offers a link.
// Running from source: updates are off.

const { app, net, shell } = require("electron");
const { EventEmitter } = require("events");

const OWNER = "Kain-Mercer";
const REPO = "Mercify";
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const FIRST_CHECK_MS = 15 * 1000; // after startup, so it doesn't compete with Spotify starting
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

const events = new EventEmitter();

const mode = process.env.OVERLAY_DEBUG_UPDATE_FEED
	? "installer"
	: process.env.OVERLAY_DEBUG_UPDATE_MODE || (!app.isPackaged ? "dev" : process.env.PORTABLE_EXECUTABLE_FILE ? "portable" : "installer");

// status: idle | checking | latest | available (portable: download manually) | downloading | ready | error | off
const state = { mode, version: app.getVersion(), status: mode === "dev" ? "off" : "idle", newVersion: null, percent: 0, error: null, url: RELEASES_URL, checkedAt: null };

function set(patch) {
	Object.assign(state, patch);
	events.emit("change", { ...state });
}

// "1.10.0" > "1.9.2"; pre-release suffixes are ignored.
function newer(a, b) {
	const pa = String(a).replace(/^v/, "").split(/[.-]/).map((n) => parseInt(n, 10) || 0);
	const pb = String(b).replace(/^v/, "").split(/[.-]/).map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < 3; i++) {
		if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
	}
	return false;
}

// ------------------------------------------------------------------ installed copy: electron-updater

let autoUpdater = null;

function setupInstaller() {
	const { NsisUpdater, autoUpdater: platformUpdater } = require("electron-updater");
	if (process.env.OVERLAY_DEBUG_UPDATE_FEED) {
		// Testing: a local "release" server instead of GitHub.
		autoUpdater = new NsisUpdater({ provider: "generic", url: process.env.OVERLAY_DEBUG_UPDATE_FEED });
		autoUpdater.forceDevUpdateConfig = true;
	} else {
		autoUpdater = platformUpdater;
	}
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.allowPrerelease = false;
	autoUpdater.disableWebInstaller = true;
	autoUpdater.logger = { info() {}, warn: (m) => console.warn("[update]", m), error: (m) => console.error("[update]", m), debug() {} };

	autoUpdater.on("checking-for-update", () => set({ status: "checking", error: null }));
	autoUpdater.on("update-not-available", () => set({ status: "latest", checkedAt: Date.now() }));
	autoUpdater.on("update-available", (info) => set({ status: "downloading", newVersion: info.version, percent: 0, checkedAt: Date.now() }));
	autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent || 0) }));
	autoUpdater.on("update-downloaded", (info) => {
		set({ status: "ready", newVersion: info.version, percent: 100 });
		events.emit("ready", info.version);
	});
	autoUpdater.on("error", (err) => {
		// Keep a finished download usable even if a later check fails.
		if (state.status === "ready") return;
		set({ status: "error", error: friendlyError(err) });
	});
}

function friendlyError(err) {
	const msg = String(err?.message || err || "");
	if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_/i.test(msg)) return "Couldn't reach GitHub. Check your internet connection.";
	if (/404/.test(msg)) return "No release found on GitHub yet.";
	if (/403|rate limit/i.test(msg)) return "GitHub is busy right now. Mercify will try again later.";
	return msg.split("\n")[0].slice(0, 160) || "Unknown error";
}

// ------------------------------------------------------------------ portable copy: check only

async function checkPortable() {
	set({ status: "checking", error: null });
	try {
		const url = process.env.OVERLAY_DEBUG_RELEASE_API || `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
		const res = await net.fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Mercify" } });
		if (!res.ok) throw new Error(`${res.status}`);
		const rel = await res.json();
		const latest = String(rel.tag_name || "").replace(/^v/, "");
		const portable = (rel.assets || []).find((a) => /portable.*\.exe$/i.test(a.name));
		if (latest && newer(latest, state.version)) {
			set({ status: "available", newVersion: latest, url: portable?.browser_download_url || rel.html_url || RELEASES_URL, checkedAt: Date.now() });
			events.emit("available", latest);
		} else {
			set({ status: "latest", checkedAt: Date.now() });
		}
	} catch (err) {
		set({ status: "error", error: friendlyError(err) });
	}
}

// ------------------------------------------------------------------ public

function check() {
	if (mode === "dev") return;
	if (state.status === "ready" || state.status === "downloading") return; // already have / getting one
	if (mode === "portable") return checkPortable();
	autoUpdater.checkForUpdates().catch(() => {}); // errors arrive via the "error" event
}

function start() {
	if (mode === "dev") return;
	if (mode === "installer") setupInstaller();
	setTimeout(check, Number(process.env.OVERLAY_DEBUG_UPDATE_DELAY || FIRST_CHECK_MS));
	setInterval(check, CHECK_EVERY_MS);
}

// Close Mercify, install the downloaded update silently and start the new version.
function installNow() {
	if (mode === "installer" && state.status === "ready") {
		events.emit("before-install");
		setImmediate(() => autoUpdater.quitAndInstall(true, true));
	} else if (mode === "portable" && state.status === "available") {
		shell.openExternal(state.url);
	}
}

module.exports = { start, check, installNow, state: () => ({ ...state }), on: (ev, fn) => events.on(ev, fn), newer, RELEASES_URL };
