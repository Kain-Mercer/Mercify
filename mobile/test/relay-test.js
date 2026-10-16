// Relay test: the phone's real network stack (mqtt's React Native build through src/mqtt.js,
// src/node-crypto.js, the npm "buffer" package as Buffer, overlay/lobby.js) and the PC's (Node's
// mqtt, crypto and Buffer) in one lobby, through a real MQTT-over-WebSocket broker on this machine.
//
//   node mobile/test/relay-test.js
const path = require("path"), fs = require("fs"), os = require("os"), Module = require("module");
const ROOT = path.resolve(__dirname, "../..");
const B = path.join(ROOT, "mobile/node_modules");
const aedesMod = require(path.join(B, "aedes"));
const { WebSocketServer, createWebSocketStream } = require(path.join(B, "ws"));
(async () => {
  const aedes = typeof aedesMod.createBroker === "function" ? await aedesMod.createBroker() : (aedesMod.Aedes ? await aedesMod.Aedes.createBroker() : aedesMod());
  const wss = new WebSocketServer({ port: 18883, path: "/mqtt" });
  wss.on("connection", (ws) => aedes.handle(createWebSocketStream(ws)));
  const RELAY = "ws://127.0.0.1:18883/mqtt";

  // phone copy: crypto -> shim, mqtt -> mobile/src/mqtt.js (the RN build)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phone-"));
  // as on the phone: the global Buffer is the npm "buffer" package (src/polyfills.js)
  for (const f of ["lobby.js", "friends.js"]) fs.writeFileSync(path.join(dir, f), 'const Buffer = require("npm-buffer").Buffer;\n' + fs.readFileSync(path.join(ROOT, "overlay", f), "utf8"));
  const NPM_BUFFER = path.join(ROOT, "mobile/node_modules/buffer/index.js");
  const res = Module._resolveFilename;
  Module._resolveFilename = function (r, parent, ...rest) {
    const from = parent && parent.filename;
    if (r === "npm-buffer") return NPM_BUFFER;
    if (from && (from.startsWith(dir) || from.startsWith(path.join(ROOT, "mobile/src"))) && r === "buffer") return NPM_BUFFER;
    if (from && from.startsWith(dir) && r === "crypto") return path.join(ROOT, "mobile/src/node-crypto.js");
    if (from && from.startsWith(dir) && r === "mqtt") return path.join(ROOT, "mobile/src/mqtt.js");
    if (from && from.startsWith(path.join(ROOT, "overlay")) && r === "mqtt") return require.resolve("mqtt", { paths: [path.join(ROOT, "mobile")] });
    if (from && from.startsWith(path.join(ROOT, "mobile/src")) && r === "mqtt") return path.join(ROOT, "mobile/node_modules/mqtt/dist/mqtt.esm.js");
    return res.call(this, r, parent, ...rest);
  };
  Object.defineProperty(globalThis, "navigator", { value: { product: "ReactNative" }, configurable: true, writable: true });
  const phoneMqtt = require(path.join(ROOT, "mobile/src/mqtt.js"));
  console.log("phone mqtt connect:", typeof phoneMqtt.connect);
  const phoneLobbyMod = require(path.join(dir, "lobby.js"));
  const pcLobbyMod = require(path.join(ROOT, "overlay/lobby.js"));
  const pcMqtt = require(require.resolve("mqtt", { paths: [path.join(ROOT, "mobile")] }));

  const played = [];
  const pc = pcLobbyMod.createLobby({ command: async () => {}, relays: [RELAY], connect: pcMqtt.connect, connectTimeoutMs: 4000 });
  const phone = phoneLobbyMod.createLobby({ command: async (a, x) => { played.push(a + " " + (x && (x.uri || x.ms))); }, relays: [RELAY], connect: phoneMqtt.connect, connectTimeoutMs: 4000, log: (m) => console.log("  phone:", m) });
  pc.setName("PC"); phone.setName("Phone");
  await pc.join("TEST-1234");
  await phone.join("TEST-1234");
  const until = async (f, ms = 6000) => { const e = Date.now() + ms; while (Date.now() < e) { if (f()) return true; await new Promise((r) => setTimeout(r, 50)); } return !!f(); };
  const ok1 = await until(() => phone.state().members.length === 2 && pc.state().members.length === 2);
  console.log(ok1 ? "PASS" : "FAIL", " phone (RN mqtt build) and PC see each other through a real broker", phone.state().relays);
  pc.onPlayerState({ uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", name: "Song", artists: ["A"], duration: 200000, position: 30000, isPlaying: true, at: Date.now() });
  const ok2 = await until(() => played.some((p) => p.startsWith("playTrack spotify:track:4uLU6hMCjMI75M1A2tKUQC")) && played.some((p) => p.startsWith("seek")));
  console.log(ok2 ? "PASS" : "FAIL", " phone follows the PC's song and seeks", JSON.stringify(played));
  await phone.leave?.(); await pc.leave?.();
  process.exit(ok1 && ok2 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
