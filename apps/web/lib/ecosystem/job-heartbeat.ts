/**
 * Ecosystem job heartbeats (BI-6ED89EC6).
 *
 * The submission sweep and the weekly digest were catalogued as reporting run
 * data and wrote none, so the scheduled-jobs register showed them as tracked
 * while holding nothing, and a sweep halted for want of consent told nobody.
 * This is the one place an ecosystem job records what its last run did.
 *
 * The status vocabulary is the register's own: `completed`, `partial`,
 * `failed` and `not-configured`. A deliberate operator choice (contributions
 * paused, fork-only, a platform-development install) is `not-configured`
 * WITHOUT the consent prefix, so it never nags; only a sweep halted for want of
 * consent carries the prefix the attention source looks for.
 */

import { ECOSYSTEM_JOB_CATALOG_ENTRIES } from "@/lib/operate/scheduled-jobs/catalog-ecosystem";
import { projectNextRun } from "@/lib/operate/scheduled-jobs/cadence";
import type { SweepResult } from "./submission-sweep";
import type { WatchdogOutcome } from "./watchdog-runner";

export const SUBMISSION_SWEEP_JOB_ID = "ecosystem-issue-submission-sweep";
export const WEEKLY_DIGEST_JOB_ID = "ecosystem-weekly-watchdog";

/** The summary prefix the attention source keys on — one standing item, not one per report. */
export const AWAITING_CONSENT_PREFIX = "awaiting consent:";

export interface EcosystemJobHeartbeat {
  lastStatus: "completed" | "partial" | "failed" | "not-configured";
  lastRunSummary: string;
  lastError: string | null;
}

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
      lastRunSummary: `${AWAITING_CONSENT_PREFIX} upstream feedback is off, so ${what} not reaching the ecosystem.`,
      lastError: null,
    };
  }
  if (result.halted) {
    // A choice the operator already made. Recorded, never escalated.
    const reason: Record<string, string> = {
      paused: "Contributions are paused, so nothing was sent.",
      "fork-only": "This installation keeps everything on its own system (private), so nothing was sent.",
      "not-applicable": "This installation develops the platform and files its own work directly.",
    };
    return {
      lastStatus: "not-configured",
      lastRunSummary: reason[result.halted] ?? `Not run: ${result.halted}.`,
      lastError: null,
    };
  }

  const summary = `${result.submitted} submitted, ${result.skipped} skipped, ${result.failed} failed.`;
  if (result.failed > 0) {
    return {
      // Some got through and some did not is not the same verdict as none did.
      lastStatus: result.submitted > 0 ? "partial" : "failed",
      lastRunSummary: summary,
      lastError: `${plural(result.failed, "report")} could not be submitted; see the job log.`,
    };
  }
  return { lastStatus: "completed", lastRunSummary: summary, lastError: null };
}

/** What the weekly digest's last run means to an operator reading the register. */
export function digestHeartbeat(outcome: WatchdogOutcome): EcosystemJobHeartbeat {
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
  // Built and lost is reported as lost — the counters must not suggest it arrived.
  return { lastStatus: "failed", lastRunSummary: "The digest could not be posted.", lastError: outcome.message };
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
  };
  await db.scheduledJob.upsert({
    where: { jobId: entry.jobId },
    create: { jobId: entry.jobId, name: entry.name, schedule, ...data },
    update: { schedule, ...data },
  });
}
