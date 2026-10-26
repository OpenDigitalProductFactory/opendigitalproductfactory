import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ active: false, events: [] as string[], receipt: null as null | Record<string, unknown> }));
const db = vi.hoisted(() => ({ findTaskRun: vi.fn(), updateTaskRun: vi.fn(), findModelConfig: vi.fn() }));
const autonomous = vi.hoisted(() => ({ resolveAgent: vi.fn(), resolveTools: vi.fn(), execute: vi.fn() }));
const capture = vi.hoisted(() => vi.fn());
const presentWorker = vi.hoisted(() => vi.fn());
const receiptLookup = vi.hoisted(() => vi.fn());

vi.mock("@dpf/db", () => ({ prisma: {
  taskRun: { findUnique: (...args: unknown[]) => db.findTaskRun(...args), updateMany: (...args: unknown[]) => db.updateTaskRun(...args) },
  agentModelConfig: { findUnique: (...args: unknown[]) => db.findModelConfig(...args) },
} }));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
}));
vi.mock("./mcp-task-reassessment-capture", () => ({ withPersistedReassessmentExecution: (...args: unknown[]) => capture(...args) }));
vi.mock("./mcp-task-reassessment-worker", () => ({ withPresentReassessmentWorker: (...args: unknown[]) => presentWorker(...args) }));
vi.mock("./routing/reassessment-execution-scope", async importOriginal => ({
  ...await importOriginal<typeof import("./routing/reassessment-execution-scope")>(),
  matchesPersistedReassessmentScope: () => state.active,
  currentReassessmentExecution: () => state.active ? { agentId: "AGT-WS-PORTFOLIO", executionFence: fence } : null,
}));
vi.mock("./mcp-task-review-outcome", async importOriginal => ({
  ...await importOriginal<typeof import("./mcp-task-review-outcome")>(),
  loadTaskInitiativeReviewOutcome: (...args: unknown[]) => receiptLookup(...args),
  loadInitiativeReviewOutcome: vi.fn(async () => null),
}));
vi.mock("./pir-evidence-context", () => ({ loadPirEvidenceContext: vi.fn(async () => "") }));
vi.mock("./mcp-task-review-sensitivity", () => ({ remoteReviewSensitivity: vi.fn(async () => "internal") }));
vi.mock("@/lib/tak/native-mcp-executions", () => ({ foldNativeMcpExecutions: vi.fn() }));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));
vi.mock("./mcp/external-approval-location-lookup", () => ({ withTaskRunApprovalLocation: vi.fn(async value => value) }));

import { executeRemoteTaskAttempt } from "./mcp-task-execution";
import { ReassessmentExecutionError } from "./routing/reassessment-execution-scope";
import type { RemoteTaskSubmitParams } from "./mcp-task-submit-params";

const binding = {
  writerToolName: "record_initiative_evidence", itemId: "BI-REASSESSMENT", gate: "research" as const,
  artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "example/project", commitSha: "a".repeat(40),
    path: "docs/review.md", providerBlobId: "b".repeat(40) },
};
const parsed: RemoteTaskSubmitParams = {
  agentId: "AGT-WS-PORTFOLIO", routeContext: "/platform/build", title: "Review", objective: "Review the immutable artifact.",
  prompt: "Read the immutable source and record the canonical review.", idempotencyKey: "review:existing-admission",
  riskClass: "bounded-write", authorityScope: ["backlog-item:BI-REASSESSMENT", "tool:read_source_at_version", "tool:record_initiative_evidence"],
  collaborationKind: "handoff", initiativeReviewBinding: binding,
};
const fence = { schemaVersion: 1 as const, reservation: "reservation-1", dispatchClaim: "claim-1", authorityDigest: null,
  requestDigest: "9".repeat(64) };
const marker = { schemaVersion: 1, manifestArtifactId: "sealed-manifest", manifestDigest: "8".repeat(64) };
const progressPayload = { resumeReservedAt: fence.reservation, dispatch: { claimedAt: fence.dispatchClaim, count: 3, state: "claimed" },
  deadlineAt: "2026-10-22T00:00:00.000Z", priorEvidence: "retained" };
function admitted(restricted = true) {
  return { id: "run-record", taskRunId: "TR-REASSESSMENT", userId: "human", currentAgentId: parsed.agentId,
    status: "working", updatedAt: new Date(), progressPayload: structuredClone(progressPayload),
    a2aMetadata: { trigger: "external-mcp", requestDigest: fence.requestDigest, initiativeReviewBinding: binding,
      ...(restricted ? { reassessmentExecution: structuredClone(marker) } : {}) } };
}
function run(params = parsed) {
  return executeRemoteTaskAttempt({ run: { id: "run-record", taskRunId: "TR-REASSESSMENT", contextId: "thread" },
    threadId: "thread", token: { tokenId: "PAT", userId: "human", capability: "write", source: "pat" }, userContext: {} as never,
    parsed: params, idempotentReplay: false, capacityAttempt: 1, expectedReservation: fence.reservation, expectedDispatchClaim: fence.dispatchClaim });
}
const receipt = { receiptId: "canonical-receipt", gate: "research", decision: "pass", artifactRef: binding.artifactRef,
  summary: "The genuine canonical receipt is persisted." };
const writes = () => db.updateTaskRun.mock.calls.map(([args]) => args.data as Record<string, unknown>);

beforeEach(() => {
  vi.resetAllMocks(); state.active = false; state.events = []; state.receipt = null;
  db.findTaskRun.mockResolvedValue(admitted()); db.updateTaskRun.mockResolvedValue({ count: 1 }); db.findModelConfig.mockResolvedValue(null);
  receiptLookup.mockImplementation(async () => state.receipt);
  capture.mockImplementation(async (input, callback) => {
    state.events.push("scope-open");
    if (!input.binding || input.a2aMetadata.reassessmentExecution?.manifestArtifactId !== marker.manifestArtifactId)
      throw new ReassessmentExecutionError("reassessment-manifest-invalid");
    state.active = true;
    try { return await callback(); } finally { state.active = false; }
  });
  autonomous.resolveAgent.mockImplementation(async () => { state.events.push("agent");
    return { agentId: parsed.agentId, systemPrompt: "Review independently.", sensitivity: "internal" }; });
  autonomous.resolveTools.mockImplementation(async () => { state.events.push("tools");
    return { tools: [], toolsForProvider: [], deferredTools: [] }; });
  autonomous.execute.mockImplementation(async () => { state.events.push("loop"); return { content: "Review held.", executedTools: [] }; });
  presentWorker.mockImplementation(async (_input, _ports, callback) => {
    state.events.push("qualification-worker"); state.active = true;
    try { return await callback(); } finally { state.active = false; }
  });
});

describe("persisted reassessment worker boundary", () => {
  it("opens capture before agent/tool preparation and runs exactly one callback under the admitted full fence", async () => {
    await run();
    expect(state.events).toEqual(["scope-open", "agent", "tools", "loop"]);
    expect(capture).toHaveBeenCalledOnce(); expect(autonomous.execute).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ taskRunRecordId: "run-record", taskRunId: "TR-REASSESSMENT",
      userId: "human", agentId: parsed.agentId, binding, requestDigest: fence.requestDigest, executionFence: fence,
      a2aMetadata: admitted().a2aMetadata, progressPayload }), expect.any(Function));
    expect(autonomous.resolveTools).toHaveBeenCalledWith(expect.objectContaining({ restrictedReviewBinding: binding }));
    expect(autonomous.execute).toHaveBeenCalledWith(expect.objectContaining({ taskExecutionFence: fence, tokenGrantScopes: parsed.authorityScope }));
    expect(autonomous.execute.mock.calls[0][0].canonicalReviewReceipt).toBeTypeOf("function");
    expect(writes()[0]).toMatchObject({ progressPayload: { resumeReservedAt: fence.reservation, dispatch: progressPayload.dispatch,
      deadlineAt: progressPayload.deadlineAt } });
  });

  it("does not wrap or restrict an ordinary admitted task", async () => {
    db.findTaskRun.mockResolvedValue(admitted(false)); await run();
    expect(capture).not.toHaveBeenCalled(); expect(state.events).toEqual(["agent", "tools", "loop"]);
    expect(autonomous.resolveTools.mock.calls[0][0]).not.toHaveProperty("restrictedReviewBinding");
    expect(autonomous.execute.mock.calls[0][0]).not.toHaveProperty("canonicalReviewReceipt");
  });

  it("routes a V2 root through the qualification owner before preparation, then recurses once under its same fence", async () => {
    const row = admitted(); row.a2aMetadata.reassessmentExecution = { ...marker, schemaVersion: 2 };
    db.findTaskRun.mockResolvedValue(row);
    await run();
    expect(capture).not.toHaveBeenCalled(); expect(presentWorker).toHaveBeenCalledOnce();
    expect(state.events).toEqual(["qualification-worker", "agent", "tools", "loop"]);
    expect(presentWorker.mock.calls[0][0]).toMatchObject({ persistedInput: { executionFence: fence,
      progressPayload, a2aMetadata: row.a2aMetadata }, parsed, threadId: "thread" });
    expect(autonomous.execute.mock.calls[0][0].taskExecutionFence).toEqual(fence);
  });

  it("preserves ordinary preparation errors without changing their settlement behavior", async () => {
    db.findTaskRun.mockResolvedValue(admitted(false)); autonomous.resolveTools.mockRejectedValue(Error("Preparation refused"));
    await expect(run()).rejects.toThrow("Preparation refused");
    expect(db.updateTaskRun).not.toHaveBeenCalled(); expect(autonomous.execute).not.toHaveBeenCalled();
  });

  it.each(["binding", "locator"])("fails closed for a malformed persisted %s before any agent, tools or provider probes", async malformed => {
    const row = admitted(); if (malformed === "locator") row.a2aMetadata.reassessmentExecution = null as never;
    db.findTaskRun.mockResolvedValue(row);
    await run(malformed === "binding" ? { ...parsed, initiativeReviewBinding: undefined } : parsed);
    expect(autonomous.resolveAgent).not.toHaveBeenCalled(); expect(db.findModelConfig).not.toHaveBeenCalled();
    expect(autonomous.resolveTools).not.toHaveBeenCalled(); expect(autonomous.execute).not.toHaveBeenCalled();
  });

  it("refuses a resolved canonical actor that differs from the sealed admission before tool or provider preparation", async () => {
    autonomous.resolveAgent.mockResolvedValue({ agentId: "AGT-WS-OTHER", systemPrompt: "Wrong actor." });
    expect(await run()).toMatchObject({ result: { status: "failed", isError: true } });
    expect(db.findModelConfig).not.toHaveBeenCalled(); expect(autonomous.resolveTools).not.toHaveBeenCalled();
    expect(autonomous.execute).not.toHaveBeenCalled();
  });

  it("lets a genuine earlier canonical receipt win before opening capture or preparing inference", async () => {
    state.receipt = receipt;
    expect(await run()).toMatchObject({ result: { status: "completed", structuredContent: receipt } });
    expect(capture).not.toHaveBeenCalled(); expect(autonomous.resolveAgent).not.toHaveBeenCalled();
    expect(writes()[0]).toMatchObject({ status: "completed", progressPayload: { reviewOutcome: receipt, requiresApproval: false } });
  });

  it.each([null, { kind: "present-reassessment-quarantine", replayAllowed: false }])(
    "holds a quarantined predecessor before all preparation, including a malformed marker", async quarantine => {
      const row = admitted(false); Object.assign(row.progressPayload, { reassessmentQuarantine: quarantine });
      db.findTaskRun.mockResolvedValue(row);
      expect(await run()).toMatchObject({ result: { status: "input-required", resumable: false } });
      expect(state.events).toEqual([]); expect(capture).not.toHaveBeenCalled();
      expect(writes()).toEqual([]);
    },
  );
  it("returns a genuine canonical receipt before a predecessor quarantine hold", async () => {
    const row = admitted(false); Object.assign(row.progressPayload, { reassessmentQuarantine: { replayAllowed: false } });
    db.findTaskRun.mockResolvedValue(row); state.receipt = receipt;
    expect(await run()).toMatchObject({ result: { status: "completed", structuredContent: receipt } });
    expect(state.events).toEqual([]); expect(capture).not.toHaveBeenCalled();
  });

  it("does not let receipt reconciliation overwrite a canceled or newer task after a lost CAS", async () => {
    const row = admitted(false); state.receipt = receipt;
    db.findTaskRun.mockResolvedValueOnce(row).mockResolvedValue({ ...row, status: "canceled" });
    db.updateTaskRun.mockResolvedValue({ count: 0 });
    expect(await run()).toMatchObject({ result: { status: "canceled", resumable: false } });
    expect(state.events).toEqual([]); expect(capture).not.toHaveBeenCalled();
  });

  it("does not adopt a later reservation when the sealed wrapper invokes its callback", async () => {
    capture.mockImplementation(async (_input, callback) => {
      const displaced = admitted(); displaced.progressPayload.resumeReservedAt = "later-reservation";
      db.findTaskRun.mockResolvedValue(displaced); state.active = true;
      try { return await callback(); } finally { state.active = false; }
    });
    const input = {
      run: { id: "run-record", taskRunId: "TR-REASSESSMENT", contextId: "thread" }, threadId: "thread",
      token: { tokenId: "PAT", userId: "human", capability: "write" as const, source: "pat" as const },
      userContext: {} as never, parsed, idempotentReplay: false, capacityAttempt: 1,
    };
    expect(await executeRemoteTaskAttempt(input)).toMatchObject({ result: { status: "working" } });
    expect(capture).toHaveBeenCalledOnce(); expect(autonomous.resolveAgent).not.toHaveBeenCalled();
    expect(autonomous.execute).not.toHaveBeenCalled(); expect(db.updateTaskRun).not.toHaveBeenCalled();
  });

  it("reconciles a canonical receipt committed just before the capture wrapper throws", async () => {
    capture.mockImplementation(async () => { state.receipt = receipt; throw new ReassessmentExecutionError("reassessment-capture-incomplete"); });
    expect(await run()).toMatchObject({ result: { status: "completed", structuredContent: receipt, idempotentReplay: false, isError: false } });
    expect(autonomous.resolveAgent).not.toHaveBeenCalled(); expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ status: "completed", progressPayload: { reviewOutcome: receipt } });
  });

  it.each([true, false])("reconciles a genuine canonical receipt after execution throws (restricted=%s)", async restricted => {
    db.findTaskRun.mockResolvedValue(admitted(restricted));
    autonomous.execute.mockImplementation(async () => { state.receipt = receipt; throw new ReassessmentExecutionError("reassessment-capture-incomplete"); });
    expect(await run()).toMatchObject({ result: { status: "completed", structuredContent: receipt, isError: false } });
    expect(writes()).toHaveLength(1); expect(writes()[0]).toMatchObject({ status: "completed", progressPayload: { reviewOutcome: receipt } });
    expect(JSON.stringify(writes())).not.toContain('"status":"failed"');
  });

  it.each(["heartbeat", "quarantine", "unknown"])("settles a genuine post-error receipt after a same-fence %s update", async change => {
    const initial = admitted(false), fresh = { ...initial, updatedAt: new Date(initial.updatedAt.getTime() + 1000),
      progressPayload: { ...initial.progressPayload, heartbeatAt: "fresh-heartbeat" } };
    if (change === "quarantine") Object.assign(fresh.progressPayload, { reassessmentQuarantine: { replayAllowed: false } });
    if (change === "unknown") Object.assign(fresh.progressPayload, { executionUncertainty: {
      schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown",
    } });
    db.findTaskRun.mockResolvedValue(initial);
    db.updateTaskRun.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    autonomous.execute.mockImplementation(async () => { state.receipt = receipt; db.findTaskRun.mockResolvedValue(fresh); throw Error("post-write acknowledgement lost"); });
    expect(await run()).toMatchObject({ result: { status: "completed", structuredContent: receipt, idempotentReplay: false } });
    expect(db.updateTaskRun).toHaveBeenCalledTimes(2);
    expect(db.updateTaskRun.mock.calls[1][0]).toMatchObject({ where: { status: "working", updatedAt: fresh.updatedAt },
      data: { progressPayload: { heartbeatAt: "fresh-heartbeat", deadlineAt: progressPayload.deadlineAt, reviewOutcome: receipt } } });
    if (change === "unknown") expect(writes()[1].progressPayload).toMatchObject({
      executionUncertaintyResolution: { reviewReceiptId: receipt.receiptId, prior: { executionUncertainty: { settlement: "unknown" } } },
    });
    expect(autonomous.execute).toHaveBeenCalledOnce(); expect(capture).not.toHaveBeenCalled();
  });

  it.each(["reservation", "dispatch", "authority", "request", "actor", "user", "canceled"])(
    "does not refresh receipt settlement across a changed %s", async change => {
      const initial = admitted(false), fresh = admitted(false); fresh.updatedAt = new Date(initial.updatedAt.getTime() + 1000);
      if (change === "reservation") fresh.progressPayload.resumeReservedAt = "new-reservation";
      if (change === "dispatch") fresh.progressPayload.dispatch.claimedAt = "new-dispatch";
      if (change === "authority") Object.assign(fresh.progressPayload, { reviewExecutionAuthority: { schemaVersion: 1, decisionId: "new-authority" } });
      if (change === "request") fresh.a2aMetadata.requestDigest = "2".repeat(64);
      if (change === "actor") fresh.currentAgentId = "AGT-WS-OTHER";
      if (change === "user") fresh.userId = "other-human";
      if (change === "canceled") fresh.status = "canceled";
      db.findTaskRun.mockResolvedValue(initial); db.updateTaskRun.mockResolvedValueOnce({ count: 0 });
      autonomous.execute.mockImplementation(async () => { state.receipt = receipt; db.findTaskRun.mockResolvedValue(fresh); throw Error("post-write acknowledgement lost"); });
      expect(await run()).toMatchObject({ result: { status: fresh.status } });
      expect(db.updateTaskRun).toHaveBeenCalledOnce(); expect(autonomous.execute).toHaveBeenCalledOnce();
    },
  );

  it("stops after the single fresh receipt CAS loses to cancellation", async () => {
    const initial = admitted(false), fresh = { ...initial, updatedAt: new Date(initial.updatedAt.getTime() + 1000) };
    db.findTaskRun.mockResolvedValue(initial);
    db.updateTaskRun.mockImplementation(async () => {
      if (db.updateTaskRun.mock.calls.length === 2) db.findTaskRun.mockResolvedValue({ ...fresh, status: "canceled" });
      return { count: 0 };
    });
    autonomous.execute.mockImplementation(async () => { state.receipt = receipt; db.findTaskRun.mockResolvedValue(fresh); throw Error("post-write acknowledgement lost"); });
    expect(await run()).toMatchObject({ result: { status: "canceled", resumable: false } });
    expect(db.updateTaskRun).toHaveBeenCalledTimes(2); expect(db.findTaskRun).toHaveBeenCalledTimes(3);
    expect(autonomous.execute).toHaveBeenCalledOnce();
  });

  it.each(["reassessment-capture-incomplete", "reassessment-effect-outcome-uncertain"])("holds %s as sanitized unknown execution when no canonical receipt exists", async code => {
    autonomous.execute.mockRejectedValue(new ReassessmentExecutionError(code, "private-provider-output"));
    expect(await run()).toMatchObject({ result: { status: "input-required", resumable: false, requiresApproval: false,
      waitReason: "execution-uncertain", structuredContent: { executionUncertainty: { settlement: "unknown" } } } });
    expect(writes()[0]).toMatchObject({ status: "input-required", completedAt: null, progressPayload: { priorEvidence: "retained",
      executionUncertainty: { schemaVersion: 1, settlement: "unknown" }, dispatch: progressPayload.dispatch } });
    expect(JSON.stringify(writes())).not.toContain("private-provider-output");
  });

  it("holds receipt readback unavailability as unknown instead of inventing completion or a product failure", async () => {
    autonomous.execute.mockImplementation(async () => { receiptLookup.mockRejectedValue(Error("readback unavailable")); throw Error("loop interrupted"); });
    expect(await run()).toMatchObject({ result: { status: "input-required", waitReason: "execution-uncertain" } });
    expect(writes()[0]).toMatchObject({ status: "input-required", progressPayload: { executionUncertainty: { settlement: "unknown" } } });
    expect(writes()[0].progressPayload).not.toHaveProperty("reviewOutcome");
  });
});
