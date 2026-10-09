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
	if (button === null) b.hidden = true;
	else {
		b.hidden = false;
		if (button) b.textContent = button;
	}
}

function render(d) {
	current = d;
	const s = d.setup;

	$("#conn").textContent = d.connected ? "Connected to Spotify" : "Waiting for Spotify";
	$("#conn").classList.toggle("ok", d.connected);

	if (!s.supported) {
		$("#setup-section").hidden = true;
	} else {
		if (s.spotify) setRow("spotify", "ok", s.spotifyRunning ? "Installed and running" : "Installed", null);
		else if (s.storeSpotify) setRow("spotify", "warn", "The Microsoft Store version can't be modded. SpotX replaces it with the desktop version.", "Install with SpotX");
		else setRow("spotify", "", "Not installed. SpotX installs it for you.", "Install with SpotX");

		if (s.spicetify) setRow("spicetify", "ok", "Installed", null);
		else setRow("spicetify", "", "Not installed. It will ask about Marketplace: either answer is fine.", "Install Spicetify");

		const ext = row("extension").querySelector("button");
		if (s.extension === "current") setRow("extension", "ok", `Installed (v${s.appliedVersion ?? "?"})`, "Reinstall");
		else if (s.extension === "outdated") setRow("extension", "warn", `Update available: v${s.appliedVersion ?? "?"} → v${s.bundledVersion}`, "Update");
		else setRow("extension", "", "Not installed. Installing restarts Spotify.", "Install");
		ext.disabled = busy || !s.spicetify || !s.spotify;
		ext.classList.toggle("ghost", s.extension === "current");
	}

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

	$("#hotkeys-only").checked = d.hotkeysOnlyOverApps;
	$("#start-windows").checked = d.startWithWindows;
	$("#launch-spotify").checked = d.launchSpotify;

	const names = { toggle: "Show / hide", edit: "Edit Mode", search: "Search", playPause: "Play / pause", next: "Next track", prev: "Previous track" };
	$("#hotkeys").innerHTML = Object.entries(d.hotkeys)
		.filter(([, v]) => v)
		.map(([k, v]) => `<kbd>${esc(v.replace("Control", "Ctrl"))}</kbd><span>${esc(names[k] || k)}</span>`)
		.join("");
}

function log(line) {
	const el = $("#log");
	el.hidden = false;
	el.textContent += line + "\n";
	el.scrollTop = el.scrollHeight;
}

async function act(name, button) {
	if (busy) return;
	busy = true;
	document.querySelectorAll(".row button").forEach((b) => (b.disabled = true));
	if (button) button.dataset.label = button.textContent;
	if (button) button.textContent = "Working…";
	try {
		render(await S.action(name));
	} finally {
		busy = false;
		document.querySelectorAll(".row button").forEach((b) => (b.disabled = false));
		if (button) button.textContent = button.dataset.label;
		render(await S.get());
	}
}

document.querySelectorAll(".row button").forEach((b) => b.addEventListener("click", () => act(b.dataset.act, b)));

$("#only-enabled").addEventListener("change", async (e) => render(await S.set("onlyShowOver.enabled", e.target.checked)));
$("#hotkeys-only").addEventListener("change", async (e) => render(await S.set("hotkeysOnlyOverApps", e.target.checked)));
$("#start-windows").addEventListener("change", async (e) => render(await S.set("startWithWindows", e.target.checked)));
$("#launch-spotify").addEventListener("change", async (e) => render(await S.set("launchSpotify", e.target.checked)));
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
		b.textContent = `Switch to the game now… ${i}`;
		await new Promise((r) => setTimeout(r, 1000));
	}
	const res = await S.pickApp();
	b.disabled = false;
	b.textContent = "Pick the app in front";
	if (res.message) log(res.message);
	render(res.state);
});

S.onLog(log);
S.onChanged(render);
S.get().then(render);
