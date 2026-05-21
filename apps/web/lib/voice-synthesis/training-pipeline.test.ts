// training-pipeline.test.ts
// Tests for the Cartesia opt-in path.
// Default provider is now Chatterbox (zero-shot) via /api/voice/reference.
// VoiceTrainingJob table is dropped; jobId is the Cartesia voice id directly.

import { describe, it, expect, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  voiceProfile: { findUnique: vi.fn(), update: vi.fn() },
}))

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }))

const mockFetch = vi.hoisted(() => vi.fn())
vi.stubGlobal("fetch", mockFetch)

import { startVoiceTrainingJob } from "./training-pipeline"

describe("startVoiceTrainingJob (Cartesia opt-in path)", () => {
  it("calls Cartesia clone API and returns voice id as jobId", async () => {
    process.env.CARTESIA_API_KEY = "test-key"
    mockPrisma.voiceProfile.findUnique.mockResolvedValue({
      id: "vp-1",
      provider: "cartesia",
      consentType: "explicit-recorded",
      consentRecord: { expiresAt: new Date(Date.now() + 86400000) },
    })
    mockPrisma.voiceProfile.update.mockResolvedValue({})
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "cartesia-job-abc", status: "running" }),
    })

    const result = await startVoiceTrainingJob({
      voiceProfileId: "vp-1",
      audioSamples: [{ filename: "voice.mp3", mimeType: "audio/mp3", durationMs: 30000 }],
      audioBuffers: [Buffer.from("FAKE")],
    })

    // jobId is now the Cartesia voice id (not a VoiceTrainingJob row id)
    expect(result.jobId).toBe("cartesia-job-abc")
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain("cartesia.ai")
  })

  it("throws if consent is expired", async () => {
    mockPrisma.voiceProfile.findUnique.mockResolvedValue({
      id: "vp-1",
      provider: "cartesia",
      consentType: "explicit-recorded",
      consentRecord: { expiresAt: new Date("2020-01-01") },
    })
    await expect(
      startVoiceTrainingJob({ voiceProfileId: "vp-1", audioSamples: [], audioBuffers: [] })
    ).rejects.toThrow("Consent record is expired")
  })

  it("throws if consentRecord is missing for non-synthetic profile", async () => {
    mockPrisma.voiceProfile.findUnique.mockResolvedValue({
      id: "vp-2",
      provider: "cartesia",
      consentType: "explicit-signed",
      consentRecord: null,
    })
    await expect(
      startVoiceTrainingJob({ voiceProfileId: "vp-2", audioSamples: [], audioBuffers: [] })
    ).rejects.toThrow("Consent record missing")
  })

  it("skips consent check for not-required-synthetic profiles", async () => {
    process.env.CARTESIA_API_KEY = "test-key"
    mockPrisma.voiceProfile.findUnique.mockResolvedValue({
      id: "vp-3",
      provider: "cartesia",
      consentType: "not-required-synthetic",
      consentRecord: null,
    })
    mockPrisma.voiceProfile.update.mockResolvedValue({})
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "cartesia-job-xyz", status: "running" }),
    })

    const result = await startVoiceTrainingJob({
      voiceProfileId: "vp-3",
      audioSamples: [],
      audioBuffers: [],
    })
    expect(result.jobId).toBe("cartesia-job-xyz")
  })
})
