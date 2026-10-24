// Tests for the @dpf/types redeclaration ratchet (plan 2026-09-08 §10.5 S9).
// Run: node --test scripts/check-no-local-dpf-type-redeclaration.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWLIST,
  contractTypeNames,
  findRedeclarations,
  findStaleAllowlist,
  scanRepo,
} from "./check-no-local-dpf-type-redeclaration.mjs";

const NAMES = new Set(["MeResponse", "ActivityItem", "PaginatedResponse"]);

test("flags type aliases and interfaces, exported or not", () => {
  assert.equal(findRedeclarations("export type MeResponse = {", NAMES).length, 1);
  assert.equal(findRedeclarations("type ActivityItem = { id: string };", NAMES).length, 1);
  assert.equal(findRedeclarations("export interface MeResponse {", NAMES).length, 1);
  assert.equal(findRedeclarations("  interface ActivityItem {", NAMES).length, 1);
  assert.equal(findRedeclarations("export type PaginatedResponse<T> = { data: T[] };", NAMES).length, 1);
});

test("ignores imports, re-exports, other names and comments", () => {
  assert.equal(findRedeclarations("  type MeResponse,", NAMES).length, 0);
  assert.equal(findRedeclarations('import type { MeResponse } from "@dpf/types";', NAMES).length, 0);
  assert.equal(findRedeclarations("export type { MeResponse };", NAMES).length, 0);
  assert.equal(findRedeclarations("export type MeResponseView = MeResponse;", NAMES).length, 0);
  assert.equal(findRedeclarations("// export type MeResponse = {", NAMES).length, 0);
  assert.equal(findRedeclarations(" * interface ActivityItem {", NAMES).length, 0);
});

test("reads the contract names from packages/types", () => {
  const names = contractTypeNames();
  for (const n of ["MeResponse", "ActivityItem", "DashboardTile", "UploadResponse", "InvoiceStatus", "CreateInvoiceInput"]) {
    assert.ok(names.has(n), n);
  }
});

test("allowlist is closed and every entry carries a reason", () => {
  assert.equal(ALLOWLIST.size, 3);
  for (const [key, reason] of ALLOWLIST) {
    assert.match(key, /^[^:]+::[A-Za-z_$][\w$]*$/, key);
    assert.ok(reason.length > 40, `${key} needs a reason`);
  }
});

test("repo: no @dpf/types type is redeclared outside packages/types", () => {
  assert.deepEqual(scanRepo(), []);
  assert.deepEqual(findStaleAllowlist(), []);
});
