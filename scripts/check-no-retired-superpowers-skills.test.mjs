import { test } from "node:test";
import assert from "node:assert/strict";
import { RETIRED_SKILL_RE, parseBaseline, diff } from "./check-no-retired-superpowers-skills.mjs";

function matches(text) {
  return text.match(new RegExp(RETIRED_SKILL_RE.source, "g")) ?? [];
}

test("matches invocation-style retired skill references", () => {
  assert.deepEqual(
    matches("REQUIRED: use `superpowers:subagent-driven-development` to execute this plan"),
    ["superpowers:subagent-driven-development"],
  );
  assert.deepEqual(matches("superpowers:test-driven-development and superpowers:requesting-code-review"), [
    "superpowers:test-driven-development",
    "superpowers:requesting-code-review",
  ]);
});

test("does not match directory paths, prose, or the wildcard form", () => {
  assert.deepEqual(matches("saved to docs/superpowers/plans/2026-07-17-x.md"), []);
  assert.deepEqual(matches("The upstream `superpowers:*` skill names are retired"), []);
  assert.deepEqual(matches("superpowers without a colon"), []);
  assert.deepEqual(matches("dpf-platform:dpf-tdd is the native equivalent"), []);
});

test("parseBaseline resolves union-merge duplicates to the MAX count", () => {
  const counts = parseBaseline("a.md\t3\nb.md\t1\na.md\t5\n# comment\n\n");
  assert.deepEqual(counts, { "a.md": 5, "b.md": 1 });
});

test("diff flags new files and grown counts, allows shrink", () => {
  const baseline = { "a.md": 3, "b.md": 1 };
  const { grew, fresh } = diff({ "a.md": 4, "b.md": 1, "c.md": 2 }, baseline);
  assert.deepEqual(grew, ["a.md (3 -> 4)"]);
  assert.deepEqual(fresh, ["c.md (2)"]);
  const clean = diff({ "a.md": 2 }, baseline);
  assert.deepEqual(clean, { grew: [], fresh: [] });
});
