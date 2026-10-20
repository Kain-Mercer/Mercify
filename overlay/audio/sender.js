// The PC's audio sender. Two sources:
//   "system"  — Chromium loopback getDisplayMedia (whole system), granted by main.
//   "spotify" — raw PCM piped in from the native spcap.exe (Spotify only); an AudioWorklet turns it
//               into a MediaStream track. PCM frames arrive via window.audio.onPcm.
// Either way the audio track goes over a WebRTC peer connection; SDP/ICE go through main -> the phone.
(function () {
	"use strict";
	let pc = null;
	let stream = null;
	let ctx = null;
	let pcmNode = null;
	let leftover = new Uint8Array(0);

	// Interleaved float32 stereo @ 48 kHz in; a ring buffer feeds the output in 128-frame blocks,
	// padding with silence on underrun and dropping the oldest audio if the phone falls behind.
	const WORKLET = `
		const CAP = 48000 * 2;
		class PcmPlayer extends AudioWorkletProcessor {
			constructor() {
				super();
				this.ring = new Float32Array(CAP);
				this.w = 0; this.r = 0; this.avail = 0;
				this.port.onmessage = (e) => {
					const f = e.data;
					for (let i = 0; i < f.length; i++) {
						this.ring[this.w] = f[i];
						this.w = (this.w + 1) % CAP;
						if (this.avail < CAP) this.avail++;
						else this.r = (this.r + 1) % CAP;
					}
				};
			}
			process(_, outputs) {
				const out = outputs[0];
				const L = out[0], R = out[1] || out[0];
				const n = L.length;
				for (let i = 0; i < n; i++) {
					if (this.avail >= 2) {
						L[i] = this.ring[this.r]; this.r = (this.r + 1) % CAP;
						R[i] = this.ring[this.r]; this.r = (this.r + 1) % CAP;
						this.avail -= 2;
					} else { L[i] = 0; R[i] = 0; }
				}
				return true;
			}
		}
		registerProcessor('pcm-player', PcmPlayer);
	`;

	function wirePeer(iceServers, tracks, mediaStream) {
		pc = new RTCPeerConnection({ iceServers });
		for (const t of tracks) pc.addTrack(t, mediaStream);
		pc.onicecandidate = (e) => {
			if (e.candidate) window.audio.ice(e.candidate.toJSON ? e.candidate.toJSON() : e.candidate);
		};
		pc.onconnectionstatechange = () => {
			if (pc && (pc.connectionState === "failed" || pc.connectionState === "closed")) window.audio.error("connection " + pc.connectionState);
		};
	}
	async function offer() {
		const o = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
		await pc.setLocalDescription(o);
		window.audio.offer(pc.localDescription.sdp);
	}

	async function startSystem(iceServers) {
		stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
		for (const t of stream.getVideoTracks()) {
			t.stop();
			stream.removeTrack(t);
		}
		const audioTracks = stream.getAudioTracks();
		if (!audioTracks.length) throw new Error("no system audio track (is loopback allowed?)");
		wirePeer(iceServers, audioTracks, stream);
		await offer();
	}

	async function startSpotify(iceServers) {
		ctx = new AudioContext({ sampleRate: 48000 });
		await ctx.resume().catch(() => {});
		const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
		await ctx.audioWorklet.addModule(url);
		pcmNode = new AudioWorkletNode(ctx, "pcm-player", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
		const dest = ctx.createMediaStreamDestination();
		pcmNode.connect(dest);
		stream = dest.stream;
		wirePeer(iceServers, stream.getAudioTracks(), stream);
		await offer();
	}

	// Raw bytes from spcap -> whole float32 samples -> the worklet (keeping any partial-sample tail).
	function onPcm(u8) {
		if (!pcmNode || !u8 || !u8.length) return;
		let bytes = u8;
		if (leftover.length) {
			const merged = new Uint8Array(leftover.length + u8.length);
			merged.set(leftover);
			merged.set(u8, leftover.length);
			bytes = merged;
		}
		const usable = bytes.length - (bytes.length % 4);
		leftover = usable < bytes.length ? bytes.slice(usable) : new Uint8Array(0);
		if (usable > 0) {
			const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + usable));
			pcmNode.port.postMessage(f);
		}
	}

	async function start({ iceServers, source }) {
		try {
			if (source === "spotify") await startSpotify(iceServers);
			else await startSystem(iceServers);
		} catch (err) {
			window.audio.error(err && err.message ? err.message : String(err));
		}
	}

	function teardown() {
		try {
			if (pc) pc.close();
		} catch (_) {}
		try {
			if (stream) for (const t of stream.getTracks()) t.stop();
		} catch (_) {}
		try {
			if (ctx) ctx.close();
		} catch (_) {}
		pc = null;
		stream = null;
		ctx = null;
		pcmNode = null;
		leftover = new Uint8Array(0);
	}

	window.audio.onStart(start);
	window.audio.onPcm(onPcm);
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
	window.audio.onStop(teardown);
})();
