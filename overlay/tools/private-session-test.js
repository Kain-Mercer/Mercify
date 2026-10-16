// Private-session test: loads the real spicetify/overlay-bridge.js in a sandbox with a fake
// Spotify client, and drives it through the same WebSocket command path Mercify uses
// (privateSession / isPrivateSession / detectPrivateSession). Covers the client shapes the bridge
// has to cope with, since where Spotify keeps the switch differs between versions.
//
//   node tools/private-session-test.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "..", "spicetify", "overlay-bridge.js"), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  (" + detail + ")" : ""}`);
	if (!ok) failures++;
};

// A fake product-state service holding `pairs`.
function fakeProductState(pairs) {
	return {
		pairs,
		writes: [],
		async getValues() {
			return { pairs: { ...this.pairs } };
		},
		async putValues({ pairs: p }) {
			this.writes.push(p);
			Object.assign(this.pairs, p);
		},
	};
}

// Boot the bridge against `platform`; returns call(action, args) -> reply data.
async function boot(platform) {
	let sock = null;
	const timers = [];
	class FakeWS {
		static OPEN = 1;
		constructor() {
			this.readyState = 1;
			this.sent = [];
			sock = this;
			setTimeout(() => this.onopen && this.onopen(), 0);
		}
		send(s) {
			this.sent.push(JSON.parse(s));
		}
		close() {}
	}
	const ctx = {
		console: { log() {}, warn() {}, error() {} },
		setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)),
		clearTimeout,
		setInterval: (f, ms) => (timers.push(f), 0), // never fire on their own
		clearInterval() {},
		localStorage: { getItem: () => null, setItem() {} },
		WebSocket: FakeWS,
		Date,
		JSON,
		Promise,
		Object,
		Array,
		Set,
		Map,
		Number,
		String,
		Math,
		Error,
	};
	ctx.window = ctx;
	ctx.Spicetify = {
		Player: { data: {}, addEventListener() {}, getProgress: () => 0, isPlaying: () => false },
		Platform: platform,
		CosmosAsync: { get: async () => ({}) },
	};
	vm.createContext(ctx);
	vm.runInContext(SRC, ctx);
	for (let i = 0; i < 50 && !sock; i++) await new Promise((r) => setTimeout(r, 5));
	let id = 0;
	return async function call(action, args = {}) {
		const myId = ++id;
		await sock.onmessage({ data: JSON.stringify({ type: "cmd", id: myId, action, args }) });
		const r = sock.sent.find((m) => m.type === "reply" && m.id === myId);
		if (!r) throw new Error("no reply for " + action);
		if (!r.ok) throw new Error(r.error);
		return r.data;
	};
}

(async () => {
	// A: the switch is a product-state key stored as "true"/"false" — must be written in that format.
	{
		const ps = fakeProductState({ "private-session": "false", "type": "free" });
		const call = await boot({ UserAPI: { _product_state: ps } });
		const r = await call("privateSession", { on: true });
		check("A: finds the product-state key", r.ok && r.via === "productState:private-session", r.via);
		check('A: writes "true", matching the client\'s format (not "1")', ps.writes[0] && ps.writes[0]["private-session"] === "true", JSON.stringify(ps.writes[0]));
		check("A: reports it was off before", r.prev === false, String(r.prev));
		const now = await call("isPrivateSession");
		check("A: reads back on", now.on === true);
		await call("privateSession", { on: false });
		check('A: turning off writes "false"', ps.pairs["private-session"] === "false");
	}
	// B: product-state key stored as "1"/"0".
	{
		const ps = fakeProductState({ "incognito-mode": "0" });
		const call = await boot({ UserAPI: { _product_state: ps } });
		await call("privateSession", { on: true });
		check('B: "1"/"0" key gets "1"', ps.pairs["incognito-mode"] === "1", ps.pairs["incognito-mode"]);
	}
	// C: a dedicated Platform namespace with a setter and getter — preferred over product state.
	{
		let on = false;
		const api = { setPrivateSession: async (v) => (on = !!v), isPrivateSession: async () => on };
		const ps = fakeProductState({ "private-session": "0" });
		const call = await boot({ PrivateSessionAPI: api, UserAPI: { _product_state: ps } });
		const r = await call("privateSession", { on: true });
		check("C: uses the dedicated namespace's setter", r.via === "Platform.PrivateSessionAPI.setPrivateSession", r.via);
		check("C: really turned it on", on === true);
		check("C: product state left alone", ps.writes.length === 0);
		const now = await call("isPrivateSession");
		check("C: reads back through the namespace's getter", now.on === true && /isPrivateSession/.test(now.via), JSON.stringify(now));
	}
	// D: toggle-only API — must not flip it off when it's already on.
	{
		let on = true;
		const api = { togglePrivateSession: async () => (on = !on), isPrivateSession: async () => on };
		const call = await boot({ PrivateSessionAPI: api });
		await call("privateSession", { on: true });
		check("D: toggle-only API leaves an already-on session on", on === true);
		await call("privateSession", { on: false });
		check("D: and toggles it off when asked", on === false);
	}
	// E: nothing private anywhere — a clear "not found", no writes.
	{
		const ps = fakeProductState({ "type": "free", "ads": "1" });
		const call = await boot({ UserAPI: { _product_state: ps } });
		const r = await call("privateSession", { on: true });
		check("E: nothing to find -> ok:false", r.ok === false, r.reason);
		check("E: wrote nothing", ps.writes.length === 0);
		const now = await call("isPrivateSession");
		check("E: reads as unknown (null), not off", now.on === null);
	}
	// G: the real-world shape from Kain's client — a dedicated setter, a getCapabilities() that is
	// NOT a state getter, and only an "incognito_mode_timeout" product key. We must still set via the
	// setter, must NOT treat getCapabilities as the state, and must report state as unknown (null)
	// rather than trusting the timeout key.
	{
		let on = false;
		const api = { setPrivateSession: async (v) => (on = !!v), getCapabilities: async () => ({ canChange: true }) };
		const ps = fakeProductState({ incognito_mode_timeout: "1", "list-private-by-default": "0" });
		const call = await boot({ PrivateSessionAPI: api, UserAPI: { _product_state: ps } });
		const r = await call("privateSession", { on: true });
		check("G: sets via the dedicated setter", r.via === "Platform.PrivateSessionAPI.setPrivateSession", r.via);
		check("G: actually turned it on", on === true);
		check("G: did not write the timeout product key", ps.writes.length === 0, JSON.stringify(ps.writes));
		const now = await call("isPrivateSession");
		check("G: state reads as unknown (not a false 'on' from the timeout key)", now.on === null, JSON.stringify(now));
	}

	// F: the detector lists what's there without changing anything.
	{
		const ps = fakeProductState({ "private-session": "true", "social-x": "1" });
		const call = await boot({ UserAPI: { _product_state: ps, isIncognito: () => true }, RootlistAPI: {} });
		const d = await call("detectPrivateSession");
		check("F: detector reports the key and value", d.productStateKeys.some((k) => k.key === "private-session" && k.value === "true"));
		check("F: detector lists Platform namespaces", d.allNamespaces.includes("RootlistAPI"));
		check("F: detector finds a private-named UserAPI method", d.userApiMethods.includes("isIncognito"));
		check("F: detector changed nothing", ps.writes.length === 0);
	}

	console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
	process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
