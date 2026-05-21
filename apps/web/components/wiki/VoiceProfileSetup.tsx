"use client"

import { useState, useTransition } from "react"
import { VoiceConsentForm } from "@/components/admin/VoiceConsentForm"
import { VoiceTrainingStatus } from "@/components/admin/VoiceTrainingStatus"
import { setVoiceEnabled } from "@/lib/actions/voice-profile"

interface ConsentRecord {
  id: string
  subjectName: string
  expiresAt: Date | string
  revokedAt: Date | string | null
}

interface TrainingJob {
  id: string
  status: string
  errorMessage: string | null
  createdAt: Date | string
  completedAt: Date | string | null
}

interface VoiceProfileData {
  id: string
  provider: string
  providerVoiceId: string | null
  status: string
  consentType: string
  qualityScore: number | null
  language: string
  consentRecord: ConsentRecord | null
  trainingJobs: TrainingJob[]
}

interface Props {
  profileId: string
  profileName: string
  voiceEnabled: boolean
  currentUserId: string
  voiceProfile: VoiceProfileData | null
}

export function VoiceProfileSetup({
  profileId,
  profileName,
  voiceEnabled,
  currentUserId,
  voiceProfile,
}: Props) {
  const [enabled, setEnabled] = useState(voiceEnabled)
  const [isPending, startTransition] = useTransition()

  const latestJob = voiceProfile?.trainingJobs[0]
  const hasValidConsent =
    voiceProfile?.consentRecord &&
    !voiceProfile.consentRecord.revokedAt &&
    new Date(voiceProfile.consentRecord.expiresAt) > new Date()

  const handleToggle = () => {
    const next = !enabled
    setEnabled(next)
    startTransition(async () => {
      await setVoiceEnabled(profileId, next)
    })
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <h2 className="text-lg font-semibold">Voice Profile</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure a cloned voice for <strong>{profileName}</strong>. Once trained,
          WWMD gate decisions will be narrated in this voice.
        </p>
      </div>

      {/* Enable toggle — only show when voice is ready */}
      {voiceProfile?.status === "ready" && (
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="font-medium text-sm">Voice narration</p>
            <p className="text-xs text-muted-foreground">
              Narrate WWMD decision rationale using this voice profile
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={isPending}
            aria-label={enabled ? "Disable voice" : "Enable voice"}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              enabled ? "bg-primary" : "bg-muted"
            } ${isPending ? "opacity-50" : ""}`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      )}

      {/* Step 1: Consent */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${hasValidConsent ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"}`}>
            {hasValidConsent ? "✓" : "1"}
          </span>
          <h3 className="font-medium">Consent record</h3>
        </div>

        {hasValidConsent ? (
          <div className="rounded-md border border-green-500/20 bg-green-500/5 px-4 py-3 text-sm">
            Consent on file for <strong>{voiceProfile!.consentRecord!.subjectName}</strong>.
            Expires {new Date(voiceProfile!.consentRecord!.expiresAt).toLocaleDateString()}.
          </div>
        ) : (
          <div className="rounded-md border border-border p-4">
            <p className="text-sm text-muted-foreground mb-4">
              A consent record is required before uploading voice samples.
            </p>
            <VoiceConsentForm
              capturedByPrincipalId={currentUserId}
              onSuccess={() => window.location.reload()}
            />
          </div>
        )}
      </section>

      {/* Step 2: Upload & Train */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${voiceProfile?.status === "ready" ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"}`}>
            {voiceProfile?.status === "ready" ? "✓" : "2"}
          </span>
          <h3 className="font-medium">Voice samples</h3>
        </div>

        {!hasValidConsent ? (
          <p className="text-sm text-muted-foreground pl-8">Complete step 1 first.</p>
        ) : voiceProfile?.status === "ready" ? (
          <div className="rounded-md border border-green-500/20 bg-green-500/5 px-4 py-3 text-sm">
            Voice profile ready.
            {voiceProfile.qualityScore && (
              <span className="ml-2 text-muted-foreground">
                Quality: {Math.round(voiceProfile.qualityScore * 100)}%
              </span>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-border p-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload 10–30 seconds of clean audio or video. Cartesia Sonic 3 will clone
              the voice. Minimum: 3 seconds of clear speech with low background noise.
            </p>

            {latestJob && (
              <VoiceTrainingStatus
                status={latestJob.status as any}
                errorMessage={latestJob.errorMessage ?? undefined}
              />
            )}

            {(!latestJob || latestJob.status === "failed") && (
              <TrainingUploadForm profileId={profileId} consentRecordId={voiceProfile?.consentRecord?.id} />
            )}
          </div>
        )}
      </section>

      {/* Step 3: Activate */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${enabled && voiceProfile?.status === "ready" ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"}`}>
            {enabled && voiceProfile?.status === "ready" ? "✓" : "3"}
          </span>
          <h3 className="font-medium">Activate</h3>
        </div>
        <p className="text-sm text-muted-foreground pl-8">
          {voiceProfile?.status === "ready"
            ? enabled
              ? "Voice narration is active. The next WWMD gate decision will play audio."
              : "Toggle voice narration on above to activate."
            : "Complete steps 1 and 2 first."}
        </p>
      </section>
    </div>
  )
}

// Minimal upload form — posts to /api/voice/train
function TrainingUploadForm({
  profileId,
  consentRecordId,
}: {
  profileId: string
  consentRecordId?: string
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setUploading(true)
    setError(null)
    const form = e.currentTarget
    const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]')
    const file = fileInput?.files?.[0]
    if (!file) { setError("Select an audio or video file."); setUploading(false); return }

    const body = new FormData()
    body.append("voiceProfileId", profileId)
    if (consentRecordId) body.append("consentRecordId", consentRecordId)
    body.append("audio", file)

    try {
      const res = await fetch("/api/voice/train", { method: "POST", body })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Upload failed (${res.status})`)
      } else {
        window.location.reload()
      }
    } catch {
      setError("Network error — try again.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="file"
        accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov,.webm"
        className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
        required
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={uploading}
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {uploading ? "Uploading…" : "Start training"}
      </button>
    </form>
  )
}
