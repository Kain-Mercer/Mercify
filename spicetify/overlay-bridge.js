// NAME: Overlay Bridge
// AUTHOR: Eva
// DESCRIPTION: Connects the Spotify client to the Spotify Overlay app over a local WebSocket.
//              Sends now-playing state, answers search/playlist requests and runs playback commands.
//
// Install: copy this file into your Spicetify Extensions folder, then
//   spicetify config extensions overlay-bridge.js
//   spicetify apply
//
// The overlay app runs the WebSocket server. This extension is the client, so it
// simply keeps retrying in the background until the overlay is running.

(function OverlayBridge() {
	"use strict";

	const VERSION = "1.7.0";
	const DEFAULT_PORT = 7317;
	const LOG = (...a) => console.log("[overlay-bridge]", ...a);

	// Wait until Spicetify has finished loading the bits we use.
	if (!(window.Spicetify && Spicetify.Player && Spicetify.Player.data !== undefined && Spicetify.Platform && Spicetify.CosmosAsync)) {
		setTimeout(OverlayBridge, 300);
		return;
	}

	function getPort() {
		try {
			const p = parseInt(localStorage.getItem("overlay-bridge:port"), 10);
			if (p > 0 && p < 65536) return p;
		} catch (_) {}
		return DEFAULT_PORT;
	}

	// ---------------------------------------------------------------- helpers

	function imageUrl(raw) {
		if (!raw || typeof raw !== "string") return null;
		if (raw.startsWith("http")) return raw;
		if (raw.startsWith("spotify:image:")) return "https://i.scdn.co/image/" + raw.slice("spotify:image:".length);
		return null; // local files etc.
	}

	// Platform API images come as [{url, label|width}], GraphQL as {sources:[{url,width}]}
	function pickImage(images, preferSmall = true) {
		if (!images) return null;
		if (images.sources) images = images.sources;
		if (images.items) images = images.items[0]?.sources ?? images.items;
		if (!Array.isArray(images) || images.length === 0) return null;
		const withWidth = images.filter((i) => i && i.url);
		if (withWidth.length === 0) return null;
		const byLabel = withWidth.find((i) => i.label === (preferSmall ? "small" : "large"));
		if (byLabel) return imageUrl(byLabel.url);
		const sorted = [...withWidth].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
		const pick = preferSmall ? sorted.find((i) => (i.width ?? 0) >= 64) ?? sorted[0] : sorted[sorted.length - 1];
		return imageUrl(pick.url);
	}

	function msOf(d) {
		if (typeof d === "number") return d;
		if (!d) return 0;
		return d.milliseconds ?? d.totalMilliseconds ?? 0;
	}

	// Normalise a track from any of the client's APIs into one shape.
	function normTrack(t, extra = {}) {
		if (!t) return null;
		const artists = (t.artists?.items ?? t.artists ?? []).map((a) => a.name ?? a.profile?.name).filter(Boolean);
		const album = t.album ?? t.albumOfTrack ?? {};
		return {
			uri: t.uri,
			uid: t.uid ?? null,
			name: t.name ?? "",
			artists,
			album: album.name ?? "",
			image: pickImage(album.images ?? album.coverArt),
			duration: msOf(t.duration ?? t.duration_ms),
			playable: t.isPlayable !== false && t.playability?.playable !== false,
			...extra,
		};
	}

	// ---------------------------------------------------------------- state

	function currentState() {
		const P = Spicetify.Player;
		const d = P.data || {};
		const item = d.item ?? d.track;
		if (!item) return { empty: true, isPlaying: false };
		const m = item.metadata || {};
		const artists = item.artists?.map((a) => a.name).filter(Boolean) ?? (m.artist_name ? [m.artist_name] : []);
		let liked = false;
		try {
			liked = !!P.getHeart();
		} catch (_) {}
		return {
			empty: false,
			uri: item.uri,
			name: item.name ?? m.title ?? "",
			artists,
			album: item.album?.name ?? m.album_title ?? "",
			image: imageUrl(m.image_xlarge_url ?? m.image_large_url ?? m.image_url) ?? pickImage(item.album?.images, false),
			imageSmall: imageUrl(m.image_small_url ?? m.image_url),
			duration: P.getDuration?.() ?? msOf(item.duration),
			position: P.getProgress?.() ?? 0,
			isPlaying: P.isPlaying?.() ?? !d.isPaused,
			volume: P.getVolume?.() ?? 1,
			shuffle: !!P.getShuffle?.(),
			repeat: P.getRepeat?.() ?? 0,
			liked,
			contextUri: d.context?.uri ?? d.context_uri ?? null,
			at: Date.now(),
		};
	}

	// ---------------------------------------------------------------- private session
	//
	// Private session ("private listening") keeps what you play out of your recommendations and off
	// your profile — handy in a lobby where friends queue eclectic stuff. Where the client keeps the
	// switch differs between Spotify versions, so we never guess: we look for (1) a Platform namespace
	// or method that names private/incognito listening, then (2) a product-state key that does. We
	// write in the same format the client already uses ("1"/"0", "true"/"false" or a boolean), and we
	// read it back, so "on" is only ever reported when it really is.

	const PRIVATE_RE = /private|incognito/i;
	const asBool = (v) => v === true || v === "1" || v === "true" || v === 1;
	const formatLike = (prev, on) => (typeof prev === "boolean" ? !!on : prev === "true" || prev === "false" ? (on ? "true" : "false") : on ? "1" : "0");
	const fnNames = (o) => {
		const out = new Set();
		for (let p = o; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
			for (const k of Object.getOwnPropertyNames(p)) {
				try {
					if (k !== "constructor" && typeof o[k] === "function") out.add(k);
				} catch (_) {}
			}
		}
		return [...out];
	};

	function productState() {
		const P = Spicetify.Platform || {};
		return P.UserAPI?._product_state || P.ProductStateAPI?.productStateApi || P.ProductStateAPI || null;
	}

	async function readProductPairs(ps) {
		if (!ps) return {};
		try {
			if (typeof ps.getValues === "function") {
				const v = await ps.getValues();
				return v?.pairs ?? v ?? {};
			}
		} catch (_) {}
		try {
			if (ps.cache && typeof ps.cache.forEach === "function") {
				const out = {};
				ps.cache.forEach((v, k) => (out[k] = v));
				return out;
			}
		} catch (_) {}
		return {};
	}

	// Dedicated controls: Platform namespaces named private/incognito, plus private/incognito-named
	// methods on UserAPI and the product-state service. Returns { setter, getter, toggler } as
	// { obj, name, label } (any may be null).
	function privateControls() {
		const P = Spicetify.Platform || {};
		const places = [];
		for (const ns of Object.keys(P)) {
			try {
				if (PRIVATE_RE.test(ns) && P[ns] && typeof P[ns] === "object") places.push({ obj: P[ns], label: "Platform." + ns, any: true });
			} catch (_) {}
		}
		if (P.UserAPI) places.push({ obj: P.UserAPI, label: "Platform.UserAPI", any: false });
		const ps = productState();
		if (ps) places.push({ obj: ps, label: "productState", any: false });
		let setter = null, getter = null, toggler = null;
		for (const { obj, label, any } of places) {
			for (const name of fnNames(obj)) {
				const named = any || PRIVATE_RE.test(name);
				if (!named) continue;
				if (!setter && /^(set|enable)/i.test(name)) setter = { obj, name, label: label + "." + name };
				else if (!getter && /^(get|is)/i.test(name) && !/capab/i.test(name)) getter = { obj, name, label: label + "." + name };
				else if (!toggler && /^toggle/i.test(name)) toggler = { obj, name, label: label + "." + name };
			}
		}
		return { setter, getter, toggler };
	}

	async function privateKey() {
		const pairs = await readProductPairs(productState());
		const key = Object.keys(pairs).find((k) => PRIVATE_RE.test(k) && !/(timeout|default|persist)/i.test(k)) || null;
		return { key, value: key ? pairs[key] : undefined };
	}

	// Is private session on? true / false, or null when this client gives us no way to tell.
	async function readPrivate() {
		const { getter } = privateControls();
		if (getter) {
			try {
				const v = await getter.obj[getter.name]();
				if (typeof v === "boolean" || v === "1" || v === "0" || v === "true" || v === "false") return { on: asBool(v), via: getter.label };
				if (v && typeof v === "object" && "enabled" in v) return { on: !!v.enabled, via: getter.label };
			} catch (_) {}
		}
		const { key, value } = await privateKey();
		if (key) return { on: asBool(value), via: "productState:" + key };
		return { on: null, via: null };
	}

	async function putPair(ps, key, value) {
		const body = { pairs: { [key]: value } };
		if (typeof ps.putValues === "function") return ps.putValues(body);
		if (typeof ps.putOverridesValues === "function") return ps.putOverridesValues(body);
		throw new Error("product-state service can't be written on this client");
	}

	// Turn private session on/off. Returns { ok, via, prev } (prev: true/false/null, its state before),
	// or { ok:false, reason } when this client exposes nothing we recognise.
	async function setPrivateSession(on) {
		const before = await readPrivate();
		const { setter, toggler } = privateControls();
		if (setter) {
			await setter.obj[setter.name](!!on);
			return { ok: true, via: setter.label, prev: before.on };
		}
		if (toggler && before.on !== null) {
			if (before.on !== !!on) await toggler.obj[toggler.name]();
			return { ok: true, via: toggler.label, prev: before.on };
		}
		const ps = productState();
		const { key, value } = await privateKey();
		if (!ps || !key) return { ok: false, reason: "no private-session control found on this Spotify" };
		await putPair(ps, key, formatLike(value, on));
		return { ok: true, via: "productState:" + key, prev: asBool(value) };
	}

	// Read-only: everything private/incognito-ish this client exposes, so the real control can be
	// pinned without changing anything.
	async function detectPrivateSession() {
		const P = Spicetify.Platform || {};
		const { setter, getter, toggler } = privateControls();
		const pairs = await readProductPairs(productState());
		return {
			now: await readPrivate(),
			controls: { setter: setter?.label ?? null, getter: getter?.label ?? null, toggler: toggler?.label ?? null },
			namespaces: Object.keys(P).filter((k) => PRIVATE_RE.test(k)),
			userApiMethods: P.UserAPI ? fnNames(P.UserAPI).filter((n) => PRIVATE_RE.test(n)) : [],
			productStateKeys: Object.keys(pairs).filter((k) => PRIVATE_RE.test(k)).map((k) => ({ key: k, value: pairs[k] })),
			sessionishKeys: Object.keys(pairs).filter((k) => /priv|incognito|session|social/i.test(k)).slice(0, 25),
			allNamespaces: Object.keys(P).slice(0, 80),
		};
	}

	// ---------------------------------------------------------------- data requests

	async function getPlaylists() {
		const out = [{ uri: "liked", name: "Liked Songs", folder: null, image: null, liked: true }];
		const res = await Spicetify.Platform.RootlistAPI.getContents();
		const walk = (items, folder) => {
			for (const i of items || []) {
				if (i.type === "playlist") {
					out.push({ uri: i.uri, name: i.name, folder, image: pickImage(i.images), owner: i.owner?.name ?? null });
				} else if (i.type === "folder") {
					walk(i.items, folder ? folder + " / " + i.name : i.name);
				}
			}
		};
		walk(res.items, null);
		return out;
	}

	function likedContextUri() {
		const user = Spicetify.Platform.username ?? Spicetify.Platform.UserAPI?._product_state?.cache?.get?.("username");
		return user ? `spotify:user:${user}:collection` : null;
	}

	// An album's songs. GraphQL query names differ between client versions, so try a few, then
	// the Web API. Album tracks don't carry their own cover, so they get the album's.
	const GRAPHQL_ALBUMS = ["getAlbum", "queryAlbumTracks"];

	async function getAlbumTracks(uri) {
		const tried = [];
		for (const def of GRAPHQL_ALBUMS) {
			const query = Spicetify.GraphQL?.Definitions?.[def];
			if (!query) continue;
			try {
				const { data, errors } = await Spicetify.GraphQL.Request(query, { uri, locale: "", offset: 0, limit: 300 });
				const album = data?.albumUnion;
				if (!album) throw new Error(errors?.[0]?.message ?? "empty response");
				const list = album.tracksV2 ?? album.tracks ?? album;
				const { tracks } = harvest(list);
				if (!tracks.length) throw new Error("no songs in response");
				const image = pickImage(album.coverArt);
				const artists = (album.artists?.items ?? []).map((a) => a.profile?.name).filter(Boolean);
				return {
					uri,
					contextUri: uri,
					album: true,
					name: album.name ?? "",
					artists,
					image,
					tracks: tracks.map((t, index) => ({ ...t, image: t.image || image, album: t.album || album.name || "", index })),
				};
			} catch (e) {
				tried.push(`${def}: ${e?.message ?? e}`);
			}
		}
		try {
			const id = uri.split(":").pop();
			const a = await Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/albums/${id}`);
			if (a?.error) throw new Error(a.error.message ?? "web api error");
			const items = [...(a.tracks?.items ?? [])];
			for (let next = a.tracks?.next; next && items.length < 500; ) {
				const page = await Spicetify.CosmosAsync.get(next);
				items.push(...(page?.items ?? []));
				next = page?.next;
			}
			const image = pickImage(a.images);
			return {
				uri,
				contextUri: uri,
				album: true,
				name: a.name ?? "",
				artists: (a.artists ?? []).map((x) => x.name),
				image,
				tracks: items.map((t, index) => normTrack({ ...t, duration: t.duration_ms, album: { name: a.name, images: a.images } }, { index })),
			};
		} catch (e) {
			tried.push(`webapi: ${e?.message ?? e}`);
		}
		LOG("album tracks failed", uri, tried);
		throw new Error("Couldn't read this album (" + tried.join("; ").slice(0, 160) + ")");
	}

	async function getPlaylistTracks(uri) {
		if (String(uri).startsWith("spotify:album:")) return getAlbumTracks(uri);
		if (uri === "liked") {
			const res = await Spicetify.Platform.LibraryAPI.getTracks({ limit: 9999999 });
			return { uri: "liked", contextUri: likedContextUri(), name: "Liked Songs", tracks: (res.items || []).map((t, index) => normTrack(t, { index })) };
		}
		const [meta, res] = await Promise.all([
			Spicetify.Platform.PlaylistAPI.getMetadata?.(uri).catch(() => null),
			Spicetify.Platform.PlaylistAPI.getContents(uri, { limit: 9999999 }),
		]);
		return {
			uri,
			contextUri: uri,
			name: meta?.name ?? "",
			image: pickImage(meta?.images),
			tracks: (res.items || []).map((t, index) => normTrack(t, { index })),
		};
	}

	// Spotify's search responses change shape between client versions and between
	// queries, so instead of reading fixed paths we walk the whole response and
	// collect anything that looks like a track, playlist or album (in response order).
	function harvest(root) {
		const tracks = new Map();
		const playlists = new Map();
		const albums = new Map();
		const seen = new Set();
		(function walk(n, depth) {
			if (!n || typeof n !== "object" || depth > 16 || seen.has(n)) return;
			seen.add(n);
			if (Array.isArray(n)) {
				for (const x of n) walk(x, depth + 1);
				return;
			}
			const uri = typeof n.uri === "string" ? n.uri : null;
			if (uri && typeof n.name === "string" && n.name) {
				if (uri.startsWith("spotify:track:")) {
					if (!tracks.has(uri)) tracks.set(uri, normTrack(n));
					return; // don't descend: a track's album would pollute the album list
				}
				if (uri.startsWith("spotify:playlist:")) {
					if (!playlists.has(uri))
						playlists.set(uri, {
							uri,
							name: n.name,
							owner: n.ownerV2?.data?.name ?? n.owner?.display_name ?? n.owner?.name ?? null,
							image: pickImage(n.images ?? n.image),
						});
					return;
				}
				if (uri.startsWith("spotify:album:")) {
					if (!albums.has(uri))
						albums.set(uri, {
							uri,
							name: n.name,
							artists: (n.artists?.items ?? n.artists ?? []).map((x) => x.profile?.name ?? x.name).filter(Boolean),
							image: pickImage(n.coverArt ?? n.images),
						});
					return;
				}
			}
			for (const k in n) walk(n[k], depth + 1);
		})(root, 0);
		return { tracks: [...tracks.values()], playlists: [...playlists.values()], albums: [...albums.values()] };
	}

	const countOf = (r) => r.tracks.length + r.playlists.length + r.albums.length;

	// Search queries the desktop client knows about, best first. Missing ones are skipped.
	const GRAPHQL_SEARCHES = ["searchDesktop", "searchTracks", "searchModalResults"];

	async function searchGraphQL(def, q, limit) {
		const query = Spicetify.GraphQL?.Definitions?.[def];
		if (!query) throw new Error("not in this Spotify version");
		const { data, errors } = await Spicetify.GraphQL.Request(query, {
			searchTerm: q,
			offset: 0,
			limit,
			numberOfTopResults: 5,
			includeAudiobooks: false,
			includeArtistHasConcertsField: false,
			includePreReleases: false,
			includeLocalConcertsField: false,
			includeAuthors: false,
			includeEpisodeContentRatingsV2: false,
		});
		if (!data) throw new Error(errors?.[0]?.message ?? "empty response");
		const r = harvest(data);
		if (countOf(r) === 0 && errors?.length) throw new Error(errors[0].message);
		return r;
	}

	async function searchWebAPI(q, limit) {
		const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track,playlist,album&limit=${limit}`;
		const r = await Spicetify.CosmosAsync.get(url);
		if (r?.error) throw new Error(r.error.message ?? "web api error " + (r.error.status ?? ""));
		const tracks = (r.tracks?.items ?? []).filter(Boolean).map((t) =>
			normTrack({ ...t, duration: t.duration_ms, album: { name: t.album?.name, images: t.album?.images } })
		);
		const playlists = (r.playlists?.items ?? [])
			.filter(Boolean)
			.map((p) => ({ uri: p.uri, name: p.name, owner: p.owner?.display_name ?? null, image: pickImage(p.images) }));
		const albums = (r.albums?.items ?? [])
			.filter(Boolean)
			.map((a) => ({ uri: a.uri, name: a.name, artists: (a.artists ?? []).map((x) => x.name), image: pickImage(a.images) }));
		return { tracks, playlists, albums };
	}

	// Try each search method until one returns something. Every attempt is recorded in
	// `tried`, so an empty result shows *why* it was empty instead of just "No results".
	async function search(q, limit = 20) {
		q = String(q || "").trim();
		if (!q) return { tracks: [], playlists: [], albums: [], tried: [] };
		const tried = [];
		const attempts = [
			...GRAPHQL_SEARCHES.map((def) => ({ name: def, run: () => searchGraphQL(def, q, limit) })),
			{ name: "webapi", run: () => searchWebAPI(q, limit) },
		];
		for (const a of attempts) {
			try {
				const r = await a.run();
				const n = countOf(r);
				tried.push({ via: a.name, results: n });
				if (n > 0) return { ...r, via: a.name, tried };
			} catch (e) {
				tried.push({ via: a.name, error: String(e?.message ?? e).slice(0, 120) });
			}
		}
		LOG("search found nothing for", JSON.stringify(q), tried);
		return { tracks: [], playlists: [], albums: [], via: null, tried };
	}

	// ---------------------------------------------------------------- commands

	const P = () => Spicetify.Player;

	const actions = {
		state: async () => currentState(),
		togglePlay: async () => P().togglePlay(),
		next: async () => P().next(),
		prev: async () => P().back(),
		seek: async ({ ms }) => P().seek(Math.max(0, Number(ms) || 0)),
		setVolume: async ({ level }) => P().setVolume(Math.min(1, Math.max(0, Number(level)))),
		toggleShuffle: async () => P().toggleShuffle(),
		toggleRepeat: async () => P().toggleRepeat(),
		toggleLike: async () => P().toggleHeart(),
		search: async ({ query, limit }) => search(query, limit),
		playlists: async () => getPlaylists(),
		playlistTracks: async ({ uri }) => getPlaylistTracks(uri),
		// Play a track, inside its playlist/album when a context is given so "next" continues the list.
		playTrack: async ({ uri, contextUri, uid, index }) => {
			if (contextUri && contextUri !== uri) {
				const skipTo = { uri };
				if (uid) skipTo.uid = uid;
				if (Number.isInteger(index)) skipTo.index = index;
				try {
					await P().playUri(contextUri, {}, { skipTo });
					return;
				} catch (e) {
					LOG("context play failed, playing track alone:", e?.message ?? e);
				}
			}
			await P().playUri(uri);
		},
		playContext: async ({ uri }) => P().playUri(uri === "liked" ? likedContextUri() : uri),
		privateSession: async ({ on }) => setPrivateSession(!!on),
		detectPrivateSession: async () => detectPrivateSession(),
		isPrivateSession: async () => readPrivate(),
		addToQueue: async ({ uri }) => Spicetify.addToQueue([{ uri }]),
		removeFromQueue: async ({ uri, uid }) => {
			if (typeof Spicetify.removeFromQueue !== "function") throw new Error("This Spotify can't remove songs from the queue");
			await Spicetify.removeFromQueue([uid ? { uri, uid } : { uri }]);
			setTimeout(() => pushQueue(true), 300);
		},
	};

	// ---------------------------------------------------------------- Spotify's queue
	// What plays next in Spotify itself, for the Session Playlist panel when you're not in a
	// lobby: songs you queued ("queued") first, then the rest of the playlist or album. Not
	// Spotify's autoplay suggestions. Spicetify keeps Spicetify.Queue up to date; it's looked at
	// on every song change and every 2 s, and only sent when it changed.
	let queueSent = "";
	function queueItem(t) {
		const c = t.contextTrack || t;
		const m = c.metadata || {};
		return {
			uri: c.uri,
			uid: c.uid || null,
			name: m.title || "",
			artists: m.artist_name ? [m.artist_name] : [],
			image: imageUrl(m.image_small_url ?? m.image_url),
			duration: Number(m.duration) || null,
			queued: t.provider === "queue",
		};
	}
	function pushQueue(force) {
		let next = [];
		try {
			next = (Spicetify.Queue?.nextTracks || [])
				.filter((t) => t.provider !== "autoplay")
				.map(queueItem)
				.filter((t) => t.uri && t.name && !t.uri.startsWith("spotify:delimiter"))
				.slice(0, 50);
		} catch (e) {
			LOG("couldn't read Spotify's queue", e);
		}
		const key = JSON.stringify(next);
		if (!force && key === queueSent) return;
		queueSent = key;
		send({ type: "queue", next });
	}
	setInterval(() => pushQueue(false), 2000);

	// ---------------------------------------------------------------- socket

	let ws = null;
	let retryMs = 1000;
	let progressTimer = null;

	function send(msg) {
		if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
	}

	const pushState = () => send({ type: "state", state: currentState() });

	// Which plan the logged-in account is on ("premium", "free", "open"…), so Mercify can set
	// SpotX up in the right mode. Asked from the Web API, not the app's own product state, which
	// SpotX's free mode overrides to "premium". Unknown (offline, older client) sends nothing.
	async function sendAccount() {
		try {
			const me = await Spicetify.CosmosAsync.get("https://api.spotify.com/v1/me");
			if (me && typeof me.product === "string") send({ type: "account", product: me.product });
		} catch (e) {
			LOG("couldn't read the account's plan", e);
		}
	}

	function connect() {
		try {
			ws = new WebSocket(`ws://127.0.0.1:${getPort()}`);
		} catch (e) {
			return scheduleReconnect();
		}
		ws.onopen = () => {
			retryMs = 1000;
			LOG("connected to overlay");
			send({ type: "hello", version: VERSION, spotify: Spicetify.Platform.version ?? null });
			sendAccount();
			pushQueue(true);
			pushState();
			clearInterval(progressTimer);
			progressTimer = setInterval(() => {
				if (P().isPlaying?.()) send({ type: "progress", position: P().getProgress(), at: Date.now() });
			}, 1000);
		};
		ws.onmessage = async (ev) => {
			let msg;
			try {
				msg = JSON.parse(ev.data);
			} catch (_) {
				return;
			}
			if (msg.type !== "cmd") return;
			const fn = actions[msg.action];
			if (!fn) return send({ type: "reply", id: msg.id, ok: false, error: "unknown action " + msg.action });
			try {
				const data = await fn(msg.args || {});
				send({ type: "reply", id: msg.id, ok: true, data: data ?? null });
				// Playback commands change state; push it rather than waiting for events.
				if (!["search", "playlists", "playlistTracks", "state", "privateSession", "detectPrivateSession", "isPrivateSession"].includes(msg.action)) setTimeout(pushState, 250);
			} catch (e) {
				send({ type: "reply", id: msg.id, ok: false, error: String(e?.message ?? e) });
			}
		};
		ws.onclose = () => {
			clearInterval(progressTimer);
			scheduleReconnect();
		};
		ws.onerror = () => {}; // onclose follows; keep the console quiet
	}

	function scheduleReconnect() {
		ws = null;
		setTimeout(connect, retryMs);
		retryMs = Math.min(retryMs * 1.5, 10000);
	}

	Spicetify.Player.addEventListener("songchange", pushState);
	Spicetify.Player.addEventListener("songchange", () => setTimeout(() => pushQueue(false), 300));
	Spicetify.Player.addEventListener("onplaypause", pushState);
	// Volume / shuffle / repeat / like have no reliable events, so poll cheaply for those.
	let lastSig = "";
	setInterval(() => {
		const s = currentState();
		const sig = [s.volume, s.shuffle, s.repeat, s.liked, s.uri, s.isPlaying].join("|");
		if (sig !== lastSig) {
			lastSig = sig;
			send({ type: "state", state: s });
		}
	}, 750);

	LOG("loaded v" + VERSION + ", connecting on port " + getPort());
	connect();
})();
