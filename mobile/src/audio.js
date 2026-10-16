// Hear the PC's audio on the phone. The phone asks the PC to listen; the PC sends a WebRTC offer
// (with ICE servers it fetched, so no TURN key lives on the phone) over the encrypted remote
// channel; the phone answers and plays the incoming audio track.
import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from "react-native-webrtc";
import { spotify } from "./spotify"; // keep-alive notification while streaming
import * as R from "./remote";

// Speaker / Bluetooth routing is done natively: MainApplication marks WebRTC's audio as media
// (USAGE_MEDIA), so Android plays it like any music app — no in-call routing needed here.

const listeners = new Set();
let state = { on: false, status: "off" }; // status: off | connecting | playing | error
function emit(patch) {
	state = { ...state, ...patch };
	for (const fn of listeners) fn(state);
}
export const subscribe = (fn) => {
	listeners.add(fn);
	fn(state);
	return () => listeners.delete(fn);
};
export const get = () => state;

let pc = null;
let remoteStream = null;
let wired = false;

function teardown() {
	try {
		if (pc) pc.close();
	} catch (_) {}
	pc = null;
	remoteStream = null;
}

async function handleOffer(fid, data) {
	try {
		teardown();
		emit({ status: "connecting" });
		pc = new RTCPeerConnection({ iceServers: (data && data.iceServers) || [] });
		pc.addEventListener("icecandidate", (e) => {
			if (e.candidate) R.signal(fid, "ice", { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
		});
		pc.addEventListener("track", (e) => {
			remoteStream = e.streams && e.streams[0];
			emit({ status: "playing" });
		});
		pc.addEventListener("connectionstatechange", () => {
			if (!pc) return;
			if (pc.connectionState === "failed" || pc.connectionState === "disconnected") emit({ status: "error" });
		});
		await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: data.sdp }));
		const answer = await pc.createAnswer();
		await pc.setLocalDescription(answer);
		R.signal(fid, "answer", { sdp: answer.sdp });
	} catch (err) {
		console.warn("[audio] offer failed:", err.message);
		emit({ status: "error" });
	}
}

function wire() {
	if (wired) return;
	wired = true;
	R.onSignal(({ fid, kind, data }) => {
		if (kind === "offer") handleOffer(fid, data);
		else if (kind === "ice") {
			try {
				if (pc && data && data.candidate) pc.addIceCandidate(new RTCIceCandidate(data.candidate));
			} catch (_) {}
		} else if (kind === "listen-ended") {
			teardown();
			emit({ on: false, status: "off" });
		}
	});
}

export async function start() {
	wire();
	const fid = R.pcFid();
	if (!fid) return;
	emit({ on: true, status: "connecting" });
	try {
		spotify.keepAlive(true, "Listening to your PC");
	} catch (_) {}
	await R.signal(fid, "listen-start", {});
}

export async function stop() {
	const fid = R.pcFid();
	teardown();
	emit({ on: false, status: "off" });
	if (fid) await R.signal(fid, "listen-stop", {});
}

export async function toggle() {
	if (state.on) await stop();
	else await start();
}
