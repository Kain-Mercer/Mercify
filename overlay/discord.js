// Discord Rich Presence for YouTube videos.
//
// Spotify shows its own "Listening to Spotify" card on Discord, but only while Spotify plays, and a
// YouTube video pauses Spotify. So while a video plays, Mercify shows its own card through the
// Discord app's local RPC pipe (the same one games use): "Listening to <video title>", the channel,
// the thumbnail, a progress bar and a "Watch on YouTube" button. Paused or back on Spotify, the card
// is cleared, so Spotify's comes back.
//
// Protocol: a named pipe (\\?\pipe\discord-ipc-0..9 on Windows, $XDG_RUNTIME_DIR/discord-ipc-N
// elsewhere); each frame is op (u32 LE), length (u32 LE), JSON. Handshake (op 0) with the client
// id, then READY arrives; SET_ACTIVITY goes as a frame (op 1). Discord drops the activity itself
// when the pipe closes (Mercify quits or crashes).
//
// No Discord running is normal: Mercify only tries to connect while there's something to show, and
// then at most every RETRY_MS.

const net = require("net");
const os = require("os");
const path = require("path");

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const RETRY_MS = 20000; // Discord not running: look again this often while a video plays
const MIN_GAP_MS = 4500; // Discord allows 5 activity updates per 20 s
const SEEK_SLACK_MS = 3000; // a progress bar this close to the truth isn't worth an update

const ACTIVITY_LISTENING = 2;
const STATUS_DISPLAY_DETAILS = 2; // the member list says "Listening to <details>" (the video title)

function pipePaths() {
	if (process.env.OVERLAY_DEBUG_DISCORD_IPC) return [path.join(process.env.OVERLAY_DEBUG_DISCORD_IPC, "discord-ipc-0")];
	const out = [];
	if (process.platform === "win32") {
		for (let i = 0; i < 10; i++) out.push(`\\\\?\\pipe\\discord-ipc-${i}`);
		return out;
	}
	const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || os.tmpdir();
	const dirs = [base, path.join(base, "app", "com.discordapp.Discord"), path.join(base, "snap.discord")];
	for (const d of dirs) for (let i = 0; i < 10; i++) out.push(path.join(d, `discord-ipc-${i}`));
	return out;
}

function encode(op, data) {
	const json = Buffer.from(JSON.stringify(data), "utf8");
	const head = Buffer.alloc(8);
	head.writeUInt32LE(op, 0);
	head.writeUInt32LE(json.length, 4);
	return Buffer.concat([head, json]);
}

// Discord wants 2..128 characters in its text fields.
function text(s, fallback) {
	let t = String(s || "").replace(/\s+/g, " ").trim();
	if (!t) t = fallback || "";
	if (t.length > 128) t = t.slice(0, 127) + "…";
	if (t.length === 1) t += " ";
	return t || undefined;
}

// A player state (see ytState() in main.js) to the activity Discord shows, or null for none.
function activityFor(st) {
	if (!st || st.empty || st.source !== "youtube" || !st.isPlaying || st.loading) return null;
	const id = /^youtube:([A-Za-z0-9_-]{11})$/.exec(st.uri || "")?.[1];
	if (!id) return null;
	const title = text(st.name, "YouTube video");
	const channel = text((st.artists || [])[0]);
	const a = {
		type: ACTIVITY_LISTENING,
		status_display_type: STATUS_DISPLAY_DETAILS,
		details: title,
		state: channel ? text(`by ${channel}`) : "on YouTube",
		assets: {
			large_image: st.image || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
			large_text: channel ? text(`${channel} · YouTube`) : "YouTube",
		},
		buttons: [{ label: "Watch on YouTube", url: `https://www.youtube.com/watch?v=${id}` }],
		instance: false,
	};
	const duration = Number(st.duration) || 0;
	const position = Math.max(0, Number(st.position) || 0);
	if (duration > 0) {
		const start = (Number(st.at) || Date.now()) - Math.min(position, duration);
		a.timestamps = { start: Math.round(start), end: Math.round(start + duration) };
	}
	return a;
}

// Same card, apart from a progress bar that's only slightly off?
function sameActivity(a, b) {
	if (!a || !b) return a === b;
	const strip = (x) => JSON.stringify({ ...x, timestamps: undefined });
	if (strip(a) !== strip(b)) return false;
	if (!a.timestamps !== !b.timestamps) return false;
	return !a.timestamps || Math.abs(a.timestamps.start - b.timestamps.start) < SEEK_SLACK_MS;
}

function createDiscordPresence({ clientId, log = () => {}, connect = (p) => net.createConnection(p), paths = pipePaths } = {}) {
	let enabled = true;
	let want = null; // the activity to show (null: none)
	let shown = null; // what Discord has (null: none)
	let sock = null;
	let ready = false;
	let connecting = false;
	let retryTimer = null;
	let sendTimer = null;
	let lastSend = 0;
	let nonce = 0;
	let buf = Buffer.alloc(0);
	let user = null;
	let closed = false;

	function onFrame(op, msg) {
		if (op === OP_PING) return sock?.write(encode(OP_PONG, msg));
		if (op === OP_CLOSE) {
			log(`discord: closed by Discord: ${msg?.message || msg?.code || "?"}`);
			return sock?.destroy();
		}
		if (op !== OP_FRAME || !msg) return;
		if (msg.evt === "READY") {
			ready = true;
			user = msg.data?.user?.username || null;
			log(`discord: connected${user ? ` (${user})` : ""}`);
			shown = null; // a fresh connection shows nothing yet
			schedule();
		} else if (msg.evt === "ERROR") {
			log(`discord: ${msg.cmd || "error"}: ${msg.data?.message || JSON.stringify(msg.data)}`);
		}
	}

	function onData(chunk) {
		buf = Buffer.concat([buf, chunk]);
		while (buf.length >= 8) {
			const op = buf.readUInt32LE(0);
			const len = buf.readUInt32LE(4);
			if (buf.length < 8 + len) break;
			let msg = null;
			try {
				msg = JSON.parse(buf.subarray(8, 8 + len).toString("utf8"));
			} catch (_) {}
			buf = buf.subarray(8 + len);
			onFrame(op, msg);
		}
	}

	function tryConnect() {
		clearTimeout(retryTimer);
		retryTimer = null;
		if (closed || sock || connecting || !enabled || !want) return;
		connecting = true;
		const list = paths();
		const attempt = (i) => {
			if (closed) return (connecting = false);
			if (i >= list.length) {
				connecting = false;
				retryTimer = setTimeout(tryConnect, RETRY_MS);
				return;
			}
			const s = connect(list[i]);
			let opened = false;
			s.once("error", () => {
				if (!opened) attempt(i + 1);
			});
			s.once("connect", () => {
				opened = true;
				connecting = false;
				sock = s;
				ready = false;
				buf = Buffer.alloc(0);
				s.on("data", onData);
				s.on("error", (err) => log(`discord: ${err.message}`));
				s.on("close", () => {
					if (sock !== s) return;
					sock = null;
					ready = false;
					shown = null;
					if (user) log("discord: disconnected");
					user = null;
					if (!closed && enabled && want) retryTimer = setTimeout(tryConnect, RETRY_MS);
				});
				s.write(encode(OP_HANDSHAKE, { v: 1, client_id: clientId }));
			});
		};
		attempt(0);
	}

	// Send what we want, no faster than Discord allows; later changes replace earlier ones.
	function schedule() {
		if (!ready || sameActivity(want, shown)) return;
		if (sendTimer) return;
		const wait = Math.max(0, lastSend + MIN_GAP_MS - Date.now());
		sendTimer = setTimeout(() => {
			sendTimer = null;
			if (!ready || !sock || sameActivity(want, shown)) return;
			lastSend = Date.now();
			shown = want;
			sock.write(encode(OP_FRAME, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity: want || undefined }, nonce: String(++nonce) }));
		}, wait);
	}

	function setActivity(a) {
		const before = want;
		want = enabled ? a || null : null;
		// Not connected: try now, unless a retry is already waiting and this is the same video.
		if (want && !sock && (!retryTimer || !sameActivity(want, before))) tryConnect();
		schedule();
	}

	return {
		// From the player state; everything that isn't a playing YouTube video clears the card.
		update(st) {
			setActivity(activityFor(st));
		},
		setActivity,
		setEnabled(on) {
			enabled = !!on;
			if (!enabled) setActivity(null);
		},
		state: () => ({ enabled, connected: ready, user, showing: !!shown }),
		close() {
			closed = true;
			clearTimeout(retryTimer);
			clearTimeout(sendTimer);
			if (sock) sock.destroy();
			sock = null;
		},
	};
}

module.exports = { createDiscordPresence, activityFor, encode };
