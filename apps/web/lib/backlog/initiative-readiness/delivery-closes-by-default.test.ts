// BI-B1B44777: outcomes define done. A merge through CI and the merge queue
// closes an item by default; a separate acceptance step is owed only by an item
// marked contractual (the reserved `contractual` lifecycle tag, kernel decision
// DI-1263D968DC26). Founder direction 2026-10-27.
//
// Each case drives the real completion gate and the real read projection the
// acceptance sweep reads, so the sweep closes exactly what the gate allows.

import { describe, expect, it, vi } from "vitest";

import { closeAllowedAcceptanceItem } from "@/lib/backlog/acceptance-sweep/acceptance-sweep-close";
import type { CloseAuthorisation } from "@/lib/backlog/acceptance-sweep/close-authorisation";

import { completeBacklogItemTransition } from "./backlog-terminal-transition";
import { CONTRACTUAL_LIFECYCLE_TAG, deliveryClosesItem, isContractualItem, readBacklogItemCompletion } from "./backlog-completion-evaluation";
import type { MergeDeliverySignal } from "./merge-delivery-signal";

const NOW = "2026-10-27T12:00:00.000Z";

/** Customer-facing feature work that the old direct-merge predicate kept open. */
const CUSTOMER_FEATURE = {
  workType: "feature", scopeKind: "archetype-leaf", archetypeIds: ["dry-cleaning-plant-network"],
  digitalProductId: "DP-1", productObjectiveWork: [{ id: "POW-1" }],
};

function fixture(itemOverrides: Record<string, unknown> = {}) {
  const item = {
    id: "row-1", itemId: "BI-1", status: "awaiting-acceptance", workType: "bug",
    type: "product", source: "user-request", title: "A merged change", body: null,
    scopeKind: "platform", archetypeCategories: [], archetypeIds: [], lifecycleTags: [],
    organizationId: "org-1", epicId: null,
    claimedAt: new Date("2026-10-26T07:00:00.000Z"), createdAt: new Date("2026-10-26T06:00:00.000Z"),
    digitalProductId: null, activeBuild: null, productObjectiveWork: [],
    ...itemOverrides,
  };
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const client = {
    $queryRawUnsafe: vi.fn(async () => []),
    backlogItem: {
      findFirst: vi.fn(async () => item),
      findUnique: vi.fn(async () => item),
      updateMany,
    },
    backlogItemActivity: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async (args: unknown) => args),
    },
    authorizationDecisionLog: { create: vi.fn(async (args: unknown) => args) },
  };
  return {
    item, client, updateMany,
    db: { $transaction: async <T>(work: (tx: typeof client) => Promise<T>) => work(client) },
  };
}

function deps(signal: MergeDeliverySignal) {
  return {
    prepareCurrentDesign: async () => ({ evidence: { state: "not-applicable" as const },
      admissionGuard: async () => ({ state: "not-applicable" as const }) }),
    resolveMergeDelivery: async () => signal,
    resolveDeploymentClosure: async () => ({ kind: "unavailable" as const, reason: "no deployment in this fixture" }),
  };
}

const actor = { actorType: "agent" as const, actorRef: "AGT-1", humanContextRef: "user-1", agentContextRef: "AGT-1" };
const authority = {
  organizationId: "org-1",
  actionKey: "complete_backlog_item",
  objectRef: "BI-1",
  rationale: { capability: "manage_backlog" },
  authoritySnapshot: {
    decision: "allow" as const, effectiveHumanCapability: "manage_backlog", effectiveAgentGrant: "initiative_completion",
    tokenScope: "organization", organizationId: "org-1", actionKey: "complete_backlog_item", policyVersion: "coworker-authority.v1",
  },
};

async function read(signal: MergeDeliverySignal, overrides: Record<string, unknown> = {}) {
  const side = fixture(overrides);
  const result = await readBacklogItemCompletion({
    itemRowId: "row-1", status: "awaiting-acceptance", evaluatedAt: NOW,
    db: side.client as never, dependencies: deps(signal),
  });
  return { side, result };
}

function owed(decision: { unmet: { code: string }[]; blockers: { code: string }[] }) {
  return [...decision.unmet, ...decision.blockers].map((entry) => entry.code).sort();
}

describe("the contractual marker (DI-1263D968DC26)", () => {
  it("is the reserved lifecycle tag, read case-insensitively", () => {
    expect(CONTRACTUAL_LIFECYCLE_TAG).toBe("contractual");
    expect(isContractualItem({ lifecycleTags: ["booking", "Contractual"] })).toBe(true);
    expect(isContractualItem({ lifecycleTags: ["booking"] })).toBe(false);
    expect(isContractualItem({})).toBe(false);
  });

  it("delivery closes every non-contractual item, whatever its scope or links", () => {
    expect(deliveryClosesItem({ ...CUSTOMER_FEATURE, lifecycleTags: [] })).toBe(true);
    expect(deliveryClosesItem({ ...CUSTOMER_FEATURE, lifecycleTags: ["contractual"] })).toBe(false);
  });
});

describe("delivery closes a non-contractual item by default (BI-B1B44777)", () => {
  it("a merged customer feature owes no acceptance, objective reconciliation, research or plan after merge", async () => {
    const { result } = await read("merged", CUSTOMER_FEATURE);
    expect(result?.mergedThroughGates).toBe("merged");
    expect(result?.decision.verdict).toBe("allowed");
    expect(owed(result!.decision)).toEqual([]);
  });

  it("the completion gate agrees with the read and closes it", async () => {
    const side = fixture(CUSTOMER_FEATURE);
    const gate = await completeBacklogItemTransition({
      db: side.db as never, itemId: "BI-1", expectedStatus: "awaiting-acceptance",
      resolution: "Merged through the queue.", completionEvidence: undefined, actor, authority,
      evaluatedAt: NOW, dependencies: deps("merged"),
    });
    expect(gate.ok).toBe(true);
    expect(side.updateMany).toHaveBeenCalled();
  });

  it("an unmerged item still owes delivery: nothing closes before the change lands", async () => {
    const { result } = await read("not-merged", CUSTOMER_FEATURE);
    expect(result?.decision.verdict).not.toBe("allowed");
    expect(owed(result!.decision)).toContain("DELIVERY_EVIDENCE_REQUIRED");
  });
});

describe("a contractual item keeps today's acceptance (BI-B1B44777)", () => {
  it("a merged contractual item still owes acceptance and objective reconciliation", async () => {
    const { result } = await read("merged", { ...CUSTOMER_FEATURE, lifecycleTags: ["contractual"] });
    expect(result?.decision.verdict).not.toBe("allowed");
    expect(owed(result!.decision)).toEqual(expect.arrayContaining(["ACCEPTANCE_EVIDENCE_REQUIRED", "OBJECTIVE_RECONCILIATION_REQUIRED"]));
  });

  it("the tag holds even on platform work that used to close on merge", async () => {
    const { result } = await read("merged", { lifecycleTags: ["contractual"] });
    expect(result?.decision.verdict).not.toBe("allowed");
    expect(owed(result!.decision)).toContain("ACCEPTANCE_EVIDENCE_REQUIRED");
  });
});

describe("the authorised acceptance sweep closes merged non-contractual items (BI-45D3BBF4 path)", () => {
  const ENABLED: Extract<CloseAuthorisation, { state: "enabled" }> = {
    state: "enabled", setByUserId: "user-operator", setAt: "2026-10-01T09:00:00.000Z",
    reason: "Operator pre-authorised closing items the gate allows.", limit: 25, agentGrant: "backlog_write",
  };

  async function sweep(overrides: Record<string, unknown>) {
    const { side, result } = await read("merged", overrides);
    if (result?.decision.verdict !== "allowed") return { outcome: "not-closable" as const, side };
    const closed = await closeAllowedAcceptanceItem({
      item: { id: "row-1", itemId: "BI-1", claimedByAgentId: null, agentId: null },
      decision: result.decision, authorisation: ENABLED, agentId: "AGT-WS-PORTFOLIO",
      now: new Date(NOW), db: side.client as never,
      complete: ((args: Parameters<typeof completeBacklogItemTransition>[0]) =>
        completeBacklogItemTransition({ ...args, db: side.db as never, dependencies: deps("merged") })) as never,
    });
    return { outcome: closed.outcome, side };
  }

  it("closes a merged customer feature with no further change", async () => {
    const { outcome, side } = await sweep(CUSTOMER_FEATURE);
    expect(outcome).toBe("closed");
    expect(side.updateMany).toHaveBeenCalled();
  });

  it("leaves a merged contractual item awaiting acceptance", async () => {
    const { outcome, side } = await sweep({ ...CUSTOMER_FEATURE, lifecycleTags: ["contractual"] });
    expect(outcome).toBe("not-closable");
    expect(side.updateMany).not.toHaveBeenCalled();
  });
});
