# Persona Voice Layer & WWTD Profiles Design

| Field | Value |
| --- | --- |
| Date | 2026-05-19 |
| Status | Draft for review |
| Working title | Persona Voice Layer & WWTD — Voice Modality for Decision Perspective Profiles |
| Primary v1 surface | Build Studio Decision Perspective Gate Panel (audio output) |
| Related epics | `EP-COWORKER-RT`, `EP-WWMD`, `EP-VOICE-LAYER` (new) |
| Related docs | `2026-05-17-wwmd-decision-perspective-kernel-design.md`, `2026-05-11-autonomous-coworker-runtime-design.md`, `2026-04-30-ai-coworker-operator-pattern.md` |

## 1. Purpose

This spec extends the Decision Perspective Kernel in two directions that are related but separable.

**WWTD (What Would They Do)** extends the `DecisionPerspectiveProfile` model to support personas other than Mark. A WWTD profile can represent a real person (an executive, a domain expert, a historical figure), a fictional persona, or a synthesized organizational archetype. Like WWMD, WWTD is not a personality chatbot and not an imitation layer. It is a governed decision perspective service backed by curated principle materials, with a generation style layer that shapes how the LLM expresses the rationale, and an optional voice layer that narrates the output in the persona's voice.

**Voice Modality** adds audio as a first-class output medium for decision perspective responses, and a complementary audio input path (speech-to-text) for the broader coworker interface. These two directions — output (TTS) and input (STT) — share the same infrastructure and must be designed together. Building TTS output without STT input infrastructure produces an asymmetric audio system that is more expensive to complete later.

The three layers of a persona are distinct and independently optional:

| Layer | What it is | Required for WWTD |
| --- | --- | --- |
| **Decision materials** | Principles, decisions, writings that encode how this person thinks | Yes |
| **Generation style** | A persona prompt that guides the LLM's phrasing and cadence | Recommended |
| **Voice timbre** | A cloned voice that narrates the output audio | Optional; opt-in per profile |

## 2. Product Thesis

The current WWMD gate produces a text rationale. That rationale is correct and auditable but passive — the operator reads it. Voice makes the perspective active: the person hears Mark (or the relevant persona) explain the decision in their own voice and cadence.

This matters for three reasons:

1. **Cognitive load**: Listening while reviewing a plan is easier than reading two things simultaneously. Audio rationale frees attention for the plan text itself.
2. **Authority signal**: Hearing the founder's voice narrate a decision carries different weight than reading text attributed to a profile. The intent is not theater — it is increasing the clarity of whose perspective is speaking.
3. **WWTD reach**: A customer organization can encode their CEO's decision philosophy as a WWTD profile, then hear that CEO's voice arbitrating ambiguous Build Studio gates. This is not possible with any commercial platform today.

The STT input path extends this to full voice interaction: operators can speak to coworkers rather than type, with Whisper-class transcription feeding the existing coworker message pipeline.

**Non-negotiable boundary**: voice is a presentation layer. It does not change the decision logic, the confidence model, the escalation rules, or the governance authority. A WWTD profile with a celebrity voice clone still follows the same `recommend / arbitrate / escalate / defer` rules as every other profile. Voice makes the output richer; it does not make the profile more authoritative.

## 3. Scope and Identity

### 3.1 What Is In V1

- **TTS output** for `DecisionInteraction.rationale` — async synthesis job after each gate invocation
- **Voice profile management** — upload samples, run training job, store provider voice ID, linked to `DecisionPerspectiveProfile`
- **Audio player** in `DecisionPerspectiveGatePanel` — plays synthesized rationale audio
- **Voice tier config** — cloud (Cartesia Sonic 3 default) vs. self-hosted (Fish Audio S2 / XTTS v2) provider setting, mirroring the existing LLM provider tier pattern
- **WWTD profile kind** — new `kind` values on `DecisionPerspectiveProfile`: `persona-real`, `persona-fictional`, `persona-synthetic`
- **Generation style field** — `personaConfig.systemPrompt` added to profiles; LLM rationale generation uses this as a style layer
- **Consent capture UI** — required for any real person's voice; structured consent record stored before training job runs
- **Preprocessing pipeline** — video → audio extraction (FFmpeg) → vocal isolation (optional) → provider training call

### 3.2 What Is Deferred

- **Real-time voice conversation** — live back-and-forth with a coworker using voice. Requires streaming TTS in a sub-400ms loop fed by the existing STT pipeline. V2 target.
- **Third-party celebrity voice clones** — legally complex (§5.5). V1 supports only voices for which explicit documented consent is held.
- **Standalone "Ask WWMD by voice" surface** — lower priority than gate audio. Referenced in the parent WWMD spec §9.4.
- **Voice in coworker thread messages** — beyond gate rationale narration. V2.

### 3.3 Profile Kinds

| Kind | Description | Example |
| --- | --- | --- |
| `platform` | Existing — Mark / DPF Platform doctrine | Mark / DPF Platform |
| `organization` | Existing — customer WWWD org profile | Acme Corp Operating Principles |
| `customer` | Existing — future customer instance profile | (deferred from WWMD v1) |
| `persona-real` | New — real person who has given explicit consent | CEO of a customer organization |
| `persona-fictional` | New — fictional persona not derived from any real person's voice | "The Pragmatic Founder" archetype |
| `persona-synthetic` | New — AI-synthesized persona from curated training data, no real-person basis | Industry archetype seeded by DPF |

## 4. Research and Benchmarking

### 4.1 TTS Provider Landscape (May 2026)

A sweep of the current TTS provider market identifies the following decision-relevant facts:

| Provider | Min voice sample | First-audio latency | Clone quality (MOS est.) | Self-host | Recommended tier |
| --- | --- | --- | --- | --- | --- |
| Cartesia Sonic 3 | 3 seconds | 90–200ms | 4.6–4.7 | No | Primary (cloud) |
| Fish Audio S2 | 10–30 seconds | ~100ms | ~4.7 | Yes (GitHub) | Quality / self-hosted |
| ElevenLabs | ~2–3 minutes | ~150ms | 4.5–4.6 | No | Fallback / broad ecosystem |
| Resemble AI | 10 seconds (rapid) | Variable | 4.4–4.5 | Yes (on-prem Docker) | Regulated verticals |
| XTTS v2 (Coqui) | 6 seconds | <200ms | 4.4–4.5 | Yes (open-source) | Full self-hosted budget |
| OpenAI Voice Engine | 15 seconds | ~100ms | Unknown | No | Not in public release; exclude |
| Azure Custom Neural Voice | 20–50 samples | Batch-only (20–40h training) | 4.5 | No | Azure-locked enterprises |

**Provider selection rationale:**
- **Cartesia Sonic 3** as the default cloud provider: lowest first-audio latency (90ms), 3-second minimum sample, streaming-native architecture, native emotion/prosody controls, Professional Voice Clones available without contacting sales.
- **Fish Audio S2** as the quality and self-hosted fallback: highest measured naturalness, enterprise RBAC built-in, self-hostable via open-source repo for customers who require voice data on-premises.
- **ElevenLabs** as a stability fallback: largest installed base, mature API, good for non-real-time pre-rendering.

### 4.2 STT Infrastructure — Already Implemented

**STT is not a design question for this spec.** The DPF codebase already ships a production-grade voice input system currently completing Slice 1 of a multi-slice voice rollout.

Existing implementation (as of 2026-05-19):

| Component | Location | Status |
| --- | --- | --- |
| Core voice library | `apps/web/lib/voice/` (16 files) | Slice 1 in progress |
| Browser mic capture | `components/agent/hooks/useVoiceCapture.ts` | Implemented |
| Mic button UI | `components/agent/MicButton.tsx` | Implemented |
| Transcription API | `app/api/transcribe/route.ts` | Implemented |
| STT provider model | `packages/db/src/voice-stt-providers.ts` | Implemented |
| speaches (local Whisper) | `dpf-stt:9000` (Docker service) | Default provider |
| Groq / OpenAI Whisper | Provider registry | Hosted fallbacks |
| LLM cleanup + vocabulary bias | Slice 2 (planned) | Not yet built |
| Streaming partials | Slice 4+ | Deferred |

The default STT provider is **speaches** — a local Docker service running faster-whisper/distil-whisper at `dpf-stt:9000`. This means the self-hosted STT path is already the platform default; cloud STT (Groq, OpenAI Whisper) is available as a customer-supplied fallback when the local service is not running.

This spec's voice infrastructure integrates with the existing STT system rather than replacing it. The `VoiceTierConfig` defined here configures TTS only; STT configuration already has its own provider registry and routing in the existing voice library.

### 4.3 Hardware Requirements

The STT side already runs on CPU by default: speaches (faster-whisper) is CPU-friendly, and Slice 1.5 specifically targets a CPU-optimized default path. No GPU is required for STT in the existing deployment.

The TTS side introduces the first potential GPU requirement:

| TTS tier | Provider | GPU required | Notes |
| --- | --- | --- | --- |
| Cloud (default) | Cartesia Sonic 3 / Fish Audio S2 API | None | API call; no local GPU |
| Self-hosted | Fish Audio S2 or XTTS v2 | 1× RTX 4090 (24GB VRAM) | Shares VRAM with self-hosted LLM if present |
| High-volume self-hosted | Fish Audio S2 | A6000 / A100 (48–80GB) | For >50 concurrent synthesis jobs |

The speaches STT service already running in Docker can co-locate on the same host as a self-hosted TTS service. A single RTX 4090 handles both speaches Whisper and XTTS v2 simultaneously at small-enterprise scale. The models are loaded at startup; VRAM is shared between the two services.

**Key finding**: the platform already runs STT without a GPU. Adding cloud TTS also requires no GPU. A GPU only becomes relevant if a customer specifically requires on-premises voice synthesis (data-residency requirement). This makes the default deployment path zero additional hardware cost beyond existing infrastructure.

### 4.4 Comparative Market Analysis

No commercial decision intelligence platform ships voice-narrated perspective output today. The closest analogs are:
- **AI podcast generation** (NotebookLM, ElevenLabs GenFM): one-way audio, no governance or decision context
- **AI voice assistants** (Copilot Voice, ChatGPT Voice): real-time conversation, no principle traceability or decision ledger
- **Enterprise IVR and voice bots**: scripted, not principle-governed

DPF's position: a governed decision perspective, narrated in the persona's own voice, with a full audit ledger linking the audio output to the specific profile version and materials that produced it.

## 5. Design Pillars

### 5.1 Voice Is a Presentation Layer

The voice layer never influences the decision outcome. The gate evaluates materials, produces a rationale text, writes the `DecisionInteraction` ledger row, and returns the result. The TTS job runs after the ledger write, asynchronously. A failure in TTS synthesis does not fail the gate — the text rationale is always the primary output; audio is enrichment.

This ordering is non-negotiable. If audio generation were synchronous with the gate evaluation, a TTS provider outage would block all Build Studio plan advancement.

### 5.2 Three Independent Layers of a Persona

A WWTD profile has three independently configurable layers. None requires the others.

**Layer 1 — Decision materials**: the principles, decisions, and writings that encode how this person thinks. Stored as `PerspectiveMaterial` records linked to the profile. This is what the gate evaluates. A WWTD profile with strong materials but no voice config is a fully functional decision gate.

**Layer 2 — Generation style** (`personaConfig.systemPrompt`): a prompt fragment that the LLM uses when writing the rationale text. Example: "Write in the measured, direct style of a founder who prioritizes first principles and avoids hedging." This shapes phrasing and cadence without changing the decision logic. The evaluator produces a `rationale` skeleton; the generation style pass rewrites its expression.

**Layer 3 — Voice timbre** (`voiceConfig`): a cloned voice ID from the TTS provider. The TTS job synthesizes the styled rationale text using this voice. If `voiceEnabled` is false, the TTS job is skipped.

These layers compose:
- Materials only → text-only WWTD gate (fully functional)
- Materials + style → styled text rationale, no audio
- Materials + style + voice → styled text + audio narration
- Materials + voice (no style) → audio narration in plain rationale text style

### 5.3 Voice Training Is a One-Time Job Per Profile

Voice training runs once (or on deliberate re-training). The result is a `voiceId` from the provider, stored in `VoiceProfile.providerVoiceId`. Subsequent TTS synthesis calls pass this `voiceId`; no re-training is needed per invocation.

Training pipeline:
1. Operator uploads audio or video samples via the profile admin UI
2. If video: FFmpeg extracts the audio track server-side
3. Optional: vocal isolation pass (removes background noise, music, other speakers)
4. Consent record is created and confirmed before training begins (§5.5)
5. Provider training API is called with the processed audio
6. `VoiceTrainingJob` tracks status (pending → processing → ready → failed)
7. On ready: `VoiceProfile.providerVoiceId` is set, `voiceEnabled` may be activated

Re-training is permitted when voice quality degrades or a better sample set is available. Each training run creates a new `VoiceProfile` version; the profile points to the current active version.

### 5.4 STT Infrastructure Is Already Live

This is not a design pillar for this spec — it is a fact. The STT pipeline already exists:

```
User speaks → MicButton.tsx captures audio → useVoiceCapture hook →
POST /api/transcribe → voice library → speaches (dpf-stt:9000) →
transcript → AgentMessageInput textarea → user reviews → sends
```

The TTS work in this spec hooks onto the output end of the same pipeline. When the gate produces a rationale, the TTS synthesis job synthesizes audio and the audio player component plays it back. The existing mic infrastructure is already installed in the agent interface.

**Implication for the audio component library**: the component library chosen for the audio player in this spec must be compatible with the existing MediaRecorder API usage in `useVoiceCapture`. No conflict is expected — playback and capture are separate browser APIs — but the same dependency should handle both to avoid shipping two audio stacks.

### 5.5 Consent Is First-Class

Voice cloning from a real person's voice creates a biometric data record. This is regulated in multiple jurisdictions. Consent must be captured, stored, and retrievable before any training job begins.

Consent record requirements:
- Full name of the consenting person
- Date and method of consent (recorded statement, signed document, or witnessed verbal)
- Scope of authorized use: which platform features, which languages, which territories
- Expiry date (consent is time-bounded; renewal is required)
- Who captured the consent record (accountable principal in the DPF org)
- Whether the voice is the person's own, or belongs to a third party who has consented

The consent record is linked to `VoiceProfile`. A `VoiceTrainingJob` cannot start without a linked, non-expired consent record. The training pipeline UI enforces this before the upload form is available.

For profiles of kind `persona-fictional` and `persona-synthetic`, consent records are not required because no real person's voice is trained. The system records this explicitly on the `VoiceProfile` as `consentType: "not-required-synthetic"`.

**Legal boundaries:**
- `persona-real` with consent: permitted
- `persona-real` without consent: blocked by the system; no bypass
- Historical or deceased persons: treated as `persona-real` with additional legal review flag; consent must be held by an estate or authorized representative
- AI-synthesized voice with no real-person basis: `persona-synthetic`; no consent record required

### 5.6 TTS Tier Config Mirrors LLM Provider Pattern

The existing DPF LLM routing already supports a tier-based provider config. The STT side already has its own provider registry in `packages/db/src/voice-stt-providers.ts`. The TTS side defined here follows the same pattern:

```
ttsTierConfig:
  tier: "cloud" | "self-hosted"
  provider: "cartesia" | "fish-audio" | "elevenlabs" | "xtts-v2"
  selfHosted:
    endpoint: string  // URL of self-hosted TTS service
    gpuMemoryGb: number  // informational; selects model size
```

This config lives in org-level settings alongside the existing STT provider config. Enterprise customers switch to `self-hosted` tier by pointing to their TTS service endpoint. The `VoiceService` abstraction layer handles the provider switch transparently. The STT config is not touched — it is already managed by the existing voice library.

### 5.7 WWTD Profile Materials Are Curated, Not Scraped

For a `persona-real` profile, materials come from:
- Documents and writings the person has explicitly authorized for inclusion (same consent scope as voice)
- Public materials they have authored (articles, speeches, published interviews)
- Decisions they have made within this DPF platform instance, where they are the accountable principal

Materials are **never** scraped from third-party databases, social media, or media coverage without explicit consent. The same evidence-grade and freshness rules as the WWMD profile apply (§5.4 of the WWMD spec).

For `persona-fictional` and `persona-synthetic`, materials are authored by the platform operator or seeded by DPF. No consent considerations apply.

## 6. Runtime Flow

### 6.1 Voice Training Pipeline

```
1. Operator opens profile admin → Voice tab
2. System checks: is consent record present and non-expired?
   └─ No: show consent capture form; block upload form
   └─ Yes: show sample upload form
3. Operator uploads audio file(s) or video file(s)
4. Server:
   └─ If video: FFmpeg extract audio track (server-side)
   └─ Run audio quality check (sample rate, background noise estimate, duration)
   └─ Optional: vocal isolation via configured isolation service
   └─ Validate: duration ≥ minimum for selected provider
5. Create VoiceTrainingJob (status: pending)
6. Call provider training API (async)
7. Poll / webhook: update VoiceTrainingJob status
8. On ready: set VoiceProfile.providerVoiceId, status: ready
9. Notify operator: "Voice profile ready. Enable voice output for this profile."
```

### 6.2 TTS Synthesis Job (Post-Gate)

```
1. Gate evaluation completes → DecisionInteraction ledger row written
2. Gate returns result to UI (text rationale available immediately)
3. If profile.voiceEnabled AND profile.voiceConfig exists:
   └─ Queue VoiceSynthesisJob { interactionId, text: narration, voiceConfig }
4. VoiceSynthesisJob (async, does not block gate response):
   └─ Apply generation style (persona systemPrompt) to rationale text
   └─ Call TTS provider: synthesize audio with providerVoiceId
   └─ Store audio file to CDN / object storage
   └─ Write DecisionInteractionVoiceOutput { interactionId, audioUrl, durationSeconds }
5. UI polls or receives push notification: audio ready
6. AudioPlayer in DecisionPerspectiveGatePanel enables play button
```

The UI shows text rationale immediately. The audio player appears as "loading" and enables when the synthesis job completes (typically 200–500ms after gate response for cloud providers; up to 2s for self-hosted at cold start).

### 6.3 Narration Text Construction

The raw `DecisionInteraction.rationale` is a structured reasoning text written for the decision ledger. Before TTS synthesis, it is transformed into a narration form appropriate for listening:

- Remove markdown formatting, table structures, and source citation brackets
- Expand confidence numbers to spoken form ("zero-point-seven-two confidence" → "high confidence")
- Replace outcome labels with natural phrases ("recommend" → "My recommendation is to proceed")
- Apply generation style prompt to rephrase in the persona's cadence

The narration text is stored separately from the ledger rationale. The ledger retains the original structured text; the narration is an ephemeral transform input to the TTS job.

### 6.4 STT Integration — Already Running

STT input is not a V2 design item. The pipeline already routes through `apps/web/lib/voice/` and the speaches Docker service. The full input flow:

```
MicButton.tsx → useVoiceCapture hook → MediaRecorder (WebM/Opus) →
POST /api/transcribe → transcription-adapter → speaches (dpf-stt:9000) →
{ text, confidence } → AgentMessageInput → user message pipeline
```

This spec's only integration point with the existing STT system is the audio component library: the audio player introduced for TTS output must not conflict with the `@ricky0123/vad-web` (Silero VAD) and MediaRecorder usage in `useVoiceCapture`. Playback uses `HTMLAudioElement`; capture uses `MediaRecorder` — separate browser APIs, no conflict expected.

The full-duplex voice loop (user speaks, persona responds in voice, user speaks again without typing) is the V2 milestone. It connects the existing STT pipeline output directly to the TTS synthesis job trigger, bypassing the text textarea. That is a coworker runtime change, not a voice infrastructure change.

## 7. Data Model

### 7.1 Extensions to DecisionPerspectiveProfile

```prisma
model DecisionPerspectiveProfile {
  // ... existing fields unchanged ...

  // WWTD persona layers
  personaConfig    Json?    // { systemPrompt: string, cadence: string, languageStyle: string }
  voiceEnabled     Boolean  @default(false)

  // Relations
  voiceProfile     VoiceProfile?
}
```

The `kind` field already exists. New valid values: `persona-real`, `persona-fictional`, `persona-synthetic`.

### 7.2 VoiceProfile

Manages the cloned voice asset for a decision perspective profile.

```prisma
model VoiceProfile {
  id                    String    @id @default(cuid())
  profileId             String    @unique
  provider              String    // "cartesia" | "fish-audio" | "elevenlabs" | "xtts-v2"
  providerVoiceId       String?   // Voice ID from provider (null until training completes)
  status                String    @default("pending")  // "pending" | "training" | "ready" | "failed" | "revoked"
  consentType           String    // "explicit-recorded" | "explicit-signed" | "not-required-synthetic"
  consentRecordId       String?   // FK to VoiceConsentRecord (required if consentType != not-required-synthetic)
  sampleCount           Int       @default(0)
  totalSampleDurationMs Int       @default(0)
  qualityScore          Float?    // Provider's quality estimate post-training (0.0–1.0)
  language              String    @default("en")
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  profile               DecisionPerspectiveProfile @relation(fields: [profileId], references: [profileId])
  trainingJobs          VoiceTrainingJob[]
  consentRecord         VoiceConsentRecord? @relation(fields: [consentRecordId], references: [id])
}
```

### 7.3 VoiceConsentRecord

Durable consent record required before any real-person voice training begins.

```prisma
model VoiceConsentRecord {
  id                String    @id @default(cuid())
  subjectName       String    // Full name of the person whose voice is being trained
  subjectEmail      String?
  consentMethod     String    // "recorded-statement" | "signed-document" | "witnessed-verbal"
  authorizedUseCase String[]  // e.g., ["build-studio-gate", "coworker-response"]
  authorizedLanguages String[] @default(["en"])
  authorizedTerritories String[] @default(["global"])
  expiresAt         DateTime  // Consent is time-bounded; re-consent required after expiry
  capturedByPrincipalId String // DPF principal who obtained consent
  evidenceRef       String?   // Path or URL to stored consent evidence (recording, document)
  revokedAt         DateTime?
  createdAt         DateTime  @default(now())

  voiceProfiles     VoiceProfile[]
}
```

### 7.4 VoiceTrainingJob

Tracks async voice training jobs.

```prisma
model VoiceTrainingJob {
  id              String    @id @default(cuid())
  voiceProfileId  String
  status          String    @default("pending")  // "pending" | "processing" | "ready" | "failed"
  providerJobId   String?   // Provider's internal job reference
  inputSamples    Json      // [{ filename, durationMs, qualityFlag }]
  errorMessage    String?
  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime  @default(now())

  voiceProfile    VoiceProfile @relation(fields: [voiceProfileId], references: [id])
}
```

### 7.5 DecisionInteractionVoiceOutput

Links a synthesized audio file to a decision interaction.

```prisma
model DecisionInteractionVoiceOutput {
  id              String    @id @default(cuid())
  interactionId   String    @unique
  audioUrl        String    // Signed CDN/object-storage URL (WAV or MP3)
  narrationText   String    @db.Text  // The styled narration text sent to TTS (not the raw rationale)
  durationSeconds Float
  provider        String    // TTS provider used for this synthesis
  voiceProfileId  String    // VoiceProfile used
  ttsCostUnits    Int?      // Provider cost units (characters or tokens)
  generatedAt     DateTime  @default(now())

  interaction     DecisionInteraction @relation(fields: [interactionId], references: [interactionId])
}
```

### 7.6 VoiceTierConfig (Org-Level Settings)

Not a Prisma model — extends the existing org-level settings JSON. Stored in `Organization.settings` or equivalent config table:

```json
{
  "voiceTier": {
    "tier": "cloud",
    "ttsProvider": "cartesia",
    "sttProvider": "openai-whisper",
    "selfHosted": {
      "ttsEndpoint": null,
      "sttEndpoint": null
    }
  }
}
```

## 8. Existing DPF Primitives to Reuse

| Need | Existing primitive |
| --- | --- |
| Profile and material model | `DecisionPerspectiveProfile`, `PerspectiveMaterial` (existing; `kind` field extended) |
| Decision interaction ledger | `DecisionInteraction` (existing; `DecisionInteractionVoiceOutput` added as relation) |
| Async job infrastructure | `TaskRun` / existing background job queue |
| File upload handling | Existing file/artifact upload pipeline (`TaskArtifact` or equivalent) |
| Object storage | Existing CDN / S3-compatible storage (used for build artifacts) |
| LLM call for generation style pass | Existing `AgentThread` / LLM routing layer |
| Org-level config | `Organization.settings` (existing JSON column) |
| Principal/auth | Existing auth and principal system |
| Audit trail | `ToolExecution`, `ToolExecutionReceipt` (existing) |
| **STT pipeline** | `apps/web/lib/voice/` (16 files), `MicButton.tsx`, `useVoiceCapture`, `/api/transcribe`, speaches provider — fully implemented; not modified by this spec |
| **STT provider registry** | `packages/db/src/voice-stt-providers.ts`, `packages/db/data/providers-registry.json` — not modified |
| **Audio MIME handling** | `apps/web/components/agent/hooks/mime-probe.ts` — reuse for audio player format detection |

New additions required: `VoiceProfile`, `VoiceConsentRecord`, `VoiceTrainingJob`, `DecisionInteractionVoiceOutput`, `voiceEnabled` and `personaConfig` fields on `DecisionPerspectiveProfile`, `ttsTierConfig` in org settings.

## 9. UI and Surfaces

### 9.1 DecisionPerspectiveGatePanel — Audio Player

V1 audio output surface. Additions to the existing panel:

- **Voice indicator**: a small icon on the outcome card indicates that audio is available or loading
- **Audio player**: minimal inline player (play/pause, progress bar, speed control 0.75×/1×/1.25×)
- **Loading state**: "Preparing audio…" while `VoiceSynthesisJob` is in flight (typically 200–500ms)
- **Fallback**: if TTS job fails, the panel displays text only with no error — audio is enrichment, not a required output

The player does not autoplay. The operator chooses to listen.

### 9.2 Profile Admin — Voice Tab

New tab in the Decision Perspective profile admin screen:

**Consent Section** (appears first; upload blocked without it):
- Fields: subject name, consent method selector, use case checkboxes, authorized languages, expiry date, evidence upload (recording or signed document)
- "Save Consent Record" → enables the upload section

**Sample Upload Section**:
- Drag-and-drop or file picker: accepts `.mp3`, `.wav`, `.m4a`, `.mp4`, `.mov`, `.webm`
- Shows per-file quality warnings (duration, noise estimate)
- Audio quality guidelines: minimum 30 seconds, <25% background noise, consistent room acoustics

**Training Section**:
- "Start Training" button (disabled until minimum quality threshold met)
- Status indicator: pending → training (with estimated completion time) → ready / failed
- Quality score shown when ready
- "Re-train" option when better samples are available

**Voice Settings** (active when training is ready):
- Enable/disable toggle: `voiceEnabled`
- Speed and prosody notes (passed to provider's synthesis call)
- Test: "Generate sample" button renders a fixed test sentence and plays it inline

### 9.3 Persona Profile Creation Wizard (WWTD)

New flow in Admin → Perspectives → New Profile:

- Step 1: Profile kind selector (`platform` / `organization` / `persona-real` / `persona-fictional` / `persona-synthetic`)
- Step 2: Name, scope, fallback profile
- Step 3: Generation style (`personaConfig.systemPrompt`) — free text with guided prompts
- Step 4: Voice (skip-able) → link to Voice Tab setup
- Step 5: Seed materials — paste documents, reference principles, or skip to add manually

The wizard creates a `DecisionPerspectiveProfile` in `status: draft` until at least one `PerspectiveMaterial` is promoted.

### 9.4 Decision Ledger — Audio Column

In the Decision Ledger / Inspector (existing surface), a new column indicates whether a `DecisionInteractionVoiceOutput` exists for each interaction row. Clicking it plays the audio inline or links to the stored URL.

## 10. First Implementation Slice

V1 priority order:

1. **Schema migration**: add `voiceEnabled`, `personaConfig` to `DecisionPerspectiveProfile`; add `VoiceProfile`, `VoiceConsentRecord`, `VoiceTrainingJob`, `DecisionInteractionVoiceOutput` tables; add `voiceTier` to org settings.

2. **VoiceService abstraction**: TypeScript service class with `synthesize(text, voiceConfig): Promise<{ audioUrl, durationSeconds }>` interface. Implements Cartesia Sonic 3 adapter (primary) and a stub for Fish Audio S2. Provider is selected by `voiceTierConfig.ttsProvider`.

3. **VoiceSynthesisJob**: async background job that runs after `DecisionInteraction` is persisted. Calls the narration text builder, calls `VoiceService.synthesize`, writes `DecisionInteractionVoiceOutput`. Fails gracefully (logs to `[tool-trace]`; does not surface error to operator unless the failure is persistent).

4. **Narration text builder**: pure function `buildNarrationText({ outcomeType, confidenceScore, rationale, personaConfig })` → styled narration string ready for TTS.

5. **Audio player in DecisionPerspectiveGatePanel**: add loading state and inline audio player; poll for `DecisionInteractionVoiceOutput` availability or receive it via existing push/subscription mechanism.

6. **Consent capture UI**: form in profile admin. Creates `VoiceConsentRecord`. Blocks training job start until record exists and is non-expired.

7. **Voice training UI**: sample upload, quality check, training job trigger, status display.

8. **WWTD profile kind values**: extend `kind` field validation; add `personaConfig` to profile seed and admin forms.

9. **Tests**: unit tests for narration text builder and VoiceService adapter interface; integration test for VoiceSynthesisJob happy path with a mock provider; UI component tests for audio player states.

## 11. Open Questions

| # | Question | Disposition |
| --- | --- | --- |
| 11.1 | Should the audio URL be signed (time-limited) or public? | Signed with 24h TTL by default; configurable per org. Decision interaction records are governance artifacts and should not be publicly accessible. |
| 11.2 | Which audio format for delivery? | MP3 for broad browser compatibility; WAV available as a high-fidelity alternative for on-prem archival. |
| 11.3 | Should WWTD profiles be shareable across DPF installs via the hive? | Not in scope for V1. The voice profile (biometric data) must not leave the install without explicit operator consent. The decision materials (non-biometric) could be hive-shareable in a future contribution flow. |
| 11.4 | Pricing model for voice API costs to enterprise customers? | Pass-through or included in tier. This is a commercial decision, not a spec decision. The `ttsCostUnits` field on `DecisionInteractionVoiceOutput` enables metered billing if needed. |
| 11.5 | Does the generation style pass require a separate LLM call? | Yes — one additional call to rewrite rationale text in the persona's cadence. This adds ~200–400ms to the synthesis job latency, which is acceptable since the job is async. |
