import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-1" } })),
}))

// The route now imports the shared service-status helper, which pulls in @dpf/db
// (for isVoiceNarrationEnabled). The route itself never queries it, so a thin
// mock keeps this test hermetic.
vi.mock("@dpf/db", () => ({
  prisma: { voiceProfile: { count: vi.fn(async () => 0), findMany: vi.fn(async () => [{ profile: { voiceEnabled: true } }]) } },
}))

// Keep defaultProvider real (env-driven) so the route resolves the probe URL
// exactly as production does.
import { auth } from "@/lib/auth"
import { prisma } from "@dpf/db"
import { GET } from "./route"

describe("GET /api/voice/service-status", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never)
    vi.mocked(prisma.voiceProfile.findMany).mockResolvedValue([{ profile: { voiceEnabled: true } }] as never)
    // DPF_TTS_URL intentionally left unset so the route's `?? default` applies;
    // the mlx test below stubs it explicitly. (Stubbing "" would defeat `??`.)
    vi.stubEnv("TTS_PROVIDER", "chatterbox")
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it("reports available when the chatterbox sidecar /health is healthy", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "healthy", model_loaded: true }), { status: 200 }),
    ) as typeof fetch

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ available: true, state: "ready", provider: "chatterbox", reason: null })
    // Probes the default Docker-network sidecar address.
    expect(global.fetch).toHaveBeenCalledWith(
      "http://dpf-tts:8000/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it("forwards preview purpose without requiring narration preference", async () => {
    vi.mocked(prisma.voiceProfile.findMany).mockResolvedValue([{ profile: { voiceEnabled: false } }] as never)
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "healthy", model_loaded: true }), { status: 200 }),
    ) as typeof fetch

    const res = await GET(new Request("http://localhost/api/voice/service-status?purpose=preview"))
    expect(await res.json()).toMatchObject({ available: true, state: "ready" })
  })

  it("reports unavailable when the sidecar is unreachable", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    }) as typeof fetch

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.available).toBe(false)
    expect(body.state).toBe("service_unavailable")
    expect(body.reason).toMatch(/not running/i)
  })

  it("reports unavailable while the model is still loading", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "loading", model_loaded: false }), { status: 200 }),
    ) as typeof fetch

    const res = await GET()
    const body = await res.json()

    expect(body.available).toBe(false)
    expect(body.reason).toMatch(/still loading/i)
  })

  it("does not probe managed providers and reports them available", async () => {
    vi.stubEnv("TTS_PROVIDER", "cartesia")
    global.fetch = vi.fn() as typeof fetch

    const res = await GET()
    const body = await res.json()

    expect(body).toEqual({ available: true, state: "ready", provider: "cartesia", reason: null })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("respects DPF_TTS_URL override for the mlx sidecar", async () => {
    vi.stubEnv("TTS_PROVIDER", "mlx")
    vi.stubEnv("DPF_TTS_URL", "http://host.docker.internal:8771")
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "healthy", model_loaded: true }), { status: 200 }),
    ) as typeof fetch

    await GET()

    expect(global.fetch).toHaveBeenCalledWith(
      "http://host.docker.internal:8771/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})
