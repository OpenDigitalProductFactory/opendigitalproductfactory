// apps/web/lib/actions/reviews.ts
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import * as crypto from "crypto";

// ─── Review Cycle Management ─────────────────────────────────────────────────

export async function createReviewCycle(input: {
  name: string;
  cadence: "quarterly" | "semi_annual" | "annual";
  periodStart: string;
  periodEnd: string;
}): Promise<{ success: boolean; cycleId?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const cycleId = `RC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.reviewCycle.create({
    data: {
      cycleId,
      name: input.name,
      cadence: input.cadence,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      status: "draft",
    },
  });

  revalidatePath("/employee");
  return { success: true, cycleId };
}

export async function activateReviewCycle(
  cycleId: string,
): Promise<{ success: boolean; instancesCreated?: number; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const cycle = await prisma.reviewCycle.findUnique({ where: { cycleId } });
  if (!cycle) return { success: false, error: "Cycle not found" };
  if (cycle.status !== "draft") return { success: false, error: "Cycle is not in draft status" };

  // Find all active employees with managers
  const employees = await prisma.employeeProfile.findMany({
    where: { status: "active", managerEmployeeId: { not: null } },
    select: { id: true, managerEmployeeId: true },
  });

  // Create review instances for each employee
  const instances = employees.map((e) => ({
    reviewId: `RV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    cycleId: cycle.id,
    employeeProfileId: e.id,
    reviewerEmployeeId: e.managerEmployeeId!,
    status: "pending",
  }));

  await prisma.$transaction([
    prisma.reviewCycle.update({
      where: { cycleId },
      data: { status: "active" },
    }),
    prisma.reviewInstance.createMany({ data: instances }),
  ]);

  revalidatePath("/employee");
  return { success: true, instancesCreated: instances.length };
}

export async function completeReviewCycle(
  cycleId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  await prisma.reviewCycle.update({
    where: { cycleId },
    data: { status: "completed" },
  });

  revalidatePath("/employee");
  return { success: true };
}

// ─── Review Instance Actions ─────────────────────────────────────────────────

export async function submitSelfReview(
  reviewId: string,
  narrative: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const review = await prisma.reviewInstance.findUnique({ where: { reviewId } });
  if (!review) return { success: false, error: "Review not found" };
  if (review.status !== "pending") return { success: false, error: "Review not in pending status" };

  await prisma.reviewInstance.update({
    where: { reviewId },
    data: { employeeNarrative: narrative, status: "self_review" },
  });

  revalidatePath("/employee");
  return { success: true };
}

export async function submitManagerReview(
  reviewId: string,
  narrative: string,
  overallRating: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const review = await prisma.reviewInstance.findUnique({ where: { reviewId } });
  if (!review) return { success: false, error: "Review not found" };

  await prisma.reviewInstance.update({
    where: { reviewId },
    data: {
      managerNarrative: narrative,
      overallRating,
      status: "manager_review",
    },
  });

  revalidatePath("/employee");
  return { success: true };
}

export async function finalizeReview(
  reviewId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  await prisma.reviewInstance.update({
    where: { reviewId },
    data: {
      status: "finalized",
      finalizedAt: new Date(),
      sharedAt: new Date(),
    },
  });

  revalidatePath("/employee");
  return { success: true };
}

// ─── Goals ───────────────────────────────────────────────────────────────────

export async function addReviewGoal(
  reviewId: string,
  title: string,
  description?: string,
  weight?: number,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const review = await prisma.reviewInstance.findUnique({ where: { reviewId } });
  if (!review) return { success: false, error: "Review not found" };

  await prisma.reviewGoal.create({
    data: {
      reviewInstanceId: review.id,
      title,
      description: description ?? null,
      weight: weight ?? null,
    },
  });

  revalidatePath("/employee");
  return { success: true };
}

// ─── Continuous Feedback ─────────────────────────────────────────────────────

export async function submitFeedback(input: {
  toEmployeeId: string;
  content: string;
  feedbackType: "praise" | "constructive" | "observation";
  visibility?: "private" | "shared" | "public";
}): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  // Find the sender's employee profile
  const fromProfile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!fromProfile) return { success: false, error: "Your employee profile not found" };

  const feedbackId = `FB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.feedbackNote.create({
    data: {
      feedbackId,
      fromEmployeeId: fromProfile.id,
      toEmployeeId: input.toEmployeeId,
      content: input.content,
      feedbackType: input.feedbackType,
      visibility: input.visibility ?? "private",
    },
  });

  revalidatePath("/employee");
  return { success: true };
}
