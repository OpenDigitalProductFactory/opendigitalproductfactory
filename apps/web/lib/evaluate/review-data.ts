// apps/web/lib/review-data.ts
// Cached query functions for performance reviews and feedback.

import { cache } from "react";
import { prisma } from "@dpf/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReviewCycleRow = {
  id: string;
  cycleId: string;
  name: string;
  cadence: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  instanceCount: number;
  completedCount: number;
};

export type ReviewInstanceRow = {
  id: string;
  reviewId: string;
  cycleId: string;
  cycleName: string;
  employeeName: string;
  employeeId: string;
  reviewerName: string;
  reviewerId: string;
  status: string;
  overallRating: string | null;
  finalizedAt: string | null;
  goalCount: number;
};

export type FeedbackRow = {
  id: string;
  feedbackId: string;
  fromName: string;
  toName: string;
  content: string;
  feedbackType: string;
  visibility: string;
  createdAt: string;
};

// ─── Queries ─────────────────────────────────────────────────────────────────

export const getReviewCycles = cache(async (): Promise<ReviewCycleRow[]> => {
  const cycles = await prisma.reviewCycle.findMany({
    orderBy: { periodStart: "desc" },
    include: {
      instances: { select: { status: true } },
    },
  });

  return cycles.map((c) => ({
    id: c.id,
    cycleId: c.cycleId,
    name: c.name,
    cadence: c.cadence,
    periodStart: c.periodStart.toISOString(),
    periodEnd: c.periodEnd.toISOString(),
    status: c.status,
    instanceCount: c.instances.length,
    completedCount: c.instances.filter((i) => i.status === "finalized").length,
  }));
});

export const getReviewInstancesForCycle = cache(async (cycleId: string): Promise<ReviewInstanceRow[]> => {
  const instances = await prisma.reviewInstance.findMany({
    where: { cycleId },
    orderBy: { createdAt: "asc" },
    include: {
      employeeProfile: { select: { displayName: true, employeeId: true } },
      reviewerEmployee: { select: { displayName: true, employeeId: true } },
      goals: { select: { id: true } },
      cycle: { select: { name: true } },
    },
  });

  return instances.map((r) => ({
    id: r.id,
    reviewId: r.reviewId,
    cycleId: r.cycleId,
    cycleName: r.cycle.name,
    employeeName: r.employeeProfile.displayName,
    employeeId: r.employeeProfile.employeeId,
    reviewerName: r.reviewerEmployee.displayName,
    reviewerId: r.reviewerEmployee.employeeId,
    status: r.status,
    overallRating: r.overallRating,
    finalizedAt: r.finalizedAt?.toISOString() ?? null,
    goalCount: r.goals.length,
  }));
});

export const getFeedbackForEmployee = cache(async (employeeProfileId: string): Promise<FeedbackRow[]> => {
  const notes = await prisma.feedbackNote.findMany({
    where: { toEmployeeId: employeeProfileId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      fromEmployee: { select: { displayName: true } },
      toEmployee: { select: { displayName: true } },
    },
  });

  return notes.map((n) => ({
    id: n.id,
    feedbackId: n.feedbackId,
    fromName: n.fromEmployee.displayName,
    toName: n.toEmployee.displayName,
    content: n.content,
    feedbackType: n.feedbackType,
    visibility: n.visibility,
    createdAt: n.createdAt.toISOString(),
  }));
});
