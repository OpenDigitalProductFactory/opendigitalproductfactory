import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockFixLoop, mockPlanDispatch, mockEscalate } = vi.hoisted(() => ({
  mockPrisma: {
    featureBuild: { findUnique: vi.fn() },
    backlogItem: { findUnique: vi.fn() },
    backlogItemActivity: { findMany: vi.fn() },
    buildArtifactRevision: { findFirst: vi.fn() },
    buildActivity: { findMany: vi.fn(), create: vi.fn() },
    toolExecution: { findMany: vi.fn() },
  },
  mockFixLoop: vi.fn(),
  mockPlanDispatch: vi.fn(),
  mockEscalate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/build/ideate-on-approval", () => ({
  dispatchDesignReviewFixLoop: mockFixLoop,
  DESIGN_FIX_MAX_ROUNDS: 2,
}));
vi.mock("@/lib/build/plan-on-approval", () => ({ dispatchPlanForApprovedBuild: mockPlanDispatch }));
vi.mock("@/lib/build/escalate-build-to-human", () => ({
  escalateBuildToHuman: mockEscalate,
  SELF_FIX_CLASS: { NEEDS_HUMAN: "needs-human" },
}));

import {
  INDEPENDENT_REVISION_DONE_PREFIX,
  INDEPENDENT_REVISION_TOOL,
  countIndependentRevisionRounds,
  matchReceiptFindingIssues,
  reviseDesignFromIndependentReview,
  selectFailingIndependentDesignReceipts,
} from "./independent-design-review-revision";

const DIGEST = "sha256:37ad0f5e708946bacefab6dcd3de70c71529224b554d74fd032b626c510ef95e";

/** Same derivation as receipt-schema.ts buildStableInitiativeFindingId. */
function findingId(gate: string, issue: string): string {
  const normalized = issue.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  return `IF-${createHash("sha256").update(`${DIGEST}\0${gate}\0${normalized}`).digest("hex").slice(0, 16).toUpperCase()}`;
}

function receipt(args: {
  id: string; gate: string; decision: string; at: string; revisionId?: string;
  findingRefs?: string[]; reason?: string; reviewer?: string;
}) {
  return {
    id: args.id,
    gateKey: args.gate.replaceAll("-", "_"),
    recordedAt: new Date(args.at),
    payload: {
      gate: args.gate,
      decision: args.decision,
      reason: args.reason ?? `${args.gate} ${args.decision}`,
      artifactRef: { kind: "feature-build-revision", revisionId: args.revisionId ?? "rev-2" },
      artifactDigest: DIGEST,
      findingRefs: args.findingRefs ?? [],
      reviewerAgentId: args.reviewer ?? "AGT-WS-REVIEW",
    },
  };
}

describe("selectFailingIndependentDesignReceipts", () => {
  it("returns the latest failing design receipt per gate bound to the current revision", () => {
    const rows = [
      receipt({ id: "r1", gate: "spec-approval", decision: "pass", at: "2026-10-15T00:00:00Z" }),
      receipt({ id: "r2", gate: "spec-approval", decision: "fail", at: "2026-10-16T00:00:00Z" }),
      receipt({ id: "r3", gate: "architecture-review", decision: "pass", at: "2026-10-16T00:00:00Z" }),
      receipt({ id: "r4", gate: "plan-review", decision: "fail", at: "2026-10-16T00:00:00Z" }),
    ];
    const failing = selectFailingIndependentDesignReceipts(rows, "rev-2");
    expect(failing.map((entry) => entry.receiptId)).toEqual(["r2"]);
    expect(failing[0]).toMatchObject({ gate: "spec-approval", reviewerAgentId: "AGT-WS-REVIEW" });
  });

  it("ignores a failure that a later receipt for the same gate superseded", () => {
    const rows = [
      receipt({ id: "r1", gate: "design-spec", decision: "fail", at: "2026-10-15T00:00:00Z" }),
      receipt({ id: "r2", gate: "design-spec", decision: "pass", at: "2026-10-16T00:00:00Z" }),
    ];
    expect(selectFailingIndependentDesignReceipts(rows, "rev-2")).toEqual([]);
  });

  it("waits for re-review when the failure judged an earlier revision", () => {
    const rows = [receipt({ id: "r1", gate: "design-spec", decision: "fail", at: "2026-10-16T00:00:00Z", revisionId: "rev-1" })];
    expect(selectFailingIndependentDesignReceipts(rows, "rev-2")).toEqual([]);
    expect(selectFailingIndependentDesignReceipts(rows, null)).toEqual([]);
  });
});

describe("matchReceiptFindingIssues", () => {
  it("recovers the reviewer's finding text only when it hashes to the receipt's finding ids", () => {
    const issue = "The data model has no per-failure-class retry budget.";
    const failing = selectFailingIndependentDesignReceipts([
      receipt({ id: "r1", gate: "spec-approval", decision: "fail", at: "2026-10-16T00:00:00Z", findingRefs: [findingId("spec-approval", issue)] }),
    ], "rev-2")[0]!;
    const issues = matchReceiptFindingIssues(failing, [
      { parameters: { decision: "fail", findings: [{ issue, severity: "important" }, { issue: "unrelated", severity: "critical" }] } },
      { parameters: { decision: "fail", findings: [{ issue, severity: "important" }] } },
    ]);
    expect(issues).toEqual([{ severity: "important", description: `[spec-approval] ${issue}` }]);
  });

  it("falls back to the reviewer's stated reason when no finding text can be verified", () => {
    const failing = selectFailingIndependentDesignReceipts([
      receipt({ id: "r1", gate: "design-spec", decision: "fail", at: "2026-10-16T00:00:00Z", reason: "Terminal states conflict.", findingRefs: ["IF-0000000000000000"] }),
    ], "rev-2")[0]!;
    expect(matchReceiptFindingIssues(failing, [])).toEqual([
      { severity: "critical", description: "[design-spec] Terminal states conflict." },
    ]);
  });
});

describe("countIndependentRevisionRounds", () => {
  it("counts only completed revisions", () => {
    expect(countIndependentRevisionRounds([
      { summary: `${INDEPENDENT_REVISION_DONE_PREFIX} (round 1/2)` },
      { summary: "Revising the design from 1 failing independent review(s)" },
      { summary: null },
    ])).toBe(1);
  });
});

describe("reviseDesignFromIndependentReview (BI-3E57890E)", () => {
  const issue = "The data model has no per-failure-class retry budget.";
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.buildArtifactRevision.findFirst.mockResolvedValue({ id: "rev-2" });
    mockPrisma.backlogItemActivity.findMany.mockResolvedValue([
      receipt({ id: "r1", gate: "spec-approval", decision: "fail", at: "2026-10-16T03:37:22Z", findingRefs: [findingId("spec-approval", issue)] }),
    ]);
    mockPrisma.toolExecution.findMany.mockResolvedValue([
      { parameters: { decision: "fail", findings: [{ issue, severity: "important" }] } },
    ]);
    mockPrisma.buildActivity.findMany.mockResolvedValue([]);
    mockPrisma.buildActivity.create.mockResolvedValue({});
    mockPrisma.featureBuild.findUnique.mockResolvedValue({ id: "ck1", title: "Forge outbox" });
    mockPrisma.backlogItem.findUnique.mockResolvedValue({ title: "Retry budgets" });
    mockFixLoop.mockResolvedValue({ kind: "repaired", rounds: 1 });
    mockPlanDispatch.mockResolvedValue({ kind: "dispatched-success" });
    mockEscalate.mockResolvedValue({ reportId: "PIR-1" });
  });

  it("does nothing when no independent design review is failing", async () => {
    mockPrisma.backlogItemActivity.findMany.mockResolvedValue([
      receipt({ id: "r1", gate: "spec-approval", decision: "pass", at: "2026-10-16T03:37:22Z" }),
    ]);
    const out = await reviseDesignFromIndependentReview({ buildId: "FB-1", userId: "u", originatingBacklogItemId: "row-1" });
    expect(out).toBeNull();
    expect(mockFixLoop).not.toHaveBeenCalled();
  });

  it("revises the design from the failing receipt's findings, then regenerates the plan", async () => {
    const out = await reviseDesignFromIndependentReview({ buildId: "FB-1", userId: "u", originatingBacklogItemId: "row-1" });
    expect(mockFixLoop).toHaveBeenCalledWith({
      buildId: "FB-1",
      userId: "u",
      failedReview: { decision: "fail", issues: [{ severity: "important", description: `[spec-approval] ${issue}` }] },
    });
    expect(mockPlanDispatch).toHaveBeenCalledWith({ buildId: "FB-1", userId: "u", forceRegenerate: true });
    const summaries = mockPrisma.buildActivity.create.mock.calls.map((call) => call[0].data);
    expect(summaries).toContainEqual(expect.objectContaining({
      tool: INDEPENDENT_REVISION_TOOL,
      summary: expect.stringContaining(INDEPENDENT_REVISION_DONE_PREFIX),
    }));
    expect(out).toMatchObject({ kind: "resumed", via: "reviseDesignFromIndependentReview" });
  });

  it("keeps the build and its plan when the loop could not produce a revision, and spends no round", async () => {
    mockFixLoop.mockResolvedValue({ kind: "blocked-no-regeneration", rounds: 2 });
    const out = await reviseDesignFromIndependentReview({ buildId: "FB-1", userId: "u", originatingBacklogItemId: "row-1" });
    expect(mockPlanDispatch).not.toHaveBeenCalled();
    const summaries = mockPrisma.buildActivity.create.mock.calls.map((call) => String(call[0].data.summary));
    expect(summaries.some((summary) => summary.startsWith(INDEPENDENT_REVISION_DONE_PREFIX))).toBe(false);
    expect(out).toMatchObject({ kind: "skipped" });
  });

  it("does not regenerate the plan when the loop itself escalated", async () => {
    mockFixLoop.mockResolvedValue({ kind: "escalated-after-rounds", rounds: 2 });
    const out = await reviseDesignFromIndependentReview({ buildId: "FB-1", userId: "u", originatingBacklogItemId: "row-1" });
    expect(mockPlanDispatch).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "resumed", detail: expect.stringContaining("escalated-after-rounds") });
  });

  it("hands the build to its owner naming the findings once the revision rounds are spent", async () => {
    mockPrisma.buildActivity.findMany.mockResolvedValue([
      { summary: `${INDEPENDENT_REVISION_DONE_PREFIX} (round 2/2)` },
      { summary: `${INDEPENDENT_REVISION_DONE_PREFIX} (round 1/2)` },
    ]);
    const out = await reviseDesignFromIndependentReview({ buildId: "FB-1", userId: "u", originatingBacklogItemId: "row-1" });
    expect(mockFixLoop).not.toHaveBeenCalled();
    expect(mockEscalate).toHaveBeenCalledWith(expect.objectContaining({
      buildId: "FB-1",
      buildPk: "ck1",
      phase: "plan",
      rounds: 2,
      issues: [{ severity: "important", description: `[spec-approval] ${issue}` }],
    }));
    expect(out).toMatchObject({ kind: "resumed", via: "escalateBuildToHuman" });
  });
});
