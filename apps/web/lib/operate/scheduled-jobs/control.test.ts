// EP-SCHEDULING-SURFACE — operator control policy.
//
// Guard paths short-circuit before DB/Inngest I/O, so no mocks are needed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  scheduledAgentTask: { findUnique: vi.fn(), update: vi.fn() },
  scheduledJob: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: vi.fn() } }));

import {
  isSupportedCron,
  isValidSchedule,
  projectNextRun,
  retuneCron,
} from "./cadence";
import { setWorkEnabled, updateWorkSchedule } from "./control";
import {
  INTAKE_CONTROLLER_COMMISSION_KEY,
  INTAKE_CONTROLLER_JOB_ID,
  INTAKE_CONTROLLER_WORK_SHAPE,
  parseIntakeControllerCommission,
} from "./intake-controller-commission";

describe("schedule validation", () => {
  it("accepts a cron expression as a first-class cadence", () => {
    // The old editor only knew eight named tokens, so most of the live register
    // could not be retuned at all.
    expect(isSupportedCron("0 3 * * *")).toBe(true);
    expect(isSupportedCron("31 15 * * 2,5")).toBe(true);
    expect(isSupportedCron("37 */6 * * *")).toBe(true);
    expect(isValidSchedule("0 3 * * *")).toBe(true);
  });

  it("still accepts the named presets", () => {
    expect(isValidSchedule("hourly")).toBe(true);
    expect(isValidSchedule("disabled")).toBe(true);
  });

  it("rejects nonsense", () => {
    expect(isValidSchedule("every-3000-years")).toBe(false);
    expect(isSupportedCron("0 3 * *")).toBe(false);
  });
});

describe("projectNextRun", () => {
  it("projects a cron cadence", () => {
    // computeNextCronRun reads cron fields in the host timezone (the server runs
    // UTC), so assert on local wall-clock fields rather than a UTC instant.
    const from = new Date("2026-08-22T02:30:00.000Z");
    const next = projectNextRun("0 3 * * *", from);
    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(3);
    expect(next!.getMinutes()).toBe(0);
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
  });

  it("projects a named cadence", () => {
    const from = new Date("2026-08-22T02:30:00.000Z");
    expect(projectNextRun("hourly", from)?.toISOString()).toBe("2026-08-22T03:30:00.000Z");
  });

  it("has no next run when disabled", () => {
    expect(projectNextRun("disabled", new Date())).toBeNull();
  });
});

describe("retuneCron", () => {
  it("preserves the time of day when changing frequency", () => {
    // self-marketing-specialist runs at 14:07; making it weekly must not
    // silently move it to midnight.
    expect(retuneCron("7 14 * * *", "weekly")).toBe("7 14 * * 1");
    expect(retuneCron("7 14 * * *", "monthly")).toBe("7 14 1 * *");
  });

  it("preserves an existing weekday when staying weekly", () => {
    expect(retuneCron("31 15 * * 2,5", "weekly")).toBe("31 15 * * 2,5");
  });

  it("collapses a weekly task back to daily", () => {
    expect(retuneCron("0 5 * * 1", "daily")).toBe("0 5 * * *");
  });

  it("returns null for a frequency it cannot express", () => {
    expect(retuneCron("0 5 * * 1", "every-15m")).toBeNull();
  });
});

describe("core-locked enforcement", () => {
  it("refuses to retune a core-locked platform-integrity cron", async () => {
    const res = await updateWorkSchedule("code-graph-reconcile", "hourly", "test");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/core-locked/);
  });
});

describe("one-shot refusal", () => {
  it("refuses to set a cadence that would fire once and never again", async () => {
    // A date-pinned cron is how the register filled with spent rows; accepting
    // one as a "schedule" is how an operator would make another.
    const res = await updateWorkSchedule("issue-report-triage", "15 6 21 8 *", "test");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/once and never again/);
  });
});

describe("invalid schedule", () => {
  it("rejects an unknown token before touching the DB", async () => {
    const res = await updateWorkSchedule("issue-report-triage", "every-3000-years", "test");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Invalid schedule/);
  });
});

describe("metadata preservation (BI-FD40397B)", () => {
  // The intake controller's commission reference lives in ScheduledJob.metadata.
  // An operator retuning or toggling the job must not silently uncommission it.
  const commission = {
    workroomCapsuleId: "WC-CONTROLLER",
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    workShape: INTAKE_CONTROLLER_WORK_SHAPE,
    commissionedByPrincipalId: "principal-row-owner",
    commissionedAt: "2026-10-13T09:00:00.000Z",
  };
  const stored = { lastEditedBy: "earlier", [INTAKE_CONTROLLER_COMMISSION_KEY]: commission };

  beforeEach(() => {
    vi.clearAllMocks();
    db.scheduledAgentTask.findUnique.mockResolvedValue(null);
    db.scheduledJob.findUnique.mockResolvedValue({ schedule: "17 6 * * 1", metadata: stored, locked: false, category: "editable" });
    db.scheduledJob.upsert.mockResolvedValue({});
  });

  const writtenMetadata = () => {
    const args = db.scheduledJob.upsert.mock.calls[0]![0] as { update: { metadata: unknown }; create: { metadata: unknown } };
    return args;
  };

  it("keeps the commission when the schedule is edited", async () => {
    const res = await updateWorkSchedule(INTAKE_CONTROLLER_JOB_ID, "0 * * * *", "operator@example.test");
    expect(res.ok).toBe(true);
    const { update } = writtenMetadata();
    expect(parseIntakeControllerCommission(update.metadata)).toEqual(commission);
    expect(update.metadata).toMatchObject({ lastEditedBy: "operator@example.test", lastAction: "update-schedule" });
  });

  it("keeps the commission when the job is disabled and re-enabled", async () => {
    expect((await setWorkEnabled(INTAKE_CONTROLLER_JOB_ID, false, "operator@example.test")).ok).toBe(true);
    expect(parseIntakeControllerCommission(writtenMetadata().update.metadata)).toEqual(commission);

    db.scheduledJob.upsert.mockClear();
    expect((await setWorkEnabled(INTAKE_CONTROLLER_JOB_ID, true, "operator@example.test")).ok).toBe(true);
    const { update } = writtenMetadata();
    expect(parseIntakeControllerCommission(update.metadata)).toEqual(commission);
    expect(update.metadata).toMatchObject({ lastAction: "enable" });
  });

  it("keeps other metadata on an agent-backed job's mirror row too", async () => {
    db.scheduledAgentTask.findUnique.mockResolvedValue({ schedule: "0 9 * * *" });
    db.scheduledAgentTask.update.mockResolvedValue({});
    await setWorkEnabled("agent-backed-job", false, "operator@example.test");
    expect(parseIntakeControllerCommission(writtenMetadata().update.metadata)).toEqual(commission);
    db.scheduledJob.upsert.mockClear();
    await updateWorkSchedule("agent-backed-job", "weekly", "operator@example.test");
    expect(parseIntakeControllerCommission(writtenMetadata().update.metadata)).toEqual(commission);
  });
});
