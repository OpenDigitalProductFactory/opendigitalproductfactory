// apps/web/lib/calendar-data.ts
// Merges native CalendarEvent records with projected platform events.

import { cache } from "react";
import { prisma } from "@dpf/db";
import type { WeeklySchedule, DaySchedule } from "@/lib/operating-hours-types";

// ─── Unified Event Type ─────────────────────────────────────────────────────

export type CalendarEventView = {
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  category: string;
  eventType: string;
  color: string;
  editable: boolean;
  sourceType: "native" | "projected";
  sourceId?: string;
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
  compliance: "#e879f9",
  finance: "#facc15",
  business: "#14b8a6",
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

// ─── Compliance / GRC projections ───────────────────────────────────────────

async function projectComplianceEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const events: CalendarEventView[] = [];

  const [incidents, actions, findings, audits, obligations, submissions] = await Promise.all([
    prisma.complianceIncident.findMany({
      where: {
        status: { in: ["open", "investigating"] },
        notificationDeadline: { gte: rangeStart, lte: rangeEnd },
      },
      select: { id: true, incidentId: true, title: true, notificationDeadline: true, severity: true },
    }),
    prisma.correctiveAction.findMany({
      where: {
        status: { in: ["open", "in-progress"] },
        dueDate: { gte: rangeStart, lte: rangeEnd },
      },
      select: { id: true, actionId: true, title: true, dueDate: true },
    }),
    prisma.auditFinding.findMany({
      where: {
        status: "open",
        dueDate: { gte: rangeStart, lte: rangeEnd },
      },
      select: { id: true, findingId: true, title: true, dueDate: true },
    }),
    prisma.complianceAudit.findMany({
      where: {
        status: "planned",
        scheduledAt: { gte: rangeStart, lte: rangeEnd },
      },
      select: { id: true, auditId: true, title: true, scheduledAt: true },
    }),
    prisma.obligation.findMany({
      where: {
        status: "active",
        reviewDate: { gte: rangeStart, lte: rangeEnd },
      },
      select: { id: true, obligationId: true, title: true, reviewDate: true },
    }),
    prisma.regulatorySubmission.findMany({
      where: {
        status: { in: ["draft", "pending"] },
        dueDate: { gte: rangeStart, lte: rangeEnd },
      },
      select: { id: true, submissionId: true, title: true, dueDate: true, recipientBody: true },
    }),
  ]);

  for (const i of incidents) {
    events.push({
      id: `incident-${i.incidentId}`,
      title: `Incident deadline: ${i.title}`,
      start: i.notificationDeadline!.toISOString(),
      end: null,
      allDay: true,
      category: "compliance",
      eventType: "compliance-deadline",
      color: i.severity === "critical" ? "#ef4444" : CATEGORY_COLORS.compliance!,
      editable: false,
      sourceType: "projected",
      sourceId: i.id,
    });
  }

  for (const a of actions) {
    events.push({
      id: `capa-${a.actionId}`,
      title: `CAPA due: ${a.title}`,
      start: a.dueDate!.toISOString(),
      end: null,
      allDay: true,
      category: "compliance",
      eventType: "compliance-deadline",
      color: CATEGORY_COLORS.compliance!,
      editable: false,
      sourceType: "projected",
      sourceId: a.id,
    });
  }

  for (const f of findings) {
    events.push({
      id: `finding-${f.findingId}`,
      title: `Finding due: ${f.title}`,
      start: f.dueDate!.toISOString(),
      end: null,
      allDay: true,
      category: "compliance",
      eventType: "compliance-deadline",
      color: CATEGORY_COLORS.compliance!,
      editable: false,
      sourceType: "projected",
      sourceId: f.id,
    });
  }

  for (const a of audits) {
    events.push({
      id: `audit-${a.auditId}`,
      title: `Audit: ${a.title}`,
      start: a.scheduledAt!.toISOString(),
      end: null,
      allDay: true,
      category: "compliance",
      eventType: "audit",
      color: CATEGORY_COLORS.compliance!,
      editable: false,
      sourceType: "projected",
      sourceId: a.id,
    });
  }

  for (const o of obligations) {
    events.push({
      id: `obligation-${o.obligationId}`,
      title: `Obligation review: ${o.title}`,
      start: o.reviewDate!.toISOString(),
      end: null,
      allDay: true,
      category: "compliance",
      eventType: "regulatory",
      color: CATEGORY_COLORS.compliance!,
      editable: false,
      sourceType: "projected",
      sourceId: o.id,
    });
  }

  for (const s of submissions) {
    events.push({
      id: `submission-${s.submissionId}`,
      title: `Submission due: ${s.title} -> ${s.recipientBody}`,
      start: s.dueDate!.toISOString(),
      end: null,
      allDay: true,
      category: "compliance",
      eventType: "regulatory",
      color: CATEGORY_COLORS.compliance!,
      editable: false,
      sourceType: "projected",
      sourceId: s.id,
    });
  }

  return events;
}

// ─── Finance projections ────────────────────────────────────────────────────

async function projectFinanceEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const events: CalendarEventView[] = [];

  const [invoices, bills, recurring] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        status: { in: ["sent", "overdue", "partially_paid"] },
        dueDate: { gte: rangeStart, lte: rangeEnd },
      },
      select: { id: true, invoiceRef: true, dueDate: true, status: true },
    }),
    prisma.bill.findMany({
      where: {
        status: { in: ["received", "approved", "partially_paid"] },
        dueDate: { gte: rangeStart, lte: rangeEnd },
      },
      select: { id: true, billRef: true, dueDate: true, status: true },
    }),
    prisma.recurringSchedule.findMany({
      where: {
        status: "active",
        nextInvoiceDate: { gte: rangeStart, lte: rangeEnd },
      },
      select: { id: true, scheduleId: true, name: true, nextInvoiceDate: true },
    }),
  ]);

  for (const inv of invoices) {
    events.push({
      id: `invoice-${inv.invoiceRef}`,
      title: `Invoice due: ${inv.invoiceRef}`,
      start: inv.dueDate.toISOString(),
      end: null,
      allDay: true,
      category: "finance",
      eventType: "invoice",
      color: inv.status === "overdue" ? "#ef4444" : CATEGORY_COLORS.finance!,
      editable: false,
      sourceType: "projected",
      sourceId: inv.id,
    });
  }

  for (const b of bills) {
    events.push({
      id: `bill-${b.billRef}`,
      title: `Bill due: ${b.billRef}`,
      start: b.dueDate.toISOString(),
      end: null,
      allDay: true,
      category: "finance",
      eventType: "bill",
      color: CATEGORY_COLORS.finance!,
      editable: false,
      sourceType: "projected",
      sourceId: b.id,
    });
  }

  for (const r of recurring) {
    events.push({
      id: `recurring-inv-${r.scheduleId}`,
      title: `Recurring: ${r.name}`,
      start: r.nextInvoiceDate.toISOString(),
      end: null,
      allDay: true,
      category: "finance",
      eventType: "recurring-invoice",
      color: CATEGORY_COLORS.finance!,
      editable: false,
      sourceType: "projected",
      sourceId: r.id,
    });
  }

  return events;
}

// ─── Change management projections ──────────────────────────────────────────

async function projectChangeManagementEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const events: CalendarEventView[] = [];

  const [changeRequests, blackouts] = await Promise.all([
    prisma.changeRequest.findMany({
      where: {
        status: { in: ["approved", "scheduled"] },
        calendarEventId: null,
        plannedStartAt: { lte: rangeEnd },
        plannedEndAt: { gte: rangeStart },
      },
      select: { id: true, rfcId: true, title: true, plannedStartAt: true, plannedEndAt: true, riskLevel: true },
    }),
    prisma.blackoutPeriod.findMany({
      where: {
        calendarEventId: null,
        startAt: { lte: rangeEnd },
        endAt: { gte: rangeStart },
      },
      select: { id: true, name: true, startAt: true, endAt: true },
    }),
  ]);

  for (const cr of changeRequests) {
    events.push({
      id: `change-${cr.rfcId}`,
      title: `Change: ${cr.title}`,
      start: cr.plannedStartAt!.toISOString(),
      end: cr.plannedEndAt?.toISOString() ?? null,
      allDay: false,
      category: "operations",
      eventType: "change-request",
      color: cr.riskLevel === "high" ? "#ef4444" : CATEGORY_COLORS.operations!,
      editable: false,
      sourceType: "projected",
      sourceId: cr.id,
    });
  }

  for (const bp of blackouts) {
    events.push({
      id: `blackout-${bp.id}`,
      title: `Blackout: ${bp.name}`,
      start: bp.startAt.toISOString(),
      end: bp.endAt.toISOString(),
      allDay: false,
      category: "operations",
      eventType: "blackout",
      color: "#ef4444",
      editable: false,
      sourceType: "projected",
      sourceId: bp.id,
    });
  }

  return events;
}

// ─── Deployment window projections ──────────────────────────────────────────

async function projectDeploymentWindowEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const windows = await prisma.deploymentWindow.findMany({
    select: { id: true, windowKey: true, name: true, dayOfWeek: true, startTime: true, endTime: true },
  });

  const events: CalendarEventView[] = [];
  const density = densityForRange(rangeStart, rangeEnd);

  for (const w of windows) {
    // Walk each day in range and check if dayOfWeek matches
    const day = new Date(rangeStart);
    day.setHours(0, 0, 0, 0);

    while (day < rangeEnd) {
      const jsDay = day.getDay(); // 0=Sun .. 6=Sat
      if (w.dayOfWeek.includes(jsDay)) {
        if (density === "month") {
          events.push({
            id: `deploy-${w.windowKey}-${day.getTime()}`,
            title: `Maintenance: ${w.name}`,
            start: new Date(day).toISOString(),
            end: null,
            allDay: true,
            category: "operations",
            eventType: "deployment-window",
            color: CATEGORY_COLORS.operations!,
            editable: false,
            sourceType: "projected",
            sourceId: w.id,
          });
        } else {
          // Week/day view: timed blocks
          const [startH, startM] = w.startTime.split(":").map(Number);
          const [endH, endM] = w.endTime.split(":").map(Number);
          const start = new Date(day);
          start.setHours(startH!, startM!, 0, 0);
          const end = new Date(day);
          end.setHours(endH!, endM!, 0, 0);

          events.push({
            id: `deploy-${w.windowKey}-${day.getTime()}`,
            title: `Maintenance: ${w.name}`,
            start: start.toISOString(),
            end: end.toISOString(),
            allDay: false,
            category: "operations",
            eventType: "deployment-window",
            color: CATEGORY_COLORS.operations!,
            editable: false,
            sourceType: "projected",
            sourceId: w.id,
          });
        }
      }
      day.setDate(day.getDate() + 1);
    }
  }

  return events;
}

// ─── Business projections (archetype-universal) ─────────────────────────────

const DAY_NAMES: (keyof WeeklySchedule)[] = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

async function projectBookingEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const bookings = await prisma.storefrontBooking.findMany({
    where: {
      status: { in: ["pending", "confirmed"] },
      scheduledAt: { gte: rangeStart, lte: rangeEnd },
    },
    select: {
      id: true, bookingRef: true, customerName: true, scheduledAt: true,
      durationMinutes: true, status: true,
    },
    orderBy: { scheduledAt: "asc" },
    take: 500,
  });

  return bookings.map((b) => {
    const end = new Date(b.scheduledAt.getTime() + b.durationMinutes * 60_000);
    return {
      id: `booking-${b.bookingRef}`,
      title: `${b.customerName}${b.status === "pending" ? " (pending)" : ""}`,
      start: b.scheduledAt.toISOString(),
      end: end.toISOString(),
      allDay: false,
      category: "business",
      eventType: "booking",
      color: b.status === "pending" ? "#fbbf24" : CATEGORY_COLORS.business!,
      editable: false,
      sourceType: "projected",
      sourceId: b.id,
    };
  });
}

async function projectCrmActivityEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const activities = await prisma.activity.findMany({
    where: {
      type: { in: ["meeting", "call", "task"] },
      scheduledAt: { gte: rangeStart, lte: rangeEnd },
      completedAt: null,
    },
    select: {
      id: true, activityId: true, type: true, subject: true, scheduledAt: true,
      account: { select: { name: true } },
    },
    take: 200,
  });

  return activities.map((a) => {
    const isTask = a.type === "task";
    const durationMs = a.type === "call" ? 30 * 60_000 : 60 * 60_000;
    const acctLabel = a.account?.name ? ` — ${a.account.name}` : "";
    return {
      id: `crm-${a.activityId}`,
      title: `${a.type === "meeting" ? "Meeting" : a.type === "call" ? "Call" : "Task"}: ${a.subject}${acctLabel}`,
      start: a.scheduledAt!.toISOString(),
      end: isTask ? null : new Date(a.scheduledAt!.getTime() + durationMs).toISOString(),
      allDay: isTask,
      category: "business",
      eventType: "crm-activity",
      color: CATEGORY_COLORS.business!,
      editable: false,
      sourceType: "projected",
      sourceId: a.id,
    };
  });
}

async function projectSalesPipelineEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const opps = await prisma.opportunity.findMany({
    where: {
      stage: { notIn: ["closed_won", "closed_lost"] },
      isDormant: false,
      expectedClose: { gte: rangeStart, lte: rangeEnd },
    },
    select: {
      id: true, opportunityId: true, title: true, probability: true,
      expectedClose: true, account: { select: { name: true } },
    },
    take: 100,
  });

  return opps.map((o) => ({
    id: `opp-${o.opportunityId}`,
    title: `Close: ${o.title} (${o.probability}%)${o.account?.name ? ` — ${o.account.name}` : ""}`,
    start: o.expectedClose!.toISOString(),
    end: null,
    allDay: true,
    category: "business",
    eventType: "pipeline-deadline",
    color: o.probability >= 75 ? "#4ade80" : CATEGORY_COLORS.business!,
    editable: false,
    sourceType: "projected",
    sourceId: o.id,
  }));
}

async function projectOperatingHoursEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const density = densityForRange(rangeStart, rangeEnd);
  if (density === "month") return []; // too noisy for month view

  const profile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    select: { id: true, businessHours: true, name: true },
  });
  if (!profile?.businessHours) return [];

  const hours = profile.businessHours as unknown as WeeklySchedule;
  const events: CalendarEventView[] = [];

  const day = new Date(rangeStart);
  day.setHours(0, 0, 0, 0);

  while (day < rangeEnd) {
    const dayName = DAY_NAMES[day.getDay()]!;
    const sched: DaySchedule | undefined = hours[dayName];
    if (sched?.enabled) {
      const [openH, openM] = sched.open.split(":").map(Number);
      const [closeH, closeM] = sched.close.split(":").map(Number);
      const start = new Date(day);
      start.setHours(openH!, openM!, 0, 0);
      const end = new Date(day);
      end.setHours(closeH!, closeM!, 0, 0);

      events.push({
        id: `hours-${day.getTime()}`,
        title: `Open ${sched.open} – ${sched.close}`,
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: false,
        category: "business",
        eventType: "operating-hours",
        color: "#14b8a620",
        editable: false,
        sourceType: "projected",
        sourceId: profile.id,
      });
    }
    day.setDate(day.getDate() + 1);
  }

  return events;
}

async function projectProviderAvailabilityEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEventView[]> {
  const density = densityForRange(rangeStart, rangeEnd);
  if (density === "month") return []; // too noisy for month view

  const slots = await prisma.providerAvailability.findMany({
    select: {
      id: true, days: true, startTime: true, endTime: true, date: true,
      isBlocked: true, reason: true,
      provider: { select: { name: true } },
    },
  });

  const events: CalendarEventView[] = [];

  for (const slot of slots) {
    if (slot.date) {
      // Date-specific override
      if (slot.date >= rangeStart && slot.date <= rangeEnd) {
        const [sH, sM] = slot.startTime.split(":").map(Number);
        const [eH, eM] = slot.endTime.split(":").map(Number);
        const start = new Date(slot.date);
        start.setHours(sH!, sM!, 0, 0);
        const end = new Date(slot.date);
        end.setHours(eH!, eM!, 0, 0);

        events.push({
          id: `avail-${slot.id}-${slot.date.getTime()}`,
          title: slot.isBlocked
            ? `${slot.provider.name} unavailable${slot.reason ? `: ${slot.reason}` : ""}`
            : `${slot.provider.name} available`,
          start: start.toISOString(),
          end: end.toISOString(),
          allDay: false,
          category: "business",
          eventType: "provider-schedule",
          color: slot.isBlocked ? "#f87171" : CATEGORY_COLORS.business!,
          editable: false,
          sourceType: "projected",
          sourceId: slot.id,
        });
      }
    } else {
      // Recurring weekly pattern
      const day = new Date(rangeStart);
      day.setHours(0, 0, 0, 0);

      while (day < rangeEnd) {
        if (slot.days.includes(day.getDay())) {
          const [sH, sM] = slot.startTime.split(":").map(Number);
          const [eH, eM] = slot.endTime.split(":").map(Number);
          const start = new Date(day);
          start.setHours(sH!, sM!, 0, 0);
          const end = new Date(day);
          end.setHours(eH!, eM!, 0, 0);

          events.push({
            id: `avail-${slot.id}-${day.getTime()}`,
            title: slot.isBlocked
              ? `${slot.provider.name} unavailable${slot.reason ? `: ${slot.reason}` : ""}`
              : `${slot.provider.name} available`,
            start: start.toISOString(),
            end: end.toISOString(),
            allDay: false,
            category: "business",
            eventType: "provider-schedule",
            color: slot.isBlocked ? "#f87171" : CATEGORY_COLORS.business!,
            editable: false,
            sourceType: "projected",
            sourceId: slot.id,
          });
        }
        day.setDate(day.getDate() + 1);
      }
    }
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
  const [
    leaves, reviews, timesheets, onboarding, lifecycle, maintenance,
    compliance, finance, changeMgmt, deployWindows,
    bookings, crmActivities, pipeline, operatingHours, providerAvail,
  ] = await Promise.all([
    projectLeaveEvents(rangeStart, rangeEnd),
    projectReviewEvents(rangeStart, rangeEnd),
    projectTimesheetEvents(rangeStart, rangeEnd),
    projectOnboardingEvents(rangeStart, rangeEnd),
    projectLifecycleEvents(rangeStart, rangeEnd),
    projectScheduledJobEvents(rangeStart, rangeEnd),
    projectComplianceEvents(rangeStart, rangeEnd),
    projectFinanceEvents(rangeStart, rangeEnd),
    projectChangeManagementEvents(rangeStart, rangeEnd),
    projectDeploymentWindowEvents(rangeStart, rangeEnd),
    projectBookingEvents(rangeStart, rangeEnd),
    projectCrmActivityEvents(rangeStart, rangeEnd),
    projectSalesPipelineEvents(rangeStart, rangeEnd),
    projectOperatingHoursEvents(rangeStart, rangeEnd),
    projectProviderAvailabilityEvents(rangeStart, rangeEnd),
  ]);

  return [
    ...native, ...leaves, ...reviews, ...timesheets, ...onboarding, ...lifecycle,
    ...maintenance, ...compliance, ...finance, ...changeMgmt, ...deployWindows,
    ...bookings, ...crmActivities, ...pipeline, ...operatingHours, ...providerAvail,
  ].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
});
