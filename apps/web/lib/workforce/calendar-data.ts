// apps/web/lib/calendar-data.ts
// Merges native CalendarEvent records with projected platform events.

import { cache } from "react";
import { prisma } from "@dpf/db";

// ─── Unified Event Type ─────────────────────────────────────────────────────

export type CalendarEventView = {
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  category: string;      // hr | operations | platform | personal | external
  eventType: string;      // meeting | reminder | deadline | leave | review | timesheet | onboarding | lifecycle | recurring-digest
  color: string;
  editable: boolean;      // false for projected events
  sourceType: "native" | "projected";
  sourceId?: string;      // original record ID for projected events
  /** Present on recurring-digest events — how many occurrences the digest represents. */
  digestCount?: number;
  /** Present on recurring-digest events — job schedule key for client-side expansion. */
  digestSchedule?: string;
  /** Present on recurring-digest events — last recorded run status. */
  digestLastStatus?: string | null;
};

const CATEGORY_COLORS: Record<string, string> = {
  hr: "#a78bfa",
  operations: "#38bdf8",
  platform: "#fb923c",
  personal: "#4ade80",
  external: "#8888a0",
};

// ─── Projected Event Builders ───────────────────────────────────────────────

async function projectLeaveEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      status: { in: ["approved", "pending"] },
      startDate: { lte: rangeEnd },
      endDate: { gte: rangeStart },
    },
    include: { employeeProfile: { select: { displayName: true } } },
  });

  return leaves.map((l) => ({
    id: `leave-${l.id}`,
    title: `${l.employeeProfile.displayName} — ${l.leaveType} leave${l.status === "pending" ? " (pending)" : ""}`,
    start: l.startDate.toISOString(),
    end: l.endDate.toISOString(),
    allDay: true,
    category: "hr",
    eventType: "leave",
    color: l.status === "pending" ? "#fbbf24" : CATEGORY_COLORS.hr!,
    editable: false,
    sourceType: "projected",
    sourceId: l.id,
  }));
}

async function projectReviewEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const cycles = await prisma.reviewCycle.findMany({
    where: {
      status: { in: ["draft", "active"] },
      periodStart: { lte: rangeEnd },
      periodEnd: { gte: rangeStart },
    },
  });

  return cycles.map((c) => ({
    id: `review-${c.id}`,
    title: `Review: ${c.name}`,
    start: c.periodStart.toISOString(),
    end: c.periodEnd.toISOString(),
    allDay: true,
    category: "hr",
    eventType: "review",
    color: CATEGORY_COLORS.hr!,
    editable: false,
    sourceType: "projected",
    sourceId: c.id,
  }));
}

async function projectTimesheetEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const timesheets = await prisma.timesheetPeriod.findMany({
    where: {
      status: { in: ["draft", "submitted"] },
      weekStarting: { gte: rangeStart, lte: rangeEnd },
    },
    include: { employeeProfile: { select: { displayName: true } } },
  });

  return timesheets.map((t) => {
    const dueDate = new Date(t.weekStarting);
    dueDate.setDate(dueDate.getDate() + 6);
    return {
      id: `timesheet-${t.id}`,
      title: t.status === "submitted"
        ? `${t.employeeProfile.displayName} timesheet to approve`
        : "Timesheet due",
      start: dueDate.toISOString(),
      end: null,
      allDay: true,
      category: "operations",
      eventType: "timesheet",
      color: CATEGORY_COLORS.operations!,
      editable: false,
      sourceType: "projected" as const,
      sourceId: t.id,
    };
  });
}

async function projectOnboardingEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const tasks = await prisma.onboardingTask.findMany({
    where: {
      status: "pending",
      dueDate: { gte: rangeStart, lte: rangeEnd },
    },
    include: { employeeProfile: { select: { displayName: true } } },
  });

  return tasks.map((t) => ({
    id: `onboard-${t.id}`,
    title: `Onboarding: ${t.title} (${t.employeeProfile.displayName})`,
    start: t.dueDate!.toISOString(),
    end: null,
    allDay: true,
    category: "hr",
    eventType: "onboarding",
    color: "#f472b6",
    editable: false,
    sourceType: "projected",
    sourceId: t.id,
  }));
}

async function projectLifecycleEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const events: CalendarEventView[] = [];

  // Employees starting
  const starting = await prisma.employeeProfile.findMany({
    where: {
      startDate: { gte: rangeStart, lte: rangeEnd },
      status: { in: ["offer", "onboarding", "active"] },
    },
    select: { id: true, displayName: true, startDate: true },
  });
  for (const e of starting) {
    if (e.startDate) {
      events.push({
        id: `start-${e.id}`,
        title: `${e.displayName} starts`,
        start: e.startDate.toISOString(),
        end: null,
        allDay: true,
        category: "hr",
        eventType: "lifecycle",
        color: "#10b981",
        editable: false,
        sourceType: "projected",
        sourceId: e.id,
      });
    }
  }

  // Expiring delegation grants
  const grants = await prisma.delegationGrant.findMany({
    where: {
      status: "active",
      expiresAt: { gte: rangeStart, lte: rangeEnd },
    },
    select: { id: true, grantId: true, reason: true, expiresAt: true },
  });
  for (const g of grants) {
    events.push({
      id: `grant-${g.id}`,
      title: `Grant expiring: ${g.reason ?? g.grantId}`,
      start: g.expiresAt.toISOString(),
      end: null,
      allDay: true,
      category: "platform",
      eventType: "lifecycle",
      color: CATEGORY_COLORS.platform!,
      editable: false,
      sourceType: "projected",
      sourceId: g.id,
    });
  }

  return events;
}

// ─── Platform maintenance projections ───────────────────────────────────────

/** Intervals for sub-daily schedules (ms). Matches SCHEDULE_INTERVALS_MS keys. */
const HIGH_FREQ_INTERVALS: Record<string, number> = {
  "every-1m":  1 * 60_000,
  "every-5m":  5 * 60_000,
  "every-15m": 15 * 60_000,
  "every-30m": 30 * 60_000,
  hourly:      60 * 60_000,
};

const MS_PER_DAY  = 24 * 60 * 60_000;
const MS_PER_HOUR = 60 * 60_000;

/** Determine display density from the query range span. */
type Density = "month" | "week" | "day";
function densityForRange(rangeStart: Date, rangeEnd: Date): Density {
  const span = rangeEnd.getTime() - rangeStart.getTime();
  if (span <= 2 * MS_PER_DAY) return "day";     // day view (up to ~2 days)
  if (span <= 8 * MS_PER_DAY) return "week";     // week view (up to ~8 days)
  return "month";                                  // month or wider
}

/** Find the first occurrence anchor >= rangeStart for a recurring job. */
function anchorForJob(
  job: { nextRunAt: Date | null; lastRunAt: Date | null },
  intervalMs: number,
  rangeStart: Date,
): number {
  let anchor: number;
  if (job.nextRunAt) {
    anchor = job.nextRunAt.getTime();
    while (anchor > rangeStart.getTime() + intervalMs) anchor -= intervalMs;
    if (anchor < rangeStart.getTime()) anchor += intervalMs;
  } else if (job.lastRunAt) {
    anchor = job.lastRunAt.getTime() + intervalMs;
  } else {
    anchor = rangeStart.getTime();
  }
  return anchor;
}

/**
 * Projects scheduled platform jobs as calendar events with progressive
 * disclosure based on the requested date range:
 *
 * - **Month view** (>8 days): one daily-digest event per job per day.
 *   Shows run count and last status — click to drill into day view.
 *
 * - **Week view** (2–8 days): hourly summary blocks per job.
 *   Shows run count per hour — click to drill into day view.
 *
 * - **Day view** (<=2 days): individual timed events (2-min blocks).
 *   Full detail for the narrow window.
 *
 * Low-frequency jobs (daily / weekly / monthly) always render as a single
 * all-day event regardless of density.
 */
async function projectScheduledJobEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const jobs = await prisma.scheduledJob.findMany({
    where: { schedule: { not: "disabled" } },
    select: { id: true, jobId: true, name: true, schedule: true, nextRunAt: true, lastRunAt: true, lastStatus: true },
  });

  const density = densityForRange(rangeStart, rangeEnd);
  const events: CalendarEventView[] = [];

  for (const job of jobs) {
    const intervalMs = HIGH_FREQ_INTERVALS[job.schedule];

    if (!intervalMs) {
      // ── Low-frequency: single all-day event if nextRunAt in range ────
      if (job.nextRunAt && job.nextRunAt >= rangeStart && job.nextRunAt <= rangeEnd) {
        events.push({
          id:         `scheduled-job-${job.jobId}`,
          title:      `Scheduled: ${job.name}`,
          start:      job.nextRunAt.toISOString(),
          end:        null,
          allDay:     true,
          category:   "platform",
          eventType:  "maintenance",
          color:      CATEGORY_COLORS.platform!,
          editable:   false,
          sourceType: "projected",
          sourceId:   job.id,
        });
      }
      continue;
    }

    // ── High-frequency job ─────────────────────────────────────────────
    const anchor = anchorForJob(job, intervalMs, rangeStart);
    const runsPerDay  = Math.floor(MS_PER_DAY / intervalMs);
    const runsPerHour = Math.max(1, Math.floor(MS_PER_HOUR / intervalMs));
    const statusLabel = job.lastStatus === "error" ? " [!]" : "";

    if (density === "month") {
      // ── Daily digest: one event per day ───────────────────────────────
      const dayStart = new Date(rangeStart);
      dayStart.setHours(0, 0, 0, 0);
      for (let d = dayStart.getTime(); d < rangeEnd.getTime(); d += MS_PER_DAY) {
        events.push({
          id:              `digest-day-${job.jobId}-${d}`,
          title:           `${job.name} -- ${runsPerDay} runs/day${statusLabel}`,
          start:           new Date(d).toISOString(),
          end:             null,
          allDay:          true,
          category:        "platform",
          eventType:       "recurring-digest",
          color:           job.lastStatus === "error" ? "#ef4444" : CATEGORY_COLORS.platform!,
          editable:        false,
          sourceType:      "projected",
          sourceId:        job.id,
          digestCount:     runsPerDay,
          digestSchedule:  job.schedule,
          digestLastStatus: job.lastStatus,
        });
      }
    } else if (density === "week") {
      // ── Hourly digest: one block per hour ─────────────────────────────
      const hourStart = new Date(rangeStart);
      hourStart.setMinutes(0, 0, 0);
      for (let h = hourStart.getTime(); h < rangeEnd.getTime(); h += MS_PER_HOUR) {
        const blockEnd = new Date(h + MS_PER_HOUR);
        events.push({
          id:              `digest-hour-${job.jobId}-${h}`,
          title:           `${job.name} (${runsPerHour}x)${statusLabel}`,
          start:           new Date(h).toISOString(),
          end:             blockEnd.toISOString(),
          allDay:          false,
          category:        "platform",
          eventType:       "recurring-digest",
          color:           job.lastStatus === "error" ? "#ef4444" : CATEGORY_COLORS.platform!,
          editable:        false,
          sourceType:      "projected",
          sourceId:        job.id,
          digestCount:     runsPerHour,
          digestSchedule:  job.schedule,
          digestLastStatus: job.lastStatus,
        });
      }
    } else {
      // ── Day view: individual timed events ─────────────────────────────
      for (let t = anchor; t <= rangeEnd.getTime(); t += intervalMs) {
        if (t < rangeStart.getTime()) continue;
        const start = new Date(t);
        const end = new Date(t + 2 * 60_000);
        events.push({
          id:         `recurring-${job.jobId}-${t}`,
          title:      job.name,
          start:      start.toISOString(),
          end:        end.toISOString(),
          allDay:     false,
          category:   "platform",
          eventType:  "maintenance",
          color:      CATEGORY_COLORS.platform!,
          editable:   false,
          sourceType: "projected",
          sourceId:   job.id,
        });
      }
    }
  }

  return events;
}

// ─── Main Query ─────────────────────────────────────────────────────────────

export const getCalendarEvents = cache(async (
  rangeStart: Date,
  rangeEnd: Date,
  employeeProfileId?: string,
): Promise<CalendarEventView[]> => {
  // Native events
  const nativeWhere: Record<string, unknown> = {
    startAt: { lte: rangeEnd },
    OR: [
      { endAt: { gte: rangeStart } },
      { endAt: null, startAt: { gte: rangeStart } },
    ],
  };

  const nativeEvents = await prisma.calendarEvent.findMany({
    where: nativeWhere,
    orderBy: { startAt: "asc" },
  });

  const native: CalendarEventView[] = nativeEvents.map((e) => ({
    id: e.eventId,
    title: e.title,
    start: e.startAt.toISOString(),
    end: e.endAt?.toISOString() ?? null,
    allDay: e.allDay,
    category: e.category,
    eventType: e.eventType,
    color: e.color ?? CATEGORY_COLORS[e.category] ?? "#8888a0",
    editable: !e.syncSource,
    sourceType: "native",
  }));

  // Projected events from platform data
  const [leaves, reviews, timesheets, onboarding, lifecycle, maintenance] = await Promise.all([
    projectLeaveEvents(rangeStart, rangeEnd),
    projectReviewEvents(rangeStart, rangeEnd),
    projectTimesheetEvents(rangeStart, rangeEnd),
    projectOnboardingEvents(rangeStart, rangeEnd),
    projectLifecycleEvents(rangeStart, rangeEnd),
    projectScheduledJobEvents(rangeStart, rangeEnd),
  ]);

  return [...native, ...leaves, ...reviews, ...timesheets, ...onboarding, ...lifecycle, ...maintenance]
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
});
