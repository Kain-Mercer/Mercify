// mqtt for overlay/lobby.js and overlay/friends.js on the phone: the package's React Native
// build (WebSockets, no Node streams), which only has a default export.
//
// That build delivers messages as its own bundled copy of Buffer. lobby.js and friends.js drop
// anything Buffer.isBuffer() says no to, so payloads are handed on as the app's Buffer.
const { Buffer } = require("buffer");
const m = require("mqtt");
const mqtt = m && m.default ? m.default : m;

function connect(url, opts) {
	const client = mqtt.connect(url, opts);
	const on = client.on.bind(client);
	client.on = (event, fn) => (event === "message" ? on(event, (topic, payload, packet) => fn(topic, Buffer.from(payload), packet)) : on(event, fn));
	return client;
}

module.exports = { ...mqtt, connect };
