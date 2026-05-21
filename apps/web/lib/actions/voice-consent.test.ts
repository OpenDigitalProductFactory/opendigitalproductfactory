import { describe, it, expect, vi } from "vitest"

const mockCreate = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "vcr-1" }))

vi.mock("@dpf/db", () => ({
  prisma: { voiceConsentRecord: { create: mockCreate } },
}))

import { createVoiceConsentRecord } from "./voice-consent"

describe("createVoiceConsentRecord", () => {
  it("creates a VoiceConsentRecord with required fields", async () => {
    const result = await createVoiceConsentRecord({
      subjectName: "Jane Doe",
      consentMethod: "recorded-statement",
      authorizedUseCases: ["build-studio-gate"],
      expiresAt: new Date("2027-01-01"),
      capturedByPrincipalId: "user-abc",
    })
    expect(result.id).toBe("vcr-1")
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ subjectName: "Jane Doe" }),
    })
  })

  it("throws if expiresAt is in the past", async () => {
    await expect(
      createVoiceConsentRecord({
        subjectName: "Old Record",
        consentMethod: "signed-document",
        authorizedUseCases: [],
        expiresAt: new Date("2020-01-01"),
        capturedByPrincipalId: "user-abc",
      })
    ).rejects.toThrow("expiresAt must be in the future")
  })
})
