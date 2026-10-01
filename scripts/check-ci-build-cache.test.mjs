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

// Spec 2026-09-30 web-runtime-import-cycle §6 PR-1: the web tsbuildinfo
// warm-start cache. PRs and merge_group restore; only a push to main writes, so
// no branch can plant build info another run trusts.
const tsbuildinfoAction = readFileSync(".github/actions/web-tsbuildinfo-cache/action.yml", "utf8");
const TSBUILDINFO_PATHS = /path: \|\n\s+apps\/web\/tsconfig\.tsbuildinfo\n\s+apps\/web\/tsconfig\.test\.tsbuildinfo\n/;

test("web tsbuildinfo action restores only, keyed on inputs + TypeScript version + SHA", () => {
  assert.match(tsbuildinfoAction, /uses: actions\/cache\/restore@v6/);
  assert.doesNotMatch(tsbuildinfoAction, /actions\/cache(?:\/save)?@/);
  assert.match(tsbuildinfoAction, TSBUILDINFO_PATHS);
  assert.match(
    tsbuildinfoAction,
    /hashFiles\('pnpm-lock\.yaml', 'tsconfig\.base\.json', 'apps\/web\/tsconfig\.json', 'apps\/web\/tsconfig\.test\.json'\)/,
  );
  assert.match(tsbuildinfoAction, /require\('typescript\/package\.json'\)\.version/);
  assert.match(tsbuildinfoAction, /key=\$\{prefix\}\$\{GITHUB_SHA\}/);
  assert.match(tsbuildinfoAction, /restore-keys: \$\{\{ steps\.key\.outputs\.prefix \}\}/);
});

test("both Typecheck jobs restore the web tsbuildinfo before compiling and never save it", () => {
  for (const [job, next, compileStep] of [
    ["typecheck", "typecheck-tests", "Typecheck all workspaces"],
    ["typecheck-tests", "typecheck-cache", "Typecheck the web test program"],
  ]) {
    const block = jobBlock(job, next);
    const restore = block.indexOf("uses: ./.github/actions/web-tsbuildinfo-cache");
    assert.notEqual(restore, -1, `${job} must restore the web tsbuildinfo`);
    assert.ok(restore < block.indexOf(`- name: ${compileStep}`), `${job} must restore before it compiles`);
    assert.doesNotMatch(block, /actions\/cache(?:\/save)?@/, `${job} must not write the cache`);
  }
});

test("only a push to main saves the web tsbuildinfo, under the action's exact key", () => {
  const writers = ciWorkflow.match(/uses: actions\/cache\/save@v6/g) ?? [];
  assert.equal(writers.length, 1, "exactly one tsbuildinfo writer");
  const block = jobBlock("typecheck-cache", "policy-guards-source");
  assert.match(block, /\n\s{4}if: github\.event_name == 'push' &&/);
  assert.match(block, /uses: actions\/cache\/save@v6/);
  assert.match(block, TSBUILDINFO_PATHS);
  assert.match(block, /key: \$\{\{ steps\.tsbuildinfo\.outputs\.key \}\}/);
  // A compile that fails here is not a verdict (merge_group already checked
  // this tree); its build info is still valid warm state.
  assert.match(stepBlock("Refresh the production program build info"), /continue-on-error: true/);
  assert.match(stepBlock("Refresh the test program build info"), /continue-on-error: true/);
});
