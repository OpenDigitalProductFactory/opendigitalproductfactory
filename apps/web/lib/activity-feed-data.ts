// apps/web/lib/activity-feed-data.ts
// Role-filtered activity feed: action items, awareness, and history.

import { cache } from "react";
import { prisma } from "@dpf/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export type FeedItem = {
  id: string;
  section: "action" | "awareness" | "history";
  icon: string;     // emoji or unicode
  title: string;
  person: string | null;
  date: string;
  status: string | null;
  statusColor: string | null;
  href: string;
};

// ─── Feed Builder ───────────────────────────────────────────────────────────

export const getActivityFeed = cache(async (
  employeeProfileId: string | null,
  isManager: boolean,
  isHR: boolean,
): Promise<FeedItem[]> => {
  const items: FeedItem[] = [];
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
  const oneWeekAhead = new Date(now.getTime() + 7 * 86400000);

  // ── ACTION ITEMS ──────────────────────────────────────────────────────────

  // Timesheets to submit (own)
  if (employeeProfileId) {
    const draftTimesheets = await prisma.timesheetPeriod.findMany({
      where: { employeeProfileId, status: "draft" },
      select: { periodId: true, weekStarting: true },
      take: 3,
    });
    for (const ts of draftTimesheets) {
      items.push({
        id: `action-ts-${ts.periodId}`,
        section: "action",
        icon: "\u23F0",
        title: "Submit your timesheet",
        person: null,
        date: ts.weekStarting.toISOString(),
        status: "draft",
        statusColor: "#fbbf24",
        href: "/employee?view=timesheets",
      });
    }
  }

  // Timesheets to approve (manager)
  if (isManager && employeeProfileId) {
    const pendingTs = await prisma.timesheetPeriod.findMany({
      where: {
        status: "submitted",
        employeeProfile: { managerEmployeeId: employeeProfileId },
      },
      include: { employeeProfile: { select: { displayName: true } } },
      take: 5,
    });
    for (const ts of pendingTs) {
      items.push({
        id: `action-ts-approve-${ts.periodId}`,
        section: "action",
        icon: "\u2705",
        title: `Approve ${ts.employeeProfile.displayName}'s timesheet`,
        person: ts.employeeProfile.displayName,
        date: ts.submittedAt?.toISOString() ?? ts.weekStarting.toISOString(),
        status: "submitted",
        statusColor: "#fbbf24",
        href: "/employee?view=timesheets",
      });
    }
  }

  // Leave requests to approve (manager)
  if (isManager && employeeProfileId) {
    const pendingLeave = await prisma.leaveRequest.findMany({
      where: {
        status: "pending",
        employeeProfile: { managerEmployeeId: employeeProfileId },
      },
      include: { employeeProfile: { select: { displayName: true } } },
      take: 5,
    });
    for (const lr of pendingLeave) {
      items.push({
        id: `action-leave-${lr.requestId}`,
        section: "action",
        icon: "\u{1F3D6}",
        title: `${lr.employeeProfile.displayName} — ${lr.leaveType} leave request`,
        person: lr.employeeProfile.displayName,
        date: lr.createdAt.toISOString(),
        status: "pending",
        statusColor: "#fbbf24",
        href: "/employee",
      });
    }
  }

  // Onboarding tasks assigned to user's role
  if (employeeProfileId) {
    const myTasks = await prisma.onboardingTask.findMany({
      where: {
        status: "pending",
        dueDate: { lte: oneWeekAhead },
      },
      include: { employeeProfile: { select: { displayName: true } } },
      take: 5,
    });
    for (const t of myTasks) {
      items.push({
        id: `action-onboard-${t.taskId}`,
        section: "action",
        icon: "\u{1F4CB}",
        title: `Onboarding: ${t.title}`,
        person: t.employeeProfile.displayName,
        date: t.dueDate?.toISOString() ?? t.createdAt.toISOString(),
        status: "due",
        statusColor: "#38bdf8",
        href: "/employee",
      });
    }
  }

  // Improvement proposals needing review (HR/admin)
  if (isHR) {
    const proposals = await prisma.improvementProposal.findMany({
      where: { status: { in: ["proposed", "reviewed"] } },
      select: { proposalId: true, title: true, createdAt: true, status: true },
      take: 3,
    });
    for (const p of proposals) {
      items.push({
        id: `action-imp-${p.proposalId}`,
        section: "action",
        icon: "\u{1F4A1}",
        title: `Review improvement: ${p.title}`,
        person: null,
        date: p.createdAt.toISOString(),
        status: p.status,
        statusColor: "#a78bfa",
        href: "/ops/improvements",
      });
    }
  }

  // ── AWARENESS ITEMS ───────────────────────────────────────────────────────

  // Leave starting this week
  const upcomingLeave = await prisma.leaveRequest.findMany({
    where: {
      status: "approved",
      startDate: { gte: now, lte: oneWeekAhead },
    },
    include: { employeeProfile: { select: { displayName: true } } },
    take: 5,
  });
  for (const lr of upcomingLeave) {
    items.push({
      id: `aware-leave-${lr.requestId}`,
      section: "awareness",
      icon: "\u{1F334}",
      title: `${lr.employeeProfile.displayName} on ${lr.leaveType} leave`,
      person: lr.employeeProfile.displayName,
      date: lr.startDate.toISOString(),
      status: `${lr.days} day${lr.days !== 1 ? "s" : ""}`,
      statusColor: "#a78bfa",
      href: "/employee",
    });
  }

  // New hires starting this week
  const newStarts = await prisma.employeeProfile.findMany({
    where: {
      startDate: { gte: now, lte: oneWeekAhead },
      status: { in: ["offer", "onboarding"] },
    },
    select: { id: true, displayName: true, startDate: true, status: true },
    take: 5,
  });
  for (const e of newStarts) {
    items.push({
      id: `aware-start-${e.id}`,
      section: "awareness",
      icon: "\u{1F44B}",
      title: `${e.displayName} starts`,
      person: e.displayName,
      date: e.startDate?.toISOString() ?? now.toISOString(),
      status: e.status,
      statusColor: "#10b981",
      href: "/employee",
    });
  }

  // Active review cycles
  const activeCycles = await prisma.reviewCycle.findMany({
    where: { status: "active" },
    select: { cycleId: true, name: true, periodEnd: true },
    take: 3,
  });
  for (const c of activeCycles) {
    items.push({
      id: `aware-review-${c.cycleId}`,
      section: "awareness",
      icon: "\u{1F4DD}",
      title: `Review cycle: ${c.name}`,
      person: null,
      date: c.periodEnd.toISOString(),
      status: "active",
      statusColor: "#38bdf8",
      href: "/employee",
    });
  }

  // Backlog items recently moved to in-progress
  const recentBacklog = await prisma.backlogItem.findMany({
    where: {
      status: "in-progress",
      updatedAt: { gte: twoWeeksAgo },
    },
    select: { itemId: true, title: true, updatedAt: true },
    take: 5,
  });
  for (const bi of recentBacklog) {
    items.push({
      id: `aware-backlog-${bi.itemId}`,
      section: "awareness",
      icon: "\u{1F6A7}",
      title: bi.title,
      person: null,
      date: bi.updatedAt.toISOString(),
      status: "in-progress",
      statusColor: "#fb923c",
      href: "/ops",
    });
  }

  // ── HISTORY ───────────────────────────────────────────────────────────────

  // Recent lifecycle events
  const recentEvents = await prisma.employmentEvent.findMany({
    where: { effectiveAt: { gte: twoWeeksAgo } },
    include: { employeeProfile: { select: { displayName: true } } },
    orderBy: { effectiveAt: "desc" },
    take: 10,
  });
  for (const ev of recentEvents) {
    items.push({
      id: `hist-event-${ev.eventId}`,
      section: "history",
      icon: "\u{1F4C5}",
      title: `${ev.employeeProfile.displayName} — ${ev.eventType.replace(/_/g, " ")}`,
      person: ev.employeeProfile.displayName,
      date: ev.effectiveAt.toISOString(),
      status: ev.eventType.replace(/_/g, " "),
      statusColor: "#8888a0",
      href: "/employee",
    });
  }

  // Recently completed backlog items
  const doneItems = await prisma.backlogItem.findMany({
    where: {
      status: "done",
      completedAt: { gte: twoWeeksAgo },
    },
    select: { itemId: true, title: true, completedAt: true },
    orderBy: { completedAt: "desc" },
    take: 5,
  });
  for (const bi of doneItems) {
    items.push({
      id: `hist-done-${bi.itemId}`,
      section: "history",
      icon: "\u2705",
      title: bi.title,
      person: null,
      date: bi.completedAt?.toISOString() ?? now.toISOString(),
      status: "done",
      statusColor: "#4ade80",
      href: "/ops",
    });
  }

  // Sort within each section by date (most recent first for history, soonest first for actions/awareness)
  return items.sort((a, b) => {
    const sectionOrder = { action: 0, awareness: 1, history: 2 };
    if (a.section !== b.section) return sectionOrder[a.section] - sectionOrder[b.section];
    if (a.section === "history") return new Date(b.date).getTime() - new Date(a.date).getTime();
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });
});
