// BI-5A42E572 / EP-PROACTIVE-OPS — Scheduled Jobs admin surface.
//
// Single source of truth for the scheduled-jobs surface: list (merge the
// static catalog with live ScheduledJob rows), edit schedule, enable/disable,
// and run-now. Core-locked enforcement lives HERE — both the operator server
// actions (lib/actions/scheduled-jobs.ts) and any future coworker dispatch go
// through these functions, so a core-locked job is off-limits to humans and
// coworkers alike (one rule, one place).

import { prisma } from "@dpf/db";
import {
  computeNextRunAt,
  SCHEDULE_INTERVALS_MS,
} from "@/lib/ai-provider-types";
import { inngest } from "@/lib/queue/inngest-client";
import {
  SCHEDULED_JOB_CATALOG,
  getCatalogEntry,
  type JobCategory,
} from "./catalog";
import { getErrorMessage } from "@/lib/shared/get-error-message";

/** Named cadences an operator may pick for an editable job. Mirrors the
 *  keys computeNextRunAt understands, plus "disabled" (nextRunAt = null). */
export const EDITABLE_SCHEDULE_OPTIONS: readonly string[] = [
  ...Object.keys(SCHEDULE_INTERVALS_MS),
  "disabled",
];

const SCHEDULE_LABELS: Record<string, string> = {
  "every-1m": "Every minute",
  "every-5m": "Every 5 minutes",
  "every-15m": "Every 15 minutes",
  "every-30m": "Every 30 minutes",
  hourly: "Hourly",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  disabled: "Disabled",
};

export type JobHealth = "ok" | "error" | "never";

/** Client-safe, fully-resolved row for the admin view. Dates are ISO strings
 *  so the DTO crosses the server→client boundary cleanly. */
export interface ScheduledJobView {
  jobId: string;
  name: string;
  purpose: string;
  inngestId: string | null;
  category: JobCategory;
  /** Operator may not edit schedule / toggle enable when true. */
  locked: boolean;
  enabled: boolean;
  /** Raw cadence string — a named token (editable jobs) or a cron expr. */
  schedule: string;
  /** Human cadence label. */
  cadence: string;
  /** True when this job's cadence is an editable named token (vs a
   *  code-defined cron we only display). */
  scheduleEditable: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  hasRunNow: boolean;
  inCatalog: boolean;
  health: JobHealth;
}

export type MutationResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

type ScheduledJobRow = {
  jobId: string;
  name: string;
  schedule: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  category: string;
  locked: boolean;
  enabled: boolean;
};

function humanCadence(schedule: string, fallback: string): string {
  return SCHEDULE_LABELS[schedule] ?? fallback;
}

function deriveHealth(row: ScheduledJobRow | undefined): JobHealth {
  if (!row || !row.lastRunAt) return "never";
  return row.lastStatus === "error" ? "error" : "ok";
}

/** Resolve classification: the catalog is authoritative for known jobs; rows
 *  without a catalog entry fall back to their persisted columns. */
function deriveClassification(
  jobId: string,
  row: ScheduledJobRow | undefined,
): { category: JobCategory; locked: boolean } {
  const entry = getCatalogEntry(jobId);
  if (entry) {
    return { category: entry.category, locked: entry.category === "core" };
  }
  const category: JobCategory = row?.category === "core" ? "core" : "editable";
  return { category, locked: row?.locked ?? category === "core" };
}

function toView(jobId: string, row: ScheduledJobRow | undefined): ScheduledJobView {
  const entry = getCatalogEntry(jobId);
  const { category, locked } = deriveClassification(jobId, row);
  // Display schedule: a persisted named token (set via the editor) wins over
  // the code-defined cron; otherwise show the catalog cron.
  const schedule = row?.schedule ?? entry?.cron ?? "unknown";
  const scheduleIsNamedToken = schedule in SCHEDULE_LABELS;
  const enabled = row?.enabled ?? true;
  return {
    jobId,
    name: entry?.name ?? row?.name ?? jobId,
    purpose: entry?.purpose ?? "(no catalog description — not in the code cron registry)",
    inngestId: entry?.inngestId ?? null,
    category,
    locked,
    enabled,
    schedule,
    cadence: scheduleIsNamedToken
      ? humanCadence(schedule, entry?.cadence ?? schedule)
      : entry?.cadence ?? schedule,
    // Editable iff classification allows it AND the cadence is a named token
    // (we cannot meaningfully re-tune a raw code cron from data yet — see the
    // data-driven-execution follow-up).
    scheduleEditable: !locked && (scheduleIsNamedToken || !entry),
    lastRunAt: row?.lastRunAt?.toISOString() ?? null,
    nextRunAt: row?.nextRunAt?.toISOString() ?? null,
    lastStatus: row?.lastStatus ?? null,
    lastError: row?.lastError ?? null,
    hasRunNow: entry?.runNowEvent != null,
    inCatalog: entry != null,
    health: deriveHealth(row),
  };
}

/** Merge the static catalog with live ScheduledJob rows. Every catalog entry
 *  appears (even with no row yet); any DB row not in the catalog also appears,
 *  classified from its persisted columns. */
export async function listScheduledJobs(): Promise<ScheduledJobView[]> {
  const rows = (await prisma.scheduledJob.findMany({
    select: {
      jobId: true,
      name: true,
      schedule: true,
      lastRunAt: true,
      nextRunAt: true,
      lastStatus: true,
      lastError: true,
      category: true,
      locked: true,
      enabled: true,
    },
  })) as ScheduledJobRow[];
  const rowByJobId = new Map(rows.map((r) => [r.jobId, r]));

  const views: ScheduledJobView[] = SCHEDULED_JOB_CATALOG.map((entry) =>
    toView(entry.jobId, rowByJobId.get(entry.jobId)),
  );

  // Rows present in the DB but not in the catalog (legacy / dynamically
  // registered jobs) — surface them so nothing is invisible.
  for (const row of rows) {
    if (!getCatalogEntry(row.jobId)) {
      views.push(toView(row.jobId, row));
    }
  }
  return views;
}

export async function getScheduledJob(jobId: string): Promise<ScheduledJobView | null> {
  const entry = getCatalogEntry(jobId);
  const row = (await prisma.scheduledJob.findUnique({
    where: { jobId },
    select: {
      jobId: true,
      name: true,
      schedule: true,
      lastRunAt: true,
      nextRunAt: true,
      lastStatus: true,
      lastError: true,
      category: true,
      locked: true,
      enabled: true,
    },
  })) as ScheduledJobRow | null;
  if (!entry && !row) return null;
  return toView(jobId, row ?? undefined);
}

/** Guard shared by every mutation: refuse core-locked jobs. */
function assertEditable(jobId: string): MutationResult | null {
  const { locked, category } = deriveClassification(jobId, undefined);
  if (locked) {
    return {
      ok: false,
      error: `Job '${jobId}' is ${category}-locked and cannot be modified from this surface.`,
    };
  }
  return null;
}

/**
 * Edit an editable job's schedule. Persists the named token and recomputes
 * nextRunAt. Core-locked jobs are refused. `actor` is recorded for audit.
 *
 * Note: for jobs backed by a code-defined Inngest cron, this updates the
 * reviewable ScheduledJob projection (schedule + nextRunAt); the live trigger
 * cadence remains code-defined until data-driven execution lands (a tracked
 * follow-up). The UI flags this so the operator is not misled.
 */
export async function updateJobSchedule(
  jobId: string,
  schedule: string,
  actor: string,
): Promise<MutationResult> {
  const locked = assertEditable(jobId);
  if (locked) return locked;

  if (!EDITABLE_SCHEDULE_OPTIONS.includes(schedule)) {
    return {
      ok: false,
      error: `Invalid schedule '${schedule}'. Allowed: ${EDITABLE_SCHEDULE_OPTIONS.join(", ")}.`,
    };
  }

  const entry = getCatalogEntry(jobId);
  const now = new Date();
  const nextRunAt = schedule === "disabled" ? null : computeNextRunAt(schedule, now);
  const auditMeta = { lastEditedBy: actor, lastEditedAt: now.toISOString(), lastAction: "update-schedule" };

  await prisma.scheduledJob.upsert({
    where: { jobId },
    create: {
      jobId,
      name: entry?.name ?? jobId,
      schedule,
      nextRunAt,
      category: entry?.category ?? "editable",
      locked: false,
      enabled: true,
      metadata: auditMeta,
    },
    update: { schedule, nextRunAt, metadata: auditMeta },
  });

  return {
    ok: true,
    message: `Schedule for '${jobId}' set to ${humanCadence(schedule, schedule)}${
      nextRunAt ? ` (next run ${nextRunAt.toISOString()})` : " (no next run — disabled)"
    }.`,
  };
}

/** Enable / disable an editable job. Disabling clears nextRunAt. */
export async function setJobEnabled(
  jobId: string,
  enabled: boolean,
  actor: string,
): Promise<MutationResult> {
  const locked = assertEditable(jobId);
  if (locked) return locked;

  const entry = getCatalogEntry(jobId);
  const existing = await prisma.scheduledJob.findUnique({
    where: { jobId },
    select: { schedule: true },
  });
  const schedule = existing?.schedule ?? "disabled";
  const now = new Date();
  const nextRunAt =
    enabled && schedule !== "disabled" ? computeNextRunAt(schedule, now) : null;
  const auditMeta = {
    lastEditedBy: actor,
    lastEditedAt: now.toISOString(),
    lastAction: enabled ? "enable" : "disable",
  };

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
      metadata: auditMeta,
    },
    update: { enabled, nextRunAt, metadata: auditMeta },
  });

  return { ok: true, message: `Job '${jobId}' ${enabled ? "enabled" : "disabled"}.` };
}

/**
 * Trigger a one-shot manual run via the job's Inngest event. Allowed for any
 * job that has a manual-trigger event (including core jobs) — running once is a
 * non-destructive recovery action, exactly what the motivating incident needed
 * ("the cron was off — run it now"). Returns the dispatched event id(s).
 */
export async function runJobNow(jobId: string, actor: string): Promise<MutationResult> {
  const entry = getCatalogEntry(jobId);
  if (!entry || !entry.runNowEvent) {
    return {
      ok: false,
      error: `Job '${jobId}' has no manual-trigger event; it can only run on its schedule.`,
    };
  }
  try {
    const result = await inngest.send({
      name: entry.runNowEvent,
      data: { reason: "manual", triggeredBy: actor },
    });
    return {
      ok: true,
      message: `Dispatched ${entry.runNowEvent} for '${jobId}' (event ${result.ids.join(", ")}).`,
    };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

/**
 * Runtime gate helper for scheduled functions: returns false when an operator
 * has disabled the job. Defaults to enabled when no row exists, so a job that
 * has never been touched runs normally. Wire this into a cron's entry gate to
 * make the per-job kill switch load-bearing.
 */
export async function isJobEnabled(jobId: string): Promise<boolean> {
  const row = await prisma.scheduledJob.findUnique({
    where: { jobId },
    select: { enabled: true },
  });
  return row?.enabled ?? true;
}
