// Mercify for Android: a remote for the desktop Mercify. Pair once (scan the QR the PC shows, or
// type the code), then control what's playing on the PC — play/skip/seek, search, lobbies — and
// hear its audio. The phone never plays Spotify itself; it drives the PC.
import React, { useEffect, useMemo, useState, useContext, createContext, useCallback } from "react";
import { AppState, PermissionsAndroid, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, Image } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as R from "./src/remote";
import * as Audio from "./src/audio";
import { spotify } from "./src/spotify";
import QRScanner, { cameraAvailable } from "./src/QRScanner";

// The desktop app's four themes (overlay/settings/settings.css), as flat palettes. warn/bad are
// shared across them.
const SHARED = { warn: "#ffb547", bad: "#ff6b6b" };
const THEMES = {
	classic: { ...SHARED, bg: "#0d0f13", card: "#15181e", row: "#1b1f26", line: "rgba(255,255,255,0.07)", field: "#0d0f13", fieldLine: "rgba(255,255,255,0.12)", text: "#f2f3f5", dim: "#b4b8c1", faint: "#8b909b", accent: "#1ed760", onAccent: "#06240f", dark: true },
	neon: { ...SHARED, bg: "#070908", card: "#111613", row: "#161c18", line: "rgba(244,236,200,0.09)", field: "#070908", fieldLine: "rgba(244,236,200,0.15)", text: "#f4ecc8", dim: "#c9c4ad", faint: "#a8a38c", accent: "#3dff8a", onAccent: "#04150a", dark: true },
	light: { ...SHARED, bg: "#f6f5f1", card: "#ffffff", row: "#fbfaf7", line: "#e3e1da", field: "#ffffff", fieldLine: "#d8d6cf", text: "#17181a", dim: "#4d4f55", faint: "#5c5e64", accent: "#0b6b35", onAccent: "#ffffff", dark: false },
	vice: { ...SHARED, bg: "#140826", card: "#1d0f34", row: "#26143f", line: "rgba(255,63,164,0.25)", field: "#140826", fieldLine: "rgba(255,63,164,0.4)", text: "#fff2fb", dim: "#e3d6f5", faint: "#cbb8e6", accent: "#ff3fa4", onAccent: "#23051a", dark: true },
};
const THEME_ORDER = ["classic", "neon", "light", "vice"];
const THEME_LABELS = { classic: "Classic", neon: "Neon", light: "Light", vice: "Vice" };

const ThemeCtx = createContext(null);
const useTheme = () => useContext(ThemeCtx);

function ThemeProvider({ children }) {
	const [name, setNameState] = useState("classic");
	useEffect(() => {
		(async () => {
			try {
				const s = await spotify.storage.get("theme");
				if (s && THEMES[s]) setNameState(s);
			} catch (_) {}
		})();
	}, []);
	const setName = useCallback((n) => {
		if (!THEMES[n]) return;
		setNameState(n);
		try {
			spotify.storage.set("theme", n);
		} catch (_) {}
	}, []);
	const C = THEMES[name] || THEMES.classic;
	const st = useMemo(() => makeStyles(C), [name]); // eslint-disable-line react-hooks/exhaustive-deps
	const value = useMemo(() => ({ C, st, name, setName }), [C, st, name, setName]);
	return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

// Errors anywhere in the JS are kept and shown, since a test build has no other way to tell us.
const problems = [];
const problemListeners = new Set();
function addProblem(text) {
	console.error("[mercify] problem:", text);
	problems.push({ t: new Date().toLocaleTimeString(), text: String(text).slice(0, 1500) });
	for (const fn of problemListeners) fn([...problems]);
}
if (global.ErrorUtils) {
	const prev = global.ErrorUtils.getGlobalHandler();
	global.ErrorUtils.setGlobalHandler((err, fatal) => {
		addProblem(`${fatal ? "Fatal: " : ""}${err && err.stack ? err.stack : err}`);
		if (prev && fatal) prev(err, fatal);
	});
}
function useProblems() {
	const [list, setList] = useState([...problems]);
	useEffect(() => (problemListeners.add(setList), () => problemListeners.delete(setList)), []);
	return list;
}
function Problems({ list }) {
	const { C, st } = useTheme();
	if (!list.length) return null;
	return (
		<View style={[st.card, { borderColor: "rgba(255,107,107,0.5)" }]}>
			<Text style={[st.cardTitle, { color: C.bad, marginBottom: 6 }]}>Problems</Text>
			<Text style={st.hint}>Screenshot this and send it to Kain.</Text>
			{list.slice(-5).map((p, i) => (
				<Text key={i} selectable style={st.mono}>
					{p.t} {p.text}
				</Text>
			))}
		</View>
	);
}

const fmt = (ms) => {
	const s = Math.max(0, Math.floor((ms || 0) / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Button({ title, onPress, kind = "plain", disabled, small }) {
	const { C, st } = useTheme();
	return (
		<Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [st.btn, kind === "primary" && st.btnPrimary, kind === "danger" && st.btnDanger, small && st.btnSmall, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 }]}>
			<Text style={[st.btnText, kind === "primary" && { color: C.onAccent }, small && { fontSize: 13 }]}>{title}</Text>
		</Pressable>
	);
}

function Card({ title, right, children, style }) {
	const { st } = useTheme();
	return (
		<View style={[st.card, style]}>
			{title ? (
				<View style={st.cardHead}>
					<Text style={st.cardTitle}>{title}</Text>
					{right}
				</View>
			) : null}
			{children}
		</View>
	);
}

// A round transport button (prev / play / next and friends).
function IconButton({ label, onPress, big, disabled }) {
	const { st } = useTheme();
	return (
		<Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [st.icon, big && st.iconBig, (pressed || disabled) && { opacity: disabled ? 0.35 : 0.7 }]}>
			<Text style={[st.iconText, big && { fontSize: 26 }]}>{label}</Text>
		</Pressable>
	);
}

function ThemeCard() {
	const { st, name, setName } = useTheme();
	return (
		<Card title="Theme">
			<View style={st.themeRow}>
				{THEME_ORDER.map((k) => {
					const t = THEMES[k];
					const sel = k === name;
					return (
						<Pressable key={k} onPress={() => setName(k)} style={[st.swatch, { backgroundColor: t.card, borderColor: sel ? t.accent : t.line, borderWidth: sel ? 2 : 1 }]}>
							<View style={[st.swatchDot, { backgroundColor: t.accent }]} />
							<Text style={[st.swatchLabel, { color: t.text }]}>{THEME_LABELS[k]}</Text>
						</Pressable>
					);
				})}
			</View>
		</Card>
	);
}

// ---- screens ----

function PairScreen({ onPaired }) {
	const { C, st } = useTheme();
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState("");
	const [scanning, setScanning] = useState(false);

	const pairWith = async (codeOrPayload) => {
		setErr("");
		setBusy(true);
		try {
			await R.pair(codeOrPayload);
			onPaired();
		} catch (e) {
			setErr(e.message || String(e));
		} finally {
			setBusy(false);
		}
	};
	const onScan = (value) => {
		setScanning(false);
		let payload = value;
		try {
			payload = JSON.parse(value); // the QR holds the pairing payload as JSON
		} catch (_) {}
		pairWith(payload);
	};

	if (scanning) return <QRScanner onScanned={onScan} onCancel={() => setScanning(false)} theme={C} />;

	return (
		<Card title="Pair with your PC">
			<Text style={st.hint}>On your PC, open Mercify ▸ Lobby ▸ Phone remote and tap “Pair a phone”.{cameraAvailable ? " Scan the QR it shows, or type the code." : " Type the code it shows here."}</Text>
			{cameraAvailable ? (
				<>
					<Button title="Scan QR code" kind="primary" onPress={() => setScanning(true)} disabled={busy} />
					<Text style={[st.hint, { textAlign: "center" }]}>or</Text>
				</>
			) : null}
			<TextInput value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="PC code" placeholderTextColor={C.faint} autoCapitalize="characters" autoCorrect={false} style={st.field} />
			<Button title={busy ? "Pairing…" : "Pair"} kind={cameraAvailable ? "plain" : "primary"} onPress={() => pairWith(code.trim())} disabled={busy || code.trim().length < 8} />
			{err ? <Text style={st.error}>{err}</Text> : null}
		</Card>
	);
}

function NowPlaying({ player }) {
	const { st } = useTheme();
	// Interpolate position between state pushes so the bar moves smoothly.
	const [tick, setTick] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setTick((n) => n + 1), 1000);
		return () => clearInterval(id);
	}, []);
	const empty = !player || player.empty || !player.name;
	const pos = empty ? 0 : (player.isPlaying && player.at ? player.position + (Date.now() - player.at) : player.position) || 0;
	const dur = empty ? 0 : player.duration || 0;
	const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
	void tick;
	return (
		<Card>
			<View style={st.np}>
				{player && player.image ? <Image source={{ uri: player.image }} style={st.art} /> : <View style={[st.art, st.artPh]} />}
				<View style={{ flex: 1, minWidth: 0 }}>
					<Text numberOfLines={1} style={st.npTitle}>
						{empty ? "Nothing playing" : player.name}
					</Text>
					<Text numberOfLines={1} style={st.npArtist}>
						{empty ? "on your PC" : (player.artists || []).join(", ")}
					</Text>
				</View>
			</View>
			<View style={st.barRow}>
				<Text style={st.time}>{fmt(pos)}</Text>
				<View style={st.bar}>
					<View style={[st.fill, { width: `${pct}%` }]} />
				</View>
				<Text style={st.time}>{fmt(dur)}</Text>
			</View>
			<View style={st.transport}>
				<IconButton label="⏮" onPress={() => R.send("prev")} />
				<IconButton big label={player && player.isPlaying ? "⏸" : "▶"} onPress={() => R.send("togglePlay")} />
				<IconButton label="⏭" onPress={() => R.send("next")} />
			</View>
			<View style={st.subRow}>
				<Button small title="Shuffle" onPress={() => R.send("toggleShuffle")} />
				<Button small title="♥ Like" onPress={() => R.send("toggleLike")} />
				<Button small title="Vol −" onPress={() => R.send("setVolume", { level: Math.max(0, ((player && player.volume) || 0.8) - 0.1) })} />
				<Button small title="Vol +" onPress={() => R.send("setVolume", { level: Math.min(1, ((player && player.volume) || 0.8) + 0.1) })} />
			</View>
		</Card>
	);
}

function LobbyCard({ lobby }) {
	const { C, st } = useTheme();
	const [code, setCode] = useState("");
	const joined = lobby && lobby.status === "joined";
	return (
		<Card title="Listening lobby">
			{joined ? (
				<>
					<Text style={st.hint}>
						{lobby.role === "host" ? "Hosting" : `Listening with ${lobby.hostName || "the host"}`} · {lobby.displayCode}
					</Text>
					<Button title="Leave lobby" kind="danger" small onPress={() => R.send("leaveLobby")} />
				</>
			) : (
				<>
					<Text style={st.hint}>Join a friend's lobby on your PC from here.</Text>
					<TextInput value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="Lobby code" placeholderTextColor={C.faint} autoCapitalize="characters" autoCorrect={false} style={st.field} />
					<Button
						title="Join on PC"
						onPress={() => {
							R.send("joinLobby", { code: code.trim() });
							setCode("");
						}}
						disabled={code.trim().length < 4}
					/>
				</>
			)}
		</Card>
	);
}

function ListenCard() {
	const { st } = useTheme();
	const [a, setA] = useState(Audio.get());
	useEffect(() => Audio.subscribe(setA), []);
	const label = a.on ? (a.status === "playing" ? "Listening — tap to stop" : a.status === "error" ? "Couldn't connect — tap to retry" : "Connecting…") : "Listen on this phone";
	return (
		<Card title="Audio">
			<Text style={st.hint}>Hear your PC's sound on this phone. Works on your home network; away from home needs a TURN key set on the PC.</Text>
			<Button title={label} kind={a.on && a.status === "playing" ? "danger" : "primary"} onPress={() => Audio.toggle()} />
		</Card>
	);
}

function SearchCard() {
	const { C, st } = useTheme();
	const [q, setQ] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState("");
	const [tracks, setTracks] = useState([]);
	const [queued, setQueued] = useState({}); // uri -> true, for brief "Queued" feedback

	const run = async () => {
		const query = q.trim();
		if (!query) return;
		setErr("");
		setBusy(true);
		try {
			const res = await R.request("search", { query });
			setTracks((res && res.tracks ? res.tracks : []).filter((t) => t && t.uri).slice(0, 25));
		} catch (e) {
			setErr(e.message || String(e));
			setTracks([]);
		}
		setBusy(false);
	};
	const queue = async (uri) => {
		try {
			await R.send("addToQueue", { uri });
			setQueued((m) => ({ ...m, [uri]: true }));
			setTimeout(() => setQueued((m) => ({ ...m, [uri]: false })), 1500);
		} catch (_) {}
	};

	return (
		<Card title="Search">
			<View style={st.searchRow}>
				<TextInput value={q} onChangeText={setQ} onSubmitEditing={run} returnKeyType="search" placeholder="Songs to play on your PC" placeholderTextColor={C.faint} style={[st.field, { flex: 1, letterSpacing: 0 }]} />
				<Button title={busy ? "…" : "Go"} kind="primary" small onPress={run} disabled={busy || !q.trim()} />
			</View>
			{err ? <Text style={st.error}>{err}</Text> : null}
			{tracks.map((t) => (
				<View key={t.uri} style={st.result}>
					{t.image ? <Image source={{ uri: t.image }} style={st.resultArt} /> : <View style={[st.resultArt, st.artPh]} />}
					<Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => R.send("playTrack", { uri: t.uri })}>
						<Text numberOfLines={1} style={st.resultTitle}>{t.name}</Text>
						<Text numberOfLines={1} style={st.resultArtist}>{(t.artists || []).join(", ")}</Text>
					</Pressable>
					<Pressable onPress={() => queue(t.uri)} style={st.queueBtn}>
						<Text style={st.queueText}>{queued[t.uri] ? "✓" : "＋"}</Text>
					</Pressable>
				</View>
			))}
			{!busy && !err && tracks.length === 0 ? <Text style={st.hint}>Tap a result to play it on the PC now, or ＋ to add it to the queue.</Text> : null}
		</Card>
	);
}

function RemoteScreen({ snap }) {
	const { C, st } = useTheme();
	const pc = (snap.paired || [])[0];
	const online = pc && pc.online;
	return (
		<>
			<Card>
				<View style={st.pcRow}>
					<View style={[st.dot, { backgroundColor: online ? C.accent : C.faint }]} />
					<Text style={st.pcName}>{pc ? pc.name : "PC"}</Text>
					<Text style={[st.hint, { marginLeft: "auto", marginBottom: 0 }]}>{online ? "Connected" : "Reconnecting…"}</Text>
				</View>
			</Card>
			<NowPlaying player={snap.state && snap.state.player} />
			<SearchCard />
			<ListenCard />
			<LobbyCard lobby={snap.state && snap.state.lobby} />
			<Button title="Unpair this PC" kind="danger" small onPress={() => pc && R.forget(pc.fid)} />
		</>
	);
}

function Main() {
	const { C, st, name } = useTheme();
	const [snap, setSnap] = useState(R.get());
	const [step, setStep] = useState("Starting Mercify");
	const [started, setStarted] = useState(false);
	const problemList = useProblems();

	useEffect(() => {
		let off = () => {};
		let at = "Starting";
		R.init((x) => {
			at = x;
			console.log("[mercify] startup:", x);
			setStep(x);
		}).then(
			() => {
				off = R.subscribe(setSnap);
				setStarted(true);
			},
			(err) => addProblem(`Startup failed at "${at}": ${err && err.stack ? err.stack : err}`)
		);
		if (Platform.OS === "android" && Platform.Version >= 33) PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS").catch(() => {});
		const sub = AppState.addEventListener("change", () => {});
		return () => {
			off();
			sub.remove();
		};
	}, []);

	const paired = (snap.paired || []).length > 0;

	return (
		<SafeAreaView style={st.screen} edges={["top", "left", "right", "bottom"]}>
			<StatusBar barStyle={C.dark ? "light-content" : "dark-content"} backgroundColor={C.bg} />
			<ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
				<View style={st.header}>
					<View style={st.brand}>
						<Image source={require("./assets/logo.png")} style={st.headerLogo} resizeMode="contain" />
						<Text style={st.logoText}>Mercify</Text>
					</View>
					<Text style={st.tag}>Remote</Text>
				</View>
				{!started ? (
					<Card>
						<Text style={st.hint}>{step}…</Text>
					</Card>
				) : paired ? (
					<RemoteScreen snap={snap} />
				) : (
					<PairScreen onPaired={() => setSnap(R.get())} />
				)}
				<ThemeCard />
				<Problems list={problemList} />
			</ScrollView>
		</SafeAreaView>
	);
}

export default function App() {
	return (
		<SafeAreaProvider>
			<ThemeProvider>
				<Main />
			</ThemeProvider>
		</SafeAreaProvider>
	);
}

function makeStyles(C) {
	return StyleSheet.create({
		screen: { flex: 1, backgroundColor: C.bg },
		scroll: { padding: 16, gap: 12 },
		header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
		brand: { flexDirection: "row", alignItems: "center", gap: 9 },
		headerLogo: { height: 30, width: 30, borderRadius: 7 },
		logoText: { color: C.text, fontSize: 24, fontWeight: "800" },
		tag: { color: C.faint, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },

		card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14, gap: 10 },
		cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
		cardTitle: { color: C.text, fontSize: 16, fontWeight: "700" },
		hint: { color: C.dim, fontSize: 13, lineHeight: 18 },
		error: { color: C.bad, fontSize: 13 },
		mono: { color: C.dim, fontSize: 11, fontFamily: Platform.OS === "android" ? "monospace" : "Menlo", marginTop: 4 },

		field: { backgroundColor: C.field, borderWidth: 1, borderColor: C.fieldLine, borderRadius: 10, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, letterSpacing: 2 },

		btn: { backgroundColor: C.row, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 14, alignItems: "center", borderWidth: 1, borderColor: C.fieldLine },
		btnPrimary: { backgroundColor: C.accent, borderColor: C.accent },
		btnDanger: { backgroundColor: "transparent", borderColor: "rgba(255,107,107,0.5)" },
		btnSmall: { paddingVertical: 8, paddingHorizontal: 10 },
		btnText: { color: C.text, fontSize: 15, fontWeight: "700" },

		themeRow: { flexDirection: "row", gap: 8 },
		swatch: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center", gap: 6 },
		swatchDot: { width: 18, height: 18, borderRadius: 9 },
		swatchLabel: { fontSize: 12, fontWeight: "700" },

		pcRow: { flexDirection: "row", alignItems: "center", gap: 8 },
		dot: { width: 9, height: 9, borderRadius: 5 },
		pcName: { color: C.text, fontSize: 16, fontWeight: "700" },

		np: { flexDirection: "row", alignItems: "center", gap: 12 },
		art: { width: 64, height: 64, borderRadius: 8, backgroundColor: C.row },
		artPh: { borderWidth: 1, borderColor: C.line },
		npTitle: { color: C.text, fontSize: 17, fontWeight: "700" },
		npArtist: { color: C.dim, fontSize: 13, marginTop: 2 },

		barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
		time: { color: C.faint, fontSize: 11, width: 36, textAlign: "center" },
		bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.row, overflow: "hidden" },
		fill: { height: 4, borderRadius: 2, backgroundColor: C.accent },

		transport: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 22, marginTop: 2 },
		icon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: C.row },
		iconBig: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.accent },
		iconText: { color: C.text, fontSize: 20 },

		subRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },

		searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
		result: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
		resultArt: { width: 44, height: 44, borderRadius: 6, backgroundColor: C.row },
		resultTitle: { color: C.text, fontSize: 15, fontWeight: "600" },
		resultArtist: { color: C.dim, fontSize: 12, marginTop: 1 },
		queueBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: C.row, borderWidth: 1, borderColor: C.fieldLine },
		queueText: { color: C.accent, fontSize: 20, fontWeight: "700" },

		scanWrap: { flex: 1, minHeight: 420, borderRadius: 14, overflow: "hidden", backgroundColor: "#000" },
	});
}
