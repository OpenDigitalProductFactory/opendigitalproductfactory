// EP-SCHEDULING-SURFACE — forward schedule projection.

import { describe, expect, it } from "vitest";

import { buildScheduleWindow } from "./schedule-window";
import type { ScheduledWorkView } from "./work-model";

const NOW = new Date("2026-08-22T02:30:00.000Z");

function view(over: Partial<ScheduledWorkView> & { jobId: string }): ScheduledWorkView {
  return {
    name: over.jobId,
    purpose: "",
    kind: "recurring",
    substrate: "inngest-cron",
    category: "editable",
    inngestId: null,
    locked: false,
    enabled: true,
    schedule: "hourly",
    cadence: "Hourly",
    lastRunAt: null,
    nextRunAt: null,
    lastStatus: null,
    lastError: null,
    health: "ok",
    overdueByMs: 0,
    projectionStale: false,
    agent: null,
    canRunNow: false,
    scheduleEditable: true,
    retirable: false,
    inCatalog: false,
    ...over,
  };
}

describe("buildScheduleWindow", () => {
  it("shapes the window to the range", () => {
    const views = [view({ jobId: "a", schedule: "0 3 * * *" })];
    expect(buildScheduleWindow(views, "day", NOW).buckets).toHaveLength(24);
    expect(buildScheduleWindow(views, "week", NOW).buckets).toHaveLength(7);
    expect(buildScheduleWindow(views, "month", NOW).buckets).toHaveLength(30);
  });

  it("shows a weekly job that a 24h chart could never display", () => {
    // The old fixed 24h timeline had no way to show that a weekly sweep exists
    // on a Monday, which is exactly the "can't see longer periods" complaint.
    const weekly = [view({ jobId: "self-optimization-sweep-weekly", schedule: "0 5 * * 1" })];
    const day = buildScheduleWindow(weekly, "day", NOW);
    expect(day.buckets.flatMap((b) => b.occurrences)).toHaveLength(0);
    expect(day.quiet.map((q) => q.jobId)).toContain("self-optimization-sweep-weekly");

    const month = buildScheduleWindow(weekly, "month", NOW);
    const fires = month.buckets.flatMap((b) => b.occurrences);
    expect(fires.length).toBeGreaterThanOrEqual(4);
  });

  it("lists a sub-bucket cadence as continuous instead of plotting a solid block", () => {
    const dense = [view({ jobId: "code-graph-reconcile", schedule: "every-15m" })];
    const day = buildScheduleWindow(dense, "day", NOW);
    expect(day.buckets.flatMap((b) => b.occurrences)).toHaveLength(0);
    expect(day.continuous.map((c) => c.jobId)).toEqual(["code-graph-reconcile"]);
  });

  it("excludes work that will not fire", () => {
    const views = [
      view({ jobId: "spent", kind: "one-shot", schedule: "15 6 21 8 *", health: "spent" }),
      view({ jobId: "lock", kind: "slot-lock", schedule: "manual", health: "spent" }),
      view({ jobId: "off", schedule: "0 3 * * *", enabled: false }),
    ];
    const w = buildScheduleWindow(views, "week", NOW);
    expect(w.buckets.flatMap((b) => b.occurrences)).toHaveLength(0);
    expect(w.continuous).toHaveLength(0);
    expect(w.quiet).toHaveLength(0);
  });

  it("marks agent-backed occurrences so coworker load is visible", () => {
    const views = [
      view({ jobId: "agent", schedule: "0 3 * * *", substrate: "agent-task" }),
      view({ jobId: "cron", schedule: "0 3 * * *" }),
    ];
    const fires = buildScheduleWindow(views, "week", NOW).buckets.flatMap((b) => b.occurrences);
    expect(fires.filter((f) => f.isAgent).length).toBeGreaterThan(0);
    expect(fires.filter((f) => !f.isAgent).length).toBeGreaterThan(0);
  });

  it("reports the busiest bucket for bar scaling", () => {
    // On the day range each bucket is one hour, so 03:00 and 04:00 separate.
    const views = [
      view({ jobId: "a", schedule: "0 3 * * *" }),
      view({ jobId: "b", schedule: "0 3 * * *" }),
      view({ jobId: "c", schedule: "0 4 * * *" }),
    ];
    expect(buildScheduleWindow(views, "day", NOW).peak).toBe(2);
  });

  it("collapses a day's fires into one bucket on the week range", () => {
    const views = [
      view({ jobId: "a", schedule: "0 3 * * *" }),
      view({ jobId: "c", schedule: "0 4 * * *" }),
    ];
    const week = buildScheduleWindow(views, "week", NOW);
    expect(week.peak).toBe(2);
  });
});
