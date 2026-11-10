/**
 * Plan 2026-09-08 §10.5 S7 — tests for the local-slugify duplication ratchet.
 * Run: node --test scripts/check-no-local-slugify.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ALLOWLIST,
  CANONICAL,
  findDefinitionLines,
  findStaleAllowlist,
  isExcludedFile,
  scanRepo,
} from "./check-no-local-slugify.mjs";

function withTree(files, fn) {
  const root = mkdtempSync(join(tmpdir(), "slugify-guard-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const COPY = 'function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }\n';

test("flags function declarations, including prefixed names", () => {
  assert.equal(findDefinitionLines("function slugify(value: string): string {").length, 1);
  assert.equal(findDefinitionLines("export function slugifyEstateName(value: string): string {").length, 1);
  assert.equal(findDefinitionLines("function slugifyPart(value) {").length, 1);
});

test("flags const / let arrow bindings", () => {
  assert.equal(findDefinitionLines("const slugify = (s: string) => s;").length, 1);
  assert.equal(findDefinitionLines("export const slugifyName: (s: string) => string = (s) => s;").length, 1);
});

test("does NOT flag imports, re-exports, call sites or comments", () => {
  assert.equal(findDefinitionLines('import { slugify } from "@/lib/shared/slugify";').length, 0);
  assert.equal(findDefinitionLines('import { slugify as kebab } from "@/lib/shared/slugify";').length, 0);
  assert.equal(findDefinitionLines('export { slugify as slugifyEstateName } from "../shared/slugify";').length, 0);
  assert.equal(findDefinitionLines("const slug = slugify(title).slice(0, 64);").length, 0);
  assert.equal(findDefinitionLines("// function slugify(v) {").length, 0);
  assert.equal(findDefinitionLines(" * a local slugify helper").length, 0);
});

test("does NOT flag a differently named composition", () => {
  assert.equal(findDefinitionLines("function sourceSlug(value: string): string {").length, 0);
  assert.equal(findDefinitionLines("function optionId(label: string, index: number): string {").length, 0);
});

test("scans apps, packages, scripts and services; skips the home, tests and fixtures", () => {
  withTree(
    {
      "apps/web/lib/a.ts": COPY,
      "packages/foo/src/b.ts": COPY,
      "scripts/c.mjs": COPY,
      "services/svc/d.js": COPY,
      [CANONICAL]: COPY,
      "apps/web/lib/e.test.ts": COPY,
      "apps/web/lib/__tests__/f.ts": COPY,
      "packages/foo/test/fixtures/g.ts": COPY,
      "apps/web/lib/h.d.mts": COPY,
      "apps/mobile/node_modules/dep/i.js": COPY,
    },
    (root) => {
      const files = scanRepo(root).map((v) => v.file).sort();
      assert.deepEqual(files, ["apps/web/lib/a.ts", "packages/foo/src/b.ts", "scripts/c.mjs", "services/svc/d.js"]);
    },
  );
});

test("isExcludedFile keeps source and drops tests, specs and declarations", () => {
  assert.equal(isExcludedFile("a.tsx"), false);
  assert.equal(isExcludedFile("a.mjs"), false);
  assert.equal(isExcludedFile("a.test.ts"), true);
  assert.equal(isExcludedFile("a.spec.mjs"), true);
  assert.equal(isExcludedFile("a.d.ts"), true);
  assert.equal(isExcludedFile("a.d.mts"), true);
  assert.equal(isExcludedFile("a.md"), true);
});

test("every allowlist entry records a reason", () => {
  for (const [file, reason] of ALLOWLIST) {
    assert.ok(typeof reason === "string" && reason.length >= 20, `${file} needs a reason`);
  }
  assert.equal(ALLOWLIST.has(CANONICAL), false);
});

test("the live repo passes the guard — no new copies outside the allowlist", () => {
  assert.deepEqual(scanRepo(), []);
});

test("the allowlist is not stale — every entry still defines a local slugify", () => {
  assert.deepEqual(findStaleAllowlist(), []);
});
