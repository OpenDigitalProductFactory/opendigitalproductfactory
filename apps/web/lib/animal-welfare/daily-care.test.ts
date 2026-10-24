import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    animalProfile: { findFirst: vi.fn(), findMany: vi.fn() },
    workEngagement: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn() },
    workEngagementActivity: { aggregate: vi.fn(), create: vi.fn() },
    recurrenceSchedule: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@dpf/db";
import {
  DailyCareError,
  buildRoutineRrule,
  escalateMissedMedication,
  establishCareRoutine,
  isMedicationOverdue,
  loadDailyCareBoard,
  parseTimeOfDay,
  recordCareRound,
  routineAnchor,
  routineTitle,
} from "./daily-care";

const NOW = new Date("2026-09-17T10:00:00Z");
const ACTOR = { userId: "user-1", principalRef: "principal-1" };
const ORG = "org-1";

describe("daily care pure helpers", () => {
  it("builds titles and rules the operator can read back", () => {
    expect(routineTitle("medication", "Ranger", "Bravecto 250mg")).toBe("Medication: Bravecto 250mg — Ranger");
    expect(routineTitle("feed", "Ranger")).toBe("Feed — Ranger");
    expect(buildRoutineRrule({ frequency: "daily" })).toBe("FREQ=DAILY");
    expect(buildRoutineRrule({ frequency: "weekly", weekdays: ["MO", "WE"] })).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
    expect(() => buildRoutineRrule({ frequency: "weekly", weekdays: [] })).toThrow(DailyCareError);
  });

  it("validates the time of day and anchors the first round on today or tomorrow in the org zone", () => {
    expect(parseTimeOfDay("08:30")).toEqual({ hour: 8, minute: 30 });
    expect(() => parseTimeOfDay("25:00")).toThrow(/HH:MM/);
    // 10:00Z now; 08:00 Europe/Amsterdam is 06:00Z — already past, so tomorrow.
    expect(routineAnchor({ timeOfDay: "08:00", timeZone: "Europe/Amsterdam", now: NOW }).toISOString()).toBe("2026-09-18T06:00:00.000Z");
    // 20:00 Amsterdam is still ahead today.
    expect(routineAnchor({ timeOfDay: "20:00", timeZone: "Europe/Amsterdam", now: NOW }).toISOString()).toBe("2026-09-17T18:00:00.000Z");
    expect(routineAnchor({ timeOfDay: "08:00", timeZone: "UTC", now: NOW, startDate: "2026-10-01" }).toISOString()).toBe("2026-10-01T08:00:00.000Z");
  });

  it("treats only a planned medication round past its grace window as overdue medication", () => {
    const due = new Date(NOW.getTime() - 3 * 60 * 60_000);
    expect(isMedicationOverdue({ kind: "medication", status: "planned", dueAt: due }, NOW)).toBe(true);
    expect(isMedicationOverdue({ kind: "medication", status: "planned", dueAt: new Date(NOW.getTime() - 30 * 60_000) }, NOW)).toBe(false);
    expect(isMedicationOverdue({ kind: "feed", status: "planned", dueAt: due }, NOW)).toBe(false);
    expect(isMedicationOverdue({ kind: "medication", status: "completed", dueAt: due }, NOW)).toBe(false);
  });
});

describe("establishCareRoutine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (work: unknown) => (work as (tx: typeof prisma) => Promise<unknown>)(prisma) as never);
    vi.mocked(prisma.recurrenceSchedule.create).mockResolvedValue({ id: "sched-1" } as never);
    vi.mocked(prisma.workEngagement.create).mockResolvedValue({ id: "routine-1" } as never);
    vi.mocked(prisma.workEngagement.createMany).mockResolvedValue({ count: 14 } as never);
    vi.mocked(prisma.workEngagement.findUnique).mockResolvedValue({ id: "routine-1" } as never);
    vi.mocked(prisma.workEngagement.update).mockResolvedValue({} as never);
    vi.mocked(prisma.workEngagementActivity.aggregate).mockResolvedValue({ _max: { seq: 0 } } as never);
    vi.mocked(prisma.workEngagementActivity.create).mockResolvedValue({ id: "act-1", seq: 1 } as never);
  });

  it("creates a subject-bound recurring engagement with a 14-day horizon and records the routine facts", async () => {
    vi.mocked(prisma.animalProfile.findFirst).mockResolvedValue({ id: "animal-1", name: "Ranger", animalRef: "AN-1" } as never);
    const result = await establishCareRoutine({
      organizationId: ORG, timeZone: "UTC", actor: ACTOR, now: NOW,
      command: { animalProfileId: "animal-1", kind: "medication", timeOfDay: "20:00", frequency: "daily", forDays: 10, instruction: "Bravecto 250mg" },
    });
    expect(result).toEqual({ routineId: "routine-1", instances: 10, title: "Medication: Bravecto 250mg — Ranger" });
    const parent = vi.mocked(prisma.workEngagement.create).mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(parent.data).toMatchObject({ organizationId: ORG, subjectKindSlug: "animal-profile", subjectRef: "animal-profile:animal-1", recurrenceScheduleId: "sched-1" });
    const instances = (vi.mocked(prisma.workEngagement.createMany).mock.calls[0]![0] as { data: Array<Record<string, unknown>> }).data;
    expect(instances).toHaveLength(10);
    expect(instances[0]).toMatchObject({ subjectRef: "animal-profile:animal-1", parentWorkEngagementId: "routine-1", status: "planned", dueAt: new Date("2026-09-17T20:00:00Z") });
    const routine = vi.mocked(prisma.workEngagementActivity.create).mock.calls[0]![0] as { data: { kind: string; payload: Record<string, unknown> } };
    expect(routine.data.kind).toBe("care-routine");
    expect(routine.data.payload).toMatchObject({ kind: "medication", instruction: "Bravecto 250mg", forDays: 10, animalProfileId: "animal-1" });
  });

  it("refuses an animal outside the organization or out of care, and a medication with no product", async () => {
    vi.mocked(prisma.animalProfile.findFirst).mockResolvedValue(null);
    await expect(establishCareRoutine({ organizationId: ORG, timeZone: "UTC", actor: ACTOR, now: NOW, command: { animalProfileId: "x", kind: "feed", timeOfDay: "08:00", frequency: "daily" } }))
      .rejects.toMatchObject({ code: "animal_not_found" });
    await expect(establishCareRoutine({ organizationId: ORG, timeZone: "UTC", actor: ACTOR, now: NOW, command: { animalProfileId: "x", kind: "medication", timeOfDay: "08:00", frequency: "daily" } }))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(prisma.workEngagement.create).not.toHaveBeenCalled();
  });
});

describe("recordCareRound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (work: unknown) => (work as (tx: typeof prisma) => Promise<unknown>)(prisma) as never);
    vi.mocked(prisma.workEngagement.update).mockResolvedValue({} as never);
    vi.mocked(prisma.workEngagementActivity.aggregate).mockResolvedValue({ _max: { seq: 1 } } as never);
    vi.mocked(prisma.workEngagementActivity.create).mockResolvedValue({ id: "act", seq: 2 } as never);
    vi.mocked(prisma.workEngagement.create).mockResolvedValue({ id: "esc-1" } as never);
  });

  function round(status = "planned") {
    return { id: "round-1", title: "Medication: Bravecto — Ranger", status, subjectRef: "animal-profile:animal-1", dueAt: new Date("2026-09-17T08:00:00Z"), parent: { activities: [{ payload: { kind: "medication" } }] } };
  }

  it("completes a done round with its activity and raises no follow-up", async () => {
    vi.mocked(prisma.workEngagement.findFirst).mockResolvedValue(round() as never);
    // transitionWorkEngagement reads the current status by id each time.
    vi.mocked(prisma.workEngagement.findUnique).mockResolvedValueOnce({ id: "round-1", status: "planned" } as never).mockResolvedValueOnce({ id: "round-1" } as never).mockResolvedValueOnce({ id: "round-1", status: "in-progress" } as never);
    const result = await recordCareRound({ organizationId: ORG, actor: ACTOR, now: NOW, command: { roundId: "round-1", outcome: "done" } });
    expect(result).toEqual({ roundId: "round-1", outcome: "done", escalationId: null });
    expect(prisma.workEngagement.create).not.toHaveBeenCalled();
    const kinds = vi.mocked(prisma.workEngagementActivity.create).mock.calls.map((c) => (c[0] as { data: { kind: string } }).data.kind);
    expect(kinds).toEqual(["status-change", "care-round", "status-change"]);
  });

  it("requires an observation for an exception and raises urgent subject-bound follow-up work", async () => {
    vi.mocked(prisma.workEngagement.findFirst).mockResolvedValue(round() as never);
    await expect(recordCareRound({ organizationId: ORG, actor: ACTOR, now: NOW, command: { roundId: "round-1", outcome: "refused" } })).rejects.toMatchObject({ code: "invalid_input" });
    vi.mocked(prisma.workEngagement.findUnique).mockResolvedValueOnce({ id: "round-1", status: "planned" } as never).mockResolvedValueOnce({ id: "round-1" } as never).mockResolvedValueOnce({ id: "round-1", status: "in-progress" } as never).mockResolvedValue({ id: "esc-1" } as never);
    const result = await recordCareRound({ organizationId: ORG, actor: ACTOR, now: NOW, command: { roundId: "round-1", outcome: "refused", observation: "Spat the tablet out twice" } });
    expect(result.escalationId).toBe("esc-1");
    const escalation = vi.mocked(prisma.workEngagement.create).mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(escalation.data).toMatchObject({ organizationId: ORG, subjectRef: "animal-profile:animal-1", status: "planned", dueAt: NOW, title: "Welfare follow-up: Medication: Bravecto — Ranger" });
  });

  it("refuses a round already recorded or outside the organization", async () => {
    vi.mocked(prisma.workEngagement.findFirst).mockResolvedValueOnce(round("completed") as never).mockResolvedValueOnce(null);
    await expect(recordCareRound({ organizationId: ORG, actor: ACTOR, now: NOW, command: { roundId: "round-1", outcome: "done" } })).rejects.toMatchObject({ code: "already_recorded" });
    await expect(recordCareRound({ organizationId: ORG, actor: ACTOR, now: NOW, command: { roundId: "round-1", outcome: "done" } })).rejects.toMatchObject({ code: "round_not_found" });
  });
});

describe("escalateMissedMedication and the board", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (work: unknown) => (work as (tx: typeof prisma) => Promise<unknown>)(prisma) as never);
    vi.mocked(prisma.workEngagement.update).mockResolvedValue({} as never);
    vi.mocked(prisma.workEngagement.findUnique).mockResolvedValue({ id: "x" } as never);
    vi.mocked(prisma.workEngagementActivity.aggregate).mockResolvedValue({ _max: { seq: 0 } } as never);
    vi.mocked(prisma.workEngagementActivity.create).mockResolvedValue({ id: "act", seq: 1 } as never);
    vi.mocked(prisma.workEngagement.create).mockResolvedValue({ id: "esc-1" } as never);
  });

  it("escalates each unescalated overdue medication round once, as urgent work", async () => {
    vi.mocked(prisma.workEngagement.findMany).mockResolvedValueOnce([
      { id: "round-9", title: "Medication: Bravecto — Ranger", subjectRef: "animal-profile:animal-1", dueAt: new Date("2026-09-17T06:00:00Z") },
    ] as never);
    const result = await escalateMissedMedication({ organizationId: ORG, actor: ACTOR, now: NOW });
    expect(result).toEqual({ escalated: 1 });
    const where = (vi.mocked(prisma.workEngagement.findMany).mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ status: "planned", activities: { none: { kind: "care-escalation" } } });
    expect(prisma.workEngagement.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: "Missed medication: Medication: Bravecto — Ranger", dueAt: NOW }) }));
  });

  it("projects today's rounds with the animal's name, overdue flags and open follow-ups", async () => {
    vi.mocked(prisma.workEngagement.findMany)
      .mockResolvedValueOnce([
        { id: "r1", title: "Feed — Ranger", status: "planned", subjectRef: "animal-profile:animal-1", dueAt: new Date("2026-09-17T07:00:00Z"), parent: { activities: [{ payload: { kind: "feed", instruction: "Half a cup" } }] } },
        { id: "r2", title: "Medication: Bravecto — Ranger", status: "planned", subjectRef: "animal-profile:animal-1", dueAt: new Date("2026-09-17T06:00:00Z"), parent: { activities: [{ payload: { kind: "medication", instruction: "Bravecto" } }] } },
      ] as never)
      .mockResolvedValueOnce([{ id: "esc-1", title: "Welfare follow-up: Feed — Ranger", requestedOutcome: "not-eaten: nothing since yesterday", subjectRef: "animal-profile:animal-1", dueAt: NOW, createdAt: NOW }] as never);
    vi.mocked(prisma.animalProfile.findMany).mockResolvedValue([{ id: "animal-1", name: "Ranger", animalRef: "AN-1" }] as never);
    const board = await loadDailyCareBoard({ organizationId: ORG, dayStart: new Date("2026-09-17T00:00:00Z"), dayEnd: new Date("2026-09-18T00:00:00Z"), now: NOW });
    expect(board.rounds.map((r) => [r.kind, r.animalName, r.overdue, r.medicationOverdue])).toEqual([["feed", "Ranger", true, false], ["medication", "Ranger", true, true]]);
    expect(board.escalations[0]).toMatchObject({ animalName: "Ranger", reason: "not-eaten: nothing since yesterday" });
    expect(board.animals).toEqual([{ animalProfileId: "animal-1", name: "Ranger", animalRef: "AN-1" }]);
  });
});
