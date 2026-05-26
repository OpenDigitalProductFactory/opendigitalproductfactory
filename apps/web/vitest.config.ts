import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { config as loadEnv } from "dotenv";
import { buildNodeModuleAliases } from "./vitest.path-aliases";

const rootDir = resolve(__dirname, "../..");
const webDir = resolve(__dirname);

loadEnv({ path: resolve(rootDir, ".env") });
loadEnv({ path: resolve(webDir, ".env.local"), override: true });

export default defineConfig({
  plugins: [react()],
  test: {
    root: webDir,
    environment: "node",
    globals: false,
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
    server: {
      deps: {
        // Auth.js imports the Next server runtime by extensionless subpath.
        // Keep it inside Vite's resolver so the alias below can normalize that
        // import for Node/Vitest on both Windows and Linux CI.
        inline: ["next-auth"],
      },
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
      { find: "@dpf/db", replacement: resolve(rootDir, "packages/db/src/client.ts") },
      {
        find: "@dpf/finance-templates",
        replacement: resolve(rootDir, "packages/finance-templates/src/index.ts"),
      },
      { find: "server-only", replacement: resolve(webDir, "test-support/server-only.ts") },
      ...buildNodeModuleAliases({ webDir, rootDir }),
    ],
  },
});
