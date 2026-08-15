// scripts/check-module-size.test.mjs
// BI-24115B65 — union-merge duplicates are tolerated (min LOC wins); detection
// remains available for diagnostics / --update cleanup.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findDuplicateBaselinePaths,
  parseBaseline,
} from "./check-module-size.mjs";

test("parseBaseline keeps the smaller LOC when the same path appears twice (union-merge)", () => {
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

test("parseBaseline min-wins never loosens a size ceiling across three duplicates", () => {
  const text = [
    "apps/web/lib/a.ts\t1100",
    "apps/web/lib/a.ts\t900",
    "apps/web/lib/a.ts\t1000",
  ].join("\n");
  assert.equal(parseBaseline(text)["apps/web/lib/a.ts"], 900);
});

test("findDuplicateBaselinePaths reports each duplicated path once (diagnostic)", () => {
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
