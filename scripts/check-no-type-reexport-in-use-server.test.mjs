// Self-test for the "use server" type-re-export guard (BI-11AC7524).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXPORT_TYPE_BLOCK,
  EXPORT_BLOCK_WITH_TYPE,
  isUseServerModule,
  findViolationsInLines,
} from "./check-no-type-reexport-in-use-server.mjs";

test("EXPORT_TYPE_BLOCK matches `export type { X }` re-export", () => {
  assert.ok(EXPORT_TYPE_BLOCK.test("export type { ActionResult };"));
  assert.ok(EXPORT_TYPE_BLOCK.test('export type { Foo } from "@/x";'));
});

test("EXPORT_TYPE_BLOCK does NOT match an inline `export type X = …`", () => {
  assert.equal(EXPORT_TYPE_BLOCK.test("export type CapabilitySourceType = \"a\" | \"b\";"), false);
});

test("EXPORT_BLOCK_WITH_TYPE matches `export { type X }`", () => {
  assert.ok(EXPORT_BLOCK_WITH_TYPE.test("export { foo, type Bar };"));
});

test("EXPORT_BLOCK_WITH_TYPE does NOT match a value-only `export { foo }`", () => {
  assert.equal(EXPORT_BLOCK_WITH_TYPE.test("export { createThingAction };"), false);
});

test("isUseServerModule detects the directive after leading comments", () => {
  assert.ok(isUseServerModule(["// header", "", '"use server";', "import x"]));
  assert.ok(isUseServerModule(["'use server'"]));
});

test("isUseServerModule is false for a non-directive module", () => {
  assert.equal(isUseServerModule(["import { z } from 'x';", "export const a = 1;"]), false);
});

test("findViolationsInLines flags a re-export in a use-server module", () => {
  const v = findViolationsInLines(['"use server";', 'import { type Foo } from "@/x";', "export type { Foo };"]);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 3);
});

test("findViolationsInLines ignores inline type exports and non-use-server files", () => {
  assert.equal(findViolationsInLines(['"use server";', "export type X = string;"]).length, 0);
  assert.equal(findViolationsInLines(["export type { Foo };"]).length, 0); // not a use-server module
});

test("findViolationsInLines does not flag a commented-out re-export", () => {
  assert.equal(findViolationsInLines(['"use server";', "// export type { Foo };"]).length, 0);
});
