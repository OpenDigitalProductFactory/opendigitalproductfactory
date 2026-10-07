import { describe, expect, it } from "vitest";

import { approvalPendingResult, settledApprovalResult } from "./approval-pending-result";

// BI-F4EB23C1 — a replay returns what happened, success or failure, and says what to do next.
describe("settledApprovalResult", () => {
  it("reports a successful run as before", () => {
    const result = settledApprovalResult("reassign_workroom_executor", { envelopeId: "env-1", status: "executed", result: { message: "Handed over." } });
    expect(result).toMatchObject({ success: true, governance: { approvalReplayOf: "env-1" } });
    expect(result.message).toContain("Handed over.");
  });

  it("reports a failed run as a failure with its recorded cause, and does not invite another approval", () => {
    const result = settledApprovalResult("reassign_workroom_executor", {
      envelopeId: "env-2", status: "failed",
      result: { success: false, error: "workroom_access_denied", message: "You or your assistant are not admitted to this workroom." },
    });
    expect(result).toMatchObject({ success: false, error: "approval_outcome_failed", governance: { approvalReplayOf: "env-2" } });
    expect(result.message).toContain("did not complete");
    expect(result.message).toContain("workroom_access_denied");
    expect(result.message).toContain("Calling it again returns this same outcome");
    expect(result.data).toMatchObject({ envelopeId: "env-2", recordedError: "workroom_access_denied" });
  });
});

describe("approvalPendingResult", () => {
  it("promises the recorded outcome whether the approved run succeeded or failed", () => {
    expect(approvalPendingResult("t", "", { envelopeId: "e" }).message).toContain("returns that recorded outcome, whether it succeeded or failed");
  });

  // BI-0012E6CA: the person may be away for hours; a pending approval must not
  // stall unrelated work, and a lapse is visible to the person, not silent.
  it("tells the coworker to carry on with other work and how an unanswered request comes back", () => {
    const message = approvalPendingResult("merge_backlog_items", "", { envelopeId: "e", expiresAt: "2026-10-08T04:00:00.000Z" }).message;
    expect(message).toContain("carry on with any other work that does not depend on this call");
    expect(message).toContain("expired unanswered and can ask again");
    expect(message).toContain("which expires 2026-10-08T04:00:00.000Z");
  });
});
