import { describe, expect, it, vi } from "vitest";

import type { InitiativeReadinessDecision } from "./types";
import { completeWorkCapsuleTransition } from "./work-capsule-terminal-transition";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";

function projected(verdict: "allowed" | "input-required") {
  const decision: InitiativeReadinessDecision = {
    decisionId: "unpersisted", policyVersion: "initiative-readiness.v1",
    subject: { kind: "backlog-item", id: "BI-1" },
    transitionObject: { kind: "work-capsule", id: "capsule-row-1", expectedVersion: "working", targetState: "complete" },
    profile: "feature", target: "completion", verdict, satisfied: [], blockers: [],
    unmet: verdict === "allowed" ? [] : [readinessRequirement({ code: "OBJECTIVE_RECONCILIATION_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" })],
    evaluatedAt: "2026-08-22T08:00:00.000Z",
  };
  return { governed: true, baselineId: "BASE-1", inheritedFrom: null, artifactHints: { hasSpec: true, hasPlan: true }, planArtifact: null, decision };
}

function terminalDecisionActivity() {
  const decision = {
    ...projected("allowed").decision,
    transitionObject: { kind: "backlog-item" as const, id: "row-1", expectedVersion: "in-progress", targetState: "done" },
  };
  return {
    id: "IRD-ACTIVITY-1",
    kind: "initiative_readiness_decision",
    gateKey: null,
    recordedAt: new Date("2026-09-06T23:00:00.000Z"),
    payload: {
      schemaVersion: 1,
      ...decision,
      enforcementState: "enforced",
      factsDigest: "sha256:terminal-facts",
      authorityDecisionId: "DI-TERMINAL-1",
      authoritySnapshot: {
        decision: "allow",
        effectiveHumanCapability: "manage_backlog",
        effectiveAgentGrant: "update_backlog_item_status",
        tokenScope: "organization",
        organizationId: "org-1",
        actionKey: "update_backlog_item_status",
        policyVersion: "coworker-authority.v1",
      },
    },
  };
}

function fakeDb(options: {
  itemStatus?: string;
  activities?: Array<Record<string, unknown>>;
  evidence?: boolean;
  identity?: boolean;
} = {}) {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const capsule = {
    id: "capsule-row-1", capsuleId: "WC-1", status: "working", backlogItemId: "BI-1",
    featureBuildId: null, archivedAt: null, executorRef: "AGT-1",
    leaseHolderPrincipalId: options.identity === false ? "PRN-OTHER" : "PRN-1", workspaceState: {},
  };
  const item = {
    id: "row-1", itemId: "BI-1", status: options.itemStatus ?? "in-progress", type: "portfolio", source: "user-request", workType: "feature",
    scopeKind: "platform", archetypeCategories: [], archetypeIds: [], organizationId: "org-1", activities: options.activities ?? [],
  };
  const tx = {
    $queryRawUnsafe: vi.fn(async () => []),
    workroom: { findUnique: vi.fn(async () => capsule), updateMany },
    workroomActivity: {
      findMany: vi.fn(async () => options.evidence === false ? [] : [{ id: "WE-1", kind: "evidence-recorded", recordedAt: new Date(), payload: { kind: "verification", result: { verdict: "passed" } } }]),
      create: vi.fn(async (args: unknown) => args),
    },
    backlogItem: { findFirst: vi.fn(async () => item) },
    featureBuild: { findUnique: vi.fn(async () => null) },
    backlogItemActivity: { create: vi.fn(async (args: unknown) => args) },
    authorizationDecisionLog: { create: vi.fn(async (args: unknown) => args) },
  };
  return { updateMany, db: { $transaction: async <T>(work: (client: typeof tx) => Promise<T>) => work(tx) } };
}

const actor = { userId: "user-1", agentId: "AGT-1", principalId: "PRN-1" };

describe("completeWorkCapsuleTransition", () => {
  it("reuses an enforced allowed completion decision for the linked done item", async () => {
    const fake = fakeDb({ itemStatus: "done", activities: [terminalDecisionActivity()] });
    const result = await completeWorkCapsuleTransition({
      db: fake.db, capsuleId: "WC-1", expectedStatus: "working", reason: "Finished", actor,
      dependencies: {
        reconcileObjectives: () => ({ state: "missing", baselineId: "BASE-OLD", evidenceRefs: [], requiredStatementIds: ["OBJ-1"] }),
        projectReadiness: () => projected("input-required"),
      },
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.decision).toMatchObject({
      verdict: "allowed",
      transitionObject: { kind: "work-capsule", id: "capsule-row-1", expectedVersion: "working", targetState: "complete" },
      satisfied: expect.arrayContaining([
        expect.objectContaining({ code: "DELIVERY_EVIDENCE_REQUIRED", evidenceRefs: ["WE-1"] }),
        expect.objectContaining({ code: "CAPSULE_IDENTITY_MISMATCH", evidenceRefs: ["WC-1"] }),
      ]),
    });
    expect(fake.updateMany).toHaveBeenCalledOnce();
  });

  it.each([
    ["a non-done linked item", { itemStatus: "in-progress" }],
    ["missing Workroom delivery evidence", { itemStatus: "done", evidence: false }],
    ["a failed Workroom lease identity", { itemStatus: "done", identity: false }],
  ])("does not reuse the item decision for %s", async (_label, options) => {
    const fake = fakeDb({ ...options, activities: [terminalDecisionActivity()] });
    const result = await completeWorkCapsuleTransition({
      db: fake.db, capsuleId: "WC-1", expectedStatus: "working", reason: "Finished", actor,
      dependencies: {
        reconcileObjectives: () => ({ state: "missing", baselineId: "BASE-OLD", evidenceRefs: [], requiredStatementIds: ["OBJ-1"] }),
        projectReadiness: () => projected("input-required"),
      },
    });

    expect(result).toMatchObject({ ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED" });
    expect(fake.updateMany).not.toHaveBeenCalled();
  });

  it("does not reuse a malformed terminal decision", async () => {
    const activity = terminalDecisionActivity();
    activity.payload.enforcementState = "shadow";
    const fake = fakeDb({ itemStatus: "done", activities: [activity] });
    const result = await completeWorkCapsuleTransition({
      db: fake.db, capsuleId: "WC-1", expectedStatus: "working", reason: "Finished", actor,
      dependencies: {
        reconcileObjectives: () => ({ state: "missing", baselineId: "BASE-OLD", evidenceRefs: [], requiredStatementIds: ["OBJ-1"] }),
        projectReadiness: () => projected("input-required"),
      },
    });

    expect(result).toMatchObject({ ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED" });
    expect(fake.updateMany).not.toHaveBeenCalled();
  });

  it("denies a governed capsule when objective reconciliation is incomplete", async () => {
    const fake = fakeDb();
    const result = await completeWorkCapsuleTransition({
      db: fake.db, capsuleId: "WC-1", expectedStatus: "working", reason: "Finished", actor,
      dependencies: {
        reconcileObjectives: () => ({ state: "missing", baselineId: "BASE-1", evidenceRefs: [], requiredStatementIds: ["OBJ-1"] }),
        projectReadiness: () => projected("input-required"),
      },
    });
    expect(result).toMatchObject({ ok: false, code: "OBJECTIVE_RECONCILIATION_REQUIRED" });
    expect(fake.updateMany).not.toHaveBeenCalled();
  });

  it("CAS-completes a governed capsule with live workroom and objective evidence", async () => {
    const fake = fakeDb();
    const result = await completeWorkCapsuleTransition({
      db: fake.db, capsuleId: "WC-1", expectedStatus: "working", reason: "Finished", actor,
      dependencies: {
        reconcileObjectives: () => ({ state: "pass", baselineId: "BASE-1", evidenceRefs: ["E-1"], requiredStatementIds: ["OBJ-1"] }),
        projectReadiness: () => projected("allowed"),
      },
    });
    expect(result.ok).toBe(true);
    expect(fake.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "capsule-row-1", status: "working" },
      data: expect.objectContaining({ status: "complete" }),
    }));
  });
});
