/**
 * Daily care (BI-5A25EC37, design 2026-08-25 §5.3 "Generic work subject").
 *
 * A care routine is a recurring WorkEngagement whose subject is an animal:
 * the recurrence expander materialises dated rounds, the append-only activity
 * timeline records what happened, and a missed medication or a welfare
 * observation becomes urgent work that a person must acknowledge. No rescue
 * task engine, no second scheduler, no coworker decides on treatment.
 */

import { prisma } from "@dpf/db";

import {
  createRecurringWorkEngagement,
  materializeRecurringInstances,
  recordWorkEngagementActivity,
  transitionWorkEngagement,
} from "@/lib/work-capture/work-engagement";
import { wallClockToUtc } from "@/lib/work-capture/recurrence-expander";

import { ANIMAL_SUBJECT_KIND } from "./intake-policy";

export {
  CARE_ROUND_OUTCOMES,
  CARE_ROUTINE_KINDS,
  EXCEPTION_OUTCOMES,
  KIND_LABEL,
  type CareEscalation,
  type CareRound,
  type CareRoundOutcome,
  type CareRoutineKind,
  type DailyCareBoard,
} from "./daily-care-vocabulary";
import {
  CARE_ROUND_OUTCOMES,
  CARE_ROUTINE_KINDS,
  EXCEPTION_OUTCOMES,
  KIND_LABEL,
  type CareRoundOutcome,
  type CareRoutineKind,
  type DailyCareBoard,
} from "./daily-care-vocabulary";

export const ROUTINE_ACTIVITY_KIND = "care-routine";
export const ROUND_ACTIVITY_KIND = "care-round";
export const ESCALATION_ACTIVITY_KIND = "care-escalation";
export const MATERIALIZATION_HORIZON_DAYS = 14;
export const MISSED_MEDICATION_GRACE_MINUTES = 120;


export class DailyCareError extends Error {
  constructor(
    public readonly code: "invalid_input" | "animal_not_found" | "round_not_found" | "already_recorded" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "DailyCareError";
  }
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

export interface CareRoutineCommand {
  animalProfileId: string;
  kind: CareRoutineKind;
  /** Local wall-clock time the round is due, HH:MM. */
  timeOfDay: string;
  frequency: "daily" | "weekly";
  /** Weekdays for a weekly routine, RFC 5545 codes. */
  weekdays?: readonly ("SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA")[];
  /** Length of the course in days; null keeps it open-ended. */
  forDays?: number | null;
  /** Product or instruction shown on the round, e.g. "Bravecto 250mg". */
  instruction?: string | null;
  startDate?: string | null;
}

export function routineTitle(kind: CareRoutineKind, animalName: string, instruction?: string | null): string {
  const label = KIND_LABEL[kind];
  return instruction?.trim() ? `${label}: ${instruction.trim()} — ${animalName}` : `${label} — ${animalName}`;
}

export function buildRoutineRrule(command: Pick<CareRoutineCommand, "frequency" | "weekdays">): string {
  if (command.frequency === "weekly") {
    const days = (command.weekdays ?? []).filter((d) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].includes(d));
    if (days.length === 0) throw new DailyCareError("invalid_input", "A weekly routine needs at least one weekday.");
    return `FREQ=WEEKLY;BYDAY=${days.join(",")}`;
  }
  return "FREQ=DAILY";
}

export function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hour = match ? Number(match[1]) : NaN;
  const minute = match ? Number(match[2]) : NaN;
  if (!match || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new DailyCareError("invalid_input", "Time of day must be HH:MM.");
  }
  return { hour, minute };
}

/** First occurrence: today at the given local time, or tomorrow if that has passed. */
export function routineAnchor(input: { timeOfDay: string; timeZone: string; now: Date; startDate?: string | null }): Date {
  const { hour, minute } = parseTimeOfDay(input.timeOfDay);
  const start = input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : null;
  if (input.startDate && (!start || Number.isNaN(start.getTime()))) throw new DailyCareError("invalid_input", "Start date must be a date.");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(start ?? input.now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  let anchor = wallClockToUtc(get("year"), get("month") - 1, get("day"), hour, minute, 0, input.timeZone);
  if (!start && anchor.getTime() < input.now.getTime()) anchor = new Date(anchor.getTime() + 86_400_000);
  return anchor;
}

export function isMedicationOverdue(round: { kind: CareRoutineKind; status: string; dueAt: Date | null }, now: Date): boolean {
  return round.kind === "medication"
    && round.status === "planned"
    && round.dueAt != null
    && round.dueAt.getTime() + MISSED_MEDICATION_GRACE_MINUTES * 60_000 < now.getTime();
}

// ─── Commands ───────────────────────────────────────────────────────────────

export interface CareActor {
  userId: string;
  principalRef: string;
}

export async function establishCareRoutine(input: {
  organizationId: string;
  timeZone: string;
  actor: CareActor;
  command: CareRoutineCommand;
  now?: Date;
}): Promise<{ routineId: string; instances: number; title: string }> {
  const now = input.now ?? new Date();
  const { command } = input;
  if (!CARE_ROUTINE_KINDS.includes(command.kind)) throw new DailyCareError("invalid_input", "Choose a routine kind.");
  if (command.forDays != null && (!Number.isInteger(command.forDays) || command.forDays < 1 || command.forDays > 365)) {
    throw new DailyCareError("invalid_input", "A course runs between 1 and 365 days.");
  }
  if (command.kind === "medication" && !command.instruction?.trim()) {
    throw new DailyCareError("invalid_input", "A medication routine names the product and dose.");
  }
  const animal = await prisma.animalProfile.findFirst({
    where: { id: command.animalProfileId, organizationId: input.organizationId, lifecycleStatus: { in: ["in_care", "placement_ready"] } },
    select: { id: true, name: true, animalRef: true },
  });
  if (!animal) throw new DailyCareError("animal_not_found", "That animal is not in this organization's care.");

  const rrule = buildRoutineRrule(command);
  const anchorAt = routineAnchor({ timeOfDay: command.timeOfDay, timeZone: input.timeZone, now, startDate: command.startDate });
  const until = command.forDays ? new Date(anchorAt.getTime() + command.forDays * 86_400_000) : null;
  const windowEnd = new Date(Math.max(now.getTime(), anchorAt.getTime()) + MATERIALIZATION_HORIZON_DAYS * 86_400_000);
  const title = routineTitle(command.kind, animal.name, command.instruction);

  const created = await createRecurringWorkEngagement({
    organizationId: input.organizationId,
    title,
    requestedOutcome: command.instruction?.trim() || undefined,
    subjectKindSlug: ANIMAL_SUBJECT_KIND,
    subjectRef: `${ANIMAL_SUBJECT_KIND}:${animal.id}`,
    rrule,
    timezone: input.timeZone,
    anchorAt,
    until,
    windowStart: anchorAt,
    windowEnd: until && until < windowEnd ? until : windowEnd,
    maxOccurrences: 400,
  });
  await recordWorkEngagementActivity({
    engagementId: created.parentId,
    kind: ROUTINE_ACTIVITY_KIND,
    summary: `${KIND_LABEL[command.kind]} routine established for ${animal.name}`,
    payload: {
      kind: command.kind,
      instruction: command.instruction?.trim() || null,
      timeOfDay: command.timeOfDay,
      frequency: command.frequency,
      weekdays: command.weekdays ?? [],
      forDays: command.forDays ?? null,
      animalProfileId: animal.id,
      animalRef: animal.animalRef,
    },
    actor: { userId: input.actor.userId },
  });
  return { routineId: created.parentId, instances: created.instances, title };
}

/** Keep every active routine materialised over the horizon; safe to run often. */
export async function topUpCareRoutines(input: { organizationId: string; now?: Date }): Promise<{ routines: number; created: number }> {
  const now = input.now ?? new Date();
  const parents = await prisma.workEngagement.findMany({
    where: {
      organizationId: input.organizationId,
      subjectKindSlug: ANIMAL_SUBJECT_KIND,
      parentWorkEngagementId: null,
      recurrenceScheduleId: { not: null },
      status: { in: ["planned", "in-progress"] },
    },
    select: { id: true },
    take: 500,
  });
  let created = 0;
  for (const parent of parents) {
    const result = await materializeRecurringInstances({
      parentId: parent.id,
      windowStart: now,
      windowEnd: new Date(now.getTime() + MATERIALIZATION_HORIZON_DAYS * 86_400_000),
      maxOccurrences: 400,
    });
    if ("created" in result) created += result.created;
  }
  return { routines: parents.length, created };
}

export async function recordCareRound(input: {
  organizationId: string;
  actor: CareActor;
  command: { roundId: string; outcome: CareRoundOutcome; observation?: string | null };
  now?: Date;
}): Promise<{ roundId: string; outcome: CareRoundOutcome; escalationId: string | null }> {
  const now = input.now ?? new Date();
  const { command } = input;
  if (!CARE_ROUND_OUTCOMES.includes(command.outcome)) throw new DailyCareError("invalid_input", "Choose what happened on the round.");
  const observation = command.observation?.trim() || null;
  if (EXCEPTION_OUTCOMES.has(command.outcome) && !observation) {
    throw new DailyCareError("invalid_input", "Describe what you observed so the person who follows up knows what to look for.");
  }
  const round = await prisma.workEngagement.findFirst({
    where: { id: command.roundId, organizationId: input.organizationId, subjectKindSlug: ANIMAL_SUBJECT_KIND, parentWorkEngagementId: { not: null } },
    select: { id: true, title: true, status: true, subjectRef: true, dueAt: true, parent: { select: { activities: { where: { kind: ROUTINE_ACTIVITY_KIND }, select: { payload: true }, take: 1 } } } },
  });
  if (!round) throw new DailyCareError("round_not_found", "That care round is not on this organization's list.");
  if (round.status === "completed" || round.status === "cancelled") {
    throw new DailyCareError("already_recorded", "This round has already been recorded.");
  }
  const routine = (round.parent?.activities[0]?.payload ?? {}) as { kind?: CareRoutineKind; animalProfileId?: string; animalRef?: string };

  if (round.status === "planned") {
    const moved = await transitionWorkEngagement({ engagementId: round.id, to: "in-progress", actor: { userId: input.actor.userId }, summary: "Round started" });
    if ("error" in moved) throw new DailyCareError("invalid_input", moved.message);
  }
  await recordWorkEngagementActivity({
    engagementId: round.id,
    kind: ROUND_ACTIVITY_KIND,
    summary: `${command.outcome}${observation ? `: ${observation}` : ""}`,
    payload: { outcome: command.outcome, observation, recordedAt: now.toISOString(), late: round.dueAt ? round.dueAt.getTime() < now.getTime() : false },
    actor: { userId: input.actor.userId },
  });
  const done = await transitionWorkEngagement({ engagementId: round.id, to: "completed", actor: { userId: input.actor.userId }, summary: `Round recorded as ${command.outcome}` });
  if ("error" in done) throw new DailyCareError("invalid_input", done.message);

  let escalationId: string | null = null;
  if (EXCEPTION_OUTCOMES.has(command.outcome)) {
    escalationId = await raiseCareEscalation({
      organizationId: input.organizationId,
      actor: input.actor,
      subjectRef: round.subjectRef!,
      sourceRoundId: round.id,
      title: `Welfare follow-up: ${round.title}`,
      reason: `${command.outcome}: ${observation}`,
      now,
      routineKind: routine.kind ?? null,
    });
  }
  return { roundId: round.id, outcome: command.outcome, escalationId };
}

async function raiseCareEscalation(input: {
  organizationId: string;
  actor: CareActor;
  subjectRef: string;
  sourceRoundId: string;
  title: string;
  reason: string;
  now: Date;
  routineKind: CareRoutineKind | null;
}): Promise<string> {
  const escalation = await prisma.workEngagement.create({
    data: {
      organizationId: input.organizationId,
      title: input.title,
      requestedOutcome: input.reason,
      subjectKindSlug: ANIMAL_SUBJECT_KIND,
      subjectRef: input.subjectRef,
      dueAt: input.now,
      status: "planned",
    },
    select: { id: true },
  });
  await recordWorkEngagementActivity({
    engagementId: escalation.id,
    kind: ESCALATION_ACTIVITY_KIND,
    summary: input.reason,
    payload: { sourceRoundId: input.sourceRoundId, routineKind: input.routineKind, requiresHumanAcknowledgement: true },
    actor: { userId: input.actor.userId },
  });
  await recordWorkEngagementActivity({
    engagementId: input.sourceRoundId,
    kind: ESCALATION_ACTIVITY_KIND,
    summary: `Escalated as ${escalation.id}`,
    payload: { escalationId: escalation.id },
    actor: { userId: input.actor.userId },
  });
  return escalation.id;
}

/**
 * A planned medication round past its grace window is a welfare incident, not
 * a skipped chore: each one is escalated exactly once as urgent work.
 */
export async function escalateMissedMedication(input: { organizationId: string; actor: CareActor; now?: Date }): Promise<{ escalated: number }> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - MISSED_MEDICATION_GRACE_MINUTES * 60_000);
  const rounds = await prisma.workEngagement.findMany({
    where: {
      organizationId: input.organizationId,
      subjectKindSlug: ANIMAL_SUBJECT_KIND,
      parentWorkEngagementId: { not: null },
      status: "planned",
      dueAt: { lt: cutoff },
      activities: { none: { kind: ESCALATION_ACTIVITY_KIND } },
      parent: { activities: { some: { kind: ROUTINE_ACTIVITY_KIND, payload: { path: ["kind"], equals: "medication" } } } },
    },
    select: { id: true, title: true, subjectRef: true, dueAt: true },
    take: 100,
  });
  for (const round of rounds) {
    await raiseCareEscalation({
      organizationId: input.organizationId,
      actor: input.actor,
      subjectRef: round.subjectRef!,
      sourceRoundId: round.id,
      title: `Missed medication: ${round.title}`,
      reason: `Medication due ${round.dueAt?.toISOString() ?? "earlier"} was not recorded within ${MISSED_MEDICATION_GRACE_MINUTES} minutes.`,
      now,
      routineKind: "medication",
    });
  }
  return { escalated: rounds.length };
}

// ─── Board projection ───────────────────────────────────────────────────────




export const CARE_BOARD_LIMIT = 100;

export async function loadDailyCareBoard(input: {
  organizationId: string;
  dayStart: Date;
  dayEnd: Date;
  now?: Date;
}): Promise<DailyCareBoard> {
  const now = input.now ?? new Date();
  const [rounds, escalations, animals] = await Promise.all([
    prisma.workEngagement.findMany({
      where: {
        organizationId: input.organizationId,
        subjectKindSlug: ANIMAL_SUBJECT_KIND,
        parentWorkEngagementId: { not: null },
        status: { in: ["planned", "in-progress"] },
        dueAt: { lt: input.dayEnd },
      },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: CARE_BOARD_LIMIT,
      select: {
        id: true, title: true, status: true, subjectRef: true, dueAt: true,
        parent: { select: { activities: { where: { kind: ROUTINE_ACTIVITY_KIND }, select: { payload: true }, take: 1 } } },
      },
    }),
    prisma.workEngagement.findMany({
      where: {
        organizationId: input.organizationId,
        subjectKindSlug: ANIMAL_SUBJECT_KIND,
        parentWorkEngagementId: null,
        recurrenceScheduleId: null,
        status: { in: ["planned", "in-progress"] },
        activities: { some: { kind: ESCALATION_ACTIVITY_KIND } },
      },
      orderBy: [{ dueAt: "asc" }],
      take: 50,
      select: { id: true, title: true, requestedOutcome: true, subjectRef: true, dueAt: true, createdAt: true },
    }),
    prisma.animalProfile.findMany({
      where: { organizationId: input.organizationId, lifecycleStatus: { in: ["in_care", "placement_ready"] } },
      orderBy: [{ name: "asc" }],
      take: 200,
      select: { id: true, name: true, animalRef: true },
    }),
  ]);
  const byId = new Map(animals.map((a) => [a.id, a]));
  const nameFor = (subjectRef: string | null) => {
    const id = subjectRef?.startsWith(`${ANIMAL_SUBJECT_KIND}:`) ? subjectRef.slice(ANIMAL_SUBJECT_KIND.length + 1) : null;
    return { id, animal: id ? byId.get(id) ?? null : null };
  };
  return {
    rounds: rounds.map((row) => {
      const routine = (row.parent?.activities[0]?.payload ?? {}) as { kind?: CareRoutineKind; instruction?: string | null };
      const { id, animal } = nameFor(row.subjectRef);
      const kind = routine.kind ?? null;
      return {
        id: row.id,
        title: row.title,
        kind,
        instruction: routine.instruction ?? null,
        animalProfileId: id,
        animalName: animal?.name ?? "Unknown animal",
        animalRef: animal?.animalRef ?? null,
        dueAt: (row.dueAt ?? now).toISOString(),
        status: row.status,
        overdue: row.dueAt != null && row.dueAt.getTime() < now.getTime(),
        medicationOverdue: kind != null && isMedicationOverdue({ kind, status: row.status, dueAt: row.dueAt }, now),
      };
    }),
    escalations: escalations.map((row) => ({
      id: row.id,
      title: row.title,
      reason: row.requestedOutcome ?? null,
      animalName: nameFor(row.subjectRef).animal?.name ?? "Unknown animal",
      raisedAt: (row.dueAt ?? row.createdAt).toISOString(),
    })),
    animals: animals.map((a) => ({ animalProfileId: a.id, name: a.name, animalRef: a.animalRef })),
    limit: CARE_BOARD_LIMIT,
  };
}

/** Acknowledge an escalation: a person has seen it and taken it on. */
export async function acknowledgeCareEscalation(input: {
  organizationId: string;
  actor: CareActor;
  command: { escalationId: string; note: string };
}): Promise<{ escalationId: string }> {
  if (!input.command.note.trim()) throw new DailyCareError("invalid_input", "Say what was done or decided.");
  const escalation = await prisma.workEngagement.findFirst({
    where: { id: input.command.escalationId, organizationId: input.organizationId, subjectKindSlug: ANIMAL_SUBJECT_KIND, activities: { some: { kind: ESCALATION_ACTIVITY_KIND } } },
    select: { id: true, status: true },
  });
  if (!escalation) throw new DailyCareError("round_not_found", "That follow-up is not on this organization's list.");
  if (escalation.status === "planned") {
    const moved = await transitionWorkEngagement({ engagementId: escalation.id, to: "in-progress", actor: { userId: input.actor.userId }, summary: "Follow-up taken on" });
    if ("error" in moved) throw new DailyCareError("invalid_input", moved.message);
  }
  await recordWorkEngagementActivity({ engagementId: escalation.id, kind: "acknowledged", summary: input.command.note.trim(), payload: { acknowledgedBy: input.actor.principalRef }, actor: { userId: input.actor.userId } });
  const done = await transitionWorkEngagement({ engagementId: escalation.id, to: "completed", actor: { userId: input.actor.userId }, summary: "Follow-up resolved" });
  if ("error" in done) throw new DailyCareError("invalid_input", done.message);
  return { escalationId: escalation.id };
}
