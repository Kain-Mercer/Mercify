"use strict";

const S = window.settings;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let busy = false;
let current = null;

function row(step) {
	return document.querySelector(`.row[data-step="${step}"]`);
}

function setRow(step, state, sub, button) {
	const r = row(step);
	r.querySelector(".dot").className = "dot " + state;
	if (sub != null) r.querySelector(".sub").textContent = sub;
	const b = r.querySelector("button");
	if (!b || button === undefined) return;
	if (button === null) b.hidden = true;
	else {
		b.hidden = false;
		if (button) b.textContent = button;
	}
}

// ---------------------------------------------------------------- setup
// Poka-yoke: one big button does everything in order; the small "Redo" buttons are for repairs
// and are locked while anything runs. Progress comes live from the main process.

let setupRunning = false;
const STEP_ROW = { spotify: "spotify", firstrun: "spotify", spicetify: "spicetify", extension: "extension", connect: "connect" };

function setupDone(s) {
	return s.spotify && s.spotx && s.spicetify && s.extension === "current";
}

let connectNote = "";
function renderSetup(s, run, connected) {
	if (!s.supported) {
		$("#setup-section").hidden = true;
		return;
	}
	// the bar after the steps: waiting for you to log in, then done once Spotify connects
	const ranOk = run && !run.running && run.ok;
	if (ranOk && connected && !$("#setup-progress").hidden && !$("#setup-progress").classList.contains("finished")) progFinish("All set! Mercify is connected to Spotify.");
	else if (ranOk && !connected && setupDone(s)) {
		progPhase("connect", "Spotify is opening. If it asks you to log in, log in; Mercify finishes by itself.");
		if (connectNote) (prog.desc = connectNote), progDraw(); // "You're logged in. Restarting Spotify…"
	}
	setupRunning = !!run?.running;
	// Settings opened (or re-rendered) mid-run: show each step as far as it got
	if (setupRunning && run.steps) for (const [step, p] of Object.entries(run.steps)) onSetupProgress({ step, ...p });
	if (!setupRunning) {
		if (s.spotify && s.spotx) setRow("spotify", "ok", s.spotifyRunning ? "Installed and running" : "Installed");
		else if (s.spotify) setRow("spotify", "warn", "Installed, but without SpotX (it stops Spotify updates from breaking Mercify)");
		else if (s.storeSpotify) setRow("spotify", "warn", "You have the Microsoft Store version, which can't be used. Setup replaces it.");
		else if (s.spotifyLeftovers) setRow("spotify", "neutral", "Not installed (an earlier Spotify left a few files behind; setup tidies them up)");
		else setRow("spotify", "neutral", "Not installed yet");
		// grey until it's tried: red only ever means "this failed"
		setRow("spicetify", s.spicetify ? "ok" : "neutral", s.spicetify ? "Installed" : "Not installed yet");
		if (s.extension === "current") setRow("extension", "ok", `Installed (v${s.appliedVersion ?? "?"})`);
		else if (s.extension === "outdated") setRow("extension", "warn", `Needs an update (v${s.appliedVersion ?? "?"} → v${s.bundledVersion})`);
		else setRow("extension", "neutral", "Not installed yet");
		document.querySelectorAll("#setup-section .row").forEach((r) => r.classList.remove("active"));
	}
	// Spotify only loads the extension once you're logged in, so this is the last thing to turn green
	const openBtn = row("connect").querySelector("button");
	if (connected) {
		setRow("connect", "ok", "Connected");
		openBtn.hidden = true;
	} else if (setupDone(s)) {
		setRow("connect", "warn", connectNote || "Not yet. Open Spotify and log in; this turns green by itself.");
		openBtn.hidden = false;
	} else if (!setupRunning || !run?.steps?.connect) {
		setRow("connect", "neutral", "After the steps above");
		openBtn.hidden = true;
	}
	const done = setupDone(s);
	$("#remove-addons").hidden = setupRunning || !(s.spicetify || s.spotx);
	$("#setup-go").hidden = done && !setupRunning;
	$("#setup-hint").textContent = done && !setupRunning ? "All done. Green means done." : "Green means done.";
	const big = $("#setup-all");
	big.disabled = setupRunning;
	big.textContent = setupRunning ? "Setting up… you can leave this running" : s.spotify || s.spicetify ? "Finish setup" : "Set up everything";
	const failed = run && !run.running && run.ok === false;
	$("#setup-fail").hidden = !failed;
	if (failed) $("#setup-go").hidden = true; // "Try again" is the one button now
	if (failed && STEP_ROW[run.step]) setRow(STEP_ROW[run.step], "", run.why);
	// nothing else matters until setup's done: the lobby needs Spotify working first
	$("#lobby-card").hidden = !done;
	if (failed) $("#setup-fail-text").textContent = run.why || "Something went wrong.";
	// the Redo buttons: only once there's something to redo, never while running
	row("spotify").querySelector("button").hidden = !s.spotify;
	row("spicetify").querySelector("button").hidden = !s.spicetify;
	row("extension").querySelector("button").hidden = s.extension === "missing";
	document.querySelectorAll("#setup-section .row button[data-act]").forEach((b) => (b.disabled = setupRunning || !s.spotify));
}

// ---------------------------------------------------------------- progress bar (header)
// Setup can't know how long each step will take, so the bar is an estimate: each step owns a
// slice (installing Spotify is by far the longest) and eases towards the end of it, never going
// backwards. Real numbers replace the guess where there are any (SpotX's download percentage,
// Spicetify's "Patching files [n/286]").
const PHASES = {
	spotify: { from: 2, to: 55, tau: 80 },
	firstrun: { from: 55, to: 60, tau: 8 },
	spicetify: { from: 60, to: 74, tau: 10 },
	extension: { from: 74, to: 90, tau: 12 },
	connect: { from: 90, to: 99, tau: 45 },
};
const prog = { phase: null, value: 0, base: 0, since: 0, desc: "", timer: null, finishing: null };

function progShow(desc) {
	const el = $("#setup-progress");
	el.hidden = false;
	el.classList.remove("finished", "failed");
	clearTimeout(prog.finishing);
	prog.finishing = null;
	if (desc != null) prog.desc = desc;
	if (!prog.timer) prog.timer = setInterval(progTick, 200);
	progDraw();
}

function progPhase(step, desc) {
	const ph = PHASES[step];
	if (!ph) return;
	if (prog.phase !== step) {
		prog.phase = step;
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
	$("#setup-progress .prog-fill").style.width = prog.value.toFixed(1) + "%";
	$("#setup-progress .prog-pct").textContent = Math.floor(prog.value) + "%";
	$("#setup-progress .prog-desc").textContent = prog.desc;
}

function progStop() {
	clearInterval(prog.timer);
	prog.timer = null;
}

function progFinish(desc) {
	progStop();
	prog.phase = null;
	prog.value = 100;
	prog.desc = desc;
	progDraw();
	$("#setup-progress").classList.add("finished");
	clearTimeout(prog.finishing);
	prog.finishing = setTimeout(() => ($("#setup-progress").hidden = true), 6000);
}

function progFail(desc) {
	progStop();
	prog.phase = null;
	prog.desc = desc;
	progDraw();
	$("#setup-progress").hidden = false;
	$("#setup-progress").classList.add("failed");
}

S.onSetupDetail((d) => {
	if (d.text) prog.desc = d.text;
	if (prog.phase === "spotify" && d.pct != null) progAtLeast(4 + d.pct * 0.42); // the download is most of this step
	if (prog.phase === "extension" && d.sub != null) progAtLeast(PHASES.extension.from + d.sub * 12);
	progDraw();
});

function onSetupProgress({ step, state, text }) {
	if (state === "failed") progFail(text || "Setup stopped.");
	else if (state === "done" && PHASES[step]) progAtLeast(PHASES[step].to);
	else if (state === "running" || state === "waiting") progPhase(step, text);
	setupRunning = true;
	$("#setup-fail").hidden = true;
	$("#setup-all").disabled = true;
	document.querySelectorAll("#setup-section .row button[data-act]").forEach((b) => (b.disabled = true));
	const r = STEP_ROW[step];
	if (step === "connect") row("connect").querySelector("button").hidden = false;
	if (!r) return;
	const dot = { running: "running", waiting: "running", done: "ok", failed: "" }[state] ?? "";
	setRow(r, dot, text || "");
	document.querySelectorAll("#setup-section .row").forEach((x) => x.classList.toggle("active", x.dataset.step === r && dot === "running"));
}

async function runSetupAction(name) {
	if (setupRunning) return;
	setupRunning = true;
	prog.value = 0;
	prog.phase = null;
	if (name === "removeAddons") progShow("Removing Spicetify and SpotX…");
	else progPhase(name === "spicetify" ? "spicetify" : name === "apply" ? "extension" : "spotify", "Starting…");
	$("#setup-fail").hidden = true;
	$("#setup-all").disabled = true;
	document.querySelectorAll("#setup-section .row button[data-act]").forEach((b) => (b.disabled = true));
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

function renderUpdate(u) {
	if (!u) return;
	$("#update-version").textContent = `Version ${u.version}`;
	const dot = $("#update-dot");
	const btn = $("#update-check");
	const text = $("#update-status");
	const banner = $("#update-banner");
	banner.hidden = true;
	btn.hidden = false;
	btn.disabled = false;
	btn.textContent = "Check now";
	switch (u.status) {
		case "off":
			dot.className = "dot neutral";
			text.textContent = "Updates are off when running from source.";
			btn.hidden = true;
			break;
		case "idle":
		case "checking":
			dot.className = "dot neutral";
			text.textContent = "Checking for updates…";
			btn.disabled = true;
			break;
		case "latest":
			dot.className = "dot ok";
			text.textContent = "You're on the latest version.";
			break;
		case "downloading":
			dot.className = "dot warn";
			text.textContent = `Downloading version ${u.newVersion}… ${u.percent || 0}%`;
			btn.disabled = true;
			break;
		case "ready":
			dot.className = "dot ok";
			text.textContent = `Version ${u.newVersion} is ready. It installs the next time Mercify closes.`;
			btn.textContent = "Restart and update";
			btn.dataset.install = "1";
			$("#update-banner-text").textContent = `Mercify ${u.newVersion} is ready to install`;
			$("#update-banner-btn").textContent = "Restart and update";
			banner.hidden = false;
			break;
		case "available":
			dot.className = "dot warn";
			text.textContent = `Version ${u.newVersion} is available. This portable copy can't update itself, so download the new one and replace this file.`;
			btn.textContent = "Download";
			btn.dataset.install = "1";
			$("#update-banner-text").textContent = `Mercify ${u.newVersion} is available`;
			$("#update-banner-btn").textContent = "Download";
			banner.hidden = false;
			break;
		case "error":
			dot.className = "dot";
			text.textContent = `Couldn't check for updates: ${u.error}`;
			break;
	}
	if (u.status !== "ready" && u.status !== "available") delete btn.dataset.install;
}

function renderLobby(l) {
	if (!l) return;
	const nameEl = $("#lobby-name");
	if (document.activeElement !== nameEl) nameEl.value = l.name || "";
	const status = $("#lobby-status");
	if (l.status === "joined") {
		const who = l.role === "host" ? "hosting" : `with ${l.hostName || "the host"}`;
		status.textContent = `In ${l.displayCode}, ${who} · ${l.members.length} here`;
	} else if (l.status === "connecting") status.textContent = `Joining ${l.displayCode}…`;
	else status.textContent = "Not in a lobby";
	$("#lobby-leave").hidden = l.status !== "joined" && l.status !== "connecting";
}

function render(d) {
	current = d;
	renderUpdate(d.update);
	renderLobby(d.lobby);
	const s = d.setup;

	$("#conn").textContent = d.connected ? "Connected to Spotify" : "Waiting for Spotify";
	$("#conn").classList.toggle("ok", d.connected);

	connectNote = d.connectNote || "";
	renderSetup(s, d.setupRun, d.connected);

	const only = d.onlyShowOver;
	$("#only-enabled").checked = only.enabled;
	$("#only-enabled").disabled = !d.foregroundSupported;
	if (!d.foregroundSupported) $("#only-hint").textContent = "Only available on Windows.";
	const chips = $("#apps");
	chips.classList.toggle("off", !only.enabled);
	chips.innerHTML = "";
	const add = (value, kind) => {
		const c = document.createElement("span");
		c.className = "chip";
		c.innerHTML = `${esc(value)} <span class="kind">${kind}</span><button title="Remove">×</button>`;
		c.querySelector("button").addEventListener("click", async () => render(await S.removeApp(value)));
		chips.append(c);
	};
	only.apps.forEach((a) => add(a, "program"));
	only.titles.forEach((t) => add(t, "window title"));
	if (!only.apps.length && !only.titles.length) chips.innerHTML = '<span class="muted">No apps yet: the overlay will stay hidden.</span>';

	if (d.gateText != null) showGate(only.enabled ? d.gateText : "");
	$("#other-monitor").checked = only.stayOnOtherMonitor !== false;
	$("#other-monitor").disabled = !only.enabled;
	$("#hotkeys-only").checked = d.hotkeysOnlyOverApps;
	$("#start-windows").checked = d.startWithWindows;
	$("#launch-spotify").checked = d.launchSpotify;
	$("#minimise-spotify").checked = d.minimiseSpotify;

	const names = { toggle: "Show / hide", edit: "Edit Mode", search: "Search", playPause: "Play / pause", next: "Next track", prev: "Previous" };
	$("#hotkeys").innerHTML = Object.entries(d.hotkeys)
		.filter(([, v]) => v)
		.map(([k, v]) => `<kbd>${esc(v.replace("Control", "Ctrl"))}</kbd><span>${esc(names[k] || k)}</span>`)
		.join("");
}

// the full log isn't shown any more (the progress bar says what's happening); "Copy details"
// in a failure copies it from the main process
function log() {}

document.querySelectorAll("#setup-section .row button[data-act]").forEach((b) => b.addEventListener("click", () => runSetupAction(b.dataset.act)));
$("#setup-all").addEventListener("click", () => runSetupAction("setupAll"));
row("connect").querySelector("button").addEventListener("click", async () => render(await S.action("openSpotify")));
$("#setup-retry").addEventListener("click", () => runSetupAction("setupAll"));
$("#setup-copy").addEventListener("click", async () => {
	await S.action("copySetupDetails");
	$("#setup-copy").textContent = "Copied. Paste it in a message";
	setTimeout(() => ($("#setup-copy").textContent = "Copy details"), 4000);
});
S.onSetupProgress(onSetupProgress);
$("#remove-addons").addEventListener("click", async () => {
	if (setupRunning) return;
	const sure = confirm("Remove Spicetify and SpotX from Spotify?\n\nSpotify stays installed and goes back to normal. Mercify won't work with Spotify again until you run setup again.");
	if (sure) await runSetupAction("removeAddons");
});

$("#only-enabled").addEventListener("change", async (e) => render(await S.set("onlyShowOver.enabled", e.target.checked)));
$("#other-monitor").addEventListener("change", async (e) => render(await S.set("onlyShowOver.stayOnOtherMonitor", e.target.checked)));
$("#hotkeys-only").addEventListener("change", async (e) => render(await S.set("hotkeysOnlyOverApps", e.target.checked)));
$("#start-windows").addEventListener("change", async (e) => render(await S.set("startWithWindows", e.target.checked)));
$("#launch-spotify").addEventListener("change", async (e) => render(await S.set("launchSpotify", e.target.checked)));
$("#minimise-spotify").addEventListener("change", async (e) => render(await S.set("minimiseSpotify", e.target.checked)));
$("#open-config").addEventListener("click", () => S.openConfig());

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
	for (let i = 5; i > 0; i--) {
		b.textContent = `Click into your game… ${i}`;
		await new Promise((r) => setTimeout(r, 1000));
	}
	const res = await S.pickApp();
	b.disabled = false;
	b.textContent = "Pick the app in front";
	if (res.message) log(res.message);
	render(res.state);
});

$("#update-check").addEventListener("click", async (e) => {
	const install = !!e.currentTarget.dataset.install;
	render(await S.action(install ? "installUpdate" : "checkUpdate"));
});
$("#update-banner-btn").addEventListener("click", async () => render(await S.action("installUpdate")));

const saveLobbyName = async () => {
	const v = $("#lobby-name").value.trim();
	if (v !== (current?.lobby?.name || "")) render(await S.set("lobbyName", v));
};
$("#lobby-name").addEventListener("change", saveLobbyName);
$("#lobby-name").addEventListener("keydown", (e) => e.key === "Enter" && e.target.blur());
$("#lobby-leave").addEventListener("click", async () => render(await S.action("leaveLobby")));

S.onLog(log);
S.onChanged(render);
function showGate(t) {
	$("#gate-now").hidden = !t;
	$("#gate-now").textContent = t || "";
}
S.onGate(showGate);
S.get().then(render);
