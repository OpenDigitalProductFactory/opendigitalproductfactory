import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "path";
import { config as loadEnv } from "dotenv";

const rootDir = resolve(__dirname, "../..");
const webDir = resolve(__dirname);
const rootNodeModulesDir = resolve(rootDir, "node_modules");
const webReactDir = dirname(require.resolve("react/package.json", { paths: [webDir] }));
const webReactDomDir = dirname(require.resolve("react-dom/package.json", { paths: [webDir] }));

loadEnv({ path: resolve(rootDir, ".env") });
loadEnv({ path: resolve(webDir, ".env.local"), override: true });

export default defineConfig({
  plugins: [react()],
  test: {
    root: webDir,
    environment: "node",
    globals: false,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "tests/**"],
    server: {
      deps: {
        // Force react/react-dom through Vite's SSR transform so the
        // `resolve.alias` entries below reach CJS `require("react")`
        // calls inside react-dom/server. Without this, CI's hoisted
        // pnpm layout can hand react-dom-server a different React copy
        // than the one the component imports, leaving the shared-
        // internals dispatcher null at hook call time (see #219).
        inline: [/^react(?:-dom)?(?:\/.*)?$/],
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
      { find: /^react\/jsx-dev-runtime$/, replacement: resolve(webReactDir, "jsx-dev-runtime.js") },
      { find: /^react\/jsx-runtime$/, replacement: resolve(webReactDir, "jsx-runtime.js") },
      { find: /^react-dom\/server$/, replacement: resolve(webReactDomDir, "server.node.js") },
      // Resolve React from the web workspace's own dependency graph instead of
      // the monorepo root hoist. The root can legitimately hoist a different
      // React for mobile/Expo, which leads Vitest to render components with one
      // copy while react-dom uses another on Linux CI.
      { find: /^react-dom$/, replacement: resolve(webReactDomDir, "index.js") },
      { find: /^react$/, replacement: resolve(webReactDir, "index.js") },
    ],
  },
});
