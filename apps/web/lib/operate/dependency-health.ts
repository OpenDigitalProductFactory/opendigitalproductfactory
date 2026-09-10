// Liveness probes for core dependencies that expose NO Prometheus /metrics
// endpoint, so they cannot be scrape targets and `ContainerDown` (up==0) can
// never see them: the local model runner (DMR) and STT (Speaches). Sets the
// dpf_dependency_up{service} gauge, refreshed on each /api/metrics scrape.
// Mirrors the TTS probe in lib/voice-synthesis/service-status.ts
// (BI-B2E777EB). [BI-963DBB05] (neo4j retired by BET-5.)

import { dependencyUp } from "@/lib/metrics"
import { getOllamaBaseUrl } from "@/lib/inference/ollama-url"

const PROBE_TIMEOUT_MS = 3000

async function probe(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Local model runner (DMR / Ollama) — probe the OpenAI-compatible /models list. */
export async function probeModelRunner(): Promise<boolean> {
  return probe(`${getOllamaBaseUrl().replace(/\/$/, "")}/models`)
}

/**
 * Self-hosted STT, when the operator runs one.
 *
 * Speech is provider-managed (BI-F7E9A541): DPF ships no speech container, so
 * there is no default address to probe. Returning null means "no local STT
 * dependency exists", which is different from "it is down" — probing a
 * hard-coded sidecar address that nothing serves would pin
 * dpf_dependency_up{service="stt"} at 0 on every install and alert on a
 * dependency the platform does not have. A hosted provider is not probed here
 * either; its health is provider-reconciled, not a local dependency.
 */
export async function probeStt(): Promise<boolean | null> {
  const configured = process.env.STT_BASE_URL?.trim()
  if (!configured) return null
  return probe(`${configured.replace(/\/$/, "")}/v1/models`)
}

const SERVICES: Array<readonly [string, () => Promise<boolean | null>]> = [
  ["model-runner", probeModelRunner],
  ["stt", probeStt],
]

/**
 * Refresh dpf_dependency_up{service} for every /metrics-less core dependency.
 * Fully guarded — never throws, so a probe hiccup cannot break the /api/metrics
 * scrape. Probes run in parallel with a short timeout each.
 */
export async function refreshDependencyMetrics(): Promise<void> {
  await Promise.all(
    SERVICES.map(async ([service, fn]) => {
      try {
        const result = await fn()
        // null = this install has no such local dependency. Leave the gauge
        // unset rather than publishing a permanent 0, which would read as an
        // outage of something that was never deployed.
        if (result === null) return
        dependencyUp.labels(service).set(result ? 1 : 0)
      } catch {
        dependencyUp.labels(service).set(0)
      }
    }),
  )
}
