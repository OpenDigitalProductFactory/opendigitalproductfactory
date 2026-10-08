// BI-094B41AC: the read projection and the completion gate are ONE evaluation.
// Each case drives the real transition and the real read against the same item
// and the same merge signal, and requires the same verdict and the same unmet
// codes — so an item the gate allows reads "allowed", and one it refuses reads
// that refusal.

import { describe, expect, it, vi } from "vitest";

import { completeBacklogItemTransition } from "./backlog-terminal-transition";
import { evaluateBacklogItemCompletion, readBacklogItemCompletion } from "./backlog-completion-evaluation";
import type { MergeDeliverySignal } from "./merge-delivery-signal";

const NOW = "2026-10-06T12:00:00.000Z";

function fixture(itemOverrides: Record<string, unknown> = {}) {
  const item = {
    id: "row-1", itemId: "BI-1", status: "awaiting-acceptance", workType: "bug",
    type: "product", source: "automated-detection", title: "A merged fix", body: null,
    scopeKind: "platform", archetypeCategories: [], archetypeIds: [], organizationId: "org-1", epicId: null,
    claimedAt: new Date("2026-10-05T07:00:00.000Z"), createdAt: new Date("2026-10-05T06:00:00.000Z"),
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
    item,
    client,
    updateMany,
    db: { $transaction: async <T>(work: (tx: typeof client) => Promise<T>) => work(client) },
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

function deps(signal: MergeDeliverySignal) {
  return {
    resolveMergeDelivery: async () => signal,
    resolveDeploymentClosure: async () => ({ kind: "unavailable" as const, reason: "no deployment in this fixture" }),
  };
}

async function bothViews(signal: MergeDeliverySignal, itemOverrides: Record<string, unknown> = {}) {
  const gateSide = fixture(itemOverrides);
  const gate = await completeBacklogItemTransition({
    db: gateSide.db as never,
    itemId: "BI-1",
    expectedStatus: "awaiting-acceptance",
    resolution: "Merged through the queue.",
    completionEvidence: undefined,
    actor,
    authority,
    evaluatedAt: NOW,
    dependencies: deps(signal),
  });
  const readSide = fixture(itemOverrides);
  const read = await readBacklogItemCompletion({
    itemRowId: "row-1",
    status: "awaiting-acceptance",
    evaluatedAt: NOW,
    db: readSide.client as never,
    dependencies: deps(signal),
  });
  return { gate, read, readSide };
}

function unmetCodes(decision: { unmet: { code: string }[]; blockers: { code: string }[] }) {
  return [...decision.unmet, ...decision.blockers].map((entry) => entry.code).sort();
}

describe("the read projection evaluates completion as the completion gate does (BI-094B41AC)", () => {
  it("a merged direct-merge item the gate allows reads allowed", async () => {
    const { gate, read } = await bothViews("merged");
    expect(gate.ok).toBe(true);
    expect(read?.mergedThroughGates).toBe("merged");
    expect(read?.decision.verdict).toBe("allowed");
    expect(unmetCodes(read!.decision)).toEqual([]);
  });

  it("an unmerged item the gate refuses reads the same refusal", async () => {
    const { gate, read } = await bothViews("not-merged");
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(read?.decision.verdict).toBe(gate.decision.verdict);
    expect(read?.decision.verdict).not.toBe("allowed");
    expect(unmetCodes(read!.decision)).toEqual(unmetCodes(gate.decision));
    expect(unmetCodes(read!.decision)).toContain("DELIVERY_EVIDENCE_REQUIRED");
  });

  it("an unavailable signal reads the gate's refusal and says the signal was unavailable", async () => {
    const { gate, read } = await bothViews("signal-unavailable");
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(read?.mergedThroughGates).toBe("signal-unavailable");
    expect(read?.decision.verdict).toBe(gate.decision.verdict);
    expect(unmetCodes(read!.decision)).toEqual(unmetCodes(gate.decision));
    const delivery = read!.decision.unmet.find((entry) => entry.code === "DELIVERY_EVIDENCE_REQUIRED");
    expect(delivery?.nextAction).toContain("UNKNOWN here");
  });

  it("merged customer feature work is not waved through: the gate and the read both refuse it", async () => {
    const { gate, read } = await bothViews("merged", { digitalProductId: "DP-1", workType: "feature" });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(read?.decision.verdict).toBe(gate.decision.verdict);
    expect(unmetCodes(read!.decision)).toEqual(unmetCodes(gate.decision));
  });

  it("never mutates, and is not evaluated for an item that is not awaiting acceptance", async () => {
    const { readSide } = await bothViews("merged");
    expect(readSide.updateMany).not.toHaveBeenCalled();
    expect(readSide.client.backlogItemActivity.create).not.toHaveBeenCalled();
    const resolveMergeDelivery = vi.fn(async () => "merged" as const);
    const skipped = await readBacklogItemCompletion({
      itemRowId: "row-1", status: "in-progress", evaluatedAt: NOW,
      db: fixture({ status: "in-progress" }).client as never,
      dependencies: { resolveMergeDelivery },
    });
    expect(skipped).toBeNull();
    expect(resolveMergeDelivery).not.toHaveBeenCalled();
  });

  it("answers null rather than a fabricated verdict when the evaluation cannot run", async () => {
    const broken = fixture();
    broken.client.backlogItem.findUnique.mockRejectedValueOnce(new Error("db down"));
    const read = await readBacklogItemCompletion({
      itemRowId: "row-1", status: "awaiting-acceptance", evaluatedAt: NOW,
      db: broken.client as never, dependencies: deps("merged"),
    });
    expect(read).toBeNull();
  });
});

// BI-B22E50BC: an operational chore (no code, no PR, no workroom) closes on its
// manual check. With no bound shape it used to fall onto the v2 fix table,
// which owes a spec baseline and reconciliation no such chore can produce; the
// only exit was retiring work that was done. A well-formed operational manifest
// now closes on the small-shape lane, which is the governance it actually owes.
describe("an operational close is gated as small work, not as an unshaped fix (BI-B22E50BC)", () => {
  const OPERATIONAL_GAP = ["OBJECTIVE_BASELINE_REQUIRED", "OBJECTIVE_RECONCILIATION_REQUIRED", "PLAN_REQUIRED"];

  async function close(args: {
    workClass: string;
    allowed: boolean;
    workType?: string;
    itemOverrides?: Record<string, unknown>;
  }) {
    const { client, item } = fixture({ status: "in-progress", workType: args.workType ?? "chore", ...args.itemOverrides });
    const db = { ...client, workroom: { findFirst: vi.fn(async () => null) } };
    const blockers = args.allowed ? [] : [{
      code: "missing-dimension", message: "Completion evidence is missing manual", dimension: "manual",
    }];
    const workClassBlocker = (args.workType ?? "chore") === "bug" && args.workClass === "operational"
      ? [{ code: "incompatible-work-class", message: "workType=bug cannot complete as operational", dimension: "manifest" }]
      : [];
    return evaluateBacklogItemCompletion({
      db: db as never,
      item: item as never,
      rawManifest: { workClass: args.workClass, evidenceActivityIds: ["ev-1"] },
      transitionObject: { kind: "backlog-item", id: "BI-1", expectedVersion: "in-progress", targetState: "done" },
      evaluatedAt: NOW,
      dependencies: {
        ...deps("not-merged"),
        resolveCompletionEvidence: async () => ({
          kind: "evaluated" as const,
          item: { id: "row-1", itemId: "BI-1", status: "in-progress", workType: args.workType ?? "chore" },
          verdict: {
            allowed: args.allowed && workClassBlocker.length === 0,
            noOp: false,
            normalizedManifest: { workClass: args.workClass, evidenceActivityIds: ["ev-1"], useActiveBuildEvidence: false },
            acceptanceEvidenceRefs: args.allowed ? ["ev-1"] : [],
            blockers: [...blockers, ...workClassBlocker],
            nextAction: args.allowed ? null : "Record fresh evidence for manual with record_execution_evidence, then retry with those activity IDs.",
          },
        }) as never,
      },
    });
  }

  it("an unshaped chore closing as operational on a manual check is allowed", async () => {
    const result = await close({ workClass: "operational", allowed: true });
    expect(unmetCodes(result.decision)).toEqual([]);
    expect(result.decision.verdict).toBe("allowed");
  });

  it("an operational close missing its manual check names that evidence, not a spec baseline", async () => {
    const result = await close({ workClass: "operational", allowed: false });
    expect(result.decision.verdict).not.toBe("allowed");
    const codes = unmetCodes(result.decision);
    expect(codes).toContain("DELIVERY_EVIDENCE_REQUIRED");
    for (const code of OPERATIONAL_GAP) expect(codes).not.toContain(code);
    const delivery = result.decision.unmet.find((entry) => entry.code === "DELIVERY_EVIDENCE_REQUIRED");
    expect(delivery?.nextAction).toContain("manual");
  });

  it("a code-bearing chore (implementation) keeps the unshaped gates", async () => {
    const result = await close({ workClass: "implementation", allowed: true });
    expect(unmetCodes(result.decision)).toEqual(expect.arrayContaining(["OBJECTIVE_BASELINE_REQUIRED"]));
  });

  it("an operational manifest on a work type that cannot close as operational changes nothing", async () => {
    const result = await close({ workClass: "operational", allowed: true, workType: "bug" });
    expect(unmetCodes(result.decision)).toEqual(expect.arrayContaining(["OBJECTIVE_BASELINE_REQUIRED"]));
  });

  it("an item governed by a Build Studio build is not an operational close", async () => {
    const result = await close({
      workClass: "operational",
      allowed: true,
      itemOverrides: { activeBuild: { kind: "fix", verificationOut: null, uxVerificationStatus: null } },
    });
    expect(unmetCodes(result.decision)).toEqual(expect.arrayContaining(["OBJECTIVE_BASELINE_REQUIRED"]));
  });
});
