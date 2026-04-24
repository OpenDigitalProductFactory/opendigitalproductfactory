import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadDbEnv, resetDbEnvForTests, resolveDbEnvPaths } from "./load-env";

const originalDatabaseUrl = process.env.DATABASE_URL;

function writeEnvFile(path: string, databaseUrl: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `DATABASE_URL=${databaseUrl}\n`, "utf8");
}

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
  resetDbEnvForTests();
});

describe("loadDbEnv", () => {
  it("prefers the shared web env before package-local and root fallbacks", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "dpf-db-env-"));
    const repoRoot = join(tempRoot, "repo");
    const packageRoot = join(repoRoot, "packages", "db");

    writeEnvFile(join(repoRoot, "apps", "web", ".env.local"), "postgresql://web");
    writeEnvFile(join(packageRoot, ".env"), "postgresql://package");
    writeEnvFile(join(repoRoot, ".env"), "postgresql://root");

    delete process.env.DATABASE_URL;

    const loadedPaths = loadDbEnv({
      webEnvPath: join(repoRoot, "apps", "web", ".env.local"),
      packageEnvPath: join(packageRoot, ".env"),
      rootEnvPath: join(repoRoot, ".env"),
      forceReload: true,
    });

    expect(process.env.DATABASE_URL).toBe("postgresql://web");
    expect(loadedPaths).toEqual(
      resolveDbEnvPaths({
        webEnvPath: join(repoRoot, "apps", "web", ".env.local"),
        packageEnvPath: join(packageRoot, ".env"),
        rootEnvPath: join(repoRoot, ".env"),
      }),
    );

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("falls back to packages/db/.env when the shared web env is absent", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "dpf-db-env-"));
    const repoRoot = join(tempRoot, "repo");
    const packageRoot = join(repoRoot, "packages", "db");

    writeEnvFile(join(packageRoot, ".env"), "postgresql://package");
    writeEnvFile(join(repoRoot, ".env"), "postgresql://root");

    delete process.env.DATABASE_URL;

    loadDbEnv({
      webEnvPath: join(repoRoot, "apps", "web", ".env.local"),
      packageEnvPath: join(packageRoot, ".env"),
      rootEnvPath: join(repoRoot, ".env"),
      forceReload: true,
    });

    expect(process.env.DATABASE_URL).toBe("postgresql://package");

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("uses the root env only as a last fallback", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "dpf-db-env-"));
    const repoRoot = join(tempRoot, "repo");
    const packageRoot = join(repoRoot, "packages", "db");

    writeEnvFile(join(repoRoot, ".env"), "postgresql://root");

    delete process.env.DATABASE_URL;

    loadDbEnv({
      webEnvPath: join(repoRoot, "apps", "web", ".env.local"),
      packageEnvPath: join(packageRoot, ".env"),
      rootEnvPath: join(repoRoot, ".env"),
      forceReload: true,
    });

    expect(process.env.DATABASE_URL).toBe("postgresql://root");

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("never overrides an explicitly supplied shell DATABASE_URL", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "dpf-db-env-"));
    const repoRoot = join(tempRoot, "repo");
    const packageRoot = join(repoRoot, "packages", "db");

    writeEnvFile(join(repoRoot, "apps", "web", ".env.local"), "postgresql://web");
    process.env.DATABASE_URL = "postgresql://shell";

    loadDbEnv({
      webEnvPath: join(repoRoot, "apps", "web", ".env.local"),
      packageEnvPath: join(packageRoot, ".env"),
      rootEnvPath: join(repoRoot, ".env"),
      forceReload: true,
    });

    expect(process.env.DATABASE_URL).toBe("postgresql://shell");

    rmSync(tempRoot, { recursive: true, force: true });
  });
});
