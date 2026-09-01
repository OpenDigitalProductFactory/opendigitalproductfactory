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

test("Production Build cache key avoids unbounded source glob hashing", () => {
  const block = stepBlock("Cache Turbopack build cache");

  // GitHub evaluates hashFiles while rendering the workflow. Scanning every
  // web source file can exceed the 120s template limit before the job starts.
  // The immutable commit SHA already changes on every source commit, so it is a
  // bounded and exact cache discriminator.
  assert.match(block, /\$\{\{\s*github\.sha\s*\}\}/);
  assert.doesNotMatch(block, /hashFiles\(['"]apps\/web\/\*\*/);
});

test("Production Build is bounded and identifies timed-out evidence", () => {
  const block = jobBlock("build", "ux-route-sweep-runtime");
  const buildStep = stepBlock("Build web (Next.js production)");

  assert.match(block, /\n\s{4}timeout-minutes:\s*45\s*\n/);
  assert.match(buildStep, /production-build.*run=\$\{\{ github\.run_id \}\}/);
  assert.match(buildStep, /tree=\$\{\{ github\.sha \}\}/);
  assert.match(buildStep, /timeout=15m\/step 45m\/job/);
  // Turbopack FS cache only on pull_request — merge_group must not hard-pin "1".
  assert.match(buildStep, /DPF_TURBOPACK_BUILD_CACHE:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'/);
  assert.match(buildStep, /pnpm --filter web build/);
  assert.doesNotMatch(buildStep, /continue-on-error:\s*true/);
});

test("the production compile fails fast on its own step timeout (BI-F75AADB7)", () => {
  // Without a STEP bound a hung compile runs to the 45m job cap and the job ends
  // `cancelled`, not `failure`. Measured on #3984 job 92139777135: ~53 minutes in
  // this single step, and `gh run view --job <id> --log` returns "log not found"
  // for a cancelled job — so the occurrence costs ~55 minutes of hosted-runner
  // time AND leaves nothing to diagnose. The inner bound makes it a real failure
  // with a retained log; the 45m job cap stays as the outer backstop.
  const buildStep = stepBlock("Build web (Next.js production)");
  const stepTimeout = /\n\s{8}timeout-minutes:\s*(\d+)\s*\n/.exec(buildStep);

  assert.ok(stepTimeout, "Build web (Next.js production) must carry a step-level timeout-minutes");
  const minutes = Number(stepTimeout[1]);
  // Healthy PR builds run 3-4m against a documented 8-10m expectation. Below that
  // ceiling the bound would fail honest cold compiles; far above it, it stops
  // being fail-fast and the job cap does the work again.
  assert.ok(minutes >= 12 && minutes < 45, `step timeout ${minutes}m must sit between the healthy ceiling and the 45m job cap`);
});
