import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateSeedFitGate } from "./lib/seed-fit-gate.mjs";

describe("seed-fit PR gate", () => {
  it("passes code-only changes without seed-fit metadata", () => {
    assert.deepEqual(evaluateSeedFitGate({
      changedFiles: ["apps/web/components/CustomerTable.tsx"],
      prBody: "",
      labels: [],
    }), { ok: true, reason: "no-seed-content", seedPaths: [], decision: null });
  });

  it("fails a seeded-content change with no decision", () => {
    assert.deepEqual(evaluateSeedFitGate({
      changedFiles: ["packages/db/src/seed-skills.ts"],
      prBody: "",
      labels: [],
    }), {
      ok: false,
      reason: "missing-decision",
      seedPaths: ["packages/db/src/seed-skills.ts"],
      decision: null,
    });
  });

  it("passes an eligible decision from the PR body", () => {
    assert.deepEqual(evaluateSeedFitGate({
      changedFiles: ["prompts/reviewer/code-review.prompt.md"],
      prBody: "Seed-Fit-Decision: global-default",
      labels: [],
    }).ok, true);
  });

  it("passes an eligible decision from a label", () => {
    assert.deepEqual(evaluateSeedFitGate({
      changedFiles: ["packages/db/src/seed-skills.ts"],
      prBody: "",
      labels: ["seed-fit:vertical-scoped"],
    }).ok, true);
  });

  it("fails contradictory body and label decisions", () => {
    assert.deepEqual(evaluateSeedFitGate({
      changedFiles: ["packages/db/src/seed-skills.ts"],
      prBody: "Seed-Fit-Decision: global-default",
      labels: ["seed-fit:vertical-scoped"],
    }).reason, "contradictory-decisions");
  });

  it("fails invalid decision metadata", () => {
    assert.deepEqual(evaluateSeedFitGate({
      changedFiles: ["packages/db/src/seed-skills.ts"],
      prBody: "Seed-Fit-Decision: everywhere",
      labels: [],
    }).reason, "invalid-decision");
  });

  it("fails decisions that explicitly require remediation or rejection", () => {
    for (const decision of ["parameterize-first", "install-local-only", "reject-as-seed"]) {
      assert.deepEqual(evaluateSeedFitGate({
        changedFiles: ["packages/db/src/seed-skills.ts"],
        prBody: `Seed-Fit-Decision: ${decision}`,
        labels: [],
      }).reason, "decision-not-merge-eligible");
    }
  });
});
