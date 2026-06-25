// Liveness probes for core dependencies that expose NO Prometheus /metrics
// endpoint, so they cannot be scrape targets and `ContainerDown` (up==0) can
// never see them: neo4j (graph DB), the local model runner (DMR), and STT
// (Speaches). Sets the dpf_dependency_up{service} gauge, refreshed on each
// /api/metrics scrape. Mirrors the TTS probe in
// lib/voice-synthesis/service-status.ts (BI-B2E777EB). [BI-963DBB05]

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

/** neo4j exposes no Prometheus metrics; community edition serves an HTTP API on 7474. */
export async function probeNeo4j(): Promise<boolean> {
  return probe(process.env.NEO4J_HTTP_URL ?? "http://neo4j:7474/")
}

/** Local model runner (DMR / Ollama) — probe the OpenAI-compatible /models list. */
export async function probeModelRunner(): Promise<boolean> {
  return probe(`${getOllamaBaseUrl().replace(/\/$/, "")}/models`)
}

/** STT (Speaches) exposes /v1/models but no Prometheus metrics. */
export async function probeStt(): Promise<boolean> {
  const base = (process.env.STT_BASE_URL ?? "http://dpf-stt:9000").replace(/\/$/, "")
  return probe(`${base}/v1/models`)
}

const SERVICES: Array<readonly [string, () => Promise<boolean>]> = [
  ["neo4j", probeNeo4j],
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
        dependencyUp.labels(service).set((await fn()) ? 1 : 0)
      } catch {
        dependencyUp.labels(service).set(0)
      }
    }),
  )
}
