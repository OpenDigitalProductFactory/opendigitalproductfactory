import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findModelConfig: vi.fn(),
  findTaskRun: vi.fn(),
  updateTaskRun: vi.fn(),
}));
const autonomous = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveAgent: vi.fn(),
  resolveTools: vi.fn(),
}));
const pirContext = vi.hoisted(() => vi.fn(async () => ""));
const sensitivity = vi.hoisted(() => vi.fn(async (_parsed: unknown, _token: unknown, fallback: string) => fallback));
vi.mock("./mcp-task-review-sensitivity", () => ({ remoteReviewSensitivity: sensitivity }));
vi.mock("./pir-evidence-context", () => ({ loadPirEvidenceContext: pirContext }));
vi.mock("./mcp-task-review-outcome", async (importOriginal) => ({
  ...await importOriginal<typeof import("./mcp-task-review-outcome")>(),
  // BI-2E479619: the executor consults the TaskRun's persisted receipt before classifying a missing writer.
  loadTaskInitiativeReviewOutcome: vi.fn(async () => null),
  loadInitiativeReviewOutcome: vi.fn(async (_binding: unknown, receiptId: string) => ({
    receiptId, summary: `Receipt ${receiptId} persisted. Implementation readiness: input-required; plan coverage remains missing.`,
  })),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    agentModelConfig: { findUnique: (...args: unknown[]) => db.findModelConfig(...args) },
    taskRun: {
      findUnique: (...args: unknown[]) => db.findTaskRun(...args),
      update: (...args: unknown[]) => db.updateTaskRun(...args),
      updateMany: (...args: unknown[]) => db.updateTaskRun(...args),
    },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));
vi.mock("./mcp/external-approval-location-lookup", () => ({
  withTaskRunApprovalLocation: vi.fn(async (value: unknown) => value),
}));

import { executeRemoteTaskAttempt } from "./mcp-task-execution";


const writerToolName = "record_initiative_evidence";
const parsed = {
  agentId: "AGT-WS-PORTFOLIO",
  routeContext: "/platform/build",
  title: "Independent research review",
  objective: "Review the immutable artifact.",
  prompt: "Read the source and record the governed evidence.",
  idempotencyKey: "initiative-readiness:BI-FFBDDD96:research:current-head-1",
  riskClass: "bounded-write" as const,
  authorityScope: [
    "backlog-item:BI-FFBDDD96",
    "tool:read_source_at_version",
    `tool:${writerToolName}`,
  ],
  collaborationKind: "handoff" as const,
  initiativeReviewBinding: {
    writerToolName,
    itemId: "BI-FFBDDD96",
    gate: "research" as const,
    artifactRef: {
      kind: "repo-blob-at-commit" as const,
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "0db795572b944370fa132b8c4ab11c759cc63bb1",
      path: "docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md",
      providerBlobId: "951fe02f7aa19a6a0866d42620c83bb8d3d9d8cd",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.findModelConfig.mockResolvedValue(null);
  db.updateTaskRun.mockResolvedValue({ count: 1 });
  autonomous.resolveAgent.mockResolvedValue({ agentId: parsed.agentId, systemPrompt: "Review independently.", sensitivity: "internal" });
});
describe("admitted review execution fence", () => {
  it.each(["request", "authority", "owner", "reviewer", "reservation", "dispatch", "unknown", "held", "cancelled"])(
    "does not adopt a changed %s after hydration", async changed => {
      const current = { userId: "human", currentAgentId: parsed.agentId, status: "working", updatedAt: new Date(),
        progressPayload: { resumeReservedAt: "reserved", dispatch: { claimedAt: "dispatch" } } as Record<string, unknown>,
        a2aMetadata: { requestDigest: "9".repeat(64), initiativeReviewBinding: parsed.initiativeReviewBinding } };
      const { captureTaskExecutionFence } = await import("./shared/task-execution-fence");
      const expectedExecutionFence = captureTaskExecutionFence(current.progressPayload, current.a2aMetadata.requestDigest)!;
      if (changed === "request") current.a2aMetadata.requestDigest = "8".repeat(64);
      if (changed === "authority") current.progressPayload.reviewExecutionAuthority = { schemaVersion: 1, tokenId: "other" };
      if (changed === "owner") current.userId = "other";
      if (changed === "reviewer") current.currentAgentId = "other";
      if (changed === "reservation") current.progressPayload.resumeReservedAt = "later";
      if (changed === "dispatch") current.progressPayload.dispatch = { claimedAt: "later" };
      if (changed === "unknown") current.progressPayload.executionUncertainty = { settlement: "unknown" };
      if (changed === "held") current.status = "input-required";
      if (changed === "cancelled") current.status = "canceled";
      db.findTaskRun.mockResolvedValue(current);
      await executeRemoteTaskAttempt({ run: { id: "original", taskRunId: "TR-ORIGINAL", contextId: "thread-1" }, threadId: "thread-1",
        token: { tokenId: "oauth", userId: "human", capability: "write", source: "oauth" }, userContext: {} as never,
        parsed, idempotentReplay: true, capacityAttempt: 1, expectedExecutionFence });
      expect(autonomous.resolveAgent).not.toHaveBeenCalled();
      expect(autonomous.execute).not.toHaveBeenCalled();
      expect(db.updateTaskRun).not.toHaveBeenCalled();
    });
  it.each(["completion", "exception", "parking"])("does not overwrite a later uncertainty, authority or owner during %s", async mode => {
    for (const displacedBy of ["uncertainty", "authority", "owner", "actor", "request", "parked"] as const) {
      vi.clearAllMocks();
      const admitted = { userId: "human", currentAgentId: parsed.agentId, status: "working", updatedAt: new Date(),
        progressPayload: { resumeReservedAt: "same", dispatch: { claimedAt: "same" } },
        a2aMetadata: { requestDigest: "9".repeat(64), initiativeReviewBinding: parsed.initiativeReviewBinding } };
      const current = structuredClone(admitted);
      db.findTaskRun.mockResolvedValue(admitted);
      autonomous.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
      autonomous.execute.mockImplementationOnce(async () => {
        if (displacedBy === "uncertainty") Object.assign(current.progressPayload, { executionUncertainty: { settlement: "unknown" } });
        if (displacedBy === "authority") Object.assign(current.progressPayload, { reviewExecutionAuthority: { schemaVersion: 1, tokenId: "later" } });
        if (displacedBy === "owner") current.userId = "other-human";
        if (displacedBy === "actor") current.currentAgentId = "other-reviewer";
        if (displacedBy === "request") current.a2aMetadata.requestDigest = "8".repeat(64);
        if (displacedBy === "parked") current.status = "input-required";
        db.findTaskRun.mockResolvedValue(current);
        if (mode === "exception") throw Error("Old provider failed");
        return { content: "Old provider completed", executedTools: mode === "parking" ? [] : [{ name: writerToolName,
          result: { success: true, data: { receiptId: "persisted-receipt" } } }] };
      });
      const outcome = await executeRemoteTaskAttempt({ run: { id: "original", taskRunId: "TR-ORIGINAL", contextId: "thread-1" }, threadId: "thread-1",
        token: { tokenId: "oauth", userId: "human", capability: "write", source: "oauth" }, userContext: {} as never,
        parsed, idempotentReplay: false, capacityAttempt: 1, expectedReservation: "same", expectedDispatchClaim: "same" });
      expect(db.updateTaskRun, displacedBy).not.toHaveBeenCalled();
      expect(outcome, displacedBy).toMatchObject({ kind: "result", result: { status: current.status } });
    }
  });
  it("settles a current full-fence executor using its persisted canonical receipt", async () => {
    db.findTaskRun.mockResolvedValue({ userId: "human", currentAgentId: parsed.agentId, status: "working", updatedAt: new Date(),
      progressPayload: {}, a2aMetadata: { requestDigest: "9".repeat(64), initiativeReviewBinding: parsed.initiativeReviewBinding } });
    autonomous.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
    autonomous.execute.mockResolvedValue({ content: "Contradictory model prose", executedTools: [{ name: writerToolName,
      result: { success: true, data: { receiptId: "persisted-receipt" } } }] });
    expect(await executeRemoteTaskAttempt({ run: { id: "original", taskRunId: "TR-ORIGINAL", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "oauth", userId: "human", capability: "write", source: "oauth" }, userContext: {} as never,
      parsed, idempotentReplay: false, capacityAttempt: 1 }))
      .toMatchObject({ result: { status: "completed", structuredContent: { receiptId: "persisted-receipt" } } });
    expect(db.updateTaskRun).toHaveBeenCalledOnce();
    expect(db.updateTaskRun).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "completed", progressPayload: expect.objectContaining({ reviewOutcome: { receiptId: "persisted-receipt", summary: expect.any(String) } }),
    }) }));
  });
  it("captures the admitted request and generation before asynchronous tool preparation", async () => {
    const admitted = { status: "working", progressPayload: { resumeReservedAt: "original", dispatch: { claimedAt: "original-dispatch" } },
      a2aMetadata: { requestDigest: "9".repeat(64) } };
    db.findTaskRun.mockResolvedValue(admitted);
    autonomous.resolveTools.mockImplementationOnce(async () => {
      admitted.progressPayload.resumeReservedAt = "later";
      admitted.progressPayload.dispatch.claimedAt = "later-dispatch";
      admitted.a2aMetadata.requestDigest = "8".repeat(64);
      return { tools: [], toolsForProvider: [], deferredTools: [] };
    });
    autonomous.execute.mockResolvedValue({ content: "Reviewing.", executedTools: [] });
    await executeRemoteTaskAttempt({ run: { id: "original", taskRunId: "TR-ORIGINAL", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "oauth", userId: "human", capability: "write", source: "oauth" }, userContext: {} as never,
      parsed, idempotentReplay: false, capacityAttempt: 1, expectedReservation: "original", expectedDispatchClaim: "original-dispatch" });
    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({ taskExecutionFence: {
      schemaVersion: 1, reservation: "original", dispatchClaim: "original-dispatch", authorityDigest: null, requestDigest: "9".repeat(64),
    } }));
  });
});
