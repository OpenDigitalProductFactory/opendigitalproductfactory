// scripts/set-hooks-path.no-static-imports.test.mjs
//
// BI-9B490215 — the root postinstall must not statically import a local module.
//
// The Docker `deps` stage copies exactly ONE file out of scripts/:
//   Dockerfile: COPY scripts/set-hooks-path.mjs ./scripts/
// then runs `pnpm install --frozen-lockfile`, which runs it as postinstall.
// A static `import './lib/x.mjs'` resolves at module load, before any
// try/catch can run, so it throws ERR_MODULE_NOT_FOUND, fails postinstall and
// breaks the image build — and with it the release and self-upgrade chain for
// every install. Dynamic + guarded imports degrade to a warning instead.
//
// Run: node --test scripts/set-hooks-path.no-static-imports.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const postinstall = join(here, "set-hooks-path.mjs");

test("postinstall has no static local imports", () => {
  const source = readFileSync(postinstall, "utf8");
  const staticLocalImports = source
    .split(/\r?\n/)
    .filter((line) => /^\s*import\s[^(]*\sfrom\s+['"][.\/]/.test(line));
  assert.deepEqual(
    staticLocalImports,
    [],
    "every local import in set-hooks-path.mjs must be a guarded `await import()`; a static one breaks the Docker deps stage",
  );
});

test("postinstall survives the Docker deps stage, where only itself is present", () => {
  // Reproduces the failing layer exactly: one file under scripts/, no
  // scripts/lib, no .githooks, not a git repository.
  const sandbox = mkdtempSync(join(tmpdir(), "dpf-postinstall-"));
  try {
    mkdirSync(join(sandbox, "scripts"), { recursive: true });
    copyFileSync(postinstall, join(sandbox, "scripts", "set-hooks-path.mjs"));
    writeFileSync(join(sandbox, "package.json"), '{"name":"sim","private":true}\n');

    let exitCode = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, ["scripts/set-hooks-path.mjs"], {
        cwd: sandbox,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
      stderr = String(err.stderr ?? "");
    }

    assert.equal(exitCode, 0, `postinstall must not fail the image build. stderr:\n${stderr}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
