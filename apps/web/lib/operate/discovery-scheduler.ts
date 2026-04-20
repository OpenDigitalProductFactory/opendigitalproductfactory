// discovery-scheduler.ts
// Infrastructure discovery logic. Core functions called by Inngest cron functions.
// Previously used setInterval — now scheduled via Inngest durable cron (see lib/queue/functions/discovery-poll.ts).

import { executeBootstrapDiscovery, prisma } from "@dpf/db";
import { decryptSecret } from "../govern/credential-crypto";

const PROMETHEUS_POLL_INTERVAL_MS = 60 * 60_000;
const FULL_SWEEP_INTERVAL_MS = 60 * 60_000;
const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? "http://prometheus:9090";

const JOB_PROMETHEUS_POLL = "discovery-prometheus-poll";
const JOB_FULL_SWEEP      = "discovery-full-sweep";
const JOB_ISSUE_TRIAGE    = "issue-report-triage";
const ISSUE_TRIAGE_INTERVAL_MS = 15 * 60_000;

/** Upsert ScheduledJob rows so calendar-data.ts can project discovery events. */
export async function registerScheduledJobs(): Promise<void> {
  const now = new Date();
  const { registerModelDiscoveryJob } = await import("../inference/model-discovery-scheduler");
  const { registerCodeGraphScheduledJob } = await import("../integrate/code-graph-refresh");
  await Promise.all([
    prisma.scheduledJob.upsert({
      where:  { jobId: JOB_PROMETHEUS_POLL },
      create: {
        jobId: JOB_PROMETHEUS_POLL,
        name:  "Discovery: Prometheus target poll",
        schedule: "hourly",
        nextRunAt: new Date(now.getTime() + PROMETHEUS_POLL_INTERVAL_MS),
      },
      update: {
        schedule: "hourly",
        nextRunAt: new Date(now.getTime() + PROMETHEUS_POLL_INTERVAL_MS),
      },
    }),
    prisma.scheduledJob.upsert({
      where:  { jobId: JOB_FULL_SWEEP },
      create: {
        jobId: JOB_FULL_SWEEP,
        name:  "Discovery: full infrastructure sweep",
        schedule: "hourly",
        nextRunAt: new Date(now.getTime() + FULL_SWEEP_INTERVAL_MS),
      },
      update: {
        schedule: "hourly",
        nextRunAt: new Date(now.getTime() + FULL_SWEEP_INTERVAL_MS),
      },
    }),
    prisma.scheduledJob.upsert({
      where:  { jobId: JOB_ISSUE_TRIAGE },
      create: {
        jobId: JOB_ISSUE_TRIAGE,
        name:  "Quality: issue report triage",
        schedule: "every-15m",
        nextRunAt: new Date(now.getTime() + ISSUE_TRIAGE_INTERVAL_MS),
      },
      update: {
        schedule: "every-15m",
        nextRunAt: new Date(now.getTime() + ISSUE_TRIAGE_INTERVAL_MS),
      },
    }),
    registerModelDiscoveryJob(),
    registerCodeGraphScheduledJob(),
  ]);
}

const JOB_INTERVALS: Record<string, number> = {
  [JOB_PROMETHEUS_POLL]: PROMETHEUS_POLL_INTERVAL_MS,
  [JOB_FULL_SWEEP]:      FULL_SWEEP_INTERVAL_MS,
  [JOB_ISSUE_TRIAGE]:    ISSUE_TRIAGE_INTERVAL_MS,
};

/** Update a ScheduledJob after a run completes. */
export async function recordJobRun(jobId: string, status: string, error?: string): Promise<void> {
  const intervalMs = JOB_INTERVALS[jobId] ?? FULL_SWEEP_INTERVAL_MS;
  const now = new Date();
  await prisma.scheduledJob.update({
    where: { jobId },
    data: {
      lastRunAt:  now,
      lastStatus: status,
      lastError:  error ?? null,
      nextRunAt:  new Date(now.getTime() + intervalMs),
    },
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
