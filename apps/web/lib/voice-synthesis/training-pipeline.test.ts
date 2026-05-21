import { describe, it, expect, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  voiceProfile: { findUnique: vi.fn(), update: vi.fn() },
  voiceTrainingJob: { create: vi.fn(), update: vi.fn() },
}))

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }))

const mockFetch = vi.hoisted(() => vi.fn())
vi.stubGlobal("fetch", mockFetch)

import { startVoiceTrainingJob } from "./training-pipeline"

describe("startVoiceTrainingJob", () => {
  it("creates a VoiceTrainingJob with pending status and calls Cartesia training API", async () => {
    process.env.CARTESIA_API_KEY = "test-key"
    mockPrisma.voiceProfile.findUnique.mockResolvedValue({
      id: "vp-1",
      provider: "cartesia",
      consentType: "explicit-recorded",
      consentRecord: { expiresAt: new Date(Date.now() + 86400000) },
    })
    mockPrisma.voiceTrainingJob.create.mockResolvedValue({ id: "vtj-1" })
    mockPrisma.voiceProfile.update.mockResolvedValue({})
    mockPrisma.voiceTrainingJob.update.mockResolvedValue({})
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "cartesia-job-abc", status: "running" }),
    })

    const result = await startVoiceTrainingJob({
      voiceProfileId: "vp-1",
      audioSamples: [{ filename: "voice.mp3", mimeType: "audio/mp3", durationMs: 30000 }],
      audioBuffers: [Buffer.from("FAKE")],
    })

    expect(result.jobId).toBe("vtj-1")
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
    mockPrisma.voiceProfile.findUnique.mockResolvedValue({
      id: "vp-3",
      provider: "cartesia",
      consentType: "not-required-synthetic",
      consentRecord: null,
    })
    mockPrisma.voiceTrainingJob.create.mockResolvedValue({ id: "vtj-2" })
    mockPrisma.voiceProfile.update.mockResolvedValue({})
    mockPrisma.voiceTrainingJob.update.mockResolvedValue({})
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "cartesia-job-xyz", status: "running" }),
    })

    const result = await startVoiceTrainingJob({
      voiceProfileId: "vp-3",
      audioSamples: [],
      audioBuffers: [],
    })
    expect(result.jobId).toBe("vtj-2")
  })
})
