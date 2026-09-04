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
  hasProjectableCronTime,
  isProjectionStale,
  isQuarantined,
  isRetired,
  overdueGraceMs,
  parseProactivityFact,
  proactivityFactKey,
  selectRegisterIds,
  stepCronIntervalMs,
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

  it("reads a deconflicted minute list as its interval", () => {
    // The scheduling allocator spreads fires across the hour; the raw list is
    // accurate and unreadable.
    expect(describeSchedule("2,7,12,17,22,27,32,37,42,47,52,57 * * * *")).toBe("Every 5 minutes");
    expect(describeSchedule("6,21,36,51 * * * *")).toBe("Every 15 minutes");
  });

  it("keeps an uneven minute list literal", () => {
    expect(describeSchedule("3,17,42 * * * *")).toBe("Hourly at :3,17,42");
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

describe("stepCronIntervalMs", () => {
  it("reads the sub-hourly step shapes the dispatcher's projector cannot", () => {
    // computeNextCronRun treats minute/hour as concrete and returns a 24h
    // fallback for these, which made a 5-minute cron look daily and stranded
    // twelve-times-an-hour jobs in "no fire inside this window".
    expect(stepCronIntervalMs("*/5 * * * *")).toBe(5 * 60_000);
    expect(stepCronIntervalMs("*/15 * * * *")).toBe(15 * 60_000);
    expect(stepCronIntervalMs("0 * * * *")).toBe(3_600_000);
    expect(stepCronIntervalMs("37 */6 * * *")).toBe(6 * 3_600_000);
  });

  it("does not claim a sub-daily gap when the date fields are pinned", () => {
    // `*/5 * 1 * *` fires every 5 minutes on the 1st, not continuously.
    expect(stepCronIntervalMs("*/5 * 1 * *")).toBeNull();
  });

  it("leaves concrete-time crons to the projector", () => {
    expect(stepCronIntervalMs("0 3 * * *")).toBeNull();
  });
});

describe("cadenceIntervalMs — step shapes", () => {
  it("reports a 5-minute cron as five minutes, not a day", () => {
    expect(cadenceIntervalMs("*/5 * * * *")).toBe(5 * 60_000);
    expect(cadenceIntervalMs("0 * * * *")).toBe(3_600_000);
  });
});

describe("hasProjectableCronTime", () => {
  it("is true only for concrete minute and hour", () => {
    expect(hasProjectableCronTime("0 3 * * *")).toBe(true);
    expect(hasProjectableCronTime("*/5 * * * *")).toBe(false);
    expect(hasProjectableCronTime("0 * * * *")).toBe(false);
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
    reportsRunData: true,
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

  it("does NOT cry never-run for a cron that records no run data", () => {
    // 45 of 55 catalog crons set tracksRunData:false and write no ScheduledJob
    // row. Reading that absence as "never run" put 44 false alarms in the
    // attention strip — the exact wolf-crying the register exists to end.
    const silent = { ...base, lastRunAt: null, reportsRunData: false };
    expect(deriveHealth(silent, NOW).health).toBe("untracked");
  });

  it("keeps untracked distinct from a genuinely silent tracked job", () => {
    expect(deriveHealth({ ...base, lastRunAt: null, reportsRunData: true }, NOW).health).toBe("never");
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

  it("carries no proactivity when the pair has no stored fact", () => {
    expect(buildWorkView(task.taskId, undefined, task, NOW).agent?.proactivity).toBeNull();
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
      proactivity: null,
    });
  });

  it("does not repeat the task title as its own purpose", () => {
    expect(buildWorkView(task.taskId, undefined, task, NOW).purpose).toBe("");
  });

  it("offers a manual trigger for agent work that had none before", () => {
    expect(buildWorkView(task.taskId, undefined, task, NOW).canRunNow).toBe(true);
  });

  it("says a cron with no entry gate has no working kill switch", () => {
    // Disabling one of these persists a column nothing reads; the job runs on.
    const ungated = {
      jobId: "log-signature-scanner",
      name: "Log signature scanner",
      schedule: "*/15 * * * *",
      lastRunAt: null,
      nextRunAt: null,
      lastStatus: null as string | null,
      lastError: null,
      category: "editable",
      locked: false,
      enabled: true,
    };
    expect(buildWorkView("log-signature-scanner", ungated, undefined, NOW).killSwitchEnforced).toBe(false);
  });

  it("says an agent task's kill switch is load-bearing", () => {
    // The dispatcher reads isActive, so Disable genuinely stops it.
    expect(buildWorkView(task.taskId, undefined, task, NOW).killSwitchEnforced).toBe(true);
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

describe("selectRegisterIds", () => {
  const RET = { retiredAt: "2026-08-23T03:49:31.018Z", retiredBy: "op" };

  it("drops a retired entry that exists in BOTH substrates", () => {
    // mcp-efficiency-aiops-20260805 is a ScheduledJob mirror AND a
    // ScheduledAgentTask. Excluding it from one source only left the other
    // re-adding it, so Retire reported success and the row stayed on screen.
    const ids = selectRegisterIds(
      [],
      [{ jobId: "mcp-efficiency-aiops-20260805", metadata: RET }],
      ["mcp-efficiency-aiops-20260805"],
    );
    expect(ids).toEqual([]);
  });

  it("drops a retired entry that is also a catalog cron", () => {
    expect(selectRegisterIds(["x"], [{ jobId: "x", metadata: RET }], [])).toEqual([]);
  });

  it("keeps everything not retired, and drops quarantine debris", () => {
    const ids = selectRegisterIds(
      ["cron-a"],
      [{ jobId: "row-b", metadata: null }, { jobId: "__dpf_quarantined__x", metadata: null }],
      ["task-c"],
    );
    expect(ids.sort()).toEqual(["cron-a", "row-b", "task-c"]);
  });
});

describe("parseProactivityFact", () => {
  it("reads a level the operator set, and keeps its provenance", () => {
    // Shape taken verbatim from a live UserFact row.
    const v = {
      scope: "agent",
      scopeKey: "agent:coo",
      level: "assertive",
      source: "manual-setting",
      acknowledgedByUserId: "u1",
      acknowledgedAt: "2026-08-23T18:23:34.909Z",
    };
    expect(parseProactivityFact(v)).toEqual({
      level: "assertive",
      source: "manual-setting",
      acknowledgedAt: "2026-08-23T18:23:34.909Z",
    });
  });

  it("distinguishes a backfilled level from one the operator chose", () => {
    // "reconcile-backfill" is the platform inferring a level from an orphaned
    // task; presenting it as a deliberate setting would overstate it.
    const parsed = parseProactivityFact({ level: "balanced", source: "reconcile-backfill" });
    expect(parsed?.source).toBe("reconcile-backfill");
  });

  it("accepts the JSON-string form the column can hold", () => {
    expect(parseProactivityFact('{"level":"quiet"}')?.level).toBe("quiet");
  });

  it("returns null rather than guessing at an unreadable fact", () => {
    expect(parseProactivityFact("not json")).toBeNull();
    expect(parseProactivityFact({ level: "enthusiastic" })).toBeNull();
    expect(parseProactivityFact(null)).toBeNull();
    expect(parseProactivityFact({})).toBeNull();
  });
});

describe("proactivityFactKey", () => {
  it("matches the key the platform actually stores", () => {
    expect(proactivityFactKey("coo")).toBe("aiCoworkerProactivity:agent:coo");
  });
});

describe("isRetired", () => {
  it("recognises an operator-retired entry", () => {
    // Retire is non-destructive, so the row survives; the register must still
    // drop it or the button reports success and visibly does nothing.
    expect(isRetired({ retiredAt: "2026-08-23T01:00:00.000Z", retiredBy: "op" })).toBe(true);
  });

  it("leaves an ordinary metadata blob alone", () => {
    expect(isRetired({ lastEditedBy: "op" })).toBe(false);
    expect(isRetired(null)).toBe(false);
    expect(isRetired(undefined)).toBe(false);
  });
});

describe("isQuarantined", () => {
  it("recognises index-repair debris", () => {
    expect(isQuarantined("__dpf_quarantined__cmq5xd304001i01oc9jht6wxu__eval-x")).toBe(true);
    expect(isQuarantined("code-graph-reconcile")).toBe(false);
  });
});
