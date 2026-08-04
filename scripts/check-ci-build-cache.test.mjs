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

function jobBlock(jobName, nextJobName) {
  const start = ciWorkflow.indexOf(`  ${jobName}:`);
  assert.notEqual(start, -1, `missing workflow job: ${jobName}`);

  const next = ciWorkflow.indexOf(`\n  ${nextJobName}:`, start + 1);
  assert.notEqual(next, -1, `missing workflow job after ${jobName}: ${nextJobName}`);
  return ciWorkflow.slice(start, next);
}

test("Production Build Turbopack cache uses exact keys only", () => {
  const block = stepBlock("Cache Turbopack build cache");

  assert.match(block, /path:\s*\$\{\{\s*github\.workspace\s*\}\}\/apps\/web\/\.next\/cache/);
  assert.match(block, /key:\s*nextjs-/);
  assert.doesNotMatch(block, /\n\s+restore-keys:/);
});

test("Production Build is bounded and identifies timed-out evidence", () => {
  const block = jobBlock("build", "ux-route-sweep-runtime");
  const buildStep = stepBlock("Build web (Next.js production)");

  assert.match(block, /\n\s{4}timeout-minutes:\s*45\s*\n/);
  assert.match(buildStep, /production-build.*run=\$\{\{ github\.run_id \}\}/);
  assert.match(buildStep, /tree=\$\{\{ github\.sha \}\}/);
  assert.match(buildStep, /timeout=45m/);
  // Turbopack FS cache only on pull_request — merge_group must not hard-pin "1".
  assert.match(buildStep, /DPF_TURBOPACK_BUILD_CACHE:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'/);
  assert.match(buildStep, /pnpm --filter web build/);
  assert.doesNotMatch(buildStep, /continue-on-error:\s*true/);
});
