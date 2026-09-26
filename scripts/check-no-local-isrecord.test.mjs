/**
 * BI-6A505BFF — tests for the local-isRecord duplication ratchet.
 * Run: node --test scripts/check-no-local-isrecord.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWLIST,
  CANONICAL,
  SCAN_ROOTS,
  findDefinitionLines,
  findStaleAllowlist,
  isExcludedFile,
  scanRepo,
} from "./check-no-local-isrecord.mjs";

function withTree(files, fn) {
  const root = mkdtempSync(join(tmpdir(), "isrecord-guard-"));
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

const COPY = "function isRecord(v) { return typeof v === 'object' && v !== null; }\n";

test("flags a function declaration form", () => {
  assert.equal(
    findDefinitionLines("function isRecord(v) { return true; }").length,
    1,
  );
  assert.equal(
    findDefinitionLines("export function isRecord(value: unknown): value is Record<string, unknown> {").length,
    1,
  );
});

test("flags a const arrow form", () => {
  assert.equal(findDefinitionLines("const isRecord = (v: unknown) => true;").length, 1);
  assert.equal(findDefinitionLines("export const isRecord: Guard = (v) => true;").length, 1);
});

test("flags the isPlainObject spelling of the same guard", () => {
  assert.equal(findDefinitionLines("function isPlainObject(v: unknown): v is Record<string, unknown> {").length, 1);
  assert.equal(findDefinitionLines("const isPlainObject = (v) => true;").length, 1);
});

test("does NOT flag a differently named predicate", () => {
  assert.equal(findDefinitionLines("function hasPlainPrototype(value: object): boolean {").length, 0);
  assert.equal(findDefinitionLines("function isRecordArray(v: unknown) {").length, 0);
});

test("does NOT flag an import of the shared helper", () => {
  assert.equal(
    findDefinitionLines('import { isRecord } from "@/lib/shared/coerce";').length,
    0,
  );
  assert.equal(
    findDefinitionLines('import { asString, isRecord, asNumber } from "@/lib/shared/coerce";').length,
    0,
  );
});

test("does NOT flag a call site or member access", () => {
  assert.equal(findDefinitionLines("if (isRecord(payload)) doThing();").length, 0);
  assert.equal(findDefinitionLines("const ok = isRecord(x) && isRecord(x.y);").length, 0);
});

test("does NOT flag comment lines mentioning isRecord", () => {
  assert.equal(findDefinitionLines(" * the local isRecord helper is duplicated").length, 0);
  assert.equal(findDefinitionLines("// function isRecord(v) {").length, 0);
});

test("the live repo passes the guard — no new copies outside the allowlist", () => {
  assert.deepEqual(scanRepo(), []);
});

test("the allowlist is not stale — every entry still defines a local isRecord", () => {
  assert.deepEqual(findStaleAllowlist(), []);
});

test("the canonical homes are not themselves allowlisted (they are the sanctioned sources)", () => {
  for (const home of CANONICAL) assert.equal(ALLOWLIST.has(home), false, home);
});

test("every allowlist entry carries a reason and is a storefront generator input", () => {
  assert.equal(ALLOWLIST.size, 2);
  for (const [rel, reason] of ALLOWLIST) {
    assert.match(rel, /^packages\/storefront-templates\/src\//, rel);
    assert.ok(typeof reason === "string" && reason.length > 20, rel);
  }
});

test("every canonical home exists, sits in a scan root and defines the guard", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const home of CANONICAL) {
    assert.ok(SCAN_ROOTS.some((r) => home.startsWith(`${r}/`)), `${home} is inside a scan root`);
    assert.equal(findDefinitionLines(readFileSync(join(root, home), "utf8")).length, 1, home);
  }
});

test("scans web components, packages and scripts/lib, not only apps/web/lib", () => {
  withTree(
    {
      "apps/web/components/x/a.ts": COPY,
      "packages/foo/src/b.ts": COPY,
      "scripts/lib/c.mjs": COPY,
      "scripts/d.mjs": COPY, // outside scripts/lib — out of scope
    },
    (root) => {
      const files = scanRepo(root).map((v) => v.file).sort();
      assert.deepEqual(files, ["apps/web/components/x/a.ts", "packages/foo/src/b.ts", "scripts/lib/c.mjs"]);
    },
  );
});

test("skips canonical homes, tests, fixtures and node_modules", () => {
  withTree(
    {
      "apps/web/lib/shared/coerce.ts": COPY,
      "packages/validators/src/guards.ts": COPY,
      "scripts/lib/is-record.mjs": COPY,
      "packages/foo/src/b.test.ts": COPY,
      "packages/foo/src/__tests__/c.ts": COPY,
      "packages/foo/test/fixtures/d.ts": COPY,
      "packages/foo/node_modules/dep/e.js": COPY,
      "apps/web/lib/f.d.ts": COPY,
    },
    (root) => assert.deepEqual(scanRepo(root), []),
  );
});

test("isExcludedFile keeps source and drops tests, specs and declarations", () => {
  assert.equal(isExcludedFile("a.ts"), false);
  assert.equal(isExcludedFile("a.mjs"), false);
  assert.equal(isExcludedFile("a.test.mjs"), true);
  assert.equal(isExcludedFile("a.spec.tsx"), true);
  assert.equal(isExcludedFile("a.d.ts"), true);
  assert.equal(isExcludedFile("a.json"), true);
});
