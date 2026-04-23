import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    root: resolve(__dirname),
    environment: "node",
    globals: false,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    // Alias order matters: Vite prefix-matches string aliases in the order
    // they are declared, so subpath entries (`@dpf/db/foo`) MUST come before
    // the bare-name entry (`@dpf/db`) or the subpath would be rewritten to
    // `<client.ts>/foo` and fail to resolve.
    alias: [
      {
        find: "@dpf/db/seed-deliberation",
        replacement: resolve(__dirname, "../../packages/db/src/seed-deliberation.ts"),
      },
      { find: "@", replacement: resolve(__dirname, ".") },
      { find: "@dpf/db", replacement: resolve(__dirname, "../../packages/db/src/client.ts") },
      {
        find: "@dpf/finance-templates",
        replacement: resolve(__dirname, "../../packages/finance-templates/src/index.ts"),
      },
    ],
  },
});
