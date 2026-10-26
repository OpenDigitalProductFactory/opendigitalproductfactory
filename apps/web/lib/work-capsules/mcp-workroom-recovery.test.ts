import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ workroom: { findUnique: vi.fn() }, workroomActivity: { findMany: vi.fn(), findFirst: vi.fn() },
  taskRun: { findMany: vi.fn() }, backlogItem: { findMany: vi.fn() }, $queryRaw: vi.fn(),
  $executeRaw: vi.fn(), $transaction: vi.fn() }));
const handoffRecovery = vi.hoisted(() => vi.fn());
vi.mock("./workroom-failed-handoff-recovery.server", () => ({ loadWorkroomFailedHandoffRecovery: handoffRecovery }));
const roomAccess = vi.hoisted(() => vi.fn(async () => ({ decision: { level: "content" } })));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("../portfolio/investment-balance-server", () => ({ projectItemInvestment: vi.fn(async () => null) }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({
  resolveAgentWorkroomAccess: roomAccess,
  resolveHumanWorkroomAccess: roomAccess,
}));

import { getWorkCapsuleTool } from "./mcp-handlers";
import { clampToolResultForModel, MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";

const now = new Date();
const room = { id: "room-row", capsuleId: "WC-1", title: "Review recovery", objective: "Expose recorded review state",
  repositoryFullName: "owner/repo", headBranch: "fix/readback", worktreePath: "D:/readback",
  baseSha: "0".repeat(40), headSha: "1".repeat(40), taskRun: null, activities: [] };

function reviewCandidate() {
  return { id: "review-row", taskRunId: "TR-REVIEW", userId: "requester-1", status: "working",
    createdAt: now, updatedAt: now, lastHeartbeatAt: now, capsuleId: room.capsuleId,
    reviewKind: "semantic-review", candidatePosition: 1, roomMissing: false, scalarTruncated: false,
    ambiguousReviewKind: false, bindingTruncated: false, progressTruncated: false, nodeFieldsTruncated: false,
    initiativeBinding: null, requestDigest: null, requesterAgentId: "AGT-EXT-CODEX", metadataTrigger: null,
    roomRepositoryFullName: room.repositoryFullName, roomHeadBranch: room.headBranch,
    roomHeadSha: room.headSha, roomBacklogItemId: null, user: null, nodes: [],
    progressPayload: { privateProviderOutput: "must-not-escape", semanticReview: { schemaVersion: 1,
      deadlineAt: new Date(now.getTime() + 60_000).toISOString(), recoveryAttempt: 0 } } };
}
let candidates: Array<Record<string, unknown>>;
let identities: Array<Record<string, unknown>>;
let candidateFailure: Error | null;

describe("get_workroom native review readback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    handoffRecovery.mockResolvedValue(null);
    db.$transaction.mockImplementation(async work => work(db));
    db.workroom.findUnique.mockResolvedValue(room);
    db.workroomActivity.findMany.mockResolvedValue([]);
    db.backlogItem.findMany.mockResolvedValue([]);
    candidates = [reviewCandidate()];
    candidateFailure = null;
    identities = [{ rowId: "review-row", capsuleId: "WC-1", requestBound: true, requestSchemaVersion: 2,
      requestArtifactType: "code-change", identityArtifactType: "code-change", identityArtifactTypePresent: true,
      requesterAgentId: "AGT-EXT-CODEX", sourceHeadSha: room.headSha, currentHeadSha: room.headSha,
      issuedAt: new Date(now.getTime() - 1_000).toISOString() }];
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ..._values: unknown[]) => {
      const sql = strings.join("");
      if (sql.includes("candidates AS MATERIALIZED")) {
        if (candidateFailure) throw candidateFailure;
        return candidates;
      }
      if (sql.includes('AS "rowId"')) return identities;
      throw new Error("Unexpected review query");
    });
  });


  it("retains the current recorded blocker through model serialization without scanning history or granting a repair", async () => {
    const explanation = "Transfer did not complete. The recorded blocker must be inspected before another attempt.";
    db.workroom.findUnique.mockResolvedValue({ ...room, status: "blocked",
      workspaceState: { statusOverride: { reason: explanation, until: new Date(Date.now() + 60_000).toISOString() },
        unrelated: "irrelevant".repeat(MCP_ROUTE_TOOL_RESULT_CHAR_CAP) } });
    candidates = [];
    identities = [];
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1");
    const formatted = clampToolResultForModel(result, { maxChars: MCP_ROUTE_TOOL_RESULT_CHAR_CAP });
    expect(formatted.truncated).toBe(false);
    const readback = JSON.parse(formatted.text.slice(formatted.text.indexOf("\n") + 1));
    expect(readback).toMatchObject({ capsule: { recovery: { state: "blocked",
      recordedBlocker: { explanation, explanationState: "current", coordinationOnly: true },
      blocker: { reason: "workroom-blocked", accountableOwner: null, action: null } } },
      omittedFields: expect.arrayContaining(["capsule.workspaceState"]) });
    expect(JSON.stringify(readback)).not.toContain("irrelevant");
    expect(db.workroomActivity.findMany).not.toHaveBeenCalled();
  });

  it("resolves a Build Studio row-id linkage before emitting the semantic backlog recovery call", async () => {
    db.workroom.findUnique.mockResolvedValue({ ...room, backlogItemId: "backlog-row" });
    candidateFailure = new Error("review unavailable");
    db.backlogItem.findMany.mockResolvedValue([{ id: "backlog-row", itemId: "BI-EXISTING" }]);
    expect(await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1")).toMatchObject({ data: { capsule: { recovery: {
      state: "unknown", blocker: { action: { toolName: "get_backlog_item",
        args: { itemId: "BI-EXISTING", recoveryGate: "post-implementation-review" } } },
    } } } });
    expect(db.backlogItem.findMany).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("exposes metadata-linked execution without leaking the private task payload", async () => {
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1");
    expect(result).toMatchObject({ success: true, data: { capsule: { recovery: { state: "working",
      reviewerExecution: { taskRunId: "TR-REVIEW", pending: true, accountableOwner: { agentId: "AGT-EXT-CODEX" } } } } } });
    expect(db.taskRun.findMany).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(db.$queryRaw.mock.calls[0][0].join("")).toContain("candidates AS MATERIALIZED");
    expect(db.$queryRaw.mock.calls[0][1]).toEqual(["WC-1"]);
    expect(db.$queryRaw.mock.calls[1][0].join("")).toContain('AS "rowId"');
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
  });

  it("returns the recorded final result and keeps full receipts behind tasks/result authorization", async () => {
    candidates[0].status = "completed";
    identities[0] = { ...identities[0], receiptId: "receipt-1", receiptDecision: "pass",
      receiptSummary: "Native review passed.", receiptCreatedAt: now };
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1");
    expect(result).toMatchObject({ data: { capsule: { recovery: { state: "terminal", reviewerExecution: {
      receipt: { id: "receipt-1", decision: "pass" },
      resultAction: { method: "tasks/result", params: { taskId: "TR-REVIEW" }, requiredUserId: "requester-1" },
    } } } } });
  });

  it("keeps unreadable review state unknown while retaining the room", async () => {
    candidateFailure = new Error("review source unavailable");
    expect(await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1")).toMatchObject({ success: true,
      data: { capsule: { recovery: { state: "unknown", blocker: { reason: "review-observation-incomplete" } } } } });
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw.mock.calls[0][0].join("")).toContain("candidates AS MATERIALIZED");
  });

  it("distinguishes a successful empty candidate read from an unavailable source", async () => {
    candidates = [];
    expect(await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1")).toMatchObject({ success: true,
      data: { capsule: { recovery: { state: "actionable", reviewerExecution: null,
        reviewerExecutions: [], reviewerExecutionsTruncated: false } } } });
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("does not read review records for a missing room", async () => {
    db.workroom.findUnique.mockResolvedValue(null);
    expect(await getWorkCapsuleTool({ capsuleId: "WC-MISSING" }, "requester-1")).toMatchObject({ success: false, error: "not_found" });
    expect(db.taskRun.findMany).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("retains exact source and ownership plus recovery when bulky room history exceeds the route budget", async () => {
    const ownership = { leaseHolderPrincipalId: "PRN-OWNER", leaseExpiresAt: now, updatedAt: now, executorRef: "session-1" };
    db.workroom.findUnique.mockResolvedValue({ ...room, ...ownership, activitySequence: 123,
      activities: [{ payload: "x".repeat(150_000) }], workspaceState: { trace: "y".repeat(150_000) } });
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1");
    expect(JSON.stringify(result.data).length).toBeLessThanOrEqual(100_000);
    expect(result).toMatchObject({ success: true, data: { capsule: { ...ownership, capsuleId: "WC-1",
      repositoryFullName: room.repositoryFullName, baseSha: room.baseSha, headSha: room.headSha,
      worktreePath: room.worktreePath, activitySequence: 123, recovery: { state: "working" } },
      omittedFields: expect.arrayContaining(["capsule.activities", "capsule.workspaceState"]) } });
  });

  it("keeps an oversized activity page explicitly incomplete without advancing its cursor", async () => {
    db.workroomActivity.findMany.mockResolvedValue([{ sequence: 1, payload: "x".repeat(150_000) }]);
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1", afterSequence: 0 }, "requester-1");
    expect(JSON.stringify(result.data).length).toBeLessThanOrEqual(100_000);
    expect(result).toMatchObject({ success: true, data: { capsule: { recovery: { state: "working" } },
      log: { afterSequence: 0, activity: [], hasMore: true, incomplete: true, reason: "activity-page-budget-exceeded" } } });
  });

  it("offers bounded metadata and an exact detail call when a raw activity payload exceeds the budget", async () => {
    db.workroom.findUnique.mockResolvedValue({ ...room, activitySequence: 1 });
    db.workroomActivity.findMany.mockResolvedValue([{ id: "oversized-activity", sequence: 1,
      payload: { result: "x".repeat(150_000) } }]);
    db.$queryRaw.mockResolvedValue([{ id: "oversized-activity", sequence: 1, kind: "evidence-recorded",
      summary: "Original review evidence", summaryShortened: false, recordedAt: now,
      recordedById: "requester-1", recordedByAgentId: "AGT-EXT-CODEX", toolExecutionId: null }]);
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1", afterSequence: 0, activityMode: "bounded" },
      "requester-1", { agentId: "AGT-EXT-CODEX" });
    expect(result).toMatchObject({ success: true, data: { log: { representation: "metadata", payloadsDelivered: false,
      activity: [{ id: "oversized-activity", detail: { toolName: "get_workroom",
        arguments: { capsuleId: "WC-1", activityMode: "bounded", activityId: "oversized-activity" } } }] } } });
    expect(db.workroomActivity.findMany).not.toHaveBeenCalled();
    expect(db.workroom.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { capsuleId: "WC-1" },
      select: { id: true, capsuleId: true, activitySequence: true } });
    expect(JSON.stringify(result).length).toBeLessThan(4000);
  });

  it("withholds bounded activity on current admission denial without selecting history", async () => {
    db.workroom.findUnique.mockResolvedValue({ ...room, activitySequence: 1 });
    roomAccess.mockResolvedValue({ decision: { level: "none" } });
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1", activityMode: "bounded" }, "requester-1", { agentId: "AGT-EXT-CODEX" });
    expect(result).toMatchObject({ success: false, error: "workroom_content_access_required" });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.workroomActivity.findMany).not.toHaveBeenCalled();
  });

  it("withholds bounded results when admission changes before the response", async () => {
    db.workroom.findUnique.mockResolvedValue({ ...room, activitySequence: 1 });
    db.$queryRaw.mockResolvedValue([{ id: "activity-1", sequence: 1, kind: "note", summary: "private-row" }]);
    roomAccess.mockResolvedValueOnce({ decision: { level: "content" } }).mockResolvedValueOnce({ decision: { level: "none" } });
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1", activityMode: "bounded" }, "requester-1", { agentId: "AGT-EXT-CODEX" });
    expect(result).toMatchObject({ success: false, error: "workroom_content_access_required" });
    expect(JSON.stringify(result)).not.toContain("private-row");
  });

  it("reports bounded transaction failure without claiming an empty completed range", async () => {
    db.$transaction.mockRejectedValue(new Error("statement timeout"));
    expect(await getWorkCapsuleTool({ capsuleId: "WC-1", activityMode: "bounded" }, "requester-1")).toMatchObject({
      success: false, error: "activity_read_unavailable",
    });
    expect(db.workroomActivity.findMany).not.toHaveBeenCalled();
  });

  it("requires explicit bounded mode for detail arguments instead of silently ignoring them", async () => {
    expect(await getWorkCapsuleTool({ capsuleId: "WC-1", activityId: "activity-1" }, "requester-1")).toMatchObject({
      success: false, error: "invalid_activity_read",
    });
    expect(db.workroom.findUnique).not.toHaveBeenCalled();
  });

  it("keeps current recovery parseable at the actual model-facing response boundary", async () => {
    const ownership = { leaseHolderPrincipalId: "PRN-OWNER", leaseExpiresAt: now, updatedAt: now, executorRef: "session-1" };
    db.workroom.findUnique.mockResolvedValue({ ...room, ...ownership, workspaceState: "" });
    const empty = await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1");
    const padding = MCP_ROUTE_TOOL_RESULT_CHAR_CAP - JSON.stringify(empty.data).length;
    db.workroom.findUnique.mockResolvedValue({ ...room, ...ownership, workspaceState: "x".repeat(padding) });
    const result = await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1");
    const formatted = clampToolResultForModel(result, { maxChars: MCP_ROUTE_TOOL_RESULT_CHAR_CAP });
    expect(formatted.truncated).toBe(false);
    const readback = JSON.parse(formatted.text.slice(formatted.text.indexOf("\n") + 1));
    expect(readback).toMatchObject({ capsule: { ...ownership, leaseExpiresAt: now.toISOString(), updatedAt: now.toISOString(),
      headSha: room.headSha, worktreePath: room.worktreePath, recovery: { state: "working" } },
      omittedFields: expect.arrayContaining(["capsule.workspaceState"]) });
  });

  it("preserves distinct ordinary originals and incomplete observation through model-facing serialization", async () => {
    db.workroom.findUnique.mockResolvedValue({ ...room, backlogItemId: "BI-1" });
    const originals = [
      { id: "spec-original", taskRunId: "TR-SPEC", gate: "spec-approval", digest: "d".repeat(64),
        artifactVersion: "b".repeat(40), blob: "f".repeat(40), path: "docs/superpowers/specs/existing.md" },
      { id: "plan-original", taskRunId: "TR-PLAN", gate: "plan-review", digest: "e".repeat(64),
        artifactVersion: "c".repeat(40), blob: "a".repeat(40), path: "docs/superpowers/plans/existing.md" },
    ];
    for (const truncated of [false, true]) {
      candidates = originals.map((original, index) => ({ ...reviewCandidate(),
        id: original.id, taskRunId: original.taskRunId, reviewKind: "initiative-review", candidatePosition: index + 1,
        requestDigest: original.digest, metadataTrigger: "external-mcp", roomBacklogItemId: "BI-1",
        initiativeBinding: { writerToolName: "record_initiative_design_review", itemId: "BI-1", gate: original.gate,
          workroomRef: { kind: "workroom-head", workroomId: room.capsuleId,
            repositoryFullName: room.repositoryFullName, branchName: room.headBranch, headSha: room.headSha },
          artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: room.repositoryFullName,
            commitSha: original.artifactVersion, path: original.path, providerBlobId: original.blob } },
        // Bounded progress can be incomplete while both original request identities remain valid.
        progressTruncated: truncated && index === 0,
        progressPayload: truncated && index === 0 ? { semanticReview: { projectionTruncated: true } } : {},
      }));
      const result = await getWorkCapsuleTool({ capsuleId: room.capsuleId }, "requester-1");
      const formatted = clampToolResultForModel(result, { maxChars: MCP_ROUTE_TOOL_RESULT_CHAR_CAP });
      expect(formatted.truncated).toBe(false);
      const readback = JSON.parse(formatted.text.slice(formatted.text.indexOf("\n") + 1));
      expect(readback.capsule.recovery).toMatchObject({ state: truncated ? "unknown" : "working",
        reviewerExecution: null, reviewerExecutionsTruncated: truncated });
      expect(readback.capsule.recovery.reviewerExecutions).toHaveLength(2);
      expect(readback.capsule.recovery.reviewerExecutions).toMatchObject(originals.map(original => ({
        taskRunId: original.taskRunId, reviewKind: "initiative-review", reviewGate: original.gate,
        identityScope: "current", identityConflict: false, sourceHeadSha: room.headSha,
        artifactVersion: original.artifactVersion, requestDigest: original.digest,
        accountableOwner: { userId: "requester-1", agentId: "AGT-EXT-CODEX" },
        budget: { deadlineAt: null, recoveryAttempt: null }, receipt: null,
        resultAction: { method: "tasks/result", params: { taskId: original.taskRunId, requestDigest: original.digest },
          requiredUserId: "requester-1" },
      })));
    }
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(db.$queryRaw.mock.calls.every(([strings]) => strings.join("").includes("candidates AS MATERIALIZED"))).toBe(true);
    expect(db.taskRun.findMany).not.toHaveBeenCalled();
  });

  it("reports an explicit failure when exact identity itself cannot fit, instead of returning a truncated identity", async () => {
    db.workroom.findUnique.mockResolvedValue({ ...room, worktreePath: "x".repeat(150_000) });
    expect(await getWorkCapsuleTool({ capsuleId: "WC-1" }, "requester-1")).toMatchObject({
      success: false, error: "workroom_recovery_budget_exceeded" });
  });
});

it("passes actual authenticated MCP context into the typed current-room recovery reader",async()=>{db.workroom.findUnique.mockResolvedValue({...room,status:"blocked"});candidates=[];identities=[];const context={agentId:"AGT-EXT-CODEX",authSource:"oauth",apiTokenId:"own-token",tokenScope:"write",tokenGrantScopes:["work_capsule_write"]};const recovery={kind:"failed-bounded-handoff",state:"waiting",reason:"handoff-receiver-acknowledgement-required",checkedAt:new Date().toISOString(),owner:{userId:"requester-1",agentId:"AGT-EXT-CODEX",executorRef:"source-chat"},original:{envelopeId:"original",executionId:"actual",executedAt:new Date().toISOString()},action:null,pending:{requestId:"real-request",requestDigest:"a".repeat(64),receiverRef:"receiver-chat"}};handoffRecovery.mockResolvedValue(recovery);const result=await getWorkCapsuleTool({capsuleId:"WC-1"},"requester-1",context);expect(handoffRecovery).toHaveBeenCalledWith(expect.objectContaining({userId:"requester-1",workroomRowId:"room-row",context}),db);expect(result).toMatchObject({data:{capsule:{recovery:{failedHandoffRecovery:recovery}}}});});
