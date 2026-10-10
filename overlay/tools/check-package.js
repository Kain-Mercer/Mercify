// Fails if the packaged app is missing a file that its code require()s.
// (1.4.0 shipped without lobby.js and crashed on start; this would have caught it.)
//   node tools/check-package.js dist/win-unpacked/resources/app.asar

const asar = require("@electron/asar");
const path = require("path");

const archive = process.argv[2] || "dist/win-unpacked/resources/app.asar";
const files = new Set(asar.listPackage(archive).map((f) => f.replace(/\\/g, "/")));
const has = (p) => files.has(p) || files.has(p + ".js") || files.has(p + "/index.js") || files.has(p + ".json");

let missing = 0;
let checked = 0;
for (const file of files) {
	if (!file.endsWith(".js") || file.startsWith("/node_modules/")) continue;
	const src = asar.extractFile(archive, file.slice(1)).toString("utf8");
	for (const m of src.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
		checked++;
		const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
		if (!has(target)) {
			console.error(`MISSING  ${file} requires ${m[1]} (${target}) but it isn't in the package`);
			missing++;
		}
	}
	for (const m of src.matchAll(/require\(\s*["']([^./"'][^"']*)["']\s*\)/g)) {
		const name = m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : m[1].split("/")[0];
		if (["electron", "fs", "path", "os", "crypto", "events", "child_process", "util", "url", "http", "https", "net", "zlib", "stream", "assert", "readline"].includes(name)) continue;
		checked++;
		if (!files.has(`/node_modules/${name}/package.json`)) {
			console.error(`MISSING  ${file} requires the package "${name}" but it isn't in the package`);
			missing++;
		}
	}
}
console.log(`${checked} requires checked in ${archive}: ${missing ? missing + " missing" : "all present"}`);
process.exit(missing ? 1 : 0);
