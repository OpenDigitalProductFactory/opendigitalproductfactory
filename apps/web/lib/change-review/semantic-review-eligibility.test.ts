import { mocks, state, result } from "./semantic-review-background.test-fixtures";
import { describe, expect, it } from "vitest";
import { executePersistedSemanticReview, reconcileSemanticReviews, retryPersistedSemanticReview } from "./semantic-review-background";
import { NoEligibleEndpointsError } from "../routing/inference-error";
describe("durable semantic review eligibility", () => {
  const eligibility = { sensitivity: "restricted", residencyPolicy: "local_only", excludedCount: 2,
    exclusions: [{ bucket: "output-capacity" as const, count: 2 }] };
  function refusal(proven: boolean) {
    const error = new NoEligibleEndpointsError("build-review", "secret provider detail", 2, undefined, undefined, eligibility);
    if (proven) error.providerDispatch = "not-started";
    return error;
  }
  it("checkpoints a proven typed eligibility refusal without raw detail or a verdict", async () => {
    mocks.dispatch.mockImplementation(async (_prompt, _context, branch) => branch("change-reviewer", async () => { throw refusal(true); }));
    await executePersistedSemanticReview("TR-1");
    expect(state.row.status).toBe("input-required");
    expect(state.row.progressPayload).toMatchObject({ semanticReview: { reason: "review-endpoint-ineligible", routingEligibility: [eligibility] } });
    expect(mocks.db.taskNode.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "completed", outputSnapshot: expect.objectContaining({ requestDigest: state.packet.digest,
        providerOutcome: "not-dispatched", routingEligibility: [eligibility] }),
    }) }));
    expect(JSON.stringify(state.row)).not.toContain("secret provider detail");
  });
  it.each(["wrapped", "unproven", "serialized"])("retains uncertainty for a %s eligibility error", async kind => {
    const error = kind === "wrapped" ? new Error("wrapped refusal", { cause: refusal(true) })
      : kind === "serialized" ? { ...refusal(true) } : refusal(false);
    mocks.dispatch.mockImplementation(async (_prompt, _context, branch) => branch("change-reviewer", async () => { throw error; }));
    await expect(executePersistedSemanticReview("TR-1")).rejects.toBe(error);
    expect(state.row.progressPayload).toMatchObject({ semanticReview: { reason: "provider-outcome-uncertain" } });
    expect(mocks.evidence).not.toHaveBeenCalled();
  });
  it("preserves refusal and successful checkpoints beside an uncertain sibling", async () => {
    mocks.db.taskNode.findMany.mockResolvedValue([{ status: "completed", outputSnapshot: {
      requestDigest: state.packet.digest, routingEligibility: [eligibility] } }]);
    mocks.dispatch.mockImplementation(async (_prompt, _context, branch) => {
      await Promise.allSettled([
        branch("AGT-181", async () => { throw refusal(true); }),
        branch("AGT-903", async () => { throw new Error("lost outcome"); }),
        branch("change-reviewer", async () => result),
      ]);
      return { decision: "inconclusive", issues: [], summary: "Incomplete" };
    });
    await executePersistedSemanticReview("TR-1");
    expect(state.row.progressPayload).toMatchObject({ semanticReview: { reason: "provider-outcome-uncertain", routingEligibility: [eligibility] } });
    expect(mocks.db.taskNode.update).toHaveBeenCalledWith(expect.objectContaining({ where: { taskNodeId: "semantic-review:TR-1:AGT-181" },
      data: expect.objectContaining({ status: "completed", outputSnapshot: expect.objectContaining({ providerOutcome: "not-dispatched" }) }) }));
    expect(mocks.db.taskNode.update).toHaveBeenCalledWith(expect.objectContaining({ where: { taskNodeId: "semantic-review:TR-1:change-reviewer" },
      data: expect.objectContaining({ status: "completed", outputSnapshot: expect.objectContaining({ result }) }) }));
    expect(mocks.evidence).not.toHaveBeenCalled();
  });
  it("requires remediation from durable branch evidence after a lost task summary", async () => {
    state.row.status = "input-required";
    mocks.db.taskNode.findMany.mockResolvedValue([{ status: "completed", outputSnapshot: {
      requestDigest: state.packet.digest, routingEligibility: [eligibility] } }]);
    await expect(retryPersistedSemanticReview("TR-1", "user-1", true)).rejects.toThrow("eligibility-remediation-required");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("retains known eligibility constraints beside uncertain executor loss", async () => {
    Object.assign(state.row, { status: "working", lastHeartbeatAt: new Date(Date.now() - 4 * 60_000) });
    mocks.db.taskRun.findMany.mockResolvedValue([{ ...state.row }]);
    mocks.db.taskNode.findFirst.mockResolvedValue({ id: "lost" });
    mocks.db.taskNode.findMany.mockResolvedValue([
      { status: "completed", outputSnapshot: { requestDigest: state.packet.digest, routingEligibility: [eligibility] } },
      { taskNodeId: "lost", status: "running", outputSnapshot: {} },
    ]);
    await reconcileSemanticReviews();
    expect(state.row.progressPayload).toMatchObject({ semanticReview: { executionOutcome: "unknown", routingEligibility: [eligibility] } });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("refuses unchanged eligibility retry without consuming the original budget", async () => {
    state.row.status = "input-required";
    Object.assign((state.row.progressPayload as any).semanticReview, { reason: "review-endpoint-ineligible", routingEligibility: [eligibility] });
    await expect(retryPersistedSemanticReview("TR-1", "user-1", true)).rejects.toThrow("eligibility-remediation-required");
    expect((state.row.progressPayload as any).semanticReview.recoveryAttempt).toBeUndefined();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("resumes the same request only with fresh scoped eligibility remediation", async () => {
    state.row.status = "input-required";
    Object.assign((state.row.progressPayload as any).semanticReview, { reason: "review-endpoint-ineligible", routingEligibility: [eligibility] });
    mocks.db.runtimeVerification.findUnique.mockResolvedValue({ kind: "health", status: "passed", workCapsuleId: "room-1",
      runtimeTargetId: "runtime-1", command: "verify exact review eligibility", completedAt: new Date(),
      result: { semanticReviewRecovery: { taskRunId: "TR-1", requestDigest: state.packet.digest, executionSettled: true,
        settledNodeIds: [], eligibilityVerified: true, observation: "Exact immutable route now has an eligible endpoint." } } });
    await retryPersistedSemanticReview("TR-1", "user-1", true, { expectedRequestDigest: state.packet.digest, remediationVerificationId: "RV-1" });
    expect(state.row.status).toBe("submitted");
    expect(state.row.progressPayload).toMatchObject({ semanticReview: { requestDigest: state.packet.digest,
      deadlineAt: state.packet.deadlineAt, recoveryAttempt: 1, remediationVerificationId: "RV-1" } });
  });
  it.each(["unverified", "stale", "wrong-request"])("refuses %s eligibility remediation", async kind => {
    state.row.status = "input-required";
    Object.assign((state.row.progressPayload as any).semanticReview, { reason: "review-endpoint-ineligible" });
    mocks.db.runtimeVerification.findUnique.mockResolvedValue({ kind: "health", status: "passed", workCapsuleId: "room-1",
      runtimeTargetId: "runtime-1", command: "verify eligibility", completedAt: kind === "stale" ? new Date(0) : new Date(),
      result: { semanticReviewRecovery: { taskRunId: kind === "wrong-request" ? "TR-OTHER" : "TR-1",
        requestDigest: state.packet.digest, executionSettled: true, settledNodeIds: [], eligibilityVerified: kind !== "unverified",
        observation: "Infrastructure was checked." } } });
    const recovery = { expectedRequestDigest: state.packet.digest, remediationVerificationId: "RV-1" };
    await expect(retryPersistedSemanticReview("TR-1", "user-1", true, recovery)).rejects.toThrow("eligibility-remediation-required");
    expect(state.row.status).toBe("input-required");
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
