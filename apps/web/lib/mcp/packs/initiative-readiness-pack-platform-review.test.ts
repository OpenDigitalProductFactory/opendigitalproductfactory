// BI-AA47C672: in a platform post-implementation review room's scheduled run,
// record_initiative_post_implementation_review writes only the review the
// platform issued the room, with the binding taken from the server, under the
// platform's own authority (no client token).

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTaskRun: vi.fn(),
  platformBinding: vi.fn(),
  recordGateReceipt: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { findUnique: (...args: unknown[]) => mocks.findTaskRun(...args) },
    toolExecution: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/lib/backlog/initiative-readiness", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/backlog/initiative-readiness")>(),
  recordInitiativeGateReceipt: (...args: unknown[]) => mocks.recordGateReceipt(...args),
}));

vi.mock("@/lib/backlog/initiative-readiness/platform-review-room", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/backlog/initiative-readiness/platform-review-room")>(),
  resolvePlatformReviewRunBinding: (...args: unknown[]) => mocks.platformBinding(...args),
}));

import { initiativeReadinessPack } from "./initiative-readiness-pack";

const binding = {
  writerToolName: "record_initiative_post_implementation_review",
  itemId: "BI-MERGED",
  gate: "post-implementation-review",
  workroomRef: { kind: "workroom-head", workroomId: "WC-DELIVERY", repositoryFullName: "o/r", branchName: "fix/x", headSha: "a".repeat(40) },
  artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "o/r", commitSha: "b".repeat(40), path: "apps/web/x.ts", providerBlobId: "c".repeat(40) },
};

const context = { taskRunId: "TR-SCHED-PIR00001", agentId: "AGT-WS-REVIEW", authorityDecisionId: "AUTH-1" } as never;
const handler = () => initiativeReadinessPack.handlers.record_initiative_post_implementation_review!;

describe("record_initiative_post_implementation_review in a platform review run (BI-AA47C672)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findTaskRun.mockResolvedValue({ a2aMetadata: { trigger: "scheduled", sourceRef: { kind: "scheduled-task", id: "workroom-WC-PIR-MERGED-platform-post-implementation-review" } } });
    mocks.recordGateReceipt.mockResolvedValue({ ok: true, receiptId: "R-1", receipt: {} });
  });

  it("records the review the platform issued, with the server's item, gate and change, under platform authority", async () => {
    mocks.platformBinding.mockResolvedValue({ ok: true, data: { itemId: "BI-MERGED", binding } });
    const result = await handler()({
      itemId: "BI-ELSEWHERE", gate: "post-implementation-review", decision: "pass", findings: [], resolvedFindingRefs: [],
      artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "o/r", commitSha: "d".repeat(40), path: "other.ts", providerBlobId: "e".repeat(40) },
      reason: "Read the merged change; the repair holds.",
    }, "user-owner", context);
    expect(result).toMatchObject({ success: true });
    expect(mocks.platformBinding).toHaveBeenCalledWith("TR-SCHED-PIR00001");
    expect(mocks.recordGateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "BI-MERGED", gate: "post-implementation-review", artifactRef: binding.artifactRef, workroomRef: binding.workroomRef,
      reviewerAgentId: "AGT-WS-REVIEW", tokenScope: "organization", requiresIndependentReviewer: true, boundReviewTask: undefined,
    }));
  });

  it("refuses when the room holds no current platform-issued review, and writes nothing", async () => {
    mocks.platformBinding.mockResolvedValue({ ok: false, error: "refused", reason: "packet-no-longer-owed" });
    const result = await handler()({ itemId: "BI-MERGED", gate: "post-implementation-review", decision: "pass", findings: [], resolvedFindingRefs: [],
      artifactRef: binding.artifactRef, reason: "x" }, "user-owner", context);
    expect(result).toMatchObject({ success: false, error: "platform-review-packet-unavailable" });
    expect(mocks.recordGateReceipt).not.toHaveBeenCalled();
  });

  it("leaves every other run untouched: a token-less run outside a platform room keeps no token scope", async () => {
    mocks.platformBinding.mockResolvedValue(null);
    await handler()({ itemId: "BI-MERGED", gate: "post-implementation-review", decision: "pass", findings: [], resolvedFindingRefs: [],
      artifactRef: binding.artifactRef, reason: "x" }, "user-owner", context);
    expect(mocks.recordGateReceipt).toHaveBeenCalledWith(expect.objectContaining({ tokenScope: null }));
  });
});
