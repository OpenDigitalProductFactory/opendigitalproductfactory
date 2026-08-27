// node --test — hooks directory resolution (BI-5CBDC146).
//
// The bug these guard against is invisible on Linux: URL.pathname and
// fileURLToPath agree on POSIX and diverge on Windows, so CI stayed green
// while every Windows clone silently lost its pre-push gate.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { HOOKS_DIR_FROM_SCRIPTS, looksLikeUrlPathname, resolveHooksDir } from "./hooks-dir.mjs";

/** `.githooks/` relative to this test file, which lives in `scripts/lib/`. */
const HOOKS_DIR_FROM_LIB = `../${HOOKS_DIR_FROM_SCRIPTS}`;

test("looksLikeUrlPathname flags the drive-letter shape URL.pathname produces", () => {
  assert.equal(looksLikeUrlPathname("/D:/repo/.githooks/"), true);
  assert.equal(looksLikeUrlPathname("\\D:\\repo\\.githooks\\"), true);
  assert.equal(looksLikeUrlPathname("/c:/repo/.githooks/"), true);
  // Real paths must not be flagged.
  assert.equal(looksLikeUrlPathname("D:\\repo\\.githooks\\"), false);
  assert.equal(looksLikeUrlPathname("/srv/repo/.githooks/"), false);
  assert.equal(looksLikeUrlPathname("/home/runner/work/.githooks/"), false);
});

test("resolveHooksDir never returns a URL pathname", () => {
  const dir = resolveHooksDir(import.meta.url, HOOKS_DIR_FROM_LIB);
  assert.equal(
    looksLikeUrlPathname(dir),
    false,
    `resolveHooksDir returned a URL pathname, not a filesystem path: ${dir}`,
  );
});

test("resolveHooksDir resolves to the repository's real .githooks directory", () => {
  // The load-bearing assertion: on Windows the pre-fix implementation produced
  // "\D:\...\.githooks" and this existsSync was false, which is precisely what
  // the swallowed ENOENT hid.
  const dir = resolveHooksDir(import.meta.url, HOOKS_DIR_FROM_LIB);
  assert.ok(
    existsSync(join(dir, "lib", "pre-push-chained.sh")),
    `expected the tracked chained hook under ${dir}`,
  );
});

test("set-hooks-path.mjs resolves hook directories through fileURLToPath, never .pathname", () => {
  // Source-level regression guard: the defect was a single property access, and
  // reintroducing it would once again fail silently on Windows only.
  const source = readFileSync(new URL("../set-hooks-path.mjs", import.meta.url), "utf8");
  assert.ok(
    !/import\.meta\.url\s*\)\s*\.pathname/.test(source),
    "set-hooks-path.mjs must not read .pathname off a module URL — use resolveHooksDir()",
  );
  assert.ok(
    source.includes("resolveHooksDir"),
    "set-hooks-path.mjs must resolve hook directories through resolveHooksDir()",
  );
});
