// The phone as a remote for the desktop Mercify. It runs the desktop's own overlay/remote.js in
// "device" mode (so pairing and the channel crypto are one protocol on both), over the same MQTT
// relays. The phone sends commands and shows the PC's state; it never touches its own Spotify.
import mqtt from "./mqtt";
import { spotify } from "./spotify"; // used only for generic key/value storage + a keep-alive notification

const { createRemote } = require("../../overlay/remote");
const { DEFAULT_RELAYS } = require("../../overlay/lobby");

const listeners = new Set();
const signalListeners = new Set();
let snap = { paired: [], state: null, started: false };
function emit(patch) {
	snap = { ...snap, ...patch };
	for (const fn of listeners) fn(snap);
}

let remote = null;
let ready = null;

// A native call that never answers shouldn't hang startup.
const within = (ms, p, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} didn't answer in ${ms / 1000} s`)), ms))]);

export function init(step = () => {}) {
	if (ready) return ready;
	ready = (async () => {
		step("Loading your pairings");
		let saved = null;
		try {
			const raw = await within(3000, spotify.storage.get("remote"), "Storage");
			saved = raw ? JSON.parse(raw) : null;
		} catch (err) {
			console.warn("[remote] couldn't load:", err.message);
		}
		let name = "Phone";
		try {
			name = (await within(3000, spotify.storage.get("remoteName"), "Storage")) || "Phone";
		} catch (_) {}

		step("Connecting");
		remote = createRemote({
			role: "device",
			store: { load: () => saved, save: (d) => spotify.storage.set("remote", JSON.stringify(d)) },
			relays: DEFAULT_RELAYS,
			connect: mqtt.connect,
			name,
			log: (m) => console.log("[remote]", m),
		});
		remote.on("state", (state) => emit({ state }));
		remote.on("peer", () => emit({ paired: remote.devices() }));
		remote.on("signal", (s) => {
			for (const fn of signalListeners) fn(s);
		});
		emit({ started: true, paired: remote.devices() });
	})();
	return ready;
}

export const subscribe = (fn) => {
	listeners.add(fn);
	fn(snap);
	return () => listeners.delete(fn);
};
export const get = () => snap;

// Pair with a PC: `codeOrPayload` is a typed code (string) or a scanned QR payload (object).
export async function pair(codeOrPayload) {
	await ready;
	const peer = await remote.pair(codeOrPayload);
	// Being connected keeps a small notification up, so Android doesn't freeze the relay link.
	try {
		spotify.keepAlive(true, "Connected to your PC");
	} catch (_) {}
	return peer;
}

export async function send(action, args = {}) {
	await ready;
	return remote.send(action, args);
}
// Send a command and wait for the PC's reply (search results, playlists, …).
export async function request(action, args = {}) {
	await ready;
	return remote.request(action, args);
}
export async function forget(fid) {
	await ready;
	remote.forget(fid);
	if (!remote.devices().length) {
		try {
			spotify.keepAlive(false, "");
		} catch (_) {}
	}
}
export async function setName(n) {
	await ready;
	remote.setName(n);
	try {
		spotify.storage.set("remoteName", String(n || ""));
	} catch (_) {}
}
export const devices = () => (remote ? remote.devices() : []);

// WebRTC audio signalling (used by src/audio.js).
export const onSignal = (fn) => {
	signalListeners.add(fn);
	return () => signalListeners.delete(fn);
};
export async function signal(fid, kind, data) {
	await ready;
	remote.sendSignal(fid, kind, data);
}
export const pcFid = () => {
	const d = remote ? remote.devices() : [];
	return d.length ? d[0].fid : null;
};
