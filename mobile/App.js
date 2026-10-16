// Mercify for Android: spike. Join a desktop lobby, follow the host on this phone's Spotify,
// suggest songs, vote skip, friends, and a test panel to find out how Spotify takes orders.
import React, { useEffect, useState, useCallback } from "react";
import { AppState, PermissionsAndroid, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, Alert } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { spotify, nativeMissing } from "./src/spotify";
import * as M from "./src/mercify";

// Settings' Classic theme
const C = { bg: "#0d0f13", card: "#15181e", row: "#1b1f26", line: "rgba(255,255,255,0.07)", field: "#0d0f13", fieldLine: "rgba(255,255,255,0.12)", text: "#f2f3f5", dim: "#b4b8c1", faint: "#8b909b", accent: "#1ed760", onAccent: "#06240f", warn: "#ffb547", bad: "#ff6b6b" };

const METHODS = [
	{ id: "uri", label: "Media session", hint: "Stays in Mercify, if Spotify allows it" },
	{ id: "mediaId", label: "Media ID", hint: "Another media-session route" },
	{ id: "link", label: "Open link", hint: "Always works, but flips to Spotify" },
];

// Errors anywhere in the app's JavaScript are kept and shown (on the start screen, or in the
// Problems card), since a test build has no other way to tell us what went wrong.
const problems = [];
const problemListeners = new Set();
function addProblem(text) {
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

function Card({ title, right, children }) {
	return (
		<View style={st.card}>
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

function Check({ ok, label, action }) {
	return (
		<View style={st.checkRow}>
			<Text style={[st.checkMark, { color: ok ? C.accent : C.warn }]}>{ok ? "✓" : "!"}</Text>
			<Text style={st.checkLabel}>{label}</Text>
			{!ok && action}
		</View>
	);
}

function Main() {
	const [s, setS] = useState(null);
	const [access, setAccess] = useState(null);
	const [installed, setInstalled] = useState(null);
	const [codeText, setCodeText] = useState("");
	const [nameText, setNameText] = useState("");
	const [suggest, setSuggest] = useState("");
	const [testUri, setTestUri] = useState("spotify:track:4cOdK2wGLETKBW3PvgPWqT");
	const [report, setReport] = useState(null);
	const [busy, setBusy] = useState(false);
	const [step, setStep] = useState("Starting Mercify");
	const problemList = useProblems();

	const checkSetup = useCallback(async () => {
		const a = await spotify.hasAccess();
		setAccess(a);
		setInstalled(await spotify.isInstalled());
		if (a) {
			await spotify.start();
			await spotify.refresh().catch(() => {});
		}
	}, []);

	useEffect(() => {
		let off = () => {};
		if (nativeMissing) addProblem("Mercify's Spotify module didn't load (MercifySpotify is missing).");
		let at = "Starting";
		M.init((x) => {
			at = x;
			setStep(x);
		}).then(
			() => {
				off = M.subscribe((x) => setS(x));
				setNameText(M.getLobby().state().name || "");
			},
			(err) => addProblem(`Startup failed at "${at}": ${err && err.stack ? err.stack : err}`)
		);
		checkSetup().catch((err) => addProblem(`Checking Spotify: ${err.message || err}`));
		if (Platform.OS === "android" && Platform.Version >= 33) PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS").catch(() => {});
		const sub = AppState.addEventListener("change", (x) => x === "active" && checkSetup());
		return () => {
			off();
			sub.remove();
		};
	}, [checkSetup]);

	useEffect(() => {
		if (s && s.name && !nameText) setNameText(s.name);
		if (s && s.lastCode && !codeText) setCodeText(s.lastCode);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [s && s.name, s && s.lastCode]);

	if (!s || !s.lobby) {
		return (
			<ScrollView style={st.screen} contentContainerStyle={{ padding: 16, paddingTop: 80 }}>
				<Text style={[st.logo, { textAlign: "center" }]}>Mercify</Text>
				<Text style={[st.dim, { textAlign: "center", marginTop: 8, marginBottom: 24 }]}>{step}…</Text>
				<Problems list={problemList} />
			</ScrollView>
		);
	}

	const L = s.lobby;
	const F = s.friends;
	const p = s.player;
	const joined = L.status === "joined";
	const connecting = L.status === "connecting";
	const listener = joined && L.role === "listener";
	const following = listener && L.current && p && p.uri === L.current.uri;

	const run = async (fn) => {
		setBusy(true);
		try {
			await fn();
		} catch (err) {
			Alert.alert("Mercify", err.message || String(err));
		} finally {
			setBusy(false);
		}
	};

	const doJoin = () =>
		run(async () => {
			if (!nameText.trim()) throw new Error("Pick a name first, so the lobby knows who you are.");
			M.setName(nameText.trim());
			await M.join(codeText);
		});

	const doSuggest = () =>
		run(async () => {
			const uri = M.spotifyUriFrom(suggest);
			if (!uri) throw new Error("Paste a Spotify song link (Share → Copy link in Spotify).");
			let name = null;
			let image = null;
			try {
				const id = uri.split(":")[2];
				const r = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${id}`);
				const j = await r.json();
				name = j.title || null;
				image = j.thumbnail_url || null;
			} catch (_) {}
			await M.getLobby().queueAdd({ uri, name: name || "Song from Spotify", artists: [], image, duration: 0 });
			setSuggest("");
		});

	return (
		<ScrollView style={st.screen} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
			<View style={st.header}>
				<Text style={st.logo}>Mercify</Text>
				<Text style={st.tag}>Android test build</Text>
			</View>

			{(!access || !installed || !s.name) && (
				<Card title="Set up">
					<Check ok={!!installed} label="Spotify is installed" />
					<Check ok={!!access} label="Mercify can see and control Spotify" action={<Button small title="Allow" onPress={() => spotify.openAccessSettings()} />} />
					{!access && <Text style={st.hint}>Android calls this “Notification access”. Mercify only uses it to see what Spotify is playing and control it, like your lock screen does.</Text>}
					<Check ok={!!s.name} label={s.name ? `Your name: ${s.name}` : "Pick a name for lobbies"} />
				</Card>
			)}

			<Card title="Listening lobby" right={joined ? <Text style={st.dim}>{L.relays.connected}/{L.relays.total} relays</Text> : null}>
				{!joined && !connecting && (
					<>
						<Text style={st.label}>Your name</Text>
						<TextInput style={st.input} value={nameText} onChangeText={setNameText} onEndEditing={() => nameText.trim() && M.setName(nameText.trim())} placeholder="Name" placeholderTextColor={C.faint} maxLength={24} />
						<Text style={st.label}>Lobby code</Text>
						<TextInput style={[st.input, st.code]} value={codeText} onChangeText={setCodeText} placeholder="ABCD-1234" placeholderTextColor={C.faint} autoCapitalize="characters" autoCorrect={false} />
						<Button kind="primary" title="Join lobby" onPress={doJoin} disabled={busy || !access} />
						{!access && <Text style={st.hint}>Allow Mercify to control Spotify first (above).</Text>}
						{L.error ? <Text style={[st.hint, { color: C.bad }]}>{L.error}</Text> : null}
					</>
				)}
				{connecting && (
					<>
						<Text style={st.big}>Joining {L.displayCode}…</Text>
						<Button title="Cancel" onPress={() => M.leave()} />
					</>
				)}
				{joined && (
					<>
						<View style={st.rowBetween}>
							<View>
								<Text style={[st.big, st.code]}>{L.displayCode}</Text>
								<Text style={st.dim}>{L.role === "host" ? "You're the host" : `Host: ${L.hostName}`}</Text>
							</View>
							<Button kind="danger" small title="Leave" onPress={() => M.leave()} />
						</View>
						{L.role === "host" && <Text style={[st.hint, { color: C.warn }]}>You're hosting from the phone. This test build is made for joining a lobby a PC started; hosting may not work yet.</Text>}
					</>
				)}
			</Card>

			{joined && (
				<Card title="Playing for everyone">
					{L.current ? (
						<>
							<Text style={st.song}>{L.current.name}</Text>
							<Text style={st.dim}>{(L.current.artists || []).join(", ")}</Text>
							{L.now && L.now.by ? <Text style={st.faint}>Added by {L.now.by}</Text> : null}
						</>
					) : (
						<Text style={st.dim}>Nothing yet. Play a song on the host's Spotify.</Text>
					)}
					<View style={st.sep} />
					<Text style={st.label}>This phone's Spotify</Text>
					{p && !p.empty ? (
						<Text style={st.text}>
							{p.isPlaying ? "▶" : "❚❚"} {p.name} · {fmt(p.position)}
							{p.duration ? ` / ${fmt(p.duration)}` : ""}
						</Text>
					) : (
						<Text style={st.dim}>Not playing. Open Spotify once and play anything, then come back.</Text>
					)}
					{listener && L.current && <Text style={[st.hint, { color: following ? C.accent : C.warn }]}>{following ? "In sync with the host" : "Catching up with the host…"}</Text>}
					{L.current && (
						<View style={{ marginTop: 10 }}>
							<Button title={L.skip && L.skip.mine ? `Voted to skip (${L.skip.count}/${L.skip.need})` : L.skip ? `Vote to skip (${L.skip.count}/${L.skip.need})` : "Vote to skip"} onPress={() => M.getLobby().voteSkip(!(L.skip && L.skip.mine))} />
						</View>
					)}
				</Card>
			)}

			{joined && (
				<Card title={`In the lobby (${L.members.length})`}>
					{L.members.map((m) => {
						const isFriend = m.fid && F && F.friends.some((f) => f.fid === m.fid);
						return (
							<View key={m.id} style={st.listRow}>
								<Text style={st.text}>
									{m.name}
									{m.you ? " (you)" : ""}
								</Text>
								<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
									{m.role === "host" && <Text style={st.pill}>HOST</Text>}
									{!m.you && m.fid && !isFriend && (
										<Button
											small
											title={F && F.pendingAdds.includes(m.fid) ? "Asked" : "Add friend"}
											disabled={F && F.pendingAdds.includes(m.fid)}
											onPress={() => {
												const mem = M.getLobby().member(m.id);
												const r = M.getFriends().startAdd({ pub: mem.fpub, name: mem.name });
												if (r !== "accepted") M.getLobby().friendSend(m.id, "friend-add");
											}}
										/>
									)}
								</View>
							</View>
						);
					})}
				</Card>
			)}

			{joined && (
				<Card title="Session playlist">
					{(L.queue || []).length === 0 && <Text style={st.dim}>Nothing queued.</Text>}
					{(L.queue || []).slice(0, 8).map((q, i) => (
						<View key={q.qid} style={st.listRow}>
							<Text style={[st.text, { flex: 1 }]} numberOfLines={1}>
								{i + 1}. {q.name}
							</Text>
							<Text style={st.faint}>{q.by || ""}</Text>
						</View>
					))}
					<Text style={[st.label, { marginTop: 10 }]}>Suggest a song</Text>
					<TextInput style={st.input} value={suggest} onChangeText={setSuggest} placeholder="Paste a Spotify song link" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} />
					<Button title="Add to the session" onPress={doSuggest} disabled={busy || !suggest.trim()} />
				</Card>
			)}

			{F && (
				<Card title="Friends" right={<Text style={st.dim}>{F.friends.filter((f) => f.online).length} online</Text>}>
					{F.requests.map((r) => (
						<View key={r.kind + r.fid} style={st.request}>
							<Text style={st.text}>{r.kind === "add" ? `${r.name} sent you a friend request` : `${r.name} wants to listen with you`}</Text>
							<View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
								<Button small kind="primary" title="Accept" onPress={() => run(() => (r.kind === "add" ? M.getFriends().acceptAdd(r.fid) : M.getFriends().answerJoin(r.fid, true)))} />
								<Button small title="Decline" onPress={() => run(() => (r.kind === "add" ? M.getFriends().declineAdd(r.fid) : M.getFriends().answerJoin(r.fid, false)))} />
							</View>
						</View>
					))}
					{F.friends.length === 0 && <Text style={st.dim}>No friends yet. In a lobby, tap “Add friend” next to someone.</Text>}
					{F.friends.map((f) => (
						<View key={f.fid} style={st.listRow}>
							<View style={{ flex: 1 }}>
								<Text style={st.text}>
									<Text style={{ color: f.online ? C.accent : C.faint }}>● </Text>
									{f.name}
								</Text>
								{f.online && f.track ? (
									<Text style={st.faint} numberOfLines={1}>
										{f.playing ? "Listening to " : "Paused: "}
										{f.track.name}
									</Text>
								) : null}
							</View>
							{f.online && !joined && <Button small title="Ask to join" onPress={() => run(() => M.getFriends().requestJoin(f.fid))} />}
						</View>
					))}
				</Card>
			)}

			<Card title="Test: how Spotify takes orders">
				<Text style={st.hint}>Pick how Mercify starts a song on this phone, then try it. Tell Kain which ones work.</Text>
				{METHODS.map((m) => (
					<Pressable key={m.id} onPress={() => M.setMethod(m.id)} style={[st.option, s.method === m.id && st.optionOn]}>
						<Text style={[st.text, s.method === m.id && { color: C.accent }]}>{m.label}</Text>
						<Text style={st.faint}>{m.hint}</Text>
					</Pressable>
				))}
				<Text style={[st.label, { marginTop: 10 }]}>Song to play</Text>
				<TextInput style={st.input} value={testUri} onChangeText={setTestUri} autoCapitalize="none" autoCorrect={false} placeholderTextColor={C.faint} />
				<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
					<Button title="Play it" onPress={() => run(() => spotify.command("playTrack", { uri: M.spotifyUriFrom(testUri) || testUri }))} disabled={busy} />
					<Button title="Seek to 1:00" onPress={() => run(() => spotify.command("seek", { ms: 60000 }))} />
					<Button title="Play/pause" onPress={() => run(() => spotify.command("togglePlay"))} />
				</View>
				<Button title="What does Spotify report?" onPress={() => run(async () => setReport(await spotify.describe()))} />
				{report !== null && <Text style={st.mono}>{report ? JSON.stringify(report, null, 1) : "Spotify isn't running (or Mercify can't see it yet)."}</Text>}
			</Card>

			{joined && L.activity && L.activity.length > 0 && (
				<Card title="Activity">
					{L.activity.slice(-6).map((a, i) => (
						<Text key={i} style={st.faint}>
							{a.text}
						</Text>
					))}
				</Card>
			)}

			<Problems list={problemList} />

			{s.toasts.slice(-2).map((t) => (
				<Text key={t.id} style={st.toast}>
					{t.text}
				</Text>
			))}
		</ScrollView>
	);
}

export default function App() {
	return (
		<SafeAreaProvider>
			<StatusBar barStyle="light-content" backgroundColor={C.bg} />
			<SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
				<Main />
			</SafeAreaView>
		</SafeAreaProvider>
	);
}

const st = StyleSheet.create({
	screen: { flex: 1, backgroundColor: C.bg },
	header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 },
	logo: { color: C.text, fontSize: 26, fontWeight: "800" },
	tag: { color: C.faint, fontSize: 12 },
	card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
	cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
	cardTitle: { color: C.text, fontSize: 16, fontWeight: "700" },
	text: { color: C.text, fontSize: 15 },
	dim: { color: C.dim, fontSize: 14 },
	faint: { color: C.faint, fontSize: 13 },
	hint: { color: C.faint, fontSize: 13, marginTop: 6, marginBottom: 4 },
	label: { color: C.dim, fontSize: 13, marginBottom: 4 },
	big: { color: C.text, fontSize: 22, fontWeight: "700", marginBottom: 6 },
	song: { color: C.text, fontSize: 18, fontWeight: "700" },
	code: { letterSpacing: 2, fontVariant: ["tabular-nums"] },
	input: { backgroundColor: C.field, borderColor: C.fieldLine, borderWidth: 1, borderRadius: 8, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, marginBottom: 10 },
	btn: { backgroundColor: C.row, borderColor: C.line, borderWidth: 1, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14, alignItems: "center", marginTop: 4 },
	btnPrimary: { backgroundColor: C.accent, borderColor: C.accent },
	btnDanger: { borderColor: "rgba(255,107,107,0.5)" },
	btnSmall: { paddingVertical: 6, paddingHorizontal: 10, marginTop: 0 },
	btnText: { color: C.text, fontSize: 15, fontWeight: "600" },
	checkRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 10 },
	checkMark: { fontSize: 16, fontWeight: "800", width: 16 },
	checkLabel: { color: C.text, fontSize: 15, flex: 1 },
	rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
	listRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderTopColor: C.line, borderTopWidth: 1, gap: 8 },
	pill: { color: C.onAccent, backgroundColor: C.accent, fontSize: 11, fontWeight: "800", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
	sep: { height: 1, backgroundColor: C.line, marginVertical: 12 },
	request: { backgroundColor: C.row, borderRadius: 8, padding: 10, marginBottom: 8 },
	option: { borderColor: C.line, borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 6 },
	optionOn: { borderColor: C.accent, backgroundColor: "rgba(30,215,96,0.08)" },
	mono: { color: C.dim, fontFamily: "monospace", fontSize: 11, marginTop: 10 },
	toast: { color: C.text, backgroundColor: C.row, borderRadius: 8, padding: 10, marginTop: 6 },
});
