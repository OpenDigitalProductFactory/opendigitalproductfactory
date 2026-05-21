import { describe, it, expect, vi, beforeEach } from "vitest"
import { synthesizeWithChatterbox } from "./chatterbox"
import type { VoiceSynthesisConfig } from "../types"

const mockConfig: VoiceSynthesisConfig = {
  provider: "chatterbox",
  providerVoiceId: "voice_mark_dpf",
  language: "en",
  speed: 1.0,
}

describe("synthesizeWithChatterbox", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.DPF_TTS_URL = "http://dpf-tts:8000"
  })

  it("returns RawSynthesisResult with audioBuffer on success", async () => {
    const fakeAudio = new ArrayBuffer(1024)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeAudio),
    }))

    const result = await synthesizeWithChatterbox("Hello, world.", mockConfig)

    expect(result.audioBuffer).toBe(fakeAudio)
    expect(result.provider).toBe("chatterbox")
    expect(result.ttsCostUnits).toBe("Hello, world.".length)
  })

  it("sends correct OpenAI-compatible payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    })
    vi.stubGlobal("fetch", fetchMock)

    await synthesizeWithChatterbox("Test text", mockConfig)

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://dpf-tts:8000/v1/audio/speech")

    const body = JSON.parse(options.body as string)
    expect(body.model).toBe("tts-1")
    expect(body.input).toBe("Test text")
    expect(body.voice).toBe("voice_mark_dpf")
    expect(body.response_format).toBe("wav")
  })

  it("throws VoiceSynthesisError on non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve("service unavailable"),
    }))

    await expect(synthesizeWithChatterbox("text", mockConfig)).rejects.toThrow(
      "VoiceSynthesisError [chatterbox]"
    )
  })

  it("falls back to http://dpf-tts:8000 when DPF_TTS_URL is not set", async () => {
    delete process.env.DPF_TTS_URL
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    })
    vi.stubGlobal("fetch", fetchMock)

    await synthesizeWithChatterbox("hi", mockConfig)

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://dpf-tts:8000/v1/audio/speech")
  })
})
