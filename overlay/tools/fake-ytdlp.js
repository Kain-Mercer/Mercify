// A stand-in for yt-dlp, for testing Mercify's YouTube support without YouTube
// (OVERLAY_DEBUG_YTDLP=<this file>). Speaks the parts of yt-dlp's command line Mercify uses:
//   --version, -U, -J <url>, -J --flat-playlist ytsearchN:<query>, and downloads
//   (-o <template> ... --print after_move:filepath <url>), which write a short tone as a WAV file.
// FAKE_YT_SECONDS: length of the tone (default 30). FAKE_YT_DELAY_MS: how long a download takes
// (default 1500). A video whose id starts with "unavailabl" fails like a removed video; "signinonly"
// asks to sign in unless other player clients are asked for (--extractor-args youtube:player_client=…),
// like YouTube does with some music videos; "signinalway" always asks.

"use strict";

const fs = require("fs");

const args = process.argv.slice(2);
const has = (a) => args.includes(a);
const after = (a) => args[args.indexOf(a) + 1];
const url = args[args.length - 1] || "";
const idOf = (u) => (/[?&]v=([A-Za-z0-9_-]{11})/.exec(u) || [])[1] || null;
const seconds = Number(process.env.FAKE_YT_SECONDS || 30);
const delay = Number(process.env.FAKE_YT_DELAY_MS || 1500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const info = (id) => ({ id, title: `Fake meme edit (${id})`, channel: "Fake Channel", uploader: "Fake Channel", duration: seconds });

function wav(file, secs, hz) {
	const rate = 22050;
	const n = Math.round(rate * secs);
	const b = Buffer.alloc(44 + n * 2);
	b.write("RIFF", 0);
	b.writeUInt32LE(36 + n * 2, 4);
	b.write("WAVEfmt ", 8);
	b.writeUInt32LE(16, 16);
	b.writeUInt16LE(1, 20);
	b.writeUInt16LE(1, 22);
	b.writeUInt32LE(rate, 24);
	b.writeUInt32LE(rate * 2, 28);
	b.writeUInt16LE(2, 32);
	b.writeUInt16LE(16, 34);
	b.write("data", 36);
	b.writeUInt32LE(n * 2, 40);
	for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * hz * i) / rate)), 44 + i * 2);
	fs.writeFileSync(file, b);
}

(async () => {
	if (has("--version")) return console.log("2026.08.19 (fake)");
	if (has("-U")) return console.log("yt-dlp is up to date (fake)");
	if (url.startsWith("ytsearch")) {
		const q = url.replace(/^ytsearch\d*:/, "");
		const entries = [1, 2, 3].map((i) => ({ ...info(`fakesearch${i}`), title: `${q} (fake result ${i})` }));
		return console.log(JSON.stringify({ entries }));
	}
	const id = idOf(url);
	if (!id) {
		console.error("ERROR: [generic] Unsupported URL");
		process.exit(1);
	}
	if (id.startsWith("unavailabl")) {
		console.error(`ERROR: [youtube] ${id}: Video unavailable. This video has been removed by the uploader`);
		process.exit(1);
	}
	const otherClients = args.some((a) => /player_client=/.test(a));
	if (id.startsWith("signinalway") || (id.startsWith("signinonly") && !otherClients)) {
		console.error(`ERROR: [youtube] ${id}: Please sign in. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies`);
		process.exit(1);
	}
	if (has("-J")) return console.log(JSON.stringify(info(id)));
	const out = after("-o").replace("%(id)s", id).replace("%(ext)s", "wav");
	for (const p of [10, 45, 80, 100]) {
		await sleep(delay / 4);
		console.log(`[download]  ${p.toFixed(1)}% of ~ 1.20MiB`);
	}
	wav(out, seconds, 330 + (id.charCodeAt(0) % 5) * 55);
	console.log(out);
})();
