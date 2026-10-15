// Mercify: renderer
// Panels, Edit Mode (drag / resize / snap / per-panel settings), and the Spotify views.
"use strict";

const api = window.overlay;

// The theme picked in Settings (General): colours and fonts are variables in style.css, set per
// theme on <html data-theme>. It comes in the address at start and as "theme" when it changes.
const THEMES = ["classic", "neon", "light", "vice"];
const applyTheme = (t) => (document.documentElement.dataset.theme = THEMES.includes(t) ? t : "classic");
applyTheme(new URLSearchParams(location.search).get("theme"));
api.onTheme(applyTheme);

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
	// ISO 7010 P001 "general prohibition": a ring with a bar from top left to bottom right
	noEntry: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.1" style="fill:none;stroke:currentColor;stroke-width:1.9"/><path d="M3.7 3.7l8.6 8.6" style="fill:none;stroke:currentColor;stroke-width:1.9"/></svg>',
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
	copy: I("M5 1.5h7.5A1.5 1.5 0 0 1 14 3v8.5h-1.5V3H5zM2 5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 11 5v8.5a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 2 13.5zm1.5 0v8.5h6V5z"),
	crown: I("M2 5.2l3.1 2.6L8 3.2l2.9 4.6L14 5.2l-1.3 6.6H3.3zM3.3 12.8h9.4v1.4H3.3z"),
	dice: `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M3.5 1.5h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zm0 1.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5zM5.25 4a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zm5.5 5.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM8 6.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z"/></svg>`,
	top: I("M3 2.5h10V4H3zM8 5.5l4.5 4.5-1.1 1.1-2.65-2.65V14h-1.5V8.45L4.6 11.1 3.5 10z"),
	collapse: I("M2 9h5v5H5.5v-2.4L2.9 14.2 1.8 13.1l2.6-2.6H2zM14 7H9V2h1.5v2.4l2.6-2.6 1.1 1.1-2.6 2.6H14z"),
	expand: I("M1.5 9.5H3v2.4l2.6-2.6 1.1 1.1-2.6 2.6h2.4v1.5h-5zM14.5 6.5H13V4.1l-2.6 2.6-1.1-1.1 2.6-2.6H9.5V1.5h5z"),
	person: I("M8 1.8a3.1 3.1 0 1 1 0 6.2 3.1 3.1 0 0 1 0-6.2zM8 9.2c3.2 0 5.8 1.7 5.8 3.8v1.2H2.2V13c0-2.1 2.6-3.8 5.8-3.8z"),
	join: I("M9 2.5h3.5A1.5 1.5 0 0 1 14 4v8a1.5 1.5 0 0 1-1.5 1.5H9V12h3.5V4H9zM6.6 4.4l3.6 3.6-3.6 3.6-1.06-1.06 1.79-1.79H1.5v-1.5h5.83L5.54 5.46z"),
};

// ------------------------------------------------------------------ app state

// The display the overlay covers, and which part of it the window shows right now. Hidden, the
// window only covers the panels that stay visible (see placeWindow in main.js); panels are still
// laid out in display coordinates and the page is shifted by the window's offset.
let dispW = window.innerWidth;
let dispH = window.innerHeight;
const view = { x: 0, y: 0 };

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
	lobby: null, // listening lobby state from the main process
	friends: null, // friends list and requests from the main process
};

// ------------------------------------------------------------------ panel registry + default layout

const PANELS = {
	nowplaying: {
		title: "Now Playing",
		min: [200, 56],
		def: (W, H) => ({ x: 24, y: H - 24 - 112, w: 460, h: 112, shownAlpha: 1, hiddenAlpha: 0.75, compact: false, cx: 24, cy: H - 24 - 56, cw: 300, ch: 56 }),
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
	notices: {
		title: "Notifications",
		bare: true,
		passive: true, // never takes clicks (except in Edit Mode)
		min: [220, 56],
		// shown at full strength even when the overlay is hidden, so "Kain added a song" still pops up
		def: (W, H) => ({ x: Math.round(W / 2 - 210), y: H - 24 - 150, w: 420, h: 150, shownAlpha: 1, hiddenAlpha: 1 }),
	},
	session: {
		title: "Session Playlist",
		min: [240, 200],
		def: (W, H) => ({ x: W - 24 - 300 - 12 - 320, y: H - 24 - 380, w: 320, h: 380, shownAlpha: 1, hiddenAlpha: 0 }),
	},
	lobby: {
		title: "Lobby",
		min: [240, 180],
		def: (W, H) => ({ x: W - 24 - 300, y: H - 24 - 340, w: 300, h: 340, shownAlpha: 1, hiddenAlpha: 0 }),
	},
	friends: {
		title: "Friends",
		min: [220, 140],
		def: (W, H) => ({ x: W - 24 - 300, y: Math.max(24, H - 24 - 340 - 12 - 260), w: 300, h: 260, shownAlpha: 1, hiddenAlpha: 0 }),
	},
};

function defaultPanel(id) {
	return { enabled: true, scale: 1, ...PANELS[id].def(dispW, dispH) };
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

// ------------------------------------------------------------------ panel geometry
// Now Playing has a compact view with its own size (cw/ch) and position (cx/cy).
// Everything that moves or measures panels goes through rectOf/setRect so it works in both views.

const COMPACT_MIN = [150, 40];
const isCompact = (id) => id === "nowplaying" && !!S.layout.panels[id].compact;
// Now Playing can stay clickable while the rest of the overlay is hidden (both views).
const isLiveHidden = (id) => id === "nowplaying" && S.layout.panels[id].liveHidden !== false;

function rectOf(id) {
	const c = S.layout.panels[id];
	return isCompact(id) ? { x: c.cx, y: c.cy, w: c.cw, h: c.ch } : { x: c.x, y: c.y, w: c.w, h: c.h };
}

function setRect(id, r) {
	const c = S.layout.panels[id];
	if (isCompact(id)) Object.assign(c, { cx: r.x, cy: r.y, cw: r.w, ch: r.h });
	else Object.assign(c, { x: r.x, y: r.y, w: r.w, h: r.h });
}

const minOf = (id) => (isCompact(id) ? COMPACT_MIN : PANELS[id].min);

// Within this many px of the screen's centre line, a panel counts as centred on that axis
// (the same distance Edit Mode snaps to the centre line from).
const CENTRE_TOL = 10;

// Where a panel edge goes when its size on one axis changes from `size` to `next`:
// centred panels keep their centre, others keep the edge nearest the screen edge.
function keepAnchor(start, size, next, disp) {
	const mid = start + size / 2;
	if (Math.abs(mid - disp / 2) <= CENTRE_TOL) return start + (size - next) / 2;
	return mid > disp / 2 ? start + size - next : start;
}

// Switch Now Playing between full and compact. It shrinks/grows in place towards the
// nearest screen corner, so a widget in the bottom-left stays in the bottom-left, and a
// centred widget stays centred.
function setCompact(on) {
	const c = S.layout.panels.nowplaying;
	if (!!c.compact === on) return;
	const from = rectOf("nowplaying");
	c.compact = on;
	const w = on ? c.cw : c.w;
	const h = on ? c.ch : c.h;
	setRect("nowplaying", { x: keepAnchor(from.x, from.w, w, dispW), y: keepAnchor(from.y, from.h, h, dispH), w, h });
	clampPanel("nowplaying");
	applyPanel("nowplaying");
	setTimeout(marqueeTitles, 300);
	if (S.selected === "nowplaying") showPopover();
	saveLayout();
}

// ------------------------------------------------------------------ panel DOM

const panelEls = {};

function buildPanel(id) {
	const def = PANELS[id];
	const p = el("section", "panel" + (def.bare ? " bare" : "") + (def.passive ? " passive" : ""));
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
	const r = rectOf(id);
	p.style.left = r.x + "px";
	p.style.top = r.y + "px";
	p.style.width = r.w + "px";
	p.style.height = r.h + "px";
	p.style.setProperty("--scale", c.scale ?? 1);
	p.style.setProperty("--shown-alpha", c.shownAlpha);
	const compact = isCompact(id);
	p.classList.toggle("compact", compact);
	// Now Playing can stay clickable while the overlay is toggled hidden.
	p.classList.toggle("live-hidden", isLiveHidden(id));

	let visible = c.enabled;
	if (id === "results" && c.autoHide && !S.edit && !S.query) visible = false;
	p.classList.toggle("off", !visible);

	let alpha;
	if (S.edit) alpha = Math.max(c.shownAlpha, 0.6);
	else alpha = S.shown ? c.shownAlpha : c.hiddenAlpha;
	p.style.opacity = alpha;
	p.style.visibility = alpha <= 0.001 && !S.edit ? "hidden" : "";

	const label = p.querySelector(".edit-label");
	label.innerHTML = esc(PANELS[id].title) + (compact ? '<span class="muted">compact</span>' : "") + (c.enabled ? "" : '<span class="muted">hidden</span>');
	if (id === "lobby") fitLobby();
	sendClickZone();
	sendHiddenArea();
}

function applyAll() {
	applyNoticesDirection();
	document.body.classList.toggle("edit", S.edit);
	document.body.classList.toggle("hidden", !S.shown && !S.edit);
	document.body.classList.toggle("snap", !!S.layout.snap);
	for (const id of Object.keys(PANELS)) applyPanel(id);
}

// Keep panels on-screen after a resolution change or a layout from another monitor.
function clampPanel(id) {
	const r = rectOf(id);
	const [mw, mh] = minOf(id);
	r.w = clamp(r.w, mw, dispW);
	r.h = clamp(r.h, mh, dispH);
	r.x = clamp(r.x, 0, dispW - r.w);
	r.y = clamp(r.y, 0, dispH - r.h);
	setRect(id, r);
}

// ------------------------------------------------------------------ click-through

let interactiveNow = false;
function setInteractive(on) {
	if (on === interactiveNow) return;
	interactiveNow = on;
	api.setInteractive(on);
}

function hoverAt(target) {
	if (S.edit) return;
	if (S.zone) return zoneHover(target);
	if (S.dragging) return setInteractive(true);
	const over = target?.closest?.(".panel:not(.off)");
	// While hidden, only the Now Playing widget takes clicks (others have pointer-events: none),
	// and notifications with buttons (a friend asking to join).
	const usable = !!over && over.style.visibility !== "hidden" && (S.shown || over.classList.contains("live-hidden") || !!target.closest(".notice.actionable"));
	setInteractive(usable);
}

// ------------------------------------------------------------------ click zone
// Clicking a panel mustn't make the overlay window active: the game would lose the keyboard and
// drop the keys you're holding (WASD). So the window stays click-through, and Mercify's helper
// catches clicks on the panels and keeps them from the game. They arrive here (onZoneMouse) and
// are replayed on whatever is under them; a text box takes the keyboard on purpose (wantFocus).
// Hover effects follow the cursor reports instead of real mouse events: every element under the
// cursor gets the .zh class (style.css pairs each :hover rule with it) and mouseenter/mouseleave.

// The panels that take clicks right now: all visible ones while the overlay is shown, only a
// "clickable while hidden" Now Playing while it's hidden.
function clickablePanels() {
	if (!S.layout || S.edit) return [];
	return Object.keys(PANELS).filter((id) => {
		const p = panelEls[id];
		if (!p || p.classList.contains("off") || p.style.visibility === "hidden") return false;
		// Notifications never take clicks, except ones with buttons (shown or hidden)
		if (id === "notices") return hasActionNotices();
		if (PANELS[id].passive) return false;
		return S.shown || isLiveHidden(id);
	});
}

const hasActionNotices = () => !!nt.stack?.querySelector(".notice.actionable:not(.leaving)");

// The panels that stay visible while the overlay is hidden, in display coordinates: main.js
// sizes the window to just these then.
let hiddenSent = "";
function sendHiddenArea() {
	if (!S.layout) return;
	const rects = [];
	for (const id of Object.keys(PANELS)) {
		const p = panelEls[id];
		if (!p || p.classList.contains("off") || !(S.layout.panels[id].hiddenAlpha > 0.001)) continue;
		const r = p.getBoundingClientRect();
		if (r.width > 0 && r.height > 0) rects.push({ x: Math.round(r.left + view.x), y: Math.round(r.top + view.y), w: Math.round(r.width), h: Math.round(r.height) });
	}
	const key = JSON.stringify(rects);
	if (key === hiddenSent) return;
	hiddenSent = key;
	api.setHiddenArea(rects);
}

let zoneSent = "";
function sendClickZone() {
	const rects = [];
	for (const id of clickablePanels()) {
		// the Notifications panel only takes clicks on the cards with buttons
		const els = id === "notices" ? [...nt.stack.querySelectorAll(".notice.actionable:not(.leaving)")] : [panelEls[id]];
		for (const e of els) {
			const r = e.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) rects.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
		}
	}
	const key = JSON.stringify(rects);
	if (key === zoneSent) return;
	zoneSent = key;
	api.setClickZone(rects);
}

const zonePanel = (el) => {
	const p = el?.closest?.(".panel");
	return p && clickablePanels().some((id) => panelEls[id] === p) ? p : null;
};

let zoneHovered = [];
function zoneHover(target) {
	const want = [];
	const panel = zonePanel(target);
	for (let el = panel && target; el && el !== panel.parentElement; el = el.parentElement) want.push(el);
	for (const el of zoneHovered) if (!want.includes(el)) el.classList.remove("zh"), el.dispatchEvent(new MouseEvent("mouseleave"));
	for (const el of want) if (!zoneHovered.includes(el)) el.classList.add("zh"), el.dispatchEvent(new MouseEvent("mouseenter"));
	zoneHovered = want;
}

const scrollerOf = (el) => {
	for (; el && el !== document.body; el = el.parentElement) {
		const o = getComputedStyle(el).overflowY;
		if ((o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight) return el;
	}
	return null;
};

let zoneDown = null; // { el, bar, scroll } for a press that started on a panel
function zoneMouse({ type, x, y, d }) {
	const at = document.elementFromPoint(x, y);
	const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "up" ? 0 : 1, pointerId: 1, pointerType: "mouse", isPrimary: true };
	if (type === "down") {
		zoneDown = null;
		if (!zonePanel(at)) return;
		// a text box: take the keyboard (Enter/Esc or picking a song hands it back)
		if (at.matches('input[type="text"]')) return focusInput(at);
		const bar = at.closest(".bar");
		// on a list's scrollbar (the press lands on the scrolling element itself, right of its content)
		const sc = scrollerOf(at);
		const onScrollbar = sc && at === sc && x > sc.getBoundingClientRect().left + sc.clientWidth;
		zoneDown = { el: at, bar, scroll: onScrollbar ? { el: sc, y, top: sc.scrollTop } : null };
		if (bar) bar.dispatchEvent(new PointerEvent("pointerdown", opts));
		at.dispatchEvent(new MouseEvent("mousedown", opts));
	} else if (type === "move") {
		if (zoneDown?.bar) zoneDown.bar.dispatchEvent(new PointerEvent("pointermove", opts));
		const s = zoneDown?.scroll;
		if (s) s.el.scrollTop = s.top + ((y - s.y) * s.el.scrollHeight) / s.el.clientHeight;
		zoneHover(at);
	} else if (type === "up" || type === "cancel") {
		const down = zoneDown;
		zoneDown = null;
		if (!down) return;
		if (down.bar) return down.bar.dispatchEvent(new PointerEvent(type === "up" ? "pointerup" : "pointercancel", opts));
		if (type !== "up" || !at || down.scroll) return;
		at.dispatchEvent(new MouseEvent("mouseup", opts));
		// a click: pressed and released on the same button or row (or the same spot)
		const target = (el) => el.closest?.("button, [data-act], .row, .sp-row, .np-artist") || el;
		if (target(down.el) === target(at)) at.dispatchEvent(new MouseEvent("click", opts));
	} else if (type === "context" && at && zonePanel(at)) {
		// a right click (the helper reports it on release)
		at.dispatchEvent(new MouseEvent("contextmenu", { ...opts, button: 2, buttons: 0 }));
	} else if (type === "wheel" && at && zonePanel(at)) {
		// replayed wheel events don't scroll by themselves
		const ev = new WheelEvent("wheel", { ...opts, deltaY: -d, deltaMode: 0 });
		at.dispatchEvent(ev);
		if (!ev.defaultPrevented) scrollerOf(at)?.scrollBy({ top: (-d / 120) * 100 });
	}
}

function zoneReset() {
	if (zoneDown?.bar) zoneDown.bar.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
	zoneDown = null;
	zoneHover(null);
}
document.addEventListener("mousemove", (e) => hoverAt(e.target));
// While click-through, the window gets no mouse events; the main process reports the cursor instead.
api.onCursor(({ x, y }) => hoverAt(document.elementFromPoint(x, y)));
document.addEventListener("mouseleave", () => {
	if (!S.edit) setInteractive(false);
});

// Clicking a panel activates the overlay window, which takes the keyboard away from the game.
// After a click on anything other than a text box, hand the keyboard straight back.
// (Text boxes keep it until Enter/Esc or a song is picked.)
function focusInput(input) {
	api.wantFocus();
	setTimeout(() => input.focus(), 40);
}
let giveBackTimer = null;
document.addEventListener("click", (e) => {
	if (S.edit || !e.target.closest?.(".panel")) return;
	clearTimeout(giveBackTimer);
	giveBackTimer = setTimeout(() => {
		if (document.activeElement?.matches?.('input[type="text"]')) return; // typing: keep focus
		api.giveBackFocus();
	}, 120);
});
// Releasing the volume slider or a scrollbar counts too.
document.addEventListener("pointerup", (e) => {
	if (S.edit || !e.target.closest?.(".panel")) return;
	if (e.target.closest?.(".bar") || e.target.closest?.(".scroll") === e.target) {
		clearTimeout(giveBackTimer);
		giveBackTimer = setTimeout(() => {
			if (!document.activeElement?.matches?.('input[type="text"]')) api.giveBackFocus();
		}, 120);
	}
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
	const xs = [0, dispW, dispW / 2];
	const ys = [0, dispH, dispH / 2];
	for (const [id, c] of Object.entries(S.layout.panels)) {
		if (id === exceptId || !c.enabled) continue;
		const r = rectOf(id);
		xs.push(r.x, r.x + r.w);
		ys.push(r.y, r.y + r.h);
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
	drag = {
		id,
		edge: e.target.dataset.edge || null,
		sx: e.clientX,
		sy: e.clientY,
		start: rectOf(id),
		pointerId: e.pointerId,
	};
	panel.setPointerCapture(e.pointerId);
	e.preventDefault();
});

document.addEventListener("pointermove", (e) => {
	if (!drag) return;
	const c = rectOf(drag.id); // working copy of the active rect, written back with setRect
	const dx = e.clientX - drag.sx;
	const dy = e.clientY - drag.sy;
	const useSnap = S.layout.snap && !e.altKey;
	const t = useSnap ? snapTargets(drag.id) : { xs: [], ys: [] };
	const [mw, mh] = minOf(drag.id);
	const lines = { xs: [], ys: [] };

	if (!drag.edge) {
		let x = clamp(drag.start.x + dx, 0, dispW - c.w);
		let y = clamp(drag.start.y + dy, 0, dispH - c.h);
		if (useSnap) {
			const sx = snapAxis(x, c.w, t.xs, true);
			const sy = snapAxis(y, c.h, t.ys, true);
			x = sx.v;
			y = sy.v;
			if (sx.line != null) lines.xs.push(sx.line);
			if (sy.line != null) lines.ys.push(sy.line);
		}
		c.x = clamp(x, 0, dispW - c.w);
		c.y = clamp(y, 0, dispH - c.h);
	} else {
		if (drag.edge.includes("r")) {
			let right = drag.start.x + drag.start.w + dx;
			if (useSnap) {
				const s = snapAxis(right, 0, t.xs, true);
				right = s.v;
				if (s.line != null) lines.xs.push(s.line);
			}
			c.w = clamp(right - c.x, mw, dispW - c.x);
		}
		if (drag.edge.includes("b")) {
			let bottom = drag.start.y + drag.start.h + dy;
			if (useSnap) {
				const s = snapAxis(bottom, 0, t.ys, true);
				bottom = s.v;
				if (s.line != null) lines.ys.push(s.line);
			}
			c.h = clamp(bottom - c.y, mh, dispH - c.y);
		}
	}
	setRect(drag.id, c);
	if (drag.id === "notices") applyNoticesDirection();
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
	const c = rectOf(S.selected);
	const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
	const m = moves[e.key];
	if (!m) return;
	e.preventDefault();
	c.x = clamp(c.x + m[0], 0, dispW - c.w);
	c.y = clamp(c.y + m[1], 0, dispH - c.h);
	setRect(S.selected, c);
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
	$("#pop-compact-row").hidden = id !== "nowplaying";
	$("#pop-compact").checked = !!c.compact;
	$("#pop-live-row").hidden = id !== "nowplaying";
	$("#pop-live").checked = c.liveHidden !== false;
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
	const c = rectOf(S.selected);
	const pw = pop.offsetWidth;
	const ph = pop.offsetHeight;
	let x = c.x + c.w + 12;
	if (x + pw > dispW - 8) x = c.x - pw - 12;
	if (x < 8) x = clamp(c.x + 12, 8, dispW - pw - 8);
	const y = clamp(c.y, 70, dispH - ph - 8);
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
	$("#pop-compact").addEventListener("change", () => setCompact($("#pop-compact").checked));
	$("#pop-live").addEventListener("change", upd((c) => (c.liveHidden = $("#pop-live").checked)));
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

// Notifications show up in the Notifications panel, which can be moved, resized, faded or
// switched off in Edit Mode like any other panel.
const MAX_NOTICES = 3;

function toast(html, kind = "", ms = 4000) {
	const stack = nt.stack;
	if (!stack || !S.layout?.panels?.notices?.enabled) return;
	const card = el("div", "notice" + (kind ? " " + kind : ""), html);
	const fromBottom = noticesFromBottom();
	if (fromBottom) stack.append(card);
	else stack.prepend(card);
	const live = stack.querySelectorAll(".notice:not(.sample):not(.leaving):not(.actionable)");
	if (live.length > MAX_NOTICES) dismiss(fromBottom ? live[0] : live[live.length - 1]);
	requestAnimationFrame(() => card.classList.add("show"));
	setTimeout(() => dismiss(card), ms);
}

function dismiss(card) {
	if (!card || card.classList.contains("leaving")) return;
	card.classList.add("leaving");
	card.classList.remove("show");
	setTimeout(() => {
		card.remove();
		if (card.classList.contains("actionable")) sendClickZone();
	}, 250);
	if (card.classList.contains("actionable")) sendClickZone();
}

// A notification with buttons (a friend asking to join, a friend request). It stays until it's
// answered, or until main says the request is gone (answered elsewhere, timed out).
// actions: [{ label, primary, run }]
function actionToast(key, html, actions) {
	const stack = nt.stack;
	if (!stack || !S.layout?.panels?.notices?.enabled) return false;
	if (stack.querySelector(`.notice.actionable[data-key="${CSS.escape(key)}"]:not(.leaving)`)) return true;
	const card = el("div", "notice actionable", `<div class="nt-text">${html}</div><div class="nt-actions"></div>`);
	card.dataset.key = key;
	const row = $(".nt-actions", card);
	for (const a of actions) {
		const b = el("button", "nt-btn" + (a.primary ? " primary" : ""), esc(a.label));
		b.addEventListener("click", () => {
			if (S.edit) return;
			dismiss(card);
			a.run();
		});
		row.append(b);
	}
	if (noticesFromBottom()) stack.append(card);
	else stack.prepend(card);
	requestAnimationFrame(() => {
		card.classList.add("show");
		sendClickZone();
	});
	return true;
}

function dismissActionToasts(keep) {
	nt.stack?.querySelectorAll(".notice.actionable:not(.leaving)").forEach((c) => keep.has(c.dataset.key) || dismiss(c));
}

// New notifications appear nearest the screen edge the panel sits at.
function noticesFromBottom() {
	const r = rectOf("notices");
	return r.y + r.h / 2 > dispH / 2;
}

const nt = {};
function buildNotices() {
	const body = buildPanel("notices");
	body.innerHTML = `<div class="nt-stack"><div class="notice sample show">Notifications appear here, like <b>Kain added “Song name”</b></div></div>`;
	nt.stack = $(".nt-stack", body);
}

function applyNoticesDirection() {
	nt.stack?.classList.toggle("from-bottom", noticesFromBottom());
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

// ------------------------------------------------------------------ listening lobby: listener rules
// In someone else's lobby the host controls playback. Picking a song suggests it to the host instead.

const following = () => S.lobby?.status === "joined" && S.lobby?.role === "listener";
const HOST_ONLY = new Set(["togglePlay", "next", "prev", "toggleShuffle", "toggleRepeat"]);
const hostName = () => esc(S.lobby?.hostName || "The host");

function hostOnlyToast() {
	toast(`${hostName()} controls playback in this lobby. Press Next to vote to skip, or click a song to add it to the session playlist.`);
}

// A listener's Next button is a vote to skip (pressing it again takes the vote back).
function voteSkipFromNext() {
	const st = S.lobby;
	const sk = st?.skip;
	const mine = !!sk?.mine;
	const total = sk?.total || st?.members?.length || 1;
	const need = sk?.need || Math.max(1, Math.ceil(total / 2));
	const count = (sk?.count || 0) + (mine ? -1 : 1);
	api.lobbyVoteSkip(!mine);
	if (mine) toast("You took back your vote to skip");
	else if (count >= need) toast(`You voted to skip. That's enough votes (${count} of ${total}), so it's skipping.`);
	else toast(`You voted to skip (${count} of ${need} votes needed). Press Next again to take it back.`);
}

// Listeners see Next as "vote to skip", lit while their vote counts.
function updateNextButtons() {
	const vote = following();
	const mine = vote && !!S.lobby?.skip?.mine;
	document.querySelectorAll('.panel[data-id=nowplaying] [data-act="next"]').forEach((b) => {
		b.title = !vote ? "Next" : mine ? "Take back your vote to skip" : "Vote to skip this song";
		b.classList.toggle("voted", mine);
	});
}

const inLobby = () => S.lobby?.status === "joined";

// Add a song to the lobby's session playlist (everyone sees it; it plays when its turn comes).
async function addToSession(t) {
	const r = await api.lobbyQueueAdd({ uri: t.uri, name: t.name, artists: t.artists, image: t.image, duration: t.duration });
	if (r.ok) toast(`Added <b>${esc(t.name)}</b> to the session playlist`);
	else toast(esc(r.error), "error");
}

// ------------------------------------------------------------------ Now Playing panel

const np = {};

function buildNowPlaying() {
	const body = buildPanel("nowplaying");
	body.innerHTML = `
		<div class="np">
			<img class="np-art" src="" alt="" />
			<div class="np-main">
				<div class="np-title mq-box"><span class="mq">Waiting for Spotify…</span></div>
				<div class="np-artist">Not set up yet? Click here to open Setup</div>
				<div class="np-progress">
					<span class="t-cur">0:00</span>
					<div class="bar seek"><div class="bar-track"><div class="bar-fill"></div></div><div class="bar-thumb"></div></div>
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
						<div class="bar vol-bar" title="Volume (scroll to adjust)"><div class="bar-track"><div class="bar-fill"></div></div><div class="bar-thumb"></div></div>
					</div>
				</div>
			</div>
		</div>
		<span class="np-lobby" hidden></span>
		<button class="icon-btn np-collapse" data-act="collapse" title="Compact view">${ICON.collapse}</button>
		<div class="npc">
			<img class="npc-art" src="" alt="" />
			<div class="npc-text">
				<div class="npc-title mq-box"><span class="mq">Waiting for Spotify…</span></div>
				<div class="npc-artist"></div>
			</div>
			<div class="npc-controls">
				<button class="icon-btn" data-act="prev" title="Previous">${ICON.prev}</button>
				<button class="icon-btn big" data-act="togglePlay" title="Play / pause">${ICON.play}</button>
				<button class="icon-btn" data-act="next" title="Next">${ICON.next}</button>
				<button class="icon-btn npc-expand" data-act="expand" title="Full view">${ICON.expand}</button>
			</div>
			<div class="npc-progress"><div class="npc-fill"></div></div>
		</div>`;
	Object.assign(np, {
		art: $(".np-art", body),
		title: $(".np-title .mq", body),
		artist: $(".np-artist", body),
		cur: $(".t-cur", body),
		dur: $(".t-dur", body),
		bar: $(".bar.seek", body),
		fill: $(".bar.seek .bar-fill", body),
		seekThumb: $(".bar.seek .bar-thumb", body),
		play: $('[data-act="togglePlay"]', body),
		shuffle: $('[data-act="toggleShuffle"]', body),
		repeat: $('[data-act="toggleRepeat"]', body),
		like: $('[data-act="toggleLike"]', body),
		mute: $('[data-act="mute"]', body),
		vol: $(".vol-bar", body),
		volFill: $(".vol-bar .bar-fill", body),
		volThumb: $(".vol-bar .bar-thumb", body),
		plays: body.querySelectorAll('[data-act="togglePlay"]'),
		cArt: $(".npc-art", body),
		cTitle: $(".npc-title .mq", body),
		cArtist: $(".npc-artist", body),
		cFill: $(".npc-fill", body),
		lobby: $(".np-lobby", body),
	});
	// hovering over the song info scrolls a long title again
	for (const area of [$(".np-main", body), $(".npc-text", body)]) area.addEventListener("mouseenter", () => !S.edit && marquee(area.querySelector(".mq-box")));

	body.addEventListener("click", (e) => {
		const b = e.target.closest("[data-act]");
		if (!b || S.edit) return;
		const act = b.dataset.act;
		if (act === "collapse" || act === "expand") return setCompact(act === "collapse");
		if (act === "mute") {
			const v = S.player?.volume ?? 1;
			if (v > 0) np.lastVol = v;
			return fire("setVolume", { level: v > 0 ? 0 : np.lastVol || 0.5 });
		}
		if (act === "next" && following()) return voteSkipFromNext();
		if (following() && HOST_ONLY.has(act)) return hostOnlyToast();
		// Host with songs in the session playlist: Next plays the next one from it.
		if (act === "next" && inLobby()) {
			api.lobbyNext().then((handled) => handled || fire("next"));
			return;
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

	// Song position: drag (or click) along the bar; it jumps when you let go.
	makeSlider(np.bar, {
		allowed: () => {
			if (!S.player?.duration) return false;
			if (following()) {
				hostOnlyToast();
				return false;
			}
			return true;
		},
		onMove: (f) => {
			np.seekPreview = f * S.player.duration;
			showSeek(np.seekPreview);
		},
		onDone: (f) => {
			const ms = Math.round(f * S.player.duration);
			np.seekPreview = null;
			S.player.position = ms;
			S.player.at = Date.now();
			fire("seek", { ms });
		},
		onCancel: () => (np.seekPreview = null),
	});

	// Volume: changes live while you drag; Spotify's own updates can't snap it back mid-drag.
	let lastSent = 0;
	let sendTimer = null;
	const sendVolume = (level, now) => {
		clearTimeout(sendTimer);
		const go = () => {
			lastSent = Date.now();
			fire("setVolume", { level });
		};
		if (now || Date.now() - lastSent > 90) go();
		else sendTimer = setTimeout(go, 90);
	};
	const setVolumeUi = (level, now) => {
		level = clamp(level, 0, 1);
		if (S.player) S.player.volume = level;
		np.volHoldUntil = Date.now() + 1500; // ignore Spotify's (older) volume for a moment
		showVolume(level);
		np.mute.innerHTML = level > 0 ? ICON.volume : ICON.mute;
		sendVolume(level, now);
	};
	makeSlider(np.vol, {
		onMove: (f) => setVolumeUi(f),
		onDone: (f) => setVolumeUi(f, true),
	});
	// Mouse wheel over the volume control: 5% per notch.
	$(".vol", body).addEventListener(
		"wheel",
		(e) => {
			if (S.edit) return;
			e.preventDefault();
			const cur = S.player?.volume ?? 1;
			setVolumeUi(cur + (e.deltaY < 0 ? 0.05 : -0.05));
		},
		{ passive: false }
	);
}

// A draggable bar: press, drag (even outside the panel) and release.
function makeSlider(el, { allowed = () => true, onMove, onDone, onCancel = () => {} }) {
	let dragging = false;
	const frac = (e) => {
		const r = el.getBoundingClientRect();
		return clamp((e.clientX - r.left) / r.width, 0, 1);
	};
	el.addEventListener("pointerdown", (e) => {
		if (S.edit || e.button !== 0 || !allowed()) return;
		dragging = true;
		S.dragging = true;
		try {
			el.setPointerCapture(e.pointerId); // keep getting the drag even outside the bar
		} catch (_) {}
		el.classList.add("dragging");
		onMove(frac(e));
		e.preventDefault();
	});
	el.addEventListener("pointermove", (e) => dragging && onMove(frac(e)));
	const end = (e, commit) => {
		if (!dragging) return;
		dragging = false;
		S.dragging = false;
		el.classList.remove("dragging");
		if (commit) onDone(frac(e));
		else onCancel();
	};
	el.addEventListener("pointerup", (e) => end(e, true));
	el.addEventListener("pointercancel", (e) => end(e, false));
}

function showSeek(ms) {
	const pct = (S.player?.duration ? clamp(ms / S.player.duration, 0, 1) * 100 : 0) + "%";
	np.fill.style.width = pct;
	np.seekThumb.style.left = pct;
	np.cur.textContent = fmt(ms);
}

function showVolume(level) {
	const pct = clamp(level, 0, 1) * 100 + "%";
	np.volFill.style.width = pct;
	np.volThumb.style.left = pct;
}

function currentPosition() {
	const p = S.player;
	if (!p) return 0;
	const base = p.position || 0;
	return p.isPlaying ? Math.min(p.duration || Infinity, base + (Date.now() - (p.at || Date.now()))) : base;
}

// ------------------------------------------------------------------ scrolling titles
// A title too long for its space scrolls across once when the song starts, and again
// whenever you hover over it.

function marquee(box) {
	const inner = box.firstElementChild;
	if (!inner || box.clientWidth === 0) return; // not on screen (e.g. the other view)
	const over = inner.scrollWidth - box.clientWidth;
	box.classList.toggle("overflow", over > 2);
	if (over <= 2 || box._anim?.playState === "running") return;
	const travel = Math.max(800, (over / 55) * 1000); // about 55 px per second
	const hold = 1000; // pause at the start and at the end
	const back = 450; // quick slide back
	const total = hold + travel + hold + back;
	box.classList.add("scrolling");
	box._anim = inner.animate(
		[
			{ transform: "translateX(0)", offset: 0 },
			{ transform: "translateX(0)", offset: hold / total, easing: "ease-in-out" },
			{ transform: `translateX(${-over}px)`, offset: (hold + travel) / total },
			{ transform: `translateX(${-over}px)`, offset: (hold + travel + hold) / total, easing: "ease-in" },
			{ transform: "translateX(0)", offset: 1 },
		],
		{ duration: total, easing: "linear" }
	);
	box._anim.onfinish = box._anim.oncancel = () => box.classList.remove("scrolling");
}

function marqueeTitles() {
	document.querySelectorAll(".panel[data-id=nowplaying] .mq-box").forEach((b) => {
		b._anim?.cancel();
		marquee(b);
	});
}

// Title, artist and art go to both the full and the compact view.
function setTrackInfo(title, artist, image) {
	const changed = np.title.textContent !== title;
	np.title.textContent = np.cTitle.textContent = title;
	np.title.parentElement.title = np.cTitle.parentElement.title = title;
	if (changed) setTimeout(marqueeTitles, 700); // once per new song
	np.artist.textContent = np.cArtist.textContent = artist;
	for (const img of [np.art, np.cArt]) {
		if (img.dataset.src === image) continue;
		img.dataset.src = image;
		img.src = image;
	}
}

function setPlayIcons(playing) {
	np.plays.forEach((b) => (b.innerHTML = playing ? ICON.pause : ICON.play));
}

// "Not set up yet? Click here to open Setup": while Spotify isn't connected, the line under
// the title opens Settings, where the one-click setup is.
document.addEventListener("click", (e) => {
	if (S.edit || S.connected) return;
	if (e.target.closest?.(".np-artist")) api.openSettings();
});

function renderPlayer() {
	const p = S.player;
	if (!S.connected) {
		setTrackInfo("Waiting for Spotify…", "Not set up yet? Click here to open Setup", "");
		setPlayIcons(false);
		return;
	}
	if (!p || p.empty) {
		setTrackInfo("Nothing playing", "Pick something from a playlist or search", "");
		setPlayIcons(false);
		return;
	}
	setTrackInfo(p.name, (p.artists || []).join(", "), p.image || "");
	setPlayIcons(p.isPlaying);
	np.shuffle.classList.toggle("on", !!p.shuffle);
	np.repeat.classList.toggle("on", p.repeat > 0);
	np.repeat.innerHTML = p.repeat === 2 ? ICON.repeatOne : ICON.repeat;
	np.like.classList.toggle("on", !!p.liked);
	np.like.innerHTML = p.liked ? ICON.heartFull : ICON.heart;
	np.mute.innerHTML = p.volume > 0 ? ICON.volume : ICON.mute;
	if (!(np.volHoldUntil > Date.now())) showVolume(p.volume ?? 1);
	np.dur.textContent = fmt(p.duration);
	markPlayingRows();
}

function tick() {
	if (S.player && !S.player.empty && S.connected) {
		const pos = currentPosition();
		const pct = (S.player.duration ? (pos / S.player.duration) * 100 : 0) + "%";
		if (np.seekPreview == null) {
			np.cur.textContent = fmt(pos);
			np.fill.style.width = pct;
			np.seekThumb.style.left = pct;
		}
		np.cFill.style.width = pct;
	}
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
		const plus = !!e.target.closest(".icon-btn");
		// In a lobby, + adds to the session playlist; listeners add by clicking the song too.
		if (following() || (plus && inLobby())) {
			addToSession(t);
			if (document.activeElement?.matches?.('input[type="text"]')) api.releaseFocus();
			return;
		}
		if (plus) {
			cmd("addToQueue", { uri: t.uri })
				.then(() => toast(`Queued <b>${esc(t.name)}</b>`))
				.catch(() => {});
			return;
		}
		fire("playTrack", { uri: t.uri, contextUri, uid: t.uid ?? null, index });
		if (document.activeElement?.matches?.('input[type="text"]')) api.releaseFocus();
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
				if (following()) addToSession(top);
				else fire("playTrack", { uri: top.uri });
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
			row.addEventListener("click", () => !S.edit && openPlaylist(p.uri, p, { fromSearch: true }));
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
			row.title = "Open in the Playlist panel";
			const play = $(".row-dur", row);
			play.classList.add("row-play");
			row.addEventListener("click", (e) => {
				if (S.edit) return;
				if (e.target.closest(".row-play")) {
					if (following()) return hostOnlyToast();
					fire("playContext", { uri: a.uri });
					return;
				}
				openPlaylist(a.uri, { ...a, album: true }, { fromSearch: true });
				if (document.activeElement?.matches?.('input[type="text"]')) api.releaseFocus();
			});
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
			<button class="pill-btn pl-addall" title="Add every song here to the session playlist" hidden>${ICON.plus}<span>Add all</span></button>
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
	pl.addAll = $(".pl-addall", body);
	pl.addAll.addEventListener("click", addAllToSession);

	pl.btn.addEventListener("click", () => {
		if (S.edit) return;
		openPicker();
	});
	$(".picker .icon-btn", body).addEventListener("click", () => closePicker());
	pl.filter.addEventListener("input", renderPicker);
	pl.filter.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			closePicker();
			e.stopPropagation();
		} else if (e.key === "Enter") {
			pl.pickList.querySelector(".row")?.click();
		}
	});
}

function closePicker() {
	pl.picker.hidden = true;
	if (document.activeElement === pl.filter) api.releaseFocus();
}

async function openPicker() {
	pl.picker.hidden = false;
	pl.filter.value = "";
	renderPicker();
	focusInput(pl.filter);
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
			closePicker();
			openPlaylist(p.uri, p);
		});
		pl.pickList.append(row);
	}
}

let plSeq = 0;
let plStop = null;
// Opened from search results: the Playlist panel is somewhere else on screen (or turned off),
// so say what happened where you clicked instead of leaving it to look like nothing did.
function playlistPanelShowing() {
	const c = S.layout.panels.playlist;
	if (!c?.enabled || (c.shownAlpha ?? 1) < 0.05) return false;
	const r = rectOf("playlist");
	return r.x < dispW - 40 && r.y < dispH - 40 && r.x + r.w > 40 && r.y + r.h > 40;
}

function flashPanel(id) {
	const p = panelEls[id];
	if (!p) return;
	p.classList.remove("flash");
	void p.offsetWidth; // restart the animation
	p.classList.add("flash");
	setTimeout(() => p.classList.remove("flash"), 1300);
}

async function openPlaylist(uri, hint, { fromSearch = false } = {}) {
	const album = String(uri).startsWith("spotify:album:");
	if (fromSearch) {
		if (playlistPanelShowing()) flashPanel("playlist");
		else toast(`The Playlist panel is turned off or off-screen, so you can't see the ${album ? "album" : "playlist"} it opened. Turn it on in Edit Mode.`, "error", 7000);
	}
	const seq = ++plSeq;
	S.layout.lastPlaylist = uri;
	saveLayout();
	pl.btnTitle.textContent = hint?.name || "Loading…";
	setPickerArt(hint);
	pl.meta.textContent = "";
	plStop?.();
	pl.list.innerHTML = '<div class="empty-note"><span class="spinner" style="display:inline-block"></span></div>';
	S.playlist = null;
	updateAddAll();
	try {
		const data = await cmd("playlistTracks", { uri });
		if (seq !== plSeq) return;
		S.playlist = data;
		pl.btnTitle.textContent = data.name || hint?.name || "Playlist";
		setPickerArt({ ...hint, image: data.image || hint?.image });
		pl.meta.textContent = `${data.album ? "Album · " : ""}${data.tracks.length} songs`;
		updateAddAll();
		pl.list.innerHTML = "";
		pl.list.scrollTop = 0;
		if (!data.tracks.length) pl.list.innerHTML = `<div class="empty-note">This ${data.album ? "album" : "playlist"} is empty</div>`;
		else plStop = renderTracks(pl.list, data.tracks, { contextUri: data.contextUri, showIndex: true });
	} catch (e) {
		if (seq !== plSeq) return;
		S.playlist = null;
		updateAddAll();
		// the Spotify extension before 1.2.0 can't read albums
		pl.list.innerHTML = `<div class="empty-note">Couldn't load ${album ? "album" : "playlist"}: ${esc(e.message)}${album ? "<br>If this keeps happening, update the Mercify extension in Settings." : ""}</div>`;
		if (fromSearch) toast(`Couldn't open <b>${esc(hint?.name || (album ? "that album" : "that playlist"))}</b>${album ? ". Open Mercify's Settings and press <b>Finish setup</b> (Spotify restarts once)." : `: ${esc(e.message)}`}`, "error", 8000);
	}
}

// "Add all" puts the open album or playlist into the lobby's session playlist, in order.
function updateAddAll() {
	if (!pl.addAll) return;
	pl.addAll.hidden = !(inLobby() && S.playlist?.tracks?.length);
}

async function addAllToSession() {
	if (S.edit || !S.playlist) return;
	const tracks = S.playlist.tracks.filter((t) => t.playable !== false);
	const r = await api.lobbyQueueAddMany(tracks, S.playlist.name || "");
	if (!r.ok) return toast(esc(r.error), "error");
	const more = tracks.length > r.count ? ` (the first ${r.count}; the session playlist holds up to 100)` : "";
	toast(`Added <b>${esc(S.playlist.name || "these songs")}</b> to the session playlist${more}`);
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

// ------------------------------------------------------------------ Session playlist panel

const sp = { tab: "next" };

// Not in a lobby, the panel shows Spotify's own Up next (from the extension) and the songs
// played since Mercify started. Joining a lobby swaps in the lobby's session playlist.
const solo = { next: [], played: [], seq: 0 };
function notePlayed(prev, cur) {
	if (!prev || prev.empty || !prev.uri || prev.uri === cur?.uri) return;
	if (solo.played[0]?.uri === prev.uri) return;
	solo.played.unshift({ qid: "p" + ++solo.seq, uri: prev.uri, name: prev.name, artists: prev.artists, image: prev.imageSmall || prev.image, duration: prev.duration });
	if (solo.played.length > 50) solo.played.pop();
	if (!inLobby() && sp.tab === "played") renderSession();
}

function renderSoloSession() {
	const next = solo.next;
	sp.now.hidden = true;
	sp.count.textContent = next.length ? `· ${next.length}` : "";
	if (sp.tab === "next") {
		sp.list.innerHTML = next.length
			? next.map((t, i) => sessionRow({ ...t, qid: "s" + i, by: t.queued ? "You" : null }, { index: i, host: false, mine: t.queued })).join("")
			: `<div class="empty-note">Nothing up next in Spotify.<br />Click <b>+</b> on any song to queue it.</div>`;
	} else {
		sp.list.innerHTML = solo.played.length ? solo.played.map((h) => sessionRow(h, { played: true })).join("") : `<div class="empty-note">Songs you play show up here.</div>`;
	}
	markPlayingRows();
}

function buildSession() {
	const body = buildPanel("session");
	body.innerHTML = `
		<div class="list-head sp-head">
			<button class="sp-tab on" data-tab="next">Up next <span class="sp-count"></span></button>
			<button class="sp-tab" data-tab="played">Played</button>
		</div>
		<div class="sp-now" hidden></div>
		<div class="scroll sp-list"></div>`;
	sp.now = $(".sp-now", body);
	sp.list = $(".sp-list", body);
	sp.count = $(".sp-count", body);
	body.querySelectorAll(".sp-tab").forEach((b) =>
		b.addEventListener("click", () => {
			if (S.edit) return;
			sp.tab = b.dataset.tab;
			body.querySelectorAll(".sp-tab").forEach((x) => x.classList.toggle("on", x === b));
			renderSession();
		})
	);
	sp.list.addEventListener("click", (e) => {
		if (S.edit) return;
		const btn = e.target.closest("[data-op]");
		if (!btn) return;
		const qid = btn.closest("[data-qid]")?.dataset.qid;
		if (!qid) return;
		if (!inLobby()) {
			if (btn.dataset.op === "remove") {
				const t = solo.next[Number(qid.slice(1))];
				if (t) cmd("removeFromQueue", { uri: t.uri, uid: t.uid }).catch(() => {});
			} else if (btn.dataset.op === "readd") {
				const h = solo.played.find((x) => x.qid === qid);
				if (h) cmd("addToQueue", { uri: h.uri }).then(() => toast(`Queued <b>${esc(h.name)}</b>`)).catch(() => {});
			}
			return;
		}
		if (btn.dataset.op === "play") api.lobbyQueuePlay(qid);
		else if (btn.dataset.op === "top") api.lobbyQueueTop(qid);
		else if (btn.dataset.op === "remove") api.lobbyQueueRemove(qid);
	});
}

function sessionRow(item, { index, host, mine, played }) {
	const ops = played
		? `<button class="icon-btn" data-op="readd" title="Add again">${ICON.plus}</button>`
		: [
				host ? `<button class="icon-btn" data-op="play" title="Play now">${ICON.play}</button>` : "",
				host && index > 0 ? `<button class="icon-btn" data-op="top" title="Play next">${ICON.top}</button>` : "",
				host || mine ? `<button class="icon-btn" data-op="remove" title="Remove">${ICON.close}</button>` : "",
			].join("");
	return `<div class="row sp-row" data-qid="${esc(item.qid)}" data-uri="${esc(item.uri)}">
		${played ? "" : `<span class="row-idx">${index + 1}</span>`}
		${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy" />` : `<span class="sp-noart">${ICON.note}</span>`}
		<div class="row-text">
			<div class="row-title">${esc(item.name)}</div>
			<div class="row-sub">${esc((item.artists || []).join(", "))}</div>
		</div>
		${item.by ? `<span class="sp-by" title="Added by ${esc(item.by)}">${esc(item.by)}</span>` : ""}
		<span class="sp-ops">${ops}</span>
	</div>`;
}

function renderSession() {
	updateNextButtons();
	const st = S.lobby;
	if (!sp.list) return;
	applyPanel("session");
	if (!inLobby() || !st) return renderSoloSession();
	const host = st.role === "host";
	const queue = st.queue || [];
	const history = st.history || [];
	sp.count.textContent = queue.length ? `· ${queue.length}` : "";
	// Now playing for everyone: from the session playlist (shows who added it) or the host's own song.
	const cur = st.current || st.now;
	if (cur) {
		const now = st.now && st.now.uri === cur.uri ? st.now : null;
		const sk = st.skip;
		const votes = sk ? `<span class="sp-votes" title="Voted to skip: ${esc(sk.voters.map((v) => v.name).join(", "))}">${ICON.noEntry}${sk.count}/${sk.need}</span>` : "";
		const need = sk ? sk.need : Math.max(1, Math.ceil((st.members?.length || 1) / 2));
		const title = sk?.mine ? "Take back your vote to skip" : `Vote to skip this song (${need} of ${st.members?.length || 1} needed)`;
		sp.now.hidden = false;
		sp.now.classList.toggle("voted", !!sk?.mine);
		sp.now.innerHTML = `<span class="sp-now-label">Now</span><span class="sp-now-title">${esc(cur.name || "")}</span>${votes}${now?.by ? `<span class="sp-by">${esc(now.by)}</span>` : ""}<button class="icon-btn sp-vote" title="${esc(title)}">${ICON.noEntry}</button>`;
		$(".sp-vote", sp.now).addEventListener("click", () => !S.edit && api.lobbyVoteSkip(!sk?.mine));
	} else sp.now.hidden = true;

	if (sp.tab === "next") {
		sp.list.innerHTML = queue.length
			? queue.map((q, i) => sessionRow(q, { index: i, host, mine: q.byId && q.byId === st.meId })).join("")
			: `<div class="empty-note">Nothing queued yet.<br />Click <b>+</b> on any song${host ? "" : ", or just click it,"} to add it for everyone.</div>`;
	} else {
		sp.list.innerHTML = history.length ? history.map((h) => sessionRow(h, { played: true })).join("") : `<div class="empty-note">Songs played in this session show up here.</div>`;
	}
	// "add again" from the history
	sp.list.querySelectorAll('[data-op="readd"]').forEach((b) =>
		b.addEventListener("click", () => {
			const h = history.find((x) => x.qid === b.closest("[data-qid]").dataset.qid);
			if (h && !S.edit) addToSession(h);
		})
	);
	markPlayingRows();
}

// ------------------------------------------------------------------ Lobby panel

const lb = {};

function buildLobby() {
	const body = buildPanel("lobby");
	body.innerHTML = `
		<div class="list-head"><span class="title">Listening lobby</span><span class="meta lb-relays"></span></div>
		<div class="lb">
			<div class="lb-out">
				<label class="lb-label" for="lb-name">Your name</label>
				<input type="text" id="lb-name" class="lb-input lb-name" maxlength="24" placeholder="What your friends see" spellcheck="false" />
				<label class="lb-label" for="lb-code">Lobby code</label>
				<div class="lb-coderow">
					<input type="text" id="lb-code" class="lb-input lb-code" maxlength="19" placeholder="Type one, or generate" spellcheck="false" />
					<button class="icon-btn lb-gen" title="Generate a random code">${ICON.dice}</button>
				</div>
				<button class="lb-btn primary lb-join">Join lobby</button>
				<div class="lb-error" hidden></div>
				<div class="lb-hint">Everyone with the same code listens together. The first one in hosts.</div>
			</div>
			<div class="lb-connecting" hidden><span class="spinner"></span><span class="lb-connecting-text">Connecting…</span><button class="lb-btn ghost small lb-cancel">Cancel</button></div>
			<div class="lb-in" hidden>
				<div class="lb-codebox">
					<span class="lb-codeval"></span>
					<button class="icon-btn lb-copy" title="Copy code">${ICON.copy}</button>
				</div>
				<div class="lb-role"></div>
				<div class="lb-members scroll"></div>
				<div class="lb-activity"></div>
				<button class="lb-btn ghost lb-leave">Leave lobby</button>
			</div>
		</div>`;
	Object.assign(lb, {
		relays: $(".lb-relays", body),
		out: $(".lb-out", body),
		name: $(".lb-name", body),
		code: $(".lb-code", body),
		join: $(".lb-join", body),
		error: $(".lb-error", body),
		connecting: $(".lb-connecting", body),
		connectingText: $(".lb-connecting-text", body),
		in: $(".lb-in", body),
		codeval: $(".lb-codeval", body),
		role: $(".lb-role", body),
		members: $(".lb-members", body),
		activity: $(".lb-activity", body),
	});

	const saveName = () => {
		const v = lb.name.value.trim();
		if (v !== (S.lobby?.name || "")) api.lobbySetName(v);
	};
	lb.name.addEventListener("change", saveName);
	lb.name.addEventListener("blur", saveName);

	const showError = (msg) => {
		lb.error.textContent = msg || "";
		lb.error.hidden = !msg;
	};

	async function join() {
		if (S.edit) return;
		showError("");
		const name = lb.name.value.trim();
		if (!name) {
			showError("Enter your name first.");
			return focusInput(lb.name);
		}
		if (name !== (S.lobby?.name || "")) await api.lobbySetName(name);
		const code = lb.code.value.trim();
		if (code.replace(/[^a-z0-9]/gi, "").length < 4) {
			showError("Lobby codes need at least 4 letters or numbers.");
			return focusInput(lb.code);
		}
		api.releaseFocus();
		const r = await api.lobbyJoin(code);
		if (!r.ok) showError(r.error);
	}

	lb.join.addEventListener("click", join);
	$(".lb-gen", body).addEventListener("click", async () => {
		if (S.edit) return;
		lb.code.value = await api.lobbyGenerate();
		showError("");
	});
	for (const input of [lb.name, lb.code]) {
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				if (input === lb.name) {
					saveName();
					focusInput(lb.code);
				} else join();
			} else if (e.key === "Escape") {
				input.blur();
				api.releaseFocus();
				e.stopPropagation();
			}
		});
	}
	$(".lb-copy", body).addEventListener("click", async () => {
		if (S.edit) return;
		const r = await api.lobbyCopy();
		if (!r) return;
		toast(r.forChat ? `Copied <b>${esc(r.text)}</b>. Paste it in WoW chat: with K-UI: Forever it's a link that copies the code.` : `Lobby code <b>${esc(r.text)}</b> copied`);
	});
	$(".lb-leave", body).addEventListener("click", () => !S.edit && api.lobbyLeave());
	$(".lb-cancel", body).addEventListener("click", () => !S.edit && api.lobbyLeave());
	lb.showError = showError;
}

// The Lobby panel grows (never shrinks) so up to 4 members fit without scrolling; with 5 or more
// the member list scrolls. It grows away from the screen edge it's nearest, like compact Now
// Playing, and only for as long as it needs to: the saved layout keeps your own size.
const LOBBY_ROWS = 4;
function fitLobby() {
	const p = panelEls.lobby;
	const st = S.lobby;
	if (!p || !lb.members || !S.layout) return;
	const r = rectOf("lobby");
	const reset = () => {
		lb.members.style.minHeight = "";
		p.style.top = r.y + "px";
		p.style.height = r.h + "px";
		p.classList.remove("grown");
	};
	if (S.edit || st?.status !== "joined" || !st.members?.length) return reset();
	const scale = S.layout.panels.lobby.scale ?? 1;
	const body = p.querySelector(".panel-body");
	const rowH = lb.members.querySelector(".lb-member")?.offsetHeight || 30;
	const want = Math.min(st.members.length, LOBBY_ROWS) * rowH + 4;
	lb.members.style.minHeight = want + "px";
	// how tall the content is with the members area at that size
	const flex = lb.members.style.flex;
	lb.members.style.flex = "none";
	lb.members.style.height = want + "px";
	p.style.height = r.h + "px";
	const need = Math.ceil(body.scrollHeight * scale);
	lb.members.style.flex = flex;
	lb.members.style.height = "";
	const h = Math.min(dispH, Math.max(r.h, need));
	const bottom = r.y + r.h / 2 > dispH / 2;
	p.style.height = h + "px";
	p.style.top = clamp(bottom ? r.y + r.h - h : r.y, 0, Math.max(0, dispH - h)) + "px";
	p.classList.toggle("grown", h > r.h); // grown over a neighbour: stay on top of it
}

function renderLobby() {
	updateAddAll();
	const st = S.lobby;
	if (!st || !lb.out) return;
	const joined = st.status === "joined";
	const connecting = st.status === "connecting";
	lb.out.hidden = joined || connecting;
	lb.connecting.hidden = !connecting;
	lb.in.hidden = !joined;
	if (document.activeElement !== lb.name) lb.name.value = st.name || "";
	if (st.status === "error" && st.error) lb.showError(st.error);

	const r = st.relays || { connected: 0, total: 0 };
	lb.relays.textContent = joined || connecting ? `${r.connected}/${r.total} relays` : "";
	lb.relays.classList.toggle("bad", (joined || connecting) && r.connected === 0);

	if (connecting) lb.connectingText.textContent = `Joining ${st.displayCode}…`;
	if (joined) {
		lb.codeval.textContent = st.displayCode;
		lb.role.innerHTML =
			st.role === "host"
				? `<b>You're hosting.</b> Share the code so friends can join.`
				: `Listening with <b>${esc(st.hostName || "the host")}</b>. Click a song to add it to the playlist.`;
		const fr = S.friends;
		const friendIds = new Set((fr?.friends || []).map((f) => f.fid));
		const pending = new Set(fr?.pendingAdds || []);
		lb.members.innerHTML = st.members
			.map((m) => {
				const tag = m.you ? '<span class="lb-you">you</span>' : friendIds.has(m.fid) ? `<span class="lb-friend" title="Your friend">${ICON.person}friend</span>` : pending.has(m.fid) ? '<span class="lb-you">request sent</span>' : "";
				const badge = m.role === "host" ? `<span class="av-badge crown" title="Host">${ICON.crown}</span>` : `<span class="av-badge dot"></span>`;
				return `<div class="lb-member${m.role === "host" ? " host" : ""}${m.you ? " you" : ""}" data-mid="${esc(m.id)}"${m.you ? "" : ' title="Right-click to add as a friend"'}>${avatarHtml(m.name, m.av, m.fid || m.id, badge, "small")}<span class="lb-mname">${esc(m.name)}</span>${tag}</div>`;
			})
			.join("");
		lb.activity.innerHTML = (st.activity || [])
			.slice(-2)
			.map((a) => `<div>${esc(a.text)}</div>`)
			.join("");
	}
	fitLobby();
	sendClickZone();
	sendHiddenArea();

	// badge on Now Playing + listener styling
	const p = panelEls.nowplaying;
	p?.classList.toggle("following", following());
	if (np.lobby) {
		np.lobby.hidden = !joined;
		np.lobby.textContent = !joined ? "" : st.role === "host" ? `Hosting · ${st.members.length}` : `With ${st.hostName || "host"}`;
		np.lobby.title = joined ? `Lobby ${st.displayCode}` : "";
	}
}

api.onLobby((st) => {
	S.lobby = st;
	renderLobby();
	renderSession();
});

// ------------------------------------------------------------------ right-click menu
// A small menu inside the panel that was right-clicked (it has to stay inside the panel: that's
// where Mercify takes clicks). items: [{ label, run, danger, disabled }]

let menuEl = null;
function closeMenu() {
	menuEl?.remove();
	menuEl = null;
}

function openMenu(panelId, x, y, items) {
	closeMenu();
	const panel = panelEls[panelId];
	if (!panel || !items.length) return;
	const m = el("div", "ctx-menu");
	for (const it of items) {
		const b = el("button", "ctx-item" + (it.danger ? " danger" : ""), esc(it.label));
		b.disabled = !!it.disabled;
		b.addEventListener("click", (e) => {
			e.stopPropagation();
			closeMenu();
			if (!it.disabled) it.run();
		});
		m.append(b);
	}
	panel.append(m);
	menuEl = m;
	const pr = panel.getBoundingClientRect();
	const scale = S.layout.panels[panelId].scale ?? 1;
	m.style.transform = `scale(${scale})`; // the same size as the panel's text
	m.style.transformOrigin = "0 0";
	const w = m.offsetWidth * scale;
	const h = m.offsetHeight * scale;
	m.style.left = clamp(x - pr.left, 4, Math.max(4, pr.width - w - 4)) + "px";
	m.style.top = clamp(y - pr.top, 4, Math.max(4, pr.height - h - 4)) + "px";
}

document.addEventListener("click", (e) => {
	if (menuEl && !e.target.closest?.(".ctx-menu")) closeMenu();
});
document.addEventListener("keydown", (e) => e.key === "Escape" && closeMenu());

document.addEventListener("contextmenu", (e) => {
	e.preventDefault();
	if (S.edit) return;
	const member = e.target.closest?.(".lb-member[data-mid]:not(.you)");
	const friend = e.target.closest?.(".fr-row[data-fid]");
	if (member) openMenu("lobby", e.clientX, e.clientY, memberMenu(member.dataset.mid));
	else if (friend) openMenu("friends", e.clientX, e.clientY, friendMenu(friend.dataset.fid));
	else closeMenu();
	// a right click without the click zone activated the overlay: hand the keyboard back
	clearTimeout(giveBackTimer);
	giveBackTimer = setTimeout(() => !document.activeElement?.matches?.('input[type="text"]') && api.giveBackFocus(), 120);
});

function memberMenu(mid) {
	const m = S.lobby?.members?.find((x) => x.id === mid);
	if (!m) return [];
	const f = S.friends?.friends?.find((x) => x.fid === m.fid);
	if (f) return [{ label: `${m.name} is your friend`, disabled: true }, { label: "Remove friend", danger: true, run: () => removeFriend(f) }];
	if (!m.fid) return [{ label: `${m.name} needs a newer Mercify to add friends`, disabled: true }];
	if ((S.friends?.pendingAdds || []).includes(m.fid)) return [{ label: "Friend request sent", disabled: true }];
	return [
		{
			label: "Add friend",
			run: async () => {
				const r = await api.friendsAdd(m.id);
				if (!r.ok) return toast(esc(r.error), "error");
				toast(r.data === "accepted" ? `You and <b>${esc(m.name)}</b> are now friends` : `Friend request sent to <b>${esc(m.name)}</b>`);
			},
		},
	];
}

function friendMenu(fid) {
	const f = S.friends?.friends?.find((x) => x.fid === fid);
	if (!f) return [];
	const items = [];
	if (f.requested) items.push({ label: "Cancel request to join", run: () => api.friendsCancelJoin(fid) });
	else if (f.joinable) items.push({ label: "Request to join", run: () => requestJoin(f) });
	items.push({ label: "Remove friend", danger: true, run: () => removeFriend(f) });
	return items;
}

async function removeFriend(f) {
	const r = await api.friendsRemove(f.fid);
	if (!r.ok) toast(esc(r.error), "error");
}

async function requestJoin(f) {
	const r = await api.friendsRequestJoin(f.fid);
	if (!r.ok) return toast(esc(r.error), "error");
	toast(`Asked to join <b>${esc(f.name)}</b>. Waiting for them to answer…`);
}

// ------------------------------------------------------------------ Friends panel

const fp = {};
const AVATAR_HUES = [145, 200, 265, 320, 25, 50, 175, 230];

function buildFriends() {
	const body = buildPanel("friends");
	body.innerHTML = `
		<div class="list-head"><span class="title">Friends</span><span class="meta fr-count"></span></div>
		<div class="fr-requests"></div>
		<div class="scroll fr-list"></div>`;
	fp.count = $(".fr-count", body);
	fp.requests = $(".fr-requests", body);
	fp.list = $(".fr-list", body);
	body.addEventListener("click", (e) => {
		if (S.edit) return;
		const b = e.target.closest("[data-op]");
		if (!b) return;
		const fid = b.closest("[data-fid]")?.dataset.fid;
		const f = S.friends?.friends?.find((x) => x.fid === fid);
		const op = b.dataset.op;
		if (op === "join" && f) requestJoin(f);
		else if (op === "cancel" && f) api.friendsCancelJoin(fid);
		else if (op === "accept-join" || op === "decline-join") answerJoin(fid, op === "accept-join");
		else if (op === "accept-add" || op === "decline-add") api.friendsAnswerAdd(fid, op === "accept-add");
	});
}

// A round profile picture (or the name's first letter on a colour; a transparent picture is
// shown uncropped instead), with a badge in the lower-right corner: the online dot, or the host's crown.
function avatarHtml(name, av, seed, badge = "", size = "") {
	const hue = AVATAR_HUES[parseInt(String(seed || "00").slice(0, 2), 16) % AVATAR_HUES.length || 0];
	const face = av && /^data:image\/(jpeg|png|webp);base64,/.test(av) ? `<img src="${esc(av)}" alt="" />` : esc((name || "?").trim().charAt(0).toUpperCase() || "?");
	// A PNG is a picture with a transparent background: shown as it is, without the disc behind it.
	const clear = av && av.startsWith("data:image/png;") ? " clear" : "";
	return `<span class="av${size ? " " + size : ""}" style="--hue:${hue}"><span class="av-face${clear}">${face}</span>${badge}</span>`;
}

function avatar(f) {
	return avatarHtml(f.name, f.av, f.fid, '<span class="av-badge dot fr-status"></span>');
}

function ago(t) {
	const m = Math.round((Date.now() - t) / 60000);
	return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

// The line under a friend's name: the song they're on, or what they're up to.
function friendLine(f) {
	if (!f.online) return f.lastSeen ? `Offline · seen ${ago(f.lastSeen)}` : "Offline";
	if (f.track) {
		const song = `${esc(f.track.name)}${f.track.artists?.length ? ` · ${esc(f.track.artists.join(", "))}` : ""}`;
		return `<span class="fr-note${f.playing ? " on" : ""}">${ICON.note}</span>${f.playing ? "" : "Paused: "}${song}`;
	}
	if (f.inLobby) return f.host ? "Hosting a listening lobby" : "In a listening lobby";
	return f.shared === false ? "Online" : "Online, nothing playing";
}

function friendButton(f) {
	if (!f.online) return "";
	if (f.requested) return `<button class="pill-btn fr-btn waiting" data-op="cancel" title="Cancel your request">Requested…</button>`;
	if (!f.joinable) return "";
	return `<button class="pill-btn fr-btn" data-op="join" title="${f.cooldown ? "Wait a moment before asking again" : `Ask ${esc(f.name)} to listen together`}"${f.cooldown ? " disabled" : ""}>${ICON.join}<span>Request to join</span></button>`;
}

function renderFriends() {
	const st = S.friends;
	if (!fp.list || !st) return;
	const list = st.friends || [];
	const online = list.filter((f) => f.online).length;
	fp.count.textContent = list.length ? `${online} online` : "";
	fp.requests.innerHTML = (st.requests || [])
		.map(
			(r) => `<div class="fr-req" data-fid="${esc(r.fid)}">
				<span class="fr-req-text"><b>${esc(r.name)}</b> ${r.kind === "join" ? "wants to listen with you" : "sent a friend request"}</span>
				<button class="pill-btn" data-op="accept-${r.kind}">Accept</button>
				<button class="pill-btn ghost" data-op="decline-${r.kind}">Decline</button>
			</div>`
		)
		.join("");
	fp.list.innerHTML = list.length
		? list
				.map(
					(f) => `<div class="row fr-row${f.online ? " online" : ""}${f.inLobby ? " in-lobby" : ""}" data-fid="${esc(f.fid)}">
						${avatar(f)}
						<div class="row-text">
							<div class="row-title">${esc(f.name)}</div>
							<div class="row-sub">${friendLine(f)}</div>
						</div>
						${friendButton(f)}
					</div>`
				)
				.join("")
		: `<div class="empty-note">No friends yet.<br />In a listening lobby, right-click someone and choose <b>Add friend</b>.</div>`;
	updateRequestNotices();
}

async function answerJoin(fid, accept) {
	const f = S.friends?.friends?.find((x) => x.fid === fid);
	if (accept && !inLobby()) toast(`Starting a lobby for you and <b>${esc(f?.name || "your friend")}</b>…`);
	const r = await api.friendsAnswerJoin(fid, accept);
	if (r.ok && accept && inLobby()) toast(`<b>${esc(f?.name || "Your friend")}</b> is joining your lobby`);
}

// Requests also pop up in the Notifications panel, with the same buttons.
function updateRequestNotices() {
	const keep = new Set();
	for (const r of S.friends?.requests || []) {
		const key = `${r.kind}:${r.fid}`;
		keep.add(key);
		if (r.kind === "join")
			actionToast(key, `<b>${esc(r.name)}</b> wants to listen with you${inLobby() ? "" : ". Accepting starts a lobby."}`, [
				{ label: "Accept", primary: true, run: () => answerJoin(r.fid, true) },
				{ label: "Decline", run: () => answerJoin(r.fid, false) },
			]);
		else
			actionToast(key, `<b>${esc(r.name)}</b> sent you a friend request`, [
				{ label: "Accept", primary: true, run: () => api.friendsAnswerAdd(r.fid, true) },
				{ label: "Decline", run: () => api.friendsAnswerAdd(r.fid, false) },
			]);
	}
	dismissActionToasts(keep);
}

api.onFriends((st) => {
	S.friends = st;
	renderFriends();
	renderLobby(); // "friend" tags on lobby members
});

// "Offline · seen 5 min ago" ages by itself
setInterval(() => S.friends?.friends?.some((f) => !f.online && f.lastSeen) && renderFriends(), 60000);

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
	panelEls.nowplaying?.classList.toggle("connected", !!connected);
	if (connected && !was) onConnected();
	if (!connected) {
		renderPlayer();
		pl.list.innerHTML = '<div class="empty-note">Waiting for Spotify…</div>';
	}
});

api.onBridge((msg) => {
	if (msg.type === "state") {
		notePlayed(S.player, msg.state);
		S.player = msg.state;
		renderPlayer();
	} else if (msg.type === "queue") {
		solo.next = Array.isArray(msg.next) ? msg.next : [];
		if (!inLobby()) renderSession();
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
		closeMenu();
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
api.onZoneState(({ on }) => {
	S.zone = on;
	zoneReset();
});
api.onZoneMouse(zoneMouse);
api.onToast(({ text, kind }) => toast(esc(text), kind || "", 5000));

api.onViewport(({ x, y, dw, dh, seq }) => {
	const resized = dw !== dispW || dh !== dispH;
	view.x = x;
	view.y = y;
	dispW = dw;
	dispH = dh;
	const b = document.body.style;
	b.width = dw + "px";
	b.height = dh + "px";
	b.transform = x || y ? `translate(${-x}px, ${-y}px)` : "";
	if (resized && S.layout) {
		for (const id of Object.keys(S.layout.panels)) clampPanel(id);
		applyAll();
	} else sendClickZone(); // the panels moved within the window
	requestAnimationFrame(() => api.viewportApplied(seq));
});

window.addEventListener("resize", () => {
	if (!S.layout) return;
	for (const id of Object.keys(S.layout.panels)) clampPanel(id);
	applyAll();
});

// ------------------------------------------------------------------ boot

(async function boot() {
	const saved = await api.loadLayout();
	const base = defaultLayout();
	S.layout = saved && saved.version === 1 ? { ...base, ...saved, panels: { ...base.panels } } : base;
	if (saved?.panels) for (const id of Object.keys(PANELS)) if (saved.panels[id]) S.layout.panels[id] = { ...base.panels[id], ...saved.panels[id] };
	for (const id of Object.keys(S.layout.panels)) clampPanel(id);
	$("#snap-toggle").checked = !!S.layout.snap;

	buildNowPlaying();
	buildPlaylist();
	buildSearch();
	buildNotices();
	buildSession();
	buildLobby();
	buildFriends();
	S.lobby = await api.lobbyGet();
	S.friends = await api.friendsGet();
	renderLobby();
	renderFriends();
	renderSession();
	bindPopover();
	applyAll();
	renderPlayer();
	// A few times a second, not every frame: repainting the overlay at the monitor's refresh rate
	// costs the game frames for a bar that moves a pixel or so a second.
	setInterval(tick, 250);

	const info = await api.getInfo();
	const k = (a) => (a ? `<kbd>${esc(a.replace("Control", "Ctrl"))}</kbd>` : "");
	if (info.failedHotkeys?.length) {
		toast(`Couldn't register hotkeys: ${esc(info.failedHotkeys.join(", "))}. Another app may be using them; change them in Settings, under Hotkeys.`, "error", 8000);
	} else {
		toast(`Mercify is running · ${k(info.hotkeys.toggle)} show/hide · ${k(info.hotkeys.edit)} Edit Mode · ${k(info.hotkeys.search)} search`, "", 6000);
	}
	if (info.connected && !S.connected) {
		S.connected = true;
		onConnected();
	}
})();
