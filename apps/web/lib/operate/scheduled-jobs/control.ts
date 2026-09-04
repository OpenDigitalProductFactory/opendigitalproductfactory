// EP-SCHEDULING-SURFACE — operator control over the scheduled-work register.
//
// The predecessor (core.ts) wrote every mutation to the ScheduledJob table, no
// matter what actually ran the work. For agent-backed rows that table is a
// mirror the dispatcher never reads, so "Disable" on a proactive coworker task
// updated a row nobody consults and the task kept running. Every mutation here
// writes to the AUTHORITATIVE substrate first and syncs the mirror second.
//
// It also widens what an operator can do, because the old surface could only
// pick one of eight named cadences:
//   - a cron expression is a first-class cadence, not an unsupported value;
//   - run-now works for agent tasks (re-arm the due time — the every-5-minute
//     dispatcher picks it up), not just for crons with a registered event;
//   - spent one-shots and slot-locks can be retired out of the register.

import { prisma } from "@dpf/db";

import { inngest } from "@/lib/queue/inngest-client";
import { computeNextCronRun } from "@/lib/operate/cron-next-run";
import { err, ok } from "@/lib/shared/action-result";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import { getCatalogEntry } from "./catalog";
import {
  AGENT_RETUNABLE_TOKENS,
  EDITABLE_SCHEDULE_OPTIONS,
  isSupportedCron,
  isValidSchedule,
  projectNextRun,
  retuneCron,
  type MutationResult,
} from "./cadence";
import { describeSchedule, deriveKind } from "./work-model";

export * from "./cadence";

/**
 * Synchronous policy refusal from the reviewed catalog. Runs BEFORE any I/O so
 * a locked job or a bad cadence is refused without touching the database.
 */
function catalogLockRefusal(jobId: string): MutationResult | null {
  const entry = getCatalogEntry(jobId);
  if (entry?.category === "core") {
    return err(`'${jobId}' is a core-locked platform-integrity cron and cannot be modified from this surface.`);
  }
  return null;
}

/** Resolve which substrate owns a jobId. `refusal` is set when the persisted row
 *  locks it; otherwise the substrate fields are populated. */
async function resolveTarget(jobId: string): Promise<{
  refusal: MutationResult | null;
  hasAgentTask: boolean;
  agentSchedule: string | null;
}> {
  const task = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: jobId },
    select: { schedule: true },
  });
  if (!getCatalogEntry(jobId)) {
    const row = await prisma.scheduledJob.findUnique({
      where: { jobId },
      select: { locked: true, category: true },
    });
    if (row?.locked || row?.category === "core") {
      return {
        refusal: err(`'${jobId}' is locked and cannot be modified from this surface.`),
        hasAgentTask: false,
        agentSchedule: null,
      };
    }
  }
  return { refusal: null, hasAgentTask: task != null, agentSchedule: task?.schedule ?? null };
}

function auditMeta(actor: string, action: string, now: Date) {
  return { lastEditedBy: actor, lastEditedAt: now.toISOString(), lastAction: action };
}

/**
 * Retune a job's cadence. Accepts a named token or a cron expression. For an
 * agent-backed job the ScheduledAgentTask is written first — that is the record
 * the dispatcher reads — and the ScheduledJob mirror is brought back in step,
 * which is what stops the two copies drifting apart again.
 */
export async function updateWorkSchedule(
  jobId: string,
  schedule: string,
  actor: string,
): Promise<MutationResult> {
  const refusal = catalogLockRefusal(jobId);
  if (refusal) return refusal;

  if (!isValidSchedule(schedule)) {
    return err(`Invalid schedule '${schedule}'. Use a named cadence (${EDITABLE_SCHEDULE_OPTIONS.join(", ")}) or a 5-field cron expression.`);
  }
  if (deriveKind(schedule) === "one-shot") {
    return err(`'${schedule}' pins a single calendar date, so the job would fire once and never again. Schedule one-off work as a manual run instead.`);
  }

  const target = await resolveTarget(jobId);
  if (target.refusal) return target.refusal;

  const now = new Date();
  const entry = getCatalogEntry(jobId);

  // ── Agent-backed: the ScheduledAgentTask is authoritative and cron-only. ──
  if (target.hasAgentTask) {
    const current = target.agentSchedule ?? "0 9 * * *";
    let agentCron: string | null = null;

    if (schedule === "disabled") {
      agentCron = current; // keep the cadence so re-enabling restores it
    } else if (isSupportedCron(schedule)) {
      agentCron = schedule;
    } else if ((AGENT_RETUNABLE_TOKENS as readonly string[]).includes(schedule)) {
      agentCron = retuneCron(current, schedule);
    } else {
      return err(`'${describeSchedule(schedule)}' is sub-daily, and the agent dispatcher can only schedule agent work daily or slower. Pick daily, weekly or monthly, or give an explicit cron expression.`);
    }
    if (!agentCron) {
      return err(`Could not translate '${schedule}' into a cadence for an agent task.`);
    }

    const active = schedule !== "disabled";
    const nextRunAt = active ? computeNextCronRun(agentCron, now) : null;
    await prisma.scheduledAgentTask.update({
      where: { taskId: jobId },
      data: { schedule: agentCron, isActive: active, nextRunAt },
    });
    await prisma.scheduledJob
      .upsert({
        where: { jobId },
        create: {
          jobId,
          name: entry?.name ?? jobId,
          schedule: agentCron,
          nextRunAt,
          enabled: active,
          metadata: auditMeta(actor, "update-schedule", now),
        },
        update: {
          schedule: agentCron,
          nextRunAt,
          enabled: active,
          metadata: auditMeta(actor, "update-schedule", now),
        },
      })
      .catch(() => {});

    return ok(
      active
        ? `'${jobId}' set to ${describeSchedule(agentCron)} — next run ${nextRunAt?.toISOString()}.`
        : `'${jobId}' disabled; its ${describeSchedule(agentCron)} cadence is kept for when you re-enable it.`,
    );
  }

  // ── Cron-backed or unregistered: the ScheduledJob row is the record. ──
  const nextRunAt = projectNextRun(schedule, now);
  await prisma.scheduledJob.upsert({
    where: { jobId },
    create: {
      jobId,
      name: entry?.name ?? jobId,
      schedule,
      nextRunAt,
      category: entry?.category ?? "editable",
      locked: false,
      enabled: schedule !== "disabled",
      metadata: auditMeta(actor, "update-schedule", now),
    },
    update: {
      schedule,
      nextRunAt,
      enabled: schedule !== "disabled",
      metadata: auditMeta(actor, "update-schedule", now),
    },
  });

  return ok(
    `'${jobId}' set to ${describeSchedule(schedule)}${
      nextRunAt ? ` — next run ${nextRunAt.toISOString()}.` : " — it will not fire again until re-enabled."
    }`,
  );
}

/**
 * Per-job kill switch. Writes `isActive` on the agent task (load-bearing for the
 * dispatcher) as well as `enabled` on the ScheduledJob row (load-bearing for
 * crons that gate on `isJobEnabled`).
 */
export async function setWorkEnabled(
  jobId: string,
  enabled: boolean,
  actor: string,
): Promise<MutationResult> {
  const refusal = catalogLockRefusal(jobId);
  if (refusal) return refusal;

  const target = await resolveTarget(jobId);
  if (target.refusal) return target.refusal;

  const now = new Date();
  const entry = getCatalogEntry(jobId);

  if (target.hasAgentTask) {
    const schedule = target.agentSchedule ?? "daily";
    const nextRunAt = enabled ? projectNextRun(schedule, now) : null;
    await prisma.scheduledAgentTask.update({
      where: { taskId: jobId },
      data: { isActive: enabled, nextRunAt },
    });
    await prisma.scheduledJob
      .upsert({
        where: { jobId },
        create: {
          jobId,
          name: entry?.name ?? jobId,
          schedule,
          enabled,
          nextRunAt,
          metadata: auditMeta(actor, enabled ? "enable" : "disable", now),
        },
        update: { enabled, nextRunAt, metadata: auditMeta(actor, enabled ? "enable" : "disable", now) },
      })
      .catch(() => {});
    return ok(`'${jobId}' ${enabled ? "enabled" : "disabled"}.`);
  }

  const existing = await prisma.scheduledJob.findUnique({
    where: { jobId },
    select: { schedule: true },
  });
  const schedule = existing?.schedule ?? entry?.cron ?? "disabled";
  const nextRunAt = enabled ? projectNextRun(schedule, now) : null;

  await prisma.scheduledJob.upsert({
    where: { jobId },
    create: {
      jobId,
      name: entry?.name ?? jobId,
      schedule,
      enabled,
      nextRunAt,
      category: entry?.category ?? "editable",
      locked: false,
      metadata: auditMeta(actor, enabled ? "enable" : "disable", now),
    },
    update: { enabled, nextRunAt, metadata: auditMeta(actor, enabled ? "enable" : "disable", now) },
  });

  return ok(`'${jobId}' ${enabled ? "enabled" : "disabled"}.`);
}

/**
 * Run a job once, now.
 *
 * Two mechanisms, because there are two substrates: a cron dispatches its
 * registered manual-trigger event; an agent task re-arms its due time and the
 * every-5-minute agent-task-dispatch cron picks it up on the next tick. The
 * old surface only knew the first, which is why most of the live register had
 * no way to be invoked by hand at all.
 */
export async function runWorkNow(jobId: string, actor: string): Promise<MutationResult> {
  const task = await prisma.scheduledAgentTask.findUnique({
    where: { taskId: jobId },
    select: { agentId: true, title: true },
  });

  if (task) {
    const now = new Date();
    await prisma.scheduledAgentTask.update({
      where: { taskId: jobId },
      data: { isActive: true, nextRunAt: now, attempts: 0 },
    });
    await prisma.scheduledJob
      .updateMany({ where: { jobId }, data: { nextRunAt: now } })
      .catch(() => {});
    return ok(`Queued '${task.title}' for ${task.agentId}. The dispatcher picks it up within 5 minutes; triggered by ${actor}.`);
  }

  const entry = getCatalogEntry(jobId);
  if (!entry?.runNowEvent) {
    return err(`'${jobId}' has no manual-trigger event and no agent task behind it, so it can only run on its schedule.`);
  }
  try {
    const result = await inngest.send({
      name: entry.runNowEvent,
      data: { reason: "manual", triggeredBy: actor },
    });
    return ok(`Dispatched ${entry.runNowEvent} for '${jobId}' (event ${result.ids.join(", ")}).`);
  } catch (caught) {
    return err(getErrorMessage(caught));
  }
}

/**
 * Clear a spent one-shot or slot-lock out of the register.
 *
 * Deliberately non-destructive: the row is disabled and stamped retired rather
 * than deleted, because the eval slot-lock rows are a live GPU mutex
 * (`claimEvalSlot` keys on their lastRunAt) and deleting one would drop the
 * claim. Retiring only removes it from the operator's register view.
 */
export async function retireWork(jobId: string, actor: string): Promise<MutationResult> {
  const [row, task] = await Promise.all([
    prisma.scheduledJob.findUnique({ where: { jobId }, select: { schedule: true, metadata: true } }),
    prisma.scheduledAgentTask.findUnique({ where: { taskId: jobId }, select: { schedule: true, isActive: true } }),
  ]);
  if (!row && !task) return err(`No register entry for '${jobId}'.`);

  const schedule = task?.schedule ?? row?.schedule ?? "";
  if (deriveKind(schedule) === "recurring") {
    return err(`'${jobId}' is a recurring job (${describeSchedule(schedule)}). Disable it instead of retiring it — retiring is for spent one-off work.`);
  }

  const now = new Date();
  const base = row?.metadata && typeof row.metadata === "object" ? { ...(row.metadata as Record<string, unknown>) } : {};

  if (task) {
    await prisma.scheduledAgentTask.update({
      where: { taskId: jobId },
      data: { isActive: false, nextRunAt: null },
    });
  }
  if (row) {
    await prisma.scheduledJob.update({
      where: { jobId },
      data: {
        enabled: false,
        nextRunAt: null,
        metadata: { ...base, retiredAt: now.toISOString(), retiredBy: actor },
      },
    });
  }
  return ok(`Retired '${jobId}' from the register.`);
}

/** Bulk retire — the register accumulates one spent one-shot per day, so
 *  clearing them one click at a time is not an operation. */
export async function retireAllSpent(
  jobIds: readonly string[],
  actor: string,
): Promise<MutationResult> {
  const results = await Promise.all(jobIds.map((id) => retireWork(id, actor)));
  const retired = results.filter((r) => r.ok).length;
  const refused = results.length - retired;
  if (retired === 0) {
    return err(
      `Nothing retired${refused ? ` — ${refused} entr${refused === 1 ? "y" : "ies"} refused.` : "."}`,
    );
  }
  return ok(
    `Retired ${retired} spent entr${retired === 1 ? "y" : "ies"}${refused ? `; ${refused} refused.` : "."}`,
  );
}
