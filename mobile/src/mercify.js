// The phone's equivalent of the lobby/friends half of overlay/main.js: the desktop's own
// lobby.js and friends.js, wired to the phone's Spotify (src/spotify.js) and storage.
import { spotify } from "./spotify";

const { createLobby, normalizeCode, formatCode, generateCode, DEFAULT_RELAYS } = require("../../overlay/lobby");
const { createFriends } = require("../../overlay/friends");
const mqtt = require("./mqtt");

const listeners = new Set();
let snap = { lobby: null, friends: null, player: null, toasts: [], name: "", method: "uri" };
function emit(patch) {
	snap = { ...snap, ...patch };
	for (const fn of listeners) fn(snap);
}
function toast(text) {
	emit({ toasts: [...snap.toasts.slice(-4), { id: Date.now() + Math.random(), text }] });
}

let lobby = null;
let friends = null;
let ready = null;

const saved = {};
const KEYS = ["name", "friends", "code", "method"];

function updatePresence() {
	const st = lobby.state();
	const p = spotify.state();
	const track = p && !p.empty && /^spotify:(track|episode):/.test(p.uri || "") ? { uri: p.uri, name: p.name, artists: p.artists } : p && !p.empty && p.name ? { uri: null, name: p.name, artists: p.artists } : null;
	friends.setPresence({ track, playing: !!p?.isPlaying, inLobby: st.status === "joined", host: st.status === "joined" && st.role === "host" });
}

export function init() {
	if (ready) return ready;
	ready = (async () => {
		for (const k of KEYS) saved[k] = await spotify.storage.get(k);
		let friendsData = null;
		try {
			friendsData = saved.friends ? JSON.parse(saved.friends) : null;
		} catch (_) {}
		if (saved.method) spotify.setMethod(saved.method);

		friends = createFriends({
			store: { load: () => friendsData, save: (d) => spotify.storage.set("friends", JSON.stringify(d)) },
			relays: DEFAULT_RELAYS,
			connect: mqtt.connect,
			lobbyCode: async () => {
				const st = lobby.state();
				if (st.status === "joined") return st.code;
				await lobby.join(formatCode(generateCode()));
				return lobby.state().code;
			},
			log: (m) => console.log("[friends]", m),
		});
		lobby = createLobby({
			command: (action, args) => spotify.command(action, args),
			relays: DEFAULT_RELAYS,
			connect: mqtt.connect,
			friendPub: friends.pub,
			log: (m) => console.log("[lobby]", m),
		});

		spotify.setNameLookup((uri) => {
			const st = lobby.state();
			if (st.current && st.current.uri === uri) return st.current.name;
			const q = [...(st.queue || []), ...(st.history || [])].find((x) => x.uri === uri);
			return q ? q.name : null;
		});

		const name = saved.name || "";
		lobby.setName(name);
		friends.setName(name);

		lobby.on("change", (st) => {
			emit({ lobby: st });
			spotify.keepAlive(st.status === "joined" || st.status === "connecting", st.status === "joined" ? `In lobby ${st.displayCode} with ${st.hostName || "friends"}` : "Joining a lobby…");
			updatePresence();
		});
		lobby.on("toast", toast);
		lobby.on("friend", ({ ty, memberId, name: n, fpub }) => {
			if (ty === "friend-add") friends.receiveAdd({ pub: fpub, name: n }, (type) => lobby.friendSend(memberId, type));
			else friends.receiveAddReply({ pub: fpub, name: n }, ty === "friend-ok");
		});
		friends.on("change", (st) => emit({ friends: st }));
		friends.on("toast", toast);
		friends.on("join", async ({ name: n, code }) => {
			toast(`${n} accepted. Joining their lobby…`);
			try {
				await lobby.join(code);
			} catch (err) {
				toast(`Couldn't join ${n}'s lobby: ${err.message}`);
			}
		});

		spotify.onState((s) => {
			lobby.onPlayerState(s);
			emit({ player: s });
			updatePresence();
		});
		// Spotify only reports changes; the host side of lobby.js also wants the position now and then.
		setInterval(async () => {
			try {
				const s = await spotify.refresh();
				if (s && s.isPlaying) lobby.onPlayerProgress(s.position, s.at);
				emit({ player: s });
			} catch (_) {}
		}, 5000);

		friends.start();
		emit({ lobby: lobby.state(), friends: friends.state(), name, method: spotify.getMethod(), lastCode: saved.code || "" });
	})();
	return ready;
}

export const subscribe = (fn) => (listeners.add(fn), fn(snap), () => listeners.delete(fn));
export const getLobby = () => lobby;
export const getFriends = () => friends;

export function setName(n) {
	const name = String(n || "").slice(0, 24);
	lobby.setName(name);
	friends.setName(name);
	spotify.storage.set("name", name);
	emit({ name });
}

export function setMethod(m) {
	spotify.setMethod(m);
	spotify.storage.set("method", m);
	emit({ method: m });
}

export async function join(codeText) {
	const code = normalizeCode(codeText);
	if (code.length < 4) throw new Error("Lobby codes are at least 4 letters or numbers");
	spotify.storage.set("code", formatCode(code));
	await lobby.join(formatCode(code));
}

export const leave = () => lobby.leave();

// "https://open.spotify.com/track/ID?si=..." or "spotify:track:ID" -> "spotify:track:ID"
export function spotifyUriFrom(text) {
	const s = String(text || "").trim();
	let m = /^spotify:(track|episode):([A-Za-z0-9]+)$/.exec(s);
	if (m) return `spotify:${m[1]}:${m[2]}`;
	m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|episode)\/([A-Za-z0-9]+)/.exec(s);
	return m ? `spotify:${m[1]}:${m[2]}` : null;
}
