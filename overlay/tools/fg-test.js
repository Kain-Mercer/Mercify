// Tests foreground.js down its real Windows path (spawn, "anchor <hwnd>" on stdin, JSON lines on
// stdout) against tools/fg-fakehelper.js, which speaks fgwatch.exe's protocol. Runs on any OS:
//   node tools/fg-test.js
// (1.6.0 shipped with the Windows path dropping hwnd/mon/anchor; the debug-file tests missed it.)
// main.js's gate rule is applied to what it reports.
const fs = require("fs"), path = require("path"), Module = require("module");
const SCENE = path.join(require("os").tmpdir(), "mercify-fg-scene-" + process.pid + ".json");
Object.defineProperty(process, "platform", { value: "win32" });
const cp = require("child_process"); const realSpawn = cp.spawn;
cp.spawn = (exe, args, opts) => realSpawn(process.execPath, [path.join(__dirname, "fg-fakehelper.js"), SCENE], { stdio: opts.stdio });
const origLoad = Module._load;
Module._load = function (req, ...r) { return req === "electron" ? { app: { isPackaged: false } } : origLoad.call(this, req, ...r); };
const fsx = require("fs"); const ex = fsx.existsSync; fsx.existsSync = (p) => (String(p).endsWith("fgwatch.exe") ? true : ex(p));
const fg = require("../foreground");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WOW = { pid: 222, hwnd: 900, exe: "Wow.exe", title: "World of Warcraft" }, CHROME = { pid: 111, hwnd: 500, exe: "chrome.exe", title: "Chrome" };
const scene = (f, wow, chromeMon = 2) => fs.writeFileSync(SCENE, JSON.stringify({ fg: f, windows: { 900: { alive: 1, mon: 1, iconic: 0, visible: 1, ...wow }, 500: { alive: 1, mon: chromeMon, iconic: 0, visible: 1 } } }));
// main.js's rule
let gameInFront = false;
const gate = () => { const f = fg.getForeground(); if (!f) return "no report"; const isGame = f.exe === "Wow.exe"; gameInFront = isGame; if (isGame && f.hwnd) fg.setAnchor(f.hwnd); if (isGame) return "show (game)"; const a = f.anchor; return a && a.up && a.mon !== f.mon ? "show (other monitor)" : "hide"; };
let fails = 0;
const step = async (label, want, setup) => { setup(); await sleep(500); gate(); await sleep(500); const got = gate(); const f = fg.getForeground(); console.log(`${got === want ? "PASS" : "FAIL"}  ${label}: ${got}   [hwnd ${f?.hwnd} mon ${f?.mon} anchor ${JSON.stringify(f?.anchor)}]`); if (got !== want) fails++; };
(async () => {
	scene(CHROME, {}); fg.start(); await sleep(600);
	await step("browser, game never in front", "hide", () => scene(CHROME, {}));
	await step("WoW in front", "show (game)", () => scene(WOW, {}));
	await step("browser on the other monitor", "show (other monitor)", () => scene(CHROME, {}));
	await step("browser dragged onto the game's monitor", "hide", () => scene(CHROME, {}, 1));
	await step("game minimised", "hide", () => scene(CHROME, { iconic: 1 }));
	await step("game restored", "show (other monitor)", () => scene(CHROME, {}));
	await step("game closed", "hide", () => scene(CHROME, { alive: 0, visible: 0 }));
	console.log(fails ? `${fails} FAILED` : "ALL PASSED"); fg.stop(); try { fs.unlinkSync(SCENE); } catch {} process.exit(fails ? 1 : 0);
})();
