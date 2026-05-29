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
] as const

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

  function stubFetch(impl: { ok: boolean; status?: number }) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: impl.ok,
      status: impl.status ?? 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      text: () => Promise.resolve("err"),
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  it("clones from the host reference path when DPF_TTS_REFERENCE_HOST_ROOT is set", async () => {
    process.env.DPF_TTS_REFERENCE_HOST_ROOT = "/host/voice-storage"
    const fetchMock = stubFetch({ ok: true })

    await synthesizeWithMlx("Proceed to build.", { ...baseConfig, referenceText: "sample transcript" })

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://host.docker.internal:8770/v1/audio/speech")
    const body = JSON.parse(options.body as string)
    expect(body.model).toBe("mlx-community/csm-1b")
    expect(body.input).toBe("Proceed to build.")
    expect(body.response_format).toBe("wav")
    expect(body.ref_audio).toBe("/host/voice-storage/voices/mark-dpf-platform/reference.wav")
    expect(body.ref_text).toBe("sample transcript")
    expect(body.voice).toBeUndefined()
  })

  it("omits ref_text when no transcript is provided but still clones", async () => {
    process.env.DPF_TTS_REFERENCE_HOST_ROOT = "/host/voice-storage"
    const fetchMock = stubFetch({ ok: true })

    await synthesizeWithMlx("hi", baseConfig)

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.ref_audio).toBe("/host/voice-storage/voices/mark-dpf-platform/reference.wav")
    expect(body.ref_text).toBeUndefined()
  })

  it("falls back to a named voice (no cloning) when the host root is unset", async () => {
    const fetchMock = stubFetch({ ok: true })

    await synthesizeWithMlx("hi", baseConfig)

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.ref_audio).toBeUndefined()
    expect(body.voice).toBe("af_heart")
  })

  it("respects DPF_TTS_URL, DPF_TTS_MLX_MODEL and DPF_TTS_MLX_VOICE overrides", async () => {
    process.env.DPF_TTS_URL = "http://127.0.0.1:9000"
    process.env.DPF_TTS_MLX_MODEL = "mlx-community/Kokoro-82M-bf16"
    process.env.DPF_TTS_MLX_VOICE = "bf_emma"
    const fetchMock = stubFetch({ ok: true })

    await synthesizeWithMlx("hi", baseConfig)

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("http://127.0.0.1:9000/v1/audio/speech")
    const body = JSON.parse(options.body as string)
    expect(body.model).toBe("mlx-community/Kokoro-82M-bf16")
    expect(body.voice).toBe("bf_emma")
  })

  it("returns audioBuffer + provider mlx on success", async () => {
    const fakeAudio = new ArrayBuffer(16)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(fakeAudio) }),
    )

    const result = await synthesizeWithMlx("Hello.", baseConfig)
    expect(result.audioBuffer).toBe(fakeAudio)
    expect(result.provider).toBe("mlx")
    expect(result.ttsCostUnits).toBe("Hello.".length)
  })

  it("throws VoiceSynthesisError on non-2xx", async () => {
    stubFetch({ ok: false, status: 503 })
    await expect(synthesizeWithMlx("x", baseConfig)).rejects.toThrow("VoiceSynthesisError [mlx]")
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
