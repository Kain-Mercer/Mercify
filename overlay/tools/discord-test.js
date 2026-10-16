// Discord presence against a stand-in Discord pipe: handshake, the card for a playing YouTube
// video, nothing for Spotify or a paused video, no repeats for the same video, rate limiting,
// reconnecting after Discord restarts, and turning it off.
//   node tools/discord-test.js

const net = require("net");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { createDiscordPresence, activityFor, encode } = require("../discord");

const PIPE = process.platform === "win32" ? `\\\\?\\pipe\\mercify-discord-test-${process.pid}` : path.join(os.tmpdir(), `mercify-discord-test-${process.pid}.sock`);
const CLIENT_ID = "1560470833867268149";

let failures = 0;
const ok = (cond, what) => {
	console.log(`${cond ? "ok  " : "FAIL"}  ${what}`);
	if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (fn()) return true;
		await sleep(25);
	}
	return false;
}

// The stand-in Discord: answers the handshake with READY and records what it's sent.
function fakeDiscord() {
	const got = [];
	const socks = new Set();
	const server = net.createServer((s) => {
		socks.add(s);
		s.on("close", () => socks.delete(s));
		let buf = Buffer.alloc(0);
		s.on("data", (chunk) => {
			buf = Buffer.concat([buf, chunk]);
			while (buf.length >= 8) {
				const op = buf.readUInt32LE(0);
				const len = buf.readUInt32LE(4);
				if (buf.length < 8 + len) break;
				const msg = JSON.parse(buf.subarray(8, 8 + len).toString("utf8"));
				buf = buf.subarray(8 + len);
				got.push({ op, msg, at: Date.now() });
				if (op === 0) s.write(encode(1, { cmd: "DISPATCH", evt: "READY", data: { v: 1, user: { username: "kain" } } }));
				else if (op === 1) s.write(encode(1, { cmd: msg.cmd, evt: null, nonce: msg.nonce, data: msg.args?.activity || null }));
			}
		});
	});
	if (process.platform !== "win32") fs.rmSync(PIPE, { force: true });
	return new Promise((resolve) =>
		server.listen(PIPE, () =>
			resolve({
				got,
				sets: () => got.filter((g) => g.op === 1 && g.msg.cmd === "SET_ACTIVITY"),
				kick: () => socks.forEach((s) => s.destroy()),
				close: () => new Promise((r) => (socks.forEach((s) => s.destroy()), server.close(r))),
			}),
		),
	);
}

const video = (over = {}) => ({
	uri: "youtube:dQw4w9WgXcQ",
	name: "Rick Astley - Never Gonna Give You Up (Official Music Video)",
	artists: ["Rick Astley"],
	image: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
	duration: 213000,
	position: 10000,
	at: Date.now(),
	isPlaying: true,
	loading: false,
	source: "youtube",
	...over,
});

(async () => {
	// ---------------------------------------------------------------- the card itself
	const a = activityFor(video());
	ok(a && a.type === 2 && a.status_display_type === 2, "a playing video is a Listening activity showing the title");
	ok(a.details === video().name && a.state === "by Rick Astley", "title and channel");
	ok(a.assets.large_image.startsWith("https://i.ytimg.com/"), "thumbnail as the picture");
	ok(a.timestamps && a.timestamps.end - a.timestamps.start === 213000, "progress bar spans the video");
	ok(a.buttons[0].url === "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "Watch on YouTube button");
	ok(activityFor(video({ isPlaying: false })) === null, "paused: no card (Spotify's behaves the same)");
	ok(activityFor(video({ loading: true })) === null, "still loading: no card yet");
	ok(activityFor({ uri: "spotify:track:x", name: "x", isPlaying: true }) === null, "Spotify: no card (Spotify shows its own)");
	ok(activityFor(video({ name: "x".repeat(300) })).details.length === 128, "long titles cut to Discord's 128");
	ok(activityFor(video({ name: "a" })).details.length === 2, "one-letter titles padded to Discord's 2");
	ok(!activityFor(video({ duration: 0 })).timestamps, "no length known yet: no progress bar");

	// ---------------------------------------------------------------- talking to Discord
	const logs = [];
	const d = createDiscordPresence({ clientId: CLIENT_ID, paths: () => [PIPE], log: (m) => logs.push(m) });

	d.update({ uri: "spotify:track:x", isPlaying: true });
	await sleep(300);
	ok(!d.state().connected, "nothing to show and Discord not running: no connection attempts");

	const fake = await fakeDiscord();
	d.update(video());
	ok(await until(() => fake.sets().length === 1), "a video plays: connects and sets the card");
	const hs = fake.got.find((g) => g.op === 0);
	ok(hs && hs.msg.client_id === CLIENT_ID && hs.msg.v === 1, "handshake carries Mercify's application id");
	ok(fake.sets()[0].msg.args.pid === process.pid && fake.sets()[0].msg.args.activity.details === video().name, "SET_ACTIVITY with the video");
	ok(d.state().user === "kain", "knows who's signed in to Discord");

	for (let i = 0; i < 10; i++) d.update(video({ position: 10000 + i * 1000, at: Date.now() }));
	await sleep(600);
	ok(fake.sets().length === 1, "the same video ticking along: no repeat updates");

	d.update(video({ isPlaying: false }));
	ok(await until(() => fake.sets().length === 2), "paused: card cleared");
	const gap = fake.sets()[1].at - fake.sets()[0].at;
	ok(gap >= 4400, `updates spaced for Discord's rate limit (${gap} ms)`);
	ok(fake.sets()[1].msg.args.activity === undefined, "cleared with no activity");

	d.update(video({ uri: "youtube:aaaaaaaaaaa", name: "Second video" }));
	d.update(video({ uri: "youtube:bbbbbbbbbbb", name: "Third video" }));
	ok(await until(() => fake.sets().length === 3), "next video shown");
	ok(fake.sets()[2].msg.args.activity.details === "Third video", "quick changes collapse to the latest");

	// Discord restarts
	fake.kick();
	await until(() => !d.state().connected);
	ok(!d.state().connected, "Discord closed: noticed");
	await fake.close();
	const fake2 = await fakeDiscord();
	// (the retry waits 20 s; nudge it as a new song would)
	d.update(video({ uri: "youtube:ccccccccccc", name: "Fourth video" }));
	ok(await until(() => fake2.sets().length === 1, 25000), "Discord back: card shown again");
	ok(fake2.sets()[0].msg.args.activity.details === "Fourth video", "with the current video");

	d.setEnabled(false);
	ok(await until(() => fake2.sets().length === 2), "turned off in Settings: card cleared");
	d.update(video());
	await sleep(5500);
	ok(fake2.sets().length === 2, "turned off: nothing more sent");

	d.close();
	await fake2.close();
	console.log(failures ? `\n${failures} failed` : "\nall passed");
	process.exit(failures ? 1 : 0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
