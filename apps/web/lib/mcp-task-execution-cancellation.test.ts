import { beforeEach, describe, expect, it, vi } from "vitest";

const recoveryAuthority = vi.hoisted(() => vi.fn());
vi.mock("./mcp-task-review-recovery", () => ({ revalidateReviewExecutionAuthority: recoveryAuthority }));
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
vi.mock("./mcp-task-review-outcome", () => ({
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

const reviewTaskIdentity = { userId: "user-1", currentAgentId: parsed.agentId,
  a2aMetadata: { requestDigest: "9".repeat(64), initiativeReviewBinding: parsed.initiativeReviewBinding } };

describe("remote task cancellation settlement", () => {
  it("rejects a stale queue claim before invoking inference", async () => {
    db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status: "working", progressPayload: { dispatch: { claimedAt: "new", count: 2 } } });
    const outcome = await executeRemoteTaskAttempt({
      run: { id: "run", taskRunId: "TR-DISPATCH", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "PAT", userId: "user-1", capability: "write", source: "pat" },
      userContext: {} as never, parsed, idempotentReplay: true, capacityAttempt: 1,
      expectedReservation: null, expectedDispatchClaim: "old",
    });
    expect(outcome).toMatchObject({ kind: "result", result: { status: "working" } });
    expect(autonomous.execute).not.toHaveBeenCalled();
    expect(db.updateTaskRun).not.toHaveBeenCalled();
  });
  it("refuses malformed transferred authority before inference without falling back to the origin token", async () => {
    db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status: "working", progressPayload: { reviewExecutionAuthority: { tokenId: "forged" } }, a2aMetadata: reviewTaskIdentity.a2aMetadata });
    const outcome = await executeRemoteTaskAttempt({ run: { id: "run", taskRunId: "TR-RECOVERY", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "PAT", userId: "user-1", capability: "write", source: "pat" }, userContext: {} as never,
      parsed, idempotentReplay: true, capacityAttempt: 1 });
    expect(outcome).toMatchObject({ kind: "result", result: { status: "working",
      progressPayload: { reviewExecutionAuthority: { tokenId: "forged" } } } });
    expect(db.updateTaskRun).not.toHaveBeenCalled();
    expect(autonomous.execute).not.toHaveBeenCalled(); expect(autonomous.resolveAgent).not.toHaveBeenCalled();
  });
  it.each(["capacity", "missing-writer", "exception"])("retains current authority and recorded windows when execution parks as %s", async mode => {
    const authority = { schemaVersion: 1, tokenId: "current-token", originTokenId: "expired-token" };
    const deadlineAt = new Date(Date.now() + 60_000).toISOString();
    const expiresAt = new Date(Date.now() + 120_000).toISOString();
    db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status: "working", progressPayload: { reviewExecutionAuthority: authority, deadlineAt, expiresAt }, a2aMetadata: reviewTaskIdentity.a2aMetadata });
    recoveryAuthority.mockResolvedValue(true);
    if (mode === "exception") autonomous.execute.mockRejectedValue(Error("Provider failure"));
    else autonomous.execute.mockResolvedValue({ content: "Still waiting", executedTools: [],
      ...(mode === "capacity" ? { failure: { kind: "capacity", message: "No provider capacity available" } } : {}) });
    await executeRemoteTaskAttempt({ run: { id: "run", taskRunId: "TR-RECOVERED", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "current-token", userId: "user-1", capability: "write", source: "oauth" }, userContext: {} as never,
      parsed, idempotentReplay: true, capacityAttempt: 1 });
    expect(autonomous.execute).toHaveBeenCalledOnce();
    expect(db.updateTaskRun).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      progressPayload: expect.objectContaining({ reviewExecutionAuthority: authority, deadlineAt, expiresAt }),
    }) }));
  });
  it("preserves queue claim and dispatch budget when parking", async () => {
    const dispatch = { claimedAt: "claim", count: 3, state: "claimed" };
    db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status: "working", progressPayload: { dispatch } });
    autonomous.execute.mockResolvedValueOnce({ content: "Writer missing", executedTools: [] });
    await executeRemoteTaskAttempt({
      run: { id: "run", taskRunId: "TR-DISPATCH", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "PAT", userId: "user-1", capability: "write", source: "pat" },
      userContext: {} as never, parsed, idempotentReplay: false, capacityAttempt: 1,
      expectedReservation: null, expectedDispatchClaim: "claim",
    });
    expect(db.updateTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ progressPayload: expect.objectContaining({ dispatch }) }),
    }));
  });
  it("does not adopt a newer reservation when the caller entered late", async () => {
    db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status: "working", progressPayload: { resumeReservedAt: "new" } });
    autonomous.execute.mockResolvedValueOnce({ content: "Old result", executedTools: [] });
    const outcome = await executeRemoteTaskAttempt({
      run: { id: "run", taskRunId: "TR-LATE", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "PAT", userId: "user-1", capability: "write", source: "pat" },
      userContext: {} as never, parsed, idempotentReplay: true, capacityAttempt: 1,
      expectedReservation: "old",
    });
    expect(outcome).toMatchObject({ kind: "result", result: { status: "working" } });
    expect(db.updateTaskRun).not.toHaveBeenCalled();
  });
  it("retains reservation identity when the newer attempt parks for its writer", async () => {
    db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status: "working", progressPayload: { resumeReservedAt: "new" } });
    autonomous.execute.mockResolvedValueOnce({ content: "Writer missing", executedTools: [] });
    await executeRemoteTaskAttempt({
      run: { id: "run", taskRunId: "TR-NEWER", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "PAT", userId: "user-1", capability: "write", source: "pat" },
      userContext: {} as never, parsed, idempotentReplay: false, capacityAttempt: 1,
    });
    expect(db.updateTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "input-required", progressPayload: expect.objectContaining({ resumeReservedAt: "new" }) }),
    }));
  });
  it.each(["working", "input-required"])("does not overwrite a newer reservation in %s", async (status) => {
    db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status: "working", progressPayload: { resumeReservedAt: "old" } });
    autonomous.execute.mockImplementationOnce(async () => {
      db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status, progressPayload: { resumeReservedAt: "new" } });
      return { content: "Old result", executedTools: [] };
    });
    const outcome = await executeRemoteTaskAttempt({
      run: { id: "run", taskRunId: "TR-NEWER", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "PAT", userId: "user-1", capability: "write", source: "pat" },
      userContext: {} as never, parsed, idempotentReplay: false, capacityAttempt: 1,
    });
    expect(outcome).toMatchObject({ kind: "result", result: { status } });
    expect(db.updateTaskRun).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    recoveryAuthority.mockResolvedValue(false);
    autonomous.execute.mockReset();
    db.updateTaskRun.mockReset();
    db.findModelConfig.mockResolvedValue(null);
    db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status: "working" });
    db.updateTaskRun.mockResolvedValue({ count: 1 });
    autonomous.resolveAgent.mockResolvedValue({
      agentId: "AGT-WS-PORTFOLIO",
      displayName: "Portfolio Advisor",
      systemPrompt: "Review independently.",
      sensitivity: "internal",
    });
    autonomous.resolveTools.mockResolvedValue({ tools: [], toolsForProvider: [], deferredTools: [] });
  });

  it.each(["canceled", "archived", "rejected", "quiescing", "paused-for-upgrade", "paused-for-upgrade-forced", "stalled"])("preserves externally settled %s state", async (status) => {
    db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status, progressPayload: {} });
    autonomous.execute.mockResolvedValueOnce({ content: "Late result", executedTools: [] });
    const outcome = await executeRemoteTaskAttempt({
      run: { id: "run", taskRunId: "TR-SETTLED", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "PAT", userId: "user-1", capability: "write", source: "pat" },
      userContext: {} as never, parsed, idempotentReplay: false, capacityAttempt: 1,
    });
    expect(outcome).toMatchObject({ kind: "result", result: { status, resumable: false } });
    expect(autonomous.execute).not.toHaveBeenCalled();
    expect(autonomous.resolveTools).not.toHaveBeenCalled();
    expect(db.updateTaskRun).not.toHaveBeenCalled();
  });
  it("returns cancellation when cancellation wins the conditional settlement write", async () => {
    const updatedAt = new Date("2026-09-27T23:00:00Z");
    db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status: "working", updatedAt });
    db.updateTaskRun.mockImplementationOnce(async () => {
      db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status: "canceled", progressPayload: {} });
      return { count: 0 };
    });
    autonomous.execute.mockResolvedValueOnce({ content: "Late result", executedTools: [] });
    const outcome = await executeRemoteTaskAttempt({
      run: { id: "run", taskRunId: "TR-RACE", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "PAT", userId: "user-1", capability: "write", source: "pat" },
      userContext: {} as never, parsed, idempotentReplay: false, capacityAttempt: 1,
    });
    expect(db.updateTaskRun).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskRunId: "TR-RACE", status: "working", updatedAt },
    }));
    expect(outcome).toMatchObject({ kind: "result", result: { status: "canceled", resumable: false } });
  });
  it.each(["missing-writer", "completed", "exception"])("preserves cancellation while inference returns %s", async (settlement) => {
    db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status: "working", progressPayload: {}, taskRunId: "TR-CANCELLED" });
    autonomous.execute.mockImplementationOnce(async () => {
      db.findTaskRun.mockResolvedValue({ ...reviewTaskIdentity, status: "canceled", progressPayload: {}, taskRunId: "TR-CANCELLED" });
      if (settlement === "exception") throw new Error("Late provider failure");
      return { content: "Late inference output", executedTools: [] };
    });
    const outcome = await executeRemoteTaskAttempt({
      run: { id: "run", taskRunId: "TR-CANCELLED", contextId: "thread-1" }, threadId: "thread-1",
      token: { tokenId: "PAT", userId: "user-1", capability: "write", source: "pat" },
      userContext: {} as never,
      parsed: settlement === "completed" ? { ...parsed, initiativeReviewBinding: undefined } : parsed,
      idempotentReplay: false, capacityAttempt: 1,
    });
    expect(outcome).toMatchObject({ kind: "result", result: { status: "canceled" } });
    expect(db.updateTaskRun).not.toHaveBeenCalled();
  });
});
