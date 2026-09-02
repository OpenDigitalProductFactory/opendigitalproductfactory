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
  return { governed: true, baselineId: "BASE-1", artifactHints: { hasSpec: true, hasPlan: true }, decision };
}

function fakeDb(casCount = 1) {
  const creates: unknown[] = [];
  const updateMany = vi.fn(async () => ({ count: casCount }));
  const item = {
    id: "row-1", itemId: "BI-1", status: "in-progress", workType: "feature",
    type: "portfolio", source: "user-request", scopeKind: "platform",
    archetypeCategories: [], archetypeIds: [], organizationId: "org-1", epicId: null,
    claimedAt: new Date("2026-08-22T07:00:00.000Z"), createdAt: new Date("2026-08-22T06:00:00.000Z"),
    activeBuild: null,
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
});
