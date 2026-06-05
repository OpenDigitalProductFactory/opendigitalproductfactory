"use server"

import { prisma } from "@dpf/db"
import { revalidatePath } from "next/cache"

export async function setVoiceEnabled(profileId: string, enabled: boolean) {
  await prisma.decisionPerspectiveProfile.update({
    where: { profileId },
    data: { voiceEnabled: enabled },
  })
  revalidatePath(`/wiki/perspectives/${profileId}/voice`)
}

export async function getVoiceProfileData(profileId: string) {
  const profile = await prisma.decisionPerspectiveProfile.findUnique({
    where: { profileId },
    select: {
      profileId: true,
      name: true,
      kind: true,
      voiceEnabled: true,
      personaConfig: true,
      voiceProfile: {
        include: {
          consentRecord: {
            select: {
              id: true,
              subjectName: true,
              expiresAt: true,
              revokedAt: true,
            },
          },
        },
      },
    },
  })
  return profile
}

export interface VoiceSettingsInput {
  speed?: number
  exaggeration?: number
  cfgWeight?: number
  temperature?: number
}

const clampNum = (v: number | undefined, lo: number, hi: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined

/** Persist per-profile voice tuning (speed/expressiveness) chosen on the voice page. */
export async function saveVoiceSettings(profileId: string, settings: VoiceSettingsInput) {
  const clean = {
    speed: clampNum(settings.speed, 0.5, 2.0),
    exaggeration: clampNum(settings.exaggeration, 0.25, 1.0),
    cfgWeight: clampNum(settings.cfgWeight, 0.2, 1.0),
    temperature: clampNum(settings.temperature, 0.2, 1.2),
  }
  await prisma.voiceProfile.update({
    where: { profileId },
    data: { voiceSettings: clean },
  })
  revalidatePath(`/wiki/perspectives/${profileId}/voice`)
  return clean
}

/** Reset a voice profile to pending so the user can re-record their reference audio. */
export async function resetVoiceProfile(profileId: string) {
  await prisma.voiceProfile.update({
    where: { profileId },
    data: { status: "pending", providerVoiceId: null, sampleCount: 0 },
  })
  revalidatePath(`/wiki/perspectives/${profileId}/voice`)
}

export async function listVoiceProfiles() {
  return prisma.decisionPerspectiveProfile.findMany({
    where: { status: "active" },
    orderBy: { name: "asc" },
    select: {
      profileId: true,
      name: true,
      kind: true,
      voiceEnabled: true,
      voiceProfile: {
        select: { status: true },
      },
    },
  })
}
