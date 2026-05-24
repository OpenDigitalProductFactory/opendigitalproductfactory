---
title: Reduction Gear Architecture — concentric agentic loops, GearInterface substrate, and the trust ladder
authoredAt: 2026-05-24
authoredBy: mark-bodman
status: draft
specKind: design
backlogItem: unfiled - live MCP lookup on 2026-05-24 found overlapping work but no existing Reduction Gear item
epic: unfiled - prefer a thin EP-REDUCTION-GEAR-ARCH governance epic or a first pilot item under EP-BUILD-9DB5B0
relatedSpecs:
  - docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md
  - docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md
  - docs/founder-kernel/wiki/principles/research-before-implementing.md
  - docs/founder-kernel/wiki/principles/consult-specs-first.md
  - docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md
  - docs/founder-kernel/wiki/principles/no-hardcoded-colors.md
externalReferences:
  - https://botman101.substack.com/p/scaling-agentic-loops-from-individual
  - https://opentelemetry.io/docs/specs/semconv/gen-ai/
  - https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
  - https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
  - https://docs.langchain.com/langsmith/home
  - https://langfuse.com/docs/observability/overview
  - https://docs.temporal.io/workflows
---

# Reduction Gear Architecture — concentric agentic loops, GearInterface substrate, and the trust ladder

## Architect verdict

**Decision:** approve the direction, but do not implement the original draft as a single substrate migration. The gear-train model is the right strategic abstraction for DPF, and the current repo already contains enough primitives to justify a unifying interface. The chief-architect change is sequencing: Phase 0 must prove one narrow, high-signal interface before the platform dual-emits from all four internal boundaries and external coordination modes.

This spec therefore treats **GearInterface as a canonical observation and decision envelope first**, not as an immediate replacement for existing runtime tables. Existing tables remain the authoritative command/write models for their owning surfaces. GearInterface becomes the common read, evidence, calibration, and visualization stream after each producer is proven.

**Phase 0 anchor:** instrument Ring 1→2 for Build Studio workflow evidence, because it has the richest existing event substrate (`ToolExecution`, `AdapterRunTelemetry`, `BuildPhaseRun`, `BuildDispatchAttempt`, `FeatureBuild`, and WWMD `DecisionInteraction`). Ring 2→3 gets schema design and resolver scaffolding in Phase 0, but runtime archetype calibration does not begin until Phase 1. Ring 4↔5 and the external coordination plane remain design tracks until the foundation can prove ingestion, query shape, retention, and Cockpit usability under real Build Studio load.

**Non-negotiables added by this review:**
- The Cockpit is a production operator UI, not a diagram. It must follow DPF theme tokens, show dense operational state without decorative dashboard noise, and make every metric drillable to evidence.
- At least 20% of implementation capacity is reserved for refactoring existing event/evidence seams before adding new emitters. The intent is to shrink fragmentation, not layer one more table over unclear boundaries.
- Standards alignment means "compatible with current OTel GenAI/MCP semantics where they exist, isolated behind a DPF adapter where they are still experimental," not hard-coding unstable external vocabulary into the database.
- Ring interfaces are bidirectional. Outward records show work compounding from inner to outer rings; inward records show outer-ring evidence or hive/release-channel priors flowing back into the install. Ring numbers stay canonical; direction is a field.
- Backlog creation must extend live overlapping epics where possible. Live MCP lookup on 2026-05-24 found no existing Reduction Gear spec/plan, but did find open related epics/items (`EP-BUILD-9DB5B0`, `EP-ASSURANCE-LEDGER`, `EP-COST-001`, `EP-WWMD-MCP`, `EP-BUILD-65837F`, `EP-BUILD-58B8E3`, `EP-COWORKER-RT`, and `BI-REFACTOR-CC46703A`) that should be linked rather than duplicated.

## 1. Why

### 1.1 The CEO's articulated vision

Mark Bodman's article *"Scaling Agentic Loops from Individual"* (2026) frames DPF as a gear train: many fast-spinning small motors (individual AI Coworkers) driving large-scale capability through staged reduction. Five concentric rings — Individual Coworker → Predictable Workflow → Industry Archetype → Sandbox→Production → Global Open-Source Contribution — compound work into market-level capability.

Quoting Mark directly: *"why can't this idea of feedback loops at the single-agent level be extended? To have concentric, compounding loops?"* and *"A tiny motor can power large machines if you use enough reduction gears."*

The article is strong on the *what* (concentric loops, gear reduction). It is light on the *how* — the implementation semantics that make the loops mechanizable and visualizable at scale. This spec provides that.

### 1.2 The architectural gap

Today the platform has many coordination primitives that don't share a substrate:

- **Procedural coordination**: Build Studio (FeatureBuild + BuildPhaseRun + phase gates)
- **Emergent / A2A coordination**: spawn_work_thread, child threads, deliberation
- **Resource coordination**: WorkCapsule (soft lease), RuntimeTarget (hard status)
- **Governance**: WWMD/DecisionPerspectiveProfile, ValueStreamHitlGate, founder kernel principles
- **Evidence**: BacklogItemActivity, WorkCapsuleActivity (identical shape!), RuntimeVerification, ToolExecution, BuildActivity, BuildDispatchAttempt, BuildPhaseRun
- **Visibility**: build-progress-visibility (reconciles 6 truth sources), get_runtime_coordination_map
- **HITL**: Notification, CommunicationChannelBinding, DecisionInteraction, EscalationCapture
- **Hive**: FeaturePack, hive-scout-ingest, contribute_to_hive

### 1.2.1 Current repo truth verified in this review

This pass re-checked the spec's strongest repo claims against the worktree and live MCP backlog, rather than relying on inherited assumptions.

| Claim area | Verified current truth | Architectural implication |
|---|---|---|
| Entity timelines | `BacklogItemActivity` and `WorkCapsuleActivity` have the same activity shape (`kind`, `summary`, `payload`, `recordedAt`, actor/tool refs) with different parent FKs in `packages/db/prisma/schema.prisma`. | A polymorphic observation envelope is justified, but existing entity timelines remain useful local projections. |
| Runtime coordination | `RuntimeTarget` owns deployment/runtime status; `RuntimeVerification` is already the typed verification event that can attach to runtime target, work capsule, feature build, or git promotion candidate. | GearInterface should read from and dual-emit near `RuntimeVerification`; it must not invent a second verification ledger. |
| Build workflow | `FeatureBuild` now owns `uxTestResults`, `uxVerificationStatus`, `deliberationSummary`, `buildExecState`, `phaseRuns`, `dispatchAttempts`, and `phaseHandoffs`; `BuildPhaseRun` is a cost/timing rollup. | Ring 1→2 has enough evidence to pilot GearInterface without waiting for every other ring. |
| Cost telemetry | `AdapterRunTelemetry` stores input/output/cache/reasoning token fields and optional `estimatedCostUsd`; `BuildPhaseRun` aggregates estimated cost from adapter rows. `ToolExecution` has nullable `inputTokens`, `outputTokens`, and `costUsd`, but the governed execute path does not populate them for all tool calls. | Cost can be a GearInterface field, but Phase 0 must label cost as "best available" and test for null/partial coverage. |
| Governance | `BuildStudioDecisionGateResult` is exactly `{allowed, interactionId, evaluation, operatorMessage}`; `DecisionInteraction` persists profile, evidence, rationale, risk, outcome, and human outcome. `ValueStreamHitlGate` is a separate team/trigger/channel policy model. | The Autonomy Governor should compose these rather than flattening them into a single gate table. |
| Capability floor | `AgentModelConfig.minimumCapabilities` is a model-routing floor. `SkillDefinition.allowedTools` is skill permission shape. Runtime tool grants are enforced through `TOOL_TO_GRANTS`. | Capability taxonomy must be derived from these sources with an explicit mapping layer; none is the complete canonical vocabulary alone. |
| Archetype | `StorefrontArchetype` is real and mutable in the DB (`activationProfile`, `customVocabulary`, `marketingSkillRules` already exist), while `StorefrontConfig.archetypeId` remains the source of truth for the install's selected archetype. | The spec should avoid claiming StorefrontArchetype is strictly write-once; the write-once rule applies to the selected portal-industry source of truth and bootstrap template semantics, not every field forever. |
| Hive/contribution | `FeaturePack`, `PlatformDevConfig`, `hive-scout-ingest`, and `contribute_to_hive` exist. `contribute_to_hive` is gated by Platform Development policy, contribution mode, DCO, token, sandbox readiness, and promotion integrity. | Trust federation must be bolted onto existing contribution gates; it cannot bypass DCO/privacy/readiness controls. |
| Backlog overlap | Live MCP search returned no existing Reduction Gear spec/plan on 2026-05-24. Live backlog contains several overlapping epics/items but no dedicated EP-REDUCTION-GEAR-ARCH yet. | File one governing epic only if it links and composes the existing epics; do not fork parallel work streams. |

Each mechanism evolved organically and has its own:
- Event/activity shape
- Status enum (or lack thereof)
- Gate model
- HITL hook
- Evidence path

**Five convergence signals** indicate the substrate has *already* started to converge but hasn't been formalized:

1. `BacklogItemActivity` and `WorkCapsuleActivity` are byte-identical in shape; only the parent FK differs
2. `RuntimeVerification`, `BuildPhaseRun`, and `PhaseHandoff` all track timestamps + outcome
3. `AgentModelConfig.minimumCapabilities` and `SkillDefinition.allowedTools` both declare capability floors
4. WWMD's `BuildStudioDecisionGateResult` returns `{allowed, interactionId, evaluation, operatorMessage}` per `apps/web/lib/decision-perspective/build-studio-gate.ts:33`, while `ValueStreamHitlGate` expresses team/trigger/channel policy. They are convergent governance control points, but not the same result envelope.
5. `Notification` + `CommunicationChannelBinding` + `EscalationCapture` all route human alerts

**Five divergence signals** indicate where the cost of N parallel mechanisms is being paid:

1. Status vs Kind vs Phase — no canonical "what happened" shape across surfaces
2. Soft lease (WorkCapsule) vs hard status (RuntimeTarget) vs phase enum (FeatureBuild) — "who's working on this" answered three ways
3. Synchronous gates (WWMD) vs asynchronous notifications — no unified "await human decision" primitive
4. Pull (hive-scout-ingest) vs push (contribute_to_hive) — asymmetric cross-install
5. Reconciled-truth-sources (build-progress-visibility) vs single-truth (coordination map) — different trust models

The cost is operator cognitive load: the CEO cannot *see* what's happening across procedural + A2A + specialist invocations + gates + evidence with one query, in one view, on one timeline.

### 1.3 Mission alignment

This work is uniquely high-leverage for DPF because:

- **Relentless Pursuit of Automation** (CEO-stated prime directive). Without a unified substrate, every new automation path requires its own evidence/governance/visibility wiring. With GearInterface, new automation paths inherit observability, governance, and trust calibration for free.
- **CSDM-equivalent for agentic platforms.** Mark's career thesis: HP (hundreds of disparate apps = untenable) → ServiceNow (one platform but no common model until CSDM) → DPF (one platform + one common model from day one). GearInterface plays the role CSDM did for ServiceNow: a canonical interface that makes cross-product/cross-ring scenarios solvable, with integration friction modeled as mechanical wear.
- **Trusted AI Kernel (TAK) positioning.** The trust ladder (HITL → graduated autonomy) is exactly the substrate TAK exists to provide as reference architecture.
- **Hive economic moat.** Per Mark: *"Once enough businesses are on the platform, this compounding value of aggregated investments becomes increasingly difficult to compete with."* That claim requires calibrated capability data to travel between installs, not just code. Today Hive ships FeaturePacks (code); tomorrow it ships CalibratedCapabilityPacks (code + trust).
- **Verify-substrate-before-proposing-new** (kernel principle). The substrate sweep that informed this spec confirmed: most of the primitives needed *already exist*. This spec is largely a unification + linkage exercise, not greenfield invention.

### 1.4 Why not just unify the activity tables

A narrow refactor — merging `BacklogItemActivity` + `WorkCapsuleActivity` + `BuildActivity` into one polymorphic Activity table — would solve table sprawl but leave four larger problems unfilled:

1. **No outcome attribution**. Activity tables record what happened, not what it *caused*. Without explicit causal linkage, no trust loop can compound.
2. **No archetype-aware calibration**. The single largest internal torque leak is Ring 2→3: Build Studio wins in HVAC context don't elevate HVAC-context autonomy because archetype isn't a first-class dimension on outcome records.
3. **No cross-install trust transport**. Hive carries code, not calibration. Without trust traveling, the economic moat doesn't compound.
4. **No operator vocabulary upgrade**. A unified table still produces a "what happened" timeline. It does not produce a "torque, slip, wear, graduation" diagnostic surface, which is what makes the gear train *visualizable at scale*.

Building the GearInterface primitive now makes all four solvable on one substrate. Doing only the table refactor means three follow-up specs to address them later.

### 1.5 Research and benchmarking

DPF's stated principles include "research and using standards" and "research before implementing." This architecture should adopt mature primitives where they exist and isolate experimental vocabulary where standards are still moving.

### 1.5.1 Open standards

OpenTelemetry's **Semantic Conventions for GenAI** are still marked **Development**. The current docs preserve compatibility guidance for instrumentations using v1.36.0 or earlier, while newer GenAI agent/framework spans and MCP semantics define the shape DPF should align to through an adapter layer:

- `gen_ai.operation.name` includes `invoke_agent`, `invoke_workflow`, `execute_tool`, `create_agent`, `chat`, `embeddings`, and `retrieval`. Ring 1 operations can map to these values when the event is truly an agent, workflow, tool, chat, retrieval, or embedding event.
- Token attributes now include `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, cache-read token attributes, and reasoning output token attributes. DPF's existing `AdapterRunTelemetry` fields are already close, but names must be normalized by an exporter rather than copied verbatim into database column names.
- OTel defines `execute_tool` spans and a separate MCP convention surface. DPF's governed MCP tool execution (`mcp-governed-execute.ts`) is the correct instrumentation choke point for tool spans.
- `gen_ai.conversation.id`, agent attributes, workflow names, tool call IDs, and provider names are useful export attributes, but DPF should keep internal primary keys (`threadId`, `toolExecutionId`, `taskRunId`, `buildId`) as source-of-truth identifiers.

OTel does **not** yet define DPF's load-bearing concepts:
- Agent identity / role / capability triple
- Outcome verdict / quality / feedback / trust scores
- Multi-step workflow choreography across agents
- Cost in currency (only tokens)
- Calibration / graduation events

The GearInterface schema therefore aligns with OTel **at the export boundary** and extends in a dedicated `dpf.gear.*` attribute namespace where OTel is silent. The database schema must not depend directly on the stability of Development-stage OTel names. This keeps DPF compatible with OTel collectors today and leaves room to contribute useful `dpf.gear.*` conventions upstream later.

### 1.5.2 Product and platform benchmarks

| Benchmark | Relevant pattern | Adopt / reject |
|---|---|---|
| OpenTelemetry GenAI + MCP semantic conventions | Common telemetry vocabulary for agent, workflow, tool, token, provider, and MCP spans. | Adopt at exporter boundary; do not make experimental names database-critical. |
| LangSmith / LangGraph ecosystem | Trace trees, run feedback, evaluator scores, and human feedback tied to runs. | Adopt the pattern of run-level feedback and drill-through evidence; reject vendor-specific run schema as canonical. |
| Langfuse | Trace/observation/score model with evaluation and human feedback attached to execution spans. | Adopt trace + score separation; map GearInterface torque/graduation to DPF-specific scores. |
| Temporal workflows | Durable workflow histories, replayable state transitions, and explicit command/event separation. | Adopt command/event separation for long-running work; GearInterface is an observation stream, not the durable workflow engine. |
| ServiceNow CSDM | Common model that lets multiple products reason over the same service/business substrate. | Adopt the common-model ambition; avoid a heavyweight CMDB clone. DPF's unit is agentic work transmission, not service inventory. |

Anti-patterns rejected:
- Adding another dashboard that reconciles six truth sources but does not change the data contract.
- Replacing mature local write models with one generic polymorphic table before command semantics are stable.
- Treating standards alignment as copy-pasting external field names into core schema.
- Making visual metaphor stronger than operator evidence. The gear language survives only if every reading drills to source records.

## 2. What — The Reduction Gear Architecture

### 2.1 Mental model: concentric compounding loops as a gear train

Five concentric rings, all spinning simultaneously. Smaller rings spin fast and carry low torque (individual coworker iterations). Outer rings spin slowly and carry high torque (market-level capability changes). The mechanical interface between any two adjacent rings is where calibration, governance, and trust accumulation live — and where friction (integration cost) shows up as wear.

```
                Ring 5 — Hive / Market (slowest, highest torque)
                  cross-install federation
                  ┌──────────────────────────────────────────┐
                  │  Ring 4 — Sandbox→Production             │
                  │    org-level evolution; releases         │
                  │    ┌────────────────────────────────┐    │
                  │    │  Ring 3 — Archetype           │    │
                  │    │    vertical/industry segment   │    │
                  │    │    ┌──────────────────────┐   │    │
                  │    │    │ Ring 2 — Workflow   │   │    │
                  │    │    │   Build Studio       │   │    │
                  │    │    │  ┌───────────────┐   │   │    │
                  │    │    │  │ Ring 1 —      │   │   │    │
                  │    │    │  │ Individual    │   │   │    │
                  │    │    │  │ Coworker      │   │   │    │
                  │    │    │  │ (fastest)     │   │   │    │
                  │    │    │  └───────────────┘   │   │    │
                  │    │    └──────────────────────┘   │    │
                  │    └────────────────────────────────┘    │
                  └──────────────────────────────────────────┘
```

### 2.2 The five rings

| Ring | Name | What spins | Existing DPF primitives | Today's state |
|---|---|---|---|---|
| 1 | Individual Coworker | Capability improvement, skill acquisition, tool use | AI Coworker, capability needs, propose_improvement, ToolExecution | Spinning |
| 2 | Predictable Workflow | Build Studio phase progression, A2A handoffs, deliberations | FeatureBuild, BuildPhaseRun, spawn_work_thread, DeliberationRun | Spinning; some friction at gates |
| 3 | Industry Archetype | Vertical-segmented capability accumulation | StorefrontConfig + StorefrontArchetype | Selected at setup; runtime capability calibration not yet active |
| 4 | Sandbox→Production | Promotions, releases, in-prod outcomes, rollback | GitPromotionCandidate, ProductVersion, ChangePromotion, ReleaseBundle, RuntimeTarget, RuntimeVerification | Spinning; HITL-heavy, not calibration-aware |
| 5 | Hive / Market | Cross-install federation of code + calibrated trust | FeaturePack, hive-scout-ingest, contribute_to_hive | One-way push + one-way pull; carries code, not trust |

### 2.3 Gear interfaces are where friction happens

Per Mark: *"the interfaces between the rings are where the friction happens."* The interface between any two adjacent rings is a mechanical surface where:

- **Torque transmission**: inner-ring work successfully advances the outer ring (useful work compounds)
- **Slip**: inner-ring spins but outer ring doesn't advance (work happens but doesn't compound)
- **Wear**: a `{agent, capability, archetype-context}` triple repeatedly fails or degrades at this interface (the gear's teeth are wearing down)
- **Lubrication**: HITL touches that smooth the interface (high early, falls as trust accrues)
- **Heat dissipation**: energy lost to retries, escalations, cost overruns (non-productive work)
- **Graduation**: the autonomy threshold for this triple at this interface increases (gear ratio adjusts)

These are not metaphors for documentation. They are queryable properties of the GearInterface stream (§3).

### 2.4 External coordination plane (orthogonal axis)

The five rings are concentric — they describe *depth* of the agentic stack within one organization. The CEO has separately articulated a **breadth** axis: the same substrate extending outward to suppliers, partners, and customers.

The Market plane (where Ring 5 hive federation operates) and the external coordination plane (suppliers/partners/customers) are **distinct surfaces** that share the GearInterface canonical record but represent different kinds of boundary crossings:

```
                  MARKET PLANE
                  (Ring 5 hive federation — other DPF installs)
                       │
                       │ calibrated trust travels
                       │
  ┌────────────────────┴─────────────────────┐
  │           YOUR INSTALL                   │
  │   Rings 1–5 internal gear train          │
  │                                          │
  └────┬────────────┬──────────────┬─────────┘
       │            │              │
   SUPPLIERS    PARTNERS       CUSTOMERS
   (B2B)        (alliances)    (the company's customers)
   ───────── external coordination plane ─────────
```

Ring 5 (hive) federates with other DPF installs operating their own gear trains — peer-to-peer in the market plane. The external coordination plane connects your install to *non-DPF-running* counterparties (suppliers, partners, customers) where GearInterface records cross via federated, bridged, or customer-facing modes (§8).

Three external-facing modes are envisioned, all consuming/emitting the same GearInterface canonical record:

- **Federated** (partner also runs DPF): two installs exchange GearInterface records natively + calibrated trust
- **Bridged** (partner doesn't run DPF): DPF emits/consumes industry standards (EDI, OAGIS, FHIR, etc.) via adapter shims; GearInterface remains the internal canonical
- **Customer-facing**: read-only Cockpit slices for relevant gear segments

This is detailed at §8. External coordination is a *separate parallel track* — it does not block internal-ring phases.

## 3. The GearInterface primitive

### 3.1 Schema

One canonical record. Emitted at every ring boundary, in either direction. Read by the Cockpit, Calibrator, Autonomy Governor, and (eventually) Hive federation. Backed by a new Prisma model.

```typescript
model GearInterface {
  id                       String   @id @default(cuid())
  schemaVersion            Int      @default(1)
  recordedAt               DateTime @default(now())
  sourceEventAt            DateTime?
  idempotencyKey           String   @unique
  organizationId           String?

  // Where this transmission happens
  interfaceClass           String   // 'internal-adjacent' (Ring N ↔ N+1, internal gear train)
                                    // | 'external-federated' (another DPF install)
                                    // | 'external-bridged' (non-DPF counterparty via adapter)
                                    // | 'external-customer' (customer-facing slice)
  transmissionDirection    String   @default("outward") // 'outward' | 'inward' | 'lateral'
                                    // outward: innerRing → outerRing; inward: outerRing → innerRing
  innerRing                Int?     // 1..5; canonical inner ring, required for internal-adjacent
  outerRing                Int?     // 1..5; canonical outer ring, for internal-adjacent equals innerRing + 1
  externalCounterpartyType String?  // 'supplier' | 'partner' | 'customer' | 'peer-install'
                                    // required when interfaceClass starts with 'external-'
  externalCounterpartyId   String?  // pseudonymized identifier

  // What event crossed the boundary (polymorphic source)
  shaftSourceType          String   // 'tool-execution' | 'phase-run' | 'capsule' | 'promotion'
                                    // | 'feature-pack' | 'a2a-thread' | 'deliberation'
                                    // | 'runtime-verification' | 'decision-interaction'
                                    // | 'external-po' | 'external-invoice' | 'external-handoff'
                                    // | 'platform-upgrade-run' | 'release-manifest'
                                    // | 'channel-manifest' | 'migration-classifier'
                                    // | 'seed-delta-manifest'
  shaftSourceId            String   // FK-by-string into the source table or external reference id
  actorType                String   // 'agent' | 'human' | 'system'
  actorId                  String
  actorPrincipalId         String?
  intent                   String   // canonical capability name (see §3.3)

  // The thing being graded
  capabilityName           String   // from canonical capability vocabulary
  capabilityVocabularyVersion String @default("raw-v0")
  archetypeContext         String?  // null at Ring 1↔2; required at 2↔3 and beyond
  agentIdForTriple         String

  // Mechanical readings
  torqueTechnical          Float    // 0..1; pass/partial/fail mapped to score
  torqueValue              Float?   // business-outcome attribution; null until wired
  torqueConfidence         Float    // 0..1
  ratioConsumed            Int      // how many inner events fed this advance
  outcomeType              String   // 'transmission' | 'slip' | 'graduation' | 'veto' | 'calibration-update'
  slipDetected             Boolean  @default(false)
  slipReason               String?  // 'novel-context' | 'failed-outcome' | 'human-override'
                                    // | 'cost-overrun' | 'safety-block' | 'rate-limit'
                                    // | 'capability-gap' | 'migration-destructive'
                                    // | 'manifest-invalid' | 'signature-invalid'
                                    // | 'seed-delta-conflict' | 'source-unindexed'

  // Cost (extends OTel token attributes with currency)
  costUsd                  Decimal? @db.Decimal(12, 6)
  inputTokens              Int?
  outputTokens             Int?
  cacheCreationInputTokens Int?
  cacheReadInputTokens     Int?
  reasoningOutputTokens    Int?
  durationMs               Int?

  // Trust / autonomy state at this interface — canonical autonomy enum
  // (the Autonomy Governor's `consult` return values map onto these tiers; see §6.2)
  graduationFromAutonomy   String?  // 'hitl-required' (governor returns require-hitl/escalate/block)
                                    // | 'hitl-fallback' (governor returns allow-with-notify)
                                    // | 'auto-confirm' (governor returns allow-auto with operator-notify)
                                    // | 'auto-silent' (governor returns allow-auto, no notify)
  graduationToAutonomy     String?
  graduationSampleSize     Int?
  graduationGovernorRef    String?  // DecisionInteraction id

  // Provenance — HITL is the training signal
  graderType               String   // 'human' | 'automated' | 'deliberation' | 'runtime-check'
  graderId                 String?
  rationale                String?  // captured when graderType=human

  // OTel correlation
  otelTraceId              String?
  otelSpanId               String?

  @@index([organizationId, recordedAt])
  @@index([innerRing, outerRing, transmissionDirection, recordedAt])
  @@index([capabilityName, archetypeContext, recordedAt])
  @@index([agentIdForTriple, capabilityName, archetypeContext])
  @@index([shaftSourceType, shaftSourceId])
  @@index([outcomeType, recordedAt])
}
```

**Schema constraints that must be enforced in code and migration checks:**
- `idempotencyKey` is deterministic: `{interfaceClass}:{innerRing}:{outerRing}:{transmissionDirection}:{shaftSourceType}:{shaftSourceId}:{outcomeType}` plus a stable suffix for multiple records from the same source event. Dual-emit retries must upsert, not duplicate.
- `interfaceClass='internal-adjacent'` requires `innerRing` and `outerRing`, with `outerRing = innerRing + 1` and both in `1..5`. `transmissionDirection='outward'` means inner ring work advanced the outer ring; `transmissionDirection='inward'` means outer-ring evidence, release-channel state, or hive priors flowed back toward the install.
- `transmissionDirection='lateral'` is reserved for external peer/federated exchange only; internal adjacent records must be `outward` or `inward`.
- `interfaceClass` beginning with `external-` requires `externalCounterpartyType`; `externalCounterpartyId` must be pseudonymized before write.
- `actorPrincipalId` is preferred when known, per principal convergence. `actorId` remains for existing agent/user/system identifiers and source compatibility.
- `costUsd` is decimal, not float, because it will join AI cost governance and finance views. Token fields remain nullable because current telemetry is partial.
- `outcomeType='graduation'` requires `graduationFromAutonomy`, `graduationToAutonomy`, and `graduationGovernorRef`.
- `archetypeContext` is nullable only at Ring 1→2 and for explicitly archetype-agnostic system work. Ring 2→3 and beyond must populate it from `StorefrontConfig.archetypeId` / `StorefrontArchetype` or a documented external standard mapping.

**Why not use JSON for the mechanical readings?** Because Cockpit, Calibrator, retention jobs, and hive packaging need indexed queries by ring, triple, outcome, slip reason, and recorded time. Flexible source payloads stay on the source tables; GearInterface stores the normalized facts that become platform-wide.

**Naming rationale.** The name `GearInterface` is deliberately mechanical, not abstract. Operators will read Cockpit panels that say "Ring 2→3 interface is slipping on 22% of advances" — and the mental model translates immediately to real-world gear inspection.

The earlier candidate "WorkAct envelope" was rejected during brainstorming: it didn't carry the mechanical mental model. *Envelope* implies a passive wrapper; *GearInterface* implies a mechanical surface with measurable wear, friction, and torque.

### 3.2 OTel alignment and `dpf.gear.*` extensions

GearInterface records are emitted as OpenTelemetry spans (when durations are meaningful) or span events (when instantaneous). The mapping:

**OTel-native attributes** (no extension needed):
- `gen_ai.operation.name` ← exporter-derived operation (`invoke_agent`, `invoke_workflow`, `execute_tool`, `chat`, `retrieval`, etc.), not raw `intent`
- `gen_ai.usage.input_tokens` / `output_tokens` / cache-read / reasoning-output token attributes ← token fields
- `gen_ai.provider.name` ← derived from actor when actor is a model invocation
- `gen_ai.conversation.id` ← `shaftSourceId` when source is `a2a-thread`
- `gen_ai.tool.name`, `gen_ai.tool.call.id` ← for execute_tool shafts
- MCP attributes (`mcp.method.name`, tool identity, protocol details) ← emitted by the MCP exporter where the shaft source is governed tool execution

**`dpf.gear.*` extensions** (OTel is silent):
- `dpf.gear.schema_version`
- `dpf.gear.interface_class`
- `dpf.gear.transmission_direction`
- `dpf.gear.inner_ring` / `outer_ring`
- `dpf.gear.shaft.source_type` / `source_id`
- `dpf.gear.capability.name` / `dpf.gear.capability.archetype_context`
- `dpf.gear.torque.technical` / `value` / `confidence`
- `dpf.gear.ratio_consumed`
- `dpf.gear.outcome_type`
- `dpf.gear.slip.detected` / `dpf.gear.slip.reason`
- `dpf.gear.graduation.from_autonomy` / `to_autonomy` / `sample_size`
- `dpf.gear.grader.type` / `id` / `rationale`
- `dpf.gear.cost.usd`

Span name convention: `dpf.gear.transmit ring{inner}_{direction}_ring{outer} {capability.name}` for internal-adjacent records, where `direction` is `to` for outward and `from` for inward. External records use `dpf.gear.external {interface_class} {capability.name}`.

Graduation events emit as OTel span events: `dpf.gear.graduation`.

Exporter rule: GearInterface writes must not require an OTel collector to be installed. The DB record is canonical. OTel export is a best-effort projection from GearInterface plus source-table context.

### 3.3 Capability triple semantics

The "thing being graded" is always a triple:

`{agent_id, capability_name, archetype_context}`

- **agent_id**: which AI Coworker (or system actor) performed the work
- **capability_name**: from a canonical vocabulary. **Phase 0 minimum** (unblocks shipping): emit raw `intent` string verbatim as `capability_name`, with `capabilityVocabularyVersion: "raw-v0"`. **Phase 1 prerequisite**: normalization pass derives canonical vocabulary from existing `AgentModelConfig.minimumCapabilities`, `SkillDefinition.allowedTools`, `TOOL_TO_GRANTS`, task types, and route outcome taxonomy. `AgentModelConfig.minimumCapabilities` is a routing floor, not a capability taxonomy by itself. Trust calibration can run on raw strings for local pilots, but federation (§7, §9.4) requires the canonical taxonomy before Phase 3 — see §11(1).
- **archetype_context**: null at Ring 1↔2 only when the work is genuinely archetype-agnostic; required at Ring 2↔3 and beyond. This is the *single most important* dimension on the triple because it's where archetype-aware learning lives — an HVAC contractor's win on `code-review` doesn't elevate `code-review` autonomy in healthcare context

The triple is the unit of trust. Trust scores, graduation events, wear metrics, hive priors — all keyed by the triple, not by agent alone, not by capability alone.

Principal convergence note: the triple uses `agent_id` for continuity with the current coworker registry, while the row also carries `actorPrincipalId` where known. A future identity cleanup can project `agent_id` through `PrincipalAlias`; Phase 0 should not block on migrating all agent identity to the principal spine.

### 3.4 Torque, slip, ratio, graduation semantics

**Torque transmitted** is the useful work that crossed the interface. Three components:

- `torqueTechnical` (0..1): did the work technically succeed? Pass = 1.0, partial = 0.5, fail = 0.0, with adjustments for severity.
- `torqueValue` (0..1, nullable): did it move the business? Filled in by business-outcome attribution when available. Null until value-signal wiring lands (acceptable until then; trust calibration can run on technical alone initially).
- `torqueConfidence` (0..1): how confident is the grader in the score?

**Ratio consumed** is how many inner-ring events fed this outer-ring advance. A healthy gear ratio is stable; rising ratios indicate the inner ring is doing more work for the same outer advancement (early warning of wear).

**Slip detected** = the gear teeth didn't engage. Work happened but didn't compound outward. Tracked by reason category so operators can diagnose root cause.

**Graduation events** are the explicit moments when a capability triple's trust crosses a configured threshold and the Autonomy Governor elevates its autonomy level at this specific interface. Every graduation:
- Generates a GearInterface record with `graduation*` fields populated
- Is visible to the operator (Cockpit shows the event)
- Can be vetoed (operator manually demotes)
- Is auditable via `graduationGovernorRef` to the underlying DecisionInteraction

## 4. The four ring interfaces (instrumentation)

The four interfaces use an **additive, dual-emit-first** strategy: GearInterface records are emitted *alongside* existing events. No migration on day one. Existing tables remain authoritative until Cockpit + Calibrator are stable on the unified stream.

Interfaces are named by their canonical inner/outer rings (`1↔2`, `2↔3`, `3↔4`, `4↔5`) and use `transmissionDirection` to distinguish outward compounding from inward learning, release, or hive-prior flow.

Chief-architect sequencing change: **do not dual-emit all four interfaces in the first implementation slice.** Phase 0 builds the model, ingestion API, query API, and Ring 1→2 pilot emitter. Other interfaces receive contracts, resolver scaffolding, and idempotency tests, but runtime dual-emission waits until the pilot proves correctness, volume, retention, and Cockpit usability.

### 4.1 Ring 1→2: Coworker → Workflow

**Inner shaft (existing events):** `ToolExecution`, `AdapterRunTelemetry`, `BacklogItemActivity` for coworker improvements and capability_needs, `BuildDispatchAttempt`, and `TaskNode` where task-run decomposition is active.

**Outer shaft (existing events):** `BuildPhaseRun` completion.

**Phase 0 pilot instrumentation:** When a Build Studio phase completes, attribute the contributing coworker capabilities using:
- `BuildPhaseRun` for phase time/cost window
- `AdapterRunTelemetry` for model/provider/token observations
- `ToolExecution` for governed tool actions
- `BuildDispatchAttempt` for specialist/attempt/failure axis
- `FeatureBuild.taskResults`, `verificationOut`, `acceptanceMet`, `uxVerificationStatus`, and `RuntimeVerification` for outcome signals

Emit GearInterface with torque + slip readings after the phase run completes. This first emitter must be idempotent and replayable for one build so the implementation can prove backfill/retry behavior without touching every runtime path.

**Why this interface first as a learning ground:** Substrate is already 80% there. `ToolExecution` is the governed action audit envelope and `AdapterRunTelemetry` is the AI-call telemetry envelope; together they give the first practical crosswalk from agent action to workflow outcome. This validates the dual-emit pattern with the most data and the least new product surface.

### 4.2 Ring 2→3: Workflow → Archetype (BIGGEST INTERNAL LEAK)

**Inner shaft:** `BuildPhaseRun`, `FeatureBuild` ship events.

**Outer shaft:** `StorefrontArchetype` (`packages/db/prisma/schema.prisma:6407`) plus `StorefrontConfig.archetypeId` (canonical selected archetype) and the `archetypeId` / `archetypeCategories` references scattered across other tables.

**New instrumentation:** Every shipped FeatureBuild emits GearInterface with `archetypeContext` populated (resolved from `StorefrontArchetype.id` or `archetypeCategories` on the related entity). The `StorefrontArchetype` gains an evolving capability profile derived from accumulated torque per `{capability, agent}` pair within its scope.

**Why this is the biggest internal leak:** Today, a win in HVAC context doesn't elevate HVAC-context autonomy because archetype isn't a dimension on outcome records. This means the platform learns generically (averaged across verticals) instead of vertically (per archetype). Vertical learning is exactly Mark's article's Stage 3 promise. Sealing this leak makes installs in the same vertical genuinely benefit from each other (Mark quote: *"installs in the same vertical benefit from each other without polluting unrelated archetypes"*).

**Implication for `StorefrontArchetype` model:** the selected archetype remains the portal-industry source of truth through `StorefrontConfig.archetypeId`; capability learning must not mutate bootstrap template fields to smuggle runtime truth into them. This spec proposes a **new `ArchetypeCapabilityProfile` association table** (`{archetypeId, capabilityName, torqueDistribution, sampleSize, lastUpdatedAt}`) for runtime-evolving data. Existing `StorefrontArchetype` JSON fields (`activationProfile`, `customVocabulary`, `marketingSkillRules`) prove the table is not literally immutable, but they should not become the calibration ledger. A sub-spec on archetype runtime evolution is deferred (§11).

### 4.3 Ring 3→4: Archetype → Sandbox/Production

**Inner shaft:** `ArchetypeCapabilityProfile` updates (the new runtime-evolving slice on `StorefrontArchetype`), FeaturePack creation, FeatureBuild ship.

**Outer shaft:** `GitPromotionCandidate`, `ProductVersion`, `ChangePromotion`, `ReleaseBundle`, `RuntimeTarget`, and `RuntimeVerification`.

**New instrumentation:** When archetype-validated capability gets promoted to production (in this install), emit GearInterface. Promotion gates start consulting accumulated archetype torque — not just per-build evidence — when deciding whether a feature is safe to ship.

### 4.4 Ring 4↔5: Sandbox/Prod ↔ Hive (BIGGEST EXTERNAL LEAK)

**Inner shaft:** Released features, in-prod outcomes (uptime, defects, customer behavior signals).

**Outer shaft:** `FeaturePack` contributed upstream, `hive-scout-ingest` consumed.

**New instrumentation:** Outward FeaturePack contribution carries a calibrated trust payload (anonymized histogram of `{capability, archetype-context, torque, sample-size}` triples) alongside its existing code + manifest. Inward release-channel / hive ingestion records carry signed manifest, migration classifier, seed-delta, and trust-prior evidence back toward the install. Other installs ingest both code AND calibrated trust only through governed contribution gates. See §7 and §9.9 for the CalibratedCapabilityPack and upgrade-manifest boundary.

**Why this is the biggest external leak:** Today the Hive carries code. Code without calibration means every install starts cold on routing/autonomy decisions for every capability. With calibrated trust traveling, a new HVAC install on day 1 gets archetype-relevant Bayesian priors from every prior HVAC install. This is where Mark's "compounding value increasingly difficult to compete with" claim becomes mechanically real.

## 5. The Cockpit — platform-operator diagnostic surface (gear-language)

The Cockpit is a *gear train diagnostic panel* for the **platform-operator audience** (admin, hive contributor, troubleshooter). Five concentric rings rendered visually; each gear interface readable at a glance, with mechanical-engineering vocabulary throughout.

**The gear metaphor is the architecture's mental model — not the user's.** Operators in the trenches (vertical employees, customers) don't need to understand reduction gears any more than a driver needs to understand differential transmissions. The Cockpit exposes the gear train *intentionally for platform diagnosis*; every other audience sees vertical-native vocabulary backed by the same GearInterface stream. See §5.5 (audience layering) and §5.6 (vertical workspace home).

### 5.1 Diagnostic readings (live)

| Reading | What operator sees | Mechanical analog | Computed from |
|---|---|---|---|
| **Torque transmitted** | "Ring 2→3 carrying 73% of Ring 2 output upward" | Force successfully transmitted across the gear | `torqueTechnical * torqueValue` aggregated over recent window |
| **Slip rate** | "Ring 4↔5 inward pulls slipping on 22% of attempts — mostly migration-destructive" | Teeth not engaging | `slipDetected` rate, grouped by `slipReason` |
| **Wear** | "Capability `code-review` × HVAC × agent X: trust degrading, 3 failures in last 10" | Bearings wearing down on a specific triple | Trailing torque average per triple |
| **Lubrication (HITL)** | "Ring 3→4 needs 1.4 HITL touches per advance — was 3.2 last month" | Less manual lubrication needed as gears bed in | `graderType: human` frequency trend |
| **Heat dissipation** | "Ring 2 burned $47 on retries this week with no Ring 3 advance" | Energy lost to friction | `costUsd` × `slipDetected` rollup |
| **Graduation events** | "Yesterday at 14:03: `code-review × hvac` × agent X graduated from `hitl-required` → `hitl-fallback`" | A gear ratio just changed | `graduation*` fields |

### 5.2 Operator affordances

- **Drill paths**: Ring → interface → triple → individual GearInterface records → underlying shaft event
- **Manual interventions**: pause autonomy at an interface; force HITL on a triple; reset a wear score; lubricate (whitelist) a known-good triple
- **Time-travel**: replay any interface's history; see when slip started; correlate with code/config changes

### 5.3 Built from GearInterface stream alone

The Cockpit's aggregate readings read from the GearInterface query API. Drill-through may join back to source records (`ToolExecution`, `BuildPhaseRun`, `RuntimeVerification`, `DecisionInteraction`, etc.) only after a GearInterface row selects the source. This preserves the architectural win — one normalized operator timeline — while keeping source-of-truth evidence available.

No Cockpit panel should independently reconcile fragmented event tables the way `build-progress-visibility` does today. If a reading cannot be computed from GearInterface, the correct response is to add or repair an emitter, not to add one more UI-specific reconciliation path.

Future external observability tools (OTel-compatible) can consume the same stream via OTel collectors once exporters are wired.

### 5.4 UI excellence requirements

The Cockpit is the highest-risk part of this architecture because it can either make the gear train real to operators or become another decorative dashboard. The implementation must treat UI design as product architecture.

**Layout principles:**
- First viewport shows the live gear train, active slip/wear alerts, and current autonomy posture without a marketing hero, oversized cards, or decorative gradients.
- Dense operations surface, not analytics brochure: compact rings, sortable tables, and stable drill panels optimized for repeated inspection.
- Every number is clickable. Torque, slip, wear, lubrication, heat, and graduation readings all drill to the filtered GearInterface rows and then to the source event.
- Separate lanes for `current`, `degrading`, `blocked`, and `unknown`. "Unknown" is an honest state, not hidden empty space.
- Time window, ring interface, archetype, agent, capability, autonomy tier, and source type are first-class filters with stable dimensions so the layout does not jump when results change.

**Theme and component rules:**
- Use DPF CSS tokens only: `text-[var(--dpf-text)]`, `text-[var(--dpf-muted)]`, `bg-[var(--dpf-bg)]`, `bg-[var(--dpf-surface-1)]`, `bg-[var(--dpf-surface-2)]`, `border-[var(--dpf-border)]`, and `bg-[var(--dpf-accent)]`. No hardcoded colors except `text-white` on accent buttons.
- Use lucide icons for controls where available: filter, pause, resume, veto, inspect, timeline, export.
- Use segmented controls for ring/interface selection, toggles for live/frozen view, sliders or steppers for time window, and tabs only for distinct views (`Overview`, `Interfaces`, `Triples`, `Events`, `Graduations`).
- Avoid nested cards. Use full-width operational bands and docked inspector panels. Cards are allowed only for repeated event rows or modal detail.
- Text must fit on mobile and desktop; the ring visualization must degrade into a vertical interface list on narrow screens rather than shrinking labels into illegibility.

**Visual encoding:**
- Do not rely on color alone. Slip, wear, graduation, veto, and unknown states need icon/shape/text affordances.
- The mechanical metaphor should be present but restrained. The ring view is an operational topology, not an illustrated gear animation. Animation is allowed only when it helps show live movement or replay; it must pause when the view is frozen.
- Show sample size and confidence next to trust claims. A 100% pass rate on 2 samples must look weaker than an 88% pass rate on 200 samples.

### 5.5 Audience layering — who sees gear-language vs vertical-native

The gear-language Cockpit is appropriate for **one audience only** — the platform operator whose job is to diagnose the substrate itself. Two other audiences interact with the same GearInterface stream but MUST NOT see gear vocabulary:

| Audience | Surface | Vocabulary | Data source |
|---|---|---|---|
| **Platform operator / admin** (you, hive contributors, platform troubleshooters) | The Cockpit (§5.1–5.4) | Gear-train mechanical: torque, slip, wear, lubrication, heat, graduation | GearInterface stream directly |
| **In-trench worker / employee in the vertical** (HVAC dispatcher, clinic scheduler, retail merchandiser, field tech, etc.) | **Vertical workspace home** (§5.6) — tailored per `StorefrontArchetype` | Vertical-native: e.g., "today's jobs", "patient queue", "restock alerts", "service tickets" | GearInterface stream + archetype-specific projections; never raw triples/torque/slip in UI copy |
| **External customer** (the company's customers — the people the in-trench worker serves) | Customer-facing portal (§8.3, already tailored per archetype) | Vertical-native, customer-scoped: order status, ETA, work-in-progress | GearInterface slices + archetype customer-facing components |

The gear metaphor is the architecture's mental model. Every audience-facing surface that is not the Cockpit MUST translate the gear-train data into vertical-native vocabulary before display. The Cockpit's mechanical vocabulary is *intentional jargon* for platform diagnosis; everywhere else, jargon-leakage is a bug.

### 5.6 Vertical workspace home — in-trench worker view (separate spec)

The internal workspace home page is the analog of the customer-facing portal, but for the company's own employees inside their vertical. Today, the customer-facing portal IS tailored per `StorefrontArchetype` (sections, vocabulary, finance, design); the internal workspace home is comparatively generic. This is the gap.

**Requirements** (full design in its own spec):
- **Vertical-native vocabulary** — no gear language; presentation matches what the in-trench worker would say to a colleague at the start of a shift
- **Predicated on `StorefrontArchetype`** — HVAC dispatcher home ≠ clinic scheduler home ≠ merchandiser home; layout, cards, KPIs, and alerts vary by archetype
- **Reads from GearInterface stream + archetype-specific projections** — does NOT compute its own evidence; does NOT fork from the canonical record
- **Plugin/extension model** for vertical-specific cards/components so new archetypes can ship their own home variants without forking platform code
- **Audience** — in-trench employee; explicitly NOT platform admin (admins use the Cockpit at §5.1–5.4)

**Out of scope for this spec.** Tracked under a separate BI in the same epic — see the workspace-home spec dispatched alongside this one. The contribution model (individual specialist → platform → business → market vertical) remains the architecture's spine but stays behind the scenes; in-trench workers should never see "Ring 1→2" in their UI.

### 5.7 UX verification gate

Any Cockpit implementation slice must run production-path UX verification against the Docker-served portal, not a stale dev server. The done evidence must include:
- Desktop and mobile screenshots of the Cockpit overview and one drill-down.
- Verification that no hardcoded color classes were introduced in Cockpit components.
- A seeded or fixture-backed scenario with at least one transmission, one slip, one human-graded HITL record, and one graduation/veto path.
- Proof that each visible metric drills to source evidence or explicitly shows `unknown` with a reason.

## 6. Calibration and graduation — the trust mechanic

### 6.1 The Calibrator service

A new platform service consuming the GearInterface stream and maintaining a rolling trust score per `{agentId, capabilityName, archetypeContext, interfaceClass, innerRing, outerRing, autonomyLevel}` tuple. Rollups by capability, archetype, or ring are query projections, not the stored trust key.

Three trust-scoring functions, in order of sophistication:

1. **Frequentist trust** (ship first): rolling window of last N outcomes; `pass-rate × value-weight`. Crude but unblocks the loop. N starts at 20, configurable.
2. **Bayesian trust** (ship second): prior + evidence updates; handles small-sample triples honestly; surfaces "we don't know yet" instead of false confidence.
3. **Federated trust** (ship with Ring 5 federation): blend local Bayesian with hive-supplied priors. Local outcomes always dominate; hive provides cold-start priors.

Failure mode baseline: if Calibrator data is unavailable, the Governor must not elevate autonomy. It may continue an already-HITL-required flow and surface stale/unknown confidence, but any attempted move above `hitl-required` fails closed until a fresh or explicitly accepted cached trust snapshot is available.

### 6.2 The Autonomy Governor

= **WWMD generalized** via EP-WWMD-MCP (already in flight).

Every autonomy-affecting gate, at any ring interface, calls:

```
governor.consult(triple, currentAutonomy, action) →
  'allow-auto' | 'allow-with-notify' | 'require-hitl' | 'escalate' | 'block'
```

**Canonical mapping** between governor return values and the autonomy enum stored on GearInterface (§3.1, §3.4):

| Governor return | GearInterface autonomy tier |
|---|---|
| `allow-auto` (with operator-notify policy) | `auto-confirm` |
| `allow-auto` (silent policy) | `auto-silent` |
| `allow-with-notify` | `hitl-fallback` |
| `require-hitl` | `hitl-required` |
| `escalate` | `hitl-required` (with escalation chain) |
| `block` | `hitl-required` (with veto recorded) |

The Governor:
- Reads current trust score from the Calibrator
- Reads relevant founder kernel principles via `principle_decide` (existing)
- Consults DecisionPerspectiveProfile (existing) for personalized authority model
- Emits a DecisionInteraction (existing)
- When the trust score crosses a configured threshold for an autonomy level, **emits a graduation event** on the next GearInterface record at that interface

The Governor is not a replacement for existing gate models in Phase 1. It is a decision facade over current gates:
- WWMD / `DecisionInteraction` remains the persisted decision and rationale record.
- `ValueStreamHitlGate` remains team/trigger/channel policy.
- Release, contribution, and sandbox readiness gates remain authoritative for their domains.
- GearInterface records the outcome and calibration signal after the gate decision.

Graduation is explicit and visible. The Cockpit shows it. The operator can veto.

### 6.3 HITL is the training signal

Every HITL touch produces a GearInterface record with `graderType: human` and `rationale`. These are labeled training examples that feed trust calibration. As trust accrues for a specific triple, HITL frequency falls *for that triple* — not globally. Other triples still receive human attention.

This reframes the platform's relationship to HITL: it is not a bottleneck to be eliminated; it is the *primary learning surface*. The graduation event is when HITL has done its job for a specific triple and can step back. The Cockpit's lubrication reading is the leading indicator that the learning has happened.

### 6.4 Graduation events are explicit and visible

Graduation is the single most visible artifact of the trust ladder. When `{capability, archetype, agent}` × Ring N→N+1 crosses its threshold, the Cockpit surfaces a banner:

> *"Capability `code-review` in HVAC context for agent `build-specialist` just graduated from `hitl-required` to `hitl-fallback` at Ring 2→3. Based on 47 successful advances (last failure 12 days ago). Veto? View evidence?"*

The operator can veto. The platform learns from the veto (negative training signal). The graduation event itself is a GearInterface record visible in audit trails.

## 7. Hive federation — Ring 4↔5

### 7.1 CalibratedCapabilityPack

`FeaturePack` today ships code + manifest. The extended form ships trust alongside:

```typescript
model CalibratedCapabilityPack {
  id                String   @id @default(cuid())
  featurePackId     String   @unique  // existing FeaturePack
  featurePack       FeaturePack @relation(fields: [featurePackId], references: [id])

  // Calibrated trust payload (anonymized)
  trustTriples      Json     // [{capability, archetypeContext, torqueDistribution, sampleSize, lastUpdatedAt}]
  contributorPseudonym String  // derived from PlatformDevConfig client identity; honors "obfuscated, not anonymous"
  contributionPolicy String   // from PlatformDevConfig
  sourceArchetypeContexts String[] @default([])
  payloadDigest     String

  createdAt         DateTime @default(now())
}
```

`torqueDistribution` is a **histogram**, not raw events — this honors privacy and minimizes payload size. The histogram captures distribution shape sufficient for Bayesian merging without leaking specifics. Every payload gets a digest so repeated import is idempotent and so downstream reputation can evaluate exactly what was published.

The creation flow must reuse existing `contribute_to_hive` gates: Platform Development configured, contribution mode permits sharing, DCO accepted, contribution identity available, sandbox readiness passes, promotion integrity passes, and privacy filter approves the payload. A calibrated trust pack must never create a back door around code contribution governance.

### 7.2 Bayesian prior merging

Receiving installs ingest the CalibratedCapabilityPack via extended `hive-scout-ingest`. The local Calibrator treats incoming `trustTriples` as a **Bayesian prior**, not as ground truth. Local outcomes still dominate. Hive trust is most useful when local sample sizes are small (cold-start); its weight fades as local evidence accrues.

Minimum poisoning defense before Phase 3 ships: incoming priors are downweighted by contributor history, ignored when the contributor has no reputation in that archetype, and never raise a triple above a local autonomy threshold without local evidence. Bad priors can accelerate investigation; they cannot directly graduate autonomy.

### 7.3 Archetype-scoped to honor segmentation

Critical invariant: hive trust is keyed by `archetypeContext`. An HVAC install's prior for `code-review × HVAC` does not influence a healthcare install's prior for `code-review × healthcare`. This honors Mark's quote: *"installs in the same vertical benefit from each other without polluting unrelated archetypes."*

Cross-archetype trust transfer (e.g., when an underlying capability is fundamentally similar across verticals) is a future research question (§11), not Phase 3 scope.

## 8. External coordination plane

The external coordination plane extends the GearInterface substrate outward to suppliers, partners, and customers. Three modes, all consuming/emitting the canonical GearInterface record:

### 8.1 Federated mode (partner also runs DPF)

Two DPF installs exchange GearInterface records natively, with calibrated trust payloads where appropriate. Example: a DPF-installed contractor + DPF-installed general contractor on a shared project. Both sides see the gear train segment relevant to the joint work.

### 8.2 Bridged mode (partner doesn't run DPF)

DPF emits and consumes industry-standard formats — EDI 850/810 for purchase orders, OAGIS BODs for B2B, FHIR for healthcare data exchange, etc. — via adapter shims. The GearInterface record remains the *internal canonical*; the adapters translate at the boundary.

Example: a contractor's PO to a legacy ERP supplier goes out as EDI 850 but is recorded internally as a GearInterface with `shaftSourceType: 'external-po'`. The supplier's invoice comes back as EDI 810 and is similarly recorded.

This honors the integration-conduit doctrine: DPF is a conduit, not a broker. Customers bring their own supplier relationships, credentials, and contracts; the platform provides the canonical record and adapter shims, not the partnerships.

### 8.3 Customer-facing mode

Read-only **vertical-native customer surfaces** exposed for *their* relevant work. Customer sees: order status, work-in-progress, delivery ETA, support case progression — in vertical-native vocabulary tailored by `StorefrontArchetype` (the customer-facing portal that already exists today, extended to read from the GearInterface stream as its evidence source).

Customer does NOT see: the gear-language Cockpit, internal triples, calibration scores, torque/slip/wear metrics, or other customers' data. **Two layers of separation:** (1) slice-scoping enforces privacy across customers; (2) vocabulary-translation enforces audience-appropriate presentation. The customer interacts with their domain (orders, services, delivery), not the platform's substrate.

Same discipline as §5.5 audience layering — gear vocabulary is jargon for platform operators only; every other surface translates.

### 8.4 Separate parallel track

External coordination is Phase 4 (§9). It does not block internal Phases 0-3. Adapter shim selection (EDI, OAGIS, FHIR, others) is itself a sub-spec deferred from this design pass.

## 9. Sequencing

### 9.1 Phase 0 — Foundation pilot (4-6 weeks, 2-3 epics)

**Deliverables:**
- `GearInterface` Prisma model + migration
- Ingestion API (write path) + query API (read path)
- Deterministic idempotency key + replay/upsert contract
- Ring 1→2 dual-emit pilot for Build Studio phase completion
- Source crosswalk from `ToolExecution`, `AdapterRunTelemetry`, `BuildPhaseRun`, `BuildDispatchAttempt`, `FeatureBuild`, and `RuntimeVerification`
- Cockpit MVP: read-only, gear-train view, Ring 1→2 drill-down working
- OTel exporter adapter for the pilot subset, behind a feature flag; collector compatibility verified if a collector is available
- Contract stubs and tests for Rings 2→3, 3→4, and 4→5, but no production dual-emission outside the pilot
- Retention baseline: monthly partition or equivalent pruning-ready strategy chosen before high-volume emitters are enabled

**Refactoring allocation:** Reserve at least 20% of Phase 0 engineering time for cleanup around existing event/evidence seams. Required targets:
- Move GearInterface emission behind a small writer service instead of scattering `prisma.gearInterface.create` calls.
- Normalize source-event adapters with one function per source type.
- Keep existing write models authoritative; do not mutate them to fit the new stream.
- Add test helpers that can build a coherent phase-run evidence fixture without copy-pasted JSON blobs.

**Folds in:** BI-REFACTOR-CC46703A (finding substrate unification) — AssuranceFinding becomes a polymorphic source on GearInterface, not a seventh finding-shaped model.

### 9.2 Phase 1 — Calibration (4-6 weeks, 2-3 epics)

**Deliverables:**
- Calibrator service (frequentist trust first; Bayesian trust scaffolding)
- Autonomy Governor = WWMD generalized via EP-WWMD-MCP, consulting Calibrator at every autonomy-affecting gate
- Graduation events surface in Cockpit
- HITL-as-training-signal wiring verified
- Ring 2→3 archetype-context emitter for shipped FeatureBuild outcomes
- `ArchetypeCapabilityProfile` sub-spec and schema, if Phase 0 evidence proves the profile is needed outside GearInterface projections

**Folds in:** EP-WWMD-MCP, EP-BUILD-9DB5B0 (capability calibration), EP-BUILD-65837F (deliberation as graderType).

### 9.3 Phase 2 — Cockpit hardening + cost integration (3-4 weeks)

**Deliverables:**
- Cost as torque attribute; heat-dissipation views
- All Cockpit drill paths working end-to-end
- Performance hardening for the GearInterface query API
- Materialized aggregate or projection decision for `{ring, capability, archetype, time-window}` views
- UX verification evidence per §5.5

**Folds in:** EP-COST-001 — observability layer becomes a Cockpit lens, not a separate dashboard.

### 9.4 Phase 3 — Hive federation (4-6 weeks, 2 epics)

**Deliverables:**
- `CalibratedCapabilityPack` schema + creation flow on `contribute_to_hive`
- Bayesian prior merge on `hive-scout-ingest`
- Archetype-scoped trust transport verified end-to-end
- Contributor reputation / prior poisoning defense
- Privacy review of histogram buckets and pseudonym policy

**Folds in:** existing FeaturePack + hive-scout-ingest extensions; existing PlatformDevConfig DCO/contribution flow.

### 9.5 Phase 4 — External coordination plane (separate parallel track)

**Deliverables:**
- Federated mode (DPF-to-DPF GearInterface exchange) — relatively cheap; uses existing substrate
- Bridged mode adapter shims (EDI 850/810 first as smallest-viable industry standard) — sub-spec required
- Customer-facing Cockpit slice (read-only, per-customer scoping)

Does not block Phases 0-3.

### 9.6 Phase 5 — Cleanup (continuous, post-Phase 1)

- Sunset fragmented-event-table *reads* once Cockpit + Calibrator are stable on the GearInterface stream
- **Dual-write continues indefinitely** — `BacklogItemActivity` / `WorkCapsuleActivity` / `BuildActivity` keep receiving their existing writes alongside GearInterface emission. The legacy tables stay as the source of truth for the existing UIs that already read them, until those UIs are migrated to the GearInterface query API
- True read-side projections (materialized aggregates, or views) are deferred to Phase 5 sub-spec — see §11(5)
- Retire or simplify UI-specific reconciliation code only after Cockpit has equivalent evidence coverage and no route depends on the old projection.

### 9.7 In-flight epic composition

| Existing epic / BI | Phase | Role |
|---|---|---|
| BI-CTRL-2B7F31 (unified control plane) | Phase 0+1 | Cockpit + Governor are this BI's deliverables |
| BI-REFACTOR-CC46703A (finding substrate) | Phase 0 | Finding becomes a polymorphic source |
| EP-WWMD-MCP | Phase 1 | Autonomy Governor implementation |
| EP-ASSURANCE-LEDGER | Phase 0 | Evidence foundation reframed as GearInterface stream |
| EP-COST-001 | Phase 2 | Cost is a GearInterface attribute |
| EP-BUILD-9DB5B0 (capability calibration) | Phase 1 | Calibrator's first concrete consumer |
| EP-BUILD-65837F (formal deliberation) | Phase 1 | Deliberation as `graderType` |
| EP-BUILD-58B8E3 (specialist subtask spawning) | Phase 0 | A2A threads emit GearInterface at Ring 1→2 |
| EP-COWORKER-RT | Phase 0 | Coworker runtime feeds Ring 1 |

This composition matters: the substrate sweep confirmed many of these epics are already addressing pieces of the same architectural concern. The Reduction Gear Architecture gives them a common spine.

### 9.8 Backlog filing rule

Do not create a parallel mega-epic that competes with the epics above. The next planning step should either:
- create `EP-REDUCTION-GEAR-ARCH` as a thin governance epic that links the existing epics and owns only cross-cutting GearInterface/Cockpit decisions, or
- extend `EP-BUILD-9DB5B0` with a Phase 0 pilot item if the team wants the first slice to stay inside capability calibration.

Because live MCP search on 2026-05-24 found no existing Reduction Gear spec/plan, a new governance epic is acceptable only if it explicitly references this spec and the overlap list above.

### 9.9 Adjacent in-flight plan — governed-upgrade lifecycle (Ring 4↔5 cross-reference)

A parallel plan is in flight in sibling worktree `D:\DPF\.claude\worktrees\relaxed-roentgen-5b366d\`:

- Plan: `docs/superpowers/plans/2026-05-23-governed-platform-upgrade-phase-0-and-1.md`
- Spec: `docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md`
- BI: `BI-5B3FA415` (triaging)

Second-pass verification note: live MCP backlog on 2026-05-24 confirms `BI-5B3FA415` is triaging and not linked to an epic. Live MCP spec/plan search did **not** return the sibling-worktree plan/spec because they are not yet landed in the indexed docs tree. Treat the sibling path as a working reference until those docs merge; once merged, replace this note with normal repo-relative links.

That effort builds the *mechanism* by which platform versions, signed release manifests, and code move across the Ring 4↔5 boundary. Its **Phase 0+1** (substrate consolidation + `version.json` canonical + `PlatformConfig` mirror + `/api/platform/version` + `/ops/self-upgrade` display) can ship independently and **does not block this spec**. Its **Phase 2** (release CI, channel manifest publisher, signed bundles, migration classifier, `resolveTargetSha` wired to the manifest) is the version/release side of the Ring 4↔5 interface and should be planned *with this spec open*.

Important boundary: governed-upgrade release channels and Hive contribution packs are adjacent, not identical. A channel manifest can reference a calibrated trust artifact by digest, but it must not become the privacy bypass that publishes raw torque histograms. `CalibratedCapabilityPack` creation remains gated by `contribute_to_hive` (§7.1), while upgrade manifests prove release identity, migration risk, seed deltas, and signature integrity.

Explicit cross-reference, governed-upgrade Phase 2 → Reduction Gear Ring 4↔5 instrumentation:

| Governed-upgrade Phase 2 task | Reduction Gear instrumentation |
|---|---|
| Task 16 — Migration kind classifier (additive / modifying / destructive from SQL parse) | Emits or annotates a Ring 4↔5 GearInterface record with `shaftSourceType='migration-classifier'`; destructive migrations map to `slipReason='migration-destructive'` and require HITL before pull/apply. |
| Task 17 — Seed-delta manifest generator (hash shipped content) | Emits source evidence with `shaftSourceType='seed-delta-manifest'` and `shaftSourceId=<manifest digest>`; seed conflicts map to `slipReason='seed-delta-conflict'`. |
| Task 18 — Channel manifest schema + `edge.json` publisher (gh-pages branch) | Emits outward release evidence with `shaftSourceType='channel-manifest'`; the manifest may carry a digest/reference for a `CalibratedCapabilityPack`, but trust histograms remain contribution-gated and privacy-reviewed. |
| Task 19 — Wire `resolveTargetSha` to fetch + verify channel manifest | Emits an **inward** Ring 4↔5 GearInterface record (`innerRing=4`, `outerRing=5`, `transmissionDirection='inward'`) for Hive/release-channel prior → this install. The Governor consults trust score, manifest signature, migration classifier, and seed-delta evidence before allowing the pull/apply path. |

**Convergence patterns the governed-upgrade plan is already practicing** that this spec should adopt at execution time:

1. **Characterization tests before deletion** (governed-upgrade Task 1 pins current behavior in tests before removing legacy code). Reduction Gear Phase 5 cleanup (§9.6) should follow the same pattern when sunsetting legacy event-table read paths.
2. **ADR per substrate decision** (`docs/superpowers/decisions/` — see governed-upgrade Task 7). Each Reduction Gear phase gate should produce an ADR capturing the post-phase substrate state for future engineers and sessions.
3. **Live backlog + tooling check in pre-flight** (governed-upgrade re-queries DPF MCP before executing). Reduction Gear Phase 0 should pre-flight the same way and re-verify §10 substrate honesty at execution time, not just at spec authoring time.
4. **Bidirectional interface records**. Governed-upgrade makes clear that Ring 4↔5 is not only "this install contributes outward." Release-channel pulls, hive priors, and signed manifests flow inward too. This is why `transmissionDirection` is now a schema field (§3.1).

**Convergent platform principles** showing up organically in both efforts — candidates for kernel promotion in a follow-up session:

- **Mirror, don't migrate** — canonical source + runtime mirror + consumer derivation, rather than destructive schema replacement (governed-upgrade: `version.json` → `PlatformConfig` mirror → API/UI derive; Reduction Gear: dual-emit at all 4 interfaces, no migration of legacy tables).
- **Schema honesty over aspirational naming** — column / type / model names reflect what they actually hold today, not what they may carry in a future phase (governed-upgrade: `currentSha`/`targetSha` stay SHA-named until columns actually carry versions; Reduction Gear: `StorefrontArchetype` named correctly throughout the revision).
- **Make silent failures observable** — every "nothing happened" path emits a structured signal (governed-upgrade: `resolveTargetSha.null` logs `self-upgrade.no-target` with tracking BI; Reduction Gear: `slipDetected` + `slipReason` on every interface so non-compounding work is queryable, not invisible).
- **Substrate cleanup before substrate addition** — Phase 0 in both efforts is consolidation, not new substrate (verify-substrate-before-proposing-new kernel principle in action).

## 10. Substrate verification

Per [verify-substrate-before-proposing-new] kernel principle, this section documents what exists today versus what is net-new.

### 10.1 What exists (substrate sweep findings)

This review verified the mapping against the current worktree and live MCP backlog on 2026-05-24. Summary:

| Category | Existing primitives | State |
|---|---|---|
| Evidence | BacklogItemActivity, WorkCapsuleActivity, RuntimeVerification, ToolExecution, AdapterRunTelemetry, BuildActivity, BuildDispatchAttempt, BuildPhaseRun | Rich but fragmented; identical shapes duplicated in places |
| Coordination | WorkCapsule, RuntimeTarget, FeatureBuild, BuildPhaseRun, DeliberationRun, spawn_work_thread | Five lifecycle models, no common shape |
| Governance | WWMD/DecisionPerspectiveProfile, ValueStreamHitlGate, founder kernel principles, BuildStudioGateResult | Multiple gate types, no unified gate-result envelope |
| Capability | AgentModelConfig.minimumCapabilities, SkillDefinition.allowedTools | Overlapping but un-normalized |
| Visibility | build-progress-visibility (6 truth sources!), get_runtime_coordination_map | Reconciliation logic per-surface |
| HITL | Notification, CommunicationChannelBinding, DecisionInteraction, EscalationCapture | Multiple channels, no unified "await decision" |
| Hive | FeaturePack, PlatformDevConfig, hive-scout-ingest, contribute_to_hive | One-way push, one-way pull; contribution governance already exists |

### 10.2 What's net-new

| Net-new | Why net-new |
|---|---|
| `GearInterface` table | The unifying record. No existing table is shaped right (closest is ToolExecution but it's call-scoped, not interface-scoped). |
| Calibrator service | No service today maintains rolling trust per `{agent, capability, archetype, interface, autonomy}` tuple. |
| CalibratedCapabilityPack | New wrapper around existing FeaturePack. |
| Cockpit (gear-train view) | UI is new; built from existing + new data. |
| Graduation events | Net-new concept; no current event marks autonomy elevation explicitly. |
| OTel exporter adapter | Existing telemetry is not shaped as DPF gear spans/events. |

### 10.3 What's refactored / extended (not net-new)

- WWMD → Autonomy Governor: same engine, broader scope (every interface, not just Build Studio gates)
- FeaturePack → CalibratedCapabilityPack: extended, not replaced
- `StorefrontArchetype` / `StorefrontConfig` → gains a runtime-evolving capability profile association without changing the selected archetype source-of-truth contract
- BacklogItemActivity / WorkCapsuleActivity / BuildActivity: continue to exist with their own writes; GearInterface dual-emits alongside them. Long-term migration story (read-side cutover, materialized aggregates, or full deprecation) is deferred — see §11(5)

## 11. Open questions / deferred decisions

These should not block the spec but require explicit resolution during writing-plans or in sub-specs:

1. **Capability vocabulary source.** Derive canonical taxonomy from existing `AgentModelConfig.minimumCapabilities`, `SkillDefinition.allowedTools`, `TOOL_TO_GRANTS`, task types, and route outcome taxonomy, or design fresh? **Recommendation:** derive with a normalization table. Do not treat any one existing source as canonical alone.

2. **Business-outcome attribution at Ring 1→2.** Most internal actions do not have direct revenue outcomes. Lead with proxy metrics (defects prevented, HITL touches saved, hours freed)? **Recommendation:** yes, proxy metrics first; layer revenue/cost attribution at Ring 3+ where business signals are clearer.

3. **Archetype runtime profile shape.** This spec proposes a separate `ArchetypeCapabilityProfile` association. Does it need a table in Phase 1, or can Cockpit/Calibrator projections answer the first questions from GearInterface alone? **Recommendation:** start with GearInterface projections; add the table only when a write-optimized archetype profile is needed.

4. **Existing-table read-cutover and projection strategy.** Dual-emit (write to both) is the baseline. The longer-term question — whether `BacklogItemActivity` / `WorkCapsuleActivity` / `BuildActivity` ever stop receiving direct writes, and whether the Cockpit / legacy UIs converge on a single read path (materialized view from GearInterface, true projection, or indefinite dual-write) — is deferred to a Phase 5 sub-spec. **Recommendation:** indefinite dual-write until legacy UIs migrate. Audit trails preserved either way.

5. **Cross-archetype trust transfer.** When an underlying capability is similar across verticals (e.g., generic code review), can hive trust transfer cross-archetype with a discount factor? **Deferred:** future research question, not Phase 3 scope.

6. **External coordination standards selection.** Which industry standards to support first for bridged mode? **Recommendation:** EDI 850/810 as the first smallest-viable B2B slice, but require a sub-spec that verifies the target industry and customer archetype before locking this in.

7. **Backward compatibility for in-flight builds when GearInterface lands.** Phase 0 only emits Ring 1→2 after the emitter lands. Earlier phase runs will be missing from the Cockpit. **Recommendation:** accept the discontinuity for active builds and do not backfill until the idempotent replay path is proven.

8. **Privacy / anonymization model for CalibratedCapabilityPack.** Histogram bucketing strategy, contributor pseudonym scoping, opt-out mechanism, and contributor reputation model. Phase 3 sub-spec.

9. **Veto / demotion semantics.** When an operator vetoes a graduation event, does that triple cool down? Permanently lose access to that autonomy tier? Configurable cooldown? **Recommendation:** model cooldown explicitly before Phase 1 migration if vetoes affect future eligibility; otherwise store veto as `outcomeType='veto'` and keep cooldown in Governor policy.

10. **GearInterface retention and cold-tier strategy.** With high-volume emitters, a busy install could write 10^4-10^6 GearInterface rows/day. **Recommendation:** choose partitioning/retention in Phase 0 before enabling emitters beyond Ring 1→2; likely partition by `recordedAt` month and keep aggregate projections hot.

11. **Cockpit read-workload at scale.** Phase 2 likely needs materialized aggregates by `{ring, capability, archetype, time-window}`. The planning phase must set thresholds for when the projection becomes mandatory.

12. **OTel collector setup work.** OTel export is not a blocker for GearInterface writes. Plan-time should decide whether collector wiring is a Phase 0 validation task, a pre-Phase-0 spike, or deferred to Phase 2.

13. **Backlog ownership.** Decide whether the first Build Studio pilot item lives under a thin `EP-REDUCTION-GEAR-ARCH` governance epic or under `EP-BUILD-9DB5B0`. Live MCP lookup found overlap but no existing Reduction Gear epic/spec.

14. **Ring 4↔5 release-manifest / trust-pack boundary.** Governed-upgrade manifests and calibrated trust packs are adjacent artifacts. Decide whether a release manifest may reference a `CalibratedCapabilityPack` digest, and which service verifies that the referenced trust payload passed `contribute_to_hive` governance. **Recommendation:** allow references by digest only; never embed raw histograms in public channel manifests.

## 12. Success criteria

### 12.1 Phase 0 (Foundation) done means

- `GearInterface` table exists with migration checks for idempotency and interface invariants
- Ring 1→2 Build Studio phase-completion emitter is live, idempotent, and replay-tested
- Cockpit MVP renders the gear train and the Ring 1→2 drill-down works end-to-end
- An operator can answer "show me what happened inside this build phase, in order, with evidence inline" from one query path
- OTel exporter adapter maps the pilot records to current GenAI/MCP-compatible spans/events behind a feature flag, or the plan records why collector setup is deferred
- The implementation evidence shows the 20% refactoring allocation was spent on shared writer/adapters/tests rather than route-specific glue
- UX verification evidence exists for desktop and mobile per §5.5

### 12.2 Phase 1 (Calibration) done means

- Calibrator maintains rolling trust per triple
- Autonomy Governor consulted at every autonomy-affecting gate
- At least one capability triple has *graduated* in a live install (no toy data)
- Graduation event visible in Cockpit; operator-vetoable
- Ring 2→3 archetype-context calibration works for at least one shipped FeatureBuild with real `StorefrontConfig.archetypeId` resolution

### 12.3 Phase 3 (Hive federation) done means

- A new install in vertical V receives calibrated priors from prior installs in V on day 1
- Cold-start autonomy decisions are measurably better than seed-only (concrete metric: graduation rate in first 30 days vs prior baseline)
- Incoming priors cannot directly elevate autonomy without local evidence, and bad-faith prior poisoning tests pass
- Channel manifests can reference trust payload digests without bypassing `contribute_to_hive`, privacy review, or contributor reputation checks

### 12.4 Full-system success metric

Operator can answer, from one query:

> *"Where in the gear train is torque being lost this week, by triple, with cost impact and graduation eligibility?"*

The platform answers honestly even when the answer is "everywhere" or "we don't know yet." The Cockpit makes the gear train *visible* in the way a real-world gear train is — wear, slip, lubrication, heat, ratios — using a vocabulary that maps to physical mechanical engineering.

## 13. Related principles and prior work

**Founder kernel principles informing this design:**
- [verify-substrate-before-proposing-new](../../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md) — sweep performed; net-new minimized
- [research-before-implementing](../../founder-kernel/wiki/principles/research-before-implementing.md) — OTel GenAI conventions researched before schema lock
- [consult-specs-first](../../founder-kernel/wiki/principles/consult-specs-first.md) — substrate primitives surveyed; existing epics composed
- [structural-verification-is-not-functional](../../founder-kernel/wiki/principles/structural-verification-is-not-functional.md) — success criteria require live-install verification, not just code-merge

**Strategic positioning anchors embedded in this design:**
- Relentless pursuit of automation — platform prime directive
- Reduction gear architecture — the mental model this spec formalizes into schema, governance, and UI

**External references:**
- Mark Bodman, *"Scaling Agentic Loops from Individual"* — https://botman101.substack.com/p/scaling-agentic-loops-from-individual
- OpenTelemetry Semantic Conventions for GenAI — https://opentelemetry.io/docs/specs/semconv/gen-ai/
- OpenTelemetry GenAI agent/framework spans — https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
- OpenTelemetry MCP semantic conventions — https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
- LangSmith — https://docs.langchain.com/langsmith/home
- Langfuse observability — https://langfuse.com/docs/observability/overview
- Temporal workflows — https://docs.temporal.io/workflows
- ServiceNow CSDM (Common Services Data Model) — strategic prior art for the "one platform + one common model" pattern this architecture extends to the agentic domain

**Adjacent in-flight specs:**
- [docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md](2026-05-24-runtime-kernel-commandments.md) — execution-time principle enforcement; composes with the Autonomy Governor (§6.2)
