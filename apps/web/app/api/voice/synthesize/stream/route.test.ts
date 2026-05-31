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

import { prisma } from "@dpf/db"
import { DEFAULT_REF_TEXT } from "@/lib/voice-synthesis/adapters/mlx"
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
})
