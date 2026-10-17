// Audio to the phone: stream what the PC is playing to a paired phone over WebRTC.
//
// The phone asks to listen; the PC captures its system audio in a hidden window, opens a WebRTC
// peer connection and sends the audio track. Signalling (SDP + ICE) rides the encrypted remote
// channel (remote.sendSignal / the "signal" event). NAT traversal uses Google STUN plus, when an
// Open Relay (metered.ca) API key is set, its free TURN — fetched here so the key stays on the PC
// and the phone only ever sees short-lived credentials inside the offer.
//
// v1 captures the whole system's audio (pure Electron, no native module). Narrowing it to just
// Spotify needs a native WASAPI process-loopback capturer — a later change; nothing else here
// would move.
//
// One listener at a time: a new "listen-start" replaces any current session.

const path = require("path");

const STUN = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];

function createAudioHost({ BrowserWindow, net, remote, preloadPath, log = () => {}, config = {} }) {
	let session = null; // { fid, win, ready } — the phone currently listening

	// Open Relay free TURN, fetched with the PC's API key (config.openRelay = { apiKey, app }).
	// Falls back to STUN-only (LAN + friendly-NAT) when no key is set.
	async function iceServers() {
		const or = config.openRelay || {};
		if (!or.apiKey || !or.app) {
			log("audio: no Open Relay key set — STUN only (away-from-home audio needs a TURN key)");
			return STUN;
		}
		try {
			const url = `https://${encodeURIComponent(or.app)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(or.apiKey)}`;
			const res = await net.fetch(url);
			if (!res.ok) throw new Error(`metered ${res.status}`);
			const list = await res.json();
			if (!Array.isArray(list) || !list.length) throw new Error("no ice servers returned");
			return [...STUN, ...list];
		} catch (err) {
			log(`audio: couldn't fetch TURN creds (${err.message}); STUN only`);
			return STUN;
		}
	}

	function stop(reason) {
		if (!session) return;
		const { fid, win } = session;
		session = null;
		try {
			if (win && !win.isDestroyed()) win.destroy();
		} catch (_) {}
		if (fid && reason !== "peer-asked") remote.sendSignal(fid, "listen-ended", { reason: reason || "stopped" });
		log(`audio: stopped (${reason || "stopped"})`);
	}

	async function start(fid) {
		stop("replaced");
		const ice = await iceServers();
		const win = new BrowserWindow({
			show: false,
			width: 240,
			height: 120,
			skipTaskbar: true,
			webPreferences: {
				preload: preloadPath,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				backgroundThrottling: false,
			},
		});
		session = { fid, win, ice, ready: false };
		win.on("closed", () => {
			if (session && session.win === win) session = null;
		});
		win.loadFile(path.join(__dirname, "audio", "sender.html"));
		win.webContents.once("did-finish-load", () => {
			if (session && session.win === win) win.webContents.send("audio:start", { iceServers: ice });
		});
		log(`audio: starting for ${fid}`);
	}

	// --- messages from the sender window (renderer) -> relay to the phone ---
	function fromRenderer(channel, payload) {
		if (!session) return;
		if (channel === "audio:offer") remote.sendSignal(session.fid, "offer", { sdp: payload.sdp, iceServers: session.ice });
		else if (channel === "audio:ice") remote.sendSignal(session.fid, "ice", { candidate: payload.candidate });
		else if (channel === "audio:error") {
			log(`audio: sender error: ${payload && payload.message}`);
			stop("error");
		}
	}

	// --- signals from the phone -> into the sender window ---
	remote.on("signal", ({ fid, kind, data }) => {
		if (kind === "listen-start") {
			start(fid).catch((err) => log(`audio: start failed: ${err.message}`));
			return;
		}
		if (kind === "listen-stop") {
			if (session && session.fid === fid) stop("peer-asked");
			return;
		}
		if (!session || session.fid !== fid || !session.win || session.win.isDestroyed()) return;
		if (kind === "answer") session.win.webContents.send("audio:answer", { sdp: data && data.sdp });
		else if (kind === "ice") session.win.webContents.send("audio:ice", { candidate: data && data.candidate });
	});

	// A phone that drops off: stop its session.
	remote.on("peer", () => {
		if (session && !remote.devices().some((d) => d.fid === session.fid && d.online)) {
			// keep the session a short while in case it's a brief blip; a hard stop only if gone
		}
	});

	return { start, stop, fromRenderer, isActive: () => !!session };
}

module.exports = { createAudioHost };
