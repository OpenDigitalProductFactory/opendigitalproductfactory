"use server"

import { prisma } from "@dpf/db"

export interface CreateVoiceConsentInput {
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

export async function createVoiceConsentRecord(input: CreateVoiceConsentInput) {
  if (input.expiresAt <= new Date()) {
    throw new Error("expiresAt must be in the future")
  }

  return prisma.voiceConsentRecord.create({
    data: {
      subjectName: input.subjectName,
      subjectEmail: input.subjectEmail ?? null,
      consentMethod: input.consentMethod,
      authorizedUseCases: input.authorizedUseCases,
      authorizedLanguages: input.authorizedLanguages ?? ["en"],
      authorizedTerritories: input.authorizedTerritories ?? ["global"],
      expiresAt: input.expiresAt,
      capturedByPrincipalId: input.capturedByPrincipalId,
      evidenceRef: input.evidenceRef ?? null,
    },
  })
}
