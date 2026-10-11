// Speaks fgwatch's protocol: JSON lines out, "anchor <hwnd>" lines in.
// The scene is read from scene.json each tick: { fg: {pid,hwnd,exe,title}, windows: {hwnd:{iconic,visible,mon,alive}} }
const fs = require("fs");
let anchor = 0, inbuf = "", activated = 0, lastScene = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { inbuf += d; let i; while ((i = inbuf.indexOf("\n")) >= 0) { const l = inbuf.slice(0, i); inbuf = inbuf.slice(i + 1); if (l.startsWith("anchor ")) anchor = Number(l.slice(7)); else if (l.startsWith("activate ")) activated = Number(l.slice(9)); } });
setInterval(() => {
	let raw, sc; try { raw = fs.readFileSync(process.argv[2], "utf8"); sc = JSON.parse(raw); } catch { return; }
	if (raw !== lastScene) { lastScene = raw; activated = 0; } // a new scene overrides an earlier activate
	// "activate <hwnd>" brings that window to the front, like the real helper (until the scene changes)
	if (activated && sc.windows[activated]) sc.fg = { ...(sc.windowsInfo?.[activated] || {}), hwnd: activated, pid: sc.windowsInfo?.[activated]?.pid ?? 0 };
	const w = (h) => sc.windows[h] || { alive: 0, iconic: 0, visible: 0, mon: 0 };
	const f = sc.fg;
	let line = `{"pid":${f.pid},"hwnd":${f.hwnd},"mon":${w(f.hwnd).mon},"exe":${JSON.stringify(f.exe)},"title":${JSON.stringify(f.title)},"cls":${JSON.stringify(f.cls || "")}`;
	if (anchor) { const a = w(anchor); line += `,"anchor":{"hwnd":${anchor},"alive":${a.alive ?? 1},"iconic":${a.iconic},"visible":${a.visible},"mon":${a.mon}}`; }
	process.stdout.write(line + "}\n");
}, 150);
