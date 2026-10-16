// Mercify for Android: a remote for the desktop Mercify. Pair once (type the code the PC shows,
// or scan its QR later), then control what's playing on the PC — play/skip/seek, pick lobbies —
// and see it here. The phone never plays Spotify itself; it drives the PC.
import React, { useEffect, useMemo, useState } from "react";
import { AppState, PermissionsAndroid, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, Image } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as R from "./src/remote";
import * as Audio from "./src/audio";

// Settings' Classic theme
const C = { bg: "#0d0f13", card: "#15181e", row: "#1b1f26", line: "rgba(255,255,255,0.07)", field: "#0d0f13", fieldLine: "rgba(255,255,255,0.12)", text: "#f2f3f5", dim: "#b4b8c1", faint: "#8b909b", accent: "#1ed760", onAccent: "#06240f", warn: "#ffb547", bad: "#ff6b6b" };

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
	return (
		<Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [st.btn, kind === "primary" && st.btnPrimary, kind === "danger" && st.btnDanger, small && st.btnSmall, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 }]}>
			<Text style={[st.btnText, kind === "primary" && { color: C.onAccent }, small && { fontSize: 13 }]}>{title}</Text>
		</Pressable>
	);
}

function Card({ title, right, children, style }) {
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
	return (
		<Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [st.icon, big && st.iconBig, (pressed || disabled) && { opacity: disabled ? 0.35 : 0.7 }]}>
			<Text style={[st.iconText, big && { fontSize: 26 }]}>{label}</Text>
		</Pressable>
	);
}

// ---- screens ----

function PairScreen({ onPaired }) {
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState("");
	const go = async () => {
		setErr("");
		setBusy(true);
		try {
			await R.pair(code.trim());
			onPaired();
		} catch (e) {
			setErr(e.message || String(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<Card title="Pair with your PC">
			<Text style={st.hint}>On your PC, open Mercify ▸ Lobby ▸ Phone remote and tap “Pair a phone”. Type the code it shows here.</Text>
			<TextInput
				value={code}
				onChangeText={(t) => setCode(t.toUpperCase())}
				placeholder="PC code"
				placeholderTextColor={C.faint}
				autoCapitalize="characters"
				autoCorrect={false}
				style={st.field}
			/>
			<Button title={busy ? "Pairing…" : "Pair"} kind="primary" onPress={go} disabled={busy || code.trim().length < 8} />
			{err ? <Text style={st.error}>{err}</Text> : null}
		</Card>
	);
}

function NowPlaying({ player }) {
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

function RemoteScreen({ snap }) {
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
			<ListenCard />
			<LobbyCard lobby={snap.state && snap.state.lobby} />
			<Button title="Unpair this PC" kind="danger" small onPress={() => pc && R.forget(pc.fid)} />
		</>
	);
}

function Main() {
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
			<StatusBar barStyle="light-content" backgroundColor={C.bg} />
			<ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
				<View style={st.header}>
					<Text style={st.logo}>Mercify</Text>
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
				<Problems list={problemList} />
			</ScrollView>
		</SafeAreaView>
	);
}

export default function App() {
	return (
		<SafeAreaProvider>
			<Main />
		</SafeAreaProvider>
	);
}

const st = StyleSheet.create({
	screen: { flex: 1, backgroundColor: C.bg },
	scroll: { padding: 16, gap: 12 },
	header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 2 },
	logo: { color: C.text, fontSize: 26, fontWeight: "800" },
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
});
