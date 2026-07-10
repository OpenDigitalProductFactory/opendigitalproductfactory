/**
 * BI-C0CEB377 — tests for the no-nanoid-import ratchet.
 * Run: node --test scripts/check-no-nanoid-import.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWLIST,
  CANONICAL,
  findImportLines,
  findStaleAllowlist,
  scanRepo,
} from "./check-no-nanoid-import.mjs";

test("flags an ES import of nanoid", () => {
  assert.equal(findImportLines('import { nanoid } from "nanoid";').length, 1);
  assert.equal(findImportLines("import { nanoid } from 'nanoid';").length, 1);
});

test("flags a require / dynamic import of nanoid", () => {
  assert.equal(findImportLines('const { nanoid } = require("nanoid");').length, 1);
  assert.equal(findImportLines('const m = await import("nanoid");').length, 1);
});

test("does NOT flag the owned newId import", () => {
  assert.equal(
    findImportLines('import { newId } from "@/lib/shared/new-id";').length,
    0,
  );
});

test("does NOT flag a comment mentioning nanoid", () => {
  assert.equal(findImportLines(" * replaces the nanoid dependency").length, 0);
  assert.equal(findImportLines('// import { nanoid } from "nanoid";').length, 0);
});

test("does NOT flag a subpath specifier or unrelated module", () => {
  assert.equal(findImportLines('import x from "nanoid-good";').length, 0);
  assert.equal(findImportLines('import x from "@dpf/nanoid";').length, 0);
});

test("the live repo passes the guard — no nanoid imports remain", () => {
  assert.deepEqual(scanRepo(), []);
});

test("the allowlist is empty (every site migrated) and not stale", () => {
  assert.equal(ALLOWLIST.size, 0);
  assert.deepEqual(findStaleAllowlist(), []);
});

test("the canonical owned home is not itself allowlisted", () => {
  assert.equal(ALLOWLIST.has(CANONICAL), false);
});
