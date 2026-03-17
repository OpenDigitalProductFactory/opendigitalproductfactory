// apps/web/lib/onboarding-data.ts
// Cached query functions for onboarding/offboarding checklists and tasks.

import { cache } from "react";
import { prisma } from "@dpf/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ChecklistTemplateItem = {
  title: string;
  description?: string;
  assigneeRole?: string;
  required: boolean;
  dueOffsetDays?: number;
};

export type ChecklistRow = {
  id: string;
  checklistId: string;
  name: string;
  checklistType: string;
  departmentId: string | null;
  positionId: string | null;
  isDefault: boolean;
  items: ChecklistTemplateItem[];
  createdAt: string;
};

export type TaskRow = {
  id: string;
  taskId: string;
  employeeProfileId: string;
  checklistType: string;
  title: string;
  description: string | null;
  assigneeRole: string | null;
  required: boolean;
  dueDate: string | null;
  status: string;
  completedAt: string | null;
  completedById: string | null;
  createdAt: string;
};

// ─── Queries ─────────────────────────────────────────────────────────────────

export const getChecklists = cache(async (type?: string): Promise<ChecklistRow[]> => {
  const rows = await prisma.onboardingChecklist.findMany({
    ...(type ? { where: { checklistType: type } } : {}),
    orderBy: { name: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    checklistId: r.checklistId,
    name: r.name,
    checklistType: r.checklistType,
    departmentId: r.departmentId,
    positionId: r.positionId,
    isDefault: r.isDefault,
    items: r.items as ChecklistTemplateItem[],
    createdAt: r.createdAt.toISOString(),
  }));
});

export const getTasksForEmployee = cache(async (employeeProfileId: string): Promise<TaskRow[]> => {
  const rows = await prisma.onboardingTask.findMany({
    where: { employeeProfileId },
    orderBy: [{ required: "desc" }, { createdAt: "asc" }],
  });

  return rows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    employeeProfileId: r.employeeProfileId,
    checklistType: r.checklistType,
    title: r.title,
    description: r.description,
    assigneeRole: r.assigneeRole,
    required: r.required,
    dueDate: r.dueDate?.toISOString() ?? null,
    status: r.status,
    completedAt: r.completedAt?.toISOString() ?? null,
    completedById: r.completedById,
    createdAt: r.createdAt.toISOString(),
  }));
});
