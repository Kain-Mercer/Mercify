// Setup + repair logic (Windows): checks for Spotify, Spicetify and the bridge extension,
// and runs the installers. Used by the Settings window, replacing setup-and-run.bat.

const { app, net } = require("electron");
const os = require("os");
const { spawn, execFile, spawnSync } = require("child_process");
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
// Which SpotX mode Mercify last ran ("premium" or "free"). Kept in Spotify's folder so a
// reinstalled Spotify (which also loses SpotX) loses it too.
const SPOTX_MODE_FILE = path.join(SPOTIFY_DIR, "mercify-spotx-mode.txt");

// Installed means it can run: Spotify.exe plus its app (Apps\xpui.spa, or the Apps\xpui folder
// Spicetify unpacks it into). Uninstalling Spotify can leave Spotify.exe and SpotX's .bak copies
// behind, and a lone Spotify.exe used to count as "installed" (with nothing in Apps & features).
//
// And it has to be in Windows' Apps & features (the official installer and SpotX both register
// it there). Uninstalling Spotify from there removes that entry but can leave files behind (the
// ones Spicetify unpacked, or ones in use), and Mercify then started those leftovers at login,
// which put Spotify straight back as if it had never been uninstalled. Windows' list decides.
const UNINSTALL_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Spotify";
function spotifyRegistered() {
	if (process.env.OVERLAY_DEBUG_FAKE_REGISTERED) return process.env.OVERLAY_DEBUG_FAKE_REGISTERED === "1";
	if (!IS_WIN) return true;
	try {
		return spawnSync("reg", ["query", UNINSTALL_KEY], { windowsHide: true, timeout: 5000 }).status === 0;
	} catch (_) {
		return true; // can't tell: don't call a working Spotify uninstalled
	}
}

function spotifyInstalled() {
	const files = fs.existsSync(SPOTIFY_EXE) && (fs.existsSync(path.join(SPOTIFY_DIR, "Apps", "xpui.spa")) || fs.existsSync(path.join(SPOTIFY_DIR, "Apps", "xpui")));
	return files && spotifyRegistered();
}

// Program files left behind by an uninstalled Spotify (never prefs or the Users folder, which
// hold its settings and login). SpotX stops with "reinstall Spotify" when it finds these, and
// asks about Spicetify (stopping our setup) when it finds an unpacked Apps\xpui folder.
const LEFTOVER_FILES = ["Spotify.exe", "Spotify.dll", "chrome_elf.dll", "Spotify.bak", "Spotify.dll.bak", "chrome_elf.dll.bak", "Apps"];
function spotifyLeftovers() {
	return spotifyInstalled() ? [] : LEFTOVER_FILES.filter((f) => fs.existsSync(path.join(SPOTIFY_DIR, f)));
}
function removeLeftovers(log) {
	if (!spotifyInstalled()) clearSpotxMode(); // Mercify's own note, not one of Spotify's files
	for (const f of spotifyLeftovers()) {
		try {
			fs.rmSync(path.join(SPOTIFY_DIR, f), { force: true, recursive: true, maxRetries: 5, retryDelay: 400 });
			log(`Removed ${f}, left behind by an earlier Spotify`);
		} catch (e) {
			log(`Couldn't remove ${f}: ${e.message}`);
		}
	}
}

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
	if (process.env.OVERLAY_DEBUG_FAKE_SPOTIFY_RUNNING) return Promise.resolve(process.env.OVERLAY_DEBUG_FAKE_SPOTIFY_RUNNING === "1");
	if (!IS_WIN) return Promise.resolve(false);
	return new Promise((resolve) => {
		execFile("tasklist", ["/FI", "IMAGENAME eq Spotify.exe", "/NH"], { windowsHide: true }, (err, out) => {
			resolve(!err && /spotify\.exe/i.test(out || ""));
		});
	});
}

// Run Spotify.exe from its own folder, as its shortcut and SpotX do. "minimized" uses Spotify's
// own --minimized flag (the one its "open at login" option uses): it starts in the tray.
// "premium", "free", or null (SpotX was put on before Mercify recorded its mode: that was
// always the free mode, or someone else's SpotX with unknown options).
function clearSpotxMode() {
	try {
		fs.rmSync(SPOTX_MODE_FILE, { force: true });
	} catch (_) {}
}
function spotxMode() {
	try {
		const m = fs.readFileSync(SPOTX_MODE_FILE, "utf8").trim();
		return m === "premium" || m === "free" ? m : null;
	} catch (_) {
		return null;
	}
}

// Does the SpotX on this Spotify need running again to match the account? Premium accounts need
// the premium mode: the free mode overrides Spotify's account details (product, catalogue…),
// which can break a Premium account. Going back to free only once we know it's free (`false`),
// so an unknown account never triggers a reinstall.
function spotxModeMismatch(premium) {
	const m = spotxMode();
	if (premium === true) return m !== "premium";
	if (premium === false) return m === "premium";
	return false;
}

function launchSpotify(minimized) {
	spawn(SPOTIFY_EXE, minimized ? ["--minimized"] : [], { detached: true, stdio: "ignore", cwd: SPOTIFY_DIR }).unref();
}

// Start Spotify if it isn't running, so its window doesn't pop up over the game when minimized.
async function startSpotify({ minimized = false } = {}) {
	if (!IS_WIN || !spotifyInstalled()) return false;
	if (await isSpotifyRunning()) return true;
	launchSpotify(minimized);
	return true;
}

// Bring Spotify's window up (running Spotify.exe again focuses the existing one).
function openSpotify() {
	if (!IS_WIN || !spotifyInstalled()) return false;
	launchSpotify(false);
	return true;
}

// Start Spotify where nobody sees it: minimised, and its window hidden as soon as it appears
// (setup needs it to have run once, but you shouldn't see it until it's time to log in).
async function startSpotifyHidden() {
	if (!IS_WIN || !spotifyInstalled()) return false;
	launchSpotify(true);
	require("./foreground").hideWindowsOf("Spotify.exe", 20000).catch(() => {});
	return true;
}

// Has someone logged in to Spotify on this PC? Logging in creates the account's folder,
// %APPDATA%\Spotify\Users\<name>-user, straight away. (The autologin lines in the prefs file
// may only be written when Spotify closes, so they missed a login into a running Spotify:
// 1.9.2's restart never fired.)
function spotifyLoggedIn() {
	if (process.env.OVERLAY_DEBUG_FAKE_LOGGED_IN) {
		const f = process.env.OVERLAY_DEBUG_FAKE_LOGGED_IN;
		return f === "1" || (fs.existsSync(f) && fs.readFileSync(f, "utf8").trim() === "1"); // a file lets tests flip it
	}
	try {
		if (fs.readdirSync(path.join(SPOTIFY_DIR, "Users")).some((d) => /-user$/i.test(d))) return true;
	} catch (_) {}
	try {
		return /^autologin\.(canonical_)?username\s*=\s*"?[^"\s]/m.test(fs.readFileSync(SPOTIFY_PREFS, "utf8"));
	} catch (_) {
		return false;
	}
}

// Close Spotify completely and start it again. minimized: in the tray (after a login, so it
// doesn't jump back over Mercify).
async function restartSpotify({ minimized = false } = {}) {
	if (process.env.OVERLAY_DEBUG_FAKE_SPOTIFY_RUNNING) return console.log(`[test] Spotify restarted${minimized ? " (minimised)" : ""}`), true;
	if (!IS_WIN || !spotifyInstalled()) return false;
	await closeSpotify(() => {});
	launchSpotify(minimized);
	return true;
}

// ---------------------------------------------------------------- removing the add-ons
// Run by the uninstaller (Mercify.exe --uninstall-cleanup, after asking) and by Settings.
//   everything: undo Spicetify (`spicetify restore`) and delete it, then put back the Spotify
//               files SpotX backed up (what SpotX's own Uninstall.bat does; its update block is a
//               patch in those files). Spotify itself stays installed.
//   extension only: take Mercify's extension out of Spicetify and leave the rest alone (for
//               people who used Spicetify or SpotX before Mercify).
// Close every Spotify process and wait until they've really gone (they hold its files open;
// a fixed short wait wasn't always enough, so removal sometimes needed a second click).
async function closeSpotify(log) {
	log("Closing Spotify…");
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => execFile("taskkill", ["/IM", "Spotify.exe", "/F", "/T"], { windowsHide: true }, () => r()));
		for (let j = 0; j < 20 && (await isSpotifyRunning()); j++) await sleep(250);
		if (!(await isSpotifyRunning())) break;
	}
	await sleep(800); // file handles close a moment after the process
}

// Rename with a few retries: a file can stay locked briefly after Spotify exits.
async function renameRetrying(from, to) {
	for (let i = 0; ; i++) {
		try {
			fs.rmSync(to, { force: true });
			fs.renameSync(from, to);
			return;
		} catch (e) {
			if (i >= 6) throw e;
			await sleep(500);
		}
	}
}

async function removeAddons(log, opts = {}) {
	if (!IS_WIN && !process.env.OVERLAY_DEBUG_FAKE_REGISTERED) return { ok: false, why: "Only on Windows." };
	const r = await removeAddonsOnce(log, opts);
	if (opts.extensionOnly) return r;
	// Anything still there (a file Windows wouldn't let go of)? One more pass, then say so.
	if (findSpicetify() || detectSpotX()) {
		log("Something was still in use; going over it once more…");
		await removeAddonsOnce(log, opts);
	}
	const left = [findSpicetify() && "Spicetify", detectSpotX() && "SpotX"].filter(Boolean);
	if (left.length) {
		log(`Couldn't fully remove ${left.join(" and ")}. Restart your PC, then try again.`);
		return { ok: false, why: `Couldn't fully remove ${left.join(" and ")}. Restart your PC, then try again.` };
	}
	return { ok: true };
}

async function removeAddonsOnce(log, { extensionOnly = false } = {}) {
	await closeSpotify(log);
	const exe = findSpicetify();

	if (extensionOnly) {
		if (exe) {
			await spice(exe, ["config", "extensions", "overlay-bridge.js-"], log);
			await spice(exe, ["apply"], log);
			const lines = (await spiceOutput(exe, ["path", "userdata"])).split("\n").map((l) => l.trim()).filter(Boolean);
			const ud = lines[lines.length - 1];
			for (const dir of [ud, path.join(APPDATA, "spicetify")]) {
				try {
					if (dir) fs.unlinkSync(path.join(dir, "Extensions", "overlay-bridge.js"));
				} catch (_) {}
			}
		}
		log("Removed Mercify's extension from Spotify.");
		return { ok: true };
	}

	// 1. Spicetify: put Spotify's own files back, then delete Spicetify
	if (exe && spotifyInstalled()) {
		log("Undoing Spicetify's changes to Spotify…");
		await spice(exe, ["restore"], log);
	}
	for (const dir of [path.join(LOCALAPPDATA, "spicetify"), path.join(APPDATA, "spicetify"), path.join(os.homedir(), "spicetify-cli")]) {
		try {
			if (fs.existsSync(dir)) {
				fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
				log(`Deleted ${dir}`);
			}
		} catch (e) {
			log(`Couldn't delete ${dir}: ${e.message}`);
		}
	}
	// its official installer adds itself to the user PATH
	await runPowerShell(
		"$p = [Environment]::GetEnvironmentVariable('PATH','User'); if ($p) { $n = ($p -split ';' | Where-Object { $_ -and $_ -notmatch '\\\\spicetify' }) -join ';'; if ($n -ne $p) { [Environment]::SetEnvironmentVariable('PATH',$n,'User'); 'Removed Spicetify from PATH' } }",
		log,
		{ idleMs: 60000 }
	);

	// 2. SpotX: its backups of the original files (its Uninstall.bat does the same). Only onto a
	//    Spotify that's still installed: if Spotify itself was uninstalled, putting them back would
	//    recreate a lone Spotify.exe that looks like an install. Then they're just deleted.
	if (!spotifyInstalled()) {
		removeLeftovers(log);
		log("Spotify isn't installed, so there was nothing of SpotX to undo.");
		return { ok: true };
	}
	const backups = [["chrome_elf.dll.bak", "chrome_elf.dll"], ["Spotify.dll.bak", "Spotify.dll"], ["Spotify.bak", "Spotify.exe"], [path.join("Apps", "xpui.bak"), path.join("Apps", "xpui.spa")]];
	let restored = 0;
	for (const [bak, orig] of backups) {
		const b = path.join(SPOTIFY_DIR, bak);
		if (!fs.existsSync(b)) continue;
		try {
			await renameRetrying(b, path.join(SPOTIFY_DIR, orig));
			restored++;
			log(`Put back the original ${orig}`);
		} catch (e) {
			log(`Couldn't put back ${orig}: ${e.message}`);
		}
	}
	// Spotify loads Apps\xpui.spa; an unpacked Apps\xpui folder left behind would shadow it
	if (fs.existsSync(path.join(SPOTIFY_DIR, "Apps", "xpui.spa")) && fs.existsSync(path.join(SPOTIFY_DIR, "Apps", "xpui"))) {
		try {
			fs.rmSync(path.join(SPOTIFY_DIR, "Apps", "xpui"), { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
		} catch (_) {}
	}
	// older SpotX versions locked Spotify's update folder instead
	await runPowerShell(
		"$d = Join-Path $env:LOCALAPPDATA 'Spotify\\Update'; if (Test-Path $d -PathType Container) { $a = Get-Acl $d; $deny = @($a.Access | Where-Object { $_.AccessControlType -eq 'Deny' }); if ($deny.Count) { $deny | ForEach-Object { [void]$a.RemoveAccessRule($_) }; Set-Acl $d $a; 'Unlocked Spotify updates' } }",
		log,
		{ idleMs: 60000 }
	);
	clearSpotxMode();
	log(restored ? "SpotX removed: Spotify is back to normal." : "No SpotX backups found (SpotX wasn't installed, or Spotify was reinstalled since).");
	return { ok: true };
}

async function status({ premium = null } = {}) {
	if (process.env.OVERLAY_DEBUG_FAKE_SETUP) return JSON.parse(process.env.OVERLAY_DEBUG_FAKE_SETUP); // UI testing off Windows
	if (!IS_WIN) return { supported: false };
	const bundled = readOrNull(bundledExtensionPath());
	const applied = readOrNull(APPLIED_EXT);
	const spicetify = findSpicetify();
	return {
		supported: true,
		spotify: spotifyInstalled(),
		spotifyLeftovers: spotifyLeftovers().length > 0,
		storeSpotify: !spotifyInstalled() && fs.existsSync(STORE_SPOTIFY),
		spotifyPrefs: fs.existsSync(SPOTIFY_PREFS),
		spotifyRunning: await isSpotifyRunning(),
		spicetify: !!spicetify,
		spotx: spotifyInstalled() && detectSpotX(), // traces in an uninstalled Spotify's leftovers don't count
		spotxMode: spotxMode(),
		spotxWrongMode: spotifyInstalled() && detectSpotX() && spotxModeMismatch(premium),
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
				// PowerShell serialises Write-Host output as XML ("#< CLIXML", <Objs>…) when it's
				// redirected: the same text again, unreadable. Drop it.
				if (/^#< CLIXML|<Objs |<Obj S=|<\/Objs>|^\s*#[#=O\- ]*$/.test(l)) continue;
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
// Premium accounts add -premium: no ad blocking and none of the free-account patches.
const SPOTX_FLAGS = ["-confirm_uninstall_ms_spoti", "-confirm_spoti_recomended_over", "-block_update_on", "-podcasts_on", "-defender_exclusions_off", "-no_pause", "-new_theme"];

async function runSpotX(log, { premium = false } = {}) {
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
	log(`Running SpotX${premium ? " (Premium mode)" : ""}. This downloads and installs Spotify if needed, and can take a few minutes…`);
	const flags = premium ? [...SPOTX_FLAGS, "-premium"] : SPOTX_FLAGS;
	const r = await runPowerShell(`& ${psq(file)} ${flags.join(" ")}`, log);
	try {
		fs.unlinkSync(file);
	} catch (_) {}
	if (!spotifyInstalled()) {
		const e = errorLine(r.tail);
		return { ok: false, why: r.problem ? `SpotX: ${r.problem}` : e ? `SpotX couldn't install Spotify: ${e}` : "SpotX finished, but Spotify still isn't installed.", tail: r.tail };
	}
	if (r.problem) return { ok: false, why: `SpotX: ${r.problem}`, tail: r.tail };
	try {
		fs.writeFileSync(SPOTX_MODE_FILE, premium ? "premium" : "free");
	} catch (_) {}
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
async function setupAll({ log, progress, isConnected, force = {}, premium = null }) {
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
				if (st === "spotify") {
					log("Downloading and installing Spotify");
					for (const p of [12.5, 31.0, 58.4, 77.9]) {
						await sleep(Number(process.env.OVERLAY_DEBUG_FAKE_STEP_MS || 1200) / 4);
						log(`#####      ${p}%`);
					}
				}
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
		//    (in Premium mode for Premium accounts, and again if it was put on in the other mode)
		const wrongMode = spotifyInstalled() && detectSpotX() && spotxModeMismatch(premium);
		const needSpotX = force.spotx || !spotifyInstalled() || !detectSpotX() || wrongMode;
		if (needSpotX) {
			if (wrongMode) log(premium ? "SpotX was set up for a free account; setting it up again for Premium…" : "SpotX was set up for Premium, but this account is free; setting it up again…");
			progress("spotify", "running", !spotifyInstalled() ? "Installing Spotify (with SpotX)… a few minutes" : wrongMode ? (premium ? "Switching SpotX to Premium mode…" : "Switching SpotX to free mode…") : "Adding SpotX to Spotify…");
			removeLeftovers(log);
			const r = await runSpotX(log, { premium: premium === true });
			if (!r.ok) return fail("spotify", r.why, r.tail);
		}
		progress("spotify", "done", "Installed");

		// 2. Spotify has to have run once before Spicetify can find its settings
		if (!fs.existsSync(SPOTIFY_PREFS)) {
			progress("firstrun", "running", "Starting Spotify once, in the background…");
			await startSpotifyHidden();
			for (let i = 0; i < 120 && !fs.existsSync(SPOTIFY_PREFS); i++) await sleep(1000);
			if (!fs.existsSync(SPOTIFY_PREFS)) return fail("firstrun", "Spotify didn't start. Try opening it from the Start menu, then press Try again.");
			await sleep(3000); // let it finish writing its settings
			await closeSpotify(log); // out of sight again until it's time to log in
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
		await closeSpotify(log); // so nothing pops up while Spicetify works on it
		const applied = await applyExtension((l) => (extLines.push(l), log(l)), { reopen: false });
		if (!applied) {
			const e = errorLine(extLines);
			return fail("extension", `Spicetify couldn't add Mercify to Spotify${e ? ": " + e : "."} Close Spotify completely, then press Try again.`, extLines.slice(-20));
		}
		progress("extension", "done", "Installed");

		// 5. Spotify only loads the extension once you're logged in. Bring its window to the front
		//    (even if it's already running minimised, where a login screen would stay hidden);
		//    the "Connected to Spotify" row turns green by itself once it connects.
		//    The first time you see Spotify in the whole setup is now, for the login. Already logged
		//    in (setting up again)? Then it starts out of sight and just connects.
		if (!isConnected()) {
			if (spotifyLoggedIn()) {
				await startSpotifyHidden();
				progress("connect", "waiting", "Starting Spotify in the background…");
			} else {
				openSpotify();
				progress("connect", "waiting", "Log in to Spotify in the window that just opened. Mercify comes back by itself once you have.");
			}
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

// Copy the bridge extension into Spicetify and apply it to Spotify. Spicetify restarts Spotify
// afterwards, unless reopen is false (setup: Spotify stays closed until it's time to log in).
async function applyExtension(log, { reopen = true } = {}) {
	const nr = reopen ? [] : ["--no-restart"];
	const exe = findSpicetify();
	if (!exe) return log("Spicetify isn't installed yet."), false;
	if (!spotifyInstalled()) return log("Spotify isn't installed yet."), false;
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

	let code = await spice(exe, [...nr, "apply"], log);
	if (code !== 0) {
		log("No usable backup yet: creating one and applying…");
		code = await spice(exe, [...nr, "backup", "apply"], log);
	}
	if (code !== 0) {
		log("Backup is out of date: restoring and applying again…");
		code = await spice(exe, [...nr, "restore", "backup", "apply"], log);
	}
	const ok = code === 0 && (readOrNull(APPLIED_EXT)?.equals(readOrNull(bundledExtensionPath())) ?? false);
	log(ok ? (reopen ? "Done. Spotify restarted with the overlay extension." : "Done. Mercify's extension is in Spotify.") : "Spicetify couldn't apply. If Spotify was just updated or reinstalled, try running SpotX again, then this.");
	return ok;
}

module.exports = { spotifyRegistered, spotifyInstalled, removeAddons, spotifyLoggedIn, restartSpotify, _runPowerShell: runPowerShell, status, needsAttention, setupAll, isSetupRunning: () => setupRunning, runSpotX, installSpicetify, applyExtension, startSpotify, openSpotify, isSpotifyRunning, IS_WIN, _detectSpotX: detectSpotX };
