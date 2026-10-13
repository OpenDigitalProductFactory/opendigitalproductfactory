import { describe, expect, it } from "vitest";

import { approvalPendingResult, settledApprovalResult } from "./approval-pending-result";

// BI-F4EB23C1 — a replay returns what happened, success or failure, and says what to do next.
describe("settledApprovalResult", () => {
  it("keeps failed diagnostic output and authoritative approval metadata", () => {
    const result = settledApprovalResult("admin_run_command", { envelopeId: "env-output", status: "failed", result: {
      success: false, error: "command_failed", message: "Command exited with error.",
      data: { output: 'service "web" is not running', exitCode: 1, envelopeId: "untrusted-payload-envelope" },
    } });
    expect(result).toMatchObject({ success: false, data: { output: 'service "web" is not running', exitCode: 1, envelopeId: "env-output", recordedError: "command_failed" } });
    expect(result.governance).toEqual({ approvalReplayOf: "env-output" });
  });

  it("does not turn the legacy admin nonzero marker into command success", () => {
    const result = settledApprovalResult("admin_run_command", { envelopeId: "env-legacy", status: "executed", result: {
      success: true, message: "Command exited with error.", data: { output: 'service "web" is not running' },
    } });
    expect(result).toMatchObject({ success: false, data: { output: 'service "web" is not running' } });
    expect(result.message).toContain("Command exited with error.");
    expect(result.message).toContain("Calling it again returns this same outcome");
  });

  it("does not override an explicit stored failure with an executed envelope", () => {
    expect(settledApprovalResult("tool", { envelopeId: "env-failure", status: "executed", result: { success: false, error: "failed", data: { detail: "kept" } } }))
      .toMatchObject({ success: false, data: { detail: "kept" } });
  });

  it("does not infer another tool failed from the admin legacy message", () => {
    expect(settledApprovalResult("other_tool", { envelopeId: "env-other", status: "executed", result: { success: true, message: "Command exited with error.", data: { detail: "kept" } } }))
      .toMatchObject({ success: true, data: { detail: "kept" } });
  });

  it("reports missing execution evidence without claiming the action ran", () => {
    const result = settledApprovalResult("tool", { envelopeId: "env-unknown", status: "executed", result: { success: false, error: "approval_execution_unknown", message: "No recorded execution outcome." } });
    expect(result.success).toBe(false);
    expect(result.message).not.toContain("already ran");
    expect(result.message).toContain("could not be confirmed");
    expect(result.governance).toEqual({ approvalReplayOf: "env-unknown" });
  });

  it("retains non-object failure data without replacing approval metadata", () => {
    expect(settledApprovalResult("tool", { envelopeId: "env-array", status: "failed", result: { success: false, data: ["detail"] } }))
      .toMatchObject({ success: false, data: { envelopeId: "env-array", recordedData: ["detail"] } });
  });

  it("does not claim a failed envelope with no result proves an execution", () => {
    expect(settledApprovalResult("tool", { envelopeId: "env-empty", status: "failed", result: null }).message)
      .toContain("could not be confirmed");
  });

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

  // BI-5B34D277: a governed refusal settles the approval before the tool runs.
  it("does not claim a call refused before it ran ever ran", () => {
    const result = settledApprovalResult("create_digital_product", {
      envelopeId: "env-3", status: "failed",
      result: { success: false, error: "hook_denied", message: "create_digital_product rejected: blocked by hook" },
    });
    expect(result).toMatchObject({ success: false, error: "approval_outcome_failed", data: { recordedError: "hook_denied" } });
    expect(result.message).toContain("was approved by a person (approval request env-3) but refused before it ran (hook_denied).");
    expect(result.message).not.toContain("already ran");
    expect(result.message).toContain("Calling it again returns this same outcome");
  });
});

describe("approvalPendingResult", () => {
  it("promises the recorded outcome whether the approved run succeeded or failed", () => {
    expect(approvalPendingResult("t", "", { envelopeId: "e" }).message).toContain("returns that recorded outcome, whether it succeeded or failed");
  });

  // BI-0012E6CA: the person may be away for hours; a pending approval must not
  // stall unrelated work, and a lapse is visible to the person, not silent.
  it("tells the coworker to carry on with other work and how an unanswered request comes back", () => {
    // clock-bomb-guard: allow the expiry is only echoed into the message text; nothing compares it to a clock
    const message = approvalPendingResult("merge_backlog_items", "", { envelopeId: "e", expiresAt: "2026-10-08T04:00:00.000Z" }).message;
    expect(message).toContain("carry on with any other work that does not depend on this call");
    expect(message).toContain("expired unanswered and can ask again");
    expect(message).toContain("which expires 2026-10-08T04:00:00.000Z");
  });
});
