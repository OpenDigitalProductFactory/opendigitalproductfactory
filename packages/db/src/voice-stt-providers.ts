/**
 * Voice Input Slice 1 / Task 2 — speaches transcription provider config.
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md
 *
 * Constants consumed by the seed function (packages/db/src/seed.ts) and by the
 * routing/transcription call-site (apps/web/lib/voice/transcribe.ts in Task 6).
 * Defined as a typed data module so shape can be validated without touching the
 * database — mirrors the pattern of agent-model-defaults.ts.
 *
 * Per spec §6.0 + plan Task 2: speaches is a TRANSCRIPTION-only provider, not
 * a chat LLM. Its ModelProvider row carries endpointType: "transcription"
 * (set in packages/db/data/providers-registry.json) so the LLM routing layer
 * (loader.loadEndpointManifests filters where endpointType: "llm") does NOT
 * pick it up for chat traffic.
 */

export const SPEACHES_PROVIDER_ID = "speaches" as const;
export const SPEACHES_MODEL_ID = "Systran/faster-distil-whisper-large-v3" as const;

/** Task type used in EndpointTaskPerformance + routing dispatch. */
export const TRANSCRIPTION_TASK_TYPE = "transcription" as const;

/** Per plan Gate 3 decision — speaches maps to the "small" capability tier
 *  by default. Hosted providers (Groq, Deepgram) slot into "high-accuracy"
 *  / "streaming" tiers when an admin connects them. */
export const SPEACHES_CAPABILITY_TIER = "basic" as const;

/**
 * ModelProfile config for the speaches default model. The seed function
 * upserts this against (providerId, modelId).
 *
 * Score fields (reasoning / codegen / etc.) are set to neutral 50 because
 * the ModelProfile schema requires them with default 50; they don't have
 * meaningful interpretation for an ASR-only model and the transcription
 * call-site does not score against them. Conversational quality is scored
 * via EndpointTaskPerformance with taskType="transcription" once real
 * traffic flows.
 *
 * inputModalities=["audio"] / outputModalities=["text"] / modelClass="transcription"
 * are the fields downstream code SHOULD look at to identify an STT model.
 */
export const SPEACHES_MODEL_PROFILE_CONFIG = {
  providerId: SPEACHES_PROVIDER_ID,
  modelId: SPEACHES_MODEL_ID,
  friendlyName: "Faster Distil-Whisper Large v3",
  summary:
    "Distilled Whisper Large v3 served via the Speaches sidecar — Whisper-quality transcription at ~6× real-time. The Slice 1 default speech-to-text engine.",
  capabilityCategory: "basic",
  costTier: "$" as const,
  bestFor: ["transcription", "dictation", "voice-notes"],
  avoidFor: ["chat", "reasoning", "tool-use"],
  modelClass: "transcription",
  modelStatus: "active" as const,
  generatedBy: "system:seed",
  profileSource: "seed" as const,
  profileConfidence: "medium" as const,
  // Whisper-large-v3 context (30s audio segments processed in 224-token bias frames).
  maxContextTokens: 224,
  maxOutputTokens: 4096,
  supportsToolUse: false,
  inputModalities: ["audio"],
  outputModalities: ["text"],
  capabilities: {
    transcription: true,
    streaming: false,   // Slice 1 ships batch; streaming is deferred to Slice 4
    toolUse: false,
    structuredOutput: false,
  },
} as const;

/**
 * EndpointTaskPerformance baseline for (speaches profile, taskType=transcription).
 * The seed function looks up the profile's cuid after upsert and uses it as
 * endpointId. evaluationCount=0 and avgOrchestratorScore=0 are intentional —
 * real scores flow in once telemetry from Slice 1 traffic starts arriving.
 *
 * profileConfidence: "medium" reflects the upstream model (distil-whisper-large-v3)
 * being a well-known quantity, not the zero-eval state of this row.
 */
export const SPEACHES_ENDPOINT_PERFORMANCE_BASELINE = {
  taskType: TRANSCRIPTION_TASK_TYPE,
  evaluationCount: 0,
  successCount: 0,
  avgOrchestratorScore: 0,
  recentScores: [],
  instructionPhase: "learning",
  pinned: false,
  blocked: false,
  avgLatencyMs: 0,
  avgTokensUsed: 0,
  profileConfidence: "medium" as const,
  dimensionScores: {},
} as const;
