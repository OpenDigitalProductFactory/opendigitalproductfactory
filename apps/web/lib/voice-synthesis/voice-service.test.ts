import { describe, it, expect, vi, beforeEach } from "vitest"
import { synthesizeSpeech } from "./voice-service"
import type { VoiceSynthesisConfig } from "./types"

// Mock fetch for Cartesia API
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

const MOCK_AUDIO = Buffer.from("FAKE_AUDIO_BYTES")

function makeFakeCartesiaResponse() {
  return {
    ok: true,
    arrayBuffer: async () => MOCK_AUDIO.buffer,
    headers: new Headers({ "content-type": "audio/mp3" }),
  }
}

describe("synthesizeSpeech (Cartesia)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls Cartesia API with correct payload", async () => {
    process.env.CARTESIA_API_KEY = "test-key"
    mockFetch.mockResolvedValueOnce(makeFakeCartesiaResponse())

    const config: VoiceSynthesisConfig = {
      provider: "cartesia",
      providerVoiceId: "voice-abc123",
      language: "en",
      speed: 1.0,
    }
    const result = await synthesizeSpeech("Hello world.", config)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toContain("cartesia.ai")
    const body = JSON.parse(init.body)
    expect(body.voice.id).toBe("voice-abc123")
    expect(body.transcript).toBe("Hello world.")
    expect(result.audioBuffer.byteLength).toBeGreaterThan(0)
    expect(result.provider).toBe("cartesia")
  })

  it("throws VoiceSynthesisError when API returns non-200", async () => {
    process.env.CARTESIA_API_KEY = "test-key"
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" })

    await expect(
      synthesizeSpeech("Hello.", { provider: "cartesia", providerVoiceId: "v1", language: "en" })
    ).rejects.toThrow("VoiceSynthesisError")
  })
})
