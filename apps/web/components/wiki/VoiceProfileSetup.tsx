"use client"

import { useState, useTransition, useRef, useCallback, useEffect } from "react"
import { VoiceConsentForm } from "@/components/admin/VoiceConsentForm"
import { setVoiceEnabled, resetVoiceProfile, saveVoiceSettings } from "@/lib/actions/voice-profile"
import { resolveRecordingBlobMimeType, selectSupportedMimeType } from "@/components/agent/hooks/mime-probe"
import { useVoiceSynth } from "@/components/agent/hooks/useVoiceSynth"
import { LoaderCircle, Pause, Play, VolumeX } from "lucide-react"

interface ConsentRecord {
  id: string
  subjectName: string
  expiresAt: Date | string
  revokedAt: Date | string | null
}

interface VoiceTuning {
  speed?: number
  exaggeration?: number
  cfgWeight?: number
  temperature?: number
}

const TUNING_DEFAULTS: Required<VoiceTuning> = {
  speed: 1.0,
  exaggeration: 0.5,
  cfgWeight: 0.5,
  temperature: 0.8,
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
  voiceSettings?: VoiceTuning | null
}

interface Props {
  profileId: string
  profileName: string
  voiceEnabled: boolean
  currentUserId: string
  voiceProfile: VoiceProfileData | null
}

const PREVIEW_TEXT =
  "The platform recommends proceeding to build. The architecture is sound and the plan is ready for implementation."

export function VoiceProfileSetup({
  profileId,
  profileName,
  voiceEnabled,
  currentUserId,
  voiceProfile,
}: Props) {
  const [enabled, setEnabled] = useState(voiceEnabled)
  const [isPending, startTransition] = useTransition()
  const [resetting, setResetting] = useState(false)
  const voiceSynth = useVoiceSynth({ purpose: "preview" })

  // Per-profile voice tuning (sliders). Seed from saved settings, else defaults.
  const [tuning, setTuning] = useState<Required<VoiceTuning>>({
    ...TUNING_DEFAULTS,
    ...(voiceProfile?.voiceSettings ?? {}),
  })
  const [savingTuning, setSavingTuning] = useState(false)
  const [tuningSaved, setTuningSaved] = useState(false)

  const hasValidConsent =
    voiceProfile?.consentRecord &&
    !voiceProfile.consentRecord.revokedAt &&
    new Date(voiceProfile.consentRecord.expiresAt) > new Date()

  // Proactive TTS service liveness — surface an "offline" notice instead of a
  // "ready" profile whose Preview only reveals the failure after a click (the
  // click-to-discover latch in useVoiceSynth).
  const [serviceStatus, setServiceStatus] = useState<{ available: boolean; reason: string | null } | null>(null)

  useEffect(() => {
    if (voiceProfile?.status !== "ready") return
    let cancelled = false
    fetch("/api/voice/service-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setServiceStatus({ available: !!d.available, reason: d.reason ?? null })
      })
      .catch(() => {
        /* leave unknown — the button still falls back to call-time detection */
      })
    return () => {
      cancelled = true
    }
  }, [voiceProfile?.status])

  // "Offline" only once the probe returns negative; while unknown (null) or
  // positive, defer to the hook's call-time availability.
  const serviceOffline = serviceStatus?.available === false
  const previewAvailable = voiceSynth.available && !serviceOffline
  const previewReason = serviceOffline
    ? serviceStatus?.reason ?? "The text-to-speech service is not running."
    : voiceSynth.unavailableReason

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
          Configure a cloned voice for <strong>{profileName}</strong>. Once ready,
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
              A consent record is required before uploading a voice sample.
            </p>
            <VoiceConsentForm
              profileId={profileId}
              capturedByPrincipalId={currentUserId}
              onSuccess={() => window.location.reload()}
            />
          </div>
        )}
      </section>

      {/* Step 2: Upload or record reference audio */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${voiceProfile?.status === "ready" ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"}`}>
            {voiceProfile?.status === "ready" ? "✓" : "2"}
          </span>
          <h3 className="font-medium">Voice sample</h3>
        </div>

        {!hasValidConsent ? (
          <p className="text-sm text-muted-foreground pl-8">Complete step 1 first.</p>
        ) : voiceProfile?.status === "ready" ? (
          <>
          {serviceOffline && (
            <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3 text-sm">
              <p className="font-medium text-[var(--dpf-text)]">Voice service offline</p>
              <p className="mt-1 text-[var(--dpf-muted)]">
                {previewReason} The profile is ready, but narration cannot play until the service is running again.
              </p>
            </div>
          )}
          <div className="rounded-md border border-green-500/20 bg-green-500/5 px-4 py-3 text-sm flex flex-wrap items-center gap-3">
            <span>
              Voice profile ready.
              {voiceProfile.qualityScore && (
                <span className="ml-2 text-muted-foreground">
                  Quality: {Math.round(voiceProfile.qualityScore * 100)}%
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                if (!previewAvailable) return
                if (voiceSynth.isPlaying) {
                  voiceSynth.stop()
                } else {
                  voiceSynth.synthesize(PREVIEW_TEXT, profileId, tuning)
                }
              }}
              disabled={!previewAvailable || voiceSynth.isSynthesizing}
              aria-label={
                !previewAvailable
                  ? "Voice preview unavailable"
                  : voiceSynth.isPlaying
                    ? "Stop voice preview"
                    : "Preview voice"
              }
              title={
                !previewAvailable
                  ? previewReason ?? "Voice preview unavailable. Start the text-to-speech service or replace the voice sample."
                  : undefined
              }
              className="inline-flex items-center gap-1.5 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            >
              {!previewAvailable ? (
                <>
                  <VolumeX aria-hidden="true" size={13} strokeWidth={2} />
                  Voice unavailable
                </>
              ) : voiceSynth.isSynthesizing ? (
                <>
                  <LoaderCircle aria-hidden="true" size={13} strokeWidth={2} className="animate-spin" />
                  Synthesizing
                </>
              ) : voiceSynth.isPlaying ? (
                <>
                  <Pause aria-hidden="true" size={13} strokeWidth={2} />
                  Stop
                </>
              ) : (
                <>
                  <Play aria-hidden="true" size={13} strokeWidth={2} />
                  Preview voice
                </>
              )}
            </button>
            <button
              type="button"
              disabled={resetting}
              onClick={async () => {
                setResetting(true)
                await resetVoiceProfile(profileId)
                window.location.reload()
              }}
              className="inline-flex items-center gap-1.5 rounded border border-border bg-white/50 px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            >
              {resetting ? "Resetting…" : "↺ Replace voice sample"}
            </button>
          </div>

          {/* Voice tuning — adjust pace + expressiveness, hear via Preview above, then Save. */}
          <div className="mt-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Voice tuning</p>
              <button
                type="button"
                onClick={() => { setTuning(TUNING_DEFAULTS); setTuningSaved(false) }}
                className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              >
                Reset to default
              </button>
            </div>

            {([
              { key: "speed", label: "Speed", min: 0.5, max: 2.0, step: 0.01, hint: "slower ↔ faster" },
              { key: "exaggeration", label: "Enthusiasm", min: 0.25, max: 1.0, step: 0.01, hint: "calm ↔ energetic" },
              { key: "cfgWeight", label: "Pacing", min: 0.2, max: 1.0, step: 0.01, hint: "natural ↔ deliberate" },
              { key: "temperature", label: "Variation", min: 0.2, max: 1.2, step: 0.01, hint: "consistent ↔ varied" },
            ] as const).map(({ key, label, min, max, step, hint }) => (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between text-xs text-[var(--dpf-text)]">
                  <span className="font-medium">{label}</span>
                  <span className="text-[var(--dpf-muted)] tabular-nums">{tuning[key].toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={min} max={max} step={step}
                  value={tuning[key]}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    setTuning((t: Required<VoiceTuning>) => ({ ...t, [key]: v }))
                    setTuningSaved(false)
                  }}
                  className="w-full accent-[var(--dpf-accent)]"
                  aria-label={label}
                />
                <p className="text-[10px] text-[var(--dpf-muted)]">{hint}</p>
              </div>
            ))}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  setSavingTuning(true)
                  startTransition(async () => {
                    await saveVoiceSettings(profileId, tuning)
                    setSavingTuning(false)
                    setTuningSaved(true)
                  })
                }}
                disabled={savingTuning}
                className="rounded bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {savingTuning ? "Saving…" : "Save tuning"}
              </button>
              <span className="text-xs text-[var(--dpf-muted)]">
                {tuningSaved ? "Saved — used for all narration." : "Use Preview above to hear changes before saving."}
              </span>
            </div>
          </div>
          </>
        ) : (
          <VoiceSampleCapture profileId={profileId} />
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

// ─── Voice Sample Capture ─────────────────────────────────────────────────────
// Record from mic or upload a file — both POST to /api/voice/reference.

type CaptureMode = "record" | "upload"
type RecordState = "idle" | "permission" | "recording" | "preview" | "uploading" | "error"

function VoiceSampleCapture({ profileId }: { profileId: string }) {
  const [mode, setMode] = useState<CaptureMode>("record")

  return (
    <div className="rounded-md border border-border p-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        Provide about 6–12 seconds of clean, single-speaker speech in a quiet room, spoken at your natural conversational pace. Your voice is cloned immediately — no training wait.
      </p>

      {/* Mode toggle */}
      <div className="flex gap-1 rounded-md border border-border p-1 w-fit text-xs">
        <button
          onClick={() => setMode("record")}
          className={`px-3 py-1.5 font-medium rounded transition-colors ${mode === "record" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          🎙 Record from mic
        </button>
        <button
          onClick={() => setMode("upload")}
          className={`px-3 py-1.5 font-medium rounded transition-colors ${mode === "upload" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          ↑ Upload file
        </button>
      </div>

      {mode === "record" ? (
        <MicRecorder profileId={profileId} />
      ) : (
        <ReferenceUploadForm profileId={profileId} />
      )}
    </div>
  )
}

// ─── Mic recorder ─────────────────────────────────────────────────────────────

// Zero-shot cloning quality scales with reference length: a 3s clip clones
// poorly and aggravates model instability. ~15-30s of clean, continuous speech
// is the recipe sweet spot. Gate stop at the minimum; recommend the range.
const MIN_RECORDING_SECONDS = 15
const RECOMMENDED_MAX_SECONDS = 30

function MicRecorder({ profileId }: { profileId: string }) {
  const [recState, setRecState] = useState<RecordState>("idle")
  const [error, setError] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [showScript, setShowScript] = useState(true)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  const cleanup = useCallback(() => {
    stopTimer()
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []
  }, [stopTimer])

  const startRecording = async () => {
    setError(null)
    setAudioUrl(null)
    setAudioBlob(null)
    setElapsed(0)
    setRecState("permission")

    try {
      // Capture recipe for good zero-shot cloning: clean, single-speaker audio.
      // echo/noise/gain processing lifts SNR on laptop mics in untreated rooms,
      // which every cloning model depends on; 48 kHz mono is the capture ideal
      // (downsampled server-side as needed).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      })
      streamRef.current = stream

      const mimeType = selectSupportedMimeType() ?? undefined
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        // Tag the blob with the container the recorder ACTUALLY produced so the
        // <audio> preview can decode it (see resolveRecordingBlobMimeType).
        const blob = new Blob(chunksRef.current, {
          type: resolveRecordingBlobMimeType(recorder.mimeType, mimeType),
        })
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)
        setAudioBlob(blob)
        setRecState("preview")
        cleanup()
      }

      recorder.start(250)
      setRecState("recording")
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone access failed"
      setError(msg.toLowerCase().includes("denied")
        ? "Microphone permission denied. Allow access in your browser settings and try again."
        : msg)
      setRecState("error")
      cleanup()
    }
  }

  const stopRecording = () => {
    stopTimer()
    recorderRef.current?.stop()
  }

  const discardPreview = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    setAudioBlob(null)
    setRecState("idle")
    setElapsed(0)
  }

  const submitRecording = async () => {
    if (!audioBlob) return
    setRecState("uploading")
    setError(null)

    const body = new FormData()
    body.append("voiceProfileId", profileId)
    body.append("audio", audioBlob, "recording.webm")

    try {
      const res = await fetch("/api/voice/reference", { method: "POST", body })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? `Upload failed (${res.status})`)
        setRecState("preview")
      } else {
        window.location.reload()
      }
    } catch {
      setError("Network error — try again.")
      setRecState("preview")
    }
  }

  // Browser support check
  if (typeof navigator === "undefined"
    || !navigator.mediaDevices?.getUserMedia
    || typeof MediaRecorder === "undefined") {
    return <p className="text-sm text-muted-foreground">Microphone recording is not available in this browser. Use "Upload file" instead.</p>
  }

  return (
    <div className="space-y-3">
      {/* Suggested script */}
      {showScript && recState !== "preview" && recState !== "uploading" && (
        <div className="rounded-md bg-muted/50 border border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Suggested script</p>
            <button onClick={() => setShowScript(false)} className="text-xs text-muted-foreground hover:text-foreground">dismiss</button>
          </div>
          <p className="text-sm text-muted-foreground italic leading-relaxed">
            "My name is [your name], and I consent to this voice being used for
            AI-narrated decision feedback. I'm speaking at my normal pace so the
            system learns how I really sound."
          </p>
          <p className="text-xs text-muted-foreground">
            Read it once at a natural, conversational pace (~{MIN_RECORDING_SECONDS}–{RECOMMENDED_MAX_SECONDS}s).
            Keep it short — a quiet room and your everyday speaking voice give the
            best clone. A long or slowly-read clip makes the cloned voice drawl.
          </p>
        </div>
      )}

      {recState === "idle" && (
        <button
          onClick={startRecording}
          className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          <span className="h-2 w-2 rounded-full bg-white/70" />
          Start recording
        </button>
      )}

      {recState === "permission" && (
        <p className="text-sm text-muted-foreground">Requesting microphone access…</p>
      )}

      {recState === "recording" && (
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-sm font-medium text-red-500">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
            Recording — {elapsed}s
          </span>
          <button
            onClick={stopRecording}
            disabled={elapsed < MIN_RECORDING_SECONDS}
            className="rounded border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            {elapsed < MIN_RECORDING_SECONDS
              ? `Stop (${MIN_RECORDING_SECONDS - elapsed}s min)`
              : "Stop"}
          </button>
          {elapsed >= MIN_RECORDING_SECONDS && elapsed < RECOMMENDED_MAX_SECONDS && (
            <span className="text-xs text-muted-foreground">
              Good — keep going to ~{RECOMMENDED_MAX_SECONDS}s for the best clone.
            </span>
          )}
        </div>
      )}

      {recState === "preview" && audioUrl && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Preview ({elapsed}s recorded)</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={audioUrl} className="w-full h-9" />
          <div className="flex gap-2">
            <button
              onClick={submitRecording}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Register voice
            </button>
            <button
              onClick={discardPreview}
              className="rounded border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Record again
            </button>
          </div>
        </div>
      )}

      {recState === "uploading" && (
        <p className="text-sm text-muted-foreground">Registering voice with Chatterbox…</p>
      )}

      {(recState === "error" || error) && (
        <div className="space-y-2">
          {error && <p className="text-sm text-red-500">{error}</p>}
          {recState === "error" && (
            <button onClick={() => { setRecState("idle"); setError(null) }} className="text-xs text-muted-foreground underline">
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── File upload form ──────────────────────────────────────────────────────────

function ReferenceUploadForm({ profileId }: { profileId: string }) {
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
    body.append("audio", file)

    try {
      const res = await fetch("/api/voice/reference", { method: "POST", body })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? `Upload failed (${res.status})`)
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
        {uploading ? "Uploading…" : "Register voice"}
      </button>
    </form>
  )
}
