// Self-test for the pack-skill category guard (BI-4CE4F52F).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  ALLOWED_PACK_CATEGORIES,
  FLOOR_PACK_SKILLS,
  readPackCategory,
  findCategoryViolations,
} from "./check-skill-pack-category.mjs";

const skill = (category) => `---\nname: a\ncategory: ${category}\n---\nbody\n`;

test("reads the declared category, and tolerates absence", () => {
  assert.equal(readPackCategory(skill("operations")), "operations");
  assert.equal(readPackCategory(skill('"customer"')), "customer");
  assert.equal(readPackCategory("---\nname: a\n---\nbody\n"), null);
  assert.equal(readPackCategory("no frontmatter"), null);
});

test("an established category is silent; a missing one is not a violation", () => {
  assert.deepEqual(findCategoryViolations("s.md", "operations"), []);
  assert.deepEqual(findCategoryViolations("s.md", null), []);
});

test("the two values that actually shipped are rejected, and the message says why", () => {
  for (const bad of ["finance", "marketing"]) {
    const v = findCategoryViolations("s.md", bad);
    assert.equal(v.length, 1, bad);
    assert.match(v[0], /permanent visible group header/);
    assert.match(v[0], /shrink-only words-on-arrival ratchet/);
  }
});

test("the live corpus passes and the count proves a corpus was read", () => {
  const r = spawnSync("node", ["scripts/check-skill-pack-category.mjs"], { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  assert.equal(r.status, 0, out);
  const m = /(\d+) skill\(s\) against (\d+) established categories/.exec(out);
  assert.ok(m, out);
  assert.ok(Number(m[1]) >= FLOOR_PACK_SKILLS, `too few skills seen: ${m[1]}`);
  assert.equal(Number(m[2]), ALLOWED_PACK_CATEGORIES.size);
});
