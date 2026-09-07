import { describe, expect, it, vi } from "vitest";

import type { InitiativeReadinessDecision } from "./types";
import { completeBacklogItemTransition } from "./backlog-terminal-transition";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";

function projected(verdict: "allowed" | "input-required") {
  const decision: InitiativeReadinessDecision = {
    decisionId: "unpersisted",
    policyVersion: "initiative-readiness.v1",
    subject: { kind: "backlog-item", id: "BI-1" },
    transitionObject: { kind: "backlog-item", id: "row-1", expectedVersion: "in-progress", targetState: "done" },
    profile: "feature",
    target: "completion",
    verdict,
    satisfied: [],
    unmet: verdict === "allowed" ? [] : [readinessRequirement({
      code: "OBJECTIVE_RECONCILIATION_REQUIRED",
      state: "missing",
      accountableRole: "acceptance-reviewer",
    })],
    blockers: [],
    evaluatedAt: "2026-08-22T08:00:00.000Z",
  };
  return { governed: true, baselineId: "BASE-1", inheritedFrom: null, artifactHints: { hasSpec: true, hasPlan: true }, planArtifact: null, decision };
}

function fakeDb(casCount = 1, workType = "feature", itemOverrides: Record<string, unknown> = {}) {
  const creates: unknown[] = [];
  const updateMany = vi.fn(async () => ({ count: casCount }));
  const item = {
    id: "row-1", itemId: "BI-1", status: "in-progress", workType,
    type: "portfolio", source: "user-request", scopeKind: "platform",
    archetypeCategories: [], archetypeIds: [], organizationId: "org-1", epicId: null,
    claimedAt: new Date("2026-08-22T07:00:00.000Z"), createdAt: new Date("2026-08-22T06:00:00.000Z"),
    digitalProductId: null, activeBuild: null, productObjectiveWork: [],
    ...itemOverrides,
  };
  const tx = {
    $queryRawUnsafe: vi.fn(async () => []),
    backlogItem: {
      findFirst: vi.fn(async () => item),
      findUnique: vi.fn(async () => item),
      updateMany,
    },
    backlogItemActivity: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async (args: unknown) => { creates.push(args); return args; }),
    },
    authorizationDecisionLog: { create: vi.fn(async (args: unknown) => args) },
  };
  return {
    creates,
    updateMany,
    db: { $transaction: async <T>(work: (client: typeof tx) => Promise<T>) => work(tx) },
  };
}

const actor = { actorType: "agent" as const, actorRef: "AGT-1", humanContextRef: "user-1", agentContextRef: "AGT-1" };
const authority = {
  organizationId: "org-1",
  actionKey: "complete_backlog_item",
  objectRef: "BI-1",
  rationale: { capability: "manage_backlog" },
  authoritySnapshot: {
    decision: "allow" as const,
    effectiveHumanCapability: "manage_backlog",
    effectiveAgentGrant: "initiative_completion",
    tokenScope: "organization",
    organizationId: "org-1",
    actionKey: "complete_backlog_item",
    policyVersion: "coworker-authority.v1",
  },
};

describe("completeBacklogItemTransition", () => {
  it("refuses a refactor completion with missing governed evidence instead of passing as doc-only", async () => {
    const fake = fakeDb(1, "refactor");
    const result = await completeBacklogItemTransition({
      db: fake.db,
      itemId: "BI-1",
      expectedStatus: "in-progress",
      resolution: "Refactored the governed boundary.",
      completionEvidence: {},
      actor,
      authority,
      dependencies: {
        resolveCompletionEvidence: async () => ({
          kind: "evaluated",
          item: { id: "row-1", itemId: "BI-1", status: "in-progress", workType: "refactor" },
          verdict: {
            allowed: true,
            noOp: false,
            normalizedManifest: {
              workClass: "implementation",
              evidenceActivityIds: ["E-1"],
              useActiveBuildEvidence: false,
            },
            blockers: [],
            nextAction: null,
          },
        }),
        reconcileObjectives: () => ({
          state: "missing",
          baselineId: null,
          evidenceRefs: [],
          requiredStatementIds: [],
        }),
      },
    });

    expect(result).toMatchObject({ ok: false, decision: { profile: "feature" } });
    expect(fake.updateMany).not.toHaveBeenCalled();
  });

  it("does not mutate when server-derived objective reconciliation is incomplete", async () => {
    const fake = fakeDb();
    const result = await completeBacklogItemTransition({
      db: fake.db,
      itemId: "BI-1",
      expectedStatus: "in-progress",
      resolution: "Implemented the governed change.",
      completionEvidence: {},
      actor,
      authority,
      dependencies: {
        resolveCompletionEvidence: async () => ({ kind: "evaluated", item: { id: "row-1", itemId: "BI-1", status: "in-progress", workType: "feature" }, verdict: { allowed: true, noOp: false, normalizedManifest: null, blockers: [], nextAction: null } }),
        reconcileObjectives: () => ({ state: "missing", baselineId: "BASE-1", evidenceRefs: [], requiredStatementIds: ["OBJ-1"] }),
        resolveMergeDelivery: async () => false,
        projectReadiness: () => projected("input-required"),
      },
    });

    expect(result).toMatchObject({ ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED" });
    expect(fake.updateMany).not.toHaveBeenCalled();
  });

  it("uses an exact status compare-and-set and records the status change after allowed readiness", async () => {
    const fake = fakeDb();
    const result = await completeBacklogItemTransition({
      db: fake.db,
      itemId: "BI-1",
      expectedStatus: "in-progress",
      resolution: "Implemented the governed change.",
      completionEvidence: {},
      actor,
      authority,
      dependencies: {
        resolveCompletionEvidence: async () => ({ kind: "evaluated", item: { id: "row-1", itemId: "BI-1", status: "in-progress", workType: "feature" }, verdict: { allowed: true, noOp: false, normalizedManifest: { workClass: "implementation", evidenceActivityIds: ["E-1"], useActiveBuildEvidence: false }, blockers: [], nextAction: null } }),
        reconcileObjectives: () => ({ state: "pass", baselineId: "BASE-1", evidenceRefs: ["E-1"], requiredStatementIds: ["OBJ-1"] }),
        resolveMergeDelivery: async () => false,
        projectReadiness: () => projected("allowed"),
      },
    });

    expect(result.ok).toBe(true);
    expect(fake.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "row-1", status: "in-progress" },
      data: expect.objectContaining({ status: "done", claimStatus: "released" }),
    }));
    expect(fake.creates).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ kind: "status_change" }) }),
    ]));
  });

  it("BI-B04A0203: a merge through CI + the merge queue satisfies delivery even with a missing manifest", async () => {
    const fake = fakeDb();
    const seen: Array<{ deliveryEvidence: string; requirementReasons?: Record<string, string[]> }> = [];
    await completeBacklogItemTransition({
      db: fake.db,
      itemId: "BI-1",
      expectedStatus: "in-progress",
      resolution: "Landed direct through the merge queue.",
      completionEvidence: {},
      actor,
      authority,
      dependencies: {
        // No hand-built manifest — delivery would otherwise read `missing`.
        resolveCompletionEvidence: async () => ({ kind: "not-found", itemId: "BI-1" }),
        reconcileObjectives: () => ({ state: "pass", baselineId: "BASE-1", evidenceRefs: ["E-1"], requiredStatementIds: ["OBJ-1"] }),
        resolveMergeDelivery: async () => true,
        projectReadiness: ((input: { completion: { deliveryEvidence: string; requirementReasons?: Record<string, string[]> } }) => { seen.push(input.completion); return projected("allowed"); }) as never,
      },
    });
    expect(seen[0]?.deliveryEvidence).toBe("pass");
    // The stale "missing production-build" reason is cleared, not carried.
    expect(seen[0]?.requirementReasons?.DELIVERY_EVIDENCE_REQUIRED ?? []).toEqual([]);
  });

  it("BI-B04A0203: an UNMERGED branch falls back to the recorded delivery manifest", async () => {
    const fake = fakeDb();
    const seen: Array<{ deliveryEvidence: string }> = [];
    await completeBacklogItemTransition({
      db: fake.db,
      itemId: "BI-1",
      expectedStatus: "in-progress",
      resolution: "Not yet merged.",
      completionEvidence: {},
      actor,
      authority,
      dependencies: {
        resolveCompletionEvidence: async () => ({ kind: "not-found", itemId: "BI-1" }),
        reconcileObjectives: () => ({ state: "missing", baselineId: "BASE-1", evidenceRefs: [], requiredStatementIds: ["OBJ-1"] }),
        resolveMergeDelivery: async () => false,
        projectReadiness: ((input: { completion: { deliveryEvidence: string } }) => { seen.push(input.completion); return projected("input-required"); }) as never,
      },
    });
    expect(seen[0]?.deliveryEvidence).toBe("missing");
  });

  it("EP-4614F35E: RECOGNIZES direct-merge platform work merged through the gates (relaxes design + acceptance)", async () => {
    // platform scope, no build, no product, no objective, merged, spec present.
    const fake = fakeDb(1, "feature", { scopeKind: "platform", digitalProductId: null, activeBuild: null, productObjectiveWork: [] });
    const seen: Array<{ recognizeMergeThroughGates?: boolean; completion: { deliveryEvidence: string; acceptanceEvidence: string; objectiveReconciliation: string } }> = [];
    await completeBacklogItemTransition({
      db: fake.db,
      itemId: "BI-1",
      expectedStatus: "in-progress",
      resolution: "Direct-merge platform work landed through the merge queue.",
      completionEvidence: {},
      actor,
      authority,
      dependencies: {
        resolveCompletionEvidence: async () => ({ kind: "not-found", itemId: "BI-1" }),
        // No objective baseline to reconcile (the whole point — merged platform work).
        reconcileObjectives: () => ({ state: "missing", baselineId: null, evidenceRefs: [], requiredStatementIds: [] }),
        resolveMergeDelivery: async () => true,
        resolveHasDesignSpec: async () => true,
        projectReadiness: ((input: { recognizeMergeThroughGates?: boolean; completion: { deliveryEvidence: string; acceptanceEvidence: string; objectiveReconciliation: string } }) => { seen.push(input); return projected("allowed"); }) as never,
      },
    });
    expect(seen[0]?.recognizeMergeThroughGates).toBe(true);
    expect(seen[0]?.completion.deliveryEvidence).toBe("pass");
    expect(seen[0]?.completion.acceptanceEvidence).toBe("pass");
    expect(seen[0]?.completion.objectiveReconciliation).toBe("pass");
  });

  it("EP-4614F35E: does NOT recognize demand-driven feature work (linked DigitalProduct) even when merged", async () => {
    const fake = fakeDb(1, "feature", { scopeKind: "platform", digitalProductId: "DP-1" });
    const seen: Array<{ recognizeMergeThroughGates?: boolean; completion: { acceptanceEvidence: string } }> = [];
    await completeBacklogItemTransition({
      db: fake.db,
      itemId: "BI-1",
      expectedStatus: "in-progress",
      resolution: "Product feature — full lifecycle required.",
      completionEvidence: {},
      actor,
      authority,
      dependencies: {
        resolveCompletionEvidence: async () => ({ kind: "not-found", itemId: "BI-1" }),
        reconcileObjectives: () => ({ state: "missing", baselineId: null, evidenceRefs: [], requiredStatementIds: [] }),
        resolveMergeDelivery: async () => true,
        resolveHasDesignSpec: async () => true,
        projectReadiness: ((input: { recognizeMergeThroughGates?: boolean; completion: { acceptanceEvidence: string } }) => { seen.push(input); return projected("input-required"); }) as never,
      },
    });
    expect(seen[0]?.recognizeMergeThroughGates).toBe(false);
    // Acceptance is NOT waved through for product work with no reconciliation.
    expect(seen[0]?.completion.acceptanceEvidence).toBe("missing");
  });
});

describe("pullRequestNumbersFromActivities (BI-AFE8BB73)", () => {
  it("reads distinct PR numbers from evidence links and ignores everything else", async () => {
    const { pullRequestNumbersFromActivities } = await import("./backlog-terminal-transition");
    expect(pullRequestNumbersFromActivities([
      { kind: "evidence", payload: { url: "https://github.com/o/r/pull/5119" } },
      { kind: "evidence", payload: { url: "https://github.com/o/r/pull/5119/files" } },
      { kind: "evidence", payload: { url: "https://github.com/o/r/pull/5124?x=1" } },
      { kind: "evidence", payload: { url: "https://github.com/o/r/issues/12" } },
      { kind: "initiative_gate_receipt", payload: { url: "https://github.com/o/r/pull/7" } },
      { kind: "evidence", payload: null },
    ])).toEqual([5119, 5124]);
  });
});
