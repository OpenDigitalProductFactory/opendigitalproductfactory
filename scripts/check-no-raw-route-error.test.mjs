// Self-test for the raw-route-error ratchet (BI-81EE4A46).
import { test } from "node:test";
import assert from "node:assert/strict";

import { RAW_ERROR_RE, parseBaseline, diff } from "./check-no-raw-route-error.mjs";

test("RAW_ERROR_RE matches inline NextResponse.json({ error … })", () => {
  const src = `return NextResponse.json({ error: "nope" }, { status: 400 });`;
  assert.equal((src.match(RAW_ERROR_RE) ?? []).length, 1);
});

test("RAW_ERROR_RE does not match apiErrorResponse", () => {
  const src = `return apiErrorResponse("BAD", "nope", 400);`;
  assert.equal((src.match(RAW_ERROR_RE) ?? []).length, 0);
});

test("parseBaseline resolves union-merge duplicate paths to the max count", () => {
  const parsed = parseBaseline("a/x.ts\t3\nb/y.ts\t1\na/x.ts\t5\n");
  assert.equal(parsed["a/x.ts"], 5);
  assert.equal(parsed["b/y.ts"], 1);
});

test("diff flags a new file and a grown file, ignores a shrunk file", () => {
  const baseline = { "a.ts": 2, "b.ts": 4 };
  const current = { "a.ts": 3, "b.ts": 1, "c.ts": 1 };
  const { grew, fresh } = diff(current, baseline);
  assert.deepEqual(fresh, ["c.ts (1)"]);
  assert.deepEqual(grew, ["a.ts (2 -> 3)"]);
});

test("diff is clean when everything is at or below baseline", () => {
  const { grew, fresh } = diff({ "a.ts": 1 }, { "a.ts": 2 });
  assert.equal(grew.length, 0);
  assert.equal(fresh.length, 0);
});
