// Remote: control this PC's Mercify from a paired phone.
//
// How it works (deliberately the same shape as friends.js, so the phone runs this file too)
// - The PC and each paired phone each have a long-lived X25519 key pair. They pair once: the PC
//   shows a QR with its public key and a one-time nonce; the phone scans it and says hello on a
//   channel derived from the nonce (so only someone who saw the QR can be heard). After that the
//   two share a private channel derived from their X25519 shared secret — key and relay topic both
//   — exactly like a friends channel, so nobody else can read it or even find it.
// - On that channel the PC ("host") publishes its player state (now playing, position, queue,
//   lobby, friends-online) on every change and every few seconds; the phone ("device") sends
//   commands (play/pause/skip/seek/volume/…, join a lobby) which the PC validates and runs through
//   its own playerCommand(). The phone never touches its own Spotify.
// - Transport is pluggable. Today there's one link: the same free public MQTT relays friends and
//   lobbies use (works anywhere, no setup). A LAN link (direct socket on the home network) can be
//   added with addLink() without changing anything else — frames are the same either way.
//
// This module has no Electron dependency so it can be tested on its own (tools/remote-test.js).

const crypto = require("crypto");
const { EventEmitter } = require("events");

// X25519 public keys as SPKI DER: this fixed prefix, then the 32 raw bytes. (As in friends.js.)
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");

const HEARTBEAT_MS = 5000; // host repeats its state this often, so a phone that just connected catches up
const OFFLINE_MS = 20000; // nothing heard from the other side in this long: treat as offline
const PAIR_TTL_MS = 3 * 60000; // a pairing QR is good for this long
const MAX_DEVICES = 10; // paired phones per PC
const CONNECT_TIMEOUT_MS = 10000;

// The exact set of playback actions the desktop bridge understands (overlay-bridge.js `actions`),
// plus the two lobby actions the host handles itself. Anything else from a phone is refused.
const BRIDGE_ACTIONS = new Set(["state", "togglePlay", "next", "prev", "seek", "setVolume", "toggleShuffle", "toggleRepeat", "toggleLike", "search", "playlists", "playlistTracks", "playTrack", "playContext", "addToQueue", "removeFromQueue"]);

// A pairing code is typeable (shown on the PC, typed on the phone) or carried in a QR. Same
// alphabet as lobby codes (no 0/O, 1/I/L); 16 chars ≈ 80 bits, single-use and short-lived.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 16;
function makeCode() {
	const bytes = crypto.randomBytes(CODE_LEN);
	let s = "";
	for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
	return s;
}
const cleanCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
const LOBBY_ACTIONS = new Set(["joinLobby", "leaveLobby"]);
// Spotify songs/episodes and YouTube videos, same shapes lobby.js accepts as untrusted input.
const URI_RE = /^(spotify:(track|episode):[A-Za-z0-9]{1,64}|youtube:[A-Za-z0-9_-]{11})$/;

// ------------------------------------------------------------------ small crypto helpers
// (seal/open match friends.js byte for byte so the phone's node-crypto shim handles them already.)

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
		return null;
	}
}

const rawPub = (b64) => Buffer.from(b64, "base64");
function fidOf(pubB64) {
	return crypto.createHash("sha256").update(Buffer.concat([SPKI_X25519, rawPub(pubB64)])).digest("base64").slice(0, 22);
}
function newIdentity() {
	const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
	return {
		pub: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"),
		priv: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
	};
}
function validIdentity(id) {
	if (!id || typeof id.pub !== "string" || typeof id.priv !== "string") return false;
	try {
		const priv = crypto.createPrivateKey({ key: Buffer.from(id.priv, "base64"), format: "der", type: "pkcs8" });
		return crypto.createPublicKey(priv).export({ type: "spki", format: "der" }).subarray(-32).toString("base64") === id.pub;
	} catch (_) {
		return false;
	}
}
function cleanName(s) {
	return String(s || "")
		.replace(/[\u0000-\u001f]/g, "")
		.trim()
		.slice(0, 32);
}

// ------------------------------------------------------------------ relay link (MQTT over WebSocket)
//
// A "link" carries sealed frames between topics. It publishes to a topic and emits ("message",
// topic, buf) for topics it's subscribed to. The relay link fans out across several public relays,
// so one being down doesn't matter (same tactic as friends.js). Other links (LAN) can be added
// later with the same tiny interface.

function createRelayLink({ relays, connect, log }) {
	const ev = new EventEmitter();
	const clients = [];
	const subs = new Set(); // topics we want subscribed on every relay
	let outbox = []; // frames sent while nothing was connected: { topic, buf, at }

	for (const url of relays) {
		let client;
		try {
			client = connect(url, { clientId: "mrc_" + crypto.randomBytes(6).toString("hex"), reconnectPeriod: 4000, connectTimeout: CONNECT_TIMEOUT_MS, clean: true });
		} catch (err) {
			log(`relay ${url}: ${err.message}`);
			continue;
		}
		client.on("connect", () => {
			for (const t of subs) client.subscribe(t, { qos: 0 });
			const due = outbox.filter((m) => Date.now() - m.at < 120000);
			outbox = [];
			for (const m of due) client.publish(m.topic, m.buf, { qos: 0, retain: false });
			ev.emit("up");
		});
		client.on("message", (topic, buf) => ev.emit("message", topic, buf));
		client.on("error", (err) => log(`relay ${url}: ${err.message}`));
		clients.push(client);
	}

	return {
		name: "relay",
		subscribe(topic) {
			if (subs.has(topic)) return;
			subs.add(topic);
			for (const c of clients) if (c.connected) c.subscribe(topic, { qos: 0 });
		},
		unsubscribe(topic) {
			if (!subs.delete(topic)) return;
			for (const c of clients) if (c.connected) c.unsubscribe(topic);
		},
		publish(topic, buf) {
			const live = clients.filter((c) => c.connected);
			if (live.length === 0) {
				outbox.push({ topic, buf, at: Date.now() });
				if (outbox.length > 50) outbox.shift();
				return;
			}
			for (const c of live) c.publish(topic, buf, { qos: 0, retain: false });
		},
		connected: () => clients.some((c) => c.connected),
		close() {
			for (const c of clients) try { c.end(true); } catch (_) {}
		},
		on: (e, fn) => ev.on(e, fn),
	};
}

// ------------------------------------------------------------------ the remote
//
// opts:
//   role        "host" (the PC) or "device" (the phone)
//   store        { load(): data|null, save(data) }  persists identity + paired peers
//   relays       public MQTT relay URLs (DEFAULT_RELAYS from lobby.js is fine)
//   connect      mqtt.connect, or a stand-in for tests
//   name         display name shown to the other side
//   control      host only: { command(action, args), snapshot(), joinLobby(code), leaveLobby() }
//   lan          optional: an extra link (see addLink); omitted for now
//   log

function createRemote({ role, store, relays, connect, name = "", control = null, log = () => {}, now = Date.now }) {
	if (role !== "host" && role !== "device") throw new Error('remote role must be "host" or "device"');
	if (role === "host" && (!control || typeof control.command !== "function")) throw new Error("host remote needs control.command");
	connect = connect || require("mqtt").connect;

	const ev = new EventEmitter();
	const saved = store.load() || {};
	const identity = validIdentity(saved.identity) ? saved.identity : newIdentity();
	const privateKey = crypto.createPrivateKey({ key: Buffer.from(identity.priv, "base64"), format: "der", type: "pkcs8" });
	const myFid = fidOf(identity.pub);
	const boot = crypto.randomBytes(4).toString("hex");
	let seq = 0;
	let myName = cleanName(name);

	const peers = new Map(); // fid -> { fid, pub, name, addedAt, key, topic, lastSeen, online }
	const topics = new Map(); // topic -> fid
	const links = [];
	let pairing = null; // host: { nonce, key, topic, timer } while a QR is live

	// --- channels ---------------------------------------------------------

	function channel(peerPubB64) {
		const fid = fidOf(peerPubB64);
		const shared = crypto.diffieHellman({ privateKey, publicKey: crypto.createPublicKey({ key: Buffer.concat([SPKI_X25519, rawPub(peerPubB64)]), format: "der", type: "spki" }) });
		const ids = [myFid, fid].sort().join(":");
		const derive = (what, n) => Buffer.from(crypto.hkdfSync("sha256", shared, "mercify-remote-v1", `${what}:${ids}`, n));
		return { key: derive("key", 32), topic: "mercify/v1/" + derive("topic", 16).toString("hex") };
	}

	// Pairing channel comes from the nonce alone: anyone who scanned the QR can speak on it, nobody
	// else can find it. (Short-lived and single-use; the real channel above takes over at once.)
	function pairChannel(code) {
		const ikm = Buffer.from(cleanCode(code), "utf8");
		const derive = (what, n) => Buffer.from(crypto.hkdfSync("sha256", ikm, "mercify-pair-v1", what, n));
		return { key: derive("key", 32), topic: "mercify/v1/" + derive("topic", 16).toString("hex") };
	}

	// --- peers ------------------------------------------------------------

	function addPeer(pub, peerName, addedAt) {
		const fid = fidOf(pub);
		if (!fid || fid === myFid) return null;
		const { key, topic } = channel(pub);
		const peer = peers.get(fid) || { fid, pub, addedAt: addedAt || now() };
		peer.name = cleanName(peerName) || peer.name || (role === "host" ? "Phone" : "PC");
		peer.key = key;
		peer.topic = topic;
		peer.lastSeen = peer.lastSeen || 0;
		peer.online = peer.online || false;
		peers.set(fid, peer);
		topics.set(topic, fid);
		for (const l of links) l.subscribe(topic);
		return peer;
	}

	function save() {
		try {
			store.save({ v: 1, identity, peers: [...peers.values()].map((p) => ({ pub: p.pub, name: p.name, addedAt: p.addedAt })) });
		} catch (err) {
			log(`remote: couldn't save: ${err.message}`);
		}
	}

	for (const p of Array.isArray(saved.peers) ? saved.peers.slice(0, MAX_DEVICES) : []) addPeer(p.pub, p.name, p.addedAt);
	if (!validIdentity(saved.identity)) save();

	// --- sending / receiving ---------------------------------------------

	function sendTo(peer, ty, fields) {
		const buf = seal(peer.key, { f: myFid, b: boot, n: ++seq, ty, t: now(), ...fields });
		for (const l of links) l.publish(peer.topic, buf);
	}

	const seen = new Set();
	const seenOrder = [];
	function firstTime(f, b, n) {
		const k = `${f}:${b}:${n}`;
		if (seen.has(k)) return false;
		seen.add(k);
		seenOrder.push(k);
		if (seenOrder.length > 400) seen.delete(seenOrder.shift());
		return true;
	}

	function markSeen(peer) {
		const was = peer.online;
		peer.lastSeen = now();
		peer.online = true;
		if (!was) ev.emit("peer", view());
	}

	async function onPeerMessage(peer, msg) {
		if (!msg || typeof msg.ty !== "string" || msg.f === myFid) return;
		if (!firstTime(msg.f, msg.b, msg.n)) return;
		markSeen(peer);

		if (role === "host" && msg.ty === "cmd") {
			await runCommand(peer, msg);
			return;
		}
		if (role === "host" && msg.ty === "hello") {
			// A phone we already know reconnecting: answer with the current state so it catches up.
			pushState(peer);
			return;
		}
		if (role === "device" && msg.ty === "state") {
			ev.emit("state", msg.state || null);
			return;
		}
		// The PC's reply to a command we sent with request() (e.g. search results).
		if (role === "device" && msg.ty === "ack") {
			const p = pending.get(msg.id);
			if (!p) return;
			pending.delete(msg.id);
			clearTimeout(p.timer);
			msg.ok ? p.resolve(msg.data ?? null) : p.reject(new Error(msg.error || "command failed"));
			return;
		}
		// Opaque signalling, either direction: the audio layer (WebRTC) carries its SDP offer /
		// answer / ICE candidates over the already-encrypted channel, so remote.js stays unaware
		// of WebRTC. `kind` is the sender's label; `data` is its payload.
		if (msg.ty === "signal") {
			ev.emit("signal", { fid: peer.fid, kind: typeof msg.kind === "string" ? msg.kind : "", data: msg.data });
			return;
		}
		if (msg.ty === "bye") {
			// The other side unpaired us. Drop them.
			forget(peer.fid, false);
		}
	}

	// Host: validate a command from a phone, then run it through the PC's own playerCommand().
	async function runCommand(peer, msg) {
		const action = typeof msg.action === "string" ? msg.action : "";
		const args = msg.args && typeof msg.args === "object" ? msg.args : {};
		if (LOBBY_ACTIONS.has(action)) {
			try {
				if (action === "joinLobby" && control.joinLobby) await control.joinLobby(String(args.code || "").slice(0, 32));
				if (action === "leaveLobby" && control.leaveLobby) await control.leaveLobby();
			} catch (err) {
				sendTo(peer, "ack", { id: msg.id ?? null, ok: false, error: err.message });
				return;
			}
			sendTo(peer, "ack", { id: msg.id ?? null, ok: true });
			pushState(peer);
			return;
		}
		if (!BRIDGE_ACTIONS.has(action)) {
			sendTo(peer, "ack", { id: msg.id ?? null, ok: false, error: "action not allowed: " + action });
			return;
		}
		// Clean the few args that carry untrusted strings/numbers.
		const safe = {};
		if ("uri" in args) {
			if (!URI_RE.test(String(args.uri))) {
				sendTo(peer, "ack", { id: msg.id ?? null, ok: false, error: "bad uri" });
				return;
			}
			safe.uri = String(args.uri);
		}
		if ("context" in args) safe.context = String(args.context).slice(0, 200);
		if ("qid" in args) safe.qid = String(args.qid).slice(0, 64);
		if ("query" in args) safe.query = String(args.query).slice(0, 200);
		if ("ms" in args) safe.ms = Math.max(0, Math.min(24 * 3600 * 1000, Number(args.ms) || 0));
		if ("position" in args) safe.position = Math.max(0, Math.min(24 * 3600 * 1000, Number(args.position) || 0));
		if ("level" in args) safe.level = Math.max(0, Math.min(1, Number(args.level) || 0));
		try {
			const data = await control.command(action, safe);
			sendTo(peer, "ack", { id: msg.id ?? null, ok: true, data: data ?? null });
		} catch (err) {
			sendTo(peer, "ack", { id: msg.id ?? null, ok: false, error: String(err?.message ?? err) });
		}
		if (action !== "state") setTimeout(() => pushState(peer), 250); // let the change land, then mirror it
	}

	// Host: send the current state to one phone (or all).
	function pushState(peer) {
		if (role !== "host") return;
		let state;
		try {
			state = control.snapshot ? control.snapshot() : null;
		} catch (err) {
			log(`remote: snapshot failed: ${err.message}`);
			return;
		}
		const targets = peer ? [peer] : [...peers.values()];
		for (const p of targets) sendTo(p, "state", { state });
	}

	// --- transport --------------------------------------------------------

	function attach(link) {
		links.push(link);
		link.on("message", (topic, buf) => {
			const fid = topics.get(topic);
			if (fid) {
				const peer = peers.get(fid);
				if (peer) onPeerMessage(peer, open(peer.key, buf));
				return;
			}
			if (pairing && topic === pairing.topic) onPairMessage(open(pairing.key, buf));
		});
		for (const p of peers.values()) link.subscribe(p.topic);
		if (pairing) link.subscribe(pairing.topic);
	}
	// Add another transport (e.g. a LAN link) after construction. Same interface as the relay link.
	function addLink(link) { attach(link); }

	attach(createRelayLink({ relays, connect, log }));

	// --- pairing ----------------------------------------------------------

	// Host: begin pairing. Returns the payload to put in a QR. Resolves true once a phone pairs.
	function startPairing() {
		if (role !== "host") throw new Error("only the PC starts pairing");
		stopPairing();
		const code = makeCode();
		const { key, topic } = pairChannel(code);
		pairing = { code, key, topic, expiresAt: now() + PAIR_TTL_MS, timer: setTimeout(() => { stopPairing(); ev.emit("pair-timeout"); }, PAIR_TTL_MS) };
		for (const l of links) l.subscribe(topic);
		ev.emit("pairing", pairingPayload());
		return pairingPayload();
	}
	// The phone can either scan the whole payload (QR) or just type `code`; both derive the same
	// pairing channel. `code` is what the PC shows for typing.
	function pairingPayload() {
		return { v: 1, role: "mercify-remote", pub: identity.pub, code: pairing.code, name: myName, expiresAt: pairing.expiresAt };
	}
	function stopPairing() {
		if (!pairing) return;
		clearTimeout(pairing.timer);
		for (const l of links) l.unsubscribe(pairing.topic);
		pairing = null;
	}

	// Host: a hello arrived on the pairing channel. Only a phone that scanned the QR can seal it.
	function onPairMessage(msg) {
		if (!msg || msg.ty !== "hello" || typeof msg.pub !== "string") return;
		if (peers.size >= MAX_DEVICES) { log("remote: too many paired devices"); return; }
		const peer = addPeer(msg.pub, msg.name, now());
		if (!peer) return;
		save();
		// Confirm on the pairing channel so the phone learns our key, then start mirroring state.
		const buf = seal(pairing.key, { f: myFid, b: boot, n: ++seq, ty: "paired", pub: identity.pub, name: myName, t: now() });
		for (const l of links) l.publish(pairing.topic, buf);
		stopPairing();
		ev.emit("paired", peerView(peer));
		ev.emit("peer", view());
		pushState(peer);
	}

	// Device (phone): pair with the PC, using either a typed code (a string) or a scanned QR
	// payload (an object with { code, pub }). Both derive the same pairing channel from the code;
	// with a scanned payload we also check the reply came from the expected PC. Resolves to the
	// paired PC, or rejects.
	function pair(codeOrPayload, { timeoutMs = 20000 } = {}) {
		if (role !== "device") throw new Error("only the phone pairs");
		const payload = typeof codeOrPayload === "string" ? { code: codeOrPayload } : codeOrPayload || {};
		const code = cleanCode(payload.code);
		const expectPub = typeof payload.pub === "string" ? payload.pub : null; // QR only
		if (code.length < 8) return Promise.reject(new Error("that doesn't look like a pairing code"));
		const { key, topic } = pairChannel(code);
		return new Promise((resolve, reject) => {
			let done = false;
			const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); for (const l of links) { l.unsubscribe(topic); l.off?.("message", handler); } fn(arg); };
			const timer = setTimeout(() => finish(reject, new Error("the PC didn't answer — check the code, and that Mercify on the PC is showing it")), timeoutMs);
			const handler = (t, buf) => {
				if (t !== topic) return;
				const msg = open(key, buf); // only someone who knows the code can seal this
				if (!msg || msg.ty !== "paired" || typeof msg.pub !== "string") return;
				if (expectPub && msg.pub !== expectPub) return; // scanned a QR: must be that PC
				const peer = addPeer(msg.pub, payload.name || msg.name, now());
				save();
				finish(resolve, peer ? peerView(peer) : null);
				if (peer) { sendTo(peer, "hello", {}); ev.emit("peer", view()); } // nudge the PC to send state
			};
			for (const l of links) { l.subscribe(topic); l.on("message", handler); }
			// Say hello on the pairing channel, sealed with the code key → proves we know the code.
			const buf = seal(key, { f: myFid, b: boot, n: ++seq, ty: "hello", pub: identity.pub, name: myName, t: now() });
			for (const l of links) l.publish(topic, buf);
		});
	}

	// --- device-side command sending -------------------------------------

	let cmdId = 0;
	const pending = new Map(); // id -> { resolve, reject, timer } : request()s awaiting the PC's ack
	function send(action, args = {}) {
		if (role !== "device") throw new Error("only the phone sends commands");
		const id = ++cmdId;
		for (const p of peers.values()) sendTo(p, "cmd", { id, action, args });
		return id;
	}

	// Like send(), but returns a Promise that resolves with the PC's reply data (e.g. search
	// results, playlists). Rejects on error or if no paired PC answers in time.
	function request(action, args = {}, timeoutMs = 12000) {
		if (role !== "device") throw new Error("only the phone sends commands");
		const first = [...peers.values()][0];
		if (!first) return Promise.reject(new Error("not paired with a PC"));
		const id = ++cmdId;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error("the PC didn't answer"));
			}, timeoutMs);
			pending.set(id, { resolve, reject, timer });
			sendTo(first, "cmd", { id, action, args });
		});
	}

	// Send an opaque signalling payload to one paired peer (by fid) or all of them. Used by the
	// WebRTC audio layer on both sides; remote.js just relays it on the encrypted channel.
	function sendSignal(fidOrNull, kind, data) {
		const targets = fidOrNull ? [peers.get(fidOrNull)].filter(Boolean) : [...peers.values()];
		for (const p of targets) sendTo(p, "signal", { kind, data });
	}

	// --- housekeeping -----------------------------------------------------

	const beat = setInterval(() => {
		if (role === "host") pushState();
		for (const p of peers.values()) {
			if (p.online && now() - p.lastSeen > OFFLINE_MS) { p.online = false; ev.emit("peer", view()); }
		}
	}, HEARTBEAT_MS);
	if (beat.unref) beat.unref();

	function forget(fid, tell = true) {
		const peer = peers.get(fid);
		if (!peer) return;
		if (tell) sendTo(peer, "bye", {});
		for (const l of links) l.unsubscribe(peer.topic);
		topics.delete(peer.topic);
		peers.delete(fid);
		save();
		ev.emit("peer", view());
	}

	function peerView(p) {
		return { fid: p.fid, name: p.name, addedAt: p.addedAt, online: !!p.online && now() - p.lastSeen < OFFLINE_MS, lastSeen: p.lastSeen || null };
	}
	function view() {
		return { fid: myFid, pub: identity.pub, name: myName, peers: [...peers.values()].map(peerView) };
	}

	function setName(n) {
		myName = cleanName(n);
		if (role === "host") pushState();
	}

	function close() {
		clearInterval(beat);
		stopPairing();
		for (const l of links) l.close?.();
	}

	return {
		fid: myFid,
		pub: identity.pub,
		role,
		// host
		startPairing,
		stopPairing,
		pushState: () => pushState(),
		// device
		pair,
		send,
		request,
		// both (WebRTC audio signalling)
		sendSignal,
		// both
		devices: () => view().peers,
		view,
		forget,
		setName,
		addLink,
		close,
		on: (e, fn) => ev.on(e, fn),
		off: (e, fn) => ev.off(e, fn),
	};
}

module.exports = { createRemote, createRelayLink, fidOf, cleanName, makeCode, cleanCode, BRIDGE_ACTIONS, LOBBY_ACTIONS, URI_RE, SPKI_X25519, _seal: seal, _open: open };
