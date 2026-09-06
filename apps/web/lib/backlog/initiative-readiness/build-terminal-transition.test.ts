import { describe, expect, it, vi } from "vitest";

import type { InitiativeReadinessDecision } from "./types";
import { completeFeatureBuildTransition } from "./build-terminal-transition";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";

function projection(verdict: "allowed" | "input-required") {
  const decision: InitiativeReadinessDecision = {
    decisionId: "unpersisted",
    policyVersion: "initiative-readiness.v1",
    subject: { kind: "backlog-item", id: "BI-1" },
    transitionObject: { kind: "feature-build", id: "build-row-1", expectedVersion: "ship", targetState: "complete" },
    profile: "feature",
    target: "completion",
    verdict,
    satisfied: [],
    unmet: verdict === "allowed" ? [] : [readinessRequirement({ code: "OBJECTIVE_RECONCILIATION_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" })],
    blockers: [],
    evaluatedAt: "2026-08-22T08:00:00.000Z",
  };
  return { governed: true, baselineId: "BASE-1", inheritedFrom: null, artifactHints: { hasSpec: true, hasPlan: true }, decision };
}

function fakeDb() {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const build = {
    id: "build-row-1", buildId: "FB-1", phase: "ship", kind: "feature",
    verificationOut: { typecheckPassed: true, testsFailed: 0, buildPassed: true },
    uxVerificationStatus: "complete",
    originator: {
      id: "row-1", itemId: "BI-1", type: "portfolio", source: "user-request", workType: "feature",
      scopeKind: "platform", archetypeCategories: [], archetypeIds: [], organizationId: "org-1",
      submittedById: "user-1", activities: [],
    },
  };
  const tx = {
    $queryRawUnsafe: vi.fn(async () => []),
    featureBuild: { findUnique: vi.fn(async () => build), updateMany },
    backlogItemActivity: { create: vi.fn(async (args: unknown) => args) },
    authorizationDecisionLog: { create: vi.fn(async (args: unknown) => args) },
  };
  return { updateMany, db: { $transaction: async <T>(work: (client: typeof tx) => Promise<T>) => work(tx) } };
}

describe("completeFeatureBuildTransition", () => {
  it("keeps the build in ship when objective reconciliation is incomplete", async () => {
    const fake = fakeDb();
    const result = await completeFeatureBuildTransition({
      db: fake.db,
      buildId: "FB-1",
      expectedPhase: "ship",
      dependencies: {
        reconcileObjectives: () => ({ state: "missing", baselineId: "BASE-1", evidenceRefs: [], requiredStatementIds: ["OBJ-1"] }),
        projectReadiness: () => projection("input-required"),
      },
    });
    expect(result).toMatchObject({ ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED" });
    expect(fake.updateMany).not.toHaveBeenCalled();
  });

  it("uses a phase CAS after build delivery and objective evidence pass", async () => {
    const fake = fakeDb();
    const result = await completeFeatureBuildTransition({
      db: fake.db,
      buildId: "FB-1",
      expectedPhase: "ship",
      dependencies: {
        reconcileObjectives: () => ({ state: "pass", baselineId: "BASE-1", evidenceRefs: ["E-1"], requiredStatementIds: ["OBJ-1"] }),
        projectReadiness: () => projection("allowed"),
      },
    });
    expect(result.ok).toBe(true);
    expect(fake.updateMany).toHaveBeenCalledWith({
      where: { id: "build-row-1", phase: "ship" },
      data: { phase: "complete" },
    });
  });
});
