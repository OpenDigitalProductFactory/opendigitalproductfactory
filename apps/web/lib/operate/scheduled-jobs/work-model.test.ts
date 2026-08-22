// EP-SCHEDULING-SURFACE — the pure scheduled-work model.
//
// The cases below are drawn from real rows in the live install register, named
// in each test, so a regression reintroduces a defect an operator actually hit.

import { describe, expect, it } from "vitest";

import {
  buildWorkView,
  cadenceIntervalMs,
  deriveHealth,
  deriveKind,
  describeSchedule,
  isProjectionStale,
  isQuarantined,
  overdueGraceMs,
} from "./work-model";

const NOW = new Date("2026-08-22T02:30:00.000Z");

/** Fixtures are expressed as offsets from NOW, and every assertion passes NOW
 *  explicitly, so no case depends on the wall clock. */
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const from = (ms: number) => new Date(NOW.getTime() + ms);

describe("deriveKind", () => {
  it("calls an eval slot-claim row a slot-lock, not a job", () => {
    // eval-glm-4.7 — written by claimEvalSlot purely to get an atomic mutex.
    expect(deriveKind("manual")).toBe("slot-lock");
  });

  it("calls a date-pinned cron a one-shot", () => {
    // mcp-efficiency-aiops-20260821 — a new row of this shape every single day.
    expect(deriveKind("15 6 21 8 *")).toBe("one-shot");
  });

  it("keeps genuine cadences recurring", () => {
    expect(deriveKind("every-15m")).toBe("recurring");
    expect(deriveKind("0 3 * * *")).toBe("recurring");
    expect(deriveKind("31 15 * * 2,5")).toBe("recurring");
  });
});

describe("describeSchedule", () => {
  it("labels the tokens the register actually stores", () => {
    // every-10-minutes and every-6-hours are persisted but were absent from the
    // old label map, so they rendered as the catalog's stale cadence text.
    expect(describeSchedule("every-10-minutes")).toBe("Every 10 minutes");
    expect(describeSchedule("every-6-hours")).toBe("Every 6 hours");
    expect(describeSchedule("hourly")).toBe("Hourly");
  });

  it("describes cron shapes in the register", () => {
    expect(describeSchedule("0 3 * * *")).toBe("Daily at 03:00");
    expect(describeSchedule("37 */6 * * *")).toBe("Every 6h at :37");
    expect(describeSchedule("31 15 * * 2,5")).toBe("Weekly — Tue, Fri at 15:31");
    expect(describeSchedule("0 5 * * 1")).toBe("Weekly — Mon at 05:00");
    expect(describeSchedule("15 6 21 8 *")).toBe("Once on Aug 21 at 06:15");
  });

  it("never invents a cadence for an unparseable value", () => {
    expect(describeSchedule("unknown")).toBe("unknown");
  });
});

describe("cadenceIntervalMs", () => {
  it("resolves named tokens", () => {
    expect(cadenceIntervalMs("every-15m")).toBe(15 * 60_000);
    expect(cadenceIntervalMs("every-10-minutes")).toBe(10 * 60_000);
    expect(cadenceIntervalMs("every-6-hours")).toBe(6 * 3_600_000);
  });

  it("measures a cron by projecting two consecutive fires", () => {
    expect(cadenceIntervalMs("0 3 * * *")).toBe(24 * 3_600_000);
    expect(cadenceIntervalMs("0 5 * * 1")).toBe(7 * 24 * 3_600_000);
  });

  it("returns null when the cadence is unknowable", () => {
    expect(cadenceIntervalMs("manual")).toBeNull();
  });
});

describe("overdueGraceMs", () => {
  it("floors a fast cron so one missed tick is not an alarm", () => {
    expect(overdueGraceMs("every-1m")).toBe(15 * 60_000);
  });

  it("caps a slow cron so a silent monthly job still surfaces within a day", () => {
    expect(overdueGraceMs("monthly")).toBe(24 * 3_600_000);
  });
});

describe("deriveHealth", () => {
  const base = {
    kind: "recurring" as const,
    enabled: true,
    schedule: "hourly",
    lastStatus: "ok" as string | null,
    lastRunAt: from(-65 * MIN),
    nextRunAt: from(-5 * MIN),
  };

  it("is ok when the next run is still ahead or barely past", () => {
    expect(deriveHealth(base, NOW).health).toBe("ok");
  });

  it("flags a recurring job whose next run came and went", () => {
    // The 13-day silent code-graph outage read as a green OK under the old
    // three-state pill because lastStatus was still "ok".
    const stopped = { ...base, nextRunAt: from(-2 * DAY) };
    const result = deriveHealth(stopped, NOW);
    expect(result.health).toBe("overdue");
    expect(result.overdueByMs).toBeGreaterThan(24 * 3_600_000);
  });

  it("calls a fired one-shot spent rather than healthy", () => {
    const oneShot = {
      ...base,
      kind: "one-shot" as const,
      schedule: "15 6 21 8 *",
      nextRunAt: null,
    };
    expect(deriveHealth(oneShot, NOW).health).toBe("spent");
  });

  it("keeps an error visible", () => {
    expect(deriveHealth({ ...base, lastStatus: "error" }, NOW).health).toBe("error");
  });

  it("reports a never-run recurring job as never, not ok", () => {
    expect(deriveHealth({ ...base, lastRunAt: null }, NOW).health).toBe("never");
  });
});

describe("isProjectionStale", () => {
  it("catches a next run stranded in the past", () => {
    // postgres-trial-restore-daily: lastRunAt 2026-08-21, nextRunAt 2026-06-09.
    expect(
      isProjectionStale("daily", from(-23 * HOUR), from(-74 * DAY)),
    ).toBe(true);
  });

  it("accepts a projection one cadence ahead", () => {
    expect(
      isProjectionStale("daily", from(-22 * HOUR), from(2 * HOUR)),
    ).toBe(false);
  });

  it("stays silent when the cadence is unknowable", () => {
    expect(isProjectionStale("manual", new Date(), new Date())).toBe(false);
  });
});

describe("buildWorkView", () => {
  const task = {
    taskId: "self-marketing-specialist-abc",
    agentId: "marketing-specialist",
    title: "Refresh the acquisition campaign brief",
    routeContext: "/customer/marketing",
    schedule: "7 14 * * *",
    isActive: true,
    ownerUserId: "user-1",
    lastRunAt: from(-11 * HOUR),
    nextRunAt: from(11 * HOUR),
    lastStatus: "error" as string | null,
    lastError: "provider timeout",
    lastThreadId: null,
    taskRunId: "TR-SCHED-C77B43A9",
  };

  const staleMirror = {
    jobId: "self-marketing-specialist-abc",
    name: "Agent: marketing",
    // The mirror says disabled; the agent task says it runs every afternoon.
    schedule: "disabled",
    lastRunAt: from(-11 * HOUR),
    nextRunAt: from(11 * HOUR),
    lastStatus: "error" as string | null,
    lastError: "provider timeout",
    category: "editable",
    locked: false,
    enabled: true,
  };

  it("lets the agent task win over a drifted ScheduledJob mirror", () => {
    const view = buildWorkView(task.taskId, staleMirror, task, NOW);
    expect(view.substrate).toBe("agent-task");
    expect(view.schedule).toBe("7 14 * * *");
    expect(view.cadence).toBe("Daily at 14:07");
    expect(view.enabled).toBe(true);
  });

  it("surfaces the coworker, its route and its last run", () => {
    const view = buildWorkView(task.taskId, staleMirror, task, NOW);
    expect(view.agent).toEqual({
      agentId: "marketing-specialist",
      taskTitle: "Refresh the acquisition campaign brief",
      routeContext: "/customer/marketing",
      ownerUserId: "user-1",
      lastTaskRunId: "TR-SCHED-C77B43A9",
      lastThreadId: null,
    });
  });

  it("offers a manual trigger for agent work that had none before", () => {
    expect(buildWorkView(task.taskId, undefined, task, NOW).canRunNow).toBe(true);
  });

  it("marks a spent slot-lock retirable and not schedule-editable", () => {
    const lock = {
      jobId: "eval-glm-4.7",
      name: "Eval: glm-4.7",
      schedule: "manual",
      lastRunAt: from(-23 * HOUR),
      nextRunAt: null,
      lastStatus: "completed" as string | null,
      lastError: null,
      category: "editable",
      locked: false,
      enabled: true,
    };
    const view = buildWorkView("eval-glm-4.7", lock, undefined, NOW);
    expect(view.kind).toBe("slot-lock");
    expect(view.health).toBe("spent");
    expect(view.retirable).toBe(true);
    expect(view.scheduleEditable).toBe(false);
  });
});

describe("isQuarantined", () => {
  it("recognises index-repair debris", () => {
    expect(isQuarantined("__dpf_quarantined__cmq5xd304001i01oc9jht6wxu__eval-x")).toBe(true);
    expect(isQuarantined("code-graph-reconcile")).toBe(false);
  });
});
