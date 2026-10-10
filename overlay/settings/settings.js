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
S.get().then(render);
