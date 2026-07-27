import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

// Load DATABASE_URL and other secrets from the repo-root .env for local runs.
// In CI the job-level env block sets DATABASE_URL directly; this is a no-op there.
const rootDir = resolve(__dirname, "../..");
loadEnv({ path: resolve(rootDir, ".env") });

export default defineConfig({
  test: {
    environment: "node",
    // Use forked processes instead of worker threads so each test file gets
    // its own process and its own Prisma singleton (packages/db/src/client.ts
    // stores the client on globalThis). Without forks, afterAll($disconnect)
    // in one file disconnects the shared global client, causing the next
    // file's first Prisma call to fail with ECONNREFUSED.
    pool: "forks",
    include: [
      "test/**/*.test.ts",
      "src/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    // BI-2F60FDCE — observation-mode V8 coverage; all owned src included even
    // when no test imports the file yet.
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.ts", "scripts/**/*.ts"],
      exclude: [
        "**/*.{test,spec}.ts",
        "**/__tests__/**",
        "**/*.d.ts",
        "**/generated/**",
        "**/node_modules/**",
      ],
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      reportOnFailure: true,
      thresholds: undefined,
    },
  },
});
