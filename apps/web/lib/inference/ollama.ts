// apps/web/lib/ollama.ts
// Local LLM provider health and activation logic.
// Supports Docker Model Runner (built into Docker Desktop 4.40+) and any
// OpenAI-compatible local inference endpoint.

import { prisma, syncInfraCI } from "@dpf/db";
import {
  clearProviderCapacityStatus,
  recordProviderCapacityStatus,
} from "@/lib/routing/provider-capacity/store";
import { autoDiscoverAndProfile, queueUncalibratedModelEvals } from "./ai-provider-internals";
import { getOllamaBaseUrl } from "./ollama-url";
export { getOllamaBaseUrl } from "./ollama-url";

// ─── Hardware info ────────────────────────────────────────────────────────────

export interface OllamaHardwareInfo {
  gpu: string;
  vramGb: number | null;
  modelCount: number;
}

/**
 * Query available models from the OpenAI-compatible /v1/models endpoint.
 * Hardware-level VRAM info is not available from Docker Model Runner.
 */
export async function getOllamaHardwareInfo(baseUrl: string): Promise<OllamaHardwareInfo | null> {
  try {
    const url = baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const modelCount = data.data?.length ?? 0;
    // Docker Model Runner uses Docker Desktop GPU passthrough — no per-model VRAM reporting
    return { gpu: "Docker Desktop", vramGb: null, modelCount };
  } catch {
    return null;
  }
}

export function estimateMaxParameters(vramGb: number | null): string | null {
  if (vramGb == null) return null;
  const maxB = Math.floor(vramGb * 0.85);
  if (maxB < 1) return "~1B";
  return `~${maxB}B`;
}

/**
 * Enrich the local inference InfraCI node with status info.
 */
async function enrichLocalInfraCI(baseUrl: string, status: string): Promise<void> {
  try {
    const hwInfo = status === "offline" ? null : await getOllamaHardwareInfo(baseUrl);
    await syncInfraCI(
      { ciId: "CI-ollama-01", name: "Local LLM (Docker Model Runner)", ciType: "ai-inference", status },
      hwInfo ? { baseUrl, gpu: hwInfo.gpu, modelCount: hwInfo.modelCount } : undefined,
    );
  } catch {
    // Neo4j unavailable — don't crash the page
  }
}

// ─── Bundled provider health check ───────────────────────────────────────────

/** First probe: a warm runner answers /v1/models in well under a second. */
const LOCAL_PROBE_TIMEOUT_MS = 3_000;
/** Second probe: a runner that is loading a large model can take this long. */
const LOCAL_PROBE_RETRY_TIMEOUT_MS = 10_000;
/**
 * Consecutive failed checks before an ACTIVE local provider is demoted. One
 * missed probe used to demote it and nothing ever promoted it back, so a cold
 * model load or a busy host silently removed the local model from routing until
 * a human noticed (BI-A8EE127F).
 */
export const LOCAL_PROVIDER_DEMOTION_STRIKES = 2;

// Per-process strike counter. The check runs from the portal server process on
// page load, so consecutive misses within one process are the signal we want;
// a restart resetting it is harmless (the first check after boot cannot demote).
let consecutiveLocalProbeFailures = 0;

/** Test seam: forget prior probe misses. */
export function resetLocalProviderProbeState(): void {
  consecutiveLocalProbeFailures = 0;
}

/**
 * Probe the OpenAI-compatible /v1/models endpoint. A miss on the short timeout
 * is retried once on the long one so a model that is still loading reads as
 * reachable, not absent: /v1/models answers without loading a model, but the
 * runner can be busy enough during a load to exceed the short budget.
 */
async function probeLocalRunner(baseUrl: string): Promise<boolean> {
  const url = baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
  for (const timeoutMs of [LOCAL_PROBE_TIMEOUT_MS, LOCAL_PROBE_RETRY_TIMEOUT_MS]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return true;
    } catch {
      // Timeout or connection error — try the longer budget once.
    }
  }
  return false;
}

/**
 * Page-load health check for the bundled local LLM provider.
 * Uses the OpenAI-compatible /v1/models endpoint for reachability.
 */
export async function checkBundledProviders(): Promise<void> {
  const provider = await prisma.modelProvider.findFirst({
    where: { providerId: "local" },
    select: { providerId: true, status: true, baseUrl: true, endpoint: true },
  });

  if (!provider) return;

  const baseUrl = getOllamaBaseUrl(provider);
  const reachable = await probeLocalRunner(baseUrl);
  consecutiveLocalProbeFailures = reachable ? 0 : consecutiveLocalProbeFailures + 1;

  // For the bundled "local" (Docker Model Runner) provider, promote from "disabled"
  // as well as "unconfigured". This covers the case where the installer pre-pulled
  // a model before portal-up (the normal customer path) but the provider row landed
  // in "disabled" (initial seed or prior state). Once the runner is reachable and
  // models exist, it should be active by default so first experience "just works".
  // "inactive" is the state THIS check writes when the runner goes away, so a
  // reachable runner must promote it back too; otherwise one outage is permanent.
  if (
    reachable
    && (provider.status === "unconfigured" || provider.status === "disabled" || provider.status === "inactive")
  ) {
    await prisma.modelProvider.update({
      where: { providerId: "local" },
      data: { status: "active" },
    });
    if (provider.status === "inactive") {
      console.info("[local-provider] runner reachable again; promoted local from inactive to active");
      await clearProviderCapacityStatus({ providerId: "local", source: "api" });
    }

    // Discover + profile + queue the deterministic capability evals that promote
    // each model's seed prior to measured ("evaluated") scores. Without the eval
    // queue (the prior behaviour here), local models stayed on flat seed priors
    // forever and routing could not tell a strong tool-caller from a weak one.
    await autoDiscoverAndProfile("local");
    await enrichLocalInfraCI(baseUrl, "operational");
  } else if (reachable && provider.status === "active") {
    const profileCount = await prisma.modelProfile.count({ where: { providerId: "local" } });
    if (profileCount === 0) {
      await autoDiscoverAndProfile("local");
    } else {
      // Profiles exist. Re-enumerate the runner periodically so a newly-pulled or
      // swapped local model (e.g. gemma4:26B → gemma4:12B) is discovered and a
      // vanished tag retired. autoDiscoverAndProfile owns that reconciliation, but
      // the steady-state path used to skip it entirely — so once any profile
      // existed, new local models were never picked up and stale tags lingered
      // (the daily revalidation cron is the primary path, but it is not always
      // effective and page visits are far more frequent). Throttle on the freshest
      // lastSeenAt so we don't re-profile on every render. (BI-86CC0266)
      const freshest = await prisma.discoveredModel.aggregate({
        where: { providerId: "local" },
        _max: { lastSeenAt: true },
      });
      const lastSeenMs = freshest._max.lastSeenAt?.getTime() ?? 0;
      const REDISCOVER_AFTER_MS = 60 * 60 * 1000; // 1h
      if (Date.now() - lastSeenMs > REDISCOVER_AFTER_MS) {
        await autoDiscoverAndProfile("local");
      }
      // Always catch up calibration for any models still on a seed prior.
      // Self-limiting: stops once each model has an eval on record.
      await queueUncalibratedModelEvals("local");
    }
    await enrichLocalInfraCI(baseUrl, "operational");
  } else if (!reachable && provider.status === "active") {
    if (consecutiveLocalProbeFailures < LOCAL_PROVIDER_DEMOTION_STRIKES) {
      // One miss is a cold load or a busy host, not an outage. Keep routing to
      // local; the next check decides.
      console.warn(
        `[local-provider] runner missed probe ${consecutiveLocalProbeFailures}/${LOCAL_PROVIDER_DEMOTION_STRIKES}; keeping local active`,
      );
      return;
    }
    await prisma.modelProvider.update({
      where: { providerId: "local" },
      data: { status: "inactive" },
    });
    console.warn(
      `[local-provider] runner unreachable on ${consecutiveLocalProbeFailures} consecutive checks; demoted local to inactive`,
    );
    await recordProviderCapacityStatus({
      providerId: "local",
      classification: {
        state: "provider_degraded",
        action: "reconnect",
        safeSummary:
          `Local runner did not answer ${consecutiveLocalProbeFailures} consecutive health checks; `
          + "the local provider is inactive until the runner answers again.",
        confidence: "exact",
        isHumanActionRequired: false,
      },
      source: "api",
    });
    await enrichLocalInfraCI(baseUrl, "offline");
  }
}
