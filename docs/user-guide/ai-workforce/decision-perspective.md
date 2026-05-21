---
title: "Decision Perspective & Persona Voice"
area: ai-workforce
order: 5
lastUpdated: 2026-05-21
updatedBy: Claude (docs)
---

## What This Covers

This page documents two adjacent capabilities that ship together:

- **Decision Perspective Gate (WWMD / WWTD)** — the canonical handler the platform calls whenever a coworker hits an ambiguity or an open product question. Returns one of `recommend` / `arbitrate` / `escalate` / `defer` with a confidence score, the principles that governed the decision, and an audit ledger entry.
- **Persona Voice Layer** — an optional audio modality. Speech-to-text (STT) is on by default for voice input; text-to-speech (TTS) is opt-in per profile and narrates decision rationales in the persona's voice.

The naming: **WWMD** is "What Would Mark Do" — the first profile, seeded for the DPF platform itself. **WWTD** is "What Would They Do" — the generalized model that lets a customer organization encode an executive, a domain expert, or an organizational archetype as its own profile. **WWWD** is the customer-organization variant of WWMD; in this DPF portal instance, WWMD and WWWD point at the same profile because the business and the product are the same thing.

The full design lives in three specs:

- `docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md` — the kernel
- `docs/superpowers/specs/2026-05-19-wwmd-mcp-exposure-design.md` — the MCP tool
- `docs/superpowers/specs/2026-05-19-persona-voice-layer-wwtd-design.md` — voice and WWTD profile kinds

## What Decision Perspective Does

When a coworker or external MCP client hits a decision point that doesn't have a deterministic answer in code, it calls the Decision Perspective Gate. The gate selects the active profile, retrieves the principles and prior decisions that bear on the question, aggregates them as a weighted vector across decision dimensions, and returns one of four outcomes:

| Outcome | Meaning | What happens next |
|---------|---------|-------------------|
| `recommend` | Confident direction backed by source-traced principles. | The coworker proceeds; the recommendation is logged. |
| `arbitrate` | Two or more credible directions exist. The gate resolves with weighted vector aggregation and returns the chosen path plus the dissenting view. | The coworker proceeds with the chosen path; the dissent is preserved in the ledger. |
| `escalate` | The decision needs human leadership — confidence is low, sources contradict, or the principle hierarchy doesn't cover the question. | The work pauses; an approval surface is raised to the operator. |
| `defer` | The active profile lacks enough material to frame even a recommended direction. | The question is captured as a profile gap so future curation can close it. |

Every invocation writes a `DecisionInteraction` row recording the active profile version, the source materials cited, the confidence score, the chosen outcome, and the rationale text. This is the audit ledger — auditors and operators reconstruct "what perspective governed this decision, and on what evidence" from it.

### The Confidence Model

The gate's confidence is a governed runtime state, not a model-self-reported number:

> Confidence is earned in drops and lost in buckets.

Confidence rises slowly through repeated evidence-backed alignment — a recommendation made, observed in practice, and confirmed by a human, increases the profile's confidence for that question domain. Confidence drops fast after misses: a contradicted rationale, a stale source, or an overconfident recommendation that turned out wrong pulls the profile back. The point is to make autonomy something the platform earns, not something it claims.

### The Inheritance Chain

When the active profile can't answer a question, the gate falls back through a fixed chain:

1. Active profile (WWWD or customer-specific)
2. DPF product doctrine (general platform principles)
3. DPF organizational principles (TAK / GAID governance layer)
4. `defer` — insufficient coverage even for a framing recommendation; capture as a profile gap

The chain is wired into the data model from day one so the fallback path is auditable: every interaction row records which level in the chain produced the answer.

## Profile Kinds

The `DecisionPerspectiveProfile` model supports several profile kinds today. Each profile is versioned — when a profile's materials change, a new version is snapshotted so old decision interactions still resolve against the doctrine that was active when they ran.

| Kind | Description | Example | Status |
|------|-------------|---------|--------|
| `platform` | DPF platform doctrine (Mark / DPF Platform). The first profile, seeded with the founder's writings and approved decisions. | Mark / DPF Platform | **Shipped** — the WWMD kernel for this portal instance |
| `organization` | Customer organization's operating principles (the WWWD profile). | Acme Corp Operating Principles | **Shipped surface, deferred content** — points at the platform profile in this instance because product and business are the same |
| `customer` | Future customer-instance profile, isolated from the platform's product-origin guidance. | Customer org doctrine | **Deferred** — not in V1 |
| `persona-real` | A real person who has given explicit documented consent. The voice layer can use their voice clone. | An executive at a customer org | **Shipped surface, consent-gated** |
| `persona-fictional` | A persona not derived from any real person — useful as an archetype profile. | "The Pragmatic Founder" | **Shipped** |
| `persona-synthetic` | An AI-synthesized persona built from curated training data with no real-person basis. | Industry archetype seeded by DPF | **Shipped** |

The non-negotiable boundary: a customer profile **must not** inherit platform-specific business judgment as authority by default. DPF product doctrine can be advisory product guidance for any profile; the customer's own WWWD profile becomes authoritative for its business context once that profile exists.

## Calling the Gate

In-product coworkers call the gate through the platform's internal handler — they don't need to know it exists. The gate is also exposed as an MCP tool so external clients (Claude Code, Claude Desktop, Codex CLI, custom orchestrators) face the same gate under the same governance rules.

An operator can also invoke the gate manually from the **Decision Perspective Gate Panel** in Build Studio. A typical use is reviewing an automated `arbitrate` outcome before letting the plan advance — the dissenting view is shown alongside the chosen path so the operator decides whether the resolution holds up.

Tool grants and HITL tiers apply: the gate is callable, but high-risk outcomes (`escalate`) raise a human approval surface even when invoked autonomously.

## The Voice Layer

A persona has three independently configurable layers. None requires the others.

| Layer | What it is | Required for WWTD |
|-------|-----------|-------------------|
| **Decision materials** | The principles, decisions, and writings that encode how this person thinks. Stored as `PerspectiveMaterial` records linked to the profile. This is what the gate evaluates. | Yes |
| **Generation style** | A persona prompt that shapes how the LLM expresses the rationale text — phrasing, cadence, vocabulary. Doesn't change the decision logic. | Recommended |
| **Voice timbre** | A cloned voice that narrates the synthesized rationale audio. | Optional; opt-in per profile |

Materials alone produce a fully functional text-only gate. Adding generation style produces styled text rationales. Adding a voice timbre produces audio narration of the styled text. The decision logic is identical across all three configurations.

### Speech-to-Text (input)

STT is **on by default** on every install. The bundled service is **speaches** — a local Docker service at `dpf-stt:9000` running faster-whisper / distil-whisper. No GPU is required; speaches runs CPU-friendly. A 3-tier hardware ladder is available for installs that want to upgrade:

| Tier | Backend | When to use |
|------|---------|-------------|
| **CPU (default)** | `speaches` on CPU | Every install gets this. Adequate for normal admin and coworker dictation. |
| **GPU (upgrade)** | `speaches` with the CUDA image (`DPF_STT_IMAGE` env var) | Faster, lower-latency transcription on hosts with an NVIDIA GPU. |
| **Hosted** | Groq / Deepgram / AssemblyAI / OpenAI Whisper | Customer-supplied fallback when local STT isn't desired, or when local hardware is constrained. |

The mic button is wired into the coworker chat surface; transcripts feed the existing coworker message pipeline. Errors surface inline rather than silently failing.

### Text-to-Speech (output)

TTS narrates decision rationales returned by the gate. Synthesis runs **asynchronously** after the gate writes the `DecisionInteraction` row — a TTS provider outage cannot block plan advancement, because audio is always enrichment and text is always the primary output.

Provider options:

| Tier | Provider | GPU required | Notes |
|------|----------|--------------|-------|
| **Cloud (default)** | Cartesia Sonic 3 | None | Lowest first-audio latency (~90ms), 3-second minimum sample for voice cloning, streaming-native, professional voice clones without contacting sales. |
| **Quality / self-hosted** | Fish Audio S2 | 1× RTX 4090 (24GB VRAM) | Highest measured naturalness, enterprise RBAC built in, self-hostable via the open-source repo for customers with data-residency requirements. |
| **Fallback** | ElevenLabs / XTTS v2 (Coqui) | None (ElevenLabs) / 1× RTX 4090 (XTTS) | Stability fallback for non-real-time pre-rendering, or fully self-hosted budget option. |

The default deployment path adds zero hardware cost beyond the existing platform — cloud TTS is API-only. GPU is only relevant when a customer specifically requires on-premises voice synthesis.

### Voice Profile Admin

Voice profiles are managed in the platform's wiki area at the persona admin page (`/wiki/personas/[id]/voice`). Operator workflow:

1. Upload audio or video samples on the profile admin page
2. The platform extracts audio from video (FFmpeg, server-side)
3. Optional vocal isolation removes background noise, music, and other speakers
4. **Consent capture** — for any `persona-real` profile, a structured consent record must be created and confirmed before training runs. This is a non-negotiable gate
5. The provider training API is called with the processed audio
6. A `VoiceTrainingJob` row tracks status: `pending` → `processing` → `ready` → `failed`
7. On `ready`, `VoiceProfile.providerVoiceId` is set and `voiceEnabled` can be turned on

Re-training is allowed when sample quality improves or the existing voice degrades. Each training run creates a new `VoiceProfile` version; the profile points at the current active version.

## What an Operator Sees Today

- **Build Studio Decision Perspective Gate Panel** — the primary surface; shows the active profile, the gate outcome, the rationale text (with audio player when voice is enabled), the cited materials, and any dissenting view
- **`/wiki/personas/[id]`** — profile detail with materials, generation style, and voice configuration
- **`/wiki/personas/[id]/voice`** — voice training, consent record, training job status, provider voice ID
- **`DecisionInteraction` ledger** — every gate invocation; queryable for "what did the gate decide for this build, and on what basis?"
- **Operations Map** — decision-pressure overlays appear alongside cost-pressure overlays so an operator can see when escalation rates rise on a particular profile

## Boundaries

Three constraints are non-negotiable:

1. **Voice is a presentation layer.** It does not change the decision logic, the confidence model, the escalation rules, or the governance authority. A WWTD profile with a celebrity voice clone follows the same `recommend / arbitrate / escalate / defer` rules as a text-only profile. Voice makes the output richer; it does not make the profile more authoritative.

2. **Consent is required for any `persona-real` voice.** A structured consent record is stored before any training job can run. Without that record, the training pipeline refuses to start. This is enforced at the data layer, not the UI layer.

3. **Customer profiles do not inherit platform-specific business judgment as authority.** Mark / DPF Platform doctrine can be advisory product guidance for any profile, but a customer's WWWD profile is authoritative for its own business context once it exists.

## What's In Progress

Tracked under EP-WWMD and EP-VOICE-LAYER:

- **Customer WWWD profiles** — the surface exists; the data and onboarding flow that lets a customer organization seed its own profile is the next deliverable
- **Real-time voice conversation** — live back-and-forth using streaming TTS in a sub-400ms loop fed by the existing STT pipeline. V2 target
- **Voice in coworker thread messages** — narrating coworker replies beyond gate rationale audio. V2
- **Standalone "Ask WWMD by voice"** — a dedicated voice surface to query the kernel directly without going through a Build Studio gate
- **Streaming partial transcripts** — the STT path currently posts full transcripts; partials are deferred to a later voice slice
- **GPU auto-detection for STT** — the CUDA upgrade currently requires an `.env` change; auto-detection of the host GPU is tracked as Slice 1.6

## Related Routes

- Build Studio → **Decision Perspective Gate Panel** — primary surface for the gate
- `/wiki/personas/[id]` — profile detail
- `/wiki/personas/[id]/voice` — voice training and consent
- `/platform/ai/operations` — Operations Map with decision-pressure overlays
- MCP — the `decisionPerspective.invoke` tool exposes the gate to external clients under the same grant model

## Related Specs

- `docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md` — the kernel design (V1 WWMD)
- `docs/superpowers/specs/2026-05-19-wwmd-mcp-exposure-design.md` — the MCP tool surface
- `docs/superpowers/specs/2026-05-19-persona-voice-layer-wwtd-design.md` — voice layer + WWTD profile kinds
- `docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md` — STT design
- `docs/superpowers/specs/2026-05-17-voice-input-slice-1-5-default-on-cpu.md` — CPU-default STT + the 3-tier hardware ladder
