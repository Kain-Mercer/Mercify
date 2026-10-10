// Speaks fgwatch's protocol: JSON lines out, "anchor <hwnd>" lines in.
// The scene is read from scene.json each tick: { fg: {pid,hwnd,exe,title}, windows: {hwnd:{iconic,visible,mon,alive}} }
const fs = require("fs");
let anchor = 0, inbuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { inbuf += d; let i; while ((i = inbuf.indexOf("\n")) >= 0) { const l = inbuf.slice(0, i); inbuf = inbuf.slice(i + 1); if (l.startsWith("anchor ")) anchor = Number(l.slice(7)); } });
setInterval(() => {
	let sc; try { sc = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { return; }
	const w = (h) => sc.windows[h] || { alive: 0, iconic: 0, visible: 0, mon: 0 };
	const f = sc.fg;
	let line = `{"pid":${f.pid},"hwnd":${f.hwnd},"mon":${w(f.hwnd).mon},"exe":${JSON.stringify(f.exe)},"title":${JSON.stringify(f.title)}`;
	if (anchor) { const a = w(anchor); line += `,"anchor":{"hwnd":${anchor},"alive":${a.alive ?? 1},"iconic":${a.iconic},"visible":${a.visible},"mon":${a.mon}}`; }
	process.stdout.write(line + "}\n");
}, 150);
