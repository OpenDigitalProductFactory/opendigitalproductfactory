/**
 * BI-5BC34E0A — the shared hostile fixtures against the repository guard.
 * Run: node --test scripts/hostile-content-guard.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { BENIGN_TEXT, HIDDEN_PAYLOADS, POISONED_TOOL_DESCRIPTION } from "../packages/validators/src/hostile-content-fixtures.ts";
import { findHiddenUnicode } from "./check-hidden-unicode-instruction-files.mjs";

for (const payload of HIDDEN_PAYLOADS) {
  test(`guard refuses ${payload.name} in an instruction file`, () => {
    assert.ok(findHiddenUnicode(`# Skill\n\n${payload.text}\n`).length > 0);
  });
}

for (const benign of BENIGN_TEXT) {
  test(`guard accepts ${benign.name}`, () => {
    assert.deepEqual(findHiddenUnicode(benign.text), []);
  });
}

test("guard refuses a poisoned tool description committed into a registry", () => {
  const hits = findHiddenUnicode(JSON.stringify({ description: POISONED_TOOL_DESCRIPTION }));
  assert.equal(hits[0].class, "tag");
});
