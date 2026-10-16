// Loaded first (index.js): what overlay/lobby.js and friends.js expect from Node.
import "react-native-get-random-values"; // crypto.getRandomValues, for src/node-crypto.js
import { Buffer } from "buffer";

if (!global.Buffer) global.Buffer = Buffer;
if (!global.process) global.process = { env: {} };
if (!global.process.env) global.process.env = {};
if (!global.process.nextTick) global.process.nextTick = (fn, ...args) => setTimeout(() => fn(...args), 0);
