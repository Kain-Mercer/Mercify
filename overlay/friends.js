// Friends: people you've met in a listening lobby, kept across sessions.
//
// How it works
// - Each Mercify install has a long-lived X25519 key pair (friends.json). Its "friend id" (fid) is
//   a hash of the public key. Lobby members tell each other their public key in their heartbeats,
//   so right-clicking someone in a lobby can send them a friend request (through the lobby).
// - Once two people are friends, each pair shares a private channel: the key and the relay topic
//   come from their X25519 shared secret, so only those two can read it (or even find it). It goes
//   through the same free public MQTT relays as lobbies, so there's still no Mercify server.
// - On that channel each side sends its presence (online, the song playing if you share it, whether
//   you're in a lobby) every 30 s and on every change, plus join requests: "Request to join" asks
//   the friend's Mercify; if they accept, it starts a lobby (or uses the one they're in) and sends
//   the code back, and the requester's Mercify joins it.
// - Removing a friend tells the other side, and both stop using the channel.
//
// This module has no Electron dependency so it can be tested on its own (tools/friends-test.js).

const crypto = require("crypto");
const { EventEmitter } = require("events");

const PRESENCE_MS = 30000; // "still here", with what's playing
const OFFLINE_MS = 75000; // nothing heard in this long: offline
const PRESENCE_DEBOUNCE_MS = 1200; // song changes come in bursts
const JOIN_TIMEOUT_MS = 60000; // a join request nobody answers expires
const JOIN_COOLDOWN_MS = 15000; // after an answer, before asking the same friend again
const ADD_TIMEOUT_MS = 10 * 60000; // a friend request you sent waits this long for an answer
const MAX_FRIENDS = 100;
const MAX_INCOMING_ADDS = 5;
const OUTBOX_MAX = 50;
const OUTBOX_TTL_MS = 120000;

// X25519 public keys as SPKI DER: this fixed prefix, then the 32 raw bytes.
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");

function cleanName(s) {
	return String(s || "")
		.replace(/[\u0000-\u001f]/g, "")
		.trim()
		.slice(0, 24);
}

function rawPub(b64) {
	if (typeof b64 !== "string" || b64.length > 64) return null;
	const raw = Buffer.from(b64, "base64");
	return raw.length === 32 && raw.toString("base64") === b64 ? raw : null;
}

function fidOf(pubB64) {
	const raw = rawPub(pubB64);
	return raw ? crypto.createHash("sha256").update("mercify-fid-v1:").update(raw).digest("hex").slice(0, 16) : null;
}

function newIdentity() {
	const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
	return {
		pub: publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64"),
		priv: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
	};
}

function validIdentity(id) {
	try {
		if (!id || !rawPub(id.pub)) return false;
		const priv = crypto.createPrivateKey({ key: Buffer.from(id.priv, "base64"), format: "der", type: "pkcs8" });
		return crypto.createPublicKey(priv).export({ type: "spki", format: "der" }).subarray(-32).toString("base64") === id.pub;
	} catch (_) {
		return false;
	}
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
		return null;
	}
}

const URI_RE = /^spotify:(track|episode|local):[^\s]{1,200}$/;

// A friend's "listening to", from the network: keep only what we show, in safe shapes.
function cleanTrack(t) {
	if (!t || typeof t !== "object") return null;
	const name = String(t.name ?? "").slice(0, 200);
	if (!name) return null;
	return {
		name,
		artists: (Array.isArray(t.artists) ? t.artists : []).slice(0, 5).map((a) => String(a ?? "").slice(0, 100)),
		uri: typeof t.uri === "string" && URI_RE.test(t.uri) ? t.uri : null,
	};
}

/**
 * @param {object} opts
 * @param {{ load: () => any, save: (data: any) => void }} opts.store  where friends.json lives
 * @param {string[]} opts.relays  MQTT-over-WebSocket relays (the lobby's)
 * @param {(url: string, options: object) => any} [opts.connect]  mqtt.connect, or a stand-in for tests
 * @param {() => Promise<string>} opts.lobbyCode  accepting a join request: the code to send (starts a lobby if needed)
 */
function createFriends({ store, relays, connect, lobbyCode, log = () => {}, connectTimeoutMs = 8000 }) {
	const ev = new EventEmitter();
	connect = connect || require("mqtt").connect;

	// ---------------------------------------------------------------- identity + saved friends

	const saved = store.load() || {};
	let identity = validIdentity(saved.identity) ? saved.identity : newIdentity();
	const privateKey = crypto.createPrivateKey({ key: Buffer.from(identity.priv, "base64"), format: "der", type: "pkcs8" });
	const myFid = fidOf(identity.pub);
	const boot = crypto.randomBytes(4).toString("hex"); // tells this run's messages apart from the last one's
	let seq = 0;

	const friends = new Map(); // fid -> friend
	const topics = new Map(); // relay topic -> fid (friends and people we've sent a request to)
	const pendingAdds = new Map(); // fid -> { fid, pub, name, at, chan } : friend requests we sent
	const incomingAdds = new Map(); // fid -> { fid, pub, name, at, reply } : friend requests to answer
	const seen = new Set();
	const seenOrder = [];
	let outbox = []; // sent while no relay was connected: { topic, buf, at }

	let name = "";
	let share = true; // show friends what I'm listening to
	let allowJoin = true; // friends may ask to join
	let presence = { track: null, playing: false, inLobby: false, host: false };

	function channel(pubB64) {
		const fid = fidOf(pubB64);
		const shared = crypto.diffieHellman({ privateKey, publicKey: crypto.createPublicKey({ key: Buffer.concat([SPKI_X25519, rawPub(pubB64)]), format: "der", type: "spki" }) });
		const ids = [myFid, fid].sort().join(":");
		const derive = (what, n) => Buffer.from(crypto.hkdfSync("sha256", shared, "mercify-friend-v1", `${what}:${ids}`, n));
		return { key: derive("key", 32), topic: "mercify/v1/" + derive("topic", 16).toString("hex") };
	}

	function makeFriend(f) {
		const fid = fidOf(f.pub);
		if (!fid || fid === myFid) return null;
		const { key, topic } = channel(f.pub);
		return {
			fid,
			pub: f.pub,
			name: cleanName(f.name) || "Friend",
			addedAt: Number(f.addedAt) || Date.now(),
			key,
			topic,
			lastSeen: 0,
			online: false,
			p: null, // their last presence
			outJoin: null, // { rid, at, timer } : we asked to join them
			inJoin: null, // { rid, at, timer } : they asked to join us
			cooldownUntil: 0,
		};
	}

	for (const f of Array.isArray(saved.friends) ? saved.friends.slice(0, MAX_FRIENDS) : []) {
		const fr = makeFriend(f);
		if (fr && !friends.has(fr.fid)) {
			friends.set(fr.fid, fr);
			topics.set(fr.topic, fr.fid);
		}
	}

	function save() {
		try {
			store.save({ v: 1, identity, friends: [...friends.values()].map((f) => ({ fid: f.fid, pub: f.pub, name: f.name, addedAt: f.addedAt })) });
		} catch (err) {
			log(`friends: couldn't save: ${err.message}`);
		}
	}
	if (!validIdentity(saved.identity)) save();

	// ---------------------------------------------------------------- state for the UI

	const isOnline = (f) => f.lastSeen > 0 && Date.now() - f.lastSeen < OFFLINE_MS && f.online;

	function friendView(f) {
		const p = f.p || {};
		const online = isOnline(f);
		return {
			fid: f.fid,
			name: f.name,
			online,
			lastSeen: f.lastSeen || null,
			shared: online && !!p.share,
			track: online && p.share ? p.track : null,
			playing: online && !!p.playing,
			inLobby: online && !!p.lobby,
			host: online && !!p.host,
			joinable: online && !!p.join,
			requested: !!f.outJoin,
			cooldown: f.cooldownUntil > Date.now(),
		};
	}

	function snapshot() {
		const list = [...friends.values()].map(friendView);
		const rank = (f) => (f.online ? (f.track && f.playing ? 0 : 1) : 2);
		list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
		const requests = [
			...[...friends.values()].filter((f) => f.inJoin).map((f) => ({ kind: "join", fid: f.fid, name: f.name, at: f.inJoin.at })),
			...[...incomingAdds.values()].map((a) => ({ kind: "add", fid: a.fid, name: a.name, at: a.at })),
		];
		return {
			fid: myFid,
			pub: identity.pub,
			friends: list,
			requests,
			pendingAdds: [...pendingAdds.keys()],
			relays: { connected: clients.filter((c) => c.connected).length, total: clients.length },
			share,
			allowJoin,
		};
	}

	let changeTimer = null;
	const changed = () => {
		clearTimeout(changeTimer);
		changeTimer = setTimeout(() => ev.emit("change", snapshot()), 30);
	};
	const toast = (text) => ev.emit("toast", text);

	// ---------------------------------------------------------------- relays

	let clients = [];
	let announceTimer = null;

	function wanted() {
		return friends.size > 0 || pendingAdds.size > 0;
	}

	function connectAll() {
		if (clients.length) return;
		clients = relays.map((url) => {
			const c = connect(url, {
				clientId: "mercify_" + crypto.randomBytes(6).toString("hex"),
				clean: true,
				keepalive: 30,
				connectTimeout: connectTimeoutMs,
				reconnectPeriod: 5000,
				protocolVersion: 4,
			});
			c.on("connect", () => {
				const all = [...topics.keys()];
				if (all.length) c.subscribe(all, { qos: 0 });
				flushOutbox();
				// back online (or for the first time): tell everyone, and ask how they are
				// (once, however many relays connect around the same time)
				clearTimeout(announceTimer);
				announceTimer = setTimeout(() => sendPresenceAll(true), 400);
				changed();
			});
			c.on("message", receive);
			c.on("close", changed);
			c.on("error", (err) => log(`friends relay ${url}: ${err.message}`));
			return c;
		});
		changed();
	}

	function disconnectAll() {
		const old = clients;
		clients = [];
		old.forEach((c) => c.end(true));
		changed();
	}

	function syncConnection() {
		if (wanted() && !stopped) connectAll();
		else if (!wanted() && clients.length) disconnectAll();
	}

	function subscribe(topic) {
		for (const c of clients) if (c.connected) c.subscribe(topic, { qos: 0 });
	}

	function unsubscribe(topic) {
		for (const c of clients) if (c.connected) c.unsubscribe(topic);
	}

	function publish(topic, buf) {
		const live = clients.filter((c) => c.connected);
		if (!live.length) {
			outbox.push({ topic, buf, at: Date.now() });
			if (outbox.length > OUTBOX_MAX) outbox.shift();
			return;
		}
		for (const c of live) c.publish(topic, buf, { qos: 0, retain: false });
	}

	function flushOutbox() {
		const now = Date.now();
		const due = outbox.filter((m) => now - m.at < OUTBOX_TTL_MS && topics.has(m.topic));
		outbox = [];
		for (const m of due) publish(m.topic, m.buf);
	}

	// One message to one friend (or someone we've asked to be friends with).
	function sendTo(chan, ty, fields = {}) {
		publish(chan.topic, seal(chan.key, { f: myFid, b: boot, n: ++seq, ty, t: Date.now(), ...fields }));
	}

	function receive(topic, buf) {
		const fid = topics.get(topic);
		if (!fid) return;
		const f = friends.get(fid);
		const pend = !f && pendingAdds.get(fid);
		const chan = f || pend?.chan;
		if (!chan) return;
		const msg = open(chan.key, buf);
		if (!msg || msg.f !== fid) return; // not readable, or our own message coming back
		const dedupe = `${msg.b}:${msg.n}`;
		if (seen.has(dedupe)) return; // the same message through another relay
		seen.add(dedupe);
		seenOrder.push(dedupe);
		if (seenOrder.length > 2000) seen.delete(seenOrder.shift());
		try {
			if (f) handle(f, msg);
			else if (msg.ty === "ok") addFriend({ pub: pend.pub, name: msg.name || pend.name });
		} catch (err) {
			log(`friends: bad message: ${err.message}`);
		}
	}

	function handle(f, msg) {
		switch (msg.ty) {
			case "p": {
				const wasOnline = isOnline(f);
				f.online = true;
				f.lastSeen = Date.now();
				const nm = cleanName(msg.name);
				if (nm && nm !== f.name) {
					f.name = nm;
					save();
				}
				f.p = { share: !!msg.share, track: msg.share ? cleanTrack(msg.track) : null, playing: !!msg.playing, lobby: !!msg.lobby, host: !!msg.host, join: !!msg.join };
				if (msg.ask) sendPresence(f); // they just came online: tell them how we are
				if (!wasOnline) log(`friends: ${f.name} is online`);
				changed();
				break;
			}
			case "off":
				f.online = false;
				changed();
				break;
			case "ok": // they accepted our request again (we were already friends): nothing to do
				f.lastSeen = Date.now();
				break;
			case "jreq": {
				f.lastSeen = Date.now();
				const rid = typeof msg.rid === "string" ? msg.rid.slice(0, 32) : null;
				if (!rid) return;
				if (!allowJoin) return sendTo(f, "jno", { rid, why: "off" });
				if (f.inJoin) clearTimeout(f.inJoin.timer);
				f.inJoin = {
					rid,
					at: Date.now(),
					timer: setTimeout(() => {
						if (f.inJoin?.rid !== rid) return;
						f.inJoin = null;
						sendTo(f, "jno", { rid, why: "timeout" });
						ev.emit("join-request-ended", { fid: f.fid });
						changed();
					}, JOIN_TIMEOUT_MS),
				};
				ev.emit("join-request", { fid: f.fid, name: f.name });
				changed();
				break;
			}
			case "jok": {
				if (!f.outJoin || f.outJoin.rid !== msg.rid || typeof msg.code !== "string") return;
				clearTimeout(f.outJoin.timer);
				f.outJoin = null;
				ev.emit("join", { fid: f.fid, name: f.name, code: msg.code.slice(0, 32) });
				changed();
				break;
			}
			case "jno": {
				if (!f.outJoin || f.outJoin.rid !== msg.rid) return;
				clearTimeout(f.outJoin.timer);
				f.outJoin = null;
				f.cooldownUntil = Date.now() + JOIN_COOLDOWN_MS;
				const why = { off: `${f.name} isn't taking join requests right now`, timeout: `${f.name} didn't answer your request to join`, error: `${f.name}'s Mercify couldn't start a lobby` }[msg.why] || `${f.name} declined your request to join`;
				toast(why);
				changed();
				break;
			}
			case "jcancel": {
				if (!f.inJoin || f.inJoin.rid !== msg.rid) return;
				clearTimeout(f.inJoin.timer);
				f.inJoin = null;
				ev.emit("join-request-ended", { fid: f.fid });
				changed();
				break;
			}
			case "unf":
				dropFriend(f.fid);
				log(`friends: ${f.name} removed you`);
				break;
		}
	}

	// ---------------------------------------------------------------- presence

	function presenceFields(ask = false) {
		return {
			name,
			share,
			track: share ? presence.track : null,
			playing: !!presence.playing,
			lobby: !!presence.inLobby,
			host: !!presence.host,
			join: allowJoin,
			...(ask ? { ask: true } : {}),
		};
	}

	function sendPresence(f, ask = false) {
		sendTo(f, "p", presenceFields(ask));
	}

	function sendPresenceAll(ask = false) {
		for (const f of friends.values()) sendPresence(f, ask);
	}

	let presenceTimer = null;
	function presenceChanged() {
		clearTimeout(presenceTimer);
		presenceTimer = setTimeout(() => sendPresenceAll(), PRESENCE_DEBOUNCE_MS);
	}

	// ---------------------------------------------------------------- friends list

	function addFriend({ pub, name: nm }) {
		const fid = fidOf(pub);
		if (!fid || fid === myFid) return null;
		const pend = pendingAdds.get(fid);
		if (pend) {
			clearTimeout(pend.timer);
			pendingAdds.delete(fid);
		}
		incomingAdds.delete(fid);
		let f = friends.get(fid);
		if (!f) {
			if (friends.size >= MAX_FRIENDS) {
				toast(`You can have up to ${MAX_FRIENDS} friends. Remove one to add ${cleanName(nm) || "someone new"}.`);
				return null;
			}
			f = makeFriend({ pub, name: nm });
			friends.set(fid, f);
			topics.set(f.topic, fid);
			subscribe(f.topic);
			save();
			toast(`You and ${f.name} are now friends`);
		}
		syncConnection();
		sendPresence(f, true);
		changed();
		return f;
	}

	function dropFriend(fid) {
		const f = friends.get(fid);
		if (!f) return;
		clearTimeout(f.outJoin?.timer);
		clearTimeout(f.inJoin?.timer);
		if (f.inJoin) ev.emit("join-request-ended", { fid });
		friends.delete(fid);
		topics.delete(f.topic);
		unsubscribe(f.topic);
		save();
		syncConnection();
		changed();
	}

	// ---------------------------------------------------------------- public API

	// We right-clicked someone in a lobby and chose "Add friend". The lobby carries the request;
	// we listen on our would-be shared channel for their answer.
	function startAdd({ pub, name: nm }) {
		const fid = fidOf(pub);
		if (!fid) throw new Error("That person's Mercify is too old for friends");
		if (fid === myFid) throw new Error("That's you");
		if (friends.has(fid)) throw new Error(`${cleanName(nm) || "They"} is already your friend`);
		if (incomingAdds.has(fid)) {
			acceptAdd(fid); // they asked us first
			return "accepted";
		}
		if (pendingAdds.has(fid)) return "pending";
		if (friends.size >= MAX_FRIENDS) throw new Error(`You can have up to ${MAX_FRIENDS} friends`);
		const chan = channel(pub);
		const pend = {
			fid,
			pub,
			name: cleanName(nm) || "Someone",
			at: Date.now(),
			chan,
			timer: setTimeout(() => {
				if (!pendingAdds.has(fid)) return;
				pendingAdds.delete(fid);
				if (!friends.has(fid)) topics.delete(chan.topic), unsubscribe(chan.topic);
				syncConnection();
				changed();
			}, ADD_TIMEOUT_MS),
		};
		pendingAdds.set(fid, pend);
		topics.set(chan.topic, fid);
		syncConnection();
		subscribe(chan.topic);
		changed();
		return "sent";
	}

	// A friend request from someone in our lobby. `reply(type)` answers through the lobby.
	function receiveAdd({ pub, name: nm }, reply = () => {}) {
		const fid = fidOf(pub);
		if (!fid || fid === myFid) return;
		const f = friends.get(fid);
		if (f) {
			// they lost us (reinstalled, removed us before): just confirm
			reply("friend-ok");
			sendTo(f, "ok", { name });
			return;
		}
		if (pendingAdds.has(fid)) {
			// we both asked at the same time
			reply("friend-ok");
			const nf = addFriend({ pub, name: nm });
			if (nf) sendTo(nf, "ok", { name });
			return;
		}
		if (!incomingAdds.has(fid) && incomingAdds.size >= MAX_INCOMING_ADDS) return;
		incomingAdds.set(fid, { fid, pub, name: cleanName(nm) || "Someone", at: Date.now(), reply });
		ev.emit("add-request", { fid, name: cleanName(nm) || "Someone" });
		changed();
	}

	function acceptAdd(fid) {
		const a = incomingAdds.get(fid);
		if (!a) return false;
		incomingAdds.delete(fid);
		const f = addFriend({ pub: a.pub, name: a.name });
		if (!f) return false;
		try {
			a.reply("friend-ok");
		} catch (_) {}
		sendTo(f, "ok", { name }); // also on our own channel, in case they've left the lobby
		return true;
	}

	function declineAdd(fid) {
		const a = incomingAdds.get(fid);
		if (!a) return false;
		incomingAdds.delete(fid);
		try {
			a.reply("friend-no");
		} catch (_) {}
		changed();
		return true;
	}

	// Answers that came back through the lobby.
	function receiveAddReply({ pub, name: nm }, accepted) {
		const fid = fidOf(pub);
		const pend = fid && pendingAdds.get(fid);
		if (!pend) return;
		if (accepted) addFriend({ pub, name: nm || pend.name });
		else {
			clearTimeout(pend.timer);
			pendingAdds.delete(fid);
			topics.delete(pend.chan.topic);
			unsubscribe(pend.chan.topic);
			syncConnection();
			toast(`${pend.name} declined your friend request`);
			changed();
		}
	}

	function removeFriend(fid) {
		const f = friends.get(fid);
		if (!f) return false;
		sendTo(f, "unf");
		const name0 = f.name;
		// let the goodbye reach the relays before we stop listening on that channel
		setTimeout(() => dropFriend(fid), 300);
		toast(`Removed ${name0} from your friends`);
		return true;
	}

	function requestJoin(fid) {
		const f = friends.get(fid);
		if (!f) throw new Error("They're not on your friends list any more");
		if (!isOnline(f)) throw new Error(`${f.name} is offline`);
		if (!f.p?.join) throw new Error(`${f.name} isn't taking join requests right now`);
		if (f.outJoin) throw new Error(`You've already asked ${f.name}. Give them a moment.`);
		if (f.cooldownUntil > Date.now()) throw new Error(`Wait a few seconds before asking ${f.name} again`);
		const rid = crypto.randomBytes(8).toString("hex");
		f.outJoin = {
			rid,
			at: Date.now(),
			timer: setTimeout(() => {
				if (f.outJoin?.rid !== rid) return;
				f.outJoin = null;
				f.cooldownUntil = Date.now() + JOIN_COOLDOWN_MS;
				toast(`${f.name} didn't answer your request to join`);
				changed();
			}, JOIN_TIMEOUT_MS + 5000),
		};
		sendTo(f, "jreq", { rid });
		changed();
		return true;
	}

	function cancelJoin(fid) {
		const f = friends.get(fid);
		if (!f?.outJoin) return false;
		clearTimeout(f.outJoin.timer);
		sendTo(f, "jcancel", { rid: f.outJoin.rid });
		f.outJoin = null;
		changed();
		return true;
	}

	// Answer a friend's request to join. Accepting gets a lobby code (starting a lobby if we're
	// not in one) and sends it; their Mercify joins it.
	async function answerJoin(fid, accept) {
		const f = friends.get(fid);
		if (!f?.inJoin) return false;
		const { rid, timer } = f.inJoin;
		clearTimeout(timer);
		f.inJoin = null;
		changed();
		if (!accept) {
			sendTo(f, "jno", { rid, why: "declined" });
			return true;
		}
		try {
			const code = await lobbyCode();
			sendTo(f, "jok", { rid, code });
			return true;
		} catch (err) {
			sendTo(f, "jno", { rid, why: "error" });
			throw err;
		}
	}

	function setName(n) {
		const nm = cleanName(n);
		if (nm === name) return;
		name = nm;
		presenceChanged();
	}

	function setOptions(o = {}) {
		let diff = false;
		if (o.share !== undefined && !!o.share !== share) (share = !!o.share), (diff = true);
		if (o.allowJoin !== undefined && !!o.allowJoin !== allowJoin) (allowJoin = !!o.allowJoin), (diff = true);
		if (diff) {
			presenceChanged();
			changed();
		}
	}

	// What we're doing, from the app: { track: { uri, name, artists } | null, playing, inLobby, host }
	function setPresence(p = {}) {
		const next = {
			track: p.track ? cleanTrack(p.track) : null,
			playing: !!p.playing,
			inLobby: !!p.inLobby,
			host: !!p.host,
		};
		const same = JSON.stringify(next) === JSON.stringify(presence);
		presence = next;
		if (!same) presenceChanged();
	}

	// ---------------------------------------------------------------- timers

	let stopped = false;
	const heartbeat = setInterval(() => sendPresenceAll(), PRESENCE_MS);
	const offlineCheck = setInterval(() => {
		let any = false;
		for (const f of friends.values()) {
			if (f.online && Date.now() - f.lastSeen >= OFFLINE_MS) {
				f.online = false;
				any = true;
			}
		}
		if (any) changed();
	}, 5000);
	heartbeat.unref?.();
	offlineCheck.unref?.();

	function start() {
		stopped = false;
		syncConnection();
		changed();
	}

	// App shutdown: tell friends we're going (fire and forget).
	function stop() {
		for (const f of friends.values()) sendTo(f, "off");
		stopped = true;
		clearInterval(heartbeat);
		clearInterval(offlineCheck);
		setTimeout(disconnectAll, 150);
	}

	return {
		start,
		stop,
		fid: myFid,
		pub: identity.pub,
		state: snapshot,
		setName,
		setOptions,
		setPresence,
		startAdd,
		receiveAdd,
		acceptAdd,
		declineAdd,
		receiveAddReply,
		removeFriend,
		requestJoin,
		cancelJoin,
		answerJoin,
		isFriend: (fid) => friends.has(fid),
		on: (e, fn) => ev.on(e, fn),
	};
}

module.exports = { createFriends, fidOf, cleanName };
