// Fake Spotify for trying the overlay without Spotify running.
// Usage: start the overlay (npm start), then in a second terminal: npm run demo
// It speaks the same protocol as spicetify/overlay-bridge.js.

const WebSocket = require("ws");

const PORT = Number(process.env.OVERLAY_PORT || 7317);
const COLORS = ["#e2445c", "#7b5cff", "#00a2ff", "#16c47f", "#ff8a00", "#e83e8c", "#20c997", "#6f42c1", "#fd7e14", "#0dcaf0"];

function art(seed, label) {
	const c1 = COLORS[seed % COLORS.length];
	const c2 = COLORS[(seed * 7 + 3) % COLORS.length];
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><text x="32" y="40" font-family="Segoe UI,Arial" font-size="20" font-weight="700" fill="rgba(255,255,255,.85)" text-anchor="middle">${label}</text></svg>`;
	return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

const WORDS = ["Neon", "Midnight", "Paper", "Static", "Golden", "Echo", "Velvet", "Northern", "Glass", "Summer", "Silver", "Wild", "Ocean", "Fading", "Electric", "Hollow"];
const NOUNS = ["Hearts", "Skyline", "Rivers", "Lights", "Machine", "Garden", "Signals", "Weather", "Dreams", "Avenue", "Satellites", "Fever", "Horizon", "Static"];
const ARTISTS = ["Luna Vale", "The Paper Kites", "Kasia Nowak", "Echo Harbor", "Mira & The Tides", "Dusk Runner", "Atlas Grey", "Solenne", "Northbound", "Copper Lanes"];

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];

function makeTrack(i) {
	const name = `${pick(WORDS)} ${pick(NOUNS)}`;
	const artist = pick(ARTISTS);
	return {
		uri: `spotify:track:mock${i}`,
		uid: `uid${i}`,
		name,
		artists: [artist],
		album: `${pick(WORDS)} ${pick(NOUNS)}`,
		image: art(i, name.split(" ").map((w) => w[0]).join("")),
		duration: 140000 + Math.floor(rnd() * 160000),
		playable: true,
	};
}

const ALL = Array.from({ length: 400 }, (_, i) => makeTrack(i));
const PLAYLISTS = [
	{ uri: "liked", name: "Liked Songs", folder: null, image: null, liked: true },
	{ uri: "spotify:playlist:p1", name: "Deep Focus", folder: null, image: art(101, "DF"), owner: "Eva" },
	{ uri: "spotify:playlist:p2", name: "Raid Night", folder: "Gaming", image: art(102, "RN"), owner: "Eva" },
	{ uri: "spotify:playlist:p3", name: "Questing Chill", folder: "Gaming", image: art(103, "QC"), owner: "Eva" },
	{ uri: "spotify:playlist:p4", name: "Editing Session", folder: "Work", image: art(104, "ES"), owner: "Eva" },
	{ uri: "spotify:playlist:p5", name: "Polskie Klasyki", folder: null, image: art(105, "PK"), owner: "Eva" },
];
const TRACKS = {
	liked: ALL.slice(0, 220),
	"spotify:playlist:p1": ALL.slice(220, 262),
	"spotify:playlist:p2": ALL.slice(262, 300),
	"spotify:playlist:p3": ALL.slice(300, 335),
	"spotify:playlist:p4": ALL.slice(335, 370),
	"spotify:playlist:p5": ALL.slice(370, 400),
};

const player = { trackIdx: 228, position: 63000, at: Date.now(), isPlaying: true, volume: 0.72, shuffle: true, repeat: 0, liked: true, context: "spotify:playlist:p1" };

function pos() {
	return player.isPlaying ? player.position + (Date.now() - player.at) : player.position;
}

function state() {
	const t = ALL[player.trackIdx];
	let p = pos();
	if (p >= t.duration) {
		player.trackIdx = (player.trackIdx + 1) % ALL.length;
		player.position = 0;
		player.at = Date.now();
		p = 0;
	}
	return {
		empty: false,
		uri: t.uri,
		name: t.name,
		artists: t.artists,
		album: t.album,
		image: t.image,
		duration: ALL[player.trackIdx].duration,
		position: p,
		isPlaying: player.isPlaying,
		volume: player.volume,
		shuffle: player.shuffle,
		repeat: player.repeat,
		liked: player.liked,
		contextUri: player.context,
		at: Date.now(),
	};
}

function setTrack(i) {
	player.trackIdx = i;
	player.position = 0;
	player.at = Date.now();
	player.isPlaying = true;
}

const actions = {
	state: () => state(),
	togglePlay: () => {
		player.position = pos();
		player.at = Date.now();
		player.isPlaying = !player.isPlaying;
	},
	next: () => setTrack((player.trackIdx + 1) % ALL.length),
	prev: () => setTrack((player.trackIdx - 1 + ALL.length) % ALL.length),
	seek: ({ ms }) => {
		player.position = ms;
		player.at = Date.now();
	},
	setVolume: ({ level }) => (player.volume = level),
	toggleShuffle: () => (player.shuffle = !player.shuffle),
	toggleRepeat: () => (player.repeat = (player.repeat + 1) % 3),
	toggleLike: () => (player.liked = !player.liked),
	playlists: () => PLAYLISTS,
	playlistTracks: ({ uri }) => {
		const p = PLAYLISTS.find((x) => x.uri === uri) || { name: "Search playlist", image: art(9, "SP") };
		const tracks = (TRACKS[uri] || ALL.slice(10, 40)).map((t, index) => ({ ...t, index }));
		return { uri, contextUri: uri === "liked" ? "spotify:user:eva:collection" : uri, name: p.name, image: p.image, tracks };
	},
	search: ({ query }) => {
		const q = String(query).toLowerCase();
		const tracks = ALL.filter((t) => (t.name + " " + t.artists.join(" ")).toLowerCase().includes(q)).slice(0, 20);
		const playlists = PLAYLISTS.filter((p) => !p.liked && p.name.toLowerCase().includes(q));
		return {
			tracks,
			playlists: playlists.length ? playlists : [{ uri: "spotify:playlist:search1", name: `${query} Mix`, owner: "Spotify", image: art(77, "MX") }],
			albums: [{ uri: "spotify:album:a1", name: `${pick(WORDS)} ${pick(NOUNS)}`, artists: [pick(ARTISTS)], image: art(55, "AL") }],
			via: "mock",
		};
	},
	playTrack: ({ uri, contextUri }) => {
		const i = ALL.findIndex((t) => t.uri === uri);
		if (i >= 0) setTrack(i);
		player.context = contextUri || null;
	},
	playContext: ({ uri }) => {
		setTrack((TRACKS[uri] || ALL)[0] ? ALL.indexOf((TRACKS[uri] || ALL)[0]) : 0);
		player.context = uri;
	},
	addToQueue: () => null,
};

function connect() {
	const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
	let timer;
	ws.on("open", () => {
		console.log("[mock] connected to overlay on port", PORT);
		ws.send(JSON.stringify({ type: "hello", version: "mock", spotify: "mock" }));
		ws.send(JSON.stringify({ type: "state", state: state() }));
		let last = "";
		timer = setInterval(() => {
			const s = state();
			const sig = [s.uri, s.isPlaying, s.volume, s.shuffle, s.repeat, s.liked].join("|");
			if (sig !== last) {
				last = sig;
				ws.send(JSON.stringify({ type: "state", state: s }));
			} else if (s.isPlaying) ws.send(JSON.stringify({ type: "progress", position: s.position, at: Date.now() }));
		}, 1000);
	});
	ws.on("message", async (raw) => {
		const msg = JSON.parse(raw);
		if (msg.type !== "cmd") return;
		const fn = actions[msg.action];
		await new Promise((r) => setTimeout(r, 40 + Math.random() * 120)); // feel like a real round trip
		try {
			const data = fn ? fn(msg.args || {}) : null;
			ws.send(JSON.stringify({ type: "reply", id: msg.id, ok: !!fn, data: data ?? null, error: fn ? undefined : "unknown action" }));
			if (!["search", "playlists", "playlistTracks", "state"].includes(msg.action)) ws.send(JSON.stringify({ type: "state", state: state() }));
		} catch (e) {
			ws.send(JSON.stringify({ type: "reply", id: msg.id, ok: false, error: e.message }));
		}
	});
	ws.on("close", () => {
		clearInterval(timer);
		setTimeout(connect, 1500);
	});
	ws.on("error", () => {});
}

console.log("[mock] fake Spotify starting; waiting for the overlay on port", PORT);
connect();
