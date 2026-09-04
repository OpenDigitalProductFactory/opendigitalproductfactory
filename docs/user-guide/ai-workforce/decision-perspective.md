---
title: "Decision Perspective & Persona Voice"
area: ai-workforce
order: 5
---

## What This Covers

This page documents two adjacent capabilities that ship together:

- **Decision Perspective Gate (WWMD / WWWD)** — the canonical handler the platform calls whenever a coworker hits an ambiguity or an open product question. Returns one of `recommend` / `arbitrate` / `escalate` / `defer` with a confidence score, the principles that governed the decision, and an audit ledger entry.
- **Persona Voice Layer** — an optional audio modality. Speech-to-text (STT) is on by default for voice input; text-to-speech (TTS) is opt-in per profile and narrates decision rationales in the persona's voice.

The naming: **WWMD** is "What Would Mark Do" — the platform profile, seeded for DPF itself, carrying founder and platform doctrine. **WWWD** is "What Would We Do" — the organization profile, which lets a customer organization encode its own stance: an executive, a domain expert, or an organizational archetype. The two are sibling scopes, not a hierarchy, and a customer's business decision does not inherit platform judgment as authority. In this DPF portal instance WWMD and WWWD happen to point at the same profile, because here the business and the product are the same thing — that coincidence is specific to this install and is not the model.

There is a third scope in the same family. **WSID** is "What Should I Do" — the *profession* profile. Where WWMD encodes founder/platform doctrine and WWWD encodes organization doctrine, WSID encodes what a competent professional in a given role should do. Each coworker role family gets its own profile (`WSID-DATA-ARCHITECT`, `WSID-FINANCE`, `WSID-MARKETING`, …) backed by a source-traced professional corpus, reusing the same profile + corpus + retrieval + gate architecture. See [The Profession Scope (WSID)](#the-profession-scope-wsid) below.

> **Want to see it work, not just read what it is?** [Decision Perspective in
> Practice](decision-perspective-in-practice.md) walks a real question end-to-end through the gate for
> each scope (WWMD / WWWD / WSID) — the options framed, the decision vectors scored, the outcome
> returned, and the ledger row written — plus how oversight and the immutable ledger wrap every one.

The full design lives in three specs:

- `docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md` — the kernel
- `docs/superpowers/specs/2026-05-19-wwmd-mcp-exposure-design.md` — the MCP tool
- `docs/superpowers/specs/2026-05-19-persona-voice-layer-wwtd-design.md` — voice and organization (WWWD) profile kinds ⟦the `wwtd` in this filename is a superseded working name; the concept shipped as WWWD⟧
- `docs/superpowers/specs/2026-08-13-wwwd-constitutional-alignment-gate.md` — consequential-action WWWD×WSID enforcement

## What Decision Perspective Does

When a coworker or external MCP client hits a decision point that doesn't have a deterministic answer in code, it calls the Decision Perspective Gate. The gate selects the active profile, retrieves the principles and prior decisions that bear on the question, aggregates them as a weighted vector across decision dimensions, and returns one of four outcomes:

> **What are the decision dimensions?** There are 20 of them, and the set is closed. Each one — what it means, whether it is a benefit or a cost, whether it is shared across every profession or owned by one, and where its weight comes from — is defined in the [Decision Vectors reference](../../architecture/decision-vectors.md). How the emphasis shifts by line of business is in [Decision Vectors by Business Type](../../architecture/decision-vectors-by-archetype.md).

| Outcome | Meaning | What happens next |
|---------|---------|-------------------|
| `recommend` | Confident direction backed by source-traced principles. | The coworker proceeds; the recommendation is logged. |
| `arbitrate` | Two or more credible directions exist. The gate resolves with weighted vector aggregation and returns the chosen path plus the dissenting view. | The coworker proceeds with the chosen path; the dissent is preserved in the ledger. |
| `escalate` | The decision needs owner leadership — confidence is low, sources contradict, or the principle hierarchy doesn't cover the question. | The work pauses; an approval surface is raised to the operator. |
| `defer` | The active profile lacks enough material to frame even a recommended direction. | The question is captured as a profile gap so future curation can close it. |

Every invocation writes a `DecisionInteraction` row recording the active profile version, the source materials cited, the confidence score, the chosen outcome, and the rationale text. This is the audit ledger — auditors and operators reconstruct "what perspective governed this decision, and on what evidence" from it.

**Answering the queue does not make your AI less confident.** Confidence carries a
discount for how often you have recently OVERRULED a profile in the same decision
class — the signal being "our recorded doctrine is drifting from what the owner
actually does here, so trust it less". An overrule means the gate recommended one
option and you chose a different one. Simply answering an escalation is not an
overrule, and neither is agreeing with the recommendation.

This mattered in practice (BI-ACF0D6D4): the discount used to count every answer,
so clearing a review queue drove it to its cap and pushed the NEXT decision below
the threshold to act — working through your backlog was what kept the backlog
full. Two cases deliberately do not count against you: an escalation that carried
no recommendation (there was nothing to overrule), and an answer where you did not
pick one of the offered options (that is not evidence of disagreement). Repeated
genuine disagreement in a class still lowers autonomy there, which is the point.

### Consequential Action Alignment

For a consequential tool call, Decision Perspective is a pre-execution control rather than optional advice. The gate extracts the proposed market, customer, product, geography, and go-to-market motion, then checks them independently against the organization's published WWWD stance, organization-owned product portfolio, and GTM evidence. An explicit hard boundary in any required corpus vetoes the action; positive signals elsewhere cannot average the veto away.

Product and GTM checks may use a qualified WSID specialist, but qualification never grants permission. The ordinary TAK intersection still requires the actor's authority, tool grants, workflow policy, data constraints, and preconditions. Owners and employees pass through the same control as coworkers.

There is no alignment bypass flag. To permit an action that the current stance rejects, an owner deliberately amends and publishes the WWWD stance, producing a new policy version, and submits the action for a fresh decision. Every consequential verdict is recorded as a GAID-bound receipt showing the actor, decision interaction, policy version, delegation and qualification evidence, cited sources, and amendment lineage. For an approved action, the receipt channel is reserved before the side effect; if it cannot be reserved, the action does not run.

### The Confidence Model

The gate's confidence is a governed runtime state, not a model-self-reported number:

> Confidence is earned in drops and lost in buckets.

Confidence rises slowly through repeated evidence-backed alignment — a recommendation made, observed in practice, and confirmed by an employee, increases the profile's confidence for that question domain. Confidence drops fast after misses: a contradicted rationale, a stale source, or an overconfident recommendation that turned out wrong pulls the profile back. The point is to make autonomy something the platform earns, not something it claims.

### The Inheritance Chain

When the active profile can't answer a question, the gate falls back through a fixed chain:

1. Profession profile (WSID) — when the question is a craft question for a coworker with a role profile
2. Active profile (WWWD or customer-specific)
3. DPF product doctrine (general platform principles)
4. DPF organizational principles (TAK / GAID governance layer)
5. `defer` — insufficient coverage even for a framing recommendation; capture as a profile gap

The chain is wired into the data model from day one so the fallback path is auditable: every interaction row records which level in the chain produced the answer.

## Profile Kinds

The `DecisionPerspectiveProfile` model supports several profile kinds today. Each profile is versioned — when a profile's materials change, a new version is snapshotted so old decision interactions still resolve against the doctrine that was active when they ran.

| Kind | Description | Example | Status |
|------|-------------|---------|--------|
| `platform` | DPF platform doctrine (Mark / DPF Platform). The first profile, seeded with the founder's writings and approved decisions. | Mark / DPF Platform | **Shipped** — the WWMD kernel for this portal instance |
| `organization` | Customer organization's operating principles (the WWWD profile). | Acme Corp Operating Principles | **Shipped surface, deferred content** — points at the platform profile in this instance because product and business are the same |
| `profession` | A coworker role family's professional doctrine (the WSID profile), backed by a source-traced corpus distilled from professional bodies of knowledge. | `WSID-DATA-ARCHITECT`, `WSID-FINANCE`, `WSID-MARKETING` | **Early access** — profile kind, source registry, and 23 family profiles seeded; data-architect corpus shipped; finance and marketing are the pilot completion work |
| `customer` | Future customer-instance profile, isolated from the platform's product-origin guidance. | Customer org doctrine | **Deferred** — not in V1 |
| `persona-real` | A real person who has given explicit documented consent. The voice layer can use their voice clone. | An executive at a customer org | **Shipped surface, consent-gated** |
| `persona-fictional` | A persona not derived from any real person — useful as an archetype profile. | "The Pragmatic Founder" | **Shipped** |
| `persona-synthetic` | An AI-synthesized persona built from curated training data with no real-person basis. | Industry archetype seeded by DPF | **Shipped** |

The non-negotiable boundary: a customer profile **must not** inherit platform-specific business judgment as authority by default. DPF product doctrine can be advisory product guidance for any profile; the customer's own WWWD profile becomes authoritative for its business context once that profile exists.

## The Profession Scope (WSID)

WWMD answers "what would the founder/platform do?" and WWWD answers "what would this organization do?" — but a coworker doing a specialist's job has no governed source for **what a competent professional in that role should do**. The data-architect coworker has no DAMA-DMBOK grounding; the finance coworker has no GAAP doctrine; the marketing specialist has no marketing body of knowledge. Without WSID, that professional judgment is whatever the underlying LLM happens to produce — ungoverned, unauditable, and inconsistent across model routings.

WSID is the third scope, and it deliberately reuses the architecture the platform already proved twice: **a versioned profile + a source-traced corpus + weighted retrieval + an audited gate**, scoped to the profession instead of the founder or the org. No parallel storage family is introduced: the corpus lives as `WikiPage` pages with `RawSource` provenance, `PerspectiveMaterial` rows for decision-bearing doctrine, and PostgreSQL embeddings for recall.

Key properties:

- **Full-roster coverage contract.** WSID is designed to scope *every* coworker on the platform — all 63 registry agents plus the route personas, collapsed into profession *families*. Data architect, finance, and marketing are the **pilot three** chosen to prove the pipeline; they are not the scope.
- **Research-sourced, never training-data authored.** Every corpus page is produced by the research-ingest pipeline from fetched, verifiable sources. The LLM distills retrieved source text; it never writes doctrine from its own training memory. Each profession gets its own research effort and its own source list, governed by the Profession Source Registry.
- **Role-aware gate resolution.** When a coworker hits a craft question, the gate evaluates against its profession profile first, then falls back through the existing chain (role → org WWWD → DPF doctrine advisory → defer-with-gap-capture).
- **Seed = bootstrap, enrichment = runtime.** Pilot corpora install on a fresh portal (themselves pipeline-produced with recorded provenance); ongoing growth flows through the role-scoped enrichment pipeline with draft-by-default review.
- **Org overridability.** An organization can extend or override a profession profile without mutating the platform-seeded baseline, via the existing kernel-page overlay pattern.

Candidate anchor standards for the pilot three (each profession's research pass confirms, extends, and supersedes them with fetched sources):

- **Data architect** — DAMA-DMBOK2, ISO/IEC 9075 (ANSI SQL), OWASP Top 10 + ASVS + Query Parameterization Cheat Sheet, ISO 11179 (metadata registries), Data Mesh as contextual material.
- **Finance** — US GAAP (FASB ASC) presentation and recognition, double-entry invariants, month-end close discipline, segregation-of-duties / SOX 404 control concepts, IFRS divergences as context.
- **Marketing** — AMA definitions and ethics statement, classic frameworks (4Ps/7Ps, STP, funnel/AARRR), brand-consistency doctrine, CAN-SPAM / GDPR consent as commandment-tier contextual rules.

SFIA 9 and O*NET/ESCO inform which knowledge areas each role profile must cover — used as a completeness checklist, not ingested as text. WSID does **not** include verbatim ingestion of licensed/copyrighted texts, per the corpus content policy.

## Calling the Gate

In-product coworkers call the gate through the platform's internal handler — they don't need to know it exists. The gate is also exposed as an MCP tool so external clients (Claude Code, Claude Desktop, Codex CLI, custom orchestrators) face the same gate under the same governance rules.

An operator can also invoke the gate manually from the **Decision Perspective Gate Panel** in Build Studio. A typical use is reviewing an automated `arbitrate` outcome before letting the plan advance — the dissenting view is shown alongside the chosen path so the operator decides whether the resolution holds up.

Tool grants and oversight levels apply: the gate is callable, but high-risk outcomes (`escalate`) raise an employee approval surface even when invoked autonomously.

## The Voice Layer

A persona has three independently configurable layers. None requires the others.

| Layer | What it is | Required for WWWD |
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

The TTS provider is selected with the `TTS_PROVIDER` env var; the default is **self-hosted Chatterbox**, so voice stays on your hardware like the rest of the AI workforce. The right backend is **operating-system-dependent**, because Docker Desktop on macOS has no GPU passthrough — a cloning-grade model can't be GPU-accelerated inside a Mac container, so Apple Silicon runs a native-host sidecar instead (the same pattern local LLM inference already uses via Docker Model Runner).

| Tier | Provider | Host path | GPU | Notes |
|------|----------|-----------|-----|-------|
| **Self-hosted default (Linux / Windows)** | Chatterbox (`dpf-tts` container, `travisvn/chatterbox-tts-api`) | amd64 container | NVIDIA / CUDA | Zero-shot voice cloning. The code default (`defaultProvider()` falls back to `chatterbox`). |
| **Self-hosted default (Apple Silicon / non-NVIDIA)** | `mlx-audio` (Kokoro fast path + CSM cloning) | native macOS host process, reached via `host.docker.internal` | Apple MLX / Metal | The macOS path, because Docker Desktop has no GPU passthrough. Mirrors host-native Docker Model Runner. `TTS_PROVIDER=mlx`. |
| **Cloud (optional)** | Cartesia Sonic 3 | API-only | None | Lowest first-audio latency (~90ms), streaming-native, no GPU. For installs that don't want to self-host. |
| **Cloud / quality** | Fish Audio S2 | API or self-host | None (API) / RTX 4090 (self-host) | High naturalness, enterprise RBAC, self-hostable for data-residency needs. |
| **Fallback** | ElevenLabs / XTTS v2 (Coqui) | API / self-host | None (ElevenLabs) / RTX 4090 (XTTS) | Stability fallback for pre-rendering, or fully self-hosted budget option. |

The default deployment path keeps audio on the host. Cloud TTS is the API-only opt-in for installs that prefer not to self-host or lack a suitable GPU.

> The OS-dependent backend split is detailed in `docs/superpowers/specs/2026-05-28-tts-apple-silicon-local-design.md` (native-host MLX sidecar), which amends `docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md` (the Linux/NVIDIA default).

### Voice Profile Admin

Voice profiles are managed in the platform's wiki area at the persona admin page (`/coworker-decisions/personas/[id]/voice`). Operator workflow:

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
- **Decision Canvas** — a read surface for a single `DecisionInteraction`; shows the question, options, recommendation, confidence, material pulls, evidence sources, and audit identifiers without exposing internal tool names in the default view
- **Material Backlinks** — a bounded local neighborhood for the cited principle or profile material; shows related stances and heuristics, citations, and prior decisions when the material has been approved and promoted
- **Founder / owner review queue** — unresolved decisions grouped by human-readable gap reason. WWMD decisions use founder-review wording; WWWD and custom profiles use owner/operator wording. The reason is DERIVED from the evidence the gate recorded, never invented (BI-38658E6B): a reason the gate wrote wins; `coverageGap:true` is the only signal that reports a genuine doctrine gap and asks you to clarify policy; conflicting stance directions report a principle conflict; a `lexical` relevance fallback reports that the embedding layer is unavailable rather than blaming your corpus; a score below the profile threshold reports exactly that; and a payload with none of these reports "Reason not recorded" instead of guessing. An approve-direction escalation is reported as **New proposition**, not as a gap: your recorded stance is consistent with the idea, but nobody has ruled on this question before. That escalation is deliberate — auto-approving whatever matches existing doctrine would mean the business only ever does what it already does, so a novel proposal comes to you on purpose (BI-F5F2869D). The gate acts on its own only where you have ALREADY RULED on the same question; alignment alone is not a licence to act. This matters because after content-aware scoring landed, "add a stance" is not always a remedy — a relevance-weighted score can be unmoved by more material, so a queue that always said "clarify operating policy" was pointing at the one lever that could not work.
- **`/coworker-decisions/personas/[id]`** — profile detail with materials, generation style, and voice configuration
- **`/coworker-decisions/personas/[id]/voice`** — voice training, consent record, training job status, provider voice ID
- **`DecisionInteraction` ledger** — every gate invocation; queryable for "what did the gate decide for this build, and on what basis?"
- **Operations Map** — decision-pressure overlays appear alongside cost-pressure overlays so an operator can see when escalation rates rise on a particular profile

## Canvas, Backlinks, and Capture

The decision is the primary artifact. A **Decision Canvas** is the operator-readable projection of a recorded decision: what was asked, which options were available, what the active profile recommended or deferred, which materials pulled the result, and what action comes next.

A **material backlink** is supporting context, not a second decision. It answers "what else is connected to this cited principle or material?" by showing related stances, heuristics, citations, and prior decisions. Draft or candidate material is held as review material and is not presented as active doctrine.

**Research capture** is proposal-only. Captured notes, web clips, or Markdown become draft source/material candidates for an explicit target profile. They do not become published wiki pages, promoted profile material, or operational doctrine until reviewed.

Use **founder review** when a WWMD platform decision needs a missing principle, a founder judgment call, or a platform-governance resolution. Use **owner/operator review** when a WWWD or custom profile needs organization-local policy, customer-commitment guidance, or an accountable business owner.

## Coworker Awareness of the Governance Hub

A coworker chat opened alongside `/coworker-decisions` can now read the same governance state the page renders, so "what should we do about these open reviews?" is answered from data rather than a request to paste the screen:

- **Page context.** When the user is on `/coworker-decisions`, the coworker's prompt is injected with the Decision Governance summary — open-review counts per discipline (WWMD / WWWD / WSID), decisions recorded in the last 30 days, governing-material counts, and the most recent unresolved reviews with their questions and decision-canvas links. This is the `/coworker-decisions` route-context provider in `apps/web/lib/tak/route-context.ts`.
- **Perception by construction.** Governed product surfaces are migrating to the renderer-neutral Authorized Surface Contract, which projects the same shared read model to browser, mobile, workroom/headless, and external MCP consumers. A default route provider may still name an uncovered legacy page, but route identity is not page knowledge: when semantic state is unavailable the coworker must say so and must not guess. Decision Governance remains covered by its shared queue read model and governed tool while its full ASC projection is migrated.
- **The `list_open_decision_reviews` tool.** A read-only, `registry_read`-baseline tool (so every coworker inherits it) that returns the full open-review queue — each item's discipline, unresolved reason, gap detail, suggested action, and decision-canvas link — projected through the same `apps/web/lib/founder-review/queue.ts` the Founder Review workspace uses. A coworker reads the queue and **recommends** a resolution; **resolving** a deferred/escalated review stays an owner action taken in the Founder Review workspace (Human-in-the-Loop at Phase Boundaries).

## Boundaries

Three constraints are non-negotiable:

1. **Voice is a presentation layer.** It does not change the decision logic, the confidence model, the escalation rules, or the governance authority. A WWWD profile with a celebrity voice clone follows the same `recommend / arbitrate / escalate / defer` rules as a text-only profile. Voice makes the output richer; it does not make the profile more authoritative.

2. **Consent is required for any `persona-real` voice.** A structured consent record is stored before any training job can run. Without that record, the training pipeline refuses to start. This is enforced at the data layer, not the UI layer.

3. **Customer profiles do not inherit platform-specific business judgment as authority.** Mark / DPF Platform doctrine can be advisory product guidance for any profile, but a customer's WWWD profile is authoritative for its own business context once it exists.

## What's In Progress

Tracked under EP-WWMD, EP-VOICE-LAYER, and EP-WSID:

- **WSID pilot completion** — the profession profile kind, Profession Source Registry, 23 family profiles, role resolver, and the data-architect corpus (with provenance lint) are merged; the finance and marketing corpora and deeper gate-resolution wiring complete the pilot three before the full-roster rollout
- **Customer WWWD profiles** — the surface exists; the data and onboarding flow that lets a customer organization seed its own profile is the next deliverable
- **Real-time voice conversation** — live back-and-forth using streaming TTS in a sub-400ms loop fed by the existing STT pipeline. V2 target
- **Voice in coworker thread messages** — narrating coworker replies beyond gate rationale audio. V2
- **Standalone "Ask WWMD by voice"** — a dedicated voice surface to query the kernel directly without going through a Build Studio gate
- **Streaming partial transcripts** — the STT path currently posts full transcripts; partials are deferred to a later voice slice
- **GPU auto-detection for STT** — the CUDA upgrade currently requires an `.env` change; auto-detection of the host GPU is tracked as Slice 1.6

## Related Routes

- `/coworker-decisions` — **Coworker Decision Engine** landing. Reframed (EP-0AF96937 Phase 1) around the three decision disciplines — WWMD (platform), WWWD (your business), WSID (each role's craft) — each card showing derived health (material counts, whether the org has its own stance, open review counts) and See / Manage / Review actions. The raw kernel material (principles, stances, heuristics) is retained below the hub as a "Governing material" drill-in rather than the front door. See `docs/superpowers/specs/2026-07-04-decision-governance-surface-redesign-design.md`.
- `/coworker-decisions/review` — **Review & adjust** workspace (EP-0AF96937 Phase 2). A findings surface over the accumulating decision ledger: `conflict` findings (open, human-actionable decisions the gate flagged as `principleConflict`), `drift` findings (a canonical "golden" decision whose winner flipped, or whose margin collapsed to a coin-flip, under the current commandment corpus — re-scored each load by `evaluateGoldenDrift` against the same `decide()` engine the gate uses, routed to the matrix), `gap` findings (clusters of `defer`/`escalate` outcomes in one decision domain where the doctrine has no settled answer yet), and `staleness` findings (decision material aged past its freshness window that still governs). Resolved, withdrawn, blank-context, and already-executed internal records remain in audit history rather than appearing as work. Asks that are the SAME decision phrased differently appear once with their matching-ask count, and the card discloses the other wordings the answer will close so you rule on the real scope (BI-932C2A81). One recorded ruling clears every match while each occurrence remains in the audit ledger. Clustering is semantic above a high similarity floor and never crosses perspectives; when the embedding layer is unavailable it falls back to collapsing only byte-identical questions, so an outage can never widen what a single answer resolves. Every navigation action states the outcome it can actually achieve and reaches the owning workflow; the richer `/coworker-decisions/decisions/[interactionId]` record is the canonical detail, and older `/platform/ai/decisions/[interactionId]` links redirect there.
- `/coworker-decisions/stance` — **WWWD business-stance editor** (EP-0AF96937 Phase 3). Where a business sees and adjusts how it decides ("what would WE do"). A plain-language "the question you want settled / how your business decides it" form saves a **draft** org-overlay `stance` page — exactly the corpus the coworker decision-routing block grounds business calls in. Draft by default: nothing becomes active doctrine until explicitly published.
- `/coworker-decisions/craft` + `/coworker-decisions/craft/[professionKey]` — **WSID craft view + override** (EP-0AF96937 Phase 4). The professions the platform grounds each coworker in, and where a business adds its own local practices on top of the platform baseline (a draft org-overlay `heuristic` under the profession's slug namespace — never mutating the seeded corpus).
- `/coworker-decisions/matrix` — **The decision matrix** (EP-0AF96937 Phase 2 completion). The axes (benefit/cost dimensions) and per-tier weights every principle is scored on, with a live per-axis principle count. Read-only — adding or reweighting an axis is a governed change — so decisions stay reproducible.
- `/coworker-decisions/perspectives` — manage the profiles behind each discipline; give any perspective a voice
- Build Studio → **Decision Perspective Gate Panel** — primary surface for the gate
- `/coworker-decisions/personas/[id]` — profile detail
- `/coworker-decisions/personas/[id]/voice` — voice training and consent
- `/platform/ai/founder-review` — the owner/founder review queue for `defer`/`escalate` outcomes (`?mode=wwmd` / `?mode=wwwd`)
- `/platform/ai/operations` — Operations Map with decision-pressure overlays
- MCP — the `decisionPerspective.invoke` tool exposes the gate to external clients under the same grant model

## Related Specs

- `docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md` — the kernel design (V1 WWMD)
- `docs/superpowers/specs/2026-05-19-wwmd-mcp-exposure-design.md` — the MCP tool surface
- `docs/superpowers/specs/2026-05-19-persona-voice-layer-wwtd-design.md` — voice layer + organization (WWWD) profile kinds
- `docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md` — STT design
- `docs/superpowers/specs/2026-05-17-voice-input-slice-1-5-default-on-cpu.md` — CPU-default STT + the 3-tier hardware ladder
- `docs/superpowers/specs/2026-05-21-chatterbox-tts-self-hosted.md` — self-hosted Chatterbox TTS (Linux/NVIDIA default)
- `docs/superpowers/specs/2026-05-28-tts-apple-silicon-local-design.md` — native-host MLX TTS sidecar for Apple Silicon (the OS-dependent path)
- `docs/superpowers/specs/2026-06-09-wsid-coworker-professional-corpus-design.md` — the WSID profession scope (third decision perspective)
