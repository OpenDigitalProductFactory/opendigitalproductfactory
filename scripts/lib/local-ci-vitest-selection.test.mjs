import assert from "node:assert/strict";
import test from "node:test";

import {
  EXHAUSTIVE_ENV,
  changedFilesAgainst,
  exhaustiveTrigger,
  resolveVitestSelection,
} from "./local-ci-vitest-selection.mjs";

const BASE = "origin/main";
const NO_ENV = {};

test("narrows to the affected suite for an ordinary source diff", () => {
  const selection = resolveVitestSelection({
    baseRef: BASE,
    changedFiles: ["apps/web/lib/nonprod/local-ci-pool-policy.ts"],
    env: NO_ENV,
  });
  assert.equal(selection.mode, "affected");
  assert.equal(selection.stage, "affected-vitest");
  assert.deepEqual(selection.extraArgs, [`--changed=${BASE}`]);
});

test("falls back to exhaustive when the base ref is missing", () => {
  const selection = resolveVitestSelection({
    baseRef: "",
    changedFiles: ["apps/web/lib/foo.ts"],
    env: NO_ENV,
  });
  assert.equal(selection.mode, "exhaustive");
  assert.equal(selection.stage, "exhaustive-vitest");
  assert.deepEqual(selection.extraArgs, []);
  assert.equal(selection.reason, "no-base-ref");
});

test("an unreadable diff is exhaustive, never empty", () => {
  // changedFilesAgainst returns null when git fails. Reading that as "nothing
  // changed" would run zero tests and report a pass.
  const selection = resolveVitestSelection({
    baseRef: BASE,
    changedFiles: null,
    env: NO_ENV,
  });
  assert.equal(selection.mode, "exhaustive");
  assert.equal(selection.reason, "changed-files-unreadable");
});

test("an empty diff is exhaustive, not a licence to run nothing", () => {
  const selection = resolveVitestSelection({
    baseRef: BASE,
    changedFiles: [],
    env: NO_ENV,
  });
  assert.equal(selection.mode, "exhaustive");
  assert.equal(selection.reason, "empty-diff");
});

test("a whitespace-only file list is still treated as empty", () => {
  const selection = resolveVitestSelection({
    baseRef: BASE,
    changedFiles: ["", "   ", null],
    env: NO_ENV,
  });
  assert.equal(selection.mode, "exhaustive");
  assert.equal(selection.reason, "empty-diff");
});

test("files whose blast radius the module graph cannot see force exhaustive", () => {
  const unbounded = [
    "apps/web/vitest.config.ts",
    "tsconfig.json",
    "apps/web/tsconfig.json",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".npmrc",
    "apps/web/next.config.mjs",
    "packages/db/prisma/schema.prisma",
    "packages/db/prisma/migrations/20260829_x/migration.sql",
    "apps/web/test-setup.ts",
    "apps/web/vitest.setup.ts",
    "apps/web/test/helpers.ts",
    ".env.local",
  ];
  for (const file of unbounded) {
    const selection = resolveVitestSelection({
      baseRef: BASE,
      changedFiles: ["apps/web/lib/ordinary.ts", file],
      env: NO_ENV,
    });
    assert.equal(selection.mode, "exhaustive", `${file} should force exhaustive`);
    assert.match(selection.reason, /^blast-radius-unbounded:/);
  }
});

test("windows path separators are normalized before matching", () => {
  assert.equal(
    exhaustiveTrigger(["packages\\db\\prisma\\schema.prisma"]),
    "packages/db/prisma/schema.prisma",
  );
});

test("a lookalike path does not trigger exhaustive", () => {
  // `my-package.json` and `tsconfig-notes.md` must not be read as the real
  // config files; an over-eager trigger silently returns the stage to
  // always-exhaustive and the regression would be invisible.
  assert.equal(
    exhaustiveTrigger([
      "apps/web/lib/my-package.json.ts",
      "docs/tsconfig-notes.md",
      "apps/web/lib/vitest-helpers.ts",
    ]),
    null,
  );
});

test("the opt-out is honoured and records its reason", () => {
  const selection = resolveVitestSelection({
    baseRef: BASE,
    changedFiles: ["apps/web/lib/foo.ts"],
    env: { [EXHAUSTIVE_ENV]: "verifying a suspected selection miss" },
  });
  assert.equal(selection.mode, "exhaustive");
  assert.equal(
    selection.reason,
    "opt-out:verifying a suspected selection miss",
  );
});

test("an empty opt-out value does not disable selection", () => {
  const selection = resolveVitestSelection({
    baseRef: BASE,
    changedFiles: ["apps/web/lib/foo.ts"],
    env: { [EXHAUSTIVE_ENV]: "  " },
  });
  assert.equal(selection.mode, "affected");
});

test("every returned shape carries the four fields callers read", () => {
  for (const input of [
    { baseRef: BASE, changedFiles: ["apps/web/lib/foo.ts"] },
    { baseRef: "", changedFiles: null },
  ]) {
    const selection = resolveVitestSelection({ ...input, env: NO_ENV });
    for (const key of ["mode", "stage", "extraArgs", "reason"]) {
      assert.ok(key in selection, `missing ${key}`);
    }
    assert.ok(Array.isArray(selection.extraArgs));
    assert.ok(selection.reason.length > 0);
  }
});

test("local metadata distinguishes planned policy from verified actual Vitest coverage", async () => {
  const { projectLocalCiEvidence } = await import("./local-integration-ci.mjs");
  const input = { integrationTreeSha: "a".repeat(40), baseRef: BASE,
    changedFiles: ["apps/web/lib/example.ts"], env: {}, initialWorkers: 4 };
  const identity = { integrationTreeSha: input.integrationTreeSha,
    command: "pnpm --filter web exec vitest run --maxWorkers=4 --reporter=verbose --changed=origin/main", maxDurationMs: 1_800_000 };
  const policy = { digest: "b".repeat(64), plannerVersion: "1", policyVersion: "p1",
    executionLane: "exhaustive", evidenceTier: "exhaustive", fullSuite: true };
  const receipt = { schemaVersion: 1, stage: "affected-vitest", identity, status: "passed",
    completedAt: "2026-10-24T00:00:00Z", selection: resolveVitestSelection(input),
    attempts: [{ status: 0, classification: "passed", outputTail: "No affected test files found, exiting with code 0" }] };
  const projected = projectLocalCiEvidence({ evidencePlan: policy, evidencePlanPath: "plan.json", vitestReceipt: receipt, ...input });
  assert.equal(projected.plannedExecutionLane, "exhaustive");
  assert.deepEqual(projected.evidencePlan, { path: "plan.json", ...policy, basis: "planned-policy" });
  assert.equal(projected.vitestCoverage.mode, "affected");
  assert.equal(projected.vitestCoverage.status, "passed");
  assert.equal(projected.vitestCoverage.fullSuite, false);
  assert.equal(projected.vitestCoverage.selectedTestCount, null, "stdout is not a structured test-count receipt");
  assert.equal(policy.fullSuite, true, "generic cloud policy is unchanged");
  for (const invalid of [null, {}, { ...receipt, identity: { ...identity, integrationTreeSha: "c".repeat(40) } },
    { ...receipt, identity: { ...identity, maxDurationMs: 1 } }, { ...receipt, stage: "exhaustive-vitest" },
    { ...receipt, identity: { ...identity, command: identity.command.replace(" --changed=origin/main", "") } },
    { ...receipt, selection: { ...receipt.selection, mode: "exhaustive" } },
    { ...receipt, status: "running", completedAt: null }, { ...receipt, status: "test-failure" },
    { ...receipt, completedAt: "invalid" }, { ...receipt, completedAt: "2099-01-01T00:00:00Z" },
    { ...receipt, startedAt: "2026-10-25T00:00:00Z" }, { ...receipt, attempts: [] },
    { ...receipt, attempts: [{ status: 0, classification: "passed", deadlineExceeded: true }] }]) {
    const actual = projectLocalCiEvidence({ evidencePlan: policy, vitestReceipt: invalid, ...input }).vitestCoverage;
    assert.equal(actual.mode, "unknown");
    assert.equal(actual.fullSuite, null);
    assert.equal(actual.selectedTestCount, null);
  }
  assert.equal(projectLocalCiEvidence({ evidencePlan: policy, ...input }).vitestCoverage.status, "unrun");
  assert.equal(projectLocalCiEvidence({ evidencePlan: policy, vitestReceipt: receipt, ...input, integrationTreeSha: null }).vitestCoverage.mode, "unknown");
  const legacy = { ...receipt };
  delete legacy.selection;
  assert.equal(projectLocalCiEvidence({ evidencePlan: policy, vitestReceipt: legacy, ...input }).vitestCoverage.reason, "selection-reason-unrecorded");
  const forced = { ...input, env: { [EXHAUSTIVE_ENV]: "verify selection" } };
  const exhaustive = { ...receipt, stage: "exhaustive-vitest", selection: resolveVitestSelection(forced),
    identity: { ...identity, command: identity.command.replace(" --changed=origin/main", "") } };
  assert.equal(projectLocalCiEvidence({ evidencePlan: policy, vitestReceipt: exhaustive, ...forced }).vitestCoverage.fullSuite, true);
  assert.equal(projectLocalCiEvidence({ evidencePlan: policy, vitestReceipt: receipt, ...forced }).vitestCoverage.mode, "unknown");
});

test("the shared diff reader keeps scratch cwd and distinguishes unreadable from empty", () => {
  let observed;
  assert.deepEqual(changedFilesAgainst(BASE, { readGit: (args, options) => {
    observed = { args, options }; return "  apps/web/lib/example.ts\n\n";
  } }), ["apps/web/lib/example.ts"]);
  assert.deepEqual(observed.args, ["diff", "--name-only", `${BASE}...HEAD`]);
  assert.equal(observed.options.cwd, process.cwd());
  assert.equal(changedFilesAgainst(BASE, { readGit: () => null }), null);
  assert.deepEqual(changedFilesAgainst(BASE, { readGit: () => "" }), []);
  assert.equal(changedFilesAgainst("", { readGit: () => { throw new Error("must not read absent base"); } }), null);
});
