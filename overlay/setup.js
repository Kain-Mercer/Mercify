// Setup + repair logic (Windows): checks for Spotify, Spicetify and the bridge extension,
// and runs the installers. Used by the Settings window, replacing setup-and-run.bat.

const { app } = require("electron");
const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const IS_WIN = process.platform === "win32";
const APPDATA = process.env.APPDATA || "";
const LOCALAPPDATA = process.env.LOCALAPPDATA || "";

const SPOTIFY_DIR = path.join(APPDATA, "Spotify");
const SPOTIFY_EXE = path.join(SPOTIFY_DIR, "Spotify.exe");
const SPOTIFY_PREFS = path.join(SPOTIFY_DIR, "prefs");
const APPLIED_EXT = path.join(SPOTIFY_DIR, "Apps", "xpui", "extensions", "overlay-bridge.js");
const STORE_SPOTIFY = path.join(LOCALAPPDATA, "Microsoft", "WindowsApps", "Spotify.exe");

const SPOTX_URL = "https://raw.githubusercontent.com/SpotX-Official/SpotX/refs/heads/main/run.ps1";
const SPICETIFY_URL = "https://raw.githubusercontent.com/spicetify/cli/main/install.ps1";

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");

function bundledExtensionPath() {
	return app.isPackaged ? path.join(process.resourcesPath, "overlay-bridge.js") : path.join(__dirname, "..", "spicetify", "overlay-bridge.js");
}

function readOrNull(p) {
	try {
		return fs.readFileSync(p);
	} catch (_) {
		return null;
	}
}

function extVersion(buf) {
	const m = buf && /const VERSION = "([^"]+)"/.exec(buf.toString("utf8"));
	return m ? m[1] : null;
}

function findSpicetify() {
	const local = path.join(LOCALAPPDATA, "spicetify", "spicetify.exe");
	if (fs.existsSync(local)) return local;
	for (const dir of (process.env.PATH || "").split(path.delimiter)) {
		const p = path.join(dir, "spicetify.exe");
		if (dir && fs.existsSync(p)) return p;
	}
	return null;
}

function isSpotifyRunning() {
	if (!IS_WIN) return Promise.resolve(false);
	return new Promise((resolve) => {
		execFile("tasklist", ["/FI", "IMAGENAME eq Spotify.exe", "/NH"], { windowsHide: true }, (err, out) => {
			resolve(!err && /spotify\.exe/i.test(out || ""));
		});
	});
}

async function startSpotify() {
	if (!IS_WIN || !fs.existsSync(SPOTIFY_EXE)) return false;
	if (await isSpotifyRunning()) return true;
	spawn(SPOTIFY_EXE, [], { detached: true, stdio: "ignore" }).unref();
	return true;
}

async function status() {
	if (process.env.OVERLAY_DEBUG_FAKE_SETUP) return JSON.parse(process.env.OVERLAY_DEBUG_FAKE_SETUP); // UI testing off Windows
	if (!IS_WIN) return { supported: false };
	const bundled = readOrNull(bundledExtensionPath());
	const applied = readOrNull(APPLIED_EXT);
	const spicetify = findSpicetify();
	return {
		supported: true,
		spotify: fs.existsSync(SPOTIFY_EXE),
		storeSpotify: !fs.existsSync(SPOTIFY_EXE) && fs.existsSync(STORE_SPOTIFY),
		spotifyPrefs: fs.existsSync(SPOTIFY_PREFS),
		spotifyRunning: await isSpotifyRunning(),
		spicetify: !!spicetify,
		extension: applied ? (bundled && applied.equals(bundled) ? "current" : "outdated") : "missing",
		appliedVersion: extVersion(applied),
		bundledVersion: extVersion(bundled),
	};
}

function needsAttention(s) {
	return s.supported && (!s.spotify || !s.spicetify || s.extension !== "current");
}

// Run an installer in its own visible PowerShell window: both installers can ask questions.
function runInConsole(title, script, onExit) {
	const full = `$Host.UI.RawUI.WindowTitle = '${title}'; ${script}; Write-Host ''; Read-Host 'Finished. Press Enter to close this window'`;
	const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", full], {
		detached: true,
		windowsHide: false,
		stdio: "ignore",
	});
	child.on("exit", () => onExit && onExit());
	child.on("error", () => onExit && onExit());
}

function runSpotX(onExit) {
	runInConsole(
		"SpotX installer",
		`& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing '${SPOTX_URL}').Content)) -confirm_uninstall_ms_spoti -confirm_spoti_recomended_over -block_update_on -new_theme`,
		onExit
	);
}

function installSpicetify(onExit) {
	runInConsole("Spicetify installer", `Invoke-WebRequest -UseBasicParsing '${SPICETIFY_URL}' | Invoke-Expression`, onExit);
}

// Run spicetify and stream its output to `log`. Resolves with the exit code.
function spice(exe, args, log) {
	return new Promise((resolve) => {
		log(`> spicetify ${args.join(" ")}`);
		const child = spawn(exe, args, { windowsHide: true });
		const out = (d) =>
			stripAnsi(d.toString())
				.split("\n")
				.map((l) => l.trimEnd())
				.filter(Boolean)
				.forEach((l) => log(l));
		child.stdout.on("data", out);
		child.stderr.on("data", out);
		child.on("error", (e) => {
			log(`could not run spicetify: ${e.message}`);
			resolve(-1);
		});
		child.on("close", (code) => resolve(code ?? -1));
	});
}

function spiceOutput(exe, args) {
	return new Promise((resolve) => {
		execFile(exe, args, { windowsHide: true }, (err, stdout) => resolve(err ? "" : stripAnsi(stdout || "")));
	});
}

// Copy the bridge extension into Spicetify and apply it to Spotify (Spotify restarts).
async function applyExtension(log) {
	const exe = findSpicetify();
	if (!exe) return log("Spicetify isn't installed yet."), false;
	if (!fs.existsSync(SPOTIFY_EXE)) return log("Spotify isn't installed yet."), false;
	if (!fs.existsSync(SPOTIFY_PREFS)) {
		log("Spotify hasn't been run yet, so Spicetify can't find its settings.");
		log("Starting Spotify now: log in, close it, then press Install / update again.");
		await startSpotify();
		return false;
	}

	const lines = (await spiceOutput(exe, ["path", "userdata"])).split("\n").map((l) => l.trim()).filter(Boolean);
	let userData = lines[lines.length - 1];
	if (!userData || !fs.existsSync(userData)) userData = path.join(APPDATA, "spicetify");
	const extDir = path.join(userData, "Extensions");
	fs.mkdirSync(extDir, { recursive: true });
	fs.copyFileSync(bundledExtensionPath(), path.join(extDir, "overlay-bridge.js"));
	log(`Copied overlay-bridge.js to ${extDir}`);

	await spice(exe, ["config", "extensions", "overlay-bridge.js"], log);

	let code = await spice(exe, ["apply"], log);
	if (code !== 0) {
		log("No usable backup yet: creating one and applying…");
		code = await spice(exe, ["backup", "apply"], log);
	}
	if (code !== 0) {
		log("Backup is out of date: restoring and applying again…");
		code = await spice(exe, ["restore", "backup", "apply"], log);
	}
	const ok = code === 0 && (readOrNull(APPLIED_EXT)?.equals(readOrNull(bundledExtensionPath())) ?? false);
	log(ok ? "Done. Spotify restarted with the overlay extension." : "Spicetify couldn't apply. If Spotify was just updated or reinstalled, try running SpotX again, then this.");
	return ok;
}

module.exports = { status, needsAttention, runSpotX, installSpicetify, applyExtension, startSpotify, isSpotifyRunning, IS_WIN };
