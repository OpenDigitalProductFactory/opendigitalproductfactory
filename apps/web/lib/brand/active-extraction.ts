import type { Prisma } from "@dpf/db";

import { TASK_IN_FLIGHT_STATES } from "@/lib/tak/task-states";

type TaskRunActivityProbe = {
  status: string;
  completedAt: Date | null;
  updatedAt: Date;
};

export const ACTIVE_BRAND_EXTRACTION_WINDOW_MS = 15 * 60 * 1000;

export function isTaskRunActivelyBlockingBrandExtraction(
  task: TaskRunActivityProbe,
): boolean {
  return TASK_IN_FLIGHT_STATES.includes(task.status as (typeof TASK_IN_FLIGHT_STATES)[number])
    && task.completedAt === null
    && task.updatedAt.getTime() >= Date.now() - ACTIVE_BRAND_EXTRACTION_WINDOW_MS;
}

export function activeBrandExtractionWhere(userId: string): Prisma.TaskRunWhereInput {
  return {
    userId,
    title: "Extract brand design system",
    status: { in: [...TASK_IN_FLIGHT_STATES] },
    completedAt: null,
    updatedAt: {
      gte: new Date(Date.now() - ACTIVE_BRAND_EXTRACTION_WINDOW_MS),
    },
  };
}
