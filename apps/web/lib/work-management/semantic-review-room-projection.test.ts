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
