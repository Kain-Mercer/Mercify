// End-to-end lobby test: three members in separate processes (clocks seconds apart), each with a
// fake Spotify player, talking through real MQTT relays.
//
//   LOBBY_RELAYS=ws://127.0.0.1:9001,ws://127.0.0.1:9002 node tools/lobby-test.js
//   (with no LOBBY_RELAYS it uses the real public relays)
//
// Set KILL_RELAY_CMD to a shell command that stops the first relay, to test losing a relay mid-session.

const { fork, execSync } = require("child_process");
const path = require("path");
const crypto = require("crypto");
const mqtt = require("mqtt");
const { generateCode, topicFor, DEFAULT_RELAYS } = require("../lobby");

const RELAYS = (process.env.LOBBY_RELAYS || DEFAULT_RELAYS.join(",")).split(",");
const CODE = generateCode();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function member(name, skew) {
	const child = fork(path.join(__dirname, "lobby-member.js"), [], { env: { ...process.env, CLOCK_SKEW_MS: String(skew), LOBBY_RELAYS: RELAYS.join(",") } });
	let n = 0;
	const pending = new Map();
	const ready = new Promise((r) => child.on("message", (m) => (m.ready ? r() : pending.get(m.id)?.(m))));
	const call = (cmd, extra = {}) =>
		new Promise((resolve, reject) => {
			const id = ++n;
			pending.set(id, (m) => (m.ok ? resolve(m.reply) : reject(new Error(m.error))));
			child.send({ id, cmd, ...extra });
		});
	return { name, child, ready, call };
}

function check(label, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  (" + detail + ")" : ""}`);
	if (!ok) failures++;
}

async function report(m) {
	return m.call("report");
}

async function inSync(label, host, listeners, { tolerance = 1500, uri } = {}) {
	const h = await report(host);
	for (const l of listeners) {
		const r = await report(l);
		const sameSong = r.player.uri === (uri || h.player.uri);
		const drift = Math.abs(r.player.position - h.player.position);
		const samePlay = r.player.isPlaying === h.player.isPlaying;
		check(`${label}: ${l.name} follows ${host.name}`, sameSong && drift <= tolerance && samePlay, `song ${sameSong ? "same" : r.player.uri + " vs " + h.player.uri}, drift ${drift} ms, playing ${r.player.isPlaying}/${h.player.isPlaying}`);
	}
}

(async () => {
	console.log(`relays: ${RELAYS.join(", ")}\nlobby code: ${CODE}\n`);

	// Eavesdropper on the whole public namespace: must never see the code or song IDs.
	const sniffed = [];
	const spy = mqtt.connect(RELAYS[RELAYS.length - 1], { clientId: "spy_" + crypto.randomBytes(4).toString("hex") });
	spy.on("connect", () => spy.subscribe("mercify/#"));
	spy.on("message", (t, b) => sniffed.push({ t, b }));

	const A = member("Eva", 0);
	const B = member("Kain", +4000); // clock 4 s fast
	const C = member("Mira", -3000); // clock 3 s slow
	await Promise.all([A.ready, B.ready, C.ready]);

	// 1. host starts the lobby
	const a = await A.call("join", { code: CODE, name: "Eva" });
	check("first member becomes host", a.role === "host", `role ${a.role}, relays ${a.relays.connected}/${a.relays.total}`);
	await A.call("play", { uri: "spotify:track:one", at: 30000 });

	// 2. two listeners join
	const b = await B.call("join", { code: CODE, name: "Kain" });
	check("second member joins as listener", b.role === "listener" && b.hostName === "Eva", `role ${b.role}, host ${b.hostName}`);
	const c = await C.call("join", { code: CODE, name: "Mira" });
	check("third member joins as listener", c.role === "listener", `role ${c.role}`);
	await sleep(4000);
	await inSync("after joining", A, [B, C]);
	const roster = (await report(A)).lobby.members.map((m) => m.name).sort().join(",");
	check("host sees all three members", roster === "Eva,Kain,Mira", roster);

	// 3. host seeks
	await A.call("seek", { ms: 150000 });
	await sleep(4000);
	await inSync("after host seeks", A, [B, C]);

	// 4. pause / resume
	await A.call("pause");
	await sleep(3500);
	await inSync("after host pauses", A, [B, C]);
	await A.call("resume");
	await sleep(3500);
	await inSync("after host resumes", A, [B, C]);

	// 5. host changes song
	await A.call("play", { uri: "spotify:track:two" });
	await sleep(3500);
	await inSync("after song change", A, [B, C]);

	// 6. listener suggests a song
	await B.call("suggest", { track: { uri: "spotify:track:suggested", name: "Suggested Song", artists: ["X"] } });
	await sleep(1500);
	const aq = await report(A);
	check("suggestion lands in the host's queue", aq.queue.includes("spotify:track:suggested"), `queue ${JSON.stringify(aq.queue)}`);
	check("host sees who suggested it", aq.lobby.activity.some((x) => /Kain added “Suggested Song”/.test(x.text)));

	// 7. lose one relay
	if (process.env.KILL_RELAY_CMD) {
		execSync(process.env.KILL_RELAY_CMD);
		await sleep(1000);
		await A.call("play", { uri: "spotify:track:three" });
		await sleep(3500);
		await inSync("with one relay down", A, [B, C]);
	}

	// 8. encryption: what the public relay saw
	const raw = Buffer.concat(sniffed.map((s) => s.b)).toString("latin1");
	const topics = [...new Set(sniffed.map((s) => s.t))];
	check("relay traffic is encrypted", sniffed.length > 0 && !raw.includes("spotify:track") && !raw.includes("Eva") && !raw.includes(CODE), `${sniffed.length} messages seen`);
	check("relay topic doesn't reveal the code", topics.length === 1 && topics[0] === topicFor(CODE) && !topics[0].includes(CODE), topics.join(","));

	// 9. host leaves: the longest-standing listener takes over, and everyone agrees who
	//    (join times come from each member's own clock, so with skewed clocks either can win)
	await A.call("leave");
	await sleep(2500);
	const b2 = await report(B);
	const c2 = await report(C);
	const hosts = [b2, c2].filter((r) => r.lobby.role === "host");
	check("host leaves: exactly one new host, and both agree", hosts.length === 1 && b2.lobby.hostName === c2.lobby.hostName, `Kain ${b2.lobby.role}, Mira ${c2.lobby.role}, both see ${b2.lobby.hostName}/${c2.lobby.hostName}`);
	const [newHost, other] = b2.lobby.role === "host" ? [B, C] : [C, B];
	await newHost.call("play", { uri: "spotify:track:four", at: 10000 });
	await sleep(4000);
	await inSync("new host plays", newHost, [other]);

	// 10. a different code is a different lobby
	const D = member("Solo", 0);
	await D.ready;
	const d = await D.call("join", { code: CODE + "X", name: "Solo" });
	check("different code: separate lobby", d.role === "host" && d.members.length === 1, `role ${d.role}, members ${d.members.length}`);

	// 11. host vanishes without saying goodbye (crash / sleep): taken over after the timeout
	if (!process.env.SKIP_CRASH) {
		newHost.child.kill("SIGKILL");
		await sleep(32000);
		const r = await report(other);
		check(`host crashes: ${other.name} takes over after the timeout`, r.lobby.role === "host", `${other.name} ${r.lobby.role}, members ${r.lobby.members.length}`);
	}

	console.log(`\n${failures ? failures + " FAILED" : "ALL PASSED"}`);
	for (const m of [A, B, C, D]) m.child.kill();
	spy.end(true);
	process.exit(failures ? 1 : 0);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
