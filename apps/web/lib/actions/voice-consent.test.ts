import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"

const mockCreate = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "vcr-1" }))
const mockUpsert = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "vp-1" }))
// $transaction executes the callback with a tx object
const mockTransaction = vi.hoisted(() =>
  vi.fn().mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
    cb({ voiceConsentRecord: { create: mockCreate }, voiceProfile: { upsert: mockUpsert } })
  )
)

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: mockTransaction,
    voiceConsentRecord: { create: mockCreate },
    voiceProfile: { upsert: mockUpsert },
  },
}))

import { createVoiceConsentRecord } from "./voice-consent"

describe("createVoiceConsentRecord", () => {
  // Pinned because the fixture below carries `expiresAt: 2027-01-01` while the
  // guard in voice-consent.ts:31 compares it to `new Date()`. Unpinned, this
  // passes until 2027-01-01 and then fails forever — the same shape as the
  // 2026-08-01T15:00Z outage fixed in #3883/#3885.
  beforeEach(() => vi.useFakeTimers().setSystemTime("2026-06-15T12:00:00.000Z"))
  afterEach(() => vi.useRealTimers())

  it("creates a VoiceConsentRecord and upserts VoiceProfile in a transaction", async () => {
    const result = await createVoiceConsentRecord({
      profileId: "mark-dpf-platform",
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
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { profileId: "mark-dpf-platform" },
        create: expect.objectContaining({ profileId: "mark-dpf-platform", consentType: "explicit-recorded" }),
        update: expect.objectContaining({ consentType: "explicit-recorded", status: "pending" }),
      })
    )
  })

  it("throws if expiresAt is in the past", async () => {
    await expect(
      createVoiceConsentRecord({
        profileId: "mark-dpf-platform",
        subjectName: "Old Record",
        consentMethod: "signed-document",
        authorizedUseCases: [],
        expiresAt: new Date("2020-01-01"),
        capturedByPrincipalId: "user-abc",
      })
    ).rejects.toThrow("expiresAt must be in the future")
  })
})
