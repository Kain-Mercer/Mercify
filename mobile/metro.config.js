const path = require("path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

// The phone runs the desktop's own overlay/lobby.js and overlay/friends.js, so lobbies and
// friends stay one protocol. For files in overlay/, Node's `crypto` becomes our @noble-based
// stand-in (src/node-crypto.js) and `mqtt` the browser build, through src/mqtt.js.
const overlay = path.resolve(__dirname, "../overlay");

const config = {
	watchFolders: [overlay],
	resolver: {
		nodeModulesPaths: [path.resolve(__dirname, "node_modules")],
		resolveRequest: (context, moduleName, platform) => {
			if (context.originModulePath.startsWith(overlay + path.sep)) {
				if (moduleName === "crypto") return { type: "sourceFile", filePath: path.resolve(__dirname, "src/node-crypto.js") };
				if (moduleName === "mqtt") return { type: "sourceFile", filePath: path.resolve(__dirname, "src/mqtt.js") };
			}
			return context.resolveRequest(context, moduleName, platform);
		},
	},
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
