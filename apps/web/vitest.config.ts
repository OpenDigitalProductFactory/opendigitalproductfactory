import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": appRoot,
      "next/server": fileURLToPath(new URL("./node_modules/next/server.js", import.meta.url)),
      "react-dom/server": fileURLToPath(
        new URL("./node_modules/react-dom/server.node.js", import.meta.url),
      ),
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**"],
  },
});
