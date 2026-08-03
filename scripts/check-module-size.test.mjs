// scripts/check-module-size.test.mjs
// BI-EEB04701 — baseline must not carry silent duplicate path keys.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findDuplicateBaselinePaths,
  parseBaseline,
} from "./check-module-size.mjs";

test("parseBaseline keeps the smaller LOC when the same path appears twice", () => {
  const text = [
    "apps/web/lib/a.ts\t900",
    "apps/web/lib/b.ts\t1200",
    "apps/web/lib/a.ts\t1100",
    "",
  ].join("\n");
  const parsed = parseBaseline(text);
  assert.equal(parsed["apps/web/lib/a.ts"], 900);
  assert.equal(parsed["apps/web/lib/b.ts"], 1200);
});

test("findDuplicateBaselinePaths reports each duplicated path once", () => {
  const text = [
    "apps/web/lib/a.ts\t900",
    "apps/web/lib/b.ts\t1200",
    "apps/web/lib/a.ts\t1100",
    "apps/web/lib/b.ts\t1000",
  ].join("\n");
  assert.deepEqual(findDuplicateBaselinePaths(text), [
    "apps/web/lib/a.ts",
    "apps/web/lib/b.ts",
  ]);
});

test("clean baseline has no duplicates", () => {
  assert.deepEqual(
    findDuplicateBaselinePaths("apps/web/lib/a.ts\t900\napps/web/lib/b.ts\t1000\n"),
    [],
  );
});
