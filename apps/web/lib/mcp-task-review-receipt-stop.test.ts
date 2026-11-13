import { beforeEach, describe, expect, it, vi } from "vitest";
const reads = vi.hoisted(() => ({ receipt: vi.fn(), task: vi.fn() }));
vi.mock("./mcp-task-review-outcome", () => ({ loadInitiativeReviewOutcome: reads.receipt, loadTaskInitiativeReviewOutcome: reads.task }));
import { createReassessmentReceiptCheck } from "./mcp-task-review-receipt-stop";
import type { InitiativeReviewBinding } from "./mcp-task-review-contract";

const binding: InitiativeReviewBinding = { itemId: "BI-FIXTURE", gate: "design-spec", writerToolName: "record_initiative_design_review",
  artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "fixture/repository", path: "design.md",
    commitSha: "a".repeat(40), providerBlobId: "b".repeat(40) } };
const outcome = { receiptId: "real-receipt", summary: "Canonical verdict.", decision: "fail", artifactRef: binding.artifactRef };
beforeEach(() => { vi.clearAllMocks(); reads.receipt.mockResolvedValue(null); reads.task.mockResolvedValue(null); });
describe("worker-owned canonical receipt stop", () => {
  it.each(["pass", "fail"])("uses exact canonical %s readback and its stored summary", async decision => {
    reads.receipt.mockResolvedValue({ ...outcome, decision });
    const check = createReassessmentReceiptCheck("TR-FIXTURE", binding)!;
    expect(reads.receipt).not.toHaveBeenCalled();
    await expect(check({ success: true, message: "Provider prose is not a verdict.", data: { receiptId: "real-receipt" } }))
      .resolves.toEqual({ receiptId: outcome.receiptId, summary: outcome.summary });
    expect(reads.receipt).toHaveBeenCalledWith(binding, "real-receipt"); expect(reads.task).not.toHaveBeenCalled();
  });
  it("falls back from an unverified actual-result receipt ID to the exact task's genuine receipt", async () => {
    reads.task.mockResolvedValue(outcome);
    await expect(createReassessmentReceiptCheck("TR-FIXTURE", binding)!({ success: true, message: "Recorded", data: { receiptId: "foreign-receipt" } }))
      .resolves.toEqual({ receiptId: outcome.receiptId, summary: outcome.summary });
    expect(reads.receipt).toHaveBeenCalledWith(binding, "foreign-receipt"); expect(reads.task).toHaveBeenCalledWith("TR-FIXTURE", binding);
  });
  it("lets genuine task readback win even when the observed writer result is a refusal", async () => {
    reads.task.mockResolvedValue(outcome);
    await expect(createReassessmentReceiptCheck("TR-FIXTURE", binding)!({ success: false, error: "refused", message: "Refused" }))
      .resolves.toEqual({ receiptId: outcome.receiptId, summary: outcome.summary });
  });
  it("allows a fully observed refusal without a receipt to continue", async () => {
    await expect(createReassessmentReceiptCheck("TR-FIXTURE", binding)!({ success: false, error: "malformed-receipt", message: "Correct evidence." })).resolves.toBeNull();
  });
  it.each([undefined, "foreign-receipt"])("holds success with unverified receipt %s instead of inferring approval", async receiptId => {
    await expect(createReassessmentReceiptCheck("TR-FIXTURE", binding)!({ success: true, message: "PASS", data: { receiptId } }))
      .rejects.toMatchObject({ code: "reassessment-effect-outcome-uncertain" });
  });
  it("retains a genuine fallback receipt after primary readback is unavailable", async () => {
    reads.receipt.mockRejectedValue(Error("private database detail")); reads.task.mockResolvedValue(outcome);
    await expect(createReassessmentReceiptCheck("TR-FIXTURE", binding)!({ success: true, message: "Recorded", data: { receiptId: "real-receipt" } }))
      .resolves.toEqual({ receiptId: outcome.receiptId, summary: outcome.summary });
  });
  it("holds unavailable readback even for a refusal, without exposing storage errors", async () => {
    reads.task.mockRejectedValue(Error("private database detail"));
    const attempt = createReassessmentReceiptCheck("TR-FIXTURE", binding)!({ success: false, message: "Refused" });
    await expect(attempt).rejects.toMatchObject({ code: "reassessment-effect-outcome-uncertain" });
    await expect(attempt).rejects.not.toThrow("private database detail");
  });
  it.each([{ ...binding, gate: "objective-mapping" }, { ...binding, eligibleEvidenceActivityIds: ["proposal-evidence"] }])(
    "retains the existing proposal exemption %j", proposalBinding => {
      expect(createReassessmentReceiptCheck("TR-FIXTURE", proposalBinding)).toBeUndefined();
      expect(reads.receipt).not.toHaveBeenCalled(); expect(reads.task).not.toHaveBeenCalled();
    });
});
