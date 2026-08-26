import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { config as loadEnv } from "dotenv";
import { buildNodeModuleAliases } from "./vitest.path-aliases";

const rootDir = resolve(__dirname, "../..");
const webDir = resolve(__dirname);

// Node >=25 (a host toolchain that outran CI's pinned Node 24) exposes
// experimental host localStorage/sessionStorage globals even with no backing
// store configured. Those undefined host accessors SHADOW the web storage jsdom
// installs in each fork worker, which corrupts the jsdom environment enough that
// React Testing Library's act-environment detection fails and component renders
// throw "Cannot read properties of null (reading 'useContext')" — a cascade that
// looks like a code bug but is a Node-version mismatch (BI-C89E471F). It turned
// the whole component-test surface red on any Node >=25 host (~115 failures on
// the local-CI pregate) while CI on Node 24 stayed green, which trained
// contributors to override the pre-push gate.
//
// `--no-experimental-webstorage` disables Node's host implementation so jsdom
// owns storage again. The flag must reach the FORK WORKER at launch (it is a
// node CLI flag, not a runtime toggle, and vitest's poolOptions.forks.execArgv
// does not reliably propagate it in v4). Fork workers inherit the parent env, so
// prepending it to NODE_OPTIONS here — before vitest spawns any worker — reaches
// every worker on every entry point: the pregate, CI, and a developer's direct
// `pnpm --filter web exec vitest`. The flag exists on Node 24 too and is a
// harmless no-op there, so it is applied unconditionally rather than sniffing the
// version. Idempotent: skipped when already present.
if (!/(^|\s)--no-experimental-webstorage(\s|$)/.test(process.env.NODE_OPTIONS ?? "")) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --no-experimental-webstorage`.trim();
}

loadEnv({ path: resolve(rootDir, ".env") });
loadEnv({ path: resolve(webDir, ".env.local"), override: true });

export default defineConfig({
  plugins: [react()],
  test: {
    root: webDir,
    environment: "node",
    globals: false,
    // The first test in any file that imports the ~12k-line lib/mcp-tools.ts is
    // charged that module's full cold transform/compile cost. Under the parallel
    // 4-shard CI run (forks pool — each file is its own worker, so the transform
    // is paid per file), that first import intermittently exceeds the 5000ms
    // default and times out (~5.3s observed across mcp-tools-*.test.ts). Raise
    // the per-test budget so the cold import has headroom; real hangs still fail.
    testTimeout: 15_000,
    // Time-bomb detection (BI-6A4F47B9). A strict no-op unless
    // DPF_CLOCK_SHIFT_DAYS is set, so normal runs pay only the import. See the
    // file header for why a static grep does not work here.
    setupFiles: ["./vitest.clock-shift-setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
    // Each test file gets its own worker process. Without forks, React 18's
    // scheduler can queue a setImmediate (Immediate.performWorkUntilDeadline)
    // that fires after jsdom teardown, throwing "window is not defined" and
    // failing the run even when all assertions pass. Process exit on forks
    // disposes the pending message-channel work cleanly.
    // (Surfaced 2026-05-19 in BuildStudioHeaderLayout.test.tsx CI runs;
    // local always passed because timing differs.)
    pool: "forks",
    // BI-6F44EA89 / BI-CA33B14B: green suites still exit 1 with
    // EnvironmentTeardownError ("Closing rpc while onUserConsoleLog was
    // pending") when Vitest's console intercept keeps a log callback open as
    // the forks worker shuts down. Disable intercept so teardown is not
    // blocked by pending console traffic; assertions and CI still see
    // stdout/stderr via the process pipes.
    disableConsoleIntercept: true,
    teardownTimeout: 30_000,
    server: {
      deps: {
        // Auth.js imports the Next server runtime by extensionless subpath.
        // Keep it inside Vite's resolver so the alias below can normalize that
        // import for Node/Vitest on both Windows and Linux CI.
        inline: ["next-auth"],
      },
    },
    // BI-2F60FDCE — observation-mode V8 coverage (non-blocking thresholds).
    // Explicit includes keep unimported owned production files visible in
    // Vitest 4 reports so unloaded inventory remains measurable.
    coverage: {
      provider: "v8",
      include: [
        "app/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
        "lib/**/*.{ts,tsx}",
        "proxy.ts",
        "instrumentation.ts",
      ],
      exclude: [
        "**/*.{test,spec}.{ts,tsx}",
        "**/__tests__/**",
        "**/*.d.ts",
        "**/generated/**",
        "**/.next/**",
        "**/node_modules/**",
      ],
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: process.env.CI_COVERAGE_DIR ?? "./coverage",
      // Keep coverage output even when the suite fails so calibration can
      // still measure incomplete runs.
      reportOnFailure: true,
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    // Alias order matters: Vite prefix-matches string aliases in the order
    // they are declared, so subpath entries (`@dpf/db/foo`) MUST come before
    // the bare-name entry (`@dpf/db`) or the subpath would be rewritten to
    // `<client.ts>/foo` and fail to resolve.
    alias: [
      {
        find: "@dpf/db/discovery-collectors-unifi",
        replacement: resolve(rootDir, "packages/db/src/discovery-collectors/unifi.ts"),
      },
      {
        find: "@dpf/db/discovery-collectors-arp-scan",
        replacement: resolve(rootDir, "packages/db/src/discovery-collectors/arp-scan.ts"),
      },
      {
        find: "@dpf/db/discovery-collectors-snmp",
        replacement: resolve(rootDir, "packages/db/src/discovery-collectors/snmp.ts"),
      },
      {
        // Barrel subpath: maps to patch/index.ts, not patch.ts, so it must precede
        // the generic regex below (which would resolve to a nonexistent patch.ts).
        find: "@dpf/db/patch",
        replacement: resolve(rootDir, "packages/db/src/patch/index.ts"),
      },
      {
        find: /^@dpf\/db\/(.+)$/,
        replacement: resolve(rootDir, "packages/db/src/$1.ts"),
      },
      {
        find: "@dpf/db/seed-deliberation",
        replacement: resolve(rootDir, "packages/db/src/seed-deliberation.ts"),
      },
      {
        find: "@dpf/db/reference-model-projection",
        replacement: resolve(rootDir, "packages/db/src/reference-model-projection.ts"),
      },
      { find: "@", replacement: webDir },
      {
        find: "@dpf/db/peer-certificate-verification",
        replacement: resolve(rootDir, "packages/db/src/peer-certificate-verification.ts"),
      },
      {
        find: "@dpf/db/organization-federation-enrollment",
        replacement: resolve(rootDir, "packages/db/src/organization-federation-enrollment.ts"),
      },
      {
        find: "@dpf/db/organization-join-action",
        replacement: resolve(rootDir, "packages/db/src/organization-join-action.ts"),
      },
      {
        find: "@dpf/db/installation-peer-pairing",
        replacement: resolve(rootDir, "packages/db/src/installation-peer-pairing.ts"),
      },
      {
        find: "@dpf/db/installation-instance-stance",
        replacement: resolve(rootDir, "packages/db/src/installation-instance-stance.ts"),
      },
      {
        find: "@dpf/db/installation-operating-intent",
        replacement: resolve(rootDir, "packages/db/src/installation-operating-intent.ts"),
      },
      { find: "@dpf/db", replacement: resolve(rootDir, "packages/db/src/client.ts") },
      {
        find: "@dpf/finance-templates",
        replacement: resolve(rootDir, "packages/finance-templates/src/index.ts"),
      },
      {
        find: "@dpf/storefront-templates",
        replacement: resolve(rootDir, "packages/storefront-templates/src/index.ts"),
      },
      {
        find: "@dpf/validators",
        replacement: resolve(rootDir, "packages/validators/src/index.ts"),
      },
      { find: "server-only", replacement: resolve(webDir, "test-support/server-only.ts") },
      ...buildNodeModuleAliases({ webDir, rootDir }),
    ],
  },
});
