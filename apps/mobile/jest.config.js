// BI-F5D4FA50: inside the Build Studio sandbox (DPF_SANDBOX_TEST_SCOPE=enforce,
// set only on the sandbox service) a Jest run that names no test files is
// refused before any worker starts, and every decision is recorded. This
// mirrors the rule in apps/web/lib/build/sandbox/test-scope-guard.ts, which this
// separate pnpm workspace cannot import. A no-op everywhere else.
function enforceSandboxTestScope(argv, env) {
  if (env.DPF_SANDBOX_TEST_SCOPE !== "enforce") return;
  const bin = argv.findIndex((a) => /(^|[\/])jest(\.js)?$/.test(a));
  if (bin < 0) return;
  const args = argv.slice(bin + 1);
  const valueOptions = new Set(["-c", "--config", "-w", "--maxWorkers", "-t", "--testNamePattern", "--reporters", "--shard", "--selectProjects", "--rootDir", "--outputFile", "--coverageDirectory", "--testTimeout"]);
  const scopingOptions = new Set(["--findRelatedTests", "-o", "--onlyChanged", "--changedSince", "--testPathPattern", "--testPathPatterns", "--listTests"]);
  let scoped = false;
  for (let i = 0; i < args.length && !scoped; i += 1) {
    const arg = args[i];
    if (arg === "--") continue;
    if (!arg.startsWith("-")) { scoped = true; break; }
    const name = arg.split("=")[0];
    if (name === "--help" || name === "--version") return;
    if (scopingOptions.has(name)) scoped = true;
    else if (!arg.includes("=") && valueOptions.has(name)) i += 1;
  }
  const record = { at: new Date().toISOString(), runner: "jest", decision: scoped ? "allowed" : "refused", cwd: process.cwd(), args };
  try {
    require("node:fs").appendFileSync(env.DPF_SANDBOX_TEST_SCOPE_LOG || "/tmp/dpf-test-scope-guard.jsonl", `${JSON.stringify(record)}\n`);
  } catch {
    // The record is evidence, not the gate.
  }
  if (!scoped) {
    throw new Error("[dpf-test-scope-guard] Refused a `jest` run with no file filter in the Build Studio sandbox. The whole suite runs in cloud CI and the merge queue, not here. Run only the tests for the files you changed: call run_sandbox_tests, or name them: pnpm exec jest --ci <test files>.");
  }
}
enforceSandboxTestScope(process.argv, process.env);

/** @type {import('jest').Config} */
module.exports = {
  // Sandbox resource envelope (BI-F5D4FA50); unset elsewhere, so Jest's default applies.
  ...(Number.parseInt(process.env.DPF_JEST_MAX_WORKERS ?? "", 10) > 0 ? { maxWorkers: Number.parseInt(process.env.DPF_JEST_MAX_WORKERS, 10) } : {}),
  preset: "jest-expo",
  setupFilesAfterEnv: ["./jest.setup.ts"],
  transformIgnorePatterns: [
    "node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|native-base|react-native-svg|react-native-sse|nativewind|zustand|@dpf[/+].*))"
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^react$": "<rootDir>/node_modules/react",
    "^react/jsx-runtime$": "<rootDir>/node_modules/react/jsx-runtime",
    "^react/jsx-dev-runtime$": "<rootDir>/node_modules/react/jsx-dev-runtime",
    "^react-test-renderer$": "<rootDir>/node_modules/react-test-renderer",
    "^expo/src/winter$": "<rootDir>/__mocks__/expo-winter-index.js",
    "^expo/src/winter/(.*)$": "<rootDir>/__mocks__/expo-winter.js",
    "^expo/build/winter$": "<rootDir>/__mocks__/expo-winter-index.js",
    "^expo/build/winter/(.*)$": "<rootDir>/__mocks__/expo-winter.js"
  },
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts"
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "__tests__/utils/"
  ]
};
