// The PC's audio sender. Captures the system's audio (loopback, granted by main's
// setDisplayMediaRequestHandler) and sends it to the phone over a WebRTC peer connection.
// SDP and ICE go through main (window.audio) -> remote.js -> the phone.
(function () {
	"use strict";
	let pc = null;
	let stream = null;

	async function start({ iceServers }) {
		try {
			// The display-media handler in main grants loopback audio. We ask for video too (some
			// Electron versions only fire the handler with video requested) and drop it at once —
			// we only want the audio track.
			stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
			for (const t of stream.getVideoTracks()) {
				t.stop();
				stream.removeTrack(t);
			}
			const audioTracks = stream.getAudioTracks();
			if (!audioTracks.length) throw new Error("no system audio track (is loopback allowed?)");

			pc = new RTCPeerConnection({ iceServers });
			for (const t of audioTracks) pc.addTrack(t, stream);
			pc.onicecandidate = (e) => {
				if (e.candidate) window.audio.ice(e.candidate.toJSON ? e.candidate.toJSON() : e.candidate);
			};
			pc.onconnectionstatechange = () => {
				if (pc && (pc.connectionState === "failed" || pc.connectionState === "closed")) window.audio.error("connection " + pc.connectionState);
			};
			const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
			await pc.setLocalDescription(offer);
			window.audio.offer(pc.localDescription.sdp);
		} catch (err) {
			window.audio.error(err && err.message ? err.message : String(err));
		}
	}

	window.audio.onStart(start);
	window.audio.onAnswer(async ({ sdp }) => {
		try {
			if (pc && sdp) await pc.setRemoteDescription({ type: "answer", sdp });
		} catch (err) {
			window.audio.error("answer: " + err.message);
		}
	});
	window.audio.onIce(async ({ candidate }) => {
		try {
			if (pc && candidate) await pc.addIceCandidate(candidate);
		} catch (err) {
			/* ignore late/duplicate candidates */
		}
	});
	window.audio.onStop(() => {
		try {
			if (pc) pc.close();
		} catch (_) {}
		if (stream) for (const t of stream.getTracks()) t.stop();
		pc = null;
		stream = null;
	});
})();
