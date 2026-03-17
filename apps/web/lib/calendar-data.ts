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
  eventType: string;      // meeting | reminder | deadline | leave | review | timesheet | onboarding | lifecycle
  color: string;
  editable: boolean;      // false for projected events
  sourceType: "native" | "projected";
  sourceId?: string;      // original record ID for projected events
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
    select: { id: true, actionKey: true, expiresAt: true },
  });
  for (const g of grants) {
    events.push({
      id: `grant-${g.id}`,
      title: `Grant expiring: ${g.actionKey}`,
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
  const [leaves, reviews, timesheets, onboarding, lifecycle] = await Promise.all([
    projectLeaveEvents(rangeStart, rangeEnd),
    projectReviewEvents(rangeStart, rangeEnd),
    projectTimesheetEvents(rangeStart, rangeEnd),
    projectOnboardingEvents(rangeStart, rangeEnd),
    projectLifecycleEvents(rangeStart, rangeEnd),
  ]);

  return [...native, ...leaves, ...reviews, ...timesheets, ...onboarding, ...lifecycle]
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
});
