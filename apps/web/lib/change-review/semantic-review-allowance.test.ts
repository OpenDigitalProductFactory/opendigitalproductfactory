import { mocks, state } from "./semantic-review-background.test-fixtures";
import { describe, expect, it, vi } from "vitest";
import { executePersistedSemanticReview, retryPersistedSemanticReview } from "./semantic-review-background";
import { semanticReviewRecoveryObservation } from "./semantic-review-recovery-policy";
import { semanticReviewReasonLabel } from "./semantic-review-presentation";
import { AgentAllowanceExhaustedError } from "@/lib/inference/budget-gate";

const allowance = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@/lib/inference/budget-gate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inference/budget-gate")>()),
  checkAgentBudgetFromRegistry: allowance.check,
}));

const refusal = () => new AgentAllowanceExhaustedError({ agentId: "change-reviewer",
  budget: { status: "rejected", actualTokens: 206_530, limitTokens: 200_000, ratioPercent: 103, governedBy: "agent-cap" } });

// BI-F3B6713F: on 2026-11-03 the reviewer's used allowance was recorded as
// "provider-outcome-uncertain", hiding the cause and inviting a retry that could
// only be refused again.
describe("a used reviewer allowance", () => {
  it("is recorded as daily allowance used with its reset time, and the branch as never dispatched", async () => {
    mocks.dispatch.mockImplementation(async (_prompt, _context, branch) => branch("change-reviewer", async () => { throw refusal(); }));
    await expect(executePersistedSemanticReview("TR-1")).rejects.toThrow(/^Daily allowance used/);
    expect(state.row.status).toBe("input-required");
    const recorded = (state.row.progressPayload as { semanticReview: Record<string, unknown> }).semanticReview;
    expect(recorded.reason).toBe("reviewer-daily-allowance-used");
    expect(recorded.allowanceResetAt).toMatch(/T00:00:00\.000Z$/);
    expect(recorded.action).toMatch(/Paid AI allowance/);
    expect(mocks.db.taskNode.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", outputSnapshot: expect.objectContaining({ providerOutcome: "not-dispatched" }) }),
    }));
    const observed = semanticReviewRecoveryObservation("input-required", state.row.progressPayload);
    expect(observed.classification).toBe("daily-allowance-used");
    expect(observed.nextAction).toMatch(/no provider was asked/);
    expect(semanticReviewReasonLabel("reviewer-daily-allowance-used")).toMatch(/nothing is uncertain/);
  });

  it("refuses a retry while the allowance is still used, without spending a recovery attempt", async () => {
    mocks.dispatch.mockImplementation(async (_prompt, _context, branch) => branch("change-reviewer", async () => { throw refusal(); }));
    await expect(executePersistedSemanticReview("TR-1")).rejects.toThrow();
    allowance.check.mockResolvedValue({ status: "rejected", actualTokens: 206_530, limitTokens: 200_000, ratioPercent: 103 });
    const before = JSON.stringify(state.row.progressPayload);
    await expect(retryPersistedSemanticReview("TR-1", "user-1", true)).rejects.toThrow(/semantic-review-daily-allowance-used: .*resets at/);
    expect(JSON.stringify(state.row.progressPayload)).toBe(before);
    expect(mocks.send).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining("recovery"));
  });

  it("allows the retry once an owner has raised the allowance", async () => {
    mocks.dispatch.mockImplementation(async (_prompt, _context, branch) => branch("change-reviewer", async () => { throw refusal(); }));
    await expect(executePersistedSemanticReview("TR-1")).rejects.toThrow();
    allowance.check.mockResolvedValue({ status: "ok", actualTokens: 0, limitTokens: 0, ratioPercent: 1, governedBy: "owner-allowance" });
    await expect(retryPersistedSemanticReview("TR-1", "user-1", true)).resolves.toMatchObject({ strategy: "resume-review-checkpoints" });
  });
});
