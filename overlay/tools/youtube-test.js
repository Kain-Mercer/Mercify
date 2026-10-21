// YouTube support without YouTube: youtube.js against tools/fake-ytdlp.js (links, lookups, search,
// downloads, the cache, errors), and a listening lobby passing a YouTube video from the session
// playlist to the host's player and on to a listener (stand-in relays, as in friends-test.js).
// Runs anywhere in a few seconds; CI runs it on every build.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const Module = require("module");
const { createYouTube, parseId } = require("../youtube");
const { createLobby, generateCode, formatCode } = require("../lobby");

let failures = 0;
function check(name, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
	if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- links

const links = {
	"https://www.youtube.com/watch?v=G5KxZ5Lc_YA": "G5KxZ5Lc_YA",
	"youtu.be/G5KxZ5Lc_YA?si=abc": "G5KxZ5Lc_YA",
	"https://m.youtube.com/shorts/G5KxZ5Lc_YA": "G5KxZ5Lc_YA",
	"https://music.youtube.com/watch?v=G5KxZ5Lc_YA&list=RDAMVM": "G5KxZ5Lc_YA",
	"https://www.youtube.com/embed/G5KxZ5Lc_YA": "G5KxZ5Lc_YA",
	G5KxZ5Lc_YA: null,
	"rick astley never gonna": null,
	"https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC": null,
	"https://www.youtube.com/watch?v=tooshort": null,
};
for (const [text, want] of Object.entries(links)) check(`link ${JSON.stringify(text)}`, parseId(text) === want, String(parseId(text)));

// ---------------------------------------------------------------- yt-dlp (the stand-in)

async function ytdlp() {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mercify-yt-test-"));
	process.env.FAKE_YT_DELAY_MS = "300";
	process.env.FAKE_YT_SECONDS = "3";
	const yt = createYouTube({ dir: path.join(tmp, "bin"), cacheDir: path.join(tmp, "cache"), nodePath: process.execPath, fetch: () => Promise.reject(new Error("offline")), debugCommand: path.join(__dirname, "fake-ytdlp.js") });
	const info = await yt.lookup("G5KxZ5Lc_YA");
	check("lookup: title, channel, length, thumbnail", info.name.includes("G5KxZ5Lc_YA") && info.artists[0] === "Fake Channel" && info.duration === 3000 && info.image === "https://i.ytimg.com/vi/G5KxZ5Lc_YA/mqdefault.jpg");
	const found = await yt.search("meme edit");
	check("search returns videos", found.length === 3 && found.every((f) => f.uri.startsWith("youtube:")), found.map((f) => f.uri).join(" "));
	const progress = [];
	const [a, b] = await Promise.all([yt.prepare("G5KxZ5Lc_YA", { onProgress: (p) => progress.push(p) }), yt.prepare("G5KxZ5Lc_YA")]);
	check("two requests share one download", a === b && fs.existsSync(a), path.basename(a));
	check("download progress is reported", progress.includes(100), progress.join(","));
	const t = Date.now();
	await yt.prepare("G5KxZ5Lc_YA");
	check("a second play comes from the cache", Date.now() - t < 100, `${Date.now() - t} ms`);
	let err = null;
	await yt.prepare("unavailabl1").catch((e) => (err = e.message));
	check("a removed video says so plainly", err === "This video isn't available", err);
	const viaOthers = await yt.prepare("signinonly1").catch((e) => e.message);
	check("a video YouTube wants a sign-in for plays through other clients", typeof viaOthers === "string" && viaOthers.endsWith("signinonly1.wav"), viaOthers);
	err = null;
	await yt.prepare("signinalway").catch((e) => (err = e.message));
	check("one that still wants a sign-in says so plainly", err === "YouTube won't play this one without signing in. Try another upload of it", err);
	const state = JSON.parse(fs.readFileSync(path.join(tmp, "bin", "state.json"), "utf8"));
	check("after the other clients were needed, they go first for a while", state.othersFirstUntil > Date.now() + 5 * 3600 * 1000);
	// fetching ahead waits its turn; playing a video that's still waiting starts it at once
	const t0 = Date.now();
	const ahead = yt.prepare("aheadvideo1", { background: true });
	const waitingOne = yt.prepare("aheadvideo2", { background: true });
	await sleep(50);
	await yt.prepare("aheadvideo2"); // clicked
	const clickedAfter = Date.now() - t0;
	await Promise.all([ahead, waitingOne]);
	check("a clicked video jumps the fetch-ahead queue", clickedAfter < 550, `${clickedAfter} ms (a turn takes ~300)`);
	// old files go, the one playing stays
	fs.writeFileSync(path.join(tmp, "cache", "oldvideo123.webm"), "x");
	fs.utimesSync(path.join(tmp, "cache", "oldvideo123.webm"), new Date(Date.now() - 3 * 86400000), new Date(Date.now() - 3 * 86400000));
	fs.utimesSync(a, new Date(Date.now() - 3 * 86400000), new Date(Date.now() - 3 * 86400000));
	yt.protect("G5KxZ5Lc_YA", true);
	yt.cleanup();
	check("the cache drops old files but keeps the one playing", !fs.existsSync(path.join(tmp, "cache", "oldvideo123.webm")) && fs.existsSync(a));
	fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------- a lobby with a YouTube video

const RELAYS = ["wss://relay-a.test/mqtt"];
const brokers = new Map();
function fakeConnect(url) {
	if (!brokers.has(url)) brokers.set(url, new Map());
	const subs = brokers.get(url);
	const c = new EventEmitter();
	c.connected = false;
	const mine = new Set();
	c.subscribe = (t) => {
		for (const topic of [].concat(t)) {
			if (!subs.has(topic)) subs.set(topic, new Set());
			subs.get(topic).add(c);
			mine.add(topic);
		}
	};
	c.unsubscribe = (topic) => {
		subs.get(topic)?.delete(c);
		mine.delete(topic);
	};
	c.publish = (topic, buf) => {
		for (const s of subs.get(topic) || []) setTimeout(() => s.connected && s.emit("message", topic, Buffer.from(buf)), 5 + Math.random() * 15);
	};
	c.end = () => {
		c.connected = false;
		for (const t of mine) subs.get(t)?.delete(c);
		c.emit("close");
	};
	setTimeout(() => {
		c.connected = true;
		c.emit("connect");
	}, 20);
	return c;
}

// A member with a stand-in player that does what it's told and reports back, like Mercify's.
function member(name, make = createLobby, opts = {}) {
	const m = { calls: [], player: { uri: null, name: "", artists: [], isPlaying: false, position: 0, at: Date.now(), duration: 180000, empty: true } };
	m.lobby = make({
		...opts,
		relays: RELAYS,
		connect: fakeConnect,
		connectTimeoutMs: 2000,
		command: async (action, args = {}) => {
			m.calls.push({ action, args });
			const p = m.player;
			const pos = p.isPlaying ? p.position + (Date.now() - p.at) : p.position;
			if (action === "state") return { ...p, position: pos, at: Date.now() };
			if (action === "playTrack") Object.assign(p, { uri: args.uri, name: args.uri, isPlaying: true, position: 0, at: Date.now(), empty: false });
			else if (action === "seek") Object.assign(p, { position: args.ms, at: Date.now() });
			else if (action === "togglePlay") Object.assign(p, { isPlaying: !p.isPlaying, position: pos, at: Date.now() });
			setTimeout(() => m.lobby.onPlayerState({ ...m.player }), 20);
			return true;
		},
	});
	m.lobby.setName(name);
	return m;
}

async function lobby() {
	const host = member("Host");
	const listener = member("Listener");
	const code = formatCode(generateCode());
	await host.lobby.join(code);
	await sleep(200);
	await listener.lobby.join(code);
	await sleep(3500);
	check("host and listener in one lobby", host.lobby.state().role === "host" && listener.lobby.state().role === "listener" && host.lobby.state().members.length === 2);
	const video = { uri: "youtube:G5KxZ5Lc_YA", name: "Fake meme edit", artists: ["Fake Channel"], image: "https://i.ytimg.com/vi/G5KxZ5Lc_YA/mqdefault.jpg", duration: 64000 };
	await listener.lobby.queueAdd(video);
	await sleep(600);
	const hq = host.lobby.state().queue;
	check("a listener's YouTube video reaches the session playlist", hq.length === 1 && hq[0].uri === video.uri && hq[0].image === video.image, JSON.stringify(hq.map((q) => q.uri)));
	check("everyone sees it in the session playlist", listener.lobby.state().queue[0]?.uri === video.uri);
	await host.lobby.playNext();
	await sleep(400);
	check("the host's player is asked to play the video", host.calls.some((c) => c.action === "playTrack" && c.args.uri === video.uri));
	await sleep(3000);
	const followed = listener.calls.find((c) => c.action === "playTrack" && c.args.uri === video.uri);
	check("the listener's player follows the host onto the video", !!followed, listener.calls.map((c) => c.action).join(","));
	check("the listener seeks to the host's position", listener.calls.some((c) => c.action === "seek"));
	await Promise.all([host.lobby.leave(), listener.lobby.leave()]);
}

// Mercify before 1.30.0 takes only Spotify songs and drops anything else without a word.
function oldLobbyModule() {
	const file = require.resolve("../lobby");
	const src = fs.readFileSync(file, "utf8").replace(/^const URI_RE = .*$/m, "const URI_RE = /^spotify:(track|episode):[A-Za-z0-9]{1,64}$/;");
	const mod = new Module(file, module);
	mod.filename = file;
	mod.paths = Module._nodeModulePaths(path.dirname(file));
	mod._compile(src, file);
	return mod.exports;
}

async function oldHost() {
	const host = member("Old host", oldLobbyModule().createLobby);
	const listener = member("Listener", createLobby, { suggestCheckMs: 1500 });
	const toasts = [];
	listener.lobby.on("toast", (t) => toasts.push(t));
	const code = formatCode(generateCode());
	await host.lobby.join(code);
	await sleep(200);
	await listener.lobby.join(code);
	await sleep(3500);
	await listener.lobby.queueAdd({ uri: "youtube:G5KxZ5Lc_YA", name: "Fake meme edit", artists: ["Fake Channel"], duration: 64000 });
	await listener.lobby.queueAdd({ uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", name: "A song", artists: ["Someone"], duration: 200000 });
	await sleep(2500);
	check("an old host drops the video but takes the song", host.lobby.state().queue.map((q) => q.uri).join() === "spotify:track:4uLU6hMCjMI75M1A2tKUQC");
	check("the listener is told the video didn't make it, and why", toasts.length === 1 && /Fake meme edit.*didn't make it.*Old host's Mercify.*1\.30\.0/.test(toasts[0]), JSON.stringify(toasts));
	await Promise.all([host.lobby.leave(), listener.lobby.leave()]);
}

(async () => {
	try {
		await ytdlp();
		await lobby();
		await oldHost();
	} catch (e) {
		check("no crash", false, e.stack);
	}
	console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
	process.exit(failures ? 1 : 0);
})();
