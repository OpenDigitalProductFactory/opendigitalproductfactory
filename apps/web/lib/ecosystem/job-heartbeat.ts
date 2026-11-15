/**
 * Ecosystem job heartbeats (BI-6ED89EC6).
 *
 * The submission sweep and the weekly digest were catalogued as reporting run
 * data and wrote none, so the scheduled-jobs register showed them as tracked
 * while holding nothing, and a sweep halted for want of consent told nobody.
 * This is the one place an ecosystem job records what its last run did.
 *
 * The status vocabulary is the register's own: `completed`, `partial`,
 * `failed` and `not-configured`. Why a sweep stopped is a typed value
 * (`haltReason`), stored in the row's runner-owned `metadata`, never read back
 * out of the operator-facing summary: rewording or localizing that prose must
 * not silently switch off the "Needs you" item. A deliberate operator choice
 * (paused, private, a platform-development install) is recorded and never nags;
 * only `awaiting-consent` raises the item.
 */

import { ECOSYSTEM_JOB_CATALOG_ENTRIES } from "@/lib/operate/scheduled-jobs/catalog-ecosystem";
import { projectNextRun } from "@/lib/operate/scheduled-jobs/cadence";
import type { SweepHaltReason, SweepResult } from "./submission-sweep";

export const SUBMISSION_SWEEP_JOB_ID = "ecosystem-issue-submission-sweep";
export const WEEKLY_DIGEST_JOB_ID = "ecosystem-weekly-watchdog";

export interface EcosystemJobHeartbeat {
  lastStatus: "completed" | "partial" | "failed" | "not-configured";
  lastRunSummary: string;
  lastError: string | null;
  /** Why the sweep stopped before sending, when it did. Typed, so the attention
   *  source never parses prose. Absent for the digest. */
  haltReason?: SweepHaltReason | null;
}

/** The halt reason as the attention source reads it from the register row. */
export function haltReasonOf(metadata: unknown): SweepHaltReason | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as { haltReason?: unknown }).haltReason;
  return value === "paused" || value === "fork-only" || value === "awaiting-consent" || value === "not-applicable"
    ? value
    : null;
}

const HALT_SUMMARY: Record<Exclude<SweepHaltReason, "awaiting-consent">, string> = {
  paused: "Contributions are paused, so nothing was sent.",
  "fork-only": "This installation keeps everything on its own system (private), so nothing was sent.",
  "not-applicable": "This installation develops the platform and files its own work directly.",
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** What the sweep's last run means to an operator reading the register. */
export function sweepHeartbeat(result: SweepResult): EcosystemJobHeartbeat {
  if (result.halted === "awaiting-consent") {
    const waiting = result.waiting ?? null;
    const what = waiting === null
      ? "problems triaged here are"
      : waiting === 0
        ? "nothing is waiting yet, but new problems triaged here will be"
        : `${plural(waiting, "problem")} triaged here ${waiting === 1 ? "is" : "are"}`;
    return {
      lastStatus: "not-configured",
      lastRunSummary: `Upstream feedback is off, so ${what} not reaching the ecosystem.`,
      lastError: null,
      haltReason: "awaiting-consent",
    };
  }
  if (result.halted) {
    // A choice the operator already made. Recorded, never escalated.
    return {
      lastStatus: "not-configured",
      lastRunSummary: HALT_SUMMARY[result.halted],
      lastError: null,
      haltReason: result.halted,
    };
  }

  const summary = `${result.submitted} submitted, ${result.skipped} skipped, ${result.failed} failed.`;
  if (result.failed > 0) {
    return {
      // Some got through and some did not is not the same verdict as none did.
      lastStatus: result.submitted > 0 ? "partial" : "failed",
      lastRunSummary: summary,
      lastError: `${plural(result.failed, "report")} could not be submitted; see the job log.`,
      haltReason: null,
    };
  }
  return { lastStatus: "completed", lastRunSummary: summary, lastError: null, haltReason: null };
}

/**
 * The digest outcome as it crosses the durable-step boundary: plain JSON, so
 * the shape is read structurally and anything unrecognised is reported as
 * unrecognised — never as a delivery failure it may not have been.
 */
export type DigestRunOutcome =
  | {
      delivered: true;
      digest: {
        ballot: { applies: readonly unknown[] };
        alsoAffectsYou: readonly unknown[];
        dispositions: readonly unknown[];
        releases: readonly unknown[];
      };
    }
  | { delivered: false; reason: string; message: string };


/** What the weekly digest's last run means to an operator reading the register. */
export function digestHeartbeat(outcome: DigestRunOutcome): EcosystemJobHeartbeat {
  if (outcome.delivered) {
    const { digest } = outcome;
    return {
      lastStatus: "completed",
      lastRunSummary:
        `Posted: ${digest.ballot.applies.length} to vote on, ${digest.alsoAffectsYou.length} also affecting you, `
        + `${digest.dispositions.length} answered, ${digest.releases.length} releases.`,
      lastError: null,
    };
  }
  if (outcome.reason === "quiet-week") {
    return { lastStatus: "completed", lastRunSummary: "Quiet week: nothing to bring.", lastError: null };
  }
  if (outcome.reason === "no-room") {
    return { lastStatus: "not-configured", lastRunSummary: outcome.message, lastError: null };
  }
  if (outcome.reason === "delivery-failed") {
    // Built and lost is reported as lost — the counters must not suggest it arrived.
    return { lastStatus: "failed", lastRunSummary: "The digest could not be posted.", lastError: outcome.message };
  }
  // An outcome this build does not model is named as such, not asserted as a failure.
  return {
    lastStatus: "partial",
    lastRunSummary: `The digest ended with an outcome this build does not recognise (${outcome.reason}).`.slice(0, 500),
    lastError: outcome.message || null,
  };
}

export interface HeartbeatDb {
  scheduledJob: { upsert(args: unknown): Promise<unknown> };
}

/**
 * Write the heartbeat, exactly as the inbound intake job does: the catalog cron
 * is the only true schedule, so it is refreshed on every run rather than stored
 * once and left to go stale.
 */
export async function recordEcosystemJobHeartbeat(
  jobId: string,
  heartbeat: EcosystemJobHeartbeat,
  deps: { db?: HeartbeatDb; now?: Date } = {},
): Promise<void> {
  const entry = ECOSYSTEM_JOB_CATALOG_ENTRIES.find((job) => job.jobId === jobId);
  if (!entry?.cron) throw new Error(`${jobId} is not a catalogued ecosystem cron`);
  const db = deps.db ?? ((await import("@dpf/db")).prisma as unknown as HeartbeatDb);
  const now = deps.now ?? new Date();
  const schedule = entry.cron;
  const data = {
    lastRunAt: now,
    nextRunAt: projectNextRun(schedule, now),
    lastStatus: heartbeat.lastStatus,
    lastError: heartbeat.lastError ? heartbeat.lastError.slice(0, 2000) : null,
    lastRunSummary: heartbeat.lastRunSummary,
    // The row's runner-owned scratch state. Only the sweep writes it.
    ...(heartbeat.haltReason !== undefined ? { metadata: { haltReason: heartbeat.haltReason } } : {}),
  };
  await db.scheduledJob.upsert({
    where: { jobId: entry.jobId },
    create: { jobId: entry.jobId, name: entry.name, schedule, ...data },
    update: { schedule, ...data },
  });
}
