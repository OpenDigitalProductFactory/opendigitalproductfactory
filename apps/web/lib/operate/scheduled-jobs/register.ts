// EP-SCHEDULING-SURFACE — the unified scheduled-work register (data access).
//
// The model itself is pure and lives in ./work-model so the admin surface can
// project schedules client-side without pulling Prisma into the bundle. This
// module is the half that reads both scheduling substrates.

import { prisma } from "@dpf/db";

import { PROACTIVITY_FACT_CATEGORY } from "@/lib/proactivity/proactivity-override-preferences";

import { SCHEDULED_JOB_CATALOG } from "./catalog";
import { coworkerSelfTaskCadenceInfo, isCoworkerSelfTaskId } from "./coworker-self-tasks";
import {
  buildWorkView,
  parseProactivityFact,
  proactivityFactKey,
  selectRegisterIds,
  JOB_SELECT,
  TASK_SELECT,
  type AgentTaskRow,
  type JobRow,
  type ScheduledWorkView,
  type WorkProactivity,
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

  // One bounded query for every (owner, agent) pair in the register — never a
  // lookup per row. Only the current fact counts: a superseded row is a level
  // the operator has already moved off.
  const proactivityByAgent = await readProactivity(taskRows);

  const ids = selectRegisterIds(
    SCHEDULED_JOB_CATALOG.map((e) => e.jobId),
    jobRows,
    taskRows.map((t) => t.taskId),
  );

  return ids.map((id) => {
    const task = taskById.get(id);
    const key = task ? `${task.ownerUserId}::${task.taskId}` : null;
    return buildWorkView(
      id,
      jobById.get(id),
      task,
      now,
      key ? (proactivityByAgent.get(key) ?? null) : null,
    );
  });
}

/**
 * Current proactivity level per (owner, agent), plus the cadence that coworker's
 * registry entry runs at per level. Two queries total regardless of register
 * size: one for the facts, none for the cadence (it is an in-code registry).
 */
async function readProactivity(
  taskRows: readonly AgentTaskRow[],
): Promise<Map<string, WorkProactivity>> {
  const out = new Map<string, WorkProactivity>();
  if (taskRows.length === 0) return out;

  const owners = [...new Set(taskRows.map((t) => t.ownerUserId))];
  const keys = [...new Set(taskRows.map((t) => proactivityFactKey(t.agentId)))];

  const facts = await prisma.userFact.findMany({
    where: {
      userId: { in: owners },
      category: PROACTIVITY_FACT_CATEGORY,
      key: { in: keys },
      supersededAt: null,
    },
    select: { userId: true, key: true, value: true },
  });

  const byUserKey = new Map(facts.map((f) => [`${f.userId}::${f.key}`, f.value]));

  for (const task of taskRows) {
    const raw = byUserKey.get(`${task.ownerUserId}::${proactivityFactKey(task.agentId)}`);
    const parsed = raw === undefined ? null : parseProactivityFact(raw);
    if (!parsed) continue;
    // The registry cadence governs the coworker's SELF-task only. Attaching it
    // to any other task the coworker owns implies a relationship that is not
    // there: inventory-specialist is balanced (registry: weekly) while
    // discovery-taxonomy-gap-triage-daily runs daily, and that task is not
    // driven by proactivity at all.
    const info = isCoworkerSelfTaskId(task.taskId)
      ? coworkerSelfTaskCadenceInfo(task.agentId)
      : { registered: false, cadence: null };
    out.set(`${task.ownerUserId}::${task.taskId}`, {
      ...parsed,
      registeredCadence: info.registered ? info.cadence : null,
    });
  }
  return out;
}
