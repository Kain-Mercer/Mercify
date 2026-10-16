// Loaded first (index.js): what overlay/lobby.js and friends.js expect from Node.
import "react-native-get-random-values"; // crypto.getRandomValues, for src/node-crypto.js
import { Buffer } from "buffer";
import fixBuffer from "./buffer-fix";

fixBuffer(Buffer); // subarray() must stay a Buffer, as in Node

global.Buffer = Buffer; // ours (fixed above), even if something set one already
if (!global.process) global.process = { env: {} };
if (!global.process.env) global.process.env = {};
if (!global.process.nextTick) global.process.nextTick = (fn, ...args) => setTimeout(() => fn(...args), 0);
