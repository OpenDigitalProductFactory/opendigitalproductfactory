import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/voice-synthesis/service-status", () => ({
  isVoiceNarrationEnabled: vi.fn(),
  resolveTtsServiceUp: vi.fn(),
}))

import { isVoiceNarrationEnabled, resolveTtsServiceUp } from "@/lib/voice-synthesis/service-status"
import { assertVoiceServiceOnBoot } from "./voice-service-continuity"

describe("assertVoiceServiceOnBoot", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("no-ops (no CRITICAL) when narration is not enabled", async () => {
    vi.mocked(isVoiceNarrationEnabled).mockResolvedValue(false)
    const logger = { log: vi.fn(), error: vi.fn() }
    const r = await assertVoiceServiceOnBoot(logger)
    expect(r).toEqual({ enabled: false, up: true })
    expect(resolveTtsServiceUp).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("logs CRITICAL when narration is enabled but the sidecar is down", async () => {
    vi.mocked(isVoiceNarrationEnabled).mockResolvedValue(true)
    vi.mocked(resolveTtsServiceUp).mockResolvedValue({
      provider: "chatterbox",
      up: false,
      reason: "The text-to-speech service is not running.",
    })
    const logger = { log: vi.fn(), error: vi.fn() }
    const r = await assertVoiceServiceOnBoot(logger)
    expect(r).toEqual({ enabled: true, up: false })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0][0]).toMatch(/CRITICAL/)
  })

  it("stays quiet when narration is enabled and the sidecar is up", async () => {
    vi.mocked(isVoiceNarrationEnabled).mockResolvedValue(true)
    vi.mocked(resolveTtsServiceUp).mockResolvedValue({ provider: "chatterbox", up: true, reason: null })
    const logger = { log: vi.fn(), error: vi.fn() }
    const r = await assertVoiceServiceOnBoot(logger)
    expect(r).toEqual({ enabled: true, up: true })
    expect(logger.error).not.toHaveBeenCalled()
  })
})
