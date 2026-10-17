// The phone's Spotify, in the shape overlay/lobby.js expects from the desktop bridge:
// command(action, args) to control it, and state reports through onState().
import { NativeModules, NativeEventEmitter } from "react-native";

// The Android half (SpotifyModule.kt). If it's missing, every call fails with a clear message
// instead of "cannot read property of null".
const N =
	NativeModules.MercifySpotify ||
	new Proxy({}, { get: (_, k) => (k === "addListener" || k === "removeListeners" ? () => {} : () => Promise.reject(new Error("Mercify's Spotify module didn't load (MercifySpotify is missing)"))) });
export const nativeMissing = !NativeModules.MercifySpotify;
const events = new NativeEventEmitter(NativeModules.MercifySpotify ? N : undefined);

let method = "uri"; // how to start a song: "uri" | "mediaId" | "link" (see SpotifyModule.play)
let last = null; // newest state from Spotify
let asked = null; // { uri, name, at }: the song we last told Spotify to play
const listeners = new Set();
let nameOf = () => null; // uri -> song name, from the lobby (to recognise our song when Spotify doesn't say its uri)

const same = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// Spotify's media session may not include the song's spotify: uri. If it doesn't, the song we
// asked for is recognised by its name; without a uri the lobby would ask for it again and again.
function normalize(s) {
	if (!s) return null;
	const st = { ...s, artists: s.artists || [] };
	if (!st.uri && asked && same(st.name, asked.name)) st.uri = asked.uri;
	if (!st.uri) st.uri = st.empty ? null : `spotify:unknown:${encodeURIComponent(st.name || "")}`;
	return st;
}

events.addListener("MercifySpotifyState", (s) => {
	last = normalize(s);
	for (const fn of listeners) fn(last);
});

export const spotify = {
	hasAccess: () => N.hasAccess(),
	openAccessSettings: () => N.openAccessSettings(),
	isInstalled: () => N.isInstalled(),
	start: () => N.start(),
	describe: () => N.describe(),
	state: () => last,
	refresh: async () => (last = normalize(await N.getState())),
	onState: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
	setMethod: (m) => (method = m),
	getMethod: () => method,
	setNameLookup: (fn) => (nameOf = fn),
	keepAlive: (on, text) => N.keepAlive(on, text || "In a listening lobby"),
	storage: { get: (k) => N.getItem(k), set: (k, v) => N.setItem(k, v) },

	// What lobby.js calls (the same actions as the desktop's playerCommand).
	async command(action, args = {}) {
		switch (action) {
			case "playTrack": {
				const now = Date.now();
				// Don't restart a song we started moments ago (Spotify may still be loading it).
				if (asked && asked.uri === args.uri && now - asked.at < 8000) return;
				asked = { uri: args.uri, name: nameOf(args.uri), at: now };
				if (args.uri.startsWith("youtube:")) throw new Error("YouTube videos don't play on the phone yet");
				return N.play(args.uri, method);
			}
			case "seek":
				return N.seek(Math.max(0, Math.round(args.ms)));
			case "togglePlay": {
				const s = await spotify.refresh();
				return s && s.isPlaying ? N.pause() : N.resume();
			}
			case "next":
				return N.next();
			case "prev":
				return N.previous();
			case "addToQueue":
				throw new Error("Adding to Spotify's queue isn't supported on the phone");
			default:
				throw new Error(`Unknown command ${action}`);
		}
	},
};
