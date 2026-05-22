"use server"

import { prisma } from "@dpf/db"

export interface CreateVoiceConsentInput {
  profileId: string                    // links consent → VoiceProfile on save
  subjectName: string
  subjectEmail?: string
  consentMethod: "recorded-statement" | "signed-document" | "witnessed-verbal"
  authorizedUseCases: string[]
  authorizedLanguages?: string[]
  authorizedTerritories?: string[]
  expiresAt: Date
  capturedByPrincipalId: string
  evidenceRef?: string
}

const CONSENT_TYPE_MAP: Record<CreateVoiceConsentInput["consentMethod"], string> = {
  "recorded-statement": "explicit-recorded",
  "signed-document":    "explicit-signed",
  "witnessed-verbal":   "explicit-recorded",
}

/**
 * Creates a VoiceConsentRecord and upserts the linked VoiceProfile in one
 * transaction. Without the VoiceProfile upsert, the page query
 * (profile.voiceProfile.consentRecord) always returns null after reload
 * because VoiceProfile never existed — the consent badge never lit green.
 */
export async function createVoiceConsentRecord(input: CreateVoiceConsentInput) {
  if (input.expiresAt <= new Date()) {
    throw new Error("expiresAt must be in the future")
  }

  const consentType = CONSENT_TYPE_MAP[input.consentMethod]

  return prisma.$transaction(async (tx) => {
    const record = await tx.voiceConsentRecord.create({
      data: {
        subjectName:          input.subjectName,
        subjectEmail:         input.subjectEmail ?? null,
        consentMethod:        input.consentMethod,
        authorizedUseCases:   input.authorizedUseCases,
        authorizedLanguages:  input.authorizedLanguages ?? ["en"],
        authorizedTerritories: input.authorizedTerritories ?? ["global"],
        expiresAt:            input.expiresAt,
        capturedByPrincipalId: input.capturedByPrincipalId,
        evidenceRef:          input.evidenceRef ?? null,
      },
    })

    // Upsert VoiceProfile so the page query finds it on reload.
    // Uses `update-or-create` semantics: if a profile already exists (e.g.
    // consent is being renewed), update the consentRecordId; otherwise create
    // a fresh pending profile ready for reference audio upload.
    await tx.voiceProfile.upsert({
      where:  { profileId: input.profileId },
      create: {
        profileId:       input.profileId,
        provider:        "chatterbox",
        consentType,
        consentRecordId: record.id,
        status:          "pending",
      },
      update: {
        consentType,
        consentRecordId: record.id,
        // Reset to pending when consent changes so the voice must be
        // re-registered if it was previously ready under a different consent.
        status: "pending",
        providerVoiceId: null,
      },
    })

    return record
  })
}
