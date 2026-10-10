// Listening lobbies: listen along with friends through Mercify.
//
// How it works
// - A lobby is just a code. Everyone who enters the same code is in the same lobby; the first
//   person in becomes the host. If the host leaves, the longest-standing member takes over.
// - Messages go through free public MQTT relays (no Mercify server). We connect to several at once
//   and send every message through all of them, so one relay being down doesn't matter.
// - Everything is encrypted with a key derived from the lobby code, and the relay "topic" is a hash
//   of the code. People watching the public relay see random topics and scrambled bytes; only
//   people who know the code can read or join.
// - The host's Mercify broadcasts what's playing (song, position, playing/paused) on every change
//   and every few seconds. Listeners play the same song and stay within a couple of seconds of
//   the host, correcting for each machine's clock difference.
// - Listeners can't change the song; picking a song sends it to the host's queue as a suggestion.
//
// This module has no Electron dependency so it can be tested on its own (tools/lobby-test.js).

const crypto = require("crypto");
const { EventEmitter } = require("events");
const mqtt = require("mqtt");

// Free public MQTT relays. mqtt.eclipseprojects.io uses port 443, which gets through strict
// school/work firewalls that block the others' ports.
const DEFAULT_RELAYS = [
	"wss://broker.emqx.io:8084/mqtt",
	"wss://mqtt.eclipseprojects.io:443/mqtt",
	"wss://test.mosquitto.org:8081/mqtt",
	"wss://broker.hivemq.com:8884/mqtt",
];

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const MIN_CODE = 4;
const MAX_CODE = 16;

const HEARTBEAT_MS = 8000; // "I'm still here"
const MEMBER_TIMEOUT_MS = 25000; // nobody heard from in this long has left
const HOST_SYNC_MS = 5000; // host repeats what's playing this often
const JOIN_WAIT_MS = 2500; // how long to listen for an existing host when joining
const CONNECT_TIMEOUT_MS = 10000;
const DRIFT_MS = 2000; // listeners re-seek when further off than this
const SETTLE_MS = 1500; // after a correction, ignore our own player's reports this long (they may be stale)
const SEEK_DETECT_MS = 2500; // host: a jump this big in position is a seek

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function generateCode() {
	const bytes = crypto.randomBytes(8);
	return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function normalizeCode(s) {
	return String(s || "")
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.slice(0, MAX_CODE);
}

function formatCode(code) {
	return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function cleanName(s) {
	return String(s || "")
		.replace(/[\u0000-\u001f]/g, "")
		.trim()
		.slice(0, 24);
}

function deriveKey(code) {
	return new Promise((resolve, reject) =>
		crypto.scrypt(code, "mercify-lobby-v1", 32, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)))
	);
}

function topicFor(code) {
	return "mercify/v1/" + crypto.createHash("sha256").update("mercify-topic-v1:" + code).digest("hex").slice(0, 32);
}

function seal(key, obj) {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	const ct = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function open(key, buf) {
	if (!Buffer.isBuffer(buf) || buf.length < 29) return null;
	try {
		const decipher = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
		decipher.setAuthTag(buf.subarray(12, 28));
		return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8"));
	} catch (_) {
		return null; // wrong code / tampered / not ours
	}
}

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? s[Math.floor(s.length / 2)] : 0;
};

// Who should be host: the earliest joiner, ties broken by id. Everyone computes the same answer.
const senior = (a, b) => (a.joinedAt !== b.joinedAt ? a.joinedAt < b.joinedAt : a.id < b.id);

/**
 * @param {object} opts
 * @param {(action: string, args?: object) => Promise<any>} opts.command  run a Spotify command (via the bridge)
 * @param {string[]} [opts.relays]
 * @param {(msg: string) => void} [opts.log]
 */
function createLobby({ command, relays = DEFAULT_RELAYS, log = () => {}, trace = false }) {
	const ev = new EventEmitter();

	let name = "";
	let clients = [];
	let key = null;
	let topic = null;
	let code = null;
	let status = "idle"; // idle | connecting | joined | error
	let error = null;
	let me = null; // { id, name, joinedAt }
	let role = null; // host | listener
	let hostId = null;
	const members = new Map(); // id -> { id, name, joinedAt, role, lastSeen }
	let seq = 0;
	const seen = new Set();
	const seenOrder = [];
	let timers = [];
	let activity = [];
	let hostTrack = null; // last state received from the host
	let offsets = []; // clock offset samples (host clock - my clock)
	let applying = false;
	let followAgain = false;
	let settledAt = 0; // when our last correction finished
	let appliedSentAt = 0; // which host message that correction was for
	const lastStateN = new Map(); // host id -> newest state message number seen

	// Our own player, kept up to date by the app.
	let player = null; // { uri, name, artists, image, position, at, isPlaying, duration }
	let lastBroadcast = null;

	// ---------------------------------------------------------------- state for the UI

	function snapshot() {
		const list = [];
		if (me) list.push({ id: me.id, name: me.name, role, you: true });
		for (const m of members.values()) list.push({ id: m.id, name: m.name, role: m.id === hostId ? "host" : "listener", you: false });
		list.sort((a, b) => (a.role === "host" ? -1 : b.role === "host" ? 1 : 0));
		const host = list.find((m) => m.role === "host");
		return {
			status,
			error,
			code,
			displayCode: code ? formatCode(code) : null,
			role,
			name,
			hostName: host ? host.name : null,
			members: list,
			relays: { connected: clients.filter((c) => c.connected).length, total: clients.length },
			activity: activity.slice(-12),
			hostTrack: role === "listener" ? hostTrack : null,
		};
	}

	const changed = () => ev.emit("change", snapshot());

	function note(text, toast = false) {
		activity.push({ t: Date.now(), text });
		if (activity.length > 40) activity = activity.slice(-40);
		if (toast) ev.emit("toast", text);
		changed();
	}

	// ---------------------------------------------------------------- sending / receiving

	function send(type, fields = {}) {
		if (!key || !me) return;
		const msg = { id: me.id, n: ++seq, ty: type, name: me.name, joinedAt: me.joinedAt, ...fields };
		const buf = seal(key, msg);
		if (trace) log(`send ${type} n=${msg.n} relays=${clients.filter((c) => c.connected).length}`);
		for (const c of clients) if (c.connected) c.publish(topic, buf, { qos: 0, retain: false });
	}

	function receive(_topic, buf) {
		const msg = open(key, buf);
		if (trace) log(`recv ${msg ? msg.ty + " from " + msg.name : "unreadable"}`);
		if (!msg || !me || msg.id === me.id || typeof msg.id !== "string") return;
		const dedupe = `${msg.id}:${msg.n}`;
		if (seen.has(dedupe)) return; // same message through another relay
		seen.add(dedupe);
		seenOrder.push(dedupe);
		if (seenOrder.length > 1000) seen.delete(seenOrder.shift());
		if (msg.to && msg.to !== me.id) return;
		try {
			handle(msg);
		} catch (err) {
			log(`lobby: bad message: ${err.message}`);
		}
	}

	function upsertMember(msg) {
		const isNew = !members.has(msg.id);
		const m = members.get(msg.id) || { id: msg.id };
		m.name = cleanName(msg.name) || "Someone";
		m.joinedAt = Number(msg.joinedAt) || Date.now();
		m.lastSeen = Date.now();
		if (msg.role) m.role = msg.role;
		members.set(msg.id, m);
		return { m, isNew };
	}

	function handle(msg) {
		switch (msg.ty) {
			case "hello": {
				const { m } = upsertMember(msg);
				send("here", { role, to: msg.id });
				if (role === "host") sendState();
				if (status === "joined") note(`${m.name} joined`);
				break;
			}
			case "here": {
				const { m, isNew } = upsertMember(msg);
				if (msg.role === "host") claimHost(m);
				if (isNew && status === "joined") note(`${m.name} is here`);
				else changed();
				break;
			}
			case "bye": {
				const m = members.get(msg.id);
				if (!m) return;
				members.delete(msg.id);
				note(`${m.name} left`);
				if (msg.id === hostId) electHost();
				break;
			}
			case "state": {
				const m = members.get(msg.id);
				if (m) m.lastSeen = Date.now();
				if (!hostId && m) claimHost(m);
				if (msg.id !== hostId) return;
				// With several relays, an older message can arrive after a newer one.
				if (msg.n <= (lastStateN.get(msg.id) || 0)) return;
				lastStateN.set(msg.id, msg.n);
				// Kept even while still joining, so a new listener can start straight away.
				hostTrack = { uri: msg.uri, name: msg.trackName, artists: msg.artists, image: msg.image, duration: msg.duration, position: msg.position, playing: msg.playing, sentAt: msg.sentAt };
				changed();
				if (role === "listener") follow();
				break;
			}
			case "ping":
				send("pong", { to: msg.id, t0: msg.t0, th: Date.now() });
				break;
			case "pong": {
				const t1 = Date.now();
				if (t1 - msg.t0 > 5000) return; // too slow to be useful
				offsets.push(msg.th - (msg.t0 + t1) / 2);
				if (offsets.length > 9) offsets.shift();
				break;
			}
			case "suggest": {
				if (role !== "host" || typeof msg.uri !== "string" || !/^spotify:(track|episode):/.test(msg.uri)) return;
				const who = cleanName(msg.name) || "Someone";
				command("addToQueue", { uri: msg.uri })
					.then(() => note(`${who} added “${msg.trackName || "a song"}” to the queue`, true))
					.catch(() => note(`Couldn't queue ${who}'s suggestion`));
				break;
			}
		}
	}

	// ---------------------------------------------------------------- host election

	// Clock offsets are measured against the host, so a new host means measuring again.
	function setHost(id) {
		if (hostId === id) return;
		hostId = id;
		offsets = [];
		appliedSentAt = 0;
		if (role === "listener" && id && id !== me?.id) syncClock();
	}

	function claimHost(m) {
		if (role === "host") {
			if (senior(m, me)) becomeListener(m.id, `${m.name} is the host`);
			// otherwise they're junior: they'll step down when they hear our "here"
			else send("here", { role: "host" });
			return;
		}
		if (hostId !== m.id) {
			const first = !hostId;
			setHost(m.id);
			if (!first) note(`${m.name} is now the host`, true);
			changed();
		}
	}

	function electHost() {
		const candidates = [me, ...members.values()];
		const next = candidates.reduce((a, b) => (senior(a, b) ? a : b));
		if (next.id === me.id) becomeHost("The host left, so you're the host now");
		else {
			setHost(next.id);
			note(`${next.name} is now the host`, true);
		}
	}

	function becomeHost(why) {
		role = "host";
		setHost(me.id);
		hostTrack = null;
		send("here", { role: "host" });
		sendState();
		if (why) note(why, true);
		changed();
	}

	function becomeListener(newHostId, why) {
		const wasHost = role === "host";
		role = "listener";
		if (hostId === newHostId && !wasHost) syncClock();
		else setHost(newHostId);
		if (why) note(why);
		changed();
	}

	// ---------------------------------------------------------------- clock offset (listener)

	async function syncClock() {
		for (let i = 0; i < 5 && role === "listener" && hostId; i++) {
			send("ping", { to: hostId, t0: Date.now() });
			await sleep(400);
		}
	}

	const offset = () => median(offsets);

	// ---------------------------------------------------------------- host: broadcast what's playing

	function playerPosition() {
		if (!player) return 0;
		const base = player.position || 0;
		return player.isPlaying ? base + (Date.now() - (player.at || Date.now())) : base;
	}

	function sendState() {
		if (role !== "host" || !player || player.empty) return;
		const s = {
			uri: player.uri,
			trackName: player.name,
			artists: player.artists,
			image: player.image,
			duration: player.duration,
			position: Math.round(playerPosition()),
			playing: !!player.isPlaying,
			sentAt: Date.now(),
		};
		lastBroadcast = { uri: s.uri, playing: s.playing, position: s.position, at: s.sentAt };
		send("state", s);
	}

	// ---------------------------------------------------------------- listener: follow the host

	function hostPositionNow() {
		const s = hostTrack;
		if (!s) return 0;
		return s.playing ? s.position + (Date.now() + offset() - s.sentAt) : s.position;
	}

	let followTimer = null;

	// Run a command and update our picture of the player right away, instead of waiting for
	// Spotify to report back (which would make us correct the same thing twice).
	async function act(action, args, playing) {
		const before = playerPosition();
		await command(action, args);
		const now = Date.now();
		if (!player) player = { empty: false };
		if (action === "playTrack") Object.assign(player, { uri: args.uri, position: 0, at: now, isPlaying: true, empty: false });
		else if (action === "seek") Object.assign(player, { position: args.ms, at: now });
		else if (action === "togglePlay") Object.assign(player, { position: before, at: now, isPlaying: playing });
	}

	const hostPos = () => Math.max(0, Math.round(hostPositionNow()));

	async function follow() {
		const s = hostTrack;
		if (!s || !s.uri || role !== "listener") return;
		if (applying) {
			followAgain = true;
			return;
		}
		if (s.uri.startsWith("spotify:local:")) return; // the host's own files can't be played here
		// Our song ended a moment before the host's: don't restart the old song for its last seconds.
		if (player && player.uri !== s.uri && s.duration && hostPositionNow() > s.duration - 2500) return;

		// A new message from the host is acted on immediately. Our own player's reports right after
		// a correction may be stale, so for those wait until things settle.
		const fresh = s.sentAt !== appliedSentAt;
		const settled = Date.now() - settledAt >= SETTLE_MS;
		if (!fresh && !settled) {
			clearTimeout(followTimer);
			followTimer = setTimeout(follow, SETTLE_MS - (Date.now() - settledAt) + 50);
			return;
		}

		applying = true;
		try {
			if (!player || player.empty || player.uri !== s.uri) {
				log(`follow: play ${s.uri} at ${hostPos()} (offset ${offset()}, samples ${offsets.length})`);
				await act("playTrack", { uri: s.uri });
				await sleep(800); // let Spotify start the song before seeking
				await act("seek", { ms: hostPos() });
				if (!s.playing) await act("togglePlay", {}, false);
			} else if (!!player.isPlaying !== !!s.playing) {
				await act("togglePlay", {}, !!s.playing);
				await act("seek", { ms: hostPos() }); // line up exactly while we're at it
			} else if (Math.abs(playerPosition() - hostPositionNow()) > DRIFT_MS) {
				await act("seek", { ms: hostPos() });
			} else {
				return;
			}
			settledAt = Date.now();
			appliedSentAt = s.sentAt;
		} catch (err) {
			log(`lobby: couldn't follow the host: ${err.message}`);
		} finally {
			applying = false;
			if (followAgain) {
				followAgain = false;
				setTimeout(follow, 50);
			}
		}
	}

	// ---------------------------------------------------------------- timers

	function startTimers() {
		timers.push(setInterval(() => send("here", { role }), HEARTBEAT_MS));
		timers.push(
			setInterval(() => {
				if (role === "host") sendState();
			}, HOST_SYNC_MS)
		);
		timers.push(
			setInterval(() => {
				// re-check the clock now and then; drift and sleep/wake change it
				if (role === "listener" && hostId) send("ping", { to: hostId, t0: Date.now() });
			}, 30000)
		);
		timers.push(
			setInterval(() => {
				const now = Date.now();
				let hostGone = false;
				for (const m of [...members.values()]) {
					if (now - m.lastSeen > MEMBER_TIMEOUT_MS) {
						members.delete(m.id);
						note(`${m.name} left`);
						if (m.id === hostId) hostGone = true;
					}
				}
				if (hostGone) electHost();
				changed(); // relay counts
			}, 5000)
		);
	}

	function stopTimers() {
		timers.forEach(clearInterval);
		timers = [];
		clearTimeout(followTimer);
	}

	// ---------------------------------------------------------------- connections

	function connectAll() {
		clients = relays.map((url) => {
			const c = mqtt.connect(url, {
				clientId: "mercify_" + crypto.randomBytes(6).toString("hex"),
				clean: true,
				keepalive: 30,
				connectTimeout: 8000,
				reconnectPeriod: 5000,
				protocolVersion: 4,
			});
			c.on("connect", () => {
				c.subscribe(topic, { qos: 0 });
				changed();
			});
			c.on("message", receive);
			c.on("close", changed);
			c.on("error", (err) => log(`lobby relay ${url}: ${err.message}`));
			return c;
		});
	}

	async function waitForRelay() {
		const start = Date.now();
		while (Date.now() - start < CONNECT_TIMEOUT_MS) {
			if (clients.some((c) => c.connected)) {
				await sleep(300); // give the subscribe a moment
				return true;
			}
			await sleep(100);
		}
		return false;
	}

	// ---------------------------------------------------------------- public API

	async function join(rawCode) {
		const c = normalizeCode(rawCode);
		if (c.length < MIN_CODE) throw new Error(`Lobby codes need at least ${MIN_CODE} letters or numbers.`);
		if (!cleanName(name)) throw new Error("Set your name first.");
		await leave();
		code = c;
		status = "connecting";
		error = null;
		activity = [];
		changed();
		key = await deriveKey(code);
		topic = topicFor(code);
		me = { id: crypto.randomBytes(8).toString("hex"), name: cleanName(name), joinedAt: Date.now() };
		connectAll();
		if (!(await waitForRelay())) {
			const msg = "Couldn't reach any lobby relay. Check your internet connection or firewall.";
			await leave();
			status = "error";
			error = msg;
			changed();
			throw new Error(msg);
		}
		if (code === null) return snapshot(); // left while connecting
		send("hello");
		await sleep(JOIN_WAIT_MS);
		if (code === null) return snapshot();
		const host = [...members.values()].filter((m) => m.role === "host").sort((a, b) => (senior(a, b) ? -1 : 1))[0];
		status = "joined";
		startTimers();
		if (host) {
			becomeListener(host.id);
			note(`Joined ${host.name}'s lobby`);
			send("here", { role: "listener" });
			await sleep(1300); // a few clock pings, so the first seek lands in the right place
			follow();
		} else {
			becomeHost();
			note(members.size ? "You're the host" : "Lobby started. Share the code so friends can join.");
		}
		return snapshot();
	}

	async function leave() {
		const wasIn = !!code;
		if (wasIn && me && key) send("bye");
		stopTimers();
		const old = clients;
		clients = [];
		if (old.length) {
			await sleep(150); // let the goodbye go out
			old.forEach((c) => c.end(true));
		}
		code = key = topic = me = role = hostId = hostTrack = lastBroadcast = null;
		members.clear();
		lastStateN.clear();
		settledAt = appliedSentAt = 0;
		seen.clear();
		seenOrder.length = 0;
		offsets = [];
		status = "idle";
		error = null;
		if (wasIn) changed();
		return snapshot();
	}

	// Fire-and-forget goodbye for app shutdown.
	function leaveNow() {
		if (code && me && key) send("bye");
	}

	function setName(n) {
		name = cleanName(n);
		if (me && name) {
			me.name = name;
			send("here", { role });
		}
		changed();
	}

	function suggest(track) {
		if (!track?.uri) return Promise.reject(new Error("Nothing to suggest"));
		if (role === "host" || !code) return command("addToQueue", { uri: track.uri });
		if (!hostId) return Promise.reject(new Error("There's no host right now"));
		send("suggest", { to: hostId, uri: track.uri, trackName: track.name, artists: track.artists });
		note(`You suggested “${track.name}”`);
		return Promise.resolve();
	}

	// The app reports our own Spotify's state here.
	function onPlayerState(state) {
		player = state ? { ...state, at: state.at || Date.now() } : null;
		if (role === "host" && player && !player.empty) {
			if (!lastBroadcast || lastBroadcast.uri !== player.uri || lastBroadcast.playing !== !!player.isPlaying) sendState();
		} else if (role === "listener") {
			follow();
		}
	}

	function onPlayerProgress(position, at) {
		if (!player) return;
		const expected = playerPosition();
		player.position = position;
		player.at = at || Date.now();
		if (role === "host" && Math.abs(position - expected) > SEEK_DETECT_MS) sendState(); // host seeked
	}

	return {
		join,
		leave,
		leaveNow,
		setName,
		suggest,
		onPlayerState,
		onPlayerProgress,
		state: snapshot,
		isListener: () => role === "listener" && status === "joined",
		on: (e, fn) => ev.on(e, fn),
	};
}

module.exports = { createLobby, generateCode, normalizeCode, formatCode, topicFor, DEFAULT_RELAYS };
