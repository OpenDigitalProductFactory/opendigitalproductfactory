// Self-test for scripts/check-model-metadata-tags.mjs (pure evaluate()).
import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluate } from "./check-model-metadata-tags.mjs";

const parsedFixture = ({ tagged = [], untagged = [], issues = [] } = {}) => ({
  entries: tagged.map((model) => ({ model, table: model, file: "f.prisma", line: 1, metadata: {} })),
  untagged: untagged.map((model) => ({ model, table: model, file: "f.prisma", line: 1 })),
  issues,
});

test("a persistent model with no tag and not in the baseline is a hard failure", () => {
  const r = evaluate(parsedFixture({ tagged: ["A"], untagged: ["Brand"] }), new Set());
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /Brand: persistent model carries no \/\/\/ @dpf tag/);
  assert.deepEqual(r.newGaps, ["Brand"]);
});

test("a baselined untagged model passes, and a baselined model that gained a tag is reported as ratchetable", () => {
  const r = evaluate(parsedFixture({ tagged: ["Old"], untagged: ["Legacy"] }), new Set(["Legacy", "Old"]));
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.nowTagged, ["Old"]);
});

test("a parser issue (bad vocabulary, stray tag) is always a hard failure even for baselined models", () => {
  const r = evaluate(
    parsedFixture({ untagged: ["Legacy"], issues: [{ file: "f.prisma", line: 3, model: "Legacy", message: 'lifecycle "forever" is not one of ...' }] }),
    new Set(["Legacy"]),
  );
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /lifecycle "forever"/);
});

test("a baselined model that no longer exists is reported so the baseline can only shrink honestly", () => {
  const r = evaluate(parsedFixture({ tagged: ["A"] }), new Set(["Gone"]));
  assert.deepEqual(r.vanished, ["Gone"]);
});
