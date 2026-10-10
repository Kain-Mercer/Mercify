// One lobby member with a fake Spotify player, driven by tools/lobby-test.js over IPC.
// CLOCK_SKEW_MS shifts this process's clock to check the clock-offset correction.

const SKEW = Number(process.env.CLOCK_SKEW_MS || 0);
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + SKEW;

const { createLobby } = require("../lobby");

const relays = (process.env.LOBBY_RELAYS || "").split(",").filter(Boolean);
const queue = [];

// ---- fake Spotify
const player = { uri: null, name: null, artists: [], duration: 240000, position: 0, at: Date.now(), isPlaying: false, empty: true };
const pos = () => (player.isPlaying ? player.position + (Date.now() - player.at) : player.position);
const snap = () => ({ ...player, position: pos(), at: Date.now() });
let lobby = null;
const push = () => setTimeout(() => lobby && lobby.onPlayerState(snap()), 60); // Spotify reports a moment later

async function command(action, args = {}) {
	if (process.env.LOBBY_DEBUG) console.error(`[${SKEW}] cmd ${action} ${JSON.stringify(args)} (player ${player.uri} @ ${Math.round(pos())})`);
	await new Promise((r) => setTimeout(r, 40)); // bridge round trip
	switch (action) {
		case "playTrack":
			Object.assign(player, { uri: args.uri, name: args.uri.split(":").pop(), position: 0, at: Date.now(), isPlaying: true, empty: false });
			break;
		case "seek":
			player.position = args.ms;
			player.at = Date.now();
			break;
		case "togglePlay":
			player.position = pos();
			player.at = Date.now();
			player.isPlaying = !player.isPlaying;
			break;
		case "addToQueue":
			queue.push(args.uri);
			break;
	}
	push();
	return null;
}

lobby = createLobby({
	command,
	relays,
	log: (m) => process.env.LOBBY_DEBUG && console.error(`[${process.env.CLOCK_SKEW_MS}] ${m}`),
	connectTimeoutMs: Number(process.env.LOBBY_CONNECT_TIMEOUT_MS) || undefined,
});
process.on("disconnect", () => process.exit(0)); // test runner gone: don't linger in the lobby
setInterval(() => player.isPlaying && lobby.onPlayerProgress(pos(), Date.now()), 1000);

process.on("message", async (m) => {
	let reply = {};
	try {
		if (m.cmd === "join") {
			lobby.setName(m.name);
			reply = await lobby.join(m.code);
		} else if (m.cmd === "leave") reply = await lobby.leave();
		else if (m.cmd === "play") {
			Object.assign(player, { uri: m.uri, name: m.uri.split(":").pop(), position: m.at || 0, at: Date.now(), isPlaying: true, empty: false, duration: m.duration || 240000 });
			lobby.onPlayerState(snap());
		} else if (m.cmd === "seek") {
			player.position = m.ms;
			player.at = Date.now();
			lobby.onPlayerProgress(m.ms, Date.now()); // Spotify only reports seeks through progress
		} else if (m.cmd === "pause" || m.cmd === "resume") {
			player.position = pos();
			player.at = Date.now();
			player.isPlaying = m.cmd === "resume";
			lobby.onPlayerState(snap());
		} else if (m.cmd === "suggest") await lobby.suggest(m.track);
		else if (m.cmd === "report") reply = { player: { uri: player.uri, position: Math.round(pos()), isPlaying: player.isPlaying }, lobby: lobby.state(), queue };
		process.send({ id: m.id, ok: true, reply });
	} catch (err) {
		process.send({ id: m.id, ok: false, error: err.message });
	}
});
process.send({ ready: true });
