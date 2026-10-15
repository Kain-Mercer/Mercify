// Friends test: several Mercify installs (friends.js + lobby.js) talking through in-memory
// stand-in relays, so it runs anywhere in a few seconds (CI runs it on every build).
//
//   node tools/friends-test.js
//
// Covers: friend requests through a lobby (accept, decline, an answer that only arrives on the
// friends channel), presence and "listening to", sharing turned off, request to join (accept
// starts a lobby and the requester joins it; decline; join requests turned off), removing a
// friend, keeping friends across restarts, going offline, and that relays only ever see
// ciphertext on unguessable topics.

const { EventEmitter } = require("events");
const { createFriends, fidOf } = require("../friends");
const { createLobby, generateCode, formatCode } = require("../lobby");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  (" + detail + ")" : ""}`);
	if (!ok) failures++;
}
async function until(fn, ms = 4000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (fn()) return true;
		await sleep(25);
	}
	return !!fn();
}

// ---------------------------------------------------------------- stand-in MQTT relays

const RELAYS = ["wss://relay-a.test/mqtt", "wss://relay-b.test/mqtt"];
const wire = []; // every payload any relay saw: { topic, buf }
const brokers = new Map(); // url -> Map(topic -> Set(client))

function fakeConnect(url) {
	if (!brokers.has(url)) brokers.set(url, new Map());
	const subs = brokers.get(url);
	const c = new EventEmitter();
	c.connected = false;
	const mine = new Set();
	c.subscribe = (t) => {
		for (const topic of [].concat(t)) {
			if (!subs.has(topic)) subs.set(topic, new Set());
			subs.get(topic).add(c);
			mine.add(topic);
		}
	};
	c.unsubscribe = (topic) => {
		subs.get(topic)?.delete(c);
		mine.delete(topic);
	};
	c.publish = (topic, buf) => {
		wire.push({ topic, buf });
		// like a real relay: delivered a moment later, to every subscriber (the sender too)
		for (const s of subs.get(topic) || []) setTimeout(() => s.connected && s.emit("message", topic, Buffer.from(buf)), 5 + Math.random() * 20);
	};
	c.end = () => {
		c.connected = false;
		for (const t of mine) subs.get(t)?.delete(c);
		c.emit("close");
	};
	setTimeout(() => {
		c.connected = true;
		c.emit("connect");
	}, 20);
	return c;
}

// ---------------------------------------------------------------- one Mercify install

function memStore(initial = null) {
	let data = initial;
	return { load: () => (data ? JSON.parse(JSON.stringify(data)) : null), save: (d) => (data = JSON.parse(JSON.stringify(d))), get data() { return data; } };
}

function install(name, store = memStore()) {
	const toasts = [];
	const events = [];
	const player = { uri: null, isPlaying: false };
	let lobby; // eslint-disable-line prefer-const
	const friends = createFriends({
		store,
		relays: RELAYS,
		connect: fakeConnect,
		lobbyCode: async () => {
			const st = lobby.state();
			if (st.status === "joined") return st.code;
			await lobby.join(formatCode(generateCode()));
			return lobby.state().code;
		},
	});
	lobby = createLobby({
		command: async (action, args) => {
			if (action === "playTrack") Object.assign(player, { uri: args.uri, isPlaying: true });
		},
		relays: RELAYS,
		connect: fakeConnect,
		friendPub: friends.pub,
		connectTimeoutMs: 2000,
	});
	lobby.setName(name);
	friends.setName(name);
	friends.on("toast", (t) => toasts.push(t));
	for (const e of ["join-request", "add-request", "join", "join-request-ended"]) friends.on(e, (d) => events.push({ e, ...d }));
	// what main.js does
	friends.on("join", ({ code }) => lobby.join(code).catch(() => {}));
	lobby.on("friend", ({ ty, memberId, name: n, fpub }) => {
		if (ty === "friend-add") friends.receiveAdd({ pub: fpub, name: n }, (type) => lobby.friendSend(memberId, type));
		else friends.receiveAddReply({ pub: fpub, name: n }, ty === "friend-ok");
	});
	lobby.on("change", () => {
		const st = lobby.state();
		friends.setPresence({ track: null, playing: false, inLobby: st.status === "joined", host: st.role === "host" });
	});
	friends.start();
	const me = { name, friends, lobby, toasts, events, store };
	me.friendOf = (other) => friends.state().friends.find((f) => f.fid === other.friends.fid);
	me.last = (e) => [...events].reverse().find((x) => x.e === e);
	return me;
}

// Right-click someone in the lobby -> Add friend (what main.js's "friends:add" does)
function addFriendInLobby(from, to) {
	const m = from.lobby.state().members.find((x) => x.fid === to.friends.fid);
	if (!m) throw new Error(`${to.name} isn't in ${from.name}'s lobby`);
	const mem = from.lobby.member(m.id);
	const r = from.friends.startAdd({ pub: mem.fpub, name: mem.name });
	if (r !== "accepted") from.lobby.friendSend(m.id, "friend-add");
	return r;
}

(async () => {
	const al = install("Al");
	const bea = install("Bea");
	const cy = install("Cy");

	check("each install has its own friend id", al.friends.fid !== bea.friends.fid && al.friends.fid === fidOf(al.friends.pub));

	// ---------------------------------------------------------------- meeting in a lobby
	const code = generateCode();
	await al.lobby.join(code);
	await bea.lobby.join(code);
	await cy.lobby.join(code);
	await until(() => al.lobby.state().members.length === 3 && al.lobby.state().members.every((m) => m.fid));
	check("lobby members carry their friend ids", al.lobby.state().members.every((m) => m.fid), al.lobby.state().members.map((m) => `${m.name}:${m.fid}`).join(" "));

	// ---------------------------------------------------------------- profile pictures in the lobby
	const PIC = "data:image/jpeg;base64," + Buffer.from("not really a jpeg, but the right shape " + "x".repeat(3000)).toString("base64");
	al.lobby.setAvatar(PIC);
	await until(() => bea.lobby.state().members.find((m) => m.fid === al.friends.fid)?.av === PIC);
	check("lobby members see a new profile picture", bea.lobby.state().members.find((m) => m.fid === al.friends.fid)?.av === PIC);
	const dan = install("Dan");
	await dan.lobby.join(code);
	await until(() => dan.lobby.state().members.find((m) => m.fid === al.friends.fid)?.av === PIC);
	check("someone joining later gets it too", dan.lobby.state().members.find((m) => m.fid === al.friends.fid)?.av === PIC);
	await dan.lobby.leave();
	bea.lobby.setAvatar("javascript:alert(1)");
	await sleep(300);
	check("anything that isn't a picture is ignored", !al.lobby.state().members.find((m) => m.fid === bea.friends.fid)?.av);

	// ---------------------------------------------------------------- friend request, accepted
	check("Al sends Bea a friend request", addFriendInLobby(al, bea) === "sent");
	await until(() => bea.friends.state().requests.some((r) => r.kind === "add"));
	const req = bea.friends.state().requests.find((r) => r.kind === "add");
	check("Bea sees the request, named", req?.name === "Al" && req.fid === al.friends.fid, JSON.stringify(req));
	check("Al's side shows it as sent", al.friends.state().pendingAdds.includes(bea.friends.fid));
	bea.friends.acceptAdd(al.friends.fid);
	await until(() => al.friendOf(bea) && bea.friendOf(al));
	check("accepting makes them friends on both sides", !!al.friendOf(bea) && !!bea.friendOf(al));
	check("both are told", al.toasts.some((t) => /Bea are now friends/.test(t)) && bea.toasts.some((t) => /Al are now friends/.test(t)));
	check("friends are saved", al.store.data.friends.some((f) => f.fid === bea.friends.fid) && bea.store.data.friends.some((f) => f.fid === al.friends.fid));

	// ---------------------------------------------------------------- friend request, declined
	addFriendInLobby(cy, bea);
	await until(() => bea.friends.state().requests.some((r) => r.kind === "add" && r.fid === cy.friends.fid));
	bea.friends.declineAdd(cy.friends.fid);
	await until(() => cy.toasts.some((t) => /declined your friend request/.test(t)));
	check("declining tells the sender", cy.toasts.some((t) => /Bea declined your friend request/.test(t)));
	check("declined: not friends", !cy.friendOf(bea) && !bea.friendOf(cy) && !cy.friends.state().pendingAdds.length);

	// ---------------------------------------------------------------- answered after the sender left the lobby
	addFriendInLobby(cy, al);
	await until(() => al.friends.state().requests.some((r) => r.kind === "add"));
	await cy.lobby.leave(); // the lobby's "friend-ok" can't reach Cy any more
	await sleep(100);
	al.friends.acceptAdd(cy.friends.fid);
	await until(() => cy.friendOf(al));
	check("the answer still arrives on the friends channel", !!cy.friendOf(al) && !!al.friendOf(cy));

	// ---------------------------------------------------------------- presence
	await al.lobby.leave();
	await bea.lobby.leave();
	al.friends.setPresence({ track: { uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", name: "Never Gonna Give You Up", artists: ["Rick Astley"] }, playing: true, inLobby: false });
	await until(() => bea.friendOf(al)?.track?.name === "Never Gonna Give You Up");
	const seen = bea.friendOf(al);
	check("friends see you online with the song you're playing", seen?.online && seen.playing && seen.track?.artists?.[0] === "Rick Astley", JSON.stringify(seen));
	check("and that you can be asked to join", seen?.joinable === true);

	al.friends.setOptions({ share: false });
	await until(() => bea.friendOf(al)?.track === null);
	check("sharing off: friends don't see the song", bea.friendOf(al)?.track === null && bea.friendOf(al)?.online);
	al.friends.setOptions({ share: true });

	al.friends.setAvatar(PIC);
	await until(() => bea.friendOf(al)?.av === PIC);
	check("friends get your profile picture", bea.friendOf(al)?.av === PIC);
	check("and keep it for when you're offline", bea.store.data.friends.find((f) => f.fid === al.friends.fid)?.av === PIC);
	al.friends.setAvatar(null);
	await until(() => bea.friendOf(al)?.av === null);
	check("removing it removes it for friends", bea.friendOf(al)?.av === null);
	al.friends.setAvatar(PIC);

	// ---------------------------------------------------------------- request to join, accepted
	check("Al isn't in a lobby", al.lobby.state().status === "idle");
	bea.friends.requestJoin(al.friends.fid);
	check("the button shows it's waiting", bea.friendOf(al)?.requested === true);
	let threw = null;
	try {
		bea.friends.requestJoin(al.friends.fid);
	} catch (err) {
		threw = err.message;
	}
	check("asking twice is refused", /already asked/.test(threw || ""), threw);
	await until(() => al.friends.state().requests.some((r) => r.kind === "join"));
	check("Al is asked", al.last("join-request")?.name === "Bea");
	await al.friends.answerJoin(bea.friends.fid, true);
	check("accepting starts a lobby", al.lobby.state().status === "joined" && al.lobby.state().role === "host");
	await until(() => bea.lobby.state().status === "joined" && bea.lobby.state().members.length === 2, 8000);
	const bl = bea.lobby.state();
	check("Bea joins it automatically", bl.status === "joined" && bl.code === al.lobby.state().code && bl.hostName === "Al", `${bl.status} ${bl.code} host ${bl.hostName}`);
	check("the request is cleared on both sides", !al.friends.state().requests.length && !bea.friendOf(al)?.requested);
	await until(() => cy.friendOf(al)?.inLobby && cy.friendOf(al)?.host);
	check("other friends see Al hosting a lobby", cy.friendOf(al)?.host === true);

	// ---------------------------------------------------------------- request to join someone already in a lobby
	cy.friends.requestJoin(al.friends.fid);
	await until(() => al.friends.state().requests.some((r) => r.kind === "join" && r.fid === cy.friends.fid));
	await al.friends.answerJoin(cy.friends.fid, true);
	await until(() => cy.lobby.state().status === "joined" && al.lobby.state().members.length === 3, 8000);
	check("joining a friend who's already in a lobby uses that lobby", cy.lobby.state().code === al.lobby.state().code && al.lobby.state().members.length === 3);
	await cy.lobby.leave();

	// ---------------------------------------------------------------- declined, and turned off
	cy.friends.requestJoin(al.friends.fid);
	await until(() => al.friends.state().requests.some((r) => r.kind === "join" && r.fid === cy.friends.fid));
	await al.friends.answerJoin(cy.friends.fid, false);
	await until(() => cy.toasts.some((t) => /declined your request to join/.test(t)));
	check("declining tells the requester", cy.toasts.some((t) => /Al declined your request to join/.test(t)) && !cy.friendOf(al).requested);
	check("and they wait a moment before asking again", cy.friendOf(al).cooldown === true);

	al.friends.setOptions({ allowJoin: false });
	await until(() => cy.friendOf(al)?.joinable === false);
	threw = null;
	try {
		cy.friends.requestJoin(al.friends.fid);
	} catch (err) {
		threw = err.message;
	}
	check("join requests off: friends can't ask", cy.friendOf(al).joinable === false && /isn't taking join requests/.test(threw || ""), threw);
	al.friends.setOptions({ allowJoin: true });

	// ---------------------------------------------------------------- remove
	bea.friends.removeFriend(al.friends.fid);
	await until(() => !al.friendOf(bea) && !bea.friendOf(al));
	check("removing a friend removes you from their list too", !al.friendOf(bea) && !bea.friendOf(al));
	check("and from the saved file", !al.store.data.friends.some((f) => f.fid === bea.friends.fid));

	// ---------------------------------------------------------------- restart
	const alStore = al.store.data;
	await al.lobby.leave();
	al.friends.stop();
	await until(() => cy.friendOf(al)?.online === false);
	check("quitting shows you offline straight away", cy.friendOf(al)?.online === false);
	const al2 = install("Al", memStore(alStore));
	check("same friend id after a restart", al2.friends.fid === al.friends.fid);
	check("friends are still there", al2.friends.state().friends.some((f) => f.fid === cy.friends.fid));
	await until(() => cy.friendOf(al2)?.online && al2.friendOf(cy)?.online);
	check("coming back online: both see each other straight away", cy.friendOf(al2)?.online && al2.friendOf(cy)?.online);

	// ---------------------------------------------------------------- what the relays saw
	const plain = Buffer.concat(wire.map((w) => w.buf)).toString("latin1");
	const leaks = ["Never Gonna", "Rick Astley", "4uLU6hMCjMI75M1A2tKUQC", al2.friends.pub, '"jok"', '"Bea"'].filter((s) => plain.includes(s));
	check("relays only see ciphertext", leaks.length === 0, leaks.join(", "));
	const friendTopics = new Set(wire.map((w) => w.topic));
	check("topics are random-looking", [...friendTopics].every((t) => /^mercify\/v1\/[0-9a-f]{32}$/.test(t)), [...friendTopics].slice(0, 3).join(" "));

	console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
	process.exit(failures ? 1 : 0);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
