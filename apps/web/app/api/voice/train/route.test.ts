import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockAuth, mockStartVoiceTrainingJob } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockStartVoiceTrainingJob: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/voice-synthesis/training-pipeline", () => ({
  startVoiceTrainingJob: mockStartVoiceTrainingJob,
}))

import { POST } from "./route"

function makeFormData(voiceProfileId: string, audioBlobs: Blob[] = []) {
  const fd = new FormData()
  fd.append("voiceProfileId", voiceProfileId)
  for (const blob of audioBlobs) {
    fd.append("audio", blob)
  }
  return fd
}

describe("POST /api/voice/train", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const req = new Request("http://localhost/api/voice/train", {
      method: "POST",
      body: makeFormData("vp-1"),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("returns 400 when voiceProfileId is missing", async () => {
    const fd = new FormData()
    fd.append("audio", new Blob(["data"], { type: "audio/mp3" }))
    const req = new Request("http://localhost/api/voice/train", {
      method: "POST",
      body: fd,
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/voiceProfileId/)
  })

  it("returns 400 when no audio files provided", async () => {
    const req = new Request("http://localhost/api/voice/train", {
      method: "POST",
      body: makeFormData("vp-1"),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/audio/)
  })

  it("returns 202 with jobId on success", async () => {
    mockStartVoiceTrainingJob.mockResolvedValue({ jobId: "vtj-success" })
    const fd = makeFormData("vp-1", [new Blob(["AUDIO"], { type: "audio/mp3" })])
    const req = new Request("http://localhost/api/voice/train", {
      method: "POST",
      body: fd,
    })
    const res = await POST(req)
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.jobId).toBe("vtj-success")
  })

  it("returns 422 when consent record is expired", async () => {
    mockStartVoiceTrainingJob.mockRejectedValue(new Error("Consent record is expired"))
    const fd = makeFormData("vp-1", [new Blob(["AUDIO"], { type: "audio/mp3" })])
    const req = new Request("http://localhost/api/voice/train", {
      method: "POST",
      body: fd,
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe("Consent record is expired")
  })

  it("returns 422 when consent record missing", async () => {
    mockStartVoiceTrainingJob.mockRejectedValue(new Error("Consent record missing"))
    const fd = makeFormData("vp-1", [new Blob(["AUDIO"], { type: "audio/mp3" })])
    const req = new Request("http://localhost/api/voice/train", {
      method: "POST",
      body: fd,
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })
})
