const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// apps/mobile is its own pnpm workspace (plan 2026-09-08 M6). The shared
// @dpf/* packages arrive as injected copies under this project's
// node_modules, so Metro resolves from here only. Never add the repository
// root: it holds the web app's dependency tree, including a different React.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

// Prefer the CJS `require` condition over `import` when a dependency ships
// both via a package `exports` map. The workspace pins pretty-format to v30
// (pnpm-workspace.yaml "jest 30 unification" override) so the mobile jest
// suite runs a unified jest-30 tree — but pretty-format@30 adds an `exports`
// map whose `import` condition resolves the ESM build, and React Native
// 0.85's HMR client bootstrap (setUpDefaultReactNativeEnvironment →
// pretty-format) only handles the CJS default-export shape. Resolving the
// ESM build makes `prettyFormat.default` undefined and crashes every boot
// with "[runtime not ready] Cannot read property 'default' of undefined".
// pretty-format@29 was CJS-only, which is the shape RN's fallback expects.
// Dropping `import` from the condition list keeps package-exports resolution
// on for everything else while handing RN the CJS entry it needs. Hermes
// runs CJS natively, so preferring `require` is the safe default here.
config.resolver.unstable_conditionNames = ["require", "react-native", "default"];

module.exports = withNativeWind(config, { input: "./global.css" });
