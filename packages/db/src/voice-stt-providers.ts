/**
 * Transcription (speech-to-text) provider configuration.
 *
 * Owning spec: docs/superpowers/specs/2026-09-09-speech-provider-managed-design.md
 * Supersedes the sidecar hosting decision in
 * docs/superpowers/specs/2026-05-17-voice-input-slice-1-5-default-on-cpu.md.
 *
 * ## Speech is provider-managed, not a shipped container (BI-F7E9A541)
 *
 * DPF used to ship a digest-pinned third-party whisper image as the `dpf-stt`
 * sidecar and seed it as the one transcription endpoint. That image was the only
 * digest-pinned third-party image in shipped Compose, and because the release
 * manifest guard deliberately covers images behind optional profiles, whenever
 * its publisher re-pushed `:latest` and pruned the old index digest the guard
 * failed, install verification failed, and the `:latest` pointer stopped
 * advancing for every install. The digest rotted three times.
 *
 * Speech-to-text now belongs to the "External — provider managed" class already
 * defined in docs/architecture/capability-driven-runtime-profiles.md: provider
 * configuration determines availability, and there is no local container.
 *
 * ## How enablement works
 *
 * No new machinery. `resolveTranscriptionEndpoint` (apps/web/lib/voice/
 * endpoint-resolution.ts) already walks EndpointTaskPerformance rows for
 * taskType="transcription" and SKIPS any whose ModelProfile is not active or
 * whose provider status is not active/degraded. So seeding a profile per
 * OpenAI-compatible provider is sufficient: configuring one of those providers
 * makes voice input work, and leaving it unconfigured leaves it inert. There is
 * no separate speech toggle and no Compose profile to flip.
 *
 * ## Which providers
 *
 * The transcription execution adapter (apps/web/lib/routing/
 * transcription-adapter.ts) speaks exactly one wire format: multipart POST to
 * `{baseUrl}/v1/audio/transcriptions`. Every provider below serves it. Gemini's
 * audio API is a different shape and would need its own adapter; Anthropic has
 * no audio input at all.
 *
 * Ordering honours the prefer-self-hosted-infrastructure kernel principle: a
 * configured self-hosted endpoint outranks a hosted one. See
 * SEED_PREFERENCE_SCORE below for why that is expressed as a score.
 */

/** Operator-supplied, self-hosted OpenAI-compatible endpoint. */
export const SELF_HOSTED_STT_PROVIDER_ID = "speaches" as const;

/**
 * Retained alias. The provider row keeps the `speaches` id for continuity with
 * existing installs; its registry entry is now an operator-supplied base URL
 * rather than a DPF-shipped service.
 */
export const SPEACHES_PROVIDER_ID = SELF_HOSTED_STT_PROVIDER_ID;

/** Task type used in EndpointTaskPerformance + routing dispatch. */
export const TRANSCRIPTION_TASK_TYPE = "transcription" as const;

/**
 * Seed-time preference prior, not a quality measurement.
 *
 * `resolveTranscriptionEndpoint` orders by (pinned, avgOrchestratorScore,
 * evaluationCount). With every seeded baseline at zero those keys tie and the
 * database returns an arbitrary winner, so an install with two configured
 * providers would pick unpredictably. A small distinct prior makes the default
 * order deterministic and encodes the kernel's self-hosted preference. Real
 * telemetry overwrites these as soon as traffic flows — they are a tie-break,
 * never a claim about accuracy.
 */
const SEED_PREFERENCE_SCORE = {
  selfHosted: 3,
  hostedAccurate: 2,
  hostedFast: 1,
} as const;

type TranscriptionModelSeed = {
  providerId: string;
  modelId: string;
  friendlyName: string;
  summary: string;
  capabilityCategory: string;
  costTier: "$" | "$$" | "$$$";
  bestFor: string[];
  avoidFor: string[];
  maxContextTokens: number;
  maxOutputTokens: number;
  preferenceScore: number;
};

/**
 * Shared ModelProfile fields for every transcription model.
 *
 * Score fields (reasoning / codegen / etc.) default to neutral 50 in the schema
 * and have no meaningful interpretation for an ASR model; the transcription
 * call-site does not score against them. `modelClass`, `inputModalities`,
 * `outputModalities` and `capabilities.transcription` are the fields downstream
 * code should look at to identify an STT model.
 */
export const TRANSCRIPTION_PROFILE_COMMON = {
  modelClass: "transcription",
  modelStatus: "active" as const,
  generatedBy: "system:seed",
  profileSource: "seed" as const,
  profileConfidence: "medium" as const,
  supportsToolUse: false,
  inputModalities: ["audio"],
  outputModalities: ["text"],
  capabilities: {
    transcription: true,
    streaming: false,
    toolUse: false,
    structuredOutput: false,
  },
} as const;

/**
 * Every transcription model DPF seeds. Each becomes a ModelProfile plus an
 * EndpointTaskPerformance baseline; each stays inert until its provider is
 * configured and active.
 */
export const TRANSCRIPTION_MODEL_SEEDS: readonly TranscriptionModelSeed[] = [
  {
    providerId: SELF_HOSTED_STT_PROVIDER_ID,
    modelId: "base",
    friendlyName: "Self-hosted Whisper",
    summary:
      "Whisper served by a speech server you run yourself, reached over an OpenAI-compatible /v1/audio/transcriptions endpoint. Audio never leaves your infrastructure. Supply the base URL in provider settings; speaches and whisper.cpp server are both MIT-licensed and known to work.",
    capabilityCategory: "basic",
    costTier: "$",
    bestFor: ["transcription", "dictation", "voice-notes", "regulated-data"],
    avoidFor: ["chat", "reasoning", "tool-use"],
    // Whisper processes 30s audio segments with a 224-token bias frame.
    maxContextTokens: 224,
    maxOutputTokens: 4096,
    preferenceScore: SEED_PREFERENCE_SCORE.selfHosted,
  },
  {
    providerId: "openai",
    modelId: "gpt-4o-mini-transcribe",
    friendlyName: "GPT-4o mini Transcribe",
    summary:
      "OpenAI's hosted speech-to-text. Higher accuracy than Whisper base on noisy input and accented speech, at a per-minute cost. Audio is sent to OpenAI, so it is gated by the bias-classification check before dispatch.",
    capabilityCategory: "moderate",
    costTier: "$$",
    bestFor: ["transcription", "dictation", "voice-notes"],
    avoidFor: ["chat", "reasoning", "tool-use", "regulated-data"],
    maxContextTokens: 224,
    maxOutputTokens: 4096,
    preferenceScore: SEED_PREFERENCE_SCORE.hostedAccurate,
  },
  {
    providerId: "groq",
    modelId: "whisper-large-v3-turbo",
    friendlyName: "Whisper large v3 Turbo (Groq)",
    summary:
      "Whisper large v3 Turbo on Groq's inference hardware. The fastest hosted option by a wide margin, useful when an install has neither a GPU nor spare CPU. Audio is sent to Groq, so it is gated by the bias-classification check before dispatch.",
    capabilityCategory: "moderate",
    costTier: "$",
    bestFor: ["transcription", "dictation", "voice-notes", "low-latency"],
    avoidFor: ["chat", "reasoning", "tool-use", "regulated-data"],
    maxContextTokens: 224,
    maxOutputTokens: 4096,
    preferenceScore: SEED_PREFERENCE_SCORE.hostedFast,
  },
] as const;

/**
 * EndpointTaskPerformance baseline for a seeded transcription profile.
 *
 * evaluationCount=0 is intentional: no traffic has been observed yet.
 * avgOrchestratorScore carries the seed preference prior described above.
 */
export function transcriptionEndpointBaseline(preferenceScore: number) {
  return {
    taskType: TRANSCRIPTION_TASK_TYPE,
    evaluationCount: 0,
    successCount: 0,
    avgOrchestratorScore: preferenceScore,
    recentScores: [],
    instructionPhase: "learning",
    pinned: false,
    blocked: false,
    avgLatencyMs: 0,
    avgTokensUsed: 0,
    profileConfidence: "medium" as const,
    dimensionScores: {},
  } as const;
}

/**
 * Model ids that older installs seeded against the removed sidecar and which
 * must be cleaned up so endpoint resolution cannot select a dead endpoint.
 * "Systran/faster-distil-whisper-large-v3" was the original speaches model;
 * both predate the provider-managed shape.
 */
export const RETIRED_SIDECAR_MODEL_IDS: readonly string[] = [
  "Systran/faster-distil-whisper-large-v3",
] as const;
