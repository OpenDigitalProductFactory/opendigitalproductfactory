import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { config as loadEnv } from "dotenv";

const rootDir = resolve(__dirname, "../..");
const webDir = resolve(__dirname);
const rootNodeModulesDir = resolve(rootDir, "node_modules");

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
    // Auth.js v5 (next-auth@5.0.0-beta.31) imports `next/server` (no extension)
    // from `next-auth/lib/env.js`. Under Node ESM strict resolution that fails
    // with "Cannot find module .../next/server. Did you mean to import
    // 'next/server.js'?" The `resolve.alias` below already maps `next/server`
    // to the .js file, but Vite's aliases only apply to deps Vite actually
    // transforms. By default Vitest externalizes `next-auth` (lets Node load
    // it natively), bypassing the alias. Inlining `next-auth` brings it back
    // inside the Vite resolver so the alias takes effect on every Linux + CI
    // run, not just the ones where Node happened to honor the deep export.
    server: {
      deps: {
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
      { find: "next/server", replacement: resolve(rootDir, "node_modules/next/server.js") },
      { find: "react/jsx-dev-runtime", replacement: resolve(rootNodeModulesDir, "react/jsx-dev-runtime.js") },
      { find: "react/jsx-runtime", replacement: resolve(rootNodeModulesDir, "react/jsx-runtime.js") },
      { find: "react-dom/server", replacement: resolve(rootNodeModulesDir, "react-dom/server.node.js") },
      { find: "react-dom", replacement: resolve(rootNodeModulesDir, "react-dom/index.js") },
      { find: "react", replacement: resolve(rootNodeModulesDir, "react/index.js") },
    ],
  },
});
