// Setup + repair logic (Windows): checks for Spotify, Spicetify and the bridge extension,
// and runs the installers. Used by the Settings window, replacing setup-and-run.bat.

const { app, net } = require("electron");
const os = require("os");
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

// SpotX leaves traces we can look for (from its run.ps1): backups of the files it patches
// (Spotify.bak / Spotify.dll.bak, chrome_elf.dll.bak, Apps\xpui.bak) and a "// Patched by SpotX"
// line in xpui.js, which Spicetify keeps when it unpacks xpui.spa into Apps\xpui.
// A Spotify reinstall or update clears them, which is also when SpotX needs running again.
function detectSpotX() {
	const backups = ["Spotify.bak", "Spotify.dll.bak", "chrome_elf.dll.bak", path.join("Apps", "xpui.bak")];
	for (const b of backups) if (fs.existsSync(path.join(SPOTIFY_DIR, b))) return true;
	try {
		const fd = fs.openSync(path.join(SPOTIFY_DIR, "Apps", "xpui", "xpui.js"), "r");
		const buf = Buffer.alloc(256 * 1024);
		const n = fs.readSync(fd, buf, 0, buf.length, 0);
		fs.closeSync(fd);
		return /patched by spotx/i.test(buf.toString("utf8", 0, n));
	} catch (_) {
		return false;
	}
}

function isSpotifyRunning() {
	if (!IS_WIN) return Promise.resolve(false);
	return new Promise((resolve) => {
		execFile("tasklist", ["/FI", "IMAGENAME eq Spotify.exe", "/NH"], { windowsHide: true }, (err, out) => {
			resolve(!err && /spotify\.exe/i.test(out || ""));
		});
	});
}

// Start Spotify if it isn't running. "minimized" uses Spotify's own --minimized flag
// (the one its "open at login" option uses), so its window doesn't pop up over the game.
async function startSpotify({ minimized = false } = {}) {
	if (!IS_WIN || !fs.existsSync(SPOTIFY_EXE)) return false;
	if (await isSpotifyRunning()) return true;
	spawn(SPOTIFY_EXE, minimized ? ["--minimized"] : [], { detached: true, stdio: "ignore" }).unref();
	return true;
}

// Bring Spotify's window up (running Spotify.exe again focuses the existing one).
function openSpotify() {
	if (!IS_WIN || !fs.existsSync(SPOTIFY_EXE)) return false;
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
		spotx: detectSpotX(),
		extension: applied ? (bundled && applied.equals(bundled) ? "current" : "outdated") : "missing",
		appliedVersion: extVersion(applied),
		bundledVersion: extVersion(bundled),
	};
}

function needsAttention(s) {
	return s.supported && (!s.spotify || !s.spicetify || s.extension !== "current");
}

// ---------------------------------------------------------------- running things without windows
//
// Setup used to open each installer in its own PowerShell window. Spawned "detached" from Mercify
// those windows didn't appear on some PCs (no console at all), and the installers then sat on
// questions nobody could see: the buttons "did nothing". Now everything runs hidden, every
// question is answered up front, the output streams into Settings, and a question we didn't
// expect fails straight away with a clear message instead of hanging.

const PS_PRELUDE = [
	"$ProgressPreference = 'SilentlyContinue'", // progress bars make downloads crawl in Windows PowerShell
	"[Console]::OutputEncoding = [Text.Encoding]::UTF8",
	// fresh Windows 10 installs may not offer TLS 1.2, which GitHub requires
	"[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
	"$ErrorActionPreference = 'Continue'",
].join("; ");

// Run a PowerShell script hidden; stream its output to `log`. Resolves { code, tail, problem }.
function runPowerShell(script, log, { idleMs = 6 * 60000, totalMs = 25 * 60000 } = {}) {
	return new Promise((resolve) => {
		const encoded = Buffer.from(`${PS_PRELUDE}; ${script}`, "utf16le").toString("base64");
		let child;
		try {
			child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
				windowsHide: true,
				stdio: ["pipe", "pipe", "pipe"],
				detached: !IS_WIN, // its own process group, so the whole group can be stopped (tests off Windows)
			});
		} catch (e) {
			return resolve({ code: -1, tail: [], problem: `Couldn't start PowerShell: ${e.message}` });
		}
		const tail = [];
		let problem = null;
		let idle;
		// stop it and anything it started (an installer still holding our output pipe)
		const kill = (why) => {
			if (!problem) problem = why;
			try {
				if (IS_WIN) execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
				else process.kill(-child.pid, "SIGKILL");
			} catch (_) {
				try {
					child.kill("SIGKILL");
				} catch (_) {}
			}
		};
		const poke = () => {
			clearTimeout(idle);
			idle = setTimeout(() => kill("It stopped responding for several minutes."), idleMs);
		};
		const total = setTimeout(() => kill("It took far too long."), totalMs);
		poke();
		const out = (d) => {
			poke();
			for (const raw of stripAnsi(d.toString()).split("\n")) {
				const l = raw.trimEnd();
				if (!l) continue;
				log(l);
				tail.push(l);
				if (tail.length > 40) tail.shift();
				// -NonInteractive turns any question into this error instead of an endless wait
				if (/NonInteractive mode|Read and Prompt functionality is not available/i.test(l)) kill("It asked a question Mercify didn't expect.");
			}
		};
		child.stdout.on("data", out);
		child.stderr.on("data", out);
		child.stdin.end();
		child.on("error", (e) => kill(`Couldn't start PowerShell: ${e.message}`));
		// finish when it exits (a moment later, for its last lines), not when every pipe has closed
		let done = false;
		const finish = (code) => {
			if (done) return;
			done = true;
			clearTimeout(idle);
			clearTimeout(total);
			resolve({ code: code ?? -1, tail, problem });
		};
		child.on("exit", (code) => setTimeout(() => finish(code), 300));
		child.on("close", (code) => finish(code));
	});
}

// Download with Electron's own networking (follows redirects, uses the system proxy).
async function download(url, dest) {
	const res = await net.fetch(url, { headers: { "User-Agent": "Mercify" } });
	if (!res.ok) throw new Error(`${url} answered ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	fs.writeFileSync(dest, buf);
	return buf;
}

// The most telling line of a failed run, for the message in Settings.
function errorLine(tail) {
	const l = [...(tail || [])].reverse().find((x) => /error|exception|aborted|failed|denied|not found|cannot|could not|couldn't/i.test(x));
	return l ? l.replace(/^\s*[\w-]+ : /, "").slice(0, 160) : null;
}

const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'"; // PowerShell single-quoted string

// SpotX, with every question answered: install or replace Spotify with the version SpotX
// recommends, remove the Microsoft Store version, block Spotify's updates (they break Spicetify),
// keep podcasts as they are, skip the Defender question, don't pause at the end.
const SPOTX_FLAGS = ["-confirm_uninstall_ms_spoti", "-confirm_spoti_recomended_over", "-block_update_on", "-podcasts_on", "-defender_exclusions_off", "-no_pause", "-new_theme"];

async function runSpotX(log) {
	log("Downloading SpotX…");
	const file = path.join(os.tmpdir(), "mercify-spotx-run.ps1");
	try {
		const buf = await download(SPOTX_URL, file);
		// Windows PowerShell 5.1 reads a .ps1 without a byte order mark as ANSI; SpotX has non-English text
		const text = buf.toString("utf8").replace(/^\uFEFF/, "");
		fs.writeFileSync(file, "\uFEFF" + text, "utf8");
	} catch (e) {
		return { ok: false, why: `Couldn't download SpotX (${e.message}). Check your internet connection.` };
	}
	// SpotX refuses to run on a Spotify that Spicetify has already changed: undo that first
	const spicetify = findSpicetify();
	if (spicetify && fs.existsSync(path.join(SPOTIFY_DIR, "Apps", "xpui")) && !fs.existsSync(path.join(SPOTIFY_DIR, "Apps", "xpui.spa"))) {
		log("Undoing Spicetify's changes first (SpotX needs an unmodified Spotify)…");
		await spice(spicetify, ["restore"], log);
	}
	log("Running SpotX. This downloads and installs Spotify if needed, and can take a few minutes…");
	const r = await runPowerShell(`& ${psq(file)} ${SPOTX_FLAGS.join(" ")}`, log);
	try {
		fs.unlinkSync(file);
	} catch (_) {}
	if (!fs.existsSync(SPOTIFY_EXE)) {
		const e = errorLine(r.tail);
		return { ok: false, why: r.problem ? `SpotX: ${r.problem}` : e ? `SpotX couldn't install Spotify: ${e}` : "SpotX finished, but Spotify still isn't installed.", tail: r.tail };
	}
	if (r.problem) return { ok: false, why: `SpotX: ${r.problem}`, tail: r.tail };
	return { ok: true };
}

// Spicetify: download the official release from GitHub and unpack it, like its own installer
// does, without that installer's questions (Marketplace, "fix your installation?", admin).
async function installSpicetify(log) {
	try {
		log("Finding the latest Spicetify…");
		const res = await net.fetch("https://api.github.com/repos/spicetify/cli/releases/latest", { headers: { "User-Agent": "Mercify", Accept: "application/vnd.github+json" } });
		if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
		const rel = await res.json();
		const arch = process.arch === "arm64" ? "arm64" : process.arch === "ia32" ? "x32" : "x64";
		const asset = (rel.assets || []).find((a) => new RegExp(`windows-${arch}\\.zip$`).test(a.name));
		if (!asset) throw new Error(`no Windows ${arch} download in Spicetify ${rel.tag_name}`);
		const zip = path.join(os.tmpdir(), "mercify-spicetify.zip");
		log(`Downloading Spicetify ${rel.tag_name}…`);
		await download(asset.browser_download_url, zip);
		const dir = path.join(LOCALAPPDATA, "spicetify");
		fs.mkdirSync(dir, { recursive: true });
		log("Unpacking…");
		const r = await runPowerShell(`Expand-Archive -LiteralPath ${psq(zip)} -DestinationPath ${psq(dir)} -Force; if (-not (Test-Path ${psq(path.join(dir, "spicetify.exe"))})) { exit 3 }`, log, { idleMs: 120000 });
		try {
			fs.unlinkSync(zip);
		} catch (_) {}
		if (!findSpicetify()) throw new Error(r.problem || errorLine(r.tail) || "unpacking didn't produce spicetify.exe");
		log("Spicetify installed.");
		return { ok: true };
	} catch (e) {
		return { ok: false, why: `Couldn't install Spicetify (${e.message}). Check your internet connection.` };
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The whole setup, in order, checking each result. `progress(step, state, text)` drives the
// checklist (state: running | done | failed | waiting); `isConnected()` says whether the
// Mercify extension in Spotify has connected. Resolves { ok, step, why, tail }.
let setupRunning = false;
async function setupAll({ log, progress, isConnected, force = {} }) {
	if (setupRunning) return { ok: false, why: "Setup is already running." };
	setupRunning = true;
	const fail = (step, why, tail) => (progress(step, "failed", why), { ok: false, step, why, tail });
	// UI testing off Windows: OVERLAY_DEBUG_FAKE_SETUP_RUN=ok|fail plays a run through the checklist
	if (process.env.OVERLAY_DEBUG_FAKE_SETUP_RUN) {
		try {
			const steps = [["spotify", "Installing Spotify (with SpotX)… a few minutes"], ["spicetify", "Installing Spicetify…"], ["extension", "Adding Mercify to Spotify (Spotify restarts)…"]];
			for (const [st, text] of steps) {
				progress(st, "running", text);
				log(`(pretend) ${text}`);
				await sleep(Number(process.env.OVERLAY_DEBUG_FAKE_STEP_MS || 1200));
				if (process.env.OVERLAY_DEBUG_FAKE_SETUP_RUN === "fail" && st === "spicetify") return fail(st, "Couldn't install Spicetify (GitHub answered 403). Check your internet connection.");
				progress(st, "done", "Installed");
			}
			progress("connect", "waiting", "Spotify is opening. If it asks you to log in, log in; this turns green by itself.");
			return { ok: true };
		} finally {
			setupRunning = false;
		}
	}
	try {
		// 1. Spotify (installed by SpotX), plus SpotX itself
		const needSpotX = force.spotx || !fs.existsSync(SPOTIFY_EXE) || !detectSpotX();
		if (needSpotX) {
			progress("spotify", "running", fs.existsSync(SPOTIFY_EXE) ? "Adding SpotX to Spotify…" : "Installing Spotify (with SpotX)… a few minutes");
			const r = await runSpotX(log);
			if (!r.ok) return fail("spotify", r.why, r.tail);
		}
		progress("spotify", "done", "Installed");

		// 2. Spotify has to have run once before Spicetify can find its settings
		if (!fs.existsSync(SPOTIFY_PREFS)) {
			progress("firstrun", "running", "Opening Spotify for the first time…");
			await startSpotify();
			for (let i = 0; i < 120 && !fs.existsSync(SPOTIFY_PREFS); i++) await sleep(1000);
			if (!fs.existsSync(SPOTIFY_PREFS)) return fail("firstrun", "Spotify didn't open. Try opening it from the Start menu, then press Try again.");
			await sleep(3000); // let it finish writing its settings
		}

		// 3. Spicetify
		if (force.spicetify || !findSpicetify()) {
			progress("spicetify", "running", "Installing Spicetify…");
			const r = await installSpicetify(log);
			if (!r.ok) return fail("spicetify", r.why);
		}
		progress("spicetify", "done", "Installed");

		// 4. The Mercify extension (Spotify restarts)
		progress("extension", "running", "Adding Mercify to Spotify (Spotify restarts)…");
		const extLines = [];
		const applied = await applyExtension((l) => (extLines.push(l), log(l)));
		if (!applied) {
			const e = errorLine(extLines);
			return fail("extension", `Spicetify couldn't add Mercify to Spotify${e ? ": " + e : "."} Close Spotify completely, then press Try again.`, extLines.slice(-20));
		}
		progress("extension", "done", "Installed");

		// 5. Spotify only loads the extension once you're logged in. Bring its window to the front
		//    (even if it's already running minimised, where a login screen would stay hidden);
		//    the "Connected to Spotify" row turns green by itself once it connects.
		if (!isConnected()) {
			openSpotify();
			progress("connect", "waiting", "Spotify is opening. If it asks you to log in, log in; this turns green by itself.");
		}
		return { ok: true };
	} finally {
		setupRunning = false;
	}
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
		log("Starting Spotify now: log in, then press Redo again.");
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

module.exports = { _runPowerShell: runPowerShell, status, needsAttention, setupAll, isSetupRunning: () => setupRunning, runSpotX, installSpicetify, applyExtension, startSpotify, openSpotify, isSpotifyRunning, IS_WIN, _detectSpotX: detectSpotX };
