import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { synthesizeWithMlx, resolveReferenceHostPath } from "./mlx"
import type { MlxSynthesisConfig } from "./mlx"

const baseConfig: MlxSynthesisConfig = {
  provider: "mlx",
  providerVoiceId: "voices/mark-dpf-platform/reference.wav",
  language: "en",
  speed: 1.0,
}

const ENV_KEYS = [
  "DPF_TTS_URL",
  "DPF_TTS_MLX_MODEL",
  "DPF_TTS_MLX_VOICE",
  "DPF_TTS_REFERENCE_HOST_ROOT",
  "DPF_TTS_MLX_MAX_ATTEMPTS",
] as const

// A "valid" clip must clear the adapter's MIN_VALID_AUDIO_BYTES (16 KB) gate.
const VALID_AUDIO = new ArrayBuffer(40 * 1024)
const SHORT_AUDIO = new ArrayBuffer(4 * 1024) // simulates CSM empty/truncated run

describe("synthesizeWithMlx", () => {
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    vi.restoreAllMocks()
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
    for (const k of ENV_KEYS) delete process.env[k]
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  // Resolves every call to the same valid response.
  function stubOk(buf: ArrayBuffer = VALID_AUDIO) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(buf),
      text: () => Promise.resolve(""),
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  // Returns a sequence of responses (objects), one per call.
  function stubSequence(responses: Array<{ ok: boolean; status?: number; buf?: ArrayBuffer }>) {
    let i = 0
    const fetchMock = vi.fn().mockImplementation(() => {
      const r = responses[Math.min(i, responses.length - 1)]
      i++
      return Promise.resolve({
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 500),
        arrayBuffer: () => Promise.resolve(r.buf ?? VALID_AUDIO),
        text: () => Promise.resolve("err"),
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  it("forwards per-profile tuning (speed/exaggeration/cfg_weight/temperature)", async () => {
    process.env.DPF_TTS_REFERENCE_HOST_ROOT = "/host/voice-storage"
    const fetchMock = stubOk()
    await synthesizeWithMlx("Proceed.", {
      ...baseConfig,
      referenceText: "ref",
      settings: { speed: 1.12, exaggeration: 0.7, cfgWeight: 0.3, temperature: 0.9 },
    } as Parameters<typeof synthesizeWithMlx>[1])
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.speed).toBe(1.12)
    expect(body.exaggeration).toBe(0.7)
    expect(body.cfg_weight).toBe(0.3)
    expect(body.temperature).toBe(0.9)
  })

  it("clones from the host reference path + sends sampler params", async () => {
    process.env.DPF_TTS_REFERENCE_HOST_ROOT = "/host/voice-storage"
    const fetchMock = stubOk()

    await synthesizeWithMlx("Proceed to build.", { ...baseConfig, referenceText: "sample transcript" })

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://host.docker.internal:8770/v1/audio/speech")
    const body = JSON.parse(options.body as string)
    expect(body.model).toBe("mlx-community/csm-1b")
    expect(body.input).toBe("Proceed to build.")
    expect(body.response_format).toBe("wav")
    expect(body.ref_audio).toBe("/host/voice-storage/voices/mark-dpf-platform/reference.wav")
    expect(body.ref_text).toBe("sample transcript")
    expect(body.temperature).toBe(0.6)
    expect(body.top_k).toBe(50)
    expect(body.voice).toBeUndefined()
  })

  it("sends a non-empty default ref_text when no transcript is provided (CSM requires it)", async () => {
    process.env.DPF_TTS_REFERENCE_HOST_ROOT = "/host/voice-storage"
    const fetchMock = stubOk()

    await synthesizeWithMlx("hi", baseConfig)

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.ref_audio).toBe("/host/voice-storage/voices/mark-dpf-platform/reference.wav")
    expect(typeof body.ref_text).toBe("string")
    expect((body.ref_text as string).length).toBeGreaterThan(0)
  })

  it("falls back to a named voice (no cloning) when the host root is unset", async () => {
    const fetchMock = stubOk()

    await synthesizeWithMlx("hi", baseConfig)

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.ref_audio).toBeUndefined()
    expect(body.voice).toBe("af_heart")
  })

  it("respects DPF_TTS_URL, DPF_TTS_MLX_MODEL and DPF_TTS_MLX_VOICE overrides", async () => {
    process.env.DPF_TTS_URL = "http://127.0.0.1:9000"
    process.env.DPF_TTS_MLX_MODEL = "mlx-community/Kokoro-82M-bf16"
    process.env.DPF_TTS_MLX_VOICE = "bf_emma"
    const fetchMock = stubOk()

    await synthesizeWithMlx("hi", baseConfig)

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://127.0.0.1:9000/v1/audio/speech")
    const body = JSON.parse(options.body as string)
    expect(body.model).toBe("mlx-community/Kokoro-82M-bf16")
    expect(body.voice).toBe("bf_emma")
  })

  it("returns audioBuffer + provider mlx on a valid first response", async () => {
    stubOk(VALID_AUDIO)
    const result = await synthesizeWithMlx("Hello.", baseConfig)
    expect(result.audioBuffer).toBe(VALID_AUDIO)
    expect(result.provider).toBe("mlx")
    expect(result.ttsCostUnits).toBe("Hello.".length)
  })

  it("RETRIES on empty/truncated cloning output and returns the first valid clip", async () => {
    process.env.DPF_TTS_REFERENCE_HOST_ROOT = "/host/voice-storage"
    // Two CSM duds, then a good clip — the documented stochastic failure mode.
    const fetchMock = stubSequence([
      { ok: true, buf: SHORT_AUDIO },
      { ok: true, buf: new ArrayBuffer(0) },
      { ok: true, buf: VALID_AUDIO },
    ])
    // Run synthesis + advance fake timers for the retry delays concurrently.
    vi.useFakeTimers()
    const p = synthesizeWithMlx("Proceed.", baseConfig)
    await vi.runAllTimersAsync()
    const result = await p
    vi.useRealTimers()
    expect(result.audioBuffer.byteLength).toBe(VALID_AUDIO.byteLength)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("RETRIES on a transient 5xx (CSM IndexError) then succeeds", async () => {
    process.env.DPF_TTS_REFERENCE_HOST_ROOT = "/host/voice-storage"
    const fetchMock = stubSequence([
      { ok: false, status: 500 },
      { ok: true, buf: VALID_AUDIO },
    ])
    vi.useFakeTimers()
    const p = synthesizeWithMlx("Proceed.", baseConfig)
    await vi.runAllTimersAsync()
    const result = await p
    vi.useRealTimers()
    expect(result.provider).toBe("mlx")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("gives up after DPF_TTS_MLX_MAX_ATTEMPTS and throws", async () => {
    process.env.DPF_TTS_REFERENCE_HOST_ROOT = "/host/voice-storage"
    process.env.DPF_TTS_MLX_MAX_ATTEMPTS = "3"
    const fetchMock = stubSequence([{ ok: true, buf: SHORT_AUDIO }]) // always short
    vi.useFakeTimers()
    const p = synthesizeWithMlx("x", baseConfig)
    // Advance timers and catch the rejection atomically — if we await timers
    // before attaching the rejection handler, the VoiceSynthesisError escapes
    // as an unhandled rejection and causes a CI unhandled-error failure.
    await Promise.all([
      vi.runAllTimersAsync(),
      expect(p).rejects.toThrow("VoiceSynthesisError [mlx]"),
    ])
    vi.useRealTimers()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("does NOT retry a short named-voice (non-cloning) clip — it's deterministic", async () => {
    // No host root → named-voice path; a short clip there won't improve on retry.
    const fetchMock = stubSequence([{ ok: true, buf: SHORT_AUDIO }])
    await expect(synthesizeWithMlx("x", baseConfig)).rejects.toThrow("VoiceSynthesisError [mlx]")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("resolveReferenceHostPath", () => {
  const KEY = "DPF_TTS_REFERENCE_HOST_ROOT"
  let saved: string | undefined
  beforeEach(() => { saved = process.env[KEY]; delete process.env[KEY] })
  afterEach(() => { if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved })

  it("joins root + providerVoiceId when root is set", () => {
    process.env[KEY] = "/host/vs"
    expect(resolveReferenceHostPath("voices/a/ref.wav")).toBe("/host/vs/voices/a/ref.wav")
  })
  it("returns null when root is unset", () => {
    expect(resolveReferenceHostPath("voices/a/ref.wav")).toBeNull()
  })
  it("returns null when providerVoiceId is missing", () => {
    process.env[KEY] = "/host/vs"
    expect(resolveReferenceHostPath(null)).toBeNull()
    expect(resolveReferenceHostPath(undefined)).toBeNull()
  })
})
