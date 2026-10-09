// Mercify: renderer
// Panels, Edit Mode (drag / resize / snap / per-panel settings), and the Spotify views.
"use strict";

const api = window.overlay;
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (html != null) e.innerHTML = html;
	return e;
};
const esc = (s) =>
	String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (ms) => {
	const s = Math.max(0, Math.floor((ms || 0) / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ------------------------------------------------------------------ icons

const I = (d, vb = "0 0 16 16") => `<svg viewBox="${vb}" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
	play: I("M4.5 2.6v10.8a.6.6 0 0 0 .9.5l8.6-5.4a.6.6 0 0 0 0-1L5.4 2.1a.6.6 0 0 0-.9.5z"),
	pause: I("M4 2.5h2.6v11H4zM9.4 2.5H12v11H9.4z"),
	next: I("M3 2.8v10.4a.5.5 0 0 0 .8.4l7-5.2a.5.5 0 0 0 0-.8l-7-5.2a.5.5 0 0 0-.8.4zM11.6 2.5h1.6v11h-1.6z"),
	prev: I("M13 2.8v10.4a.5.5 0 0 1-.8.4l-7-5.2a.5.5 0 0 1 0-.8l7-5.2a.5.5 0 0 1 .8.4zM2.8 2.5h1.6v11H2.8z"),
	shuffle: I(
		"M11.5 2.2 14 4.6l-2.5 2.4V5.4h-1.1c-.9 0-1.5.4-2 1.1L5.7 10.4c-.7 1-1.6 1.6-2.9 1.6H1.6v-1.4h1.2c.8 0 1.2-.3 1.7-1l2.7-3.9c.7-1 1.7-1.7 3.1-1.7h1.2V2.2zM1.6 4h1.2c1.3 0 2.2.6 2.9 1.6l.3.4-.9 1.2-.6-.8c-.5-.7-.9-1-1.7-1H1.6V4zm7 5.4.9-1.2.9 1.3c.5.7 1.1 1.1 2 1.1h-.9 1.1V9l2.5 2.4-2.5 2.4v-1.6h-1.1c-1.4 0-2.4-.7-3.1-1.7l-.3-.4z"
	),
	repeat: I(
		"M4 3.5h7.2a3 3 0 0 1 3 3v2h-1.5v-2a1.5 1.5 0 0 0-1.5-1.5H4V7L1 4.3 4 1.6v1.9zM12 12.5H4.8a3 3 0 0 1-3-3v-2h1.5v2A1.5 1.5 0 0 0 4.8 11H12V9l3 2.7-3 2.7v-1.9z"
	),
	repeatOne: I(
		"M4 3.5h4.5V5H4V7L1 4.3 4 1.6v1.9zM12 12.5H4.8a3 3 0 0 1-3-3v-2h1.5v2A1.5 1.5 0 0 0 4.8 11H12V9l3 2.7-3 2.7v-1.9zM11.6 1.5h1.2v6h-1.4V3.3l-1.1.4V2.5z"
	),
	heart: I(
		"M8 14.2 2.3 8.6A3.6 3.6 0 0 1 7.4 3.4l.6.6.6-.6a3.6 3.6 0 0 1 5.1 5.2zM4.8 3.8a2.1 2.1 0 0 0-1.5 3.7L8 12.1l4.7-4.6a2.1 2.1 0 0 0-3-3l-1.7 1.7-1.7-1.7a2.1 2.1 0 0 0-1.5-.7z"
	),
	heartFull: I("M8 14.2 2.3 8.6A3.6 3.6 0 0 1 7.4 3.4l.6.6.6-.6a3.6 3.6 0 0 1 5.1 5.2z"),
	volume: I("M2 5.7h2.7L8.5 2.5v11L4.7 10.3H2zM10.6 4.6a4.6 4.6 0 0 1 0 6.8l-1-1a3.2 3.2 0 0 0 0-4.8zM12.5 2.7a7.2 7.2 0 0 1 0 10.6l-1-1a5.8 5.8 0 0 0 0-8.6z"),
	mute: I("M2 5.7h2.7L8.5 2.5v11L4.7 10.3H2zM10.3 5.5l1.6 1.6 1.6-1.6 1 1-1.6 1.6 1.6 1.6-1 1-1.6-1.6-1.6 1.6-1-1 1.6-1.6-1.6-1.6z"),
	search: I("M7 1.5a5.5 5.5 0 0 1 4.4 8.8l3.2 3.2-1.1 1.1-3.2-3.2A5.5 5.5 0 1 1 7 1.5zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"),
	plus: I("M7.25 2h1.5v5.25H14v1.5H8.75V14h-1.5V8.75H2v-1.5h5.25z"),
	chevron: I("M3.5 5.5 8 10l4.5-4.5 1 1L8 12 2.5 6.5z"),
	close: I("M3.6 2.5 8 6.9l4.4-4.4 1.1 1.1L9.1 8l4.4 4.4-1.1 1.1L8 9.1l-4.4 4.4-1.1-1.1L6.9 8 2.5 3.6z"),
	note: I("M6 2.5 14 1v9.3a2.2 2.2 0 1 1-1.5-2.1V3.5L7.5 4.4v7.8A2.2 2.2 0 1 1 6 10.1z"),
	bars: I("M2.5 13V8h2v5zM7 13V3h2v10zM11.5 13V6h2v7z"),
};

// ------------------------------------------------------------------ app state

const S = {
	connected: false,
	edit: false,
	shown: true,
	player: null, // last state from the bridge
	playlists: [],
	playlist: null, // {uri, contextUri, name, image, tracks}
	query: "",
	results: null,
	layout: null,
	selected: null,
};

// ------------------------------------------------------------------ panel registry + default layout

const PANELS = {
	nowplaying: {
		title: "Now Playing",
		min: [200, 56],
		def: (W, H) => ({ x: 24, y: H - 24 - 112, w: 460, h: 112, shownAlpha: 1, hiddenAlpha: 0.75 }),
	},
	search: {
		title: "Search Bar",
		bare: true,
		min: [160, 34],
		def: (W, H) => ({ x: W - 24 - 380, y: 24, w: 380, h: 46, shownAlpha: 1, hiddenAlpha: 0 }),
	},
	results: {
		title: "Search Results",
		min: [200, 120],
		def: (W, H) => ({ x: W - 24 - 380, y: 82, w: 380, h: Math.min(520, H - 140), shownAlpha: 1, hiddenAlpha: 0, autoHide: true }),
	},
	playlist: {
		title: "Playlist",
		min: [200, 140],
		def: (W, H) => ({ x: 24, y: 24, w: 380, h: Math.min(560, H - 24 - 112 - 48), shownAlpha: 1, hiddenAlpha: 0 }),
	},
};

function defaultPanel(id) {
	return { enabled: true, scale: 1, ...PANELS[id].def(innerWidth, innerHeight) };
}

function defaultLayout() {
	const panels = {};
	for (const id of Object.keys(PANELS)) panels[id] = defaultPanel(id);
	return { version: 1, snap: true, lastPlaylist: null, panels };
}

let saveTimer = null;
function saveLayout() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => api.saveLayout(S.layout), 300);
}

// ------------------------------------------------------------------ panel DOM

const panelEls = {};

function buildPanel(id) {
	const def = PANELS[id];
	const p = el("section", "panel" + (def.bare ? " bare" : ""));
	p.dataset.id = id;
	const body = el("div", "panel-body");
	p.append(body);
	const mask = el("div", "edit-mask");
	mask.append(el("span", "edit-label", esc(def.title)));
	p.append(mask, el("div", "rh rh-r"), el("div", "rh rh-b"), el("div", "rh rh-br"));
	p.querySelector(".rh-r").dataset.edge = "r";
	p.querySelector(".rh-b").dataset.edge = "b";
	p.querySelector(".rh-br").dataset.edge = "rb";
	$("#panels").append(p);
	panelEls[id] = p;
	return body;
}

function applyPanel(id) {
	const c = S.layout.panels[id];
	const p = panelEls[id];
	p.style.left = c.x + "px";
	p.style.top = c.y + "px";
	p.style.width = c.w + "px";
	p.style.height = c.h + "px";
	p.style.setProperty("--scale", c.scale ?? 1);

	let visible = c.enabled;
	if (id === "results" && c.autoHide && !S.edit && !S.query) visible = false;
	p.classList.toggle("off", !visible);

	let alpha;
	if (S.edit) alpha = Math.max(c.shownAlpha, 0.6);
	else alpha = S.shown ? c.shownAlpha : c.hiddenAlpha;
	p.style.opacity = alpha;
	p.style.visibility = alpha <= 0.001 && !S.edit ? "hidden" : "";

	const label = p.querySelector(".edit-label");
	label.innerHTML = esc(PANELS[id].title) + (c.enabled ? "" : '<span class="muted">hidden</span>');
}

function applyAll() {
	document.body.classList.toggle("edit", S.edit);
	document.body.classList.toggle("hidden", !S.shown && !S.edit);
	document.body.classList.toggle("snap", !!S.layout.snap);
	for (const id of Object.keys(PANELS)) applyPanel(id);
}

// Keep panels on-screen after a resolution change or a layout from another monitor.
function clampPanel(c, id) {
	const [mw, mh] = PANELS[id].min;
	c.w = clamp(c.w, mw, innerWidth);
	c.h = clamp(c.h, mh, innerHeight);
	c.x = clamp(c.x, 0, innerWidth - c.w);
	c.y = clamp(c.y, 0, innerHeight - c.h);
}

// ------------------------------------------------------------------ click-through

let interactiveNow = false;
function setInteractive(on) {
	if (on === interactiveNow) return;
	interactiveNow = on;
	api.setInteractive(on);
}

document.addEventListener("mousemove", (e) => {
	if (S.edit) return;
	if (!S.shown) return setInteractive(false);
	const over = e.target.closest?.(".panel:not(.off)");
	setInteractive(!!over && over.style.visibility !== "hidden");
});
document.addEventListener("mouseleave", () => {
	if (!S.edit) setInteractive(false);
});

// ------------------------------------------------------------------ Edit Mode: select, drag, resize, snap

const SNAP_DIST = 10;
const GRID = 16;

function select(id) {
	S.selected = id;
	for (const [pid, p] of Object.entries(panelEls)) p.classList.toggle("selected", pid === id);
	showPopover();
}

function snapAxis(value, size, targets, gridOn) {
	// Try to align either edge (or centre) of the moving box to a target line.
	let best = null;
	for (const t of targets) {
		for (const [offset, kind] of [
			[0, "start"],
			[size, "end"],
			[size / 2, "mid"],
		]) {
			const d = Math.abs(value + offset - t);
			if (d <= SNAP_DIST && (!best || d < best.d)) best = { d, v: t - offset, line: t, kind };
		}
	}
	if (best) return { v: best.v, line: best.line };
	if (gridOn) return { v: Math.round(value / GRID) * GRID, line: null };
	return { v: value, line: null };
}

function snapTargets(exceptId) {
	const xs = [0, innerWidth, innerWidth / 2];
	const ys = [0, innerHeight, innerHeight / 2];
	for (const [id, c] of Object.entries(S.layout.panels)) {
		if (id === exceptId || !c.enabled) continue;
		xs.push(c.x, c.x + c.w);
		ys.push(c.y, c.y + c.h);
	}
	return { xs, ys };
}

function drawGuides(lines) {
	const g = $("#guides");
	g.innerHTML = "";
	for (const x of lines.xs || []) {
		const d = el("div", "guide v");
		d.style.left = Math.round(x) + "px";
		g.append(d);
	}
	for (const y of lines.ys || []) {
		const d = el("div", "guide h");
		d.style.top = Math.round(y) + "px";
		g.append(d);
	}
}

let drag = null;

document.addEventListener("pointerdown", (e) => {
	if (!S.edit || e.button !== 0) return;
	if (e.target.closest("#settings-pop, #edit-bar")) return;
	const panel = e.target.closest(".panel");
	if (!panel) {
		select(null);
		return;
	}
	const id = panel.dataset.id;
	select(id);
	const c = S.layout.panels[id];
	drag = {
		id,
		edge: e.target.dataset.edge || null,
		sx: e.clientX,
		sy: e.clientY,
		start: { ...c },
		pointerId: e.pointerId,
	};
	panel.setPointerCapture(e.pointerId);
	e.preventDefault();
});

document.addEventListener("pointermove", (e) => {
	if (!drag) return;
	const c = S.layout.panels[drag.id];
	const dx = e.clientX - drag.sx;
	const dy = e.clientY - drag.sy;
	const useSnap = S.layout.snap && !e.altKey;
	const t = useSnap ? snapTargets(drag.id) : { xs: [], ys: [] };
	const [mw, mh] = PANELS[drag.id].min;
	const lines = { xs: [], ys: [] };

	if (!drag.edge) {
		let x = clamp(drag.start.x + dx, 0, innerWidth - c.w);
		let y = clamp(drag.start.y + dy, 0, innerHeight - c.h);
		if (useSnap) {
			const sx = snapAxis(x, c.w, t.xs, true);
			const sy = snapAxis(y, c.h, t.ys, true);
			x = sx.v;
			y = sy.v;
			if (sx.line != null) lines.xs.push(sx.line);
			if (sy.line != null) lines.ys.push(sy.line);
		}
		c.x = clamp(x, 0, innerWidth - c.w);
		c.y = clamp(y, 0, innerHeight - c.h);
	} else {
		if (drag.edge.includes("r")) {
			let right = drag.start.x + drag.start.w + dx;
			if (useSnap) {
				const s = snapAxis(right, 0, t.xs, true);
				right = s.v;
				if (s.line != null) lines.xs.push(s.line);
			}
			c.w = clamp(right - c.x, mw, innerWidth - c.x);
		}
		if (drag.edge.includes("b")) {
			let bottom = drag.start.y + drag.start.h + dy;
			if (useSnap) {
				const s = snapAxis(bottom, 0, t.ys, true);
				bottom = s.v;
				if (s.line != null) lines.ys.push(s.line);
			}
			c.h = clamp(bottom - c.y, mh, innerHeight - c.y);
		}
	}
	drawGuides(lines);
	applyPanel(drag.id);
	positionPopover();
});

document.addEventListener("pointerup", () => {
	if (!drag) return;
	drag = null;
	drawGuides({});
	saveLayout();
});

document.addEventListener("keydown", (e) => {
	if (!S.edit) return;
	if (e.key === "Escape") return api.setEdit(false);
	if (!S.selected || e.target.matches("input[type=text], input[type=search]")) return;
	const step = e.shiftKey ? 10 : 1;
	const c = S.layout.panels[S.selected];
	const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
	const m = moves[e.key];
	if (!m) return;
	e.preventDefault();
	c.x = clamp(c.x + m[0], 0, innerWidth - c.w);
	c.y = clamp(c.y + m[1], 0, innerHeight - c.h);
	applyPanel(S.selected);
	positionPopover();
	saveLayout();
});

// ------------------------------------------------------------------ settings popover

const pop = $("#settings-pop");

function showPopover() {
	if (!S.edit || !S.selected) {
		pop.hidden = true;
		return;
	}
	const id = S.selected;
	const c = S.layout.panels[id];
	$("#pop-title").textContent = PANELS[id].title;
	$("#pop-enabled").checked = c.enabled;
	$("#pop-shown").value = Math.round(c.shownAlpha * 100);
	$("#pop-hidden").value = Math.round(c.hiddenAlpha * 100);
	$("#pop-scale").value = Math.round((c.scale ?? 1) * 100);
	$("#pop-autohide-row").hidden = id !== "results";
	$("#pop-autohide").checked = !!c.autoHide;
	updatePopOutputs();
	pop.hidden = false;
	positionPopover();
}

function updatePopOutputs() {
	$("#pop-shown-v").textContent = $("#pop-shown").value + "%";
	$("#pop-hidden-v").textContent = $("#pop-hidden").value + "%";
	$("#pop-scale-v").textContent = $("#pop-scale").value + "%";
}

function positionPopover() {
	if (pop.hidden || !S.selected) return;
	const c = S.layout.panels[S.selected];
	const pw = pop.offsetWidth;
	const ph = pop.offsetHeight;
	let x = c.x + c.w + 12;
	if (x + pw > innerWidth - 8) x = c.x - pw - 12;
	if (x < 8) x = clamp(c.x + 12, 8, innerWidth - pw - 8);
	const y = clamp(c.y, 70, innerHeight - ph - 8);
	pop.style.left = x + "px";
	pop.style.top = y + "px";
}

function bindPopover() {
	const upd = (fn) => () => {
		if (!S.selected) return;
		fn(S.layout.panels[S.selected]);
		updatePopOutputs();
		applyPanel(S.selected);
		saveLayout();
	};
	$("#pop-enabled").addEventListener("change", upd((c) => (c.enabled = $("#pop-enabled").checked)));
	$("#pop-shown").addEventListener("input", upd((c) => (c.shownAlpha = $("#pop-shown").value / 100)));
	$("#pop-hidden").addEventListener("input", upd((c) => (c.hiddenAlpha = $("#pop-hidden").value / 100)));
	$("#pop-scale").addEventListener("input", upd((c) => (c.scale = $("#pop-scale").value / 100)));
	$("#pop-autohide").addEventListener("change", upd((c) => (c.autoHide = $("#pop-autohide").checked)));
	$("#pop-reset").addEventListener("click", () => {
		if (!S.selected) return;
		S.layout.panels[S.selected] = defaultPanel(S.selected);
		applyPanel(S.selected);
		showPopover();
		saveLayout();
	});

	$("#snap-toggle").addEventListener("change", () => {
		S.layout.snap = $("#snap-toggle").checked;
		applyAll();
		saveLayout();
	});
	$("#reset-all").addEventListener("click", resetLayout);
	$("#edit-done").addEventListener("click", () => api.setEdit(false));
}

function resetLayout() {
	const last = S.layout?.lastPlaylist ?? null;
	S.layout = defaultLayout();
	S.layout.lastPlaylist = last;
	$("#snap-toggle").checked = true;
	applyAll();
	showPopover();
	saveLayout();
	toast("Layout reset");
}

// ------------------------------------------------------------------ toast

let toastTimer = null;
function toast(html, kind = "", ms = 2600) {
	const t = $("#toast");
	t.innerHTML = html;
	t.className = "show " + kind;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (t.className = kind), ms);
}

// ------------------------------------------------------------------ Spotify commands

async function cmd(action, args) {
	const r = await api.cmd(action, args);
	if (!r.ok) {
		if (action !== "state") toast(esc(r.error), "error");
		throw new Error(r.error);
	}
	return r.data;
}
const fire = (action, args) => cmd(action, args).catch(() => {});

// ------------------------------------------------------------------ Now Playing panel

const np = {};

function buildNowPlaying() {
	const body = buildPanel("nowplaying");
	body.innerHTML = `
		<div class="np">
			<img class="np-art" src="" alt="" />
			<div class="np-main">
				<div class="np-title">Waiting for Spotify…</div>
				<div class="np-artist">Open Spotify with the Overlay Bridge extension</div>
				<div class="np-progress">
					<span class="t-cur">0:00</span>
					<div class="bar"><div class="bar-track"><div class="bar-fill"></div></div></div>
					<span class="t-dur">0:00</span>
				</div>
				<div class="np-controls">
					<button class="icon-btn" data-act="toggleShuffle" title="Shuffle">${ICON.shuffle}</button>
					<button class="icon-btn" data-act="prev" title="Previous">${ICON.prev}</button>
					<button class="icon-btn big" data-act="togglePlay" title="Play / pause">${ICON.play}</button>
					<button class="icon-btn" data-act="next" title="Next">${ICON.next}</button>
					<button class="icon-btn" data-act="toggleRepeat" title="Repeat">${ICON.repeat}</button>
					<button class="icon-btn" data-act="toggleLike" title="Save to Liked Songs">${ICON.heart}</button>
					<span class="spacer"></span>
					<div class="vol">
						<button class="icon-btn" data-act="mute" title="Mute">${ICON.volume}</button>
						<input type="range" min="0" max="100" step="1" value="100" />
					</div>
				</div>
			</div>
		</div>`;
	Object.assign(np, {
		art: $(".np-art", body),
		title: $(".np-title", body),
		artist: $(".np-artist", body),
		cur: $(".t-cur", body),
		dur: $(".t-dur", body),
		bar: $(".bar", body),
		fill: $(".bar-fill", body),
		play: $('[data-act="togglePlay"]', body),
		shuffle: $('[data-act="toggleShuffle"]', body),
		repeat: $('[data-act="toggleRepeat"]', body),
		like: $('[data-act="toggleLike"]', body),
		mute: $('[data-act="mute"]', body),
		vol: $(".vol input", body),
	});

	body.addEventListener("click", (e) => {
		const b = e.target.closest("[data-act]");
		if (!b || S.edit) return;
		const act = b.dataset.act;
		if (act === "mute") {
			const v = S.player?.volume ?? 1;
			if (v > 0) np.lastVol = v;
			return fire("setVolume", { level: v > 0 ? 0 : np.lastVol || 0.5 });
		}
		// Optimistic UI for play/pause so it feels instant.
		if (act === "togglePlay" && S.player) {
			S.player.position = currentPosition();
			S.player.at = Date.now();
			S.player.isPlaying = !S.player.isPlaying;
			renderPlayer();
		}
		fire(act);
	});

	np.bar.addEventListener("click", (e) => {
		if (S.edit || !S.player?.duration) return;
		const r = np.bar.getBoundingClientRect();
		const ms = ((e.clientX - r.left) / r.width) * S.player.duration;
		S.player.position = ms;
		S.player.at = Date.now();
		fire("seek", { ms: Math.round(ms) });
	});

	let volTimer = null;
	np.vol.addEventListener("input", () => {
		const level = np.vol.value / 100;
		if (S.player) S.player.volume = level;
		np.volDragging = true;
		clearTimeout(volTimer);
		volTimer = setTimeout(() => {
			fire("setVolume", { level });
			np.volDragging = false;
		}, 60);
	});
}

function currentPosition() {
	const p = S.player;
	if (!p) return 0;
	const base = p.position || 0;
	return p.isPlaying ? Math.min(p.duration || Infinity, base + (Date.now() - (p.at || Date.now()))) : base;
}

function renderPlayer() {
	const p = S.player;
	if (!S.connected) {
		np.title.textContent = "Waiting for Spotify…";
		np.artist.textContent = "Open Spotify with the Overlay Bridge extension";
		np.art.src = "";
		np.play.innerHTML = ICON.play;
		return;
	}
	if (!p || p.empty) {
		np.title.textContent = "Nothing playing";
		np.artist.textContent = "Pick something from a playlist or search";
		np.art.src = "";
		return;
	}
	np.title.textContent = p.name;
	np.title.title = p.name;
	np.artist.textContent = (p.artists || []).join(", ");
	if (np.art.dataset.src !== (p.image || "")) {
		np.art.dataset.src = p.image || "";
		np.art.src = p.image || "";
	}
	np.play.innerHTML = p.isPlaying ? ICON.pause : ICON.play;
	np.shuffle.classList.toggle("on", !!p.shuffle);
	np.repeat.classList.toggle("on", p.repeat > 0);
	np.repeat.innerHTML = p.repeat === 2 ? ICON.repeatOne : ICON.repeat;
	np.like.classList.toggle("on", !!p.liked);
	np.like.innerHTML = p.liked ? ICON.heartFull : ICON.heart;
	np.mute.innerHTML = p.volume > 0 ? ICON.volume : ICON.mute;
	if (!np.volDragging) np.vol.value = Math.round((p.volume ?? 1) * 100);
	np.dur.textContent = fmt(p.duration);
	markPlayingRows();
}

function tick() {
	if (S.player && !S.player.empty && S.connected) {
		const pos = currentPosition();
		np.cur.textContent = fmt(pos);
		np.fill.style.width = (S.player.duration ? (pos / S.player.duration) * 100 : 0) + "%";
	}
	requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ track rows (shared by results + playlist)

function trackRow(t, { index = null, contextUri = null, showIndex = false } = {}) {
	const r = el("div", "row" + (t.playable === false ? " unplayable" : ""));
	r.dataset.uri = t.uri;
	r.innerHTML = `
		${showIndex ? `<span class="row-idx">${index + 1}</span>` : ""}
		<img src="${esc(t.image || "")}" alt="" loading="lazy" />
		<div class="row-text">
			<div class="row-title">${esc(t.name)}</div>
			<div class="row-sub">${esc((t.artists || []).join(", "))}</div>
		</div>
		<button class="icon-btn" title="Add to queue">${ICON.plus}</button>
		<span class="row-dur">${t.duration ? fmt(t.duration) : ""}</span>`;
	r.addEventListener("click", (e) => {
		if (S.edit) return;
		if (e.target.closest(".icon-btn")) {
			cmd("addToQueue", { uri: t.uri })
				.then(() => toast(`Queued <b>${esc(t.name)}</b>`))
				.catch(() => {});
			return;
		}
		fire("playTrack", { uri: t.uri, contextUri, uid: t.uid ?? null, index });
	});
	if (S.player?.uri === t.uri) r.classList.add("playing");
	return r;
}

// Render long lists in chunks so a 3,000-song playlist doesn't freeze the overlay.
function renderTracks(container, tracks, opts) {
	const CHUNK = 150;
	let i = 0;
	const sentinel = el("div");
	sentinel.style.height = "1px";
	const io = new IntersectionObserver((entries) => {
		if (entries.some((e) => e.isIntersecting)) more();
	}, { root: container.closest(".scroll") });
	function more() {
		const frag = document.createDocumentFragment();
		const end = Math.min(tracks.length, i + CHUNK);
		for (; i < end; i++) frag.append(trackRow(tracks[i], { ...opts, index: tracks[i].index ?? i }));
		sentinel.before(frag);
		if (i >= tracks.length) {
			io.disconnect();
			sentinel.remove();
		}
	}
	container.append(sentinel);
	more();
	io.observe(sentinel);
	return () => io.disconnect();
}

function markPlayingRows() {
	const uri = S.player?.uri;
	document.querySelectorAll(".row.playing").forEach((r) => r.dataset.uri !== uri && r.classList.remove("playing"));
	if (!uri) return;
	document.querySelectorAll(`.row[data-uri="${CSS.escape(uri)}"]`).forEach((r) => r.classList.add("playing"));
}

// ------------------------------------------------------------------ Search bar + Results panels

const sr = {};

function buildSearch() {
	const body = buildPanel("search");
	body.innerHTML = `
		<div class="search">
			<svg class="lead" viewBox="0 0 16 16"><path d="${ICON.search.match(/d="([^"]+)"/)[1]}"/></svg>
			<input type="text" placeholder="Search songs, playlists, albums" spellcheck="false" />
			<span class="spinner" hidden></span>
			<button class="icon-btn" title="Clear" hidden>${ICON.close}</button>
		</div>`;
	sr.input = $("input", body);
	sr.spin = $(".spinner", body);
	sr.clear = $(".icon-btn", body);

	let t = null;
	sr.input.addEventListener("input", () => {
		clearTimeout(t);
		t = setTimeout(() => runSearch(sr.input.value), 280);
		sr.clear.hidden = !sr.input.value;
	});
	sr.input.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			if (sr.input.value) clearSearch();
			else api.releaseFocus();
			sr.input.blur();
			e.stopPropagation();
		} else if (e.key === "Enter") {
			const top = S.results?.tracks?.[0];
			if (top) {
				fire("playTrack", { uri: top.uri });
				api.releaseFocus();
				sr.input.blur();
			}
		}
	});
	sr.clear.addEventListener("click", () => {
		clearSearch();
		sr.input.focus();
	});

	const rbody = buildPanel("results");
	rbody.innerHTML = `
		<div class="list-head"><span class="title">Search results</span><span class="meta"></span></div>
		<div class="scroll"><div class="empty-note">Type in the search bar</div></div>`;
	sr.head = $(".list-head .title", rbody);
	sr.meta = $(".list-head .meta", rbody);
	sr.list = $(".scroll", rbody);
}

function clearSearch() {
	sr.input.value = "";
	sr.clear.hidden = true;
	S.query = "";
	S.results = null;
	sr.list.innerHTML = '<div class="empty-note">Type in the search bar</div>';
	sr.head.textContent = "Search results";
	sr.meta.textContent = "";
	applyPanel("results");
}

let searchSeq = 0;
async function runSearch(q) {
	q = q.trim();
	S.query = q;
	applyPanel("results");
	if (!q) return clearSearch();
	const seq = ++searchSeq;
	sr.spin.hidden = false;
	try {
		const res = await cmd("search", { query: q, limit: 20 });
		if (seq !== searchSeq) return;
		S.results = res;
		renderResults();
	} catch (e) {
		if (seq === searchSeq) sr.list.innerHTML = `<div class="empty-note">Search failed: ${esc(e.message)}</div>`;
	} finally {
		if (seq === searchSeq) sr.spin.hidden = true;
	}
}

function renderResults() {
	const r = S.results || {};
	sr.head.textContent = `Results for “${S.query}”`;
	sr.meta.textContent = r.tracks?.length ? `${r.tracks.length} songs` : "";
	sr.list.innerHTML = "";
	sr.list.scrollTop = 0;
	if (!r.tracks?.length && !r.playlists?.length && !r.albums?.length) {
		// Show what the bridge tried, so a broken search says why rather than just "No results".
		const tried = (r.tried || []).map((t) => `${esc(t.via)}: ${t.error ? esc(t.error) : t.results + " results"}`).join("<br>");
		sr.list.innerHTML = `<div class="empty-note">No results${tried ? `<div class="tried">${tried}</div>` : ""}</div>`;
		return;
	}
	if (r.tracks?.length) {
		sr.list.append(el("div", "section-label", "Songs"));
		for (const t of r.tracks) sr.list.append(trackRow(t));
	}
	if (r.playlists?.length) {
		sr.list.append(el("div", "section-label", "Playlists"));
		for (const p of r.playlists.slice(0, 8)) {
			const row = el(
				"div",
				"row",
				`<img src="${esc(p.image || "")}" alt="" loading="lazy" /><div class="row-text"><div class="row-title">${esc(p.name)}</div><div class="row-sub">${esc(p.owner ? "Playlist · " + p.owner : "Playlist")}</div></div>`
			);
			row.title = "Open in the Playlist panel";
			row.addEventListener("click", () => !S.edit && openPlaylist(p.uri, p));
			sr.list.append(row);
		}
	}
	if (r.albums?.length) {
		sr.list.append(el("div", "section-label", "Albums"));
		for (const a of r.albums.slice(0, 8)) {
			const row = el(
				"div",
				"row",
				`<img src="${esc(a.image || "")}" alt="" loading="lazy" /><div class="row-text"><div class="row-title">${esc(a.name)}</div><div class="row-sub">${esc(["Album", ...(a.artists || [])].join(" · "))}</div></div><span class="row-dur" title="Play album">${ICON.play.replace("<svg", '<svg style="width:12px;height:12px;fill:currentColor"')}</span>`
			);
			row.title = "Play album";
			row.addEventListener("click", () => !S.edit && fire("playContext", { uri: a.uri }));
			sr.list.append(row);
		}
	}
}

// ------------------------------------------------------------------ Playlist panel

const pl = {};

function buildPlaylist() {
	const body = buildPanel("playlist");
	body.style.position = "relative";
	body.innerHTML = `
		<div class="list-head">
			<button class="picker-btn" title="Choose playlist">
				<img src="" alt="" />
				<span class="title">Choose a playlist</span>
				${ICON.chevron}
			</button>
			<span class="meta"></span>
		</div>
		<div class="scroll"><div class="empty-note">Waiting for Spotify…</div></div>
		<div class="picker" hidden>
			<div class="list-head">
				<input type="text" placeholder="Filter playlists" spellcheck="false" />
				<button class="icon-btn" title="Close">${ICON.close}</button>
			</div>
			<div class="scroll"></div>
		</div>`;
	pl.btn = $(".picker-btn", body);
	pl.btnImg = $(".picker-btn img", body);
	pl.btnTitle = $(".picker-btn .title", body);
	pl.meta = $(".list-head > .meta", body);
	pl.list = $(":scope > .scroll", body);
	pl.picker = $(".picker", body);
	pl.filter = $(".picker input", body);
	pl.pickList = $(".picker .scroll", body);

	pl.btn.addEventListener("click", () => {
		if (S.edit) return;
		openPicker();
	});
	$(".picker .icon-btn", body).addEventListener("click", () => (pl.picker.hidden = true));
	pl.filter.addEventListener("input", renderPicker);
	pl.filter.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			pl.picker.hidden = true;
			e.stopPropagation();
		} else if (e.key === "Enter") {
			pl.pickList.querySelector(".row")?.click();
		}
	});
}

async function openPicker() {
	pl.picker.hidden = false;
	pl.filter.value = "";
	renderPicker();
	pl.filter.focus();
	if (S.connected) {
		try {
			S.playlists = await cmd("playlists");
			renderPicker();
		} catch (_) {}
	}
}

function renderPicker() {
	const q = pl.filter.value.trim().toLowerCase();
	pl.pickList.innerHTML = "";
	let folder;
	const items = S.playlists.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.folder || "").toLowerCase().includes(q));
	if (!items.length) {
		pl.pickList.innerHTML = `<div class="empty-note">${S.connected ? "No playlists" : "Waiting for Spotify…"}</div>`;
		return;
	}
	for (const p of items) {
		if (p.folder !== folder) {
			folder = p.folder;
			if (folder) pl.pickList.append(el("div", "folder-label", esc(folder)));
		}
		const art = p.liked ? `<span class="liked-art">${ICON.heartFull}</span>` : `<img src="${esc(p.image || "")}" alt="" loading="lazy" />`;
		const row = el("div", "row", `${art}<div class="row-text"><div class="row-title">${esc(p.name)}</div>${p.owner ? `<div class="row-sub">${esc(p.owner)}</div>` : ""}</div>`);
		if (S.playlist?.uri === p.uri) row.classList.add("playing");
		row.addEventListener("click", () => {
			pl.picker.hidden = true;
			openPlaylist(p.uri, p);
		});
		pl.pickList.append(row);
	}
}

let plSeq = 0;
let plStop = null;
async function openPlaylist(uri, hint) {
	const seq = ++plSeq;
	S.layout.lastPlaylist = uri;
	saveLayout();
	pl.btnTitle.textContent = hint?.name || "Loading…";
	setPickerArt(hint);
	pl.meta.textContent = "";
	plStop?.();
	pl.list.innerHTML = '<div class="empty-note"><span class="spinner" style="display:inline-block"></span></div>';
	try {
		const data = await cmd("playlistTracks", { uri });
		if (seq !== plSeq) return;
		S.playlist = data;
		pl.btnTitle.textContent = data.name || hint?.name || "Playlist";
		setPickerArt({ ...hint, image: data.image || hint?.image });
		pl.meta.textContent = `${data.tracks.length} songs`;
		pl.list.innerHTML = "";
		pl.list.scrollTop = 0;
		if (!data.tracks.length) pl.list.innerHTML = '<div class="empty-note">This playlist is empty</div>';
		else plStop = renderTracks(pl.list, data.tracks, { contextUri: data.contextUri, showIndex: true });
	} catch (e) {
		if (seq === plSeq) pl.list.innerHTML = `<div class="empty-note">Couldn't load playlist: ${esc(e.message)}</div>`;
	}
}

function setPickerArt(p) {
	if (p?.liked || p?.uri === "liked") {
		pl.btnImg.replaceWith(Object.assign(el("span", "liked-art", ICON.heartFull), { style: "width:28px;height:28px" }));
		pl.btnImg = $(".picker-btn .liked-art", panelEls.playlist);
	} else {
		if (!(pl.btnImg instanceof HTMLImageElement)) {
			const img = el("img");
			pl.btnImg.replaceWith(img);
			pl.btnImg = img;
		}
		pl.btnImg.src = p?.image || "";
	}
}

// ------------------------------------------------------------------ bridge events

async function onConnected() {
	try {
		S.player = await cmd("state");
		renderPlayer();
	} catch (_) {}
	try {
		S.playlists = await cmd("playlists");
	} catch (_) {
		S.playlists = [];
	}
	const want = S.layout.lastPlaylist;
	const hint = S.playlists.find((p) => p.uri === want) || S.playlists[0];
	if (hint) openPlaylist(hint.uri, hint);
	else pl.list.innerHTML = '<div class="empty-note">No playlists found</div>';
}

api.onBridgeStatus(({ connected }) => {
	const was = S.connected;
	S.connected = connected;
	if (connected && !was) onConnected();
	if (!connected) {
		renderPlayer();
		pl.list.innerHTML = '<div class="empty-note">Waiting for Spotify…</div>';
	}
});

api.onBridge((msg) => {
	if (msg.type === "state") {
		S.player = msg.state;
		renderPlayer();
	} else if (msg.type === "progress" && S.player) {
		S.player.position = msg.position;
		S.player.at = msg.at || Date.now();
	}
});

api.onOverlay(({ shown, edit }) => {
	const wasEdit = S.edit;
	S.shown = shown;
	S.edit = edit;
	if (edit) setInteractive(true);
	else if (wasEdit) {
		interactiveNow = true; // main already released mouse; resync on next move
		setInteractive(false);
		select(null);
	}
	if (!shown) {
		document.activeElement?.blur?.();
		pl.picker.hidden = true;
	}
	showPopover();
	applyAll();
});

api.onFocusSearch(() => {
	interactiveNow = true; // main made the window interactive for typing
	if (!S.layout.panels.search.enabled) return toast("The search bar is hidden. Turn it on in Edit Mode.");
	sr.input.focus();
	sr.input.select();
});

api.onResetLayout(resetLayout);
// The window was hidden and shown again (app switched); main is click-through again.
api.onInteractiveReset(() => (interactiveNow = false));
api.onToast(({ text, kind }) => toast(esc(text), kind || "", 5000));

window.addEventListener("resize", () => {
	if (!S.layout) return;
	for (const [id, c] of Object.entries(S.layout.panels)) clampPanel(c, id);
	applyAll();
});

// ------------------------------------------------------------------ boot

(async function boot() {
	const saved = await api.loadLayout();
	const base = defaultLayout();
	S.layout = saved && saved.version === 1 ? { ...base, ...saved, panels: { ...base.panels } } : base;
	if (saved?.panels) for (const id of Object.keys(PANELS)) if (saved.panels[id]) S.layout.panels[id] = { ...base.panels[id], ...saved.panels[id] };
	for (const [id, c] of Object.entries(S.layout.panels)) clampPanel(c, id);
	$("#snap-toggle").checked = !!S.layout.snap;

	buildNowPlaying();
	buildPlaylist();
	buildSearch();
	bindPopover();
	applyAll();
	renderPlayer();
	requestAnimationFrame(tick);

	const info = await api.getInfo();
	const k = (a) => (a ? `<kbd>${esc(a.replace("Control", "Ctrl"))}</kbd>` : "");
	if (info.failedHotkeys?.length) {
		toast(`Couldn't register hotkeys: ${esc(info.failedHotkeys.join(", "))}. Another app may be using them; change them in the settings file.`, "error", 8000);
	} else {
		toast(`Mercify is running · ${k(info.hotkeys.toggle)} show/hide · ${k(info.hotkeys.edit)} Edit Mode · ${k(info.hotkeys.search)} search`, "", 6000);
	}
	if (info.connected && !S.connected) {
		S.connected = true;
		onConnected();
	}
})();
