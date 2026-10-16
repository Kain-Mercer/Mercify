// Remote end-to-end test: a PC ("host") and a phone ("device") pair over a QR and then talk, all
// through a real MQTT-over-WebSocket broker on this machine. No Electron, no Spotify — the host's
// playerCommand() is stood in for by a fake that records what it was told and answers "state".
//
//   node tools/remote-test.js
//
// Checks:
//   - pairing: the phone, given only the QR payload, ends up sharing a channel with the PC
//   - commands: a phone command reaches the PC's command() with cleaned args, and is acked
//   - a bad action and a bad uri are refused, and never reach command()
//   - state: the PC's state changes show up on the phone
//   - privacy: an eavesdropper on the whole mercify/# namespace sees no plaintext (no song ids,
//     no action names, no the pairing nonce)
//   - revoke: after the PC forgets the phone, further commands don't land

const path = require("path");
const crypto = require("crypto");
const aedesMod = require("aedes");
const { WebSocketServer, createWebSocketStream } = require("ws");
const mqtt = require("mqtt");
const { createRemote } = require("../remote");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  (" + detail + ")" : ""}`);
	if (!ok) failures++;
}

(async () => {
	// --- a real broker on localhost ---
	const aedes = typeof aedesMod.createBroker === "function" ? await aedesMod.createBroker() : aedesMod();
	const wss = new WebSocketServer({ port: 0, path: "/mqtt" });
	await new Promise((r) => wss.on("listening", r));
	const PORT = wss.address().port;
	wss.on("connection", (ws) => aedes.handle(createWebSocketStream(ws)));
	const RELAY = `ws://127.0.0.1:${PORT}/mqtt`;
	console.log("broker:", RELAY, "\n");

	// --- eavesdropper on the whole namespace ---
	const sniffed = [];
	const spy = mqtt.connect(RELAY, { clientId: "spy_" + crypto.randomBytes(4).toString("hex") });
	spy.on("connect", () => spy.subscribe("mercify/#"));
	spy.on("message", (t, b) => sniffed.push({ t, b: Buffer.from(b) }));
	await sleep(300);

	// --- the PC (host): a fake player that records commands and answers "state" ---
	const seenCmds = [];
	let playing = false;
	const player = {
		command: async (action, args) => {
			seenCmds.push({ action, args });
			if (action === "togglePlay") playing = !playing;
			if (action === "state") return snapshot();
			return null;
		},
		joinLobby: async (code) => seenCmds.push({ action: "joinLobby", args: { code } }),
	};
	let songName = "Blue Monday";
	const snapshot = () => ({ player: { uri: "spotify:track:aaaaaaaaaaaaaaaaaaaaaa", name: songName, isPlaying: playing, position: 1000 }, lobby: null });

	const hostStore = memStore();
	const host = createRemote({ role: "host", store: hostStore, relays: [RELAY], connect: mqtt.connect, name: "Kain's PC", control: { command: player.command, snapshot, joinLobby: player.joinLobby } });

	// --- the phone (device) ---
	const phoneStore = memStore();
	const lastState = { v: null };
	const phone = createRemote({ role: "device", store: phoneStore, relays: [RELAY], connect: mqtt.connect, name: "Kain's phone" });
	phone.on("state", (s) => (lastState.v = s));

	await sleep(600); // let both connect to the broker

	// --- 1. pairing (scan a QR payload: carries the code + the PC's key) ---
	const qr = host.startPairing();
	check("pairing payload looks right", qr && qr.role === "mercify-remote" && typeof qr.pub === "string" && typeof qr.code === "string" && qr.code.length >= 8);
	const paired = await phone.pair(qr, { timeoutMs: 8000 }).catch((e) => ({ error: e.message }));
	check("phone pairs from the QR payload", paired && !paired.error, paired && paired.error ? paired.error : `paired with ${paired && paired.name}`);
	check("PC now lists one device", host.devices().length === 1, `${host.devices().length} device(s)`);
	check("phone now lists the PC", phone.devices().length === 1);

	await sleep(400);
	check("phone got an initial state on pairing", lastState.v && lastState.v.player && lastState.v.player.name === "Blue Monday", lastState.v ? "got it" : "none");

	// --- 1b. a second phone pairs by TYPING the code only (no QR, no PC key up front) ---
	const phone2 = createRemote({ role: "device", store: memStore(), relays: [RELAY], connect: mqtt.connect, name: "spare phone" });
	let lastState2 = null;
	phone2.on("state", (s) => (lastState2 = s));
	const qr2 = host.startPairing();
	const typed = await phone2.pair(qr2.code, { timeoutMs: 8000 }).catch((e) => ({ error: e.message })); // string = typed code
	check("a second phone pairs by typing the code alone", typed && !typed.error, typed && typed.error ? typed.error : `paired with ${typed && typed.name}`);
	check("PC now lists two devices", host.devices().length === 2, `${host.devices().length}`);
	await sleep(300);
	check("typed-code phone also gets state", lastState2 && lastState2.player && lastState2.player.name === "Blue Monday");
	phone2.close();

	// --- 2. a good command round-trips and is applied ---
	seenCmds.length = 0;
	phone.send("togglePlay");
	await sleep(500);
	check("togglePlay reached the PC's command()", seenCmds.some((c) => c.action === "togglePlay"));
	check("phone sees isPlaying flip to true", lastState.v && lastState.v.player.isPlaying === true, `isPlaying=${lastState.v && lastState.v.player.isPlaying}`);

	// --- 3. args are cleaned; good uri passes ---
	seenCmds.length = 0;
	phone.send("playTrack", { uri: "spotify:track:bbbbbbbbbbbbbbbbbbbbbb", level: 5, junk: "<script>" });
	await sleep(400);
	const pt = seenCmds.find((c) => c.action === "playTrack");
	check("playTrack with a valid uri reached command()", !!pt);
	check("unknown arg 'junk' was stripped", pt && !("junk" in pt.args));
	check("level was clamped into 0..1", pt && pt.args.level === 1, pt && `level=${pt.args.level}`);

	// --- 4. a bad action and a bad uri are refused and never reach command() ---
	seenCmds.length = 0;
	phone.send("rm_rf_everything", {});
	phone.send("playTrack", { uri: "javascript:alert(1)" });
	phone.send("playTrack", { uri: "spotify:track:" + "x".repeat(200) });
	await sleep(400);
	check("disallowed action never reached command()", !seenCmds.some((c) => c.action === "rm_rf_everything"));
	check("bad uris never reached command()", !seenCmds.some((c) => c.action === "playTrack"), `${seenCmds.length} slipped through`);

	// --- 5. a lobby action is handled by the host ---
	seenCmds.length = 0;
	phone.send("joinLobby", { code: "WXYZ-2345" });
	await sleep(400);
	check("joinLobby reached the host", seenCmds.some((c) => c.action === "joinLobby" && c.args.code === "WXYZ-2345"));

	// --- 6. a host-side state change pushes to the phone ---
	songName = "Temptation";
	host.pushState();
	await sleep(400);
	check("phone sees the new song", lastState.v && lastState.v.player.name === "Temptation", lastState.v && lastState.v.player.name);

	// --- 7. privacy: the eavesdropper saw only ciphertext ---
	const blob = Buffer.concat(sniffed.map((s) => s.b)).toString("latin1");
	const leaked = ["togglePlay", "playTrack", "Blue Monday", "Temptation", "WXYZ-2345", qr.code, qr2.code, "spotify:track:aaaa"].filter((s) => blob.includes(s));
	check("eavesdropper saw no plaintext", leaked.length === 0, leaked.length ? "leaked: " + leaked.join(", ") : `${sniffed.length} frames, all sealed`);
	check("topics are opaque hashes", sniffed.every((s) => /^mercify\/v1\/[0-9a-f]{32}$/.test(s.t)), sniffed[0] && sniffed[0].t);

	// --- 8. revoke ---
	host.forget(phone.fid);
	await sleep(300);
	seenCmds.length = 0;
	phone.send("togglePlay");
	await sleep(500);
	check("after revoke, commands don't land", !seenCmds.some((c) => c.action === "togglePlay"));

	// --- done ---
	host.close(); phone.close(); spy.end(true);
	await new Promise((r) => { try { aedes.close(() => wss.close(r)); } catch (_) { wss.close(r); } });
	console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
	process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

function memStore() {
	let data = null;
	return { load: () => data, save: (d) => (data = d) };
}
