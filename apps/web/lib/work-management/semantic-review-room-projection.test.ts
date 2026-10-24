import { describe, expect, it, vi } from "vitest";
import { loadSemanticReviewRoomProjection, type ReviewerRunSnapshot } from "./semantic-review-room-projection";
import { projectWorkroomRecovery } from "@/lib/work-capsules/workroom-recovery-projection";

vi.mock("./review-room-candidates", () => ({ loadReviewRoomCandidates: vi.fn(async (db, capsuleIds: string[]) => {
  if (!capsuleIds.length) return { rows: [], partial: false, partialCapsuleIds: [] };
  const rows = await db.taskRun?.findMany({}).catch(() => null);
  const partial = !rows || rows.length > 20 || rows.some((row: ReviewerRunSnapshot) => !row.nodes || row.nodes.length > 12);
  return { rows: (rows ?? []).slice(0, 20).map((row: ReviewerRunSnapshot) => ({ capsuleId: capsuleIds[0], reviewKind: "semantic-review", ...row })),
    partial, partialCapsuleIds: partial ? capsuleIds : [] };
}) }));

const now = new Date("2026-09-08T20:00:00Z");
const run = (status: string): ReviewerRunSnapshot => ({
  id: "row-1", taskRunId: "TR-1", userId: "requester-1", status,
  updatedAt: now, lastHeartbeatAt: null,
  progressPayload: { semanticReview: { reason: "provider-outcome-uncertain-after-restart", requestDigest: "digest-1", recoveryAttempt: 1 } },
  nodes: [{ id: "node-row-1", taskNodeId: "TN-1", title: "Semantic review: AGT-181", status: "running", updatedAt: now, requestContract: { agentId: "AGT-181" } }],
});

describe("reviewer state in its Workroom", () => {
  it.each([
    { status: "completed", decision: "pass" }, { status: "completed", decision: "fail" },
    { status: "completed", decision: "inconclusive" }, { status: "input-required", decision: null },
  ])("keeps complete historical-only $status/$decision observation complete and gives the canonical issuer action", async ({ status, decision }) => {
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => [run(status)] },
      $queryRaw: vi.fn().mockResolvedValue([{ rowId: "row-1", capsuleId: "WC-1", requestBound: true,
        requestSchemaVersion: 2, requestArtifactType: "code-change", identityArtifactType: "code-change", identityArtifactTypePresent: true,
        sourceHeadSha: "b".repeat(40), currentHeadSha: "a".repeat(40), issuedAt: "2026-09-08T19:00:00Z",
        requesterAgentId: "AGT-EXT-CODEX", receiptId: decision ? "old-result" : null,
        receiptDecision: decision, receiptSummary: "Historical only", receiptCreatedAt: now }]),
    }, ["WC-1"], now);
    expect(view.partial).toBe(false);
    const recovery = projectWorkroomRecovery({ capsuleId: "WC-1", backlogItemId: "BI-1", leaseHolderPrincipalId: "principal-1",
      repositoryFullName: "owner/repo", headBranch: "fix/readback", worktreePath: "D:/source", baseSha: "c".repeat(40), headSha: "a".repeat(40) }, view);
    expect(recovery.state).toBe("unknown");
    expect(recovery.reviewerExecution).toBeNull();
    expect(recovery.blocker).toMatchObject({ reason: "current-review-unavailable",
      accountableOwner: { principalId: "principal-1", role: "delivery-coordinator" },
      action: { toolName: "get_backlog_item", args: { itemId: "BI-1", recoveryGate: "post-implementation-review" } } });
    expect(recovery.historicalReviewerExecutions).toMatchObject([{ taskRunId: "TR-1", identityScope: "historical",
      sourceHeadSha: "b".repeat(40), resultAction: { requiredUserId: "requester-1" } }]);
    expect(recovery.historicalReviewerExecutions[0].receipt?.decision).toBe(decision ?? undefined);
  });

  it("replaces obsolete retry instructions after expiry and links a successor", async () => {
    const row = run("input-required");
    row.progressPayload = { semanticReview: { schemaVersion: 1, deadlineAt: "2026-09-08T19:00:00Z",
      action: "Keep polling", recoveryAttempt: 1 } };
    let view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => [row] } }, ["WC-1"], now);
    expect(view.runs[0].nextAction).toContain("bounded successor");
    row.status = "canceled";
    (row.progressPayload as any).semanticReview.successorTaskRunId = "TR-2";
    view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => [row] } }, ["WC-1"], now);
    expect(view.runs[0].nextAction).toContain("TR-2");
  });

  it("keeps an older head's exhausted review out of current attention", async () => {
    const old = { ...run("input-required"), id: "old-row", taskRunId: "TR-OLD" };
    const current = { ...run("completed"), id: "current-row", taskRunId: "TR-CURRENT" };
    const identity = (rowId: string, sourceHeadSha: string, issuedAt: string) => ({
      rowId, capsuleId: "WC-1", requestBound: true, requestSchemaVersion: 2, requestArtifactType: "code-change", identityArtifactType: "code-change", identityArtifactTypePresent: true, sourceHeadSha,
      currentHeadSha: "a".repeat(40), issuedAt, receiptId: null,
    });
    const view = await loadSemanticReviewRoomProjection({
      taskRun: { findMany: async () => [old, current] },
      $queryRaw: vi.fn().mockResolvedValue([
        identity("old-row", "b".repeat(40), "2026-09-08T19:00:00Z"),
        identity("current-row", "a".repeat(40), "2026-09-08T19:30:00Z"),
      ]),
    }, ["WC-1"], now);
    expect(view.attentionReason).toBeNull();
    expect(view.runs.find(row => row.taskRunId === "TR-OLD")).toMatchObject({ identityScope: "historical" });
    expect(view.runs.find(row => row.taskRunId === "TR-CURRENT")).toMatchObject({ capsuleId: "WC-1", identityScope: "current" });
    expect(view.runs).toHaveLength(2);
  });

  it("uses request issue time instead of late activity to identify the current request on one head", async () => {
    const view = await loadSemanticReviewRoomProjection({
      taskRun: { findMany: async () => [run("input-required"), { ...run("completed"), id: "row-2", taskRunId: "TR-2" }] },
      $queryRaw: vi.fn().mockResolvedValue([1, 2].map(index => ({
        rowId: `row-${index}`, capsuleId: "WC-1", requestBound: true, requestSchemaVersion: 2, requestArtifactType: "code-change", identityArtifactType: "code-change", identityArtifactTypePresent: true, sourceHeadSha: "a".repeat(40),
        currentHeadSha: "a".repeat(40), issuedAt: `2026-09-08T19:0${index}:00Z`, receiptId: null,
      }))),
    }, ["WC-1"], now);
    expect(view.attentionReason).toBeNull();
    expect(view.runs[0]).toMatchObject({ identityScope: "historical" });
    expect(view.runs[1]).toMatchObject({ identityScope: "current" });
  });

  it("labels missing request correlation unknown instead of claiming a current review", async () => {
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => [run("completed")] },
      $queryRaw: vi.fn().mockResolvedValue([{ rowId: "row-1", requestBound: false, requesterAgentId: "unbound-agent" }]),
    }, ["WC-1"], now);
    expect(view.runs[0]).toMatchObject({ identityScope: "unknown" });
    expect(view.runs[0].requesterAgentId).toBeNull();
    expect(view.partial).toBe(true);
  });

  it("does not present the previous wait as the action of a working generation", async () => {
    const row = run("working");
    row.progressPayload = { semanticReview: { reason: "provider-outcome-uncertain", action: "Retry the old failure." } };
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => [row] } }, ["WC-1"], now);
    expect(view.runs[0].reason).toBeNull();
    expect(view.runs[0].nextAction).toContain("server owns continuation");
  });

  it("exposes a correlated receipt as evidence without promoting Workroom completion", async () => {
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => [run("completed")] },
      $queryRaw: vi.fn().mockResolvedValue([{ rowId: "row-1", capsuleId: "WC-1", requestBound: true, requestSchemaVersion: 2, requestArtifactType: "code-change", identityArtifactType: "code-change", identityArtifactTypePresent: true,
        sourceHeadSha: "a".repeat(40), currentHeadSha: "a".repeat(40), issuedAt: "2026-09-08T19:00:00Z",
        requesterAgentId: "AGT-EXT-CODEX", receiptId: "receipt-1", receiptDecision: "pass", receiptSummary: "The committed change was reviewed.",
        receiptCreatedAt: now,
      }]),
    }, ["WC-1"], now);
    expect(view.runs[0]).toMatchObject({ receipt: { id: "receipt-1", decision: "pass", summary: "The committed change was reviewed." } });
    expect(view.runs[0].requesterAgentId).toBe("AGT-EXT-CODEX");
    expect(view.receipts.every(receipt => receipt.status === "observed")).toBe(true);
    expect(view.receipts).toContainEqual(expect.objectContaining({ receiptId: "receipt-1", rawRef: { table: "ExternalEvidenceRecord", id: "receipt-1" } }));
  });
  it("reads the requester's recorded profile name while retaining stable identity", async () => {
    const findMany = vi.fn(async () => [{ ...run("input-required"), user: { employeeProfile: { displayName: "Alex" } } }]);
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany } }, ["WC-1"], now);
    expect(view.runs[0]).toMatchObject({ requesterName: "Alex", requesterId: "requester-1" });
    expect(findMany).toHaveBeenCalledOnce();
  });
  it.each(["local-ci-active-capacity-reservation", "host-gpu-busy", "portal-quiescing", "review-authority-unavailable"])(
    "projects the automatic %s wait instead of an obsolete retry instruction", async reason => {
      const row = run("input-required");
      row.nodes = [];
      row.progressPayload = { semanticReview: { schemaVersion: 1, reason: "review-capacity-deferred",
        requestDigest: "a".repeat(64), recoveryAttempt: 1, deadlineAt: "2026-09-08T20:10:00Z",
        nextAction: "retry-review", capacityWaitReason: reason,
        capacityRecovery: { schemaVersion: 1, requestDigest: "a".repeat(64), checks: 1, nextCheckAt: "2026-09-08T20:00:30Z" } } };
      const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => [row] },
        $queryRaw: vi.fn().mockResolvedValue([{ rowId: "row-1", capsuleId: "WC-1", requestBound: true,
          requestSchemaVersion: 2, requestArtifactType: "code-change", identityArtifactType: "code-change", identityArtifactTypePresent: true,
          sourceHeadSha: "a".repeat(40), currentHeadSha: "a".repeat(40), issuedAt: "2026-09-08T19:00:00Z" }]),
      }, ["WC-1"], now);
      expect(view.partial).toBe(false);
      expect(view.runs[0].nextAction).toContain("server will recheck");
      expect(view.runs[0]).toMatchObject({ requesterId: "requester-1", reason, identityScope: "current", recoveryWait: false });
      expect(view.runs[0].receipt).toBeUndefined();
    },
  );

  it("preserves the next action recorded by review settlement", async () => {
    const row = run("input-required");
    row.progressPayload = { semanticReview: { nextAction: "retry-review" } };
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => [row] } }, ["WC-1"], now);
    expect(view.runs[0].nextAction).toBe("retry-review");
  });
  it("projects a wait for inspection using recorded authority and budget facts", async () => {
    const row = run("input-required");
    row.progressPayload = { semanticReview: { schemaVersion: 1, reason: "provider-outcome-uncertain-after-restart",
      action: "Inspect the provider outcome before recovery.", deadlineAt: "2026-09-08T20:10:00Z", recoveryAttempt: 1 } };
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => [row] } }, ["WC-1"], now);
    expect(view.runs).toEqual([expect.objectContaining({ taskRunId: "TR-1", status: "input-required",
      requesterId: "requester-1", reason: "provider-outcome-uncertain-after-restart",
      nextAction: "Inspect the provider outcome before recovery.", recoveryWait: true,
      budget: { deadlineAt: "2026-09-08T20:10:00Z", recoveryAttempt: 1 },
      readAt: now.toISOString(), heartbeat: "unknown",
      checkpoints: [expect.objectContaining({ taskNodeId: "TN-1", actorId: "AGT-181", status: "running" })],
    })]);
  });
  it("reads only native reviews correlated to the selected rooms with bounded history", async () => {
    const findMany = vi.fn(async () => [run("input-required")]);
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany } }, ["WC-1"], now);
    expect(findMany).toHaveBeenCalledOnce();
    expect(view.attentionReason).toContain("TR-1");
    expect(view.receipts[0]).toMatchObject({ status: "observed", rawRef: { table: "TaskRun", id: "row-1" }, actorRef: { actorId: "requester-1" } });
    expect(view.receipts[0].summary).toContain("provider-outcome-uncertain-after-restart");
    expect(view.receipts[1]).toMatchObject({ status: "observed", rawRef: { table: "TaskNode", id: "node-row-1" }, actorRef: { actorKind: "agent", actorId: "AGT-181" } });
  });
  it("never promotes a completed reviewer run into verified Workroom completion", async () => {
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => [run("completed")] } }, ["WC-1"], now);
    expect(view.receipts.every((receipt) => receipt.status === "observed")).toBe(true);
    expect(view.attentionReason).toBeNull();
    expect(view.receipts[0].summary).toContain("completion receipt");
  });
  it("makes unknown status and heartbeat freshness explicit", async () => {
    const record = { ...run("future-state"), lastHeartbeatAt: new Date("2026-09-08T19:00:00Z") };
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => [record] } }, ["WC-1"], now);
    expect(view.receipts[0].summary).toContain("unknown");
    expect(view.receipts[0].summary).toContain("2026-09-08T19:00:00.000Z");
    expect(view.receipts[0].summary).toContain("Heartbeat stale");
    expect(view.attentionReason).toContain("unknown");
  });
  it("reports missing sources and truncation instead of an empty healthy projection", async () => {
    expect((await loadSemanticReviewRoomProjection({}, ["WC-1"], now)).partial).toBe(true);
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => Array.from({ length: 21 }, (_, i) => ({ ...run("submitted"), id: `row-${i}`, taskRunId: `TR-${i}`, nodes: [] })) } }, ["WC-1"], now);
    expect(view.partial).toBe(true);
    expect(view.receipts).toHaveLength(20);
  });
  it("does not read reviews for an unanchored case", async () => {
    const findMany = vi.fn();
    expect((await loadSemanticReviewRoomProjection({ taskRun: { findMany } }, [], now)).partial).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });
  it("keeps the room readable when the reviewer source fails", async () => {
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => { throw new Error("database unavailable"); } } }, ["WC-1"], now);
    expect(view.partial).toBe(true);
    expect(view.receipts).toEqual([]);
    expect(view.attentionReason).toContain("could not be read");
  });
});


describe("ordinary initiative review observations", () => {
  const initiative = (id = "original", gate = "spec-approval") => ({
    ...run("input-required"), id, taskRunId: `TR-${id}`, nodes: [],
    capsuleId: "WC-1", reviewKind: "initiative-review" as const,
    createdAt: new Date("2026-09-08T19:00:00Z"), requestDigest: "d".repeat(64),
    metadataTrigger: "external-mcp", requesterAgentId: "AGT-EXT-CODEX",
    roomRepositoryFullName: "owner/repo", roomHeadBranch: "fix/readback",
    roomHeadSha: "a".repeat(40), roomBacklogItemId: "BI-1",
    initiativeBinding: { writerToolName: gate === "architecture-review" ? "record_initiative_architecture_review" : "record_initiative_design_review",
      itemId: "BI-1", gate, workroomRef: { kind: "workroom-head", workroomId: "WC-1",
        repositoryFullName: "owner/repo", branchName: "fix/readback", headSha: "a".repeat(40) },
      artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "b".repeat(40),
        path: "docs/superpowers/plans/existing.md", providerBlobId: "c".repeat(40) } },
    progressPayload: { executionUncertainty: { schemaVersion: 1, settlement: "unknown" },
      semanticReview: { nextAction: "retry-review", recoveryAttempt: 0 } },
  });
  const project = (rows: ReturnType<typeof initiative>[]) => loadSemanticReviewRoomProjection({
    taskRun: { findMany: async () => rows }, $queryRaw: vi.fn().mockResolvedValue([]),
  }, ["WC-1"], now);

  it("retains a current room's ordinary review of an older immutable plan without inferring settlement", async () => {
    const view = await project([initiative()]);
    expect(view.partial).toBe(false);
    expect(view.runs[0]).toMatchObject({ reviewKind: "initiative-review", reviewGate: "spec-approval",
      identityScope: "current", sourceHeadSha: "a".repeat(40), artifactVersion: "b".repeat(40),
      requestDigest: "d".repeat(64), executionUncertain: true, recoveryWait: false });
    expect(view.runs[0].receipt).toBeUndefined();
    expect(view.runs[0].nextAction).not.toContain("retry-review");
  });
  it("carries the canonical ordinary wait reason into its blocker without granting retry", async () => {
    const row = initiative();
    (row as any).progressPayload = { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer",
      resumeMode: "same-taskrun", writerToolName: "record_initiative_design_review", attempt: 1,
      observedAt: "2026-09-08T19:00:00Z", dispatchContract: "required-tool-call" } };
    const view = await project([row]);
    expect(view.runs[0]).toMatchObject({ reason: "missing-terminal-writer", recoveryWait: false, executionUncertain: false });
    const recovery = projectWorkroomRecovery({ capsuleId: "WC-1", backlogItemId: "BI-1", leaseHolderPrincipalId: "principal-1",
      repositoryFullName: "owner/repo", headBranch: "fix/readback", worktreePath: "D:/source",
      baseSha: "c".repeat(40), headSha: "a".repeat(40) }, view);
    expect(recovery.blocker).toMatchObject({ reason: "missing-terminal-writer", action: { method: "tasks/result",
      params: { taskId: row.taskRunId, requestDigest: "d".repeat(64) } } });
    row.status = "working";
    expect((await project([row])).runs[0].reason).toBeNull();
  });
  it("preserves distinct gates and competing originals instead of choosing the latest per head", async () => {
    const view = await project([initiative("spec-1"), initiative("architecture", "architecture-review"), initiative("spec-2")]);
    expect(view.runs).toHaveLength(3);
    expect(view.runs.every(row => row.identityScope === "current")).toBe(true);
    expect(view.runs.filter(row => row.identityConflict).map(row => row.taskRunId)).toEqual(["TR-spec-1", "TR-spec-2"]);
    expect(view.attentionReason).toBeTruthy();
  });
  it.each(["repository", "branch", "item", "digest", "binding"])("does not qualify an inconsistent %s identity", async kind => {
    const row = initiative();
    if (kind === "repository") row.roomRepositoryFullName = "foreign/repo";
    if (kind === "branch") row.roomHeadBranch = "fix/foreign";
    if (kind === "item") row.roomBacklogItemId = "BI-OTHER";
    if (kind === "digest") row.requestDigest = "invalid";
    if (kind === "binding") (row as any).initiativeBinding = [];
    const view = await project([row]);
    expect(view.partial).toBe(true);
    expect(view.runs[0]).toMatchObject({ identityScope: "unknown", recoveryWait: false, requestDigest: null, sourceHeadSha: null });
    expect(view.runs[0].receipt).toBeUndefined();
  });
});
