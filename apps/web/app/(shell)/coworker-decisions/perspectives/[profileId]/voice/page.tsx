// Voice profile admin page — wiki context.
// Route: /coworker-decisions/perspectives/[profileId]/voice
//
// Surfaces consent capture, reference audio upload, and enable/disable
// toggle for WWMD/WWWD decision perspective personas.
// Provider: Chatterbox self-hosted TTS (zero-shot cloning, no training job).
// Components: VoiceProfileSetup (client), VoiceConsentForm.
// Spec: docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md

import { notFound } from "next/navigation"
import Link from "next/link"
import { prisma } from "@dpf/db"
import { auth } from "@/lib/auth"
import { VoiceProfileSetup } from "@/components/wiki/VoiceProfileSetup"

export const dynamic = "force-dynamic"

type Params = Promise<{ profileId: string }>

export default async function VoiceProfileAdminPage({ params }: { params: Params }) {
  const { profileId } = await params
  const session = await auth()
  if (!session?.user?.id) notFound()

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

  if (!profile) notFound()

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/coworker-decisions" className="hover:text-foreground">Coworker Decisions</Link>
        <span>/</span>
        <Link href="/coworker-decisions/perspectives" className="hover:text-foreground">Perspectives</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{profile.name}</span>
        <span>/</span>
        <span className="text-foreground">Voice</span>
      </nav>

      {/* Profile header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {profile.kind}
          </span>
        </div>
        <h1 className="text-2xl font-bold">{profile.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Decision perspective profile · Voice configuration
        </p>
      </div>

      <VoiceProfileSetup
        profileId={profile.profileId}
        profileName={profile.name}
        voiceEnabled={profile.voiceEnabled}
        currentUserId={session.user.id}
        voiceProfile={
          profile.voiceProfile
            ? {
                id: profile.voiceProfile.id,
                provider: profile.voiceProfile.provider,
                providerVoiceId: profile.voiceProfile.providerVoiceId,
                status: profile.voiceProfile.status,
                consentType: profile.voiceProfile.consentType,
                qualityScore: profile.voiceProfile.qualityScore,
                language: profile.voiceProfile.language,
                consentRecord: profile.voiceProfile.consentRecord
                  ? {
                      id: profile.voiceProfile.consentRecord.id,
                      subjectName: profile.voiceProfile.consentRecord.subjectName,
                      expiresAt: profile.voiceProfile.consentRecord.expiresAt,
                      revokedAt: profile.voiceProfile.consentRecord.revokedAt,
                    }
                  : null,
              }
            : null
        }
      />
    </div>
  )
}
