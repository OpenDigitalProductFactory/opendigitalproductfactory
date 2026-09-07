import { describe, expect, it, vi } from "vitest";

import type { InitiativeReadinessDecision } from "./types";
import { completeEpicTransition, convergeEpicReceiptAnchor } from "./epic-terminal-transition";
import { readinessRequirement } from "./readiness-guidance";

function projected(verdict: "allowed" | "input-required") {
  const decision: InitiativeReadinessDecision = {
    decisionId: "unpersisted", policyVersion: "initiative-readiness.v1",
    subject: { kind: "backlog-item", id: "BI-ANCHOR" },
    transitionObject: { kind: "epic", id: "epic-row-1", expectedVersion: "open", targetState: "done" },
    profile: "feature", target: "completion", verdict, satisfied: [], blockers: [],
    unmet: verdict === "allowed" ? [] : [readinessRequirement({
      code: "OBJECTIVE_RECONCILIATION_REQUIRED",
      state: "missing",
      accountableRole: "acceptance-reviewer",
    })],
    evaluatedAt: "2026-08-22T08:00:00.000Z",
  };
  return { governed: true, baselineId: "BASE-1", inheritedFrom: null, artifactHints: { hasSpec: true, hasPlan: true }, planArtifact: null, decision };
}

function fakeDb(options?: { anchored?: boolean; childStatus?: string }) {
  const anchor = {
    id: "backlog-row-1", itemId: "BI-ANCHOR", type: "portfolio", source: "user-request", workType: "feature",
    scopeKind: "platform", archetypeCategories: [], archetypeIds: [], organizationId: "org-1", epicId: "epic-row-1",
    activities: [],
  };
  const epic = {
    id: "epic-row-1", epicId: "EP-1", status: "open", originatingBacklogItemId: options?.anchored === false ? null : anchor.id,
    originatingBacklogItem: options?.anchored === false ? null : anchor,
    items: [{ id: "child-1", itemId: "BI-CHILD", status: options?.childStatus ?? "done" }],
    submittedById: "user-1",
  };
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const tx = {
    $queryRawUnsafe: vi.fn(async () => []),
    epic: {
      findFirst: vi.fn(async (args: any) => args?.where?.originatingBacklogItemId ? null : epic),
      findUnique: vi.fn(async () => epic),
      updateMany,
    },
    backlogItem: { findFirst: vi.fn(async () => anchor), findUnique: vi.fn(async () => anchor) },
    backlogItemActivity: { create: vi.fn(async (args: unknown) => args) },
    authorizationDecisionLog: { create: vi.fn(async (args: unknown) => args) },
  };
  return {
    epic, updateMany, tx,
    db: { $transaction: async <T>(work: (client: typeof tx) => Promise<T>) => work(tx) },
  };
}

const actor = { actorType: "human" as const, actorRef: "user-1", humanContextRef: "user-1", agentContextRef: null };
const authority = {
  organizationId: "org-1", actionKey: "complete_epic", objectRef: "EP-1", rationale: { capability: "manage_backlog" },
  authoritySnapshot: {
    decision: "allow" as const, effectiveHumanCapability: "manage_backlog", effectiveAgentGrant: "human-session",
    tokenScope: "organization", organizationId: "org-1", actionKey: "complete_epic", policyVersion: "coworker-authority.v1",
  },
};

describe("completeEpicTransition", () => {
  it("returns input-required for an unanchored epic without mutating", async () => {
    const fake = fakeDb({ anchored: false });
    const result = await completeEpicTransition({
      db: fake.db, epicId: "EP-1", expectedStatus: "open", actor, authority,
    });
    expect(result).toMatchObject({ ok: false, code: "CLASSIFICATION_REQUIRED" });
    expect(fake.updateMany).not.toHaveBeenCalled();
  });

  it("CAS-completes an anchored epic only after objective reconciliation", async () => {
    const fake = fakeDb();
    const result = await completeEpicTransition({
      db: fake.db, epicId: "EP-1", expectedStatus: "open", actor, authority,
      dependencies: {
        reconcileObjectives: () => ({ state: "pass", baselineId: "BASE-1", evidenceRefs: ["E-1"], requiredStatementIds: ["OBJ-1"] }),
        projectReadiness: () => projected("allowed"),
      },
    });
    expect(result.ok).toBe(true);
    expect(fake.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "epic-row-1", status: "open" },
      data: expect.objectContaining({ status: "done" }),
    }));
  });

  it("denies completion while a child remains non-terminal", async () => {
    const fake = fakeDb({ childStatus: "in-progress" });
    const result = await completeEpicTransition({
      db: fake.db, epicId: "EP-1", expectedStatus: "open", actor, authority,
      dependencies: {
        reconcileObjectives: () => ({ state: "pass", baselineId: "BASE-1", evidenceRefs: ["E-1"], requiredStatementIds: ["OBJ-1"] }),
        projectReadiness: () => projected("allowed"),
      },
    });
    expect(result).toMatchObject({ ok: false, code: "DEPENDENCY_UNRESOLVED" });
    expect(fake.updateMany).not.toHaveBeenCalled();
  });
});

describe("convergeEpicReceiptAnchor", () => {
  it("locks and records a previously unanchored epic's canonical receipt anchor", async () => {
    const fake = fakeDb({ anchored: false });
    const result = await convergeEpicReceiptAnchor({
      db: fake.db, epicId: "EP-1", backlogItemId: "BI-ANCHOR", actor,
    });
    expect(result).toEqual({ epicId: "EP-1", backlogItemId: "BI-ANCHOR", changed: true });
    expect(fake.updateMany).toHaveBeenCalledWith({
      where: { id: "epic-row-1", originatingBacklogItemId: null },
      data: { originatingBacklogItemId: "backlog-row-1" },
    });
    expect(fake.tx.backlogItemActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "epic_receipt_anchor_change" }),
    }));
  });
});
