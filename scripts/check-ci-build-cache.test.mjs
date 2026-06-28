// scripts/check-ci-build-cache.test.mjs
// node --test (no vitest). Keeps the production-build Turbopack cache exact-key
// only: broad restore fallbacks can hydrate stale multi-GB caches and push PR
// builds past the hosted runner's practical budget.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

function stepBlock(stepName) {
  const start = ciWorkflow.indexOf(`- name: ${stepName}`);
  assert.notEqual(start, -1, `missing workflow step: ${stepName}`);

  const next = ciWorkflow.indexOf("\n      - name:", start + 1);
  return ciWorkflow.slice(start, next === -1 ? undefined : next);
}

test("Production Build Turbopack cache uses exact keys only", () => {
  const block = stepBlock("Cache Turbopack build cache");

  assert.match(block, /path:\s*\$\{\{\s*github\.workspace\s*\}\}\/apps\/web\/\.next\/cache/);
  assert.match(block, /key:\s*nextjs-/);
  assert.doesNotMatch(block, /\n\s+restore-keys:/);
});
