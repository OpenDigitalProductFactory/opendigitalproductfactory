import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@dpf/db", () => ({
  prisma: { voiceProfile: { count: vi.fn(async () => 0) } },
}))

import { prisma } from "@dpf/db"
import {
  resolveTtsServiceUp,
  isVoiceNarrationEnabled,
  refreshVoiceTtsMetrics,
} from "./service-status"
import { voiceTtsUp, voiceTtsEnabled } from "@/lib/metrics"

async function gaugeValue(g: typeof voiceTtsUp): Promise<number> {
  const m = await g.get()
  return m.values[0]?.value ?? -1
}

describe("voice service-status helper", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    // DPF_TTS_URL intentionally unset so the route's `?? default` applies.
    vi.stubEnv("TTS_PROVIDER", "chatterbox")
    vi.mocked(prisma.voiceProfile.count).mockResolvedValue(0 as never)
  })

  it("reports up when the chatterbox /health is healthy", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "healthy", model_loaded: true }), { status: 200 }),
    ) as typeof fetch
    const s = await resolveTtsServiceUp()
    expect(s).toEqual({ provider: "chatterbox", up: true, reason: null })
    expect(global.fetch).toHaveBeenCalledWith(
      "http://dpf-tts:8000/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it("reports down when the sidecar is unreachable", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    }) as typeof fetch
    const s = await resolveTtsServiceUp()
    expect(s.up).toBe(false)
    expect(s.reason).toMatch(/not running/i)
  })

  it("reports down while the model is still loading", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ model_loaded: false }), { status: 200 }),
    ) as typeof fetch
    const s = await resolveTtsServiceUp()
    expect(s.up).toBe(false)
    expect(s.reason).toMatch(/still loading/i)
  })

  it("does not probe managed providers", async () => {
    vi.stubEnv("TTS_PROVIDER", "cartesia")
    global.fetch = vi.fn() as typeof fetch
    const s = await resolveTtsServiceUp()
    expect(s).toEqual({ provider: "cartesia", up: true, reason: null })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("isVoiceNarrationEnabled reflects the ready+enabled profile count", async () => {
    vi.mocked(prisma.voiceProfile.count).mockResolvedValue(2 as never)
    expect(await isVoiceNarrationEnabled()).toBe(true)
    vi.mocked(prisma.voiceProfile.count).mockResolvedValue(0 as never)
    expect(await isVoiceNarrationEnabled()).toBe(false)
  })

  it("refreshVoiceTtsMetrics sets the gauges from the probe + db", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ model_loaded: true }), { status: 200 }),
    ) as typeof fetch
    vi.mocked(prisma.voiceProfile.count).mockResolvedValue(1 as never)
    await refreshVoiceTtsMetrics()
    expect(await gaugeValue(voiceTtsUp)).toBe(1)
    expect(await gaugeValue(voiceTtsEnabled)).toBe(1)

    global.fetch = vi.fn(async () => {
      throw new Error("down")
    }) as typeof fetch
    vi.mocked(prisma.voiceProfile.count).mockResolvedValue(0 as never)
    await refreshVoiceTtsMetrics()
    expect(await gaugeValue(voiceTtsUp)).toBe(0)
    expect(await gaugeValue(voiceTtsEnabled)).toBe(0)
  })
})
