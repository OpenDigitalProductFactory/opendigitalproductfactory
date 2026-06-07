import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-1" } })),
}))

vi.mock("@dpf/db", () => ({
  prisma: {
    voiceProfile: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/voice-synthesis/adapters/mlx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice-synthesis/adapters/mlx")>()
  return {
    ...actual,
    resolveReferenceHostPath: vi.fn(() => "/host/uploads/voices/profile-1/reference.wav"),
  }
})

// Keep defaultProvider real (env-driven); stub the actual synthesis call so the
// Chatterbox one-shot fallback can be exercised without a live sidecar.
vi.mock("@/lib/voice-synthesis/voice-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice-synthesis/voice-service")>()
  return { ...actual, synthesizeSpeech: vi.fn() }
})

vi.mock("@/lib/voice-synthesis/storage-root", () => ({
  resolveVoiceStorageRoot: vi.fn(() => "/host/uploads"),
}))

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => Buffer.from([9, 9, 9])),
}))

import { prisma } from "@dpf/db"
import { DEFAULT_REF_TEXT } from "@/lib/voice-synthesis/adapters/mlx"
import { synthesizeSpeech } from "@/lib/voice-synthesis/voice-service"
import { POST } from "./route"

const voiceProfile = {
  provider: "chatterbox",
  providerVoiceId: "voices/profile-1/reference.wav",
  status: "ready",
  language: "en",
  voiceSettings: {
    speed: 1.12,
    exaggeration: 0.5,
    cfgWeight: 0.3,
    temperature: 0.8,
  },
}

describe("POST /api/voice/synthesize/stream", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.mocked(prisma.voiceProfile.findUnique).mockResolvedValue(voiceProfile as never)
    vi.mocked(prisma.voiceProfile.findFirst).mockResolvedValue(voiceProfile as never)
    vi.stubEnv("TTS_PROVIDER", "mlx")
    global.fetch = vi.fn(async () => new Response(new Uint8Array([0, 0, 0, 0]), {
      status: 200,
      headers: { "X-Sentence-Count": "1" },
    })) as typeof fetch
  })

  it("defaults the streaming sidecar to the Chatterbox port and includes ref_text", async () => {
    const req = new Request("http://dpf.local/api/voice/synthesize/stream", {
      method: "POST",
      body: JSON.stringify({
        text: "Hello there.",
        voiceProfileId: "profile-1",
      }),
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith(
      "http://host.docker.internal:8771/v1/audio/speech/stream",
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      }),
    )
    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]?.body as string)
    expect(body).toMatchObject({
      input: "Hello there.",
      response_format: "wav",
      speed: 1.12,
      ref_audio: "/host/uploads/voices/profile-1/reference.wav",
      ref_text: DEFAULT_REF_TEXT,
      exaggeration: 0.5,
      cfg_weight: 0.3,
      temperature: 0.8,
    })
  })

  it("falls back to one-shot synthesis as a single framed chunk for Chatterbox", async () => {
    // Chatterbox (dpf-tts) has no /v1/audio/speech/stream endpoint, so the route
    // must NOT proxy — it synthesizes once and frames the clip for the client.
    vi.stubEnv("TTS_PROVIDER", "chatterbox")
    const wav = new Uint8Array([1, 2, 3, 4, 5])
    vi.mocked(synthesizeSpeech).mockResolvedValue({
      audioBuffer: wav.buffer,
      provider: "chatterbox",
    } as never)

    const req = new Request("http://dpf.local/api/voice/synthesize/stream", {
      method: "POST",
      body: JSON.stringify({ text: "Hello there.", voiceProfileId: "profile-1" }),
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream")
    expect(res.headers.get("X-Sentence-Count")).toBe("1")
    // The streaming proxy must never fire for a non-streaming provider.
    expect(global.fetch).not.toHaveBeenCalled()

    const bytes = new Uint8Array(await res.arrayBuffer())
    // [4-byte big-endian length][WAV] — the framing useVoiceSynth.parseNextChunk decodes.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0, 0, 0, 5])
    expect(Array.from(bytes.slice(4))).toEqual([1, 2, 3, 4, 5])
  })
})
