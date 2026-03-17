// apps/web/lib/actions/onboarding.ts
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import * as crypto from "crypto";

// ─── Generate tasks from checklist template ──────────────────────────────────

export async function generateOnboardingTasks(
  employeeProfileId: string,
  checklistType: "onboarding" | "offboarding",
): Promise<{ created: number; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { created: 0, error: "Unauthorized" };

  const employee = await prisma.employeeProfile.findUnique({
    where: { id: employeeProfileId },
    select: { departmentId: true, positionId: true, startDate: true },
  });
  if (!employee) return { created: 0, error: "Employee not found" };

  // Find best matching checklist: department+position > department > position > default
  const checklists = await prisma.onboardingChecklist.findMany({
    where: { checklistType },
    orderBy: { isDefault: "asc" },
  });

  let bestMatch = checklists.find(
    (c) => c.departmentId === employee.departmentId && c.positionId === employee.positionId,
  );
  if (!bestMatch) bestMatch = checklists.find((c) => c.departmentId === employee.departmentId && !c.positionId);
  if (!bestMatch) bestMatch = checklists.find((c) => !c.departmentId && c.positionId === employee.positionId);
  if (!bestMatch) bestMatch = checklists.find((c) => c.isDefault);

  if (!bestMatch) return { created: 0 };

  const items = bestMatch.items as Array<{
    title: string;
    description?: string;
    assigneeRole?: string;
    required?: boolean;
    dueOffsetDays?: number;
  }>;

  const baseDate = employee.startDate ?? new Date();

  const tasks = items.map((item) => ({
    taskId: `TSK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    employeeProfileId,
    checklistType,
    title: item.title,
    description: item.description ?? null,
    assigneeRole: item.assigneeRole ?? null,
    required: item.required !== false,
    dueDate: item.dueOffsetDays
      ? new Date(baseDate.getTime() + item.dueOffsetDays * 86400000)
      : null,
  }));

  await prisma.onboardingTask.createMany({ data: tasks });

  revalidatePath("/employee");
  return { created: tasks.length };
}

// ─── Complete a task ─────────────────────────────────────────────────────────

export async function completeOnboardingTask(
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const task = await prisma.onboardingTask.findUnique({ where: { taskId } });
  if (!task) return { success: false, error: "Task not found" };
  if (task.status === "completed") return { success: true };

  await prisma.onboardingTask.update({
    where: { taskId },
    data: {
      status: "completed",
      completedAt: new Date(),
      completedById: session.user.id,
    },
  });

  revalidatePath("/employee");
  return { success: true };
}

// ─── Skip a task ─────────────────────────────────────────────────────────────

export async function skipOnboardingTask(
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const task = await prisma.onboardingTask.findUnique({ where: { taskId } });
  if (!task) return { success: false, error: "Task not found" };
  if (task.required) return { success: false, error: "Cannot skip a required task" };

  await prisma.onboardingTask.update({
    where: { taskId },
    data: { status: "skipped" },
  });

  revalidatePath("/employee");
  return { success: true };
}

// ─── Manage checklist templates ──────────────────────────────────────────────

export async function createChecklist(input: {
  name: string;
  checklistType: "onboarding" | "offboarding";
  departmentId?: string;
  positionId?: string;
  isDefault?: boolean;
  items: Array<{
    title: string;
    description?: string;
    assigneeRole?: string;
    required?: boolean;
    dueOffsetDays?: number;
  }>;
}): Promise<{ success: boolean; checklistId?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const checklistId = `CKL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.onboardingChecklist.create({
    data: {
      checklistId,
      name: input.name,
      checklistType: input.checklistType,
      departmentId: input.departmentId ?? null,
      positionId: input.positionId ?? null,
      isDefault: input.isDefault ?? false,
      items: input.items,
    },
  });

  revalidatePath("/employee");
  return { success: true, checklistId };
}
