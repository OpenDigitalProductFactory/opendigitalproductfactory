// discovery-scheduler.ts
// Infrastructure discovery logic. Core functions called by Inngest cron functions.
// Previously used setInterval — now scheduled via Inngest durable cron (see lib/queue/functions/discovery-poll.ts).

import { executeBootstrapDiscovery, prisma } from "@dpf/db";
import { decryptSecret } from "../govern/credential-crypto";

const PROMETHEUS_POLL_INTERVAL_MS = 60 * 60_000;
const FULL_SWEEP_INTERVAL_MS = 60 * 60_000;
const ISSUE_TRIAGE_INTERVAL_MS = 15 * 60_000;
const BACKLOG_TRIAGE_DRAIN_INTERVAL_MS = 60 * 60_000;
const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? "http://prometheus:9090";

const JOB_PROMETHEUS_POLL       = "discovery-prometheus-poll";
const JOB_FULL_SWEEP            = "discovery-full-sweep";
const JOB_ISSUE_TRIAGE          = "issue-report-triage";
const JOB_BACKLOG_TRIAGE_DRAIN  = "backlog-triage-drain";

/**
 * Single source of truth for the ScheduledJob rows this module owns.
 *
 * Both registerScheduledJobs() (startup) and recordJobRun() (after each run)
 * read from this registry, so a job can never be wired into one path but not
 * the other. That drift was the cause of the recurring P2025 log-spam: the
 * backlog-triage-drain cron called recordJobRun() for a jobId that
 * registerScheduledJobs() never upserted, so the update() hit a missing row.
 *
 * model-discovery + code-graph self-register elsewhere (own schedules), so they
 * are intentionally not listed here.
 */
type ManagedJob = { jobId: string; name: string; schedule: string; intervalMs: number };

const MANAGED_JOBS: ManagedJob[] = [
  { jobId: JOB_PROMETHEUS_POLL,      name: "Discovery: Prometheus target poll",      schedule: "hourly",     intervalMs: PROMETHEUS_POLL_INTERVAL_MS },
  { jobId: JOB_FULL_SWEEP,           name: "Discovery: full infrastructure sweep",   schedule: "hourly",     intervalMs: FULL_SWEEP_INTERVAL_MS },
  { jobId: JOB_ISSUE_TRIAGE,         name: "Quality: issue report triage",           schedule: "every-15m",  intervalMs: ISSUE_TRIAGE_INTERVAL_MS },
  { jobId: JOB_BACKLOG_TRIAGE_DRAIN, name: "Operate: backlog triage drain",          schedule: "hourly",     intervalMs: BACKLOG_TRIAGE_DRAIN_INTERVAL_MS },
];

const MANAGED_JOBS_BY_ID: Record<string, ManagedJob> = Object.fromEntries(
  MANAGED_JOBS.map((job) => [job.jobId, job]),
);

/** Upsert ScheduledJob rows so calendar-data.ts can project discovery events. */
export async function registerScheduledJobs(): Promise<void> {
  const now = new Date();
  const { registerModelDiscoveryJob } = await import("../inference/model-discovery-scheduler");
  const { registerCodeGraphScheduledJob } = await import("../integrate/code-graph-refresh");
  await Promise.all([
    ...MANAGED_JOBS.map((job) =>
      prisma.scheduledJob.upsert({
        where:  { jobId: job.jobId },
        create: {
          jobId: job.jobId,
          name:  job.name,
          schedule: job.schedule,
          nextRunAt: new Date(now.getTime() + job.intervalMs),
        },
        update: {
          schedule: job.schedule,
          nextRunAt: new Date(now.getTime() + job.intervalMs),
        },
      }),
    ),
    registerModelDiscoveryJob(),
    registerCodeGraphScheduledJob(),
  ]);
}

/**
 * Record a ScheduledJob run.
 *
 * Uses upsert (not update) so a missing registration self-heals — materializing
 * the row from the managed registry — instead of throwing P2025 and spamming
 * the logs on every run. Unknown jobIds fall back to a generic name/schedule so
 * the row still appears on the calendar rather than vanishing silently.
 */
export async function recordJobRun(jobId: string, status: string, error?: string): Promise<void> {
  const job = MANAGED_JOBS_BY_ID[jobId];
  const intervalMs = job?.intervalMs ?? FULL_SWEEP_INTERVAL_MS;
  const now = new Date();
  const runData = {
    lastRunAt:  now,
    lastStatus: status,
    lastError:  error ?? null,
    nextRunAt:  new Date(now.getTime() + intervalMs),
  };
  await prisma.scheduledJob.upsert({
    where: { jobId },
    create: {
      jobId,
      name: job?.name ?? jobId,
      schedule: job?.schedule ?? "hourly",
      ...runData,
    },
    update: runData,
  }).catch((err) => console.error(`[discovery-scheduler] Failed to update job ${jobId}:`, err));
}

type TargetResponse = {
  data?: {
    activeTargets?: Array<{
      labels: { job?: string; instance?: string };
      health: string;
    }>;
  };
};

export async function runPrometheusTargetCheck(): Promise<{ newTargets: string[] }> {
  // No Prometheus target configured on this topology (fresh/local install): the
  // hourly poll would fetch the unresolved in-cluster default and record an
  // "error"/"fetch failed" every hour, surfacing a false "Monitoring offline"
  // in the operator chrome. Record a neutral "not-configured" status and skip
  // the fetch entirely instead of alarming. (BI-63FF58D2)
  const { isPrometheusConfigured } = await import("../observability/alert-sources");
  if (!isPrometheusConfigured()) {
    await recordJobRun(JOB_PROMETHEUS_POLL, "not-configured");
    return { newTargets: [] };
  }

  try {
    const res = await fetch(`${PROMETHEUS_URL}/api/v1/targets`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) {
      await recordJobRun(JOB_PROMETHEUS_POLL, "error", `HTTP ${res.status}`);
      return { newTargets: [] };
    }

    const json = (await res.json()) as TargetResponse;
    const targets = json.data?.activeTargets ?? [];
    const currentKeys = targets
      .filter((t) => t.labels.job && t.labels.instance)
      .map((t) => `${t.labels.job}:${t.labels.instance}`);

    await recordJobRun(JOB_PROMETHEUS_POLL, "ok");
    return { newTargets: currentKeys };
  } catch (err) {
    await recordJobRun(JOB_PROMETHEUS_POLL, "error",
      err instanceof Error ? err.message : "unknown");
    return { newTargets: [] };
  }
}

export async function runFullDiscoverySweep(): Promise<void> {
  try {
    console.log("[discovery-scheduler] Starting full discovery sweep");
    await executeBootstrapDiscovery(prisma as never, {
      trigger: "scheduled",
      decrypt: decryptSecret,
    });
    console.log("[discovery-scheduler] Sweep complete");
    await recordJobRun(JOB_FULL_SWEEP, "ok");
  } catch (err) {
    await recordJobRun(JOB_FULL_SWEEP, "error",
      err instanceof Error ? err.message : "unknown");
    throw err;
  }
}
