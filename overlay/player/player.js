// Mercify's own audio player, for YouTube videos (Spotify plays its songs itself). Lives in a
// hidden window; main.js loads a downloaded file into it and gets told what happens.
//
// The sound goes through a gentle compressor: YouTube uploads (meme edits above all) are far
// less even in loudness than Spotify's songs, so this keeps the loud ones from blasting.

"use strict";

const P = window.player;
const audio = document.getElementById("audio");
let seq = 0;
let ctx = null;
let gain = null;
let volume = 0.8;

function chain() {
	if (ctx) return;
	try {
		ctx = new AudioContext();
		const src = ctx.createMediaElementSource(audio);
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = -20;
		comp.knee.value = 10;
		comp.ratio.value = 4;
		comp.attack.value = 0.005;
		comp.release.value = 0.3;
		gain = ctx.createGain();
		src.connect(comp).connect(gain).connect(ctx.destination);
	} catch (_) {
		ctx = null;
		gain = null; // plays without levelling
	}
}

function setVolume(v) {
	volume = Math.max(0, Math.min(1, Number(v) || 0));
	if (gain) gain.gain.value = volume * 1.25; // a little make-up gain after the compressor
	else audio.volume = volume;
}

const ms = (s) => (Number.isFinite(s) ? Math.round(s * 1000) : 0);
function send(type, extra = {}) {
	if (!seq) return;
	P.event({ seq, type, position: ms(audio.currentTime), duration: ms(audio.duration), playing: !audio.paused, ...extra });
}

async function play() {
	try {
		if (ctx && ctx.state === "suspended") await ctx.resume();
		await audio.play();
	} catch (e) {
		send("error", { message: e.message });
	}
}

P.onLoad(async (m) => {
	seq = m.seq;
	chain();
	setVolume(m.volume);
	try {
		await new Promise((resolve, reject) => {
			audio.onloadedmetadata = resolve;
			audio.onerror = () => reject(new Error("Couldn't open the audio"));
			audio.src = m.src;
		});
		audio.onerror = () => send("error", { message: "The audio stopped playing" });
		audio.currentTime = Math.max(0, (m.position || 0) / 1000);
		if (m.playing) await play();
		send("ready");
	} catch (e) {
		send("error", { message: e.message });
	}
});

P.onPlay(play);
P.onPause(() => audio.pause());
P.onSeek((v) => {
	audio.currentTime = Math.max(0, (Number(v) || 0) / 1000);
});
P.onVolume(setVolume);
P.onStop(() => {
	seq = 0;
	audio.pause();
	audio.removeAttribute("src");
	audio.load();
});

audio.addEventListener("play", () => send("play"));
audio.addEventListener("pause", () => !audio.ended && send("pause"));
audio.addEventListener("seeked", () => send("time"));
audio.addEventListener("ended", () => send("ended"));
setInterval(() => !audio.paused && send("time"), 1000);
