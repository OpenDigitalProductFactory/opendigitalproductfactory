// BI-42399593: a done transition records the delivered work's outcome
// observation in its own transaction, isolated by a savepoint so that a
// recording failure never blocks or reverses the delivery.
import { describe, expect, it, vi } from "vitest";

vi.mock("./canonical-artifact-discovery", () => ({ prepareCurrentDesignObservation: vi.fn(async () => ({
  evidence: { state: "not-applicable" }, admissionGuard: async () => ({ state: "not-applicable" }),
})) }));

import type { InitiativeReadinessDecision } from "./types";
import { completeBacklogItemTransition } from "./backlog-terminal-transition";

const allowed: InitiativeReadinessDecision = {
  decisionId: "unpersisted",
  policyVersion: "initiative-readiness.v1",
  subject: { kind: "backlog-item", id: "BI-1" },
  transitionObject: { kind: "backlog-item", id: "row-1", expectedVersion: "in-progress", targetState: "done" },
  profile: "feature",
  target: "completion",
  verdict: "allowed",
  satisfied: [],
  unmet: [],
  blockers: [],
  evaluatedAt: "2026-10-28T08:00:00.000Z",
};

function fakeDb(casCount = 1) {
  const statements: string[] = [];
  const item = {
    id: "row-1", itemId: "BI-1", status: "in-progress", workType: "feature",
    type: "portfolio", source: "user-request", scopeKind: "platform",
    archetypeCategories: [], archetypeIds: [], organizationId: null, epicId: null,
    claimedAt: new Date("2026-10-28T07:00:00.000Z"), createdAt: new Date("2026-10-28T06:00:00.000Z"),
    digitalProductId: null, activeBuild: null, productObjectiveWork: [],
  };
  const tx = {
    $queryRawUnsafe: vi.fn(async () => []),
    $executeRawUnsafe: vi.fn(async (query: string) => { statements.push(query); return 0; }),
    backlogItem: {
      findFirst: vi.fn(async () => item),
      findUnique: vi.fn(async () => item),
      updateMany: vi.fn(async () => ({ count: casCount })),
    },
    backlogItemActivity: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async (args: unknown) => args),
    },
    authorizationDecisionLog: { create: vi.fn(async (args: unknown) => args) },
  };
  return { tx, statements, db: { $transaction: async <T>(work: (client: typeof tx) => Promise<T>) => work(tx) } };
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

const dependencies = {
  resolveDeploymentClosure: async () => ({ kind: "unavailable" as const, reason: "isolated fixture" }),
  resolveCompletionEvidence: async () => ({ kind: "not-found" as const, itemId: "BI-1" }),
  reconcileObjectives: () => ({ state: "missing" as const, baselineId: null, evidenceRefs: [], requiredStatementIds: [] }),
  resolveMergeDelivery: async () => "merged" as const,
  resolveHasDesignSpec: async () => false,
  projectReadiness: () => ({ governed: true, baselineId: null, inheritedFrom: null,
    artifactHints: { hasSpec: false, hasPlan: false }, planArtifact: null, decision: allowed }) as never,
};

function complete(fake: ReturnType<typeof fakeDb>, recordDeliveredOutcome: (tx: unknown, input: { backlogItemRowId: string; observedAt: Date }) => Promise<unknown>) {
  return completeBacklogItemTransition({
    db: fake.db as never,
    itemId: "BI-1",
    expectedStatus: "in-progress",
    resolution: "Merged through the queue.",
    completionEvidence: {},
    actor,
    authority,
    evaluatedAt: "2026-10-28T08:00:00.000Z",
    dependencies,
    recordDeliveredOutcome,
  });
}

describe("delivered outcome recording on the done transition", () => {
  it("records the delivered item's outcome inside the transition, behind a savepoint", async () => {
    const fake = fakeDb();
    const recorder = vi.fn(async () => ({ recorded: true }));

    const result = await complete(fake, recorder);

    expect(result.ok).toBe(true);
    expect(recorder).toHaveBeenCalledWith(fake.tx, {
      backlogItemRowId: "row-1",
      observedAt: new Date("2026-10-28T08:00:00.000Z"),
    });
    expect(fake.statements).toEqual([
      expect.stringMatching(/^SAVEPOINT /),
      expect.stringMatching(/^RELEASE SAVEPOINT /),
    ]);
  });

  it("keeps the delivery when recording fails, rolling back only the recording", async () => {
    const fake = fakeDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await complete(fake, async () => { throw new Error("objective store unavailable"); });

    expect(result.ok).toBe(true);
    expect(fake.tx.backlogItem.updateMany).toHaveBeenCalledTimes(1);
    expect(fake.statements).toEqual([
      expect.stringMatching(/^SAVEPOINT /),
      expect.stringMatching(/^ROLLBACK TO SAVEPOINT /),
      expect.stringMatching(/^RELEASE SAVEPOINT /),
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("BI-1"), expect.any(Error));
    warn.mockRestore();
  });

  it("records nothing when the compare-and-set did not move the item", async () => {
    const fake = fakeDb(0);
    const recorder = vi.fn(async () => ({ recorded: true }));

    await complete(fake, recorder).catch(() => undefined);

    expect(recorder).not.toHaveBeenCalled();
  });
});
