const path = require("path");
const base = require("../../metro.config.js");
const mock = path.resolve(__dirname, "mock-rn.js");
const orig = base.resolver.resolveRequest;
module.exports = { ...base, projectRoot: path.resolve(__dirname, "../.."), resolver: { ...base.resolver, resolveRequest: (ctx, name, platform) => (name === "react-native" ? { type: "sourceFile", filePath: mock } : orig(ctx, name, platform)) } };
