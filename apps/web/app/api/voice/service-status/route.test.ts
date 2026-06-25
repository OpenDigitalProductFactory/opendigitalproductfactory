import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-1" } })),
}))

// Keep defaultProvider real (env-driven) so the route resolves the probe URL
// exactly as production does.
import { auth } from "@/lib/auth"
import { GET } from "./route"

describe("GET /api/voice/service-status", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never)
    vi.stubEnv("DPF_TTS_URL", "")
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
    expect(body).toEqual({ available: true, provider: "chatterbox", reason: null })
    // Probes the default Docker-network sidecar address.
    expect(global.fetch).toHaveBeenCalledWith(
      "http://dpf-tts:8000/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it("reports unavailable when the sidecar is unreachable", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    }) as typeof fetch

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.available).toBe(false)
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

    expect(body).toEqual({ available: true, provider: "cartesia", reason: null })
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
