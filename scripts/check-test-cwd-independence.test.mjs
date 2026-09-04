/**
 * BI-96033E25 — tests for the cwd-independence ratchet.
 *
 * Run: node --test scripts/check-test-cwd-independence.test.mjs
 *
 * NOTE: this file resolves the repo root from import.meta.url, never from
 * process.cwd(). A test for a cwd-independence guard that itself depended on cwd
 * would be the exact defect it exists to prevent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { readFileSync } from "node:fs";

import {
  ALLOWLIST,
  SCAN_ROOTS,
  scanRepo,
  findStaleAllowlist,
} from "./check-test-cwd-independence.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

/** Build a throwaway repo containing one test file, and scan it. */
function scanFixture(fileName, contents) {
  const root = mkdtempSync(join(tmpdir(), "dpf-cwd-guard-"));
  try {
    const dir = join(root, "packages", "db", "src");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, fileName), contents);
    return scanRepo(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("flags cwd used as a path base — the original BI-8AD9D018 defect", () => {
  const found = scanFixture(
    "offender.test.ts",
    'const rootDir = join(process.cwd(), "..", "..");\n',
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, "cwd-as-path-base");
  assert.equal(found[0].line, 1);
});

test("flags the same defect when the call wraps across lines", () => {
  const found = scanFixture(
    "wrapped.test.ts",
    ["const principleDir = resolve(", "  process.cwd(),", '  "../../docs",', ");", ""].join("\n"),
  );
  assert.ok(found.length >= 1, "a wrapped resolve(process.cwd(), …) must still be flagged");
  assert.equal(found[0].rule, "cwd-as-path-base");
});

test("flags a bare repo-relative literal handed to fs — same defect, no cwd token", () => {
  const found = scanFixture(
    "bare.test.ts",
    'const cfg = readFileSync("apps/web/vitest.config.ts", "utf8");\n',
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, "bare-repo-relative-read");
});

test("accepts the __dirname form the fix uses", () => {
  const found = scanFixture(
    "fixed.test.ts",
    'const rootDir = join(__dirname, "..", "..", "..");\n',
  );
  assert.deepEqual(found, []);
});

test("does not flag cwd passed as a spawn option or saved for restore", () => {
  const found = scanFixture(
    "legit.test.ts",
    [
      "const previous = process.cwd();",
      'execFileSync("git", ["status"], { cwd: process.cwd() });',
      "const root = resolveRootClonePath(process.cwd());",
      "",
    ].join("\n"),
  );
  assert.deepEqual(found, [], "only cwd used as a PATH BASE is a violation");
});

test("covers every pnpm workspace root that runs vitest", () => {
  // services/ was missing from the first cut. It was clean, so no assertion
  // failed and the omission was invisible — the reason this test names the
  // roots explicitly rather than trusting the constant to be complete.
  const workspace = readFileSync(join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
  const vitestRoots = new Set(
    [...workspace.matchAll(/^\s*-\s*["']?([^"'\n]+)["']?\s*$/gm)]
      .map((m) => m[1].trim())
      .filter((entry) => !entry.startsWith("!"))
      .map((entry) => entry.split("/")[0])
      .filter((top) => top && !top.startsWith(".")),
  );
  for (const root of vitestRoots) {
    if (root === "scripts") continue; // tsx --test from repo root, not vitest
    assert.ok(
      SCAN_ROOTS.includes(root),
      `workspace root "${root}" is not scanned by the cwd-independence guard`,
    );
  }
});

test("the real repository is clean — the ratchet holds at its baseline", () => {
  assert.deepEqual(scanRepo(REPO_ROOT), []);
});

test("the allowlist is not stale", () => {
  assert.deepEqual(findStaleAllowlist(REPO_ROOT), []);
});

test("allowlist stays small and deliberate", () => {
  assert.ok(
    ALLOWLIST.size <= 3,
    "a growing allowlist means the guard is being silenced rather than obeyed",
  );
});
