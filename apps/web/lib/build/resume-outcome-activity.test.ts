import { describe, expect, it, vi } from "vitest";
import {
  formatResumeOutcomeSummary,
  isUnchangedResumeSkip,
  recordResumeOutcomeActivity,
} from "./resume-outcome-activity";

const backoffSkip = (streak: number, wait: string, at: string) => ({
  kind: "skipped" as const,
  phase: "plan",
  reason:
    `plan review could not be completed ${streak}x in a row (no reviewer returned a usable verdict; the plan is ` +
    `not at fault). Keeping the plan; next retry in ${wait} (${at}).`,
});

function fakeDb(latest: string | null) {
  return {
    buildActivity: {
      findFirst: vi.fn().mockResolvedValue(latest === null ? null : { summary: latest }),
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("resume outcome activity", () => {
  it("formats the summary the resumer has always written", () => {
    expect(formatResumeOutcomeSummary("plan", { kind: "resumed", phase: "plan", via: "executeTool:reviewBuildPlan", detail: "ok" }))
      .toBe("Pre-build resume (plan): resumed via executeTool:reviewBuildPlan — ok");
    expect(formatResumeOutcomeSummary("plan", { kind: "failed", phase: "plan", error: "boom" }))
      .toBe("Pre-build resume (plan): failed — boom");
  });

  it("treats a skip that differs only in counts, waits and timestamps as unchanged", () => {
    const prev = formatResumeOutcomeSummary("plan", backoffSkip(3, "12m", "2026-10-27T18:30:00.000Z"));
    const next = formatResumeOutcomeSummary("plan", backoffSkip(3, "2m", "2026-10-27T18:30:00.000Z"));
    const later = formatResumeOutcomeSummary("plan", backoffSkip(4, "1h 4m", "2026-10-27T19:40:00.000Z"));
    expect(isUnchangedResumeSkip(prev, next)).toBe(true);
    expect(isUnchangedResumeSkip(prev, later)).toBe(true);
  });

  it("treats a different skip reason as a change", () => {
    const prev = formatResumeOutcomeSummary("plan", backoffSkip(3, "12m", "2026-10-27T18:30:00.000Z"));
    const escalated = formatResumeOutcomeSummary("plan", {
      kind: "skipped", phase: "plan", reason: "plan → build transition failed 3x — escalated to operator; auto-resume paused for this build (x).",
    });
    expect(isUnchangedResumeSkip(prev, escalated)).toBe(false);
    expect(isUnchangedResumeSkip(null, escalated)).toBe(false);
  });

  it("writes no row when the last resume row recorded the same skip", async () => {
    const prev = formatResumeOutcomeSummary("plan", backoffSkip(3, "12m", "2026-10-27T18:30:00.000Z"));
    const db = fakeDb(prev);
    const wrote = await recordResumeOutcomeActivity(db, { buildId: "FB-1", phase: "plan", outcome: backoffSkip(3, "2m", "2026-10-27T18:30:00.000Z") });
    expect(wrote).toBe(false);
    expect(db.buildActivity.create).not.toHaveBeenCalled();
    expect(db.buildActivity.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { buildId: "FB-1", tool: "resumeStrandedBuildsOnBoot" },
      orderBy: { createdAt: "desc" },
    }));
  });

  it("writes a row when the skip reason changes or there is no prior row", async () => {
    const db = fakeDb(null);
    expect(await recordResumeOutcomeActivity(db, { buildId: "FB-1", phase: "plan", outcome: backoffSkip(1, "5m", "2026-10-27T18:30:00.000Z") })).toBe(true);
    expect(db.buildActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ buildId: "FB-1", tool: "resumeStrandedBuildsOnBoot" }) });
  });

  it("always records resumed and failed outcomes, even when identical", async () => {
    const outcome = { kind: "resumed" as const, phase: "plan", via: "executeTool:reviewBuildPlan", detail: "Review incomplete" };
    const db = fakeDb(formatResumeOutcomeSummary("plan", outcome));
    expect(await recordResumeOutcomeActivity(db, { buildId: "FB-1", phase: "plan", outcome })).toBe(true);
    expect(db.buildActivity.findFirst).not.toHaveBeenCalled();
  });

  it("writes nothing for a quiet skip", async () => {
    const db = fakeDb(null);
    expect(await recordResumeOutcomeActivity(db, { buildId: "FB-1", phase: "plan", outcome: { kind: "skipped", phase: "plan", reason: "r", quiet: true } })).toBe(false);
    expect(db.buildActivity.create).not.toHaveBeenCalled();
  });
});
