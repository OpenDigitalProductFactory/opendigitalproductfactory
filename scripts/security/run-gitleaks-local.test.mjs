import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GITLEAKS_VERSION,
  buildGitleaksDownloadUrl,
  buildGitleaksArgs,
  normalizeMode,
  resolveGitleaksAsset,
} from "./run-gitleaks-local.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

test("pins the local runner to the same gitleaks version as CI", () => {
  assert.equal(GITLEAKS_VERSION, "8.30.1");
  assert.equal(readFileSync(join(SCRIPT_DIR, "gitleaks-version.txt"), "utf8").trim(), GITLEAKS_VERSION);
});

test("resolves official release assets for supported platforms", () => {
  assert.equal(
    resolveGitleaksAsset({ platform: "win32", arch: "x64" }),
    "gitleaks_8.30.1_windows_x64.zip",
  );
  assert.equal(
    resolveGitleaksAsset({ platform: "linux", arch: "x64" }),
    "gitleaks_8.30.1_linux_x64.tar.gz",
  );
  assert.equal(
    resolveGitleaksAsset({ platform: "darwin", arch: "arm64" }),
    "gitleaks_8.30.1_darwin_arm64.tar.gz",
  );
});

test("builds audited official release download URLs", () => {
  assert.equal(
    buildGitleaksDownloadUrl("gitleaks_8.30.1_windows_x64.zip"),
    "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip",
  );
});

test("rejects unsupported local platforms with a clear error", () => {
  assert.throws(
    () => resolveGitleaksAsset({ platform: "freebsd", arch: "x64" }),
    /Unsupported platform/,
  );
});

test("defaults to staged mode for the pre-commit path", () => {
  assert.equal(normalizeMode([]), "staged");
  assert.equal(normalizeMode(["--staged"]), "staged");
  assert.equal(normalizeMode(["--tree"]), "tree");
});

test("builds staged protect arguments with the repository config", () => {
  assert.deepEqual(buildGitleaksArgs({ mode: "staged", configPath: ".gitleaks.toml" }), [
    "protect",
    "--staged",
    "--redact",
    "--config",
    ".gitleaks.toml",
    "--no-banner",
    "--no-color",
  ]);
});

test("builds current-tree scan arguments with the repository config", () => {
  assert.deepEqual(buildGitleaksArgs({ mode: "tree", configPath: ".gitleaks.toml" }), [
    "dir",
    ".",
    "--redact",
    "--config",
    ".gitleaks.toml",
    "--no-banner",
    "--no-color",
  ]);
});
