// Self-test for the hand-rolled-loading ratchet (BI-BBA388A1).
import { test } from "node:test";
import assert from "node:assert/strict";

import { HAND_ROLLED_RE, parseBaseline, diff } from "./check-no-hand-rolled-loading.mjs";

test("HAND_ROLLED_RE matches animate-spin and animate-pulse", () => {
  const src = `<span className="h-3 w-3 animate-spin" /><span className="animate-pulse" />`;
  assert.equal((src.match(HAND_ROLLED_RE) ?? []).length, 2);
});

test("HAND_ROLLED_RE matches the arbitrary-value form", () => {
  const src = `className="animate-[spin_2s_linear_infinite]"`;
  assert.equal((src.match(HAND_ROLLED_RE) ?? []).length, 1);
});

test("HAND_ROLLED_RE ignores a ui/ primitive import and unrelated classes", () => {
  const src = `import { Spinner } from "@/components/ui/Spinner"; const c = "animate-none animated";`;
  assert.equal((src.match(HAND_ROLLED_RE) ?? []).length, 0);
});

test("parseBaseline resolves union-merge duplicate paths to the max count", () => {
  const parsed = parseBaseline("a/x.tsx\t3\nb/y.tsx\t1\na/x.tsx\t5\n");
  assert.equal(parsed["a/x.tsx"], 5);
  assert.equal(parsed["b/y.tsx"], 1);
});

test("diff flags a new file and a grown file, ignores a shrunk file", () => {
  const baseline = { "a.tsx": 2, "b.tsx": 4 };
  const current = { "a.tsx": 3, "b.tsx": 1, "c.tsx": 1 };
  const { grew, fresh } = diff(current, baseline);
  assert.deepEqual(fresh, ["c.tsx (1)"]);
  assert.deepEqual(grew, ["a.tsx (2 -> 3)"]);
});

test("diff is clean when everything is at or below baseline", () => {
  const { grew, fresh } = diff({ "a.tsx": 1 }, { "a.tsx": 2 });
  assert.equal(grew.length, 0);
  assert.equal(fresh.length, 0);
});
