import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateSeedFitGate, normalizeGithubLabels } from "./lib/seed-fit-gate.mjs";

describe("seed-fit PR gate", () => {
  it("normalizes GitHub label objects without workflow wildcards", () => {
    assert.deepEqual(normalizeGithubLabels([
      { id: 1, name: "seed-fit:vertical-scoped", color: "123456" },
      "merge-ready",
      { id: 2 },
    ]), ["seed-fit:vertical-scoped", "merge-ready"]);
  });

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
    // A label carries the DECISION but cannot carry the evidence, so an unscoped
    // decision is complete on its own.
    assert.deepEqual(evaluateSeedFitGate({
      changedFiles: ["packages/db/src/seed-skills.ts"],
      prBody: "",
      labels: ["seed-fit:global-default"],
    }).ok, true);
  });

  // BI-B507DBD1. A scoped claim owes the mechanism that enforces it, however the
  // decision arrived. Without this a change could answer "vertical-scoped" and
  // ship globally, because nothing downstream read the answer.
  it("fails a scoped decision that names no enforcement mechanism", () => {
    const result = evaluateSeedFitGate({
      changedFiles: ["packages/db/src/seed-skills.ts"],
      prBody: "",
      labels: ["seed-fit:vertical-scoped"],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "scope-mechanism-unproven");
    assert.equal(result.mechanism.reason, "missing-mechanism");
  });

  it("passes a label-sourced scoped decision whose body names a wired mechanism", () => {
    const result = evaluateSeedFitGate({
      changedFiles: ["packages/db/src/seed-skills.ts"],
      prBody: "Seed-Fit-Decision: vertical-scoped mechanism=seed-gate symbol=skillAppliesToInstall",
      labels: ["seed-fit:vertical-scoped"],
      readFile: () => "if (!skillAppliesToInstall(slug, install)) return;",
    });
    assert.equal(result.ok, true);
    assert.equal(result.mechanism.reason, "mechanism-wired");
  });

  it("fails a scoped decision whose named rule appears in no changed file", () => {
    const result = evaluateSeedFitGate({
      changedFiles: ["packages/db/src/seed-skills.ts"],
      prBody: "Seed-Fit-Decision: vertical-scoped mechanism=read-scope symbol=neverWired",
      labels: [],
      readFile: () => "export const SKILLS = [];",
    });
    assert.equal(result.ok, false);
    assert.equal(result.mechanism.reason, "symbol-not-in-diff");
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
