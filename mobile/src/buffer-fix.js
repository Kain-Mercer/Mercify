// Hermes (the phone's JavaScript engine) ignores Symbol.species on typed arrays, so the npm
// "buffer" package's buf.subarray() returns a plain Uint8Array there: no .equals(), and
// .toString("base64") gives "1,2,3". overlay/friends.js relies on subarray() keeping it a
// Buffer (as Node does), so make it. The package's own slice() does the same thing.
// Loaded by src/polyfills.js; the tests load it too, after making Buffer behave like on Hermes.
module.exports = function fixBuffer(Buffer) {
	if (Buffer.prototype.__mercifySubarray) return Buffer;
	const subarray = Uint8Array.prototype.subarray;
	Object.defineProperty(Buffer.prototype, "subarray", {
		value: function (start, end) {
			const out = subarray.call(this, start, end);
			Object.setPrototypeOf(out, Buffer.prototype);
			return out;
		},
		writable: true,
		configurable: true,
	});
	Object.defineProperty(Buffer.prototype, "__mercifySubarray", { value: true });
	return Buffer;
};
