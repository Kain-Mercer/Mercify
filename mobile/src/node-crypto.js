// Node's `crypto`, as much of it as overlay/lobby.js and overlay/friends.js use, built on the
// audited @noble libraries so those two files run unchanged on the phone (Metro maps
// require("crypto") here, see metro.config.js). Everything must match Node byte for byte, or
// phones and PCs can't read each other's lobby messages: mobile/test/crypto-compat-test.js
// checks every function against Node's own, and runs a phone and a PC in one lobby.

const { Buffer } = require("buffer");
const { sha256 } = require("@noble/hashes/sha2.js");
const { scryptAsync } = require("@noble/hashes/scrypt.js");
const { hkdf } = require("@noble/hashes/hkdf.js");
const { gcm } = require("@noble/ciphers/aes.js");
const { x25519 } = require("@noble/curves/ed25519.js");

const utf8 = (v) => (typeof v === "string" ? new Uint8Array(Buffer.from(v, "utf8")) : new Uint8Array(v));

function randomBytes(n) {
	const out = new Uint8Array(n);
	globalThis.crypto.getRandomValues(out);
	return Buffer.from(out);
}

function createHash(alg) {
	if (alg !== "sha256") throw new Error(`node-crypto: hash ${alg} isn't supported`);
	const h = sha256.create();
	const api = {
		update(data, enc) {
			h.update(typeof data === "string" ? new Uint8Array(Buffer.from(data, enc || "utf8")) : new Uint8Array(data));
			return api;
		},
		digest(enc) {
			const b = Buffer.from(h.digest());
			return enc ? b.toString(enc) : b;
		},
	};
	return api;
}

function scrypt(password, salt, keylen, opts, cb) {
	if (typeof opts === "function") (cb = opts), (opts = {});
	const { N = 16384, r = 8, p = 1 } = opts || {};
	scryptAsync(utf8(password), utf8(salt), { N, r, p, dkLen: keylen, asyncTick: 10 }).then(
		(k) => cb(null, Buffer.from(k)),
		(e) => cb(e)
	);
}

// AES-256-GCM in Node's streaming shape. Lobby messages are small, so it collects everything
// and does the work in final().
function gcmStream(decrypt, alg, key, iv) {
	if (alg !== "aes-256-gcm") throw new Error(`node-crypto: cipher ${alg} isn't supported`);
	const parts = [];
	let tag = null;
	return {
		update(data, enc) {
			parts.push(typeof data === "string" ? Buffer.from(data, enc || "utf8") : Buffer.from(data));
			return Buffer.alloc(0);
		},
		setAuthTag(t) {
			tag = Buffer.from(t);
		},
		getAuthTag() {
			if (!tag) throw new Error("node-crypto: no auth tag before final()");
			return tag;
		},
		final() {
			const c = gcm(new Uint8Array(key), new Uint8Array(iv));
			const data = Buffer.concat(parts);
			if (decrypt) {
				if (!tag) throw new Error("Unsupported state or unable to authenticate data");
				return Buffer.from(c.decrypt(new Uint8Array(Buffer.concat([data, tag])))); // throws if tampered
			}
			const out = Buffer.from(c.encrypt(new Uint8Array(data))); // ciphertext, then the 16-byte tag
			tag = out.subarray(out.length - 16);
			return out.subarray(0, out.length - 16);
		},
	};
}
const createCipheriv = (alg, key, iv) => gcmStream(false, alg, key, iv);
const createDecipheriv = (alg, key, iv) => gcmStream(true, alg, key, iv);

// X25519 keys, exported and imported as the same DER Node uses: a fixed prefix, then 32 bytes.
const SPKI = Buffer.from("302a300506032b656e032100", "hex");
const PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");

function keyObject(type, raw) {
	return {
		type,
		asymmetricKeyType: "x25519",
		raw: Buffer.from(raw),
		export({ type: fmt, format }) {
			if (format !== "der") throw new Error("node-crypto: only DER export is supported");
			if (type === "public" && fmt === "spki") return Buffer.concat([SPKI, this.raw]);
			if (type === "private" && fmt === "pkcs8") return Buffer.concat([PKCS8, this.raw]);
			throw new Error(`node-crypto: can't export a ${type} key as ${fmt}`);
		},
	};
}

function fromDer(der, prefix) {
	const b = Buffer.from(der);
	if (b.length !== prefix.length + 32 || !b.subarray(0, prefix.length).equals(prefix)) throw new Error("node-crypto: not an X25519 key");
	return b.subarray(prefix.length);
}

function generateKeyPairSync(alg) {
	if (alg !== "x25519") throw new Error(`node-crypto: key type ${alg} isn't supported`);
	const priv = x25519.utils.randomSecretKey();
	return { privateKey: keyObject("private", priv), publicKey: keyObject("public", x25519.getPublicKey(priv)) };
}

function createPrivateKey({ key, format, type }) {
	if (format !== "der" || type !== "pkcs8") throw new Error("node-crypto: private keys must be PKCS#8 DER");
	return keyObject("private", fromDer(key, PKCS8));
}

function createPublicKey(input) {
	if (input && input.type === "private" && input.raw) return keyObject("public", x25519.getPublicKey(new Uint8Array(input.raw)));
	const { key, format, type } = input;
	if (format !== "der" || type !== "spki") throw new Error("node-crypto: public keys must be SPKI DER");
	return keyObject("public", fromDer(key, SPKI));
}

function diffieHellman({ privateKey, publicKey }) {
	return Buffer.from(x25519.getSharedSecret(new Uint8Array(privateKey.raw), new Uint8Array(publicKey.raw)));
}

function hkdfSync(digest, ikm, salt, info, keylen) {
	if (digest !== "sha256") throw new Error(`node-crypto: hkdf ${digest} isn't supported`);
	const out = hkdf(sha256, utf8(ikm), utf8(salt), utf8(info), keylen);
	return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength); // Node returns an ArrayBuffer
}

module.exports = { randomBytes, createHash, scrypt, createCipheriv, createDecipheriv, generateKeyPairSync, createPrivateKey, createPublicKey, diffieHellman, hkdfSync };
