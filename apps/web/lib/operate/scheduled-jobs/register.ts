// EP-SCHEDULING-SURFACE — the unified scheduled-work register (data access).
//
// The model itself is pure and lives in ./work-model so the admin surface can
// project schedules client-side without pulling Prisma into the bundle. This
// module is the half that reads both scheduling substrates.

import { prisma } from "@dpf/db";

import { SCHEDULED_JOB_CATALOG } from "./catalog";
import {
  buildWorkView,
  selectRegisterIds,
  JOB_SELECT,
  TASK_SELECT,
  type AgentTaskRow,
  type JobRow,
  type ScheduledWorkView,
} from "./work-model";

export * from "./work-model";

/**
 * The whole register, across both substrates, with quarantine debris dropped.
 *
 * Every catalog entry appears even without a row (a cron that has never run is
 * exactly what the 13-day silent outage looked like). Every agent task appears
 * even without a ScheduledJob mirror. Every unmatched row appears too, so
 * nothing is invisible — but now it is labelled for what it is.
 */
export async function listScheduledWork(now: Date = new Date()): Promise<ScheduledWorkView[]> {
  const [jobRows, taskRows] = await Promise.all([
    prisma.scheduledJob.findMany({ select: JOB_SELECT }) as Promise<JobRow[]>,
    prisma.scheduledAgentTask.findMany({ select: TASK_SELECT }) as Promise<AgentTaskRow[]>,
  ]);

  const jobById = new Map(jobRows.map((r) => [r.jobId, r]));
  const taskById = new Map(taskRows.map((t) => [t.taskId, t]));

  const ids = selectRegisterIds(
    SCHEDULED_JOB_CATALOG.map((e) => e.jobId),
    jobRows,
    taskRows.map((t) => t.taskId),
  );

  return ids.map((id) => buildWorkView(id, jobById.get(id), taskById.get(id), now));
}
