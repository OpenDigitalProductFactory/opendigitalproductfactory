import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  probeModelRunner,
  probeStt,
  refreshDependencyMetrics,
} from "./dependency-health"
import { dependencyUp } from "@/lib/metrics"

async function gaugeValue(service: string): Promise<number | undefined> {
  const m = await dependencyUp.get()
  return m.values.find((v) => v.labels.service === service)?.value
}

describe("dependency-health probes", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("probes a self-hosted STT endpoint when the operator has configured one", async () => {
    vi.stubEnv("STT_BASE_URL", "http://my-whisper:9000")
    global.fetch = vi.fn(async () => new Response("[]", { status: 200 })) as typeof fetch
    expect(await probeStt()).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith(
      "http://my-whisper:9000/v1/models",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it("reports no local STT dependency when none is configured (BI-F7E9A541)", async () => {
    // Speech is provider-managed: DPF ships no speech container, so there is no
    // default address to probe. null means "not applicable", which must not be
    // confused with "down".
    vi.stubEnv("STT_BASE_URL", "")
    global.fetch = vi.fn(async () => new Response("[]", { status: 200 })) as typeof fetch
    expect(await probeStt()).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("probeModelRunner probes the local /models list", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch
    expect(await probeModelRunner()).toBe(true)
    const calledUrl = vi.mocked(global.fetch).mock.calls[0]?.[0]
    expect(String(calledUrl)).toMatch(/\/models$/)
  })

  it("returns false when a configured probe is unreachable", async () => {
    vi.stubEnv("STT_BASE_URL", "http://my-whisper:9000")
    global.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    }) as typeof fetch
    expect(await probeStt()).toBe(false)
  })

  it("sets dpf_dependency_up for every applicable service", async () => {
    vi.stubEnv("STT_BASE_URL", "http://my-whisper:9000")
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch
    await refreshDependencyMetrics()
    expect(await gaugeValue("model-runner")).toBe(1)
    expect(await gaugeValue("stt")).toBe(1)

    global.fetch = vi.fn(async () => {
      throw new Error("down")
    }) as typeof fetch
    await refreshDependencyMetrics()
    expect(await gaugeValue("model-runner")).toBe(0)
    expect(await gaugeValue("stt")).toBe(0)
  })

  it("publishes no stt gauge at all when no local STT is configured", async () => {
    // The failure this prevents: a permanent 0 reading as an outage of a
    // dependency this install never deployed.
    dependencyUp.reset()
    vi.stubEnv("STT_BASE_URL", "")
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch
    await refreshDependencyMetrics()
    expect(await gaugeValue("model-runner")).toBe(1)
    expect(await gaugeValue("stt")).toBeUndefined()
  })
})
