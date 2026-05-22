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
