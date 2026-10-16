// Phone/PC compatibility test for mobile/src/node-crypto.js:
//
//   node mobile/test/crypto-compat-test.js
//
// 1. Every function the shim provides gives the same bytes as Node's crypto, both ways round.
// 2. A "PC" (overlay/lobby.js + friends.js with Node's crypto) and a "phone" (the same two files,
//    loaded a second time with the shim in place of crypto, as Metro does on the phone) share a
//    lobby through in-memory relays: they see each other, the phone follows the PC's song, the
//    phone's suggestion reaches the PC's session playlist, and they become friends.

const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const { EventEmitter } = require("events");
const nodeCrypto = require("crypto");

const ROOT = path.resolve(__dirname, "../..");
const SHIM = path.join(ROOT, "mobile/src/node-crypto.js");
const shim = require(SHIM);

let failures = 0;
function check(label, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  (" + detail + ")" : ""}`);
	if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (fn()) return true;
		await sleep(25);
	}
	return !!fn();
}
const scryptP = (c, ...a) => new Promise((res, rej) => c.scrypt(...a, (e, k) => (e ? rej(e) : res(k))));

function seal(c, key, obj) {
	const iv = c.randomBytes(12);
	const cipher = c.createCipheriv("aes-256-gcm", key, iv);
	const ct = Buffer.concat([cipher.update(JSON.stringify(obj), "utf8"), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}
function open(c, key, buf) {
	try {
		const d = c.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
		d.setAuthTag(buf.subarray(12, 28));
		return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
	} catch (_) {
		return null;
	}
}

// ---------------------------------------------------------------- stand-in MQTT relays (as in friends-test.js)

const RELAYS = ["wss://relay-a.test/mqtt", "wss://relay-b.test/mqtt"];
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
		for (const s of subs.get(topic) || []) setTimeout(() => s.connected && s.emit("message", topic, Buffer.from(buf)), 5 + Math.random() * 20);
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

// ---------------------------------------------------------------- a second copy of lobby.js/friends.js using the shim

function loadPhoneCopy() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mercify-phone-"));
	for (const f of ["lobby.js", "friends.js"]) fs.copyFileSync(path.join(ROOT, "overlay", f), path.join(dir, f));
	const resolve = Module._resolveFilename;
	Module._resolveFilename = function (request, parent, ...rest) {
		const from = parent && parent.filename;
		if (from && from.startsWith(dir) && request === "crypto") return SHIM;
		// both copies use mobile's mqtt, so the test runs without overlay's node_modules
		if (from && (from.startsWith(dir) || from.startsWith(path.join(ROOT, "overlay"))) && request === "mqtt") return require.resolve("mqtt", { paths: [path.join(ROOT, "mobile")] });
		return resolve.call(this, request, parent, ...rest);
	};
	return { lobby: require(path.join(dir, "lobby.js")), friends: require(path.join(dir, "friends.js")) };
}

function install(name, mods) {
	const player = { uri: null, isPlaying: false, commands: [] };
	let lobby; // eslint-disable-line prefer-const
	let data = null;
	const friends = mods.friends.createFriends({
		store: { load: () => data, save: (d) => (data = JSON.parse(JSON.stringify(d))) },
		relays: RELAYS,
		connect: fakeConnect,
		lobbyCode: async () => lobby.state().code,
	});
	lobby = mods.lobby.createLobby({
		command: async (action, args) => {
			player.commands.push(action);
			if (action === "playTrack") Object.assign(player, { uri: args.uri, isPlaying: true });
		},
		relays: RELAYS,
		connect: fakeConnect,
		friendPub: friends.pub,
		connectTimeoutMs: 2000,
	});
	lobby.setName(name);
	friends.setName(name);
	lobby.on("friend", ({ ty, memberId, name: n, fpub }) => {
		if (ty === "friend-add") friends.receiveAdd({ pub: fpub, name: n }, (type) => lobby.friendSend(memberId, type));
		else friends.receiveAddReply({ pub: fpub, name: n }, ty === "friend-ok");
	});
	friends.on("add-request", ({ fid }) => friends.acceptAdd(fid));
	friends.start();
	return { name, lobby, friends, player };
}

(async () => {
	// ---------------------------------------------------------------- 1. primitives
	const code = "BA781XDC";
	const kNode = await scryptP(nodeCrypto, code, "mercify-lobby-v1", 32, { N: 16384, r: 8, p: 1 });
	const kShim = await scryptP(shim, code, "mercify-lobby-v1", 32, { N: 16384, r: 8, p: 1 });
	check("scrypt lobby key matches Node", kNode.equals(kShim));

	const h = (c) => c.createHash("sha256").update("mercify-topic-v1:").update(Buffer.from(code)).digest("hex");
	check("sha256 matches Node", h(nodeCrypto) === h(shim) && shim.createHash("sha256").update("x").digest().equals(nodeCrypto.createHash("sha256").update("x").digest()));

	const msg = { ty: "state", uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", name: "Ünïcode ♫", position: 42000 };
	check("PC seals, phone opens", JSON.stringify(open(shim, kShim, seal(nodeCrypto, kNode, msg))) === JSON.stringify(msg));
	check("phone seals, PC opens", JSON.stringify(open(nodeCrypto, kNode, seal(shim, kShim, msg))) === JSON.stringify(msg));
	const bad = seal(shim, kShim, msg);
	bad[bad.length - 1] ^= 1;
	check("tampered message is rejected by both", open(shim, kShim, bad) === null && open(nodeCrypto, kNode, bad) === null);
	check("wrong code is rejected", open(shim, Buffer.alloc(32, 7), seal(nodeCrypto, kNode, msg)) === null);

	const pc = nodeCrypto.generateKeyPairSync("x25519");
	const ph = shim.generateKeyPairSync("x25519");
	const pcPriv = pc.privateKey.export({ type: "pkcs8", format: "der" });
	const phPriv = ph.privateKey.export({ type: "pkcs8", format: "der" });
	const pcPub = pc.publicKey.export({ type: "spki", format: "der" });
	const phPub = ph.publicKey.export({ type: "spki", format: "der" });
	check("PC's saved key loads in the shim", shim.createPublicKey(shim.createPrivateKey({ key: pcPriv, format: "der", type: "pkcs8" })).export({ type: "spki", format: "der" }).equals(pcPub));
	check("phone's saved key loads in Node", nodeCrypto.createPublicKey(nodeCrypto.createPrivateKey({ key: phPriv, format: "der", type: "pkcs8" })).export({ type: "spki", format: "der" }).equals(phPub));
	const s1 = nodeCrypto.diffieHellman({ privateKey: pc.privateKey, publicKey: nodeCrypto.createPublicKey({ key: phPub, format: "der", type: "spki" }) });
	const s2 = shim.diffieHellman({ privateKey: ph.privateKey, publicKey: shim.createPublicKey({ key: pcPub, format: "der", type: "spki" }) });
	check("X25519 shared secret matches", s1.equals(s2));
	const hk = (c, s) => Buffer.from(c.hkdfSync("sha256", s, "mercify-friend-v1", "key:a:b", 32));
	check("HKDF matches Node", hk(nodeCrypto, s1).equals(hk(shim, s2)) && shim.hkdfSync("sha256", s2, "s", "i", 16) instanceof ArrayBuffer);

	// ---------------------------------------------------------------- 2. a PC and a phone in one lobby
	const phoneMods = loadPhoneCopy();
	const pcMods = { lobby: require(path.join(ROOT, "overlay/lobby.js")), friends: require(path.join(ROOT, "overlay/friends.js")) };
	check("phone copy really uses the shim", phoneMods.lobby !== pcMods.lobby);

	const kain = install("Kain", pcMods);
	const phone = install("Phone", phoneMods);
	const lobbyCode = pcMods.lobby.formatCode(pcMods.lobby.generateCode());
	await kain.lobby.join(lobbyCode);
	await phone.lobby.join(lobbyCode);
	check("phone joins the PC's lobby", await until(() => phone.lobby.state().members?.length === 2 && kain.lobby.state().members?.length === 2));
	check("PC is host, phone is listener", kain.lobby.state().role === "host" && phone.lobby.state().role === "listener");

	const song = { uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", name: "Song", artists: ["Artist"], image: null, duration: 200000, position: 10000, isPlaying: true, at: Date.now() };
	kain.lobby.onPlayerState(song);
	check("phone is told to play the PC's song", await until(() => phone.player.uri === song.uri));

	phone.lobby.queueAdd({ uri: "spotify:track:0VjIjW4GlUZAMYd2vXMi3b", name: "Suggested", artists: ["Someone"], duration: 180000 });
	check("phone's suggestion reaches the PC's session playlist", await until(() => (kain.lobby.state().queue || []).some((q) => q.uri === "spotify:track:0VjIjW4GlUZAMYd2vXMi3b" && q.by === "Phone")));

	const m = kain.lobby.state().members.find((x) => x.name === "Phone");
	check("phone's friend id is visible to the PC", !!m && m.fid === phone.friends.fid);
	const mem = kain.lobby.member(m.id);
	const r = kain.friends.startAdd({ pub: mem.fpub, name: mem.name });
	if (r !== "accepted") kain.lobby.friendSend(m.id, "friend-add");
	check("PC and phone become friends", await until(() => kain.friends.state().friends.some((f) => f.fid === phone.friends.fid) && phone.friends.state().friends.some((f) => f.fid === kain.friends.fid)));

	console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
	process.exit(failures ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
