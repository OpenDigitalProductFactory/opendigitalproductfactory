import { describe, expect, it, vi } from "vitest";
import { loadSemanticReviewRoomProjection, type ReviewerRunSnapshot } from "./semantic-review-room-projection";

const now = new Date("2026-09-08T20:00:00Z");
const run = (status: string): ReviewerRunSnapshot => ({
  id: "row-1", taskRunId: "TR-1", userId: "requester-1", status,
  updatedAt: now, lastHeartbeatAt: null,
  progressPayload: { semanticReview: { reason: "provider-outcome-uncertain-after-restart", requestDigest: "digest-1", recoveryAttempt: 1 } },
  nodes: [{ id: "node-row-1", taskNodeId: "TN-1", title: "Semantic review: AGT-181", status: "running", updatedAt: now, requestContract: { agentId: "AGT-181" } }],
});

describe("reviewer state in its Workroom", () => {
  it("keeps an older head's exhausted review out of current attention", async () => {
    const old = { ...run("input-required"), id: "old-row", taskRunId: "TR-OLD" };
    const current = { ...run("completed"), id: "current-row", taskRunId: "TR-CURRENT" };
    const identity = (rowId: string, sourceHeadSha: string, issuedAt: string) => ({
      rowId, capsuleId: "WC-1", requestBound: true, sourceHeadSha,
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
    expect(view.runs.find(row => row.taskRunId === "TR-CURRENT")).toMatchObject({ identityScope: "current" });
    expect(view.runs).toHaveLength(2);
  });

  it("uses request issue time instead of late activity to identify the current request on one head", async () => {
    const view = await loadSemanticReviewRoomProjection({
      taskRun: { findMany: async () => [run("input-required"), { ...run("completed"), id: "row-2", taskRunId: "TR-2" }] },
      $queryRaw: vi.fn().mockResolvedValue([1, 2].map(index => ({
        rowId: `row-${index}`, capsuleId: "WC-1", requestBound: true, sourceHeadSha: "a".repeat(40),
        currentHeadSha: "a".repeat(40), issuedAt: `2026-09-08T19:0${index}:00Z`, receiptId: null,
      }))),
    }, ["WC-1"], now);
    expect(view.attentionReason).toBeNull();
    expect(view.runs[0]).toMatchObject({ identityScope: "historical" });
    expect(view.runs[1]).toMatchObject({ identityScope: "current" });
  });

  it("labels missing request correlation unknown instead of claiming a current review", async () => {
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany: async () => [run("completed")] },
      $queryRaw: vi.fn().mockResolvedValue([{ rowId: "row-1", requestBound: false }]),
    }, ["WC-1"], now);
    expect(view.runs[0]).toMatchObject({ identityScope: "unknown" });
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
      $queryRaw: vi.fn().mockResolvedValue([{ rowId: "row-1", capsuleId: "WC-1", requestBound: true,
        sourceHeadSha: "a".repeat(40), currentHeadSha: "a".repeat(40), issuedAt: "2026-09-08T19:00:00Z",
        receiptId: "receipt-1", receiptDecision: "pass", receiptSummary: "The committed change was reviewed.",
        receiptCreatedAt: now,
      }]),
    }, ["WC-1"], now);
    expect(view.runs[0]).toMatchObject({ receipt: { id: "receipt-1", decision: "pass", summary: "The committed change was reviewed." } });
    expect(view.receipts.every(receipt => receipt.status === "observed")).toBe(true);
    expect(view.receipts).toContainEqual(expect.objectContaining({ receiptId: "receipt-1", rawRef: { table: "ExternalEvidenceRecord", id: "receipt-1" } }));
  });
  it("reads the requester's recorded profile name while retaining stable identity", async () => {
    const findMany = vi.fn(async () => [{ ...run("input-required"), user: { employeeProfile: { displayName: "Alex" } } }]);
    const view = await loadSemanticReviewRoomProjection({ taskRun: { findMany } }, ["WC-1"], now);
    expect(view.runs[0]).toMatchObject({ requesterName: "Alex", requesterId: "requester-1" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({
      user: { select: { employeeProfile: { select: { displayName: true } } } },
    }) }));
  });
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
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { archivedAt: null, AND: [
        { a2aMetadata: { path: ["gateKind"], equals: "semantic-review" } },
        { OR: [{ a2aMetadata: { path: ["capsuleId"], equals: "WC-1" } }] },
      ] }, take: 21,
    }));
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
