// BI-C899BB40, operator direction 2026-10-27: closure follows delivery.
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §9.
//
// Delivery evidence (a merge through the gates or a canonical deployment)
// closes every shape. Acceptance, baseline and reconciliation are not
// applicable once it passed; a recorded failure still blocks. The terminal
// transition records a bounded obligation: not-owed, or one question for a
// customer submitter.

import { describe, expect, it, vi } from "vitest";

import { completeBacklogItemTransition, deliveryClosureRecord } from "./backlog-terminal-transition";
import { evaluateBacklogItemCompletion, isCustomerReported } from "./backlog-completion-evaluation";
import type { MergeDeliverySignal } from "./merge-delivery-signal";
import { item as initiativeItem, readyActivities } from "./entry-adapter.test-fixtures";

const NOW = "2026-10-27T12:00:00.000Z";
const SETTLED = ["ACCEPTANCE_EVIDENCE_REQUIRED", "OBJECTIVE_BASELINE_REQUIRED", "OBJECTIVE_RECONCILIATION_REQUIRED"];

type Row = Record<string, unknown>;

function fixture(args: { shape?: string; item?: Record<string, unknown>; activities?: Row[] } = {}) {
  const item = {
    id: "row-1", itemId: "BI-1", status: "awaiting-acceptance", workType: "bug",
    type: "product", source: "user-request", title: "A product fix", body: null,
    // Product-linked: NOT direct-merge platform work, so the old rule kept it open.
    scopeKind: "platform", archetypeCategories: [], archetypeIds: [], organizationId: "org-1", epicId: null,
    claimedAt: new Date("2026-10-20T07:00:00.000Z"), createdAt: new Date("2026-10-20T06:00:00.000Z"),
    digitalProductId: "DP-1", activeBuild: null, productObjectiveWork: [], lifecycleTags: [],
    ...args.item,
  };
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const creates: Array<{ data: { kind: string; payload: Record<string, unknown> } }> = [];
  const stored = (args.activities ?? []).map(row => ({ backlogItemId: item.id, gateKey: null, ...row }));
  const client = {
    $queryRawUnsafe: vi.fn(async () => []),
    backlogItem: { findFirst: vi.fn(async () => item), findUnique: vi.fn(async () => item), updateMany },
    backlogItemActivity: {
      findMany: vi.fn(async () => stored),
      create: vi.fn(async (input: never) => { creates.push(input); return input; }),
    },
    authorizationDecisionLog: { create: vi.fn(async (input: unknown) => input) },
    ...(args.shape ? { workroom: { findFirst: vi.fn(async () => ({ scopeClaims: [{ workShape: args.shape }] })) } } : {}),
  };
  return { item, client, updateMany, creates,
    db: { $transaction: async <T>(work: (tx: typeof client) => Promise<T>) => work(client) } };
}

function deps(signal: MergeDeliverySignal, extra: Record<string, unknown> = {}) {
  return {
    prepareCurrentDesign: async () => ({ evidence: { state: "not-applicable" as const },
      admissionGuard: async () => ({ state: "not-applicable" as const }) }),
    resolveMergeDelivery: async () => signal,
    resolveDeploymentClosure: async () => ({ kind: "unavailable" as const, reason: "no deployment in this fixture" }),
    resolveCompletionEvidence: async () => ({ kind: "not-provided" }) as never,
    ...extra,
  };
}

async function evaluate(f: ReturnType<typeof fixture>, signal: MergeDeliverySignal, extra: Record<string, unknown> = {}) {
  return evaluateBacklogItemCompletion({ db: f.client as never, item: f.item as never, rawManifest: undefined,
    transitionObject: { kind: "backlog-item", id: f.item.itemId, expectedVersion: "read", targetState: "completion" },
    evaluatedAt: NOW, dependencies: deps(signal, extra) as never });
}

const open = (decision: { unmet: { code: string }[]; blockers: { code: string }[] }) =>
  [...decision.unmet, ...decision.blockers].map(row => row.code);

const research = { id: "r-research", kind: "initiative_gate_receipt", gateKey: "research", recordedAt: new Date("2026-10-21T00:00:00Z"),
  payload: { ...(readyActivities().find(row => row.id === "r-research")!.payload as Row), subject: { kind: "backlog-item", id: "BI-1" } } };

describe("completion shape tables under closure-follows-delivery", () => {
  it("small: a merged product fix closes with nothing owed after delivery", async () => {
    const result = await evaluate(fixture({ shape: "delivery-small@1.0.0", activities: [research] }), "merged");
    expect(result.closureFollowsDelivery).toBe(true);
    expect(result.decision.verdict).toBe("allowed");
    expect(result.decision.satisfied.find(row => row.code === "ACCEPTANCE_EVIDENCE_REQUIRED")?.state).toBe("not-applicable");
  });

  it("medium: no independent acceptance receipt and no item-body baseline is owed once merged", async () => {
    const result = await evaluate(fixture({ shape: "delivery-medium@1.0.0", activities: [research] }), "merged");
    expect(open(result.decision).filter(code => SETTLED.includes(code))).toEqual([]);
    expect(result.decision.verdict).toBe("allowed");
  });

  it("large: reconciliation and acceptance are not applicable once merged; design gates still count", async () => {
    const f = fixture({ shape: "delivery-large@1.0.0", item: { ...initiativeItem, itemId: "BI-ENTRY", digitalProductId: "DP-1",
      status: "awaiting-acceptance", body: null, title: "Feature", organizationId: "org-1", epicId: null,
      claimedAt: new Date("2026-10-20T07:00:00.000Z"), createdAt: new Date("2026-10-20T06:00:00.000Z"),
      productObjectiveWork: [], activeBuild: null, lifecycleTags: [] }, activities: readyActivities() as Row[] });
    const reconcileObjectives = () => ({ state: "missing", baselineId: "baseline-1", evidenceRefs: [], requiredStatementIds: ["OBJ-1"] });
    const before = await evaluate(f, "not-merged", { reconcileObjectives });
    expect(open(before.decision)).toEqual(expect.arrayContaining(["DELIVERY_EVIDENCE_REQUIRED", "OBJECTIVE_RECONCILIATION_REQUIRED"]));
    const after = await evaluate(f, "merged", { reconcileObjectives });
    expect(open(after.decision).filter(code => SETTLED.includes(code))).toEqual([]);
    expect(after.decision.verdict).toBe("allowed");
  });

  it("unmerged work is untouched: acceptance stays owed alongside delivery", async () => {
    const result = await evaluate(fixture({ shape: "delivery-medium@1.0.0", activities: [research] }), "not-merged");
    expect(result.closureFollowsDelivery).toBe(false);
    expect(open(result.decision)).toEqual(expect.arrayContaining(["DELIVERY_EVIDENCE_REQUIRED", "ACCEPTANCE_EVIDENCE_REQUIRED"]));
  });

  it("a recorded failure outranks the merge on every shape", async () => {
    const uxFail = { id: "ux-fail", kind: "evidence", recordedAt: new Date("2026-10-26T00:00:00Z"),
      payload: { evidenceKind: "ux_fail", url: "http://127.0.0.1:3000/x", body: "broken" } };
    const f = fixture({ shape: "delivery-medium@1.0.0", activities: [research, uxFail] });
    f.client.backlogItemActivity.findMany.mockImplementation((async (input: unknown) => {
      const rows = [research, uxFail].map(row => ({ backlogItemId: "row-1", gateKey: null, ...row }));
      return JSON.stringify(input).includes("\"evidence\"") ? rows : [research];
    }) as never);
    const result = await evaluate(f, "merged", { resolveCompletionEvidence: undefined });
    expect(result.closureFollowsDelivery).toBe(false);
    expect(result.decision.verdict).toBe("denied");
  });

  it("an xlarge aggregate's own merge never settles its children's outcomes", async () => {
    const result = await evaluate(fixture({ shape: "delivery-xlarge@1.0.0" }), "merged");
    expect(result.closureFollowsDelivery).toBe(false);
  });
});

describe("isCustomerReported reads existing provenance (no persisted flag)", () => {
  it.each([
    [{ itemId: "BI-1", lifecycleTags: ["ecosystem-inbound", "upstream-issue"] }, true],
    [{ itemId: "BI-1", body: "x\n[origin:ecosystem-upstream-issue:acme/repo#12]" }, true],
    [{ itemId: "BI-1", body: "[origin:ecosystem-peer-demand:mirror-1]" }, true],
    [{ itemId: "BI-1", body: "[origin:federatedDemand:link-1:peer-1]" }, true],
    [{ itemId: "BI-1", body: "[origin:founderDemandCluster:FDC-1]" }, true],
    [{ itemId: "BI-PIR-1a2b3c4d", body: null }, true],
    [{ itemId: "BI-1", body: "It broke.\nSource report: PIR-123" }, true],
    [{ itemId: "BI-1", body: "Platform refactor; mentions a Source report: in prose", lifecycleTags: [] }, false],
    [{ itemId: "BI-1", body: "[origin:automated-detection:x]" }, false],
    [{ itemId: "BI-1" }, false],
  ])("%j -> %s", (item, expected) => {
    expect(isCustomerReported(item)).toBe(expected);
  });
});

describe("the terminal transition records a bounded obligation (AC-CFD-1, AC-CFD-2)", () => {
  const actor = { actorType: "agent" as const, actorRef: "AGT-1", humanContextRef: "user-1", agentContextRef: "AGT-1" };
  const authority = {
    organizationId: "org-1", actionKey: "update_backlog_item_status", objectRef: "BI-1", rationale: { capability: "manage_backlog" },
    authoritySnapshot: { decision: "allow" as const, effectiveHumanCapability: "manage_backlog", effectiveAgentGrant: "backlog_write",
      tokenScope: "organization", organizationId: "org-1", actionKey: "update_backlog_item_status", policyVersion: "coworker-authority.v1" },
  };
  async function close(item: Record<string, unknown>) {
    const f = fixture({ shape: "delivery-small@1.0.0", activities: [research], item });
    const result = await completeBacklogItemTransition({ db: f.db as never, itemId: "BI-1", expectedStatus: "awaiting-acceptance",
      resolution: "Merged.", completionEvidence: undefined, actor, authority, evaluatedAt: NOW, dependencies: deps("merged") as never });
    const status = f.creates.find(row => row.data.kind === "status_change");
    return { result, payload: status?.data.payload };
  }

  it("a non-customer merged item is done with acceptanceObligation not-owed", async () => {
    const { result, payload } = await close({});
    expect(result.ok).toBe(true);
    expect(payload).toMatchObject({ to: "done", closureBasis: "delivery-evidence", acceptanceObligation: "not-owed", customerReported: false });
  });

  it("a customer-reported merged item is done and owes exactly the submitter question", async () => {
    const { result, payload } = await close({ body: "Reported.\n[origin:ecosystem-upstream-issue:acme/repo#7]" });
    expect(result.ok).toBe(true);
    expect(payload).toMatchObject({ to: "done", acceptanceObligation: "pending-submitter-confirmation", customerReported: true });
  });

  it("never writes the retired pending-independent-verification obligation", () => {
    const deployment = { kind: "deployed" as const, runId: "SUR-1", repositoryFullName: "a/b", pullRequestNumber: 1,
      headSha: "a".repeat(40), mergeCommitSha: "b".repeat(40), targetSha: "c".repeat(40), servedSha: "d".repeat(40), completedAt: NOW };
    for (const acceptanceState of ["missing", "pass", "fail"]) for (const customerReported of [true, false]) {
      const record = deliveryClosureRecord({ deployment, closureFollowsDelivery: false, acceptanceState, customerReported });
      expect(record?.payload.acceptanceObligation).not.toBe("pending-independent-verification");
      expect(record?.payload.closureBasis).toBe("canonical-deployment");
    }
    expect(deliveryClosureRecord({ deployment: null, closureFollowsDelivery: false, acceptanceState: "missing", customerReported: true })).toBeNull();
  });
});
