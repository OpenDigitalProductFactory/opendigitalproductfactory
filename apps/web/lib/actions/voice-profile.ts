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
          trainingJobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              errorMessage: true,
              createdAt: true,
              completedAt: true,
            },
          },
        },
      },
    },
  })
  return profile
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
