// discovery-scheduler.ts
// Timer-based infrastructure discovery. Started on portal boot via instrumentation.ts.
// Polls Prometheus targets every 60s (lightweight). Runs full discovery every 15 min.

import { executeBootstrapDiscovery, prisma } from "@dpf/db";
import { decryptSecret } from "../govern/credential-crypto";

const PROMETHEUS_POLL_INTERVAL_MS = 60_000;
const FULL_SWEEP_INTERVAL_MS = 15 * 60_000;
const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? "http://prometheus:9090";

let prometheusTimer: ReturnType<typeof setInterval> | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let knownTargetKeys = new Set<string>();
let sweepInProgress = false;

export function startDiscoveryScheduler(): void {
  if (prometheusTimer || sweepTimer) return; // already running

  console.log("[discovery-scheduler] Starting (poll=60s, sweep=15m)");

  // Prometheus target poll — lightweight, detects new/disappeared services
  prometheusTimer = setInterval(() => {
    runPrometheusTargetCheck().catch((err) =>
      console.error("[discovery-scheduler] Target check failed:", err),
    );
  }, PROMETHEUS_POLL_INTERVAL_MS);

  // Full discovery sweep — host + docker + prometheus + attribute + promote
  sweepTimer = setInterval(() => {
    runFullDiscoverySweep().catch((err) =>
      console.error("[discovery-scheduler] Sweep failed:", err),
    );
  }, FULL_SWEEP_INTERVAL_MS);

  // Run initial target check after a short delay (let services start)
  setTimeout(() => {
    runPrometheusTargetCheck().catch(() => {});
  }, 10_000);
}

export function stopDiscoveryScheduler(): void {
  if (prometheusTimer) {
    clearInterval(prometheusTimer);
    prometheusTimer = null;
  }
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  console.log("[discovery-scheduler] Stopped");
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
    if (!res.ok) return { newTargets: [] };

    const json = (await res.json()) as TargetResponse;
    const targets = json.data?.activeTargets ?? [];

    const currentKeys = new Set(
      targets
        .filter((t) => t.labels.job && t.labels.instance)
        .map((t) => `${t.labels.job}:${t.labels.instance}`),
    );

    // Detect new targets not seen before
    const newTargets: string[] = [];
    for (const key of currentKeys) {
      if (!knownTargetKeys.has(key)) {
        newTargets.push(key);
      }
    }

    // Update known set
    knownTargetKeys = currentKeys;

    // If new targets found, trigger a full sweep
    if (newTargets.length > 0 && knownTargetKeys.size > 0) {
      console.log(`[discovery-scheduler] ${newTargets.length} new target(s) detected, triggering sweep`);
      runFullDiscoverySweep().catch((err) =>
        console.error("[discovery-scheduler] Triggered sweep failed:", err),
      );
    }

    return { newTargets };
  } catch {
    return { newTargets: [] };
  }
}

export async function runFullDiscoverySweep(): Promise<void> {
  if (sweepInProgress) {
    console.warn("[discovery-scheduler] Sweep already in progress, skipping");
    return;
  }

  sweepInProgress = true;
  try {
    console.log("[discovery-scheduler] Starting full discovery sweep");
    await executeBootstrapDiscovery(prisma as never, {
      trigger: "scheduled",
      decrypt: decryptSecret,
    });
    console.log("[discovery-scheduler] Sweep complete");
  } finally {
    sweepInProgress = false;
  }
}
