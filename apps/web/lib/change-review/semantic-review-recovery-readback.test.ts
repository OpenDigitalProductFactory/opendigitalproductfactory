import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ taskNode: { findMany: vi.fn() }, runtimeVerification: { findFirst: vi.fn() } }));
vi.mock("@dpf/db", () => ({ prisma: db }));
import { readSemanticReviewRecovery } from "./semantic-review-recovery-readback";
import { readSemanticReviewRemediation } from "./semantic-review-remediation";

const digest = "a".repeat(64);
const now = new Date("2026-10-12T01:00:00Z");
const updatedAt = new Date(now.getTime() - 60_000);
const task = { taskRunId: "TR-OWN", userId: "owner", status: "input-required", updatedAt,
  a2aMetadata: { gateKind: "semantic-review", capsuleId: "WC-OWN" },
  progressPayload: { semanticReview: { schemaVersion: 1, requestDigest: digest,
    deadlineAt: "2026-10-11T01:00:00Z", recoveryAttempt: 1, executionOutcome: "unknown" } } };
const node = { taskNodeId: "TN-OWN", status: "failed", updatedAt,
  outputSnapshot: { requestDigest: digest, providerOutcome: "unknown", secret: "provider-private-output" } };
function verification() { return { verificationId: "RV-OWN", kind: "health", status: "passed",
  workCapsuleId: "room-id", workCapsule: { capsuleId: "WC-OWN" }, runtimeTargetId: "runtime-id",
  command: "scoped settlement probe", completedAt: now,
  result: { semanticReviewRecovery: { taskRunId: "TR-OWN", requestDigest: digest,
    executionSettled: true, settledNodeIds: ["TN-OWN"], observation: "private diagnostic details" } } }; }
const binding = { capsuleId: "room-id", taskRunId: "TR-OWN", requestDigest: digest, updatedAt };

describe("owned semantic review recovery readback", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    db.taskNode.findMany.mockResolvedValue([node]); db.runtimeVerification.findFirst.mockResolvedValue(null); });
  it("names uncertain nodes without converting failed/inactive state into settlement", async () => {
    const result = await readSemanticReviewRecovery(task, "owner");
    expect(result).toMatchObject({ budget: "expired", classification: "execution-uncertain", pollUseful: false,
      details: { unresolvedNodeIds: ["TN-OWN"], nodes: [{ taskNodeId: "TN-OWN", settlement: "unverified", digestMatches: true }],
        remediation: { executionSettled: false, state: "missing-current-proof", retryAuthorized: false } } });
    expect(JSON.stringify(result)).not.toContain("provider-private-output");
    expect(db.taskNode.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskRun: { taskRunId: "TR-OWN", userId: "owner" } }, take: 101 }));
    expect(db.runtimeVerification.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      workCapsule: { capsuleId: "WC-OWN" }, AND: [
        { result: { path: ["semanticReviewRecovery", "taskRunId"], equals: "TR-OWN" } },
        { result: { path: ["semanticReviewRecovery", "requestDigest"], equals: digest } },
      ] }) }));
  });
  it("refuses a foreign caller before all detail queries", async () => {
    await expect(readSemanticReviewRecovery(task, "foreign")).rejects.toThrow("not-owned");
    expect(db.taskNode.findMany).not.toHaveBeenCalled();
    expect(db.runtimeVerification.findFirst).not.toHaveBeenCalled();
  });
  it("returns a scoped current proof without authorizing a retry or exposing diagnostic text", async () => {
    db.runtimeVerification.findFirst.mockResolvedValue(verification());
    const result = await readSemanticReviewRecovery(task, "owner");
    expect(result.details.remediation).toMatchObject({ state: "recorded", verificationId: "RV-OWN", executionSettled: true, retryAuthorized: false });
    expect(result.details.nodes[0].settlement).toBe("verified");
    expect(JSON.stringify(result)).not.toContain("private diagnostic details");
  });
  it("requires coverage of every unresolved node", async () => {
    db.taskNode.findMany.mockResolvedValue([node, { ...node, taskNodeId: "TN-UNSETTLED" }]);
    db.runtimeVerification.findFirst.mockResolvedValue(verification());
    expect((await readSemanticReviewRecovery(task, "owner")).details.remediation)
      .toMatchObject({ state: "incomplete-node-coverage", executionSettled: false });
  });
  it("bounds nodes and refuses complete settlement when truncated", async () => {
    db.taskNode.findMany.mockResolvedValue(Array.from({ length: 101 }, () => node));
    db.runtimeVerification.findFirst.mockResolvedValue(verification());
    const result = await readSemanticReviewRecovery(task, "owner");
    expect(result.details.nodes).toHaveLength(100);
    expect(result.details).toMatchObject({ truncated: true, remediation: { state: "node-limit-exceeded", executionSettled: false } });
  });
  it("does not seek a proof without an exact digest", async () => {
    await readSemanticReviewRecovery({ ...task, progressPayload: {} }, "owner");
    expect(db.runtimeVerification.findFirst).not.toHaveBeenCalled();
  });
});

describe("shared remediation admission predicate", () => {
  it("accepts the same current scoped evidence that recovery can consume", () => {
    expect(readSemanticReviewRemediation(verification(), binding, now.getTime())).toMatchObject({ settledNodeIds: ["TN-OWN"] });
  });
  it.each(["stale", "before-task", "future", "wrong-digest", "wrong-task", "wrong-room", "not-settled", "no-runtime", "empty-command"])("rejects %s evidence", reason => {
    const value = verification();
    if (reason === "stale") value.completedAt = new Date(now.getTime() - 31 * 60_000);
    if (reason === "before-task") value.completedAt = new Date(updatedAt.getTime() - 1);
    if (reason === "future") value.completedAt = new Date(now.getTime() + 1);
    if (reason === "wrong-digest") value.result.semanticReviewRecovery.requestDigest = "b".repeat(64);
    if (reason === "wrong-task") value.result.semanticReviewRecovery.taskRunId = "TR-OTHER";
    if (reason === "wrong-room") value.workCapsuleId = "other-room";
    if (reason === "not-settled") value.result.semanticReviewRecovery.executionSettled = false;
    if (reason === "no-runtime") value.runtimeTargetId = "";
    if (reason === "empty-command") value.command = " ";
    expect(readSemanticReviewRemediation(value, binding, now.getTime())).toBeNull();
  });
});
