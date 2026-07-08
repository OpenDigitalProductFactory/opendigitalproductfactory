/**
 * BI-6A505BFF — tests for the local-isRecord duplication ratchet.
 * Run: node --test scripts/check-no-local-isrecord.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWLIST,
  CANONICAL,
  findDefinitionLines,
  findStaleAllowlist,
  scanRepo,
} from "./check-no-local-isrecord.mjs";

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

test("the canonical home is not itself allowlisted (it is the sanctioned source)", () => {
  assert.equal(ALLOWLIST.has(CANONICAL), false);
});
