// BI-094B41AC: the read projection and the completion gate are ONE evaluation.
// Each case drives the real transition and the real read against the same item
// and the same merge signal, and requires the same verdict and the same unmet
// codes — so an item the gate allows reads "allowed", and one it refuses reads
// that refusal.

import { describe, expect, it, vi } from "vitest";

import { completeBacklogItemTransition } from "./backlog-terminal-transition";
import { evaluateBacklogItemCompletion, readBacklogItemCompletion } from "./backlog-completion-evaluation";
import type { MergeDeliverySignal } from "./merge-delivery-signal";
import { item as initiativeItem, readyActivities } from "./entry-adapter.test-fixtures";
import { bodyCriteriaVersion } from "./body-baseline-version";
import { createPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";

const NOW = "2026-10-06T12:00:00.000Z";

describe("independent body acceptance survives source-author archival", () => {
  it.each([true, false])("reconciles only the current exact verified delivered source (valid=%s)", async valid => {
    const body = "## Acceptance\n- Verify independently accepted repair.";
    const { item, client } = fixture({ body, digitalProductId: "product-1" });
    const room = { id: "room-row", capsuleId: "WC-1", backlogItemId: item.itemId, repositoryFullName: "owner/repo",
      headBranch: "fix/accepted", headSha: "a".repeat(40), baseSha: "b".repeat(40), createdByPrincipalId: "author",
      status: "archived", pullRequestNumber: 6265, archivedAt: null,
      createdAt: new Date("2026-10-05T06:00:00Z"), scopeClaims: [{ source: "declared", workShape: "delivery-medium@1.0.0" }] };
    const rows = [{ id: "baseline", backlogItemId: item.id, kind: "initiative_scope_baseline", recordedAt: new Date("2026-10-06T07:00:00Z"),
      payload: { schemaVersion: 1, baselineId: "B-1", supersedesBaselineId: null, origin: "item-body", artifactDigest: "digest",
        subject: { kind: "backlog-item", id: item.itemId }, objectiveStatements: [],
        acceptanceStatements: bodyCriteriaVersion(body)!.acceptanceStatements, criteriaDigest: bodyCriteriaVersion(body)!.criteriaDigest,
        sourceIdentity: { repositoryFullName: room.repositoryFullName, headSha: room.headSha }, authoritySnapshot: { organizationId: "org-1" } } },
      { id: "E-1", backlogItemId: item.id, kind: "evidence", recordedAt: new Date("2026-10-06T08:00:00Z"), payload: { evidenceKind: "test_pass" } },
      { id: "mapping", backlogItemId: item.id, kind: "initiative_objective_mapping", recordedAt: new Date("2026-10-06T09:00:00Z"),
        payload: { schemaVersion: 1, proposalId: "mapping", baselineId: "B-1", artifactDigest: "digest",
          subject: { kind: "backlog-item", id: item.itemId }, eligibleEvidenceActivityIds: ["E-1"],
          mappings: [{ objectiveId: "AC-BODY-001", evidenceRefs: ["E-1"] }] } }];
    client.backlogItemActivity.findMany.mockResolvedValue(rows as never);
    const db = { ...client, workroom: {
      findFirst: vi.fn(async ({ where }) => where.archivedAt === null ? null : room),
      findMany: vi.fn(async ({ where }) => where.archivedAt === null ? [] : [room]) },
      contributorInventorySnapshot: { findMany: vi.fn().mockResolvedValue([{ payload: createPullRequestObservation({
        repositoryFullName: room.repositoryFullName, number: 6265, url: "https://github.com/owner/repo/pull/6265", title: "repair",
        headBranch: room.headBranch, headSha: valid ? room.headSha : "f".repeat(40), state: "merged", isDraft: false,
        mergeStateStatus: null, mergeCommitSha: "c".repeat(40), mergedAt: "2026-10-06T05:00:00Z",
        providerUpdatedAt: "2026-10-06T05:00:00Z", observedAt: "2026-10-06T05:01:00Z" }) }]) } };
    const result = await evaluateBacklogItemCompletion({ db: db as never, item: item as never, rawManifest: undefined,
      transitionObject: { kind: "backlog-item", id: item.itemId, expectedVersion: "read", targetState: "completion" }, evaluatedAt: NOW,
      dependencies: { ...deps("merged"), resolveCompletionEvidence: async () => ({ kind: "not-provided" }) as never } });
    const acceptance = [...result.decision.satisfied, ...result.decision.unmet, ...result.decision.blockers]
      .find(entry => entry.code === "ACCEPTANCE_EVIDENCE_REQUIRED");
    // BI-C899BB40: the merge closes it either way. A verified body acceptance
    // still reads pass; an unverifiable one is not applicable, never passed.
    expect(acceptance?.state).toBe(valid ? "pass" : "not-applicable");
  });
});

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
    prepareCurrentDesign: async () => ({ evidence: { state: "not-applicable" as const },
      admissionGuard: async () => ({ state: "not-applicable" as const }) }),
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

describe("decomposed initiative completion (BI-DA407BD9)", () => {
  function aggregateFixture(childStatus = "done", outcome = "pass", missingPlanReview = false) {
    const f = fixture(initiativeItem);
    const activities = readyActivities().filter(row => !missingPlanReview || row.gateKey !== "plan-review");
    const coverage = activities.find(row => row.kind === "plan_backlog_coverage")!;
    const coveragePayload = { ...coverage.payload, decision: "decomposed", planArtifactDigest: `sha256:${"d".repeat(64)}`,
      planArtifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "a".repeat(40),
        providerBlobId: "b".repeat(40), path: "docs/superpowers/plans/plan.md" },
      deliverables: ["BI-A", "BI-B"].map((backlogItemId, i) => ({ key: `child-${i}`, title: backlogItemId,
        independentlyShippable: true, backlogItemId, dependsOn: [] })),
    };
    coverage.payload = coveragePayload as typeof coverage.payload;
    f.client.backlogItemActivity.findMany.mockResolvedValue(activities as never);
    Object.assign(f.client.backlogItem, { findMany: vi.fn().mockResolvedValue([
      { itemId: "BI-A", status: "done" }, { itemId: "BI-B", status: childStatus },
    ]) });
    Object.assign(f.client, { workroom: { findFirst: vi.fn().mockResolvedValue({
      scopeClaims: [{ workShape: "delivery-xlarge@1.0.0" }],
    }) } });
    const resolveDeploymentClosure = vi.fn(async () => ({ kind: "unavailable" as const, reason: "not needed" }));
    const dependencies = { ...deps("merged"), resolveDeploymentClosure,
      reconcileObjectives: () => ({ state: outcome, baselineId: "baseline-1", evidenceRefs: outcome === "pass" ? ["parent-outcome"] : [] }) };
    return { ...f, dependencies, resolveDeploymentClosure };
  }
  async function evaluate(f: ReturnType<typeof aggregateFixture>) {
    return evaluateBacklogItemCompletion({ db: f.client as never, item: f.item as never, rawManifest: undefined,
      transitionObject: { kind: "backlog-item", id: f.item.itemId, expectedVersion: "read", targetState: "completion" },
      evaluatedAt: NOW, dependencies: f.dependencies as never });
  }
  it("allows real child delivery and parent outcomes through the same gate and read evaluation", async () => {
    const gateSide = aggregateFixture();
    const gate = await completeBacklogItemTransition({ db: gateSide.db as never, itemId: gateSide.item.itemId,
      expectedStatus: "awaiting-acceptance", resolution: "Children delivered and hypothesis reconciled.",
      completionEvidence: undefined, actor, authority: { ...authority, objectRef: gateSide.item.itemId },
      evaluatedAt: NOW, dependencies: gateSide.dependencies as never });
    const readSide = aggregateFixture();
    const read = await readBacklogItemCompletion({ itemRowId: readSide.item.id, status: "awaiting-acceptance",
      evaluatedAt: NOW, db: readSide.client as never, dependencies: readSide.dependencies as never });
    expect(gate.ok).toBe(true);
    expect(read?.decision.verdict).toBe("allowed");
    expect(unmetCodes(read!.decision)).toEqual([]);
    expect(readSide.updateMany).not.toHaveBeenCalled();
    expect(readSide.resolveDeploymentClosure).not.toHaveBeenCalled();
  });

  it("keeps both terminal admission and its read blocked when source observation is unavailable", async () => {
    const gateSide = aggregateFixture();
    const guard = vi.fn().mockResolvedValue({ state: "unavailable" });
    const prepareCurrentDesign = vi.fn().mockResolvedValue({ evidence: { state: "unavailable" }, admissionGuard: guard });
    const gate = await completeBacklogItemTransition({ db: gateSide.db as never, itemId: gateSide.item.itemId,
      expectedStatus: "awaiting-acceptance", resolution: "Must not close on historical design passes.",
      completionEvidence: undefined, actor, authority: { ...authority, objectRef: gateSide.item.itemId }, evaluatedAt: NOW,
      dependencies: { ...gateSide.dependencies, prepareCurrentDesign } as never });
    const readSide = aggregateFixture();
    const read = await readBacklogItemCompletion({ itemRowId: readSide.item.id, status: "awaiting-acceptance",
      evaluatedAt: NOW, db: readSide.client as never, dependencies: readSide.dependencies as never,
      currentDesign: { state: "unavailable" } });
    expect(gate.ok).toBe(false);
    expect(read?.decision.verdict).not.toBe("allowed");
    expect(unmetCodes(read!.decision)).toContain("OBJECTIVE_BASELINE_REQUIRED");
    expect(gateSide.updateMany).not.toHaveBeenCalled();
    expect(prepareCurrentDesign).toHaveBeenCalledTimes(1); expect(guard).toHaveBeenCalledTimes(1);
  });
  it("does not let the parent's merge close an unfinished child", async () => {
    const result = await evaluate(aggregateFixture("in-progress"));
    expect(result.decision.verdict).not.toBe("allowed");
    expect(unmetCodes(result.decision)).toContain("DELIVERY_EVIDENCE_REQUIRED");
    expect(result.decision.unmet.find(row => row.code === "DELIVERY_EVIDENCE_REQUIRED")?.nextAction).toContain("BI-B");
  });
  it("does not let the parent's merge invent outcome reconciliation", async () => {
    const result = await evaluate(aggregateFixture("done", "missing"));
    expect(unmetCodes(result.decision)).toContain("OBJECTIVE_RECONCILIATION_REQUIRED");
    expect(result.independentAcceptanceDecision?.verdict).not.toBe("allowed");
  });
  it("does not let the parent's merge replace an independent plan review", async () => {
    expect(unmetCodes((await evaluate(aggregateFixture("done", "pass", true))).decision)).toContain("PLAN_REVIEW_REQUIRED");
  });
});

describe("the read projection evaluates completion as the completion gate does (BI-094B41AC)", () => {
  it("independent acceptance cannot be discharged by merge recognition", async () => {
    const { client, item } = fixture();
    const result = await evaluateBacklogItemCompletion({
      db: client as never, item: item as never, rawManifest: undefined,
      transitionObject: { kind: "backlog-item", id: item.itemId, expectedVersion: "read", targetState: "completion" },
      evaluatedAt: NOW, dependencies: deps("merged"),
    });
    expect(result.decision.verdict).toBe("allowed");
    expect(result.independentAcceptanceDecision?.verdict).not.toBe("allowed");
    expect(unmetCodes(result.independentAcceptanceDecision!)).toContain("ACCEPTANCE_EVIDENCE_REQUIRED");
  });
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

// BI-4A222439, reproducing BI-1B5BE5F4: a merged direct-merge platform bug
// whose cloud UX passed and whose installed-portal UX check then FAILED. The
// acceptance sweep closed it at 2026-10-13 05:00Z because the merge alone
// passed delivery and acceptance. A failure that is still the newest word in
// its dimension now blocks done on the read, on the sweep and on a person's close.
describe("current failing evidence blocks done on every path (BI-4A222439)", () => {
  const UX_PASS = { id: "ux-pass", kind: "evidence", recordedAt: new Date("2026-10-06T05:29:55.000Z"),
    payload: { evidenceKind: "ux_verified", url: "https://github.com/acme/repo/actions/runs/1", body: "cloud fixture" } };
  const UX_FAIL = { id: "ux-fail", kind: "evidence", recordedAt: new Date("2026-10-06T05:50:36.000Z"),
    payload: { evidenceKind: "ux_fail", url: "http://127.0.0.1:3000/ops/workrooms", body: "Do not close acceptance yet." } };
  const UX_PASS_LATER = { ...UX_PASS, id: "ux-pass-later", recordedAt: new Date("2026-10-06T07:00:00.000Z") };

  function withEvidence(rows: Array<Record<string, unknown>>, itemOverrides: Record<string, unknown> = {}) {
    const side = fixture(itemOverrides);
    const stored = rows.map((row) => ({ backlogItemId: "row-1", gateKey: null, ...row }));
    side.client.backlogItemActivity.findMany.mockImplementation((async (args: unknown) =>
      JSON.stringify(args).includes("\"evidence\"") ? stored : []) as never);
    return side;
  }

  async function evaluate(rows: Array<Record<string, unknown>>, signal: MergeDeliverySignal = "merged") {
    const { client, item } = withEvidence(rows);
    return evaluateBacklogItemCompletion({
      db: client as never, item: item as never, rawManifest: undefined,
      transitionObject: { kind: "backlog-item", id: item.itemId, expectedVersion: "read", targetState: "completion" },
      evaluatedAt: NOW, dependencies: deps(signal),
    });
  }

  it("a merged item whose newest ux evidence is ux_fail is denied, naming the failing row", async () => {
    const result = await evaluate([UX_PASS, UX_FAIL]);
    expect(result.decision.verdict).toBe("denied");
    const delivery = result.decision.blockers.find((entry) => entry.code === "DELIVERY_EVIDENCE_REQUIRED");
    const acceptance = result.decision.blockers.find((entry) => entry.code === "ACCEPTANCE_EVIDENCE_REQUIRED");
    expect(delivery?.state).toBe("fail");
    expect(delivery?.evidenceRefs).toContain("ux-fail");
    expect(acceptance?.state).toBe("fail");
    expect(acceptance?.evidenceRefs).toContain("ux-fail");
    expect(result.independentAcceptanceDecision.verdict).toBe("denied");
  });

  it("a later ux pass supersedes the failure and the merge closes it again", async () => {
    const result = await evaluate([UX_PASS, UX_FAIL, UX_PASS_LATER]);
    expect(result.decision.verdict).toBe("allowed");
  });

  it("a deployment closure does not wave the current failure through", async () => {
    const { client, item } = withEvidence([UX_FAIL]);
    const result = await evaluateBacklogItemCompletion({
      db: client as never, item: item as never, rawManifest: undefined,
      transitionObject: { kind: "backlog-item", id: item.itemId, expectedVersion: "read", targetState: "completion" },
      evaluatedAt: NOW,
      dependencies: {
        resolveMergeDelivery: async () => "merged" as const,
        resolveDeploymentClosure: async () => ({ kind: "deployed", runId: "SUR-1", deployedSha: "a".repeat(40) }) as never,
      },
    });
    expect(result.decision.verdict).not.toBe("allowed");
  });

  it("the sweep's close is refused and the item stays awaiting acceptance", async () => {
    const side = withEvidence([UX_PASS, UX_FAIL]);
    const gate = await completeBacklogItemTransition({
      db: side.db as never,
      itemId: "BI-1",
      expectedStatus: "awaiting-acceptance",
      resolution: "Closed by the acceptance sweep.",
      // The shape sweepCompletionEvidence() sends: a readiness citation, not a manifest.
      completionEvidence: { source: "acceptance-sweep", readinessDecisionId: "IRD-1", verdict: "allowed", satisfied: [] },
      actor,
      authority,
      evaluatedAt: NOW,
      dependencies: deps("merged"),
    });
    expect(gate.ok).toBe(false);
    expect(side.updateMany).not.toHaveBeenCalled();
  });
});
