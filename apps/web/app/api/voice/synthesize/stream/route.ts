// POST /api/voice/synthesize/stream
// Streaming TTS endpoint — proxies to the sidecar's /v1/audio/speech/stream.
// Response: application/octet-stream, chunked: [4B uint32 len][WAV bytes]…
// Each chunk is a complete WAV for one sentence; time-to-first-audio ≈ 1-2s.
//
// Auth, voice-profile resolution, and settings merge follow the same logic as
// /api/voice/synthesize (the one-shot sibling route).

import { auth } from "@/lib/auth"
import { prisma } from "@dpf/db"
import { defaultProvider, synthesizeSpeech, VoiceSynthesisError } from "@/lib/voice-synthesis/voice-service"
import { resolveVoiceStorageRoot } from "@/lib/voice-synthesis/storage-root"
import { DEFAULT_REF_TEXT, resolveReferenceHostPath } from "@/lib/voice-synthesis/adapters/mlx"
import * as fs from "node:fs/promises"
import * as path from "node:path"

/**
 * Frame a WAV buffer as the client's length-prefixed chunk: [4-byte BE length][WAV].
 * Matches the framing useVoiceSynth.parseNextChunk decodes, so a single one-shot
 * clip plays identically to a streamed one — just not sentence-by-sentence.
 */
function frameWavChunk(audio: ArrayBuffer): Buffer {
  const wav = Buffer.from(audio)
  const header = Buffer.alloc(4)
  header.writeUInt32BE(wav.length, 0)
  return Buffer.concat([header, wav])
}

interface StreamBody {
  text: string
  voiceProfileId?: string
  settings?: {
    speed?: number
    exaggeration?: number
    cfgWeight?: number
    temperature?: number
  }
}

function getTtsStreamUrl(): string {
  const base = process.env.DPF_TTS_URL ?? "http://host.docker.internal:8771"
  return `${base}/v1/audio/speech/stream`
}

const clamp = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined

function resolveSettings(stored: unknown, override: StreamBody["settings"]) {
  const base = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>
  const ov = (override ?? {}) as Record<string, unknown>
  const pick = (k: string) => (ov[k] !== undefined ? ov[k] : base[k])
  const out = {
    speed: clamp(pick("speed"), 0.5, 2.0),
    exaggeration: clamp(pick("exaggeration"), 0.25, 1.0),
    cfgWeight: clamp(pick("cfgWeight"), 0.2, 1.0),
    temperature: clamp(pick("temperature"), 0.2, 1.2),
  }
  return Object.values(out).some((v) => v !== undefined) ? out : undefined
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: StreamBody
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { text, voiceProfileId, settings: overrideSettings } = body
  if (!text?.trim()) {
    return Response.json({ error: "text is required" }, { status: 400 })
  }

  // Resolve voice profile (same logic as the one-shot sibling route).
  let voiceProfile: {
    provider: string
    providerVoiceId: string | null
    status: string
    language: string
    voiceSettings: unknown
  } | null = null

  try {
    if (voiceProfileId) {
      voiceProfile = await prisma.voiceProfile.findUnique({
        where: { profileId: voiceProfileId },
        select: { provider: true, providerVoiceId: true, status: true, language: true, voiceSettings: true },
      })
    } else {
      voiceProfile = await prisma.voiceProfile.findFirst({
        where: { status: "ready", profile: { voiceEnabled: true } },
        select: { provider: true, providerVoiceId: true, status: true, language: true, voiceSettings: true },
        orderBy: { updatedAt: "desc" },
      })
    }
  } catch {
    return Response.json({ error: "Failed to resolve voice profile" }, { status: 500 })
  }

  if (!voiceProfile || voiceProfile.status !== "ready" || !voiceProfile.providerVoiceId) {
    return Response.json(
      { error: "No ready voice profile found.", code: "no_voice_profile" },
      { status: 422 },
    )
  }

  const settings = resolveSettings(voiceProfile.voiceSettings, overrideSettings)
  const provider = defaultProvider()

  // ── Non-streaming providers: one-shot fallback ────────────────────────────
  // Only the MLX host sidecar implements /v1/audio/speech/stream. The default
  // self-hosted Chatterbox sidecar (dpf-tts:8000) exposes only /v1/audio/speech
  // and /v1/audio/speech/upload — no streaming endpoint — and the hosted
  // adapters (cartesia, fish-audio) have their own one-shot APIs. Proxying
  // /stream to any of them 404s, which is why coworker voice never played on the
  // default Chatterbox install. Synthesize the whole clip once via the shared
  // voice-service (zero-shot clone from the stored reference audio) and emit it
  // as a SINGLE length-prefixed chunk in the framing useVoiceSynth expects, so
  // the client plays it identically — just without sentence-by-sentence streaming.
  if (provider !== "mlx") {
    let referenceAudioBuffer: Buffer | undefined
    try {
      const absPath = path.join(resolveVoiceStorageRoot(), voiceProfile.providerVoiceId)
      referenceAudioBuffer = await fs.readFile(absPath)
    } catch {
      return Response.json(
        { error: "Reference audio not found — please re-register your voice sample.", code: "reference_missing" },
        { status: 422 },
      )
    }
    try {
      const result = await synthesizeSpeech(text.trim(), {
        provider,
        providerVoiceId: voiceProfile.providerVoiceId,
        language: voiceProfile.language,
        referenceAudioBuffer,
        settings,
      } as Parameters<typeof synthesizeSpeech>[1])
      return new Response(new Uint8Array(frameWavChunk(result.audioBuffer)), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Sentence-Count": "1",
          "X-Voice-Provider": result.provider,
        },
      })
    } catch (err) {
      const status = err instanceof VoiceSynthesisError && err.statusCode ? err.statusCode : 503
      console.warn("[voice/stream] one-shot synthesis failed:", err)
      return Response.json(
        { error: "Voice synthesis unavailable", code: "tts_unavailable" },
        { status: status >= 500 ? 503 : status },
      )
    }
  }

  // ── MLX streaming path ─────────────────────────────────────────────────────
  // Build the body for the sidecar's streaming endpoint.
  const sidecarBody: Record<string, unknown> = {
    input: text.trim(),
    response_format: "wav",
    speed: settings?.speed ?? 1.0,
  }

  const refPath = resolveReferenceHostPath(voiceProfile.providerVoiceId)
  if (refPath) {
    sidecarBody.ref_audio = refPath
    sidecarBody.ref_text = DEFAULT_REF_TEXT
    if (settings?.exaggeration !== undefined) sidecarBody.exaggeration = settings.exaggeration
    if (settings?.cfgWeight !== undefined) sidecarBody.cfg_weight = settings.cfgWeight
    sidecarBody.temperature = settings?.temperature ?? 0.6
  }

  // Proxy to the sidecar's streaming endpoint and pass the response through.
  let sidecarRes: Response
  try {
    sidecarRes = await fetch(getTtsStreamUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sidecarBody),
    })
  } catch (err) {
    console.warn("[voice/stream] sidecar fetch failed:", err)
    return Response.json(
      { error: "Voice synthesis unavailable", code: "tts_unavailable" },
      { status: 503 },
    )
  }

  if (!sidecarRes.ok) {
    console.warn("[voice/stream] sidecar error:", sidecarRes.status)
    return Response.json(
      { error: "Voice synthesis unavailable", code: "tts_unavailable" },
      { status: 503 },
    )
  }

  // Stream the sidecar response directly to the client.
  return new Response(sidecarRes.body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Sentence-Count": sidecarRes.headers.get("X-Sentence-Count") ?? "?",
    },
  })
}
