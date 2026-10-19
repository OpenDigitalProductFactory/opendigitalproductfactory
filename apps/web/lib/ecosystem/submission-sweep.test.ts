import { describe, expect, it, vi } from "vitest";

import { planSubmissionSweep, runSubmissionSweep, type SweepConfig, type SweepableReport } from "./submission-sweep";

const config = (overrides: Partial<SweepConfig> = {}): SweepConfig => ({
  upstreamFeedbackOptIn: true,
  hiveContributionsPaused: false,
  contributionMode: "contributing",
  primaryPurpose: "operate-organization",
  ...overrides,
});

const report = (overrides: Partial<SweepableReport> = {}): SweepableReport => ({
  id: "rep-1",
  status: "triaged_local",
  upstreamIssueNumber: null,
  occurrenceCount: 3,
  ...overrides,
});

describe("planSubmissionSweep", () => {
  it("submits a locally-triaged report that has not been filed", () => {
    const plan = planSubmissionSweep({ reports: [report()], config: config() });
    expect(plan).toMatchObject({ halted: false, submit: ["rep-1"] });
  });

  it("halts without consent, and asks ONCE rather than per report", () => {
    // A consent request repeated for every defect is how a prompt gets
    // permanently dismissed.
    const plan = planSubmissionSweep({
      reports: [report({ id: "a" }), report({ id: "b" }), report({ id: "c" })],
      config: config({ upstreamFeedbackOptIn: false }),
    });
    expect(plan).toMatchObject({ halted: true, reason: "awaiting-consent", promptOperator: true });
  });

  it("respects the master pause", () => {
    expect(planSubmissionSweep({ reports: [report()], config: config({ hiveContributionsPaused: true }) }))
      .toMatchObject({ halted: true, reason: "paused" });
  });

  it("respects fork_only contribution mode", () => {
    expect(planSubmissionSweep({ reports: [report()], config: config({ contributionMode: "fork_only" }) }))
      .toMatchObject({ halted: true, reason: "fork-only" });
  });

  it("does not sweep on a platform-development install, which would loop back to itself", () => {
    expect(planSubmissionSweep({ reports: [report()], config: config({ primaryPurpose: "evolve-dpf" }) }))
      .toMatchObject({ halted: true, reason: "not-applicable" });
  });

  it("never re-files a report that already has an upstream issue", () => {
    const plan = planSubmissionSweep({
      reports: [report({ upstreamIssueNumber: 412 })],
      config: config(),
    });
    expect(plan).toMatchObject({ halted: false, submit: [] });
    expect(plan.halted === false && plan.skipped).toEqual([{ id: "rep-1", reason: "already-filed" }]);
  });

  it("leaves an untriaged report alone rather than sending raw noise upstream", () => {
    const plan = planSubmissionSweep({ reports: [report({ status: "open" })], config: config() });
    expect(plan.halted === false && plan.skipped).toEqual([{ id: "rep-1", reason: "not-triaged" }]);
  });
});

describe("runSubmissionSweep", () => {
  it("reports the halt reason and escalates nothing", async () => {
    const escalate = vi.fn();
    const result = await runSubmissionSweep({
      plan: planSubmissionSweep({ reports: [report()], config: config({ upstreamFeedbackOptIn: false }) }),
      escalate,
    });
    expect(result).toMatchObject({ submitted: 0, halted: "awaiting-consent" });
    expect(escalate).not.toHaveBeenCalled();
  });

  it("fault-isolates a failing report so later ones still submit", async () => {
    const onFailure = vi.fn();
    const escalate = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce({ ok: true });

    const result = await runSubmissionSweep({
      plan: planSubmissionSweep({
        reports: [report({ id: "a" }), report({ id: "b" }), report({ id: "c" })],
        config: config(),
      }),
      escalate,
      onFailure,
    });

    expect(escalate).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ submitted: 2, failed: 1 });
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it("counts a refused escalation as failed rather than submitted", async () => {
    const result = await runSubmissionSweep({
      plan: planSubmissionSweep({ reports: [report()], config: config() }),
      escalate: vi.fn().mockResolvedValue({ ok: false }),
    });
    expect(result).toMatchObject({ submitted: 0, failed: 1 });
  });
});
