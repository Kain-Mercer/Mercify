// Mercify: YouTube audio through yt-dlp. No Electron dependency: main.js passes the folders, the
// Node to use as yt-dlp's JavaScript runtime and a fetch.
//
// - yt-dlp itself (the official standalone exe) is downloaded from GitHub the first time it's
//   needed, into `dir`, and updated with `yt-dlp -U` at most once a day.
// - Since 2025.11.12 yt-dlp needs a JavaScript runtime for YouTube. Mercify's own executable is
//   one: run with ELECTRON_RUN_AS_NODE=1 it's Node (`--js-runtimes node:<it>`), so nothing else is
//   downloaded. Deno, if installed, still comes first (yt-dlp's own preference).
// - A video's audio is downloaded whole into `cacheDir` before it plays (a few MB), so it plays
//   from a local file: no buffering, and lobbies stay in step. Lobby members download the session
//   playlist's videos ahead. Old files are deleted (older than two days, or past 300 MB).
//
// Items look like Spotify tracks to the rest of Mercify: { uri: "youtube:<id>", name, artists:
// [channel], image, duration (ms), source: "youtube" }.

"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CACHE_MAX_BYTES = 300 * 1024 * 1024;
const CACHE_MAX_AGE_MS = 2 * 24 * 3600 * 1000;
const UPDATE_EVERY_MS = 24 * 3600 * 1000;
const RUN_TIMEOUT_MS = 120000; // a download or lookup with no end
const MAX_DOWNLOADS = 2; // at once
// YouTube sometimes refuses a video to yt-dlp's default clients ("Please sign in", often big
// labels' music videos) but not to others that need no account either; tried once more with these.
const FALLBACK_CLIENTS = "youtube:player_client=tv_simply,web_embedded,mweb,android_vr";
const wantsSignIn = (e) => /sign in|login required|not a bot/i.test(`${e?.stderr || ""} ${e?.message || ""}`) && !/confirm your age/i.test(e?.stderr || "");

// The video id in a YouTube link (watch, youtu.be, shorts, embed, music.youtube.com, live), or null.
function parseId(text) {
	const s = String(text || "").trim();
	if (!/[./]/.test(s) || /\s/.test(s)) return null; // links only: a bare id is too easy to mistake for a word
	let u;
	try {
		u = new URL(/^[a-z]+:\/\//i.test(s) ? s : "https://" + s);
	} catch (_) {
		return null;
	}
	const host = u.hostname.replace(/^(www|m|music)\./, "");
	let id = null;
	if (host === "youtu.be") id = u.pathname.split("/")[1];
	else if (host === "youtube.com" || host === "youtube-nocookie.com") {
		if (u.pathname === "/watch") id = u.searchParams.get("v");
		else {
			const m = /^\/(shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname);
			if (m) id = m[2];
		}
	}
	return id && ID_RE.test(id) ? id : null;
}

const thumbnail = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; // 16:9 without black bars
const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

function item(id, { title, channel, duration } = {}) {
	return {
		uri: `youtube:${id}`,
		name: String(title || "YouTube video").slice(0, 200),
		artists: channel ? [String(channel).slice(0, 100)] : [],
		image: thumbnail(id),
		duration: Math.max(0, Math.round((Number(duration) || 0) * 1000)),
		source: "youtube",
	};
}

// yt-dlp's errors, in plain words.
function friendlyError(stderr) {
	const lines = String(stderr || "").split(/\r?\n/);
	const err = lines.find((l) => /^ERROR:/.test(l)) || lines.filter(Boolean).pop() || "";
	if (/confirm your age|age.restricted|inappropriate for some users/i.test(err)) return "This video is age-restricted, so it can't be played here";
	if (/private video/i.test(err)) return "This video is private";
	if (/not a bot/i.test(err)) return "YouTube wants to check you're not a bot. Try again in a while";
	if (/sign in|login required/i.test(err)) return "YouTube won't play this one without signing in. Try another upload of it";
	if (/members.only|join this channel/i.test(err)) return "This video is for channel members only";
	if (/video unavailable|not available|has been removed|does not exist/i.test(err)) return "This video isn't available";
	if (/premiere|live event will begin|is upcoming/i.test(err)) return "This video hasn't started yet";
	if (/unable to download|HTTP Error|timed out|getaddrinfo|network/i.test(err)) return "Couldn't reach YouTube. Check your internet connection";
	return err.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([A-Za-z0-9_-]{11}:\s*)?/, "").slice(0, 200) || "yt-dlp stopped without saying why";
}

function createYouTube({ dir, cacheDir, nodePath, fetch, log = () => {}, platform = process.platform, debugCommand = null }) {
	const exeName = platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
	const bin = path.join(dir, exeName);
	const statePath = path.join(dir, "state.json");
	const infos = new Map(); // id -> item (title, channel, duration)
	const downloads = new Map(); // id -> Promise<file>
	const protectedIds = new Set(); // playing or about to: never cleaned up
	let installing = null;
	let updating = null;
	let version = null;
	let lastError = null;
	let active = 0;
	const waiting = [];

	const readState = () => {
		try {
			return JSON.parse(fs.readFileSync(statePath, "utf8"));
		} catch (_) {
			return {};
		}
	};
	const writeState = (s) => {
		try {
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(statePath, JSON.stringify({ ...readState(), ...s }));
		} catch (_) {}
	};

	// Tests: OVERLAY_DEBUG_YTDLP runs a stand-in script with Node instead of the real yt-dlp.
	const command = () => (debugCommand ? [nodePath, [debugCommand]] : [bin, []]);
	const runtimeArgs = () => (nodePath ? ["--js-runtimes", `node:${nodePath}`] : []);

	function run(args, { timeoutMs = RUN_TIMEOUT_MS, onLine } = {}) {
		const [cmd, pre] = command();
		return new Promise((resolve, reject) => {
			let out = "";
			let err = "";
			let child;
			try {
				child = spawn(cmd, [...pre, ...args], { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PYTHONIOENCODING: "utf-8" } });
			} catch (e) {
				return reject(e);
			}
			const timer = setTimeout(() => {
				try {
					child.kill();
				} catch (_) {}
				reject(new Error("yt-dlp took too long"));
			}, timeoutMs);
			let partial = "";
			child.stdout.on("data", (d) => {
				out += d;
				if (!onLine) return;
				partial += d;
				const lines = partial.split(/\r?\n/);
				partial = lines.pop();
				lines.forEach(onLine);
			});
			child.stderr.on("data", (d) => (err += d));
			child.on("error", (e) => {
				clearTimeout(timer);
				reject(e);
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				if (code === 0) resolve({ out, err });
				else {
					const e = new Error(friendlyError(err || out));
					e.stderr = err;
					reject(e);
				}
			});
		});
	}

	// A run that fetches a video's details: if YouTube wants a sign-in, ask again as other clients.
	async function runVideo(args, opts) {
		try {
			return await run(args, opts);
		} catch (e) {
			if (!wantsSignIn(e)) throw e;
			log(`youtube: asked to sign in; trying other clients (${FALLBACK_CLIENTS})`);
			try {
				const r = await run(["--extractor-args", FALLBACK_CLIENTS, ...args], opts);
				log("youtube: the other clients got it");
				return r;
			} catch (e2) {
				log(`youtube: still refused: ${String(e2.stderr || e2.message).trim().split(/\r?\n/).pop()}`);
				throw e2;
			}
		}
	}

	function installed() {
		return !!debugCommand || fs.existsSync(bin);
	}

	// yt-dlp on first use: the official exe from its latest GitHub release.
	async function install(onProgress) {
		if (installed()) return;
		if (installing) return installing;
		installing = (async () => {
			const asset = platform === "win32" ? "yt-dlp.exe" : platform === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux";
			const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
			log(`youtube: downloading ${url}`);
			fs.mkdirSync(dir, { recursive: true });
			const res = await fetch(url);
			if (!res.ok) throw new Error(`Couldn't download yt-dlp (GitHub answered ${res.status})`);
			const total = Number(res.headers.get("content-length")) || 0;
			const tmp = bin + ".download";
			const fd = fs.openSync(tmp, "w");
			let got = 0;
			try {
				const reader = res.body.getReader();
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					fs.writeSync(fd, value);
					got += value.length;
					if (total && onProgress) onProgress(Math.round((got / total) * 100));
				}
			} finally {
				fs.closeSync(fd);
			}
			if (got < 1_000_000) throw new Error("The yt-dlp download was incomplete");
			if (platform !== "win32") fs.chmodSync(tmp, 0o755);
			fs.renameSync(tmp, bin);
			writeState({ updatedAt: Date.now() });
			log(`youtube: yt-dlp downloaded (${got} bytes)`);
		})();
		try {
			await installing;
		} finally {
			installing = null;
		}
	}

	// YouTube changes often and yt-dlp keeps up: update at most once a day, before the next use.
	async function update(force = false) {
		if (debugCommand || !installed()) return;
		if (updating) return updating;
		if (!force && Date.now() - (readState().updatedAt || 0) < UPDATE_EVERY_MS) return;
		updating = run(["-U"], { timeoutMs: 90000 })
			.then(({ out }) => {
				const line = out.trim().split(/\r?\n/).pop() || "";
				log(`youtube: ${line}`);
				writeState({ updatedAt: Date.now() });
				version = null;
			})
			.catch((e) => log(`youtube: update failed: ${e.message}`))
			.finally(() => (updating = null));
		return updating;
	}

	async function ready(onProgress) {
		try {
			await install(onProgress);
			await update();
			lastError = null;
		} catch (e) {
			lastError = e.message;
			throw e;
		}
	}

	async function getVersion() {
		if (version || !installed()) return version;
		try {
			version = (await run(["--version"], { timeoutMs: 20000 })).out.trim();
		} catch (_) {}
		return version;
	}

	// Title, channel and length. YouTube's oEmbed answers in a fraction of a second (no length);
	// yt-dlp knows everything but takes a few seconds, so it fills the length in afterwards.
	async function lookup(id, { full = false } = {}) {
		if (!ID_RE.test(id)) throw new Error("That isn't a YouTube video");
		const known = infos.get(id);
		if (known && (!full || known.duration)) return known;
		if (!full) {
			try {
				const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`);
				if (r.ok) {
					const j = await r.json();
					const it = item(id, { title: j.title, channel: j.author_name });
					infos.set(id, { ...it, ...(known || {}), name: it.name, artists: it.artists });
					return infos.get(id);
				}
				// otherwise yt-dlp says: oEmbed refuses videos that can't be embedded, which still play
			} catch (_) {}
		}
		await ready();
		const { out } = await runVideo(["-J", "--no-playlist", "--no-warnings", ...runtimeArgs(), watchUrl(id)], { timeoutMs: 60000 });
		const j = JSON.parse(out);
		const it = item(id, { title: j.title, channel: j.channel || j.uploader, duration: j.duration });
		infos.set(id, it);
		return it;
	}

	async function search(query, n = 8) {
		query = String(query || "").trim().slice(0, 200);
		if (!query) return [];
		await ready();
		const { out } = await run(["-J", "--flat-playlist", "--no-warnings", ...runtimeArgs(), `ytsearch${n}:${query}`], { timeoutMs: 60000 });
		const j = JSON.parse(out);
		return (j.entries || [])
			.filter((e) => e && ID_RE.test(e.id || ""))
			.map((e) => {
				const it = item(e.id, { title: e.title, channel: e.channel || e.uploader, duration: e.duration });
				if (!infos.has(e.id) || !infos.get(e.id).duration) infos.set(e.id, it);
				return it;
			});
	}

	function cachedFile(id) {
		try {
			const f = fs.readdirSync(cacheDir).find((n) => n.startsWith(id + ".") && !/\.(part|ytdl|tmp|temp)$/.test(n));
			return f ? path.join(cacheDir, f) : null;
		} catch (_) {
			return null;
		}
	}

	async function slot() {
		if (active < MAX_DOWNLOADS) return active++;
		await new Promise((r) => waiting.push(r));
		active++;
	}
	function release() {
		active--;
		const next = waiting.shift();
		if (next) next();
	}

	// The video's audio as a local file (downloaded once, then from the cache).
	function prepare(id, onProgress) {
		if (!ID_RE.test(id)) return Promise.reject(new Error("That isn't a YouTube video"));
		const have = cachedFile(id);
		if (have) {
			touch(have);
			return Promise.resolve(have);
		}
		if (downloads.has(id)) return downloads.get(id);
		const p = (async () => {
			await ready();
			await slot();
			try {
				fs.mkdirSync(cacheDir, { recursive: true });
				let file = null;
				const { out } = await runVideo(
					[
						"-f",
						"bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
						"-o",
						path.join(cacheDir, "%(id)s.%(ext)s"),
						"--no-playlist",
						"--no-part",
						"--no-mtime",
						"--no-warnings",
						"--newline",
						"--progress",
						"--no-simulate",
						"--print",
						"after_move:filepath",
						...runtimeArgs(),
						watchUrl(id),
					],
					{
						onLine: (line) => {
							const m = /\[download\]\s+([\d.]+)%/.exec(line);
							if (m && onProgress) onProgress(Math.round(parseFloat(m[1])));
						},
					}
				);
				file = out.trim().split(/\r?\n/).filter((l) => !/^\[download\]/.test(l)).pop();
				if (!file || !fs.existsSync(file)) file = cachedFile(id);
				if (!file) throw new Error("yt-dlp didn't say where it saved the audio");
				cleanup();
				return file;
			} finally {
				release();
			}
		})();
		downloads.set(id, p);
		p.finally(() => downloads.delete(id)).catch(() => {});
		return p;
	}

	function touch(f) {
		try {
			const now = new Date();
			fs.utimesSync(f, now, now);
		} catch (_) {}
	}

	// Older than two days, or over 300 MB in all (oldest first); never what's playing.
	function cleanup() {
		let files;
		try {
			files = fs
				.readdirSync(cacheDir)
				.map((n) => {
					const f = path.join(cacheDir, n);
					const st = fs.statSync(f);
					return { f, id: n.split(".")[0], size: st.size, t: st.mtimeMs };
				})
				.sort((a, b) => b.t - a.t);
		} catch (_) {
			return;
		}
		let total = 0;
		for (const x of files) {
			total += x.size;
			const old = Date.now() - x.t > CACHE_MAX_AGE_MS;
			if ((old || total > CACHE_MAX_BYTES) && !protectedIds.has(x.id) && !downloads.has(x.id)) {
				try {
					fs.unlinkSync(x.f);
				} catch (_) {}
			}
		}
	}

	return {
		parseId,
		item,
		lookup,
		search,
		prepare,
		cachedFile,
		cleanup,
		update: () => update(true),
		ready,
		getVersion,
		installed,
		protect: (id, on) => (on ? protectedIds.add(id) : protectedIds.delete(id)),
		known: (id) => infos.get(id) || null,
		remember: (id, info) => infos.set(id, { ...(infos.get(id) || item(id)), ...info }),
		status: () => ({ installed: installed(), installing: !!installing, updating: !!updating, version, error: lastError, updatedAt: readState().updatedAt || null }),
	};
}

module.exports = { createYouTube, parseId, ytItem: item, friendlyError };
