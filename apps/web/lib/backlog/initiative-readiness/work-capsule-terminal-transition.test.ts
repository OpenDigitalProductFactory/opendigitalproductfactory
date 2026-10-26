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
  workspaceState?: unknown;
  itemStatus?: string;
  activities?: Array<Record<string, unknown>>;
  evidence?: boolean;
  identity?: boolean;
} = {}) {
  const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
  const capsule = {
    id: "capsule-row-1", capsuleId: "WC-1", status: "working", backlogItemId: "BI-1",
    featureBuildId: null, archivedAt: null, executorRef: "AGT-1",
    leaseHolderPrincipalId: options.identity === false ? "PRN-OTHER" : "PRN-1", workspaceState: options.workspaceState ?? {},
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
    backlogItem: { findFirst: vi.fn(async (query: { select: { activities: { where: { kind: { in: string[] } } } } }) => ({
      ...item, activities: item.activities.filter((activity) => query.select.activities.where.kind.in.includes(String(activity.kind))),
    })) },
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


it("records the agreed delivery handoff only after canonical completion allows mutation", async () => {
  const { retainDeliveryAgreement } = await import("@/lib/work-management/delivery-agreement");
  const stamp = "2026-10-25T12:00:00.000Z";
  const workspaceState = retainDeliveryAgreement({}, { objective: "Agreed work delivered", backlogItemId: "BI-1",
    capturedAt: stamp, basis: "created", acceptance: null,
    context: { state: "unavailable", checkedAt: stamp, peerRef: null, guidanceState: "unavailable", reason: "No context reader", sourceRefs: [] } });
  const fake = fakeDb({ workspaceState });
  const result = await completeWorkCapsuleTransition({ db: fake.db, capsuleId: "WC-1", expectedStatus: "working", reason: "Agreed result verified", actor,
    evaluatedAt: "2026-10-25T12:30:00.000Z", dependencies: {
      reconcileObjectives: () => ({ state: "pass", baselineId: "BASE-1", evidenceRefs: ["OE-1"], requiredStatementIds: ["OBJ-1"] }),
      projectReadiness: () => projected("allowed"),
    } });
  expect(result.ok).toBe(true);
  const write = fake.updateMany.mock.calls[0]?.[0] as unknown as { data: { workspaceState: Record<string, unknown> } };
  expect(write.data.workspaceState.deliveryAgreement).toEqual(workspaceState.deliveryAgreement);
  expect(write.data.workspaceState.deliveryHandoff).toMatchObject({ baselineId: "BASE-1", evidenceRefs: expect.arrayContaining(["OE-1", "WE-1"]), summary: "Agreed result verified" });
});

it("does not complete a captured agreement against silently replaced body criteria", async () => {
  const { retainDeliveryAgreement } = await import("@/lib/work-management/delivery-agreement");
  const state = retainDeliveryAgreement({}, { objective: "Agreed result", backlogItemId: "BI-1", capturedAt: "2026-10-25T12:00:00Z", basis: "created",
    acceptance: { digest: "sha256:original", criteria: ["Original required behavior"] }, context: { state: "unavailable", guidanceState: "unavailable",
      checkedAt: "2026-10-25T12:00:00Z", peerRef: null, reason: "No permitted source", sourceRefs: [] } });
  const { db, updateMany } = fakeDb({ workspaceState: state, activities: [{ id: "BASE-ACT-1", kind: "initiative_scope_baseline", recordedAt: new Date(),
    payload: { baselineId: "BASE-1", origin: "item-body", criteriaDigest: "sha256:replacement" } }] });
  const result = await completeWorkCapsuleTransition({ db, capsuleId: "WC-1", expectedStatus: "working", reason: "Done",
    actor: { userId: "USER-1", agentId: "AGT-1", principalId: "PRN-1" }, dependencies: {
      reconcileObjectives: () => ({ state: "pass", baselineId: "BASE-1", evidenceRefs: ["OE-1"], requiredStatementIds: ["OBJ-1"] }),
      projectReadiness: () => projected("allowed"),
    } });
  expect(result.ok).toBe(false);
  expect(updateMany).not.toHaveBeenCalled();
});

it("allows harmless body-anchor changes when the agreed criterion statements are still proven", async () => {
  const { retainDeliveryAgreement } = await import("@/lib/work-management/delivery-agreement");
  const { bodyBaselineDigest } = await import("./body-baseline-version");
  const state = retainDeliveryAgreement({}, { objective: "Agreed result", backlogItemId: "BI-1", capturedAt: "2026-10-25T12:00:00Z", basis: "created",
    acceptance: { digest: "sha256:original-anchors", criteria: ["Original required behavior"] }, context: { state: "unavailable", guidanceState: "unavailable",
      checkedAt: "2026-10-25T12:00:00Z", peerRef: null, reason: "No permitted source", sourceRefs: [] } });
  const { db, updateMany } = fakeDb({ workspaceState: state, activities: [{ id: "BASE-ACT-1", kind: "initiative_scope_baseline", recordedAt: new Date(),
    payload: { baselineId: "BASE-1", origin: "item-body", criteriaDigest: "sha256:new-anchors", acceptanceStatements: [
      { acceptanceId: "AC-BODY-001", artifactAnchor: "line:5", statementDigest: bodyBaselineDigest("Original required behavior") }] } }] });
  const result = await completeWorkCapsuleTransition({ db, capsuleId: "WC-1", expectedStatus: "working", reason: "Done",
    actor: { userId: "USER-1", agentId: "AGT-1", principalId: "PRN-1" }, dependencies: {
      reconcileObjectives: () => ({ state: "pass", baselineId: "BASE-1", evidenceRefs: ["OE-1"], requiredStatementIds: ["AC-BODY-001"] }),
      projectReadiness: () => projected("allowed"),
    } });
  expect(result.ok).toBe(true);
  expect(updateMany).toHaveBeenCalledOnce();
});
