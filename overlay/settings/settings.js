"use strict";

const S = window.settings;
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// The theme comes in the address too (main.js), so the first frame is already drawn in it.
const THEMES = ["classic", "neon", "light", "vice"];
function applyTheme(t) {
	document.documentElement.dataset.theme = THEMES.includes(t) ? t : "classic";
}
applyTheme(new URLSearchParams(location.search).get("theme"));

const ICON = {
	check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"></path></svg>',
	warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 17h.01"></path></svg>',
	cross: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"></path></svg>',
	x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>',
	play: "M7 4v16l13-8z",
	pause: "M6 4h4v16H6zM14 4h4v16h-4z",
};

let current = null; // the last state from the main process

// ---------------------------------------------------------------- pages

let page = "home";
function showPage(name) {
	if (!$(`.page[data-page="${name}"]`)) return;
	page = name;
	$$(".page").forEach((p) => (p.hidden = p.dataset.page !== name));
	$$(".nav").forEach((n) => (n.dataset.page === name ? n.setAttribute("aria-current", "page") : n.removeAttribute("aria-current")));
	$("#pages").scrollTop = 0;
	if (name !== "hotkeys" && capturing) stopCapture();
	if (name === "home") drawPlayer();
}
$$(".nav, #side-status, [data-goto]").forEach((el) => el.addEventListener("click", () => showPage(el.dataset.goto || el.dataset.page)));

// ---------------------------------------------------------------- setup
// Poka-yoke: one big button does everything in order; the small "Redo" buttons are for repairs
// and are locked while anything runs. Progress comes live from the main process. The same four
// steps show on the first-run screen and on the Setup page.

const STEPS = [
	{ id: "spotify", title: "Spotify + SpotX", act: "spotx" },
	{ id: "spicetify", title: "Spicetify", act: "spicetify" },
	{ id: "extension", title: "Mercify extension", act: "apply" },
	{ id: "connect", title: "Spotify connection", frTitle: "Log in to Spotify" },
];
const STEP_ROW = { spotify: "spotify", firstrun: "spotify", spicetify: "spicetify", extension: "extension", connect: "connect" };
const step = Object.fromEntries(STEPS.map((s) => [s.id, { state: "neutral", sub: "" }]));
const stepBtn = { spotify: false, spicetify: false, extension: false, connect: false }; // shown?
let activeStep = null;
let setupRunning = false;
let connectNote = "";
let premiumNow = false;

function setupDone(s) {
	return !!s && s.spotify && s.spotx && !s.spotxWrongMode && s.spicetify && s.extension === "current";
}

// state: ok | warn | neutral | running | bad (red only ever means "this failed")
function setRow(id, state, sub) {
	step[id].state = state;
	if (sub != null) step[id].sub = sub;
}

function drawSteps() {
	const lock = setupRunning || !current?.setup?.spotify;
	$("#setup-steps").innerHTML = STEPS.map((st) => {
		const m = step[st.id];
		const icon = m.state === "ok" ? ICON.check : m.state === "warn" ? ICON.warn : m.state === "bad" ? ICON.cross : "";
		let btn = "";
		if (st.id === "connect" && stepBtn.connect) btn = '<button class="btn small ghost" data-open="spotify">Open Spotify</button>';
		else if (st.act && stepBtn[st.id]) btn = `<button class="btn small ghost" data-act="${st.act}" ${lock ? "disabled" : ""}>Redo</button>`;
		return `<div class="step${activeStep === st.id ? " active" : ""}"><span class="si ${m.state}">${icon}</span><span class="step-text"><b>${esc(st.title)}</b><span>${esc(m.sub)}</span></span>${btn}</div>`;
	}).join("");
	// first-run list: numbered rail, a check for each finished step
	const firstOpen = STEPS.findIndex((st) => step[st.id].state !== "ok");
	$("#fr-list").innerHTML = STEPS.map((st, i) => {
		const m = step[st.id];
		const cls = m.state === "ok" ? "ok" : m.state === "running" ? "running" : m.state === "bad" ? "bad" : m.state === "warn" ? "warn" : "";
		const inner = m.state === "ok" ? ICON.check : m.state === "running" ? "" : String(i + 1);
		const line = i < STEPS.length - 1 ? `<span class="fr-line${m.state === "ok" ? " ok" : ""}"></span>` : "";
		const todo = m.state === "neutral" && i !== firstOpen;
		return `<li class="fr-item${todo ? " todo" : ""}"><div class="fr-rail"><span class="fr-num ${cls}">${inner}</span>${line}</div><div class="fr-body"><b>${esc(st.frTitle || st.title)}</b><span>${esc(m.sub)}</span></div></li>`;
	}).join("");
	$("#fr-count").textContent = firstOpen === -1 ? "All done" : `Step ${firstOpen + 1} of ${STEPS.length}`;
}

$("#setup-steps").addEventListener("click", async (e) => {
	const b = e.target.closest("button");
	if (!b) return;
	if (b.dataset.act) runSetupAction(b.dataset.act);
	else if (b.dataset.open) render(await S.action("openSpotify"));
});

function renderSetup(s, run, connected) {
	if (!s?.supported) {
		$('.nav[data-page="setup"]').hidden = true;
		$("#nav-setup-dot").hidden = true;
		return;
	}
	// the bar after the steps: waiting for you to log in, then done once Spotify connects
	if (run?.running) progRun = true; // Settings opened while setup runs
	const ranOk = progRun && run && !run.running && run.ok;
	if (ranOk && connected && progShown() && !progIs("finished")) progFinish("All set! Mercify is connected to Spotify.");
	else if (ranOk && !connected && setupDone(s)) {
		progPhase("connect", "Spotify is opening. If it asks you to log in, log in; Mercify finishes by itself.");
		if (connectNote) (prog.desc = connectNote), progDraw(); // "You're logged in. Restarting Spotify…"
	}
	setupRunning = !!run?.running;
	// Settings opened (or re-rendered) mid-run: show each step as far as it got
	if (setupRunning && run.steps) for (const [id, p] of Object.entries(run.steps)) onSetupProgress({ step: id, ...p });
	if (!setupRunning) {
		if (s.spotify && s.spotx && s.spotxWrongMode)
			setRow("spotify", "warn", premiumNow ? "Set up for a free account. Finish setup to switch it to Premium mode." : "Set up for Premium, but this account is free. Finish setup to switch it.");
		else if (s.spotify && s.spotx) setRow("spotify", "ok", premiumNow ? "Premium mode" : current?.spotifyPremium === false ? "Free mode" : "Installed");
		else if (s.spotify) setRow("spotify", "warn", "Installed without SpotX (it keeps Spotify updates from breaking Mercify)");
		else if (s.storeSpotify) setRow("spotify", "warn", "Microsoft Store version, which can't be used. Setup replaces it.");
		else if (s.spotifyLeftovers) setRow("spotify", "neutral", "Not installed yet (setup tidies up an earlier install)");
		else setRow("spotify", "neutral", "Not installed yet");
		setRow("spicetify", s.spicetify ? "ok" : "neutral", s.spicetify ? "Installed" : "Not installed yet");
		if (s.extension === "current") setRow("extension", "ok", `Installed in Spotify (v${s.appliedVersion ?? "?"})`);
		else if (s.extension === "outdated") setRow("extension", "warn", `Needs an update (v${s.appliedVersion ?? "?"} → v${s.bundledVersion})`);
		else setRow("extension", "neutral", "Not installed yet");
		activeStep = null;
	}
	// Spotify only loads the extension once you're logged in, so this is the last thing to turn green
	const done = setupDone(s);
	if (connected) {
		setRow("connect", "ok", "Connected");
		stepBtn.connect = false;
	} else if (done) {
		setRow("connect", "warn", connectNote || "Not yet. Open Spotify and log in; this turns green by itself.");
		stepBtn.connect = true;
	} else if (!setupRunning || !run?.steps?.connect) {
		setRow("connect", "neutral", "After the steps above");
		stepBtn.connect = false;
	}
	const failed = !!run && !run.running && run.ok === false;
	if (failed && STEP_ROW[run.step]) setRow(STEP_ROW[run.step], "bad", run.why);
	// the Redo buttons: only once there's something to redo, never while running
	stepBtn.spotify = !!s.spotify;
	stepBtn.spicetify = !!s.spicetify;
	stepBtn.extension = s.extension !== "missing";
	drawSteps();

	$("#setup-fail").hidden = !failed;
	if (failed) $("#setup-fail-text").textContent = run.why || "Something went wrong.";
	$("#setup-go").hidden = done || setupRunning || failed;
	$("#setup-all").disabled = setupRunning;
	$("#setup-again").disabled = setupRunning;
	$("#remove-addons").hidden = setupRunning || !(s.spicetify || s.spotx);

	const okCount = STEPS.filter((st) => step[st.id].state === "ok").length;
	const sum = $("#setup-summary");
	sum.classList.toggle("warn", !(done && connected) && !setupRunning);
	sum.innerHTML = setupRunning ? "Setting up…" : failed ? `${ICON.warn}Stopped` : done && connected ? `${ICON.check}${okCount} of 4 complete` : `${okCount} of 4 complete`;

	$("#nav-setup-dot").hidden = done && !failed;
	const tile = $("#tile-setup");
	tile.classList.toggle("warn", !done && !setupRunning);
	tile.innerHTML = setupRunning ? "Running…" : done ? `${ICON.check}Complete` : "Needs attention";

	renderFirstRun(s, run, connected, failed);
}

// ---------------------------------------------------------------- first run
// While Spotify, Spicetify or the extension is missing, the window is the installer: the four
// steps, the Premium question and one button. It stays until you press "Open Mercify" (or
// "Not now"), so the run can be watched to the end.

let frSticky = false;
let frDismissed = false;

function wantFirstRun(d) {
	const s = d.setup;
	if (!s?.supported || frDismissed) return false;
	if (frSticky) return true;
	return !(s.spotify && s.spicetify && s.extension !== "missing");
}

function renderFirstRun(s, run, connected, failed) {
	const on = wantFirstRun(current);
	if (on) frSticky = true;
	$("#firstrun").hidden = !on;
	$("#shell").hidden = on;
	if (!on) return;
	const done = setupDone(s);
	const go = $("#fr-go");
	$("#fr-copy").hidden = !failed;
	$("#spotify-premium").disabled = setupRunning;
	$("#fr-skip").hidden = done && connected;
	go.disabled = setupRunning;
	go.dataset.do = "setupAll";
	if (setupRunning) go.textContent = "Setting up…";
	else if (failed) go.textContent = "Try again";
	else if (done && connected) (go.textContent = "Open Mercify"), (go.dataset.do = "enter");
	else if (done) (go.textContent = "Open Spotify"), (go.dataset.do = "openSpotify");
	else go.textContent = s.spotify || s.spicetify ? "Finish setup" : "Set up everything";
}

$("#fr-go").addEventListener("click", async () => {
	const what = $("#fr-go").dataset.do;
	if (what === "enter") leaveFirstRun();
	else if (what === "openSpotify") render(await S.action("openSpotify"));
	else runSetupAction("setupAll");
});
function leaveFirstRun() {
	frSticky = false;
	frDismissed = true;
	$("#firstrun").hidden = true;
	$("#shell").hidden = false;
	showPage("home");
}
$("#fr-skip").addEventListener("click", leaveFirstRun);
$("#fr-copy").addEventListener("click", () => copyDetails($("#fr-copy")));
$("#spotify-premium").addEventListener("change", async (e) => render(await S.set("spotifyPremium", e.target.checked)));

// ---------------------------------------------------------------- progress bar
// Setup can't know how long each step will take, so the bar is an estimate: each step owns a
// slice (installing Spotify is by far the longest) and eases towards the end of it, never going
// backwards. Real numbers replace the guess where there are any (SpotX's download percentage,
// Spicetify's "Patching files [n/286]"). Drawn on the first-run screen and the Setup page.
const PHASES = {
	spotify: { from: 2, to: 55, tau: 14 }, // after the download (which sets the pace itself): ~20 s of installing and patching
	firstrun: { from: 55, to: 60, tau: 8 },
	spicetify: { from: 60, to: 74, tau: 10 },
	extension: { from: 74, to: 90, tau: 12 },
	connect: { from: 90, to: 99, tau: 45 },
};
const prog = { phase: null, value: 0, base: 0, since: 0, desc: "", timer: null, finishing: null };
// The bar belongs to an install run: from pressing the button (or opening Settings mid-run) until
// "All set!" or a failure. Closing Spotify later mustn't bring it back (1.11.1 did).
let progRun = false;

const progEls = () => $$(".prog");
const progShown = () => !progEls()[0].hidden;
const progIs = (cls) => progEls()[0].classList.contains(cls);

function progShow(desc) {
	progEls().forEach((el) => {
		el.hidden = false;
		el.classList.remove("finished", "failed");
	});
	clearTimeout(prog.finishing);
	prog.finishing = null;
	if (desc != null) prog.desc = desc;
	if (!prog.timer) prog.timer = setInterval(progTick, 200);
	progDraw();
}

function progPhase(id, desc) {
	const ph = PHASES[id];
	if (!ph) return;
	if (prog.phase !== id) {
		prog.phase = id;
		prog.value = Math.max(prog.value, ph.from);
		prog.base = prog.value;
		prog.since = Date.now();
		progShow(desc);
	} else progShow(); // same step again (Settings re-rendering): keep the newer description
}

function progAtLeast(v) {
	if (v > prog.value) {
		prog.value = v;
		prog.base = v; // the estimate carries on from the real number
		prog.since = Date.now();
	}
	progDraw();
}

function progTick() {
	const ph = PHASES[prog.phase];
	if (ph) {
		const t = (Date.now() - prog.since) / 1000;
		const guess = prog.base + (ph.to - prog.base) * (1 - Math.exp(-t / ph.tau));
		prog.value = Math.max(prog.value, Math.min(guess, ph.to - 0.5));
	}
	progDraw();
}

function progDraw() {
	progEls().forEach((el) => {
		el.querySelector(".prog-fill").style.width = prog.value.toFixed(1) + "%";
		el.querySelector(".prog-pct").textContent = Math.floor(prog.value) + "%";
		el.querySelector(".prog-desc").textContent = prog.desc;
	});
}

function progStop() {
	clearInterval(prog.timer);
	prog.timer = null;
}

function progFinish(desc) {
	progRun = false;
	progStop();
	prog.phase = null;
	prog.value = 100;
	prog.desc = desc;
	progDraw();
	progEls().forEach((el) => el.classList.add("finished"));
	clearTimeout(prog.finishing);
	prog.finishing = setTimeout(() => progEls().forEach((el) => (el.hidden = true)), 6000);
}

function progFail(desc) {
	progRun = false;
	progStop();
	prog.phase = null;
	prog.desc = desc;
	progDraw();
	progEls().forEach((el) => {
		el.hidden = false;
		el.classList.add("failed");
	});
}

S.onSetupDetail((d) => {
	if (d.text) prog.desc = d.text;
	// SpotX's download is quick next to installing and patching (about 20 s against 17 s in a real
	// run), so it gets 4-30%; "Patching Spotify" lifts it to 45%, and the estimate creeps on to 55%
	if (prog.phase === "spotify" && d.pct != null) progAtLeast(4 + d.pct * 0.26);
	if (prog.phase === "spotify" && /Adding SpotX/.test(d.text || "")) progAtLeast(45);
	if (prog.phase === "extension" && d.sub != null) progAtLeast(PHASES.extension.from + d.sub * 12);
	progDraw();
});

function onSetupProgress({ step: id, state, text }) {
	if (state === "failed") progFail(text || "Setup stopped.");
	else if (state === "done" && PHASES[id]) progAtLeast(PHASES[id].to);
	else if (state === "running" || state === "waiting") progPhase(id, text);
	setupRunning = true;
	$("#setup-fail").hidden = true;
	$("#setup-all").disabled = true;
	$("#setup-again").disabled = true;
	const r = STEP_ROW[id];
	if (id === "connect") stepBtn.connect = true;
	if (r) {
		const st = { running: "running", waiting: "running", done: "ok", failed: "bad" }[state] ?? "neutral";
		setRow(r, st, text || "");
		activeStep = st === "running" ? r : activeStep === r ? null : activeStep;
	}
	drawSteps();
	if (current && wantFirstRun(current)) renderFirstRun(current.setup, { running: true }, current.connected, false);
}
S.onSetupProgress(onSetupProgress);

async function runSetupAction(name) {
	if (setupRunning) return;
	setupRunning = true;
	progRun = true;
	prog.value = 0;
	prog.phase = null;
	if (name === "removeAddons") progShow("Removing Spicetify and SpotX…");
	else progPhase(name === "spicetify" ? "spicetify" : name === "apply" ? "extension" : "spotify", "Starting…");
	$("#setup-fail").hidden = true;
	drawSteps();
	if (current && wantFirstRun(current)) renderFirstRun(current.setup, { running: true }, current.connected, false);
	try {
		render(await S.action(name));
	} finally {
		setupRunning = false;
		const d = await S.get();
		// every action ends the bar one way or another
		if (d.setupRun && d.setupRun.ok === false) progFail(d.setupRun.why || "Setup stopped.");
		else if (name === "removeAddons") progFinish("Removed. Spotify is back to normal.");
		else if (d.connected) progFinish("All set! Mercify is connected to Spotify.");
		else if (setupDone(d.setup)) progPhase("connect", d.connectNote || "Spotify is opening. If it asks you to log in, log in; Mercify finishes by itself.");
		else progFinish("Done.");
		render(d);
	}
}

async function copyDetails(btn) {
	await S.action("copySetupDetails");
	const was = btn.textContent;
	btn.textContent = "Copied";
	setTimeout(() => (btn.textContent = was), 3000);
}

$("#setup-all").addEventListener("click", () => runSetupAction("setupAll"));
$("#setup-again").addEventListener("click", () => runSetupAction("setupAll"));
$("#setup-retry").addEventListener("click", () => runSetupAction("setupAll"));
$("#setup-copy").addEventListener("click", () => copyDetails($("#setup-copy")));
$("#trouble-copy").addEventListener("click", () => copyDetails($("#trouble-copy")));
$("#remove-addons").addEventListener("click", async () => {
	if (setupRunning) return;
	const sure = confirm("Remove Spicetify and SpotX from Spotify?\n\nSpotify stays installed and goes back to normal. Mercify won't work with Spotify again until you run setup again.");
	if (sure) await runSetupAction("removeAddons");
});

// ---------------------------------------------------------------- YouTube (yt-dlp)

function renderYouTube(y) {
	if (!y) return;
	const btn = $("#yt-update");
	btn.hidden = !y.installed;
	btn.disabled = !!y.updating || !!y.installing;
	btn.textContent = y.updating ? "Updating…" : "Update yt-dlp";
	$("#yt-status").textContent = y.installing
		? "Downloading yt-dlp…"
		: y.error
			? `Couldn't get yt-dlp ready: ${y.error}`
			: y.installed
				? `Ready${y.version ? ` (yt-dlp ${y.version})` : ""}. It updates itself once a day.`
				: "Paste a YouTube link in the overlay's search bar to play a video. The first one downloads yt-dlp (about 18 MB).";
}
$("#yt-update").addEventListener("click", async () => {
	$("#yt-update").disabled = true;
	$("#yt-update").textContent = "Updating…";
	render(await S.action("ytUpdate"));
});

// ---------------------------------------------------------------- updates

function renderUpdate(u, version) {
	if (!u) return;
	const v = u.version || version || "";
	$("#update-version").textContent = v;
	const btn = $("#update-check");
	const banner = $("#update-banner");
	let dot = "",
		short = "",
		long = "",
		side = `v${v}`;
	banner.hidden = true;
	btn.hidden = false;
	btn.disabled = false;
	btn.textContent = "Check now";
	delete btn.dataset.install;
	switch (u.status) {
		case "off":
			short = "From source";
			long = "Updates are off when running from source.";
			side = `v${v} · From source`;
			btn.hidden = true;
			break;
		case "idle":
		case "checking":
			short = "Checking…";
			long = "Checking for updates…";
			side = `v${v} · Checking…`;
			btn.disabled = true;
			break;
		case "latest":
			dot = "ok";
			short = "Up to date";
			long = "You're on the latest version.";
			side = `v${v} · Up to date`;
			break;
		case "downloading":
			dot = "warn";
			short = `Downloading ${u.percent || 0}%`;
			long = `Downloading version ${u.newVersion}… ${u.percent || 0}%`;
			side = `Downloading ${u.newVersion}…`;
			btn.disabled = true;
			break;
		case "ready":
			dot = "ok";
			short = "Update ready";
			long = `Version ${u.newVersion} installs the next time Mercify closes.`;
			side = `${u.newVersion} ready to install`;
			btn.textContent = "Restart and update";
			btn.dataset.install = "1";
			$("#update-banner-text").textContent = `Mercify ${u.newVersion} is ready to install`;
			$("#update-banner-btn").textContent = "Restart and update";
			banner.hidden = false;
			break;
		case "available":
			dot = "warn";
			short = "Update available";
			long = `Version ${u.newVersion} is out. This portable copy can't update itself: download the new one and replace this file.`;
			side = `${u.newVersion} available`;
			btn.textContent = "Download";
			btn.dataset.install = "1";
			$("#update-banner-text").textContent = `Mercify ${u.newVersion} is available`;
			$("#update-banner-btn").textContent = "Download";
			banner.hidden = false;
			break;
		case "error":
			dot = "bad";
			short = "Couldn't check";
			long = `Couldn't check for updates: ${u.error}`;
			break;
	}
	$("#update-dot").className = "dot " + dot;
	$("#update-status-pill").className = "ver-status " + (dot === "bad" ? "" : dot);
	$("#update-short").textContent = short;
	$("#update-status").textContent = long;
	$("#side-dot").className = "dot " + dot;
	$("#side-text").textContent = side;
	$("#nav-general-dot").hidden = !(u.status === "ready" || u.status === "available");
}

$("#update-check").addEventListener("click", async (e) => {
	const install = !!e.currentTarget.dataset.install;
	render(await S.action(install ? "installUpdate" : "checkUpdate"));
});
$("#update-banner-btn").addEventListener("click", async () => render(await S.action("installUpdate")));

// ---------------------------------------------------------------- now playing (Home)

let player = null;

function fmt(ms) {
	const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function playerPos() {
	const p = player;
	if (!p) return 0;
	const base = p.position || 0;
	return p.isPlaying ? Math.min(p.duration || Infinity, base + (Date.now() - (p.at || Date.now()))) : base;
}

function drawPlayer() {
	const connected = !!current?.connected;
	const p = player;
	const has = connected && p && !p.empty && p.name;
	$("#np-title").textContent = !connected ? "Spotify isn't connected" : has ? p.name : "Nothing playing";
	$("#np-artist").textContent = !connected
		? current?.setup?.supported && !setupDone(current.setup)
			? "Finish setup to connect Spotify"
			: "Open Spotify to see what's playing"
		: has
			? (p.artists || []).join(", ")
			: "Pick something in the overlay or in Spotify";
	const img = $("#np-art");
	const src = has && /^(https:|data:image\/)/.test(p.image || "") ? p.image : "";
	if (img.dataset.src !== src) {
		img.dataset.src = src;
		if (src) img.src = src;
		else img.removeAttribute("src");
	}
	img.hidden = !src;
	$("#np-time-row").hidden = !has;
	for (const id of ["#np-prev", "#np-play", "#np-next"]) $(id).disabled = !connected;
	const playing = has && p.isPlaying;
	$("#np-play-icon").setAttribute("d", playing ? ICON.pause : ICON.play);
	$("#np-play").setAttribute("aria-label", playing ? "Pause" : "Play");
	drawProgress();
}
function drawProgress() {
	const p = player;
	if (!p || p.empty) return;
	const pos = playerPos();
	$("#np-fill").style.width = p.duration ? Math.min(100, (pos / p.duration) * 100).toFixed(2) + "%" : "0";
	$("#np-pos").textContent = fmt(pos);
	$("#np-dur").textContent = fmt(p.duration);
}
setInterval(() => {
	if (page === "home" && player?.isPlaying && !document.hidden) drawProgress();
}, 500);

S.onPlayer((p) => {
	player = p;
	if (page === "home") drawPlayer();
});
async function playerCmd(action) {
	if (action === "playPause" && player && !player.empty) {
		player = { ...player, isPlaying: !player.isPlaying, position: playerPos(), at: Date.now() }; // answer the click straight away
		drawPlayer();
	}
	await S.player(action);
}
$("#np-play").addEventListener("click", () => playerCmd("playPause"));
$("#np-prev").addEventListener("click", () => playerCmd("prev"));
$("#np-next").addEventListener("click", () => playerCmd("next"));

// ---------------------------------------------------------------- lobby, profile, friends

function avatarHTML(av, name, cls = "") {
	const clear = av && av.startsWith("data:image/png;") ? " clear" : "";
	if (av && /^data:image\/(jpeg|png|webp);base64,/.test(av)) return `<span class="av${cls}${clear}"><img src="${esc(av)}" alt="" /></span>`;
	return `<span class="av${cls}">${esc((name || "?").trim().charAt(0).toUpperCase() || "?")}</span>`;
}

function renderAvatar(av, name) {
	const prev = $("#avatar-preview");
	const clear = !!av && av.startsWith("data:image/png;"); // transparent background
	prev.classList.toggle("clear", clear);
	$("#avatar-pick").classList.toggle("clear", clear);
	$("#avatar-pick").classList.toggle("has", !!av);
	if (av) {
		if (prev.dataset.src !== av) {
			prev.innerHTML = "";
			const img = document.createElement("img");
			img.src = av;
			img.alt = "";
			prev.append(img);
			prev.dataset.src = av;
		}
	} else {
		prev.dataset.src = "";
		prev.innerHTML = "";
		const t = (name || "").trim().charAt(0).toUpperCase();
		if (t) prev.textContent = t;
		else prev.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>';
	}
	$("#avatar-choose").textContent = av ? "Change picture" : "Choose a profile picture";
	$("#avatar-clear").hidden = !av;
}

async function pickAvatar() {
	const r = await S.pickAvatar();
	$("#avatar-error").textContent = r.ok ? "" : r.error;
	$("#avatar-error").hidden = r.ok;
	render(r.state);
}

let lobbyCopied = false; // the code was put on the clipboard for you (Start a lobby)
function showLobbyError(msg) {
	$("#lobby-error").textContent = msg || "";
	$("#lobby-error").hidden = !msg;
}

function renderLobby(l, ready) {
	if (!l) return;
	const nameEl = $("#lobby-name");
	if (document.activeElement !== nameEl) nameEl.value = l.name || "";
	const joined = l.status === "joined";
	const connecting = l.status === "connecting";
	$("#lobby-out").hidden = joined || connecting;
	$("#lobby-in").hidden = !joined && !connecting;
	$("#lobby-card").classList.toggle("in", joined);
	$("#lobby-codeval").textContent = joined || connecting ? l.displayCode || "" : "";
	$("#lobby-copy").hidden = !joined;
	$("#lobby-leave").textContent = connecting ? "Cancel" : "Leave";
	const role = $("#lobby-role");
	role.classList.toggle("waiting", connecting);
	role.lastElementChild.textContent = connecting ? "Joining…" : l.role === "host" ? "Hosting" : `Listening with ${l.hostName || "the host"}`;
	const n = (l.members || []).length;
	$("#lobby-count").textContent = joined ? `${n} listening` : "";
	$("#lobby-members").innerHTML = joined
		? l.members
				.map((m) => {
					const tag = m.you ? (m.role === "host" ? "Host · You" : "You") : m.role === "host" ? "Host" : "";
					return `<div class="member">${avatarHTML(m.av, m.name)}<b>${esc(m.name)}</b><span class="role">${tag}</span></div>`;
				})
				.join("")
		: "";
	if (l.status === "error" && l.error) showLobbyError(l.error);
	else if (joined || connecting) showLobbyError("");
	if (!joined) lobbyCopied = false;
	const hint = $("#lobby-hint");
	const needSetup = !ready && !joined && !connecting;
	hint.hidden = !(needSetup || (joined && lobbyCopied));
	hint.textContent = needSetup ? "Finish setup first: lobbies play through Spotify." : "Code copied. Share it so friends can join.";
	for (const id of ["#lobby-start", "#lobby-join", "#lobby-code"]) $(id).disabled = !ready;

	$("#nav-lobby-dot").hidden = !joined;
	$("#tile-lobby").textContent = joined ? l.displayCode : connecting ? "Joining…" : "None";
}

function renderFriends(f, lobbyState) {
	const list = $("#friend-list");
	if (!f) return;
	const here = new Set((lobbyState?.status === "joined" ? lobbyState.members : []).filter((m) => m.fid && !m.you).map((m) => m.fid));
	if (!f.friends.length) {
		list.innerHTML = '<p class="empty">No friends yet. Right-click someone in a lobby to add them.</p>';
		return;
	}
	list.innerHTML = f.friends
		.map((fr) => {
			const inMine = here.has(fr.fid);
			let line,
				lineCls = "";
			if (!fr.online) line = "Offline";
			else if (inMine) (line = "In your lobby"), (lineCls = "here");
			else if (fr.track) line = `${fr.playing ? "" : "Paused: "}${fr.track.name}${fr.track.artists?.length ? " · " + fr.track.artists.join(", ") : ""}`;
			else if (fr.inLobby) line = fr.host ? "Hosting a lobby" : "In a lobby";
			else line = "Online";
			let btn = "";
			if (fr.online && fr.joinable && !inMine) {
				if (fr.requested) btn = `<button class="btn small ghost" data-fid="${esc(fr.fid)}" data-cancel="1">Cancel</button>`;
				else btn = `<button class="btn small ghost" data-fid="${esc(fr.fid)}" ${fr.cooldown ? "disabled" : ""}>Ask to join</button>`;
			}
			return `<div class="friend${fr.online ? "" : " off"}">${avatarHTML(fr.av, fr.name, " lg")}<div class="friend-text"><b>${esc(fr.name)}</b><span class="${lineCls}">${esc(line)}</span></div>${btn}</div>`;
		})
		.join("");
}
$("#friend-list").addEventListener("click", async (e) => {
	const b = e.target.closest("button[data-fid]");
	if (!b) return;
	b.disabled = true;
	const r = await S.friendJoin(b.dataset.fid, !!b.dataset.cancel);
	if (!r.ok) showLobbyError(r.error);
});
S.onFriends((f) => {
	if (current) current.friends = f;
	renderFriends(f, current?.lobby);
});

// Starting or joining needs a name first; saved before joining, like the overlay's panel.
async function lobbyNameReady() {
	const name = $("#lobby-name").value.trim();
	if (!name) {
		showLobbyError("Enter your name first (under the lobby).");
		$("#lobby-name").focus();
		return false;
	}
	if (name !== (current?.lobby?.name || "")) render(await S.set("lobbyName", name));
	return true;
}
async function lobbyGo(run) {
	showLobbyError("");
	if (!(await lobbyNameReady())) return;
	for (const id of ["#lobby-start", "#lobby-join"]) $(id).disabled = true;
	try {
		const r = await run();
		if (r.copied) lobbyCopied = true;
		render(r.state);
		if (!r.ok) showLobbyError(r.error);
	} finally {
		for (const id of ["#lobby-start", "#lobby-join"]) $(id).disabled = false;
	}
}
// Phone remote: the paired-devices list and the pairing QR.
function phoneTimeAgo(ts) {
	if (!ts) return "";
	const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
	if (s < 60) return "just now";
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} h ago`;
	return `${Math.round(h / 24)} d ago`;
}
function renderPhone(r) {
	if (!r) return;
	const devices = r.devices || [];
	$("#phone-devices").innerHTML = devices.length
		? devices
				.map((d) => {
					const status = d.online ? '<span class="role">Online</span>' : `<span class="role dim">Last seen ${esc(phoneTimeAgo(d.lastSeen))}</span>`;
					return `<div class="member"><b>${esc(d.name || "Phone")}</b>${status}<button class="link muted-link" data-forget="${esc(d.fid)}">Unpair</button></div>`;
				})
				.join("")
		: '<p class="hint dim">No phones paired yet.</p>';
	$("#phone-pair-start").hidden = !!r.pairing;
	$("#phone-pair-live").hidden = !r.pairing;
	if (!r.pairing) $("#phone-qr").removeAttribute("src");
}
$("#phone-pair").addEventListener("click", async () => {
	$("#phone-error").hidden = true;
	const r = await S.remotePair();
	if (r && r.ok) {
		$("#phone-qr").src = r.dataUrl;
		$("#phone-code").textContent = (r.code || "").replace(/(.{4})/g, "$1 ").trim();
		$("#phone-pair-start").hidden = true;
		$("#phone-pair-live").hidden = false;
	} else {
		$("#phone-error").hidden = false;
		$("#phone-error").textContent = (r && r.error) || "Couldn't start pairing.";
	}
});
$("#phone-pair-cancel").addEventListener("click", () => S.remoteStopPair());
$("#phone-devices").addEventListener("click", (e) => {
	const fid = e.target?.dataset?.forget;
	if (fid) S.remoteForget(fid);
});

const pvtTestBtn = $("#pvt-test");
if (pvtTestBtn)
	pvtTestBtn.addEventListener("click", async () => {
		const out = $("#pvt-test-result");
		pvtTestBtn.disabled = true;
		pvtTestBtn.textContent = "Testing…";
		out.hidden = false;
		out.textContent = "Turning private session on and watching whether Spotify keeps it…";
		try {
			const r = await S.testPrivate();
			out.textContent = (r && r.verdict) || "No result.";
		} catch (e) {
			out.textContent = "Test failed: " + (e.message || e);
		}
		pvtTestBtn.disabled = false;
		pvtTestBtn.textContent = "Test private session";
	});

function renderTurn(t) {
	if (!t) return;
	const appEl = $("#turn-app");
	if (appEl && document.activeElement !== appEl) appEl.value = t.app || "";
	const saved = $("#turn-saved");
	if (saved) saved.hidden = !t.hasKey;
	const keyEl = $("#turn-key");
	if (keyEl && document.activeElement !== keyEl) keyEl.placeholder = t.hasKey ? "Leave blank to keep the saved key" : "Paste your API key";
}
const turnSave = $("#turn-save");
if (turnSave)
	turnSave.addEventListener("click", async () => {
		const out = $("#turn-result");
		out.hidden = false;
		out.textContent = "Saving…";
		const d = await S.setTurn($("#turn-app").value, $("#turn-key").value);
		$("#turn-key").value = "";
		render(d);
		out.textContent = d?.turn?.hasKey ? "Saved. Away-from-home audio is ready." : "Cleared.";
	});
const turnClear = $("#turn-clear");
if (turnClear)
	turnClear.addEventListener("click", async () => {
		$("#turn-app").value = "";
		$("#turn-key").value = "";
		render(await S.setTurn("", ""));
		$("#turn-result").hidden = false;
		$("#turn-result").textContent = "Removed. Audio will work on your own network only.";
	});

$("#lobby-start").addEventListener("click", () => lobbyGo(() => S.lobbyStart()));
const joinTyped = () => {
	const code = $("#lobby-code").value.trim();
	if (code.replace(/[^a-z0-9]/gi, "").length < 4) {
		showLobbyError("Lobby codes need at least 4 letters or numbers.");
		$("#lobby-code").focus();
		return;
	}
	lobbyGo(() => S.lobbyJoin(code));
};
$("#lobby-join").addEventListener("click", joinTyped);
$("#lobby-code").addEventListener("keydown", (e) => e.key === "Enter" && joinTyped());
$("#lobby-copy").addEventListener("click", () => {
	S.lobbyCopy();
	lobbyCopied = true;
	renderLobby(current?.lobby, true);
});
$("#lobby-leave").addEventListener("click", async () => render(await S.action("leaveLobby")));

const saveLobbyName = async () => {
	const v = $("#lobby-name").value.trim();
	if (v !== (current?.lobby?.name || "")) render(await S.set("lobbyName", v));
};
$("#lobby-name").addEventListener("change", saveLobbyName);
$("#lobby-name").addEventListener("keydown", (e) => e.key === "Enter" && e.target.blur());
$("#avatar-pick").addEventListener("click", pickAvatar);
$("#avatar-choose").addEventListener("click", pickAvatar);
$("#avatar-clear").addEventListener("click", async () => render(await S.clearAvatar()));

// ---------------------------------------------------------------- overlay: apps

function renderApps(d) {
	const only = d.onlyShowOver;
	$("#only-enabled").checked = only.enabled;
	$("#only-enabled").disabled = !d.foregroundSupported;
	if (!d.foregroundSupported) $("#only-hint").textContent = "Only available on Windows.";
	const box = $("#apps");
	box.classList.toggle("off", !only.enabled);
	const item = (value, kind) =>
		`<div class="app"><b title="${esc(value)}">${esc(value)}</b>${kind ? `<span class="kind">${kind}</span>` : ""}<button class="x" data-remove="${esc(value)}" aria-label="Remove ${esc(value)}">${ICON.x}</button></div>`;
	box.innerHTML = [...only.apps.map((a) => item(a, "")), ...only.titles.map((t) => item(t, "Window title"))].join("") || '<p class="empty">No apps yet: the overlay stays hidden.</p>';
	if (d.gateText != null) showGate(only.enabled ? d.gateText : "");

	const all = [...only.titles, ...only.apps];
	$("#tile-over").innerHTML = !only.enabled ? "Everywhere" : all.length ? `<span class="ell">${esc(all[0])}</span>${all.length > 1 ? `<span class="more">+${all.length - 1}</span>` : ""}` : "Nothing yet";
}
$("#apps").addEventListener("click", async (e) => {
	const b = e.target.closest("button[data-remove]");
	if (b) render(await S.removeApp(b.dataset.remove));
});
function showGate(t) {
	$("#gate-now").hidden = !t;
	$("#gate-now").textContent = t || "";
}
S.onGate(showGate);

$("#only-enabled").addEventListener("change", async (e) => render(await S.set("onlyShowOver.enabled", e.target.checked)));

async function addApp() {
	const v = $("#app-input").value.trim();
	if (!v) return;
	$("#app-input").value = "";
	render(await S.addApp(v));
}
$("#app-add").addEventListener("click", addApp);
$("#app-input").addEventListener("keydown", (e) => e.key === "Enter" && addApp());

$("#app-pick").addEventListener("click", async () => {
	const b = $("#app-pick");
	b.disabled = true;
	$("#pick-msg").hidden = true;
	for (let i = 5; i > 0; i--) {
		b.textContent = `Click into your game… ${i}`;
		await new Promise((r) => setTimeout(r, 1000));
	}
	const res = await S.pickApp();
	b.disabled = false;
	b.textContent = "Pick the app in front";
	if (res.message) {
		$("#pick-msg").textContent = res.message;
		$("#pick-msg").hidden = false;
	}
	render(res.state);
});

// ---------------------------------------------------------------- switches bound to settings

const DEFAULT_ON = new Set(["friendsShareListening", "friendsAllowJoin", "discordYouTube", "onlyShowOver.stayOnOtherMonitor"]);
const boundValue = (d, key) => {
	const v = key.split(".").reduce((o, k) => o?.[k], d);
	return DEFAULT_ON.has(key) ? v !== false : !!v;
};
function renderSwitches(d) {
	$$(".sw[data-bind]").forEach((el) => {
		el.checked = boundValue(d, el.dataset.bind);
		if (el.dataset.bind === "onlyShowOver.stayOnOtherMonitor") el.disabled = !d.onlyShowOver.enabled;
	});
	const pvt = $("#pvt-sub");
	if (pvt) {
		const s = d.privateSessionState;
		const msgs = {
			on: "On — Mercify keeps it on while you're in a lobby (Spotify's lock icon can flash off with SpotX, but the session is private)",
			unverified: "Turned on — this Spotify can't report the state back, but Mercify holds it",
			cleared: "Mercify keeps turning it back on every 20 s",
			"not found": "Couldn't find Spotify's private-session switch (see Setup ▸ Copy details)",
			error: "Couldn't reach Spotify to set it",
			outdated: "Spotify has an older Mercify extension — Setup ▸ Redo next to Mercify extension",
		};
		pvt.textContent = d.privateSessionInLobby === false ? "Keeps friends' picks out of your recommendations" : msgs[s] || "Turns on when you join a lobby";
	}
}
$$(".sw[data-bind]").forEach((el) => el.addEventListener("change", async () => render(await S.set(el.dataset.bind, el.checked))));

// ---------------------------------------------------------------- hotkeys
// "Change" listens for the next key combination. Meanwhile the main process releases every hotkey
// (a registered one would never reach this window); Esc, another page or leaving the window cancels.

const HOTKEYS = [
	["toggle", "Show / hide panels"],
	["edit", "Edit Mode"],
	["search", "Search"],
	["playPause", "Play / pause"],
	["next", "Next track"],
	["prev", "Previous track"],
];
const OPTIONAL = new Set(["playPause", "next", "prev"]);
const KEY_NAMES = { Control: "Ctrl", Super: "Win", Return: "Enter", MediaPlayPause: "Media Play/Pause", MediaNextTrack: "Media Next", MediaPreviousTrack: "Media Previous", MediaStop: "Media Stop", VolumeUp: "Volume Up", VolumeDown: "Volume Down", VolumeMute: "Mute", numadd: "Num +", numsub: "Num -", nummult: "Num *", numdiv: "Num /", numdec: "Num ." };
const keyName = (k) => KEY_NAMES[k] || (/^num\d$/.test(k) ? "Num " + k.slice(3) : k);
const capsHTML = (accel) => `<span class="caps">${accel.split("+").map((k) => `<span class="cap${/^[^\w\s]$/.test(k) ? " sym" : ""}">${esc(keyName(k))}</span>`).join("")}</span>`;

let capturing = null; // the hotkey listening for new keys
let captureMods = "";

function renderHotkeys(d) {
	const keys = d.hotkeys || {};
	$("#hk-list").innerHTML = HOTKEYS.map(([name, label]) => {
		const accel = keys[name] || "";
		let mid, btns;
		if (capturing === name) {
			mid = `<span class="listening">${esc(captureMods || "Press the new keys…")}</span>`;
			btns = '<button class="btn small ghost" data-hk-cancel="1">Cancel</button>';
		} else {
			mid = accel ? capsHTML(accel) : '<span class="unset">Not set</span>';
			btns = `${OPTIONAL.has(name) && accel ? `<button class="x" data-hk-clear="${name}" aria-label="Clear ${esc(label)}">${ICON.x}</button>` : ""}<button class="btn small ghost" data-hk="${name}">${accel ? "Change" : "Set"}</button>`;
		}
		return `<div class="hk"><b>${esc(label)}</b><div>${mid}</div><div class="hk-btns">${btns}</div></div>`;
	}).join("");
	$("#hk-lead").textContent = d.hotkeysOnlyOverApps ? "Active while your game is in front. Edit Mode works everywhere." : "Active everywhere.";
	const failed = (d.failedHotkeys || []).map((f) => {
		const name = f.split(" (")[0];
		return (HOTKEYS.find(([n]) => n === name) || [, name])[1];
	});
	$("#nav-hotkeys-dot").hidden = !failed.length;
	if (failed.length && !hkErrorShown) showHkError(`Not working: ${failed.join(", ")}. Another program may be using ${failed.length > 1 ? "them" : "it"}; pick something else.`, true);
	else if (!failed.length && hkErrorFromFail) showHkError("");
	$("#home-keys").innerHTML = [
		["toggle", "Show / hide"],
		["search", "Search"],
		["edit", "Edit Mode"],
	]
		.map(([n, l]) => `<div class="keyrow"><span>${l}</span>${keys[n] ? capsHTML(keys[n]) : '<span class="unset">Not set</span>'}</div>`)
		.join("");
}

let hkErrorShown = false;
let hkErrorFromFail = false;
function showHkError(msg, fromFail = false) {
	hkErrorShown = !!msg && !fromFail;
	hkErrorFromFail = !!msg && fromFail;
	$("#hk-error").textContent = msg || "";
	$("#hk-error").hidden = !msg;
}

async function startCapture(name) {
	showHkError("");
	capturing = name;
	captureMods = "";
	await S.hotkeyCapture(true);
	renderHotkeys(current);
}
async function stopCapture() {
	capturing = null;
	captureMods = "";
	await S.hotkeyCapture(false);
	if (current) renderHotkeys(current);
}

$("#hk-list").addEventListener("click", async (e) => {
	const b = e.target.closest("button");
	if (!b) return;
	if (b.dataset.hkCancel) return stopCapture();
	if (b.dataset.hk) return startCapture(b.dataset.hk);
	if (b.dataset.hkClear) {
		const r = await S.setHotkey(b.dataset.hkClear, "");
		showHkError(r.ok ? "" : r.error);
		render(r.state);
	}
});
$("#hk-reset").addEventListener("click", async () => {
	if (capturing) await stopCapture();
	showHkError("");
	render(await S.resetHotkeys());
});

const CODE_KEYS = {
	Backquote: "`",
	Minus: "-",
	Equal: "=",
	BracketLeft: "[",
	BracketRight: "]",
	Backslash: "\\",
	Semicolon: ";",
	Quote: "'",
	Comma: ",",
	Period: ".",
	Slash: "/",
	Space: "Space",
	Enter: "Return",
	Tab: "Tab",
	Backspace: "Backspace",
	Delete: "Delete",
	Insert: "Insert",
	Home: "Home",
	End: "End",
	PageUp: "PageUp",
	PageDown: "PageDown",
	ArrowUp: "Up",
	ArrowDown: "Down",
	ArrowLeft: "Left",
	ArrowRight: "Right",
	NumpadAdd: "numadd",
	NumpadSubtract: "numsub",
	NumpadMultiply: "nummult",
	NumpadDivide: "numdiv",
	NumpadDecimal: "numdec",
	PrintScreen: "PrintScreen",
	MediaPlayPause: "MediaPlayPause",
	MediaTrackNext: "MediaNextTrack",
	MediaTrackPrevious: "MediaPreviousTrack",
	MediaStop: "MediaStop",
	AudioVolumeUp: "VolumeUp",
	AudioVolumeDown: "VolumeDown",
	AudioVolumeMute: "VolumeMute",
};
function keyFromCode(code) {
	if (/^Key[A-Z]$/.test(code)) return code.slice(3);
	if (/^Digit\d$/.test(code)) return code.slice(5);
	if (/^Numpad\d$/.test(code)) return "num" + code.slice(6);
	if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
	return CODE_KEYS[code] || null;
}

// Electron accelerator from a key press: modifiers first, then the key ("Control+Shift+P").
function accelFromEvent(e) {
	const mods = [];
	if (e.ctrlKey) mods.push("Control");
	if (e.altKey) mods.push("Alt");
	if (e.shiftKey) mods.push("Shift");
	if (e.metaKey) mods.push("Super");
	const key = keyFromCode(e.code);
	if (!key) return { mods }; // a modifier on its own so far, or a key hotkeys can't use
	const bare = /^(F\d+|Media\w+|Volume\w+)$/.test(key);
	const strong = e.ctrlKey || e.altKey || e.metaKey;
	if (!bare && !strong) return { mods, error: "Add Ctrl or Alt, so the key still works normally in your game." };
	return { accel: [...mods, key].join("+") };
}

document.addEventListener(
	"keydown",
	async (e) => {
		if (!capturing) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return stopCapture();
		const r = accelFromEvent(e);
		if (!r.accel) {
			captureMods = r.mods.length ? r.mods.map(keyName).join(" + ") + " + …" : "";
			if (r.error) showHkError(r.error);
			renderHotkeys(current);
			return;
		}
		const name = capturing;
		capturing = null;
		captureMods = "";
		const res = await S.setHotkey(name, r.accel); // checked while every hotkey is released
		await S.hotkeyCapture(false);
		showHkError(res.ok ? "" : res.error);
		render(res.state);
	},
	true
);
document.addEventListener("keyup", (e) => {
	if (!capturing) return;
	const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Win"].filter(Boolean);
	captureMods = mods.length ? mods.join(" + ") + " + …" : "";
	renderHotkeys(current);
});
window.addEventListener("blur", () => capturing && stopCapture());

// ---------------------------------------------------------------- theme

$$('input[name="theme"]').forEach((el) =>
	el.addEventListener("change", async () => {
		if (!el.checked) return;
		applyTheme(el.value);
		render(await S.set("theme", el.value));
	})
);

// ---------------------------------------------------------------- render

function render(d) {
	if (!d) return;
	current = d;
	premiumNow = d.spotifyPremium === true;
	connectNote = d.connectNote || "";
	if (d.theme && d.theme !== document.documentElement.dataset.theme) applyTheme(d.theme);
	$$('input[name="theme"]').forEach((el) => (el.checked = el.value === (d.theme || "classic")));
	if ("player" in d && !player) player = d.player;

	const s = d.setup;
	const ready = !s?.supported || setupDone(s);
	renderUpdate(d.update, d.version);
	renderYouTube(d.youtube);
	renderLobby(d.lobby, ready);
	renderPhone(d.remote);
	renderTurn(d.turn);
	renderFriends(d.friends, d.lobby);
	renderAvatar(d.avatar, d.lobby?.name);
	renderApps(d);
	renderSwitches(d);
	renderHotkeys(d);

	const conn = $("#conn");
	conn.classList.toggle("ok", !!d.connected);
	conn.querySelector(".pill-text").textContent = d.connected ? "Spotify connected" : "Spotify not connected";
	const tile = $("#tile-spotify");
	tile.classList.toggle("warn", !d.connected);
	tile.textContent = !d.connected ? "Not connected" : d.spotifyPremium === true ? "Premium" : d.spotifyPremium === false ? "Free" : "Connected";
	$("#spotify-premium").checked = premiumNow;

	renderSetup(s, d.setupRun, d.connected);
	if (!d.connected) player = null;
	drawPlayer();
}

showPage(new URLSearchParams(location.search).get("page") || "home");
S.onPage((p) => {
	if ($("#firstrun").hidden) showPage(p);
});
S.onChanged(render);
S.onLog(() => {}); // the full log isn't shown; "Copy details" copies it from the main process
S.get().then(render);
