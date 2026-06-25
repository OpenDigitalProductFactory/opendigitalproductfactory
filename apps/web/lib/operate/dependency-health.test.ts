import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  probeNeo4j,
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

  it("probeNeo4j hits the neo4j HTTP API and returns true on 200", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch
    expect(await probeNeo4j()).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith(
      "http://neo4j:7474/",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it("probeStt hits the Speaches /v1/models endpoint", async () => {
    global.fetch = vi.fn(async () => new Response("[]", { status: 200 })) as typeof fetch
    expect(await probeStt()).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith(
      "http://dpf-stt:9000/v1/models",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it("probeModelRunner probes the local /models list", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch
    expect(await probeModelRunner()).toBe(true)
    const calledUrl = vi.mocked(global.fetch).mock.calls[0]?.[0]
    expect(String(calledUrl)).toMatch(/\/models$/)
  })

  it("returns false when a probe is unreachable", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    }) as typeof fetch
    expect(await probeNeo4j()).toBe(false)
  })

  it("refreshDependencyMetrics sets dpf_dependency_up for every service", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch
    await refreshDependencyMetrics()
    expect(await gaugeValue("neo4j")).toBe(1)
    expect(await gaugeValue("model-runner")).toBe(1)
    expect(await gaugeValue("stt")).toBe(1)

    global.fetch = vi.fn(async () => {
      throw new Error("down")
    }) as typeof fetch
    await refreshDependencyMetrics()
    expect(await gaugeValue("neo4j")).toBe(0)
    expect(await gaugeValue("model-runner")).toBe(0)
    expect(await gaugeValue("stt")).toBe(0)
  })
})
