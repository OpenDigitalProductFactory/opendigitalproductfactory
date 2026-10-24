import { describe, expect, it } from "vitest";
import { projectApprovalOutcome, type ApprovalOutcomeRow } from "./approval-outcome";

const now = new Date("2026-09-27T12:00:00Z");
const base: ApprovalOutcomeRow = { id: "e1", status: "approved", createdAt: now, expiresAt: new Date(now.getTime() - 1), toolExecutions: [] };
describe("durable approval outcome projection", () => {
  it("does not mistake an old approval or spent reservation for completion", () => {
    expect(projectApprovalOutcome(base, now).state).toBe("unknown");
  });
  it("reports expiry even before the sweeper changes the stored proposal", () => {
    expect(projectApprovalOutcome({ ...base, status: "proposed" }, now).state).toBe("expired");
  });
  it.each(["executed", "failed", "not-run"] as const)("retains %s after the response and approval window are gone", (status) => {
    const outcome = projectApprovalOutcome({ ...base, toolExecutions: [{ executionMode: "approval-outcome", success: status === "executed", result: { status, reason: "scope-insufficient", message: "SECRET" } }] }, now);
    expect(outcome.state).toBe(status);
    expect(JSON.stringify(outcome)).not.toContain("SECRET");
    if (status === "not-run") expect(outcome.nextAction).toContain("permission");
  });
  it("prefers a later actual executor result over a prior not-run receipt", () => {
    expect(projectApprovalOutcome({ ...base, status: "executed", toolExecutions: [{ executionMode: "approval-outcome", success: false, result: { status: "not-run" } }] }, now).state).toBe("executed");
  });
  it("does not turn the original approval-required audit into an execution failure", () => {
    expect(projectApprovalOutcome({ ...base, toolExecutions: [{ executionMode: "tool", success: false, result: { error: "approval_required" } }] }, now).state).toBe("unknown");
  });
});
