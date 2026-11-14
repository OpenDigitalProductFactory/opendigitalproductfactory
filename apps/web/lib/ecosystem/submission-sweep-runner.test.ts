import { describe, expect, it, vi } from "vitest";

import { runEcosystemSubmissionSweep } from "./submission-sweep-runner";

const config = (overrides = {}) => ({
  upstreamFeedbackOptIn: true,
  hiveContributionsPaused: false,
  contributionMode: "contributing",
  primaryPurpose: "operate-organization",
  ...overrides,
});

describe("runEcosystemSubmissionSweep", () => {
  it("reports how many problems are waiting when halted for want of consent", async () => {
    // BI-6ED89EC6: this branch used to end in a console line, so nobody was told.
    const escalate = vi.fn();
    const result = await runEcosystemSubmissionSweep({
      loadConfig: async () => config({ upstreamFeedbackOptIn: false }),
      loadReports: vi.fn(),
      countWaiting: async () => 4,
      escalate,
    });
    expect(result).toMatchObject({ halted: "awaiting-consent", waiting: 4, submitted: 0 });
    expect(escalate).not.toHaveBeenCalled();
  });

  it("still reports the halt when the count itself cannot be read", async () => {
    const result = await runEcosystemSubmissionSweep({
      loadConfig: async () => config({ upstreamFeedbackOptIn: false }),
      countWaiting: async () => { throw new Error("db unavailable"); },
    });
    expect(result).toMatchObject({ halted: "awaiting-consent", waiting: null });
  });

  it("does not count anything for a deliberate halt", async () => {
    const countWaiting = vi.fn();
    const result = await runEcosystemSubmissionSweep({
      loadConfig: async () => config({ hiveContributionsPaused: true }),
      countWaiting,
    });
    expect(result.halted).toBe("paused");
    expect(countWaiting).not.toHaveBeenCalled();
  });

  it("submits eligible reports once consent is given", async () => {
    const escalate = vi.fn().mockResolvedValue({ ok: true });
    const result = await runEcosystemSubmissionSweep({
      loadConfig: async () => config(),
      loadReports: async () => [{ id: "r1", status: "triaged_local", upstreamIssueNumber: null, occurrenceCount: 2 }],
      escalate,
    });
    expect(result).toMatchObject({ submitted: 1, failed: 0, halted: null });
  });
});
