# Human Experience Closed-Loop — Clickstream Capture, Analysis & Optimization Design

| Field | Value |
| --- | --- |
| Status | Draft research — ready for founder/architect review |
| Date | 2026-06-05 |
| Owner | Mark Bodman |
| Author | Claude (Opus 4.8) |
| Scope | Architecture and approach for silently capturing human user interactions in the portal, analyzing them for friction/poor outcomes, and proposing improvements on a periodic basis through a dedicated AI coworker — a closed analyze→improve loop |
| Out of scope (this pass) | Writing feature code, schema migrations, seeding the coworker. This is the **research-first** deliverable; implementation follows as filed backlog items + plans |
| Primary epic alignment | Proposed new epic `EP-HX-LOOP` (Human Experience Closed-Loop); reuses `EP-REDUCTION-GEAR-ARCH` observability primitives and the continuous-improvement flywheel |
| Related substrate | `GearInterface`, `AdapterRunTelemetry`, `ToolExecution`, `DecisionInteraction` (server/agent side); `ImprovementSignal` flywheel; `BacklogItem` + `AgentActionProposal` pipeline; `portal-navigation-model.ts` |
| Anchor specs/docs | `docs/superpowers/specs/2026-04-05-continuous-improvement-flywheel-design.md`, `docs/superpowers/specs/2026-06-05-portal-navigation-archetype-ia-design.md`, `docs/architecture/ai-coworker-development-principles.md`, `docs/platform-usability-standards.md` |

## Executive Verdict

DPF already has *deep* observability of what **agents and the system** do — `GearInterface` records every capability transmission across ring boundaries, `AdapterRunTelemetry` meters every inference, `ToolExecution` audits every tool call, and `DecisionInteraction` captures governance-gate choices. What DPF has **no substrate for** is what the **human** does in the browser: which routes they visit, where they hesitate, what they click that does nothing, where they rage-click, where they abandon a flow. The portal navigation audit (`2026-06-05-portal-navigation-archetype-ia-design.md`) reached its conclusions by *manually* driving the UI and counting links in the DOM — there is no instrumented evidence stream behind it. That manual method does not scale and cannot run continuously.

The recommended direction is a **four-stage closed loop**, each stage built on an existing DPF primitive rather than a bolt-on analytics SaaS:

1. **Capture** — a lightweight, privacy-first, autocapture-plus-typed-events client SDK that emits a normalized `InteractionEvent` stream, with optional `rrweb`-based session snapshots gated behind heavy masking. Silent by default, zero per-page instrumentation cost.
2. **Store** — an append-only event store (`InteractionEvent`) plus derived per-session rollups (`UxSession`) and pre-computed friction signals (`UxFrictionSignal`), sized for single-org scale (one install = one Org).
3. **Analyze** — a periodic background job (Inngest, same pattern as `material-freshness-decay` / `skill-metrics-aggregator`) that computes friction metrics deterministically, then hands structured aggregates (not raw replays) to a dedicated **UX Analyst coworker** that reasons over them and writes findings.
4. **Optimize (loop closure)** — findings become `ImprovementSignal` rows (dedupe + recurrence), the strongest of which the coworker promotes into `BacklogItem`s via `AgentActionProposal` (`source: automated-detection`). Build Studio then implements; the *next* analysis cycle measures whether the metric moved. Always analyzing, always improving.

The architectural bet: **build capture and analysis on DPF's own observability and flywheel substrate, not on an embedded third-party product-analytics tool.** This keeps data single-org and self-hosted (no third-party data egress — consistent with `dpf-as-integration-conduit` and single-org-per-install), makes the human-experience stream a first-class peer of the agent-experience stream already in `GearInterface`, and lets the same governance/proposal machinery that handles agent-detected work handle UX-detected work.

## Problem Statement & Substrate Evidence

### What already exists (do not rebuild)

| Concern | Existing substrate | File / model |
| --- | --- | --- |
| Agent capability transmission observability | `GearInterface` (Reduction Gear Phase 0) | `packages/db/prisma/schema.prisma:9859` |
| Inference cost/latency/token metering | `AdapterRunTelemetry` | `schema.prisma:2464`; writer `apps/web/lib/routing/adapter-telemetry-writer.ts` |
| Per-tool invocation audit | `ToolExecution` | `schema.prisma:3856` |
| Governance-gate human decision capture | `DecisionInteraction` | `schema.prisma:9269` |
| OTel projection | gear OTel exporter | `apps/web/lib/gear-interface/otel-exporter.ts` |
| Dashboard metric aggregation | workspace-home telemetry | `apps/web/lib/workspace-home/telemetry.ts` |
| Continuous-learning signal intake | `ImprovementSignal` + `createOrTouchImprovementSignal()` | `apps/web/lib/improvement-flywheel/signals.ts` |
| Periodic background jobs | Inngest functions | `apps/web/lib/queue/functions/*` (e.g. `material-freshness-decay.ts`, `skill-metrics-aggregator.ts`) |
| Feature proposal pipeline | `BacklogItem` ← `AgentActionProposal` | `apps/web/lib/actions/proposals.ts`, `backlog.ts` |
| Coworker definition/registration | agent registry + prompts + skills | `packages/db/data/agent_registry.json`, `prompts/specialist/*.prompt.md`, `packages/dpf-skill-pack/skills/*/SKILL.md` |
| Route/destination inventory (analysis ground truth) | portal navigation model | `apps/web/lib/navigation/portal-navigation-model.ts` |

### What is missing (the gap this design fills)

No client-side browser instrumentation exists. Specifically absent: page-view / route-transition tracking, navigation-flow reconstruction, form interaction (field focus, validation errors, abandonment), click/dead-click/rage-click capture, search-query capture, client-side error capture as the *user* experiences it, and any per-session correlation of the above. Confirmed by substrate sweep and by `search_specs_and_plans` returning **zero** hits for clickstream / session-replay / friction across `docs/superpowers/specs` and `docs/superpowers/plans`, and no matching epic in the live backlog.

### Why this matters now

The portal IA audit demonstrated real friction (17-link rail, 118 cross-domain links on `/workspace`, ambiguous "Portal" label) but had to be discovered by hand. A standing capture+analysis loop would have surfaced those same problems from real usage data — and would keep surfacing the *next* set automatically. This is the recursive-self-improvement principle applied to the human surface: every UX improvement the loop finds is also a sellable platform capability (a self-hosted, privacy-first, AI-driven UX optimization engine).

## Design Research

Per `design-research-required`: comparison of open-source and commercial approaches before committing to an architecture. Each row notes the **takeaway DPF should adopt or reject.**

### Open-source / self-hostable

| Solution | Approach | Takeaway for DPF |
| --- | --- | --- |
| **PostHog** (self-hosted) | Autocapture (clicks/pageviews/forms with no per-event code) + custom events + `rrweb` session replay + funnels; ClickHouse-backed | **Adopt the hybrid model**: autocapture for coverage, typed events for signal. PostHog itself warns autocapture-only produces "lack of signal" on high-traffic apps — so DPF must tune autocapture and layer a small set of typed domain events. Do **not** embed PostHog the product (data-egress + operational weight); borrow the model. |
| **rrweb** | DOM full-snapshot + incremental mutation deltas; 5-min session ≈ 100–500KB; powers FullStory/Hotjar/Clarity/OpenReplay/Sentry under the hood | **Adopt as the session-snapshot engine** behind a flag, with `.rr-block`/`.rr-mask`/`.rr-ignore` masking defaults set to *mask-all* and opt-in unmasking. Replay is for human diagnosis of a flagged session, not for the LLM. |
| **OpenReplay** (self-hosted) | rrweb-based replay + performance + privacy-by-default (data never leaves your infra) | Validates the **self-hosted, no-egress** posture as a legitimate first-class option, which aligns with single-org-per-install. |
| **Matomo / Umami / Plausible** | Privacy-first web analytics, aggregate pageviews/funnels, no PII | Confirms aggregate metrics can be computed without identity-level tracking; good fallback posture if PII masking must be absolute. Too shallow alone (no friction signals, no replay). |

### Commercial (reference for *capabilities*, not adoption)

| Solution | Distinctive capability | Takeaway for DPF |
| --- | --- | --- |
| **FullStory** | Auto-detected frustration signals: rage clicks, dead clicks, error clicks, thrashing/excessive scroll; friction scoring | **Adopt the frustration-signal taxonomy** as DPF's deterministic `UxFrictionSignal` kinds. These are computed by rule, cheaply, before any LLM is involved. |
| **Amplitude / Mixpanel / Heap** | Funnel + retention + cohort analysis; Heap pioneered autocapture | Funnel drop-off detection is a deterministic precursor to LLM analysis — compute funnels per key flow, feed drop-offs to the coworker. |
| **Datadog RUM** | Frustration signals tied to real-user-monitoring + back-end traces | **Adopt the join**: correlate a client friction signal to the server-side `GearInterface`/`AdapterRunTelemetry`/`ToolExecution` it triggered. A rage-click on a slow button is a UX *and* a latency problem; the loop should see both sides. |
| **Pendo / Contentsquare** | In-product guidance + LLM-assisted insight narration | Validates **LLM-as-narrator-of-aggregates**, not LLM-over-raw-logs. Matches the UX-research-AI finding below. |

### Method research: how to use an LLM for this without it confabulating

The UX-research-AI literature is explicit: *"giving an LLM a pile of transcripts and asking it to do analysis and synthesis is unlikely to produce good results."* The reliable pattern is a **staged pipeline where each step produces a concrete artifact feeding the next.** This directly informs the coworker design (§Analyze): the LLM never sees raw event firehose or raw replays. It receives **deterministically pre-computed aggregates** (funnel drop-offs, ranked friction signals, session rollups, the route inventory as ground truth) and is asked narrow, grounded questions. This also satisfies the DPF `mechanism-question-grounding-gap` lesson — give the model a real read-only grounding subset, never zero and never the raw firehose.

### Capture-model decision

**Hybrid autocapture + typed events**, mirroring PostHog's recommended default and the explicit warning against autocapture-only. Autocapture gives zero-instrumentation coverage of clicks/pageviews/route-transitions/form-submits; a curated set of **typed domain events** (e.g. `flow.build.ideate_submitted`, `flow.onboarding.archetype_selected`) gives the high-signal funnel anchors the analyzer needs. Typed events are declared centrally (one registry module) so the funnel definitions and the event names cannot drift.

### Sources

- [PostHog — autocapture vs instrumentation](https://posthog.com/docs/product-analytics/autocapture) · [Is autocapture still bad?](https://posthog.com/blog/is-autocapture-still-bad)
- [rrweb (GitHub)](https://github.com/rrweb-io/rrweb) · [rrweb privacy guide](https://github.com/rrweb-io/rrweb/blob/master/guide.md)
- [FullStory — rage clicks / frustration signals](https://www.fullstory.com/blog/rage-clicks/) · [Amplitude — rage clicks](https://amplitude.com/explore/analytics/rage-clicks)
- [Datadog — frustration signals with RUM](https://www.datadoghq.com/blog/analyze-user-experience-frustration-signals-with-rum/)
- [AI analysis & synthesis for UX research: a staged pipeline](https://greatquestion.co/ux-research/ai-analysis-synthesis)
- [Contentsquare — LLM capabilities for experience analytics](https://contentsquare.com/blog/how-to-track-optimize-ai-traffic/)

## Recommended Architecture

```
┌──────────────────────── BROWSER (portal client) ────────────────────────┐
│  HX Capture SDK (silent)                                                 │
│   • autocapture: pageview, route-transition, click, dead/rage-click,     │
│     form focus/blur/submit/validation-error, scroll-depth, JS error      │
│   • typed events: flow.* funnel anchors (central registry)               │
│   • rrweb snapshot (flagged, mask-all default) — opt-in, sampled         │
│   • PII masking + sampling + consent gate applied BEFORE network         │
│   • batched, sendBeacon, non-blocking                                    │
└───────────────────────────────┬──────────────────────────────────────────┘
                                 │  POST /api/hx/collect (batched)
                                 ▼
┌──────────────────────── SERVER (Next.js app) ───────────────────────────┐
│  Collector route → validate → enrich (route from portal-navigation-model)│
│   → write append-only InteractionEvent  (+ optional UxReplayChunk)        │
└───────────────────────────────┬──────────────────────────────────────────┘
                                 │
        ┌────────────────────────┴───────────────────────────┐
        ▼                                                     ▼
┌─────────────────────────┐                    ┌──────────────────────────────┐
│ Inngest: hx-sessionize  │                    │ Inngest: hx-analyze (periodic) │
│  (debounced/streaming)  │                    │  1. deterministic metrics:     │
│  • stitch events→UxSession                    │     funnels, friction signals, │
│  • compute UxFrictionSignal (rage/dead/       │     drop-offs, route dwell     │
│    error/thrash/abandon) by RULE              │  2. join to GearInterface /    │
└─────────────────────────┘                    │     AdapterRunTelemetry        │
                                                │  3. UX Analyst coworker reasons│
                                                │     over AGGREGATES (not raw)  │
                                                │  4. emit ImprovementSignal     │
                                                │  5. promote top-ranked →       │
                                                │     AgentActionProposal →      │
                                                │     BacklogItem (automated-    │
                                                │     detection)                 │
                                                └───────────────┬────────────────┘
                                                                ▼
                                                    Build Studio implements →
                                                    next cycle re-measures the
                                                    metric → loop closes
```

### Stage 1 — Capture (client)

A small first-party SDK (no third-party script) loaded by the portal shell. Design constraints:

- **Silent & non-blocking**: `requestIdleCallback` batching, `navigator.sendBeacon` on flush/unload, never blocks interaction. Sampling rate configurable per Org (default: 100% events, low-% rrweb snapshots).
- **Privacy-first by construction**: masking applied *before* anything leaves the page. rrweb defaults to mask-all text + block inputs; typed events carry no free-text values, only enumerated identifiers + the route + element semantic role. PII never serialized. (Single-org install means data stays in the customer's own DB, but mask-by-default is still the rule — see §Privacy & Governance.)
- **Autocapture taxonomy**: pageview, route-transition (Next.js router), click (with stable element descriptor: role + nearest `data-hx` / aria-label + route), dead-click, rage-click (≥3 clicks same target <1s — the FullStory rule), form field focus/blur/submit/validation-error, scroll-depth milestones, client JS error, API-error-as-seen-by-user.
- **Typed events**: a central `hx-events.ts` registry declaring funnel anchors so analyzer funnel definitions reference the same constants the client emits — no drift.
- **Stable element identity** leans on the existing `portal-navigation-model.ts` so a captured click resolves to a known destination/section, giving the analyzer ground-truth route semantics instead of opaque CSS selectors.

### Stage 2 — Store

Proposed new models (subject to substrate re-verification at build time — file BIs before adding):

- **`InteractionEvent`** — append-only raw event: `orgId`, `sessionId`, `anonUserRef` (pseudonymous, see governance), `eventType`, `route`, `destinationKey` (FK-ish to nav model), `elementDescriptor`, `occurredAt`, `viewport`, `payload` (enumerated/masked JSON), optional `gearInterfaceId`/`toolExecutionId` join keys. Indexed on `(orgId, sessionId, occurredAt)` and `(orgId, eventType, occurredAt)`.
- **`UxSession`** — derived per-session rollup: route path sequence, duration, event counts by type, entry/exit route, outcome classification (completed-flow / abandoned / errored), friction-signal count.
- **`UxFrictionSignal`** — deterministic, pre-LLM: `kind` (rage_click | dead_click | error_click | thrash | scroll_thrash | form_abandon | funnel_dropoff | slow_interaction), `route`, `destinationKey`, `severity`, `occurrences`, `affectedSessions`, optional joined `gearInterfaceId`. This is the analyzer's primary input and the metric the loop re-measures.
- **`UxReplayChunk`** (optional, flagged) — masked rrweb chunks for a sampled/flagged subset, for *human* diagnosis only, with retention TTL.

Sizing: single-org install (one Org per install per `single-org-per-install`) bounds volume dramatically vs. multi-tenant SaaS — Postgres + good indexes is sufficient at this scale; no ClickHouse dependency needed initially. Re-evaluate only if event volume crosses a documented threshold.

### Stage 3 — Analyze (deterministic metrics + UX Analyst coworker)

Two-part, matching the staged-pipeline research finding:

1. **Deterministic pre-computation** (`hx-analyze` Inngest job, periodic — pattern of `skill-metrics-aggregator.ts`): compute funnels for each declared `flow.*`, rank `UxFrictionSignal`s by severity×reach, compute route dwell/bounce, and **join friction to the server side** (`GearInterface` / `AdapterRunTelemetry` / `ToolExecution`) so a slow-button rage-click carries its latency/cost cause. Output: a compact structured **analysis brief** artifact.
2. **UX Analyst coworker** reasons over that brief — never the raw firehose, never raw replays. It receives: ranked friction signals, funnel drop-offs, the route inventory (ground truth), and the joined server-side cause. It is asked grounded questions: *what is the most likely cause of this drop-off; what change would reduce it; what is the confidence; what evidence supports it.* Output: structured findings with cited evidence (signal IDs, session counts), not prose speculation.

New coworker follows the established pattern: registry entry in `packages/db/data/agent_registry.json` (specialist tier, value-stream aligned to Operate/Improve), prompt at `prompts/specialist/ux-analyst.prompt.md`, skill at `packages/dpf-skill-pack/skills/ux-analysis/SKILL.md` (`triggerPattern` + `enforces` kernel principles + `composesFrom: ui-ux-pro-max`). It composes the existing **`ui-ux-pro-max`** skill (67 styles, 96 palettes, 99 UX guidelines, accessibility rules) as its design-knowledge base when proposing concrete fixes — so recommendations cite UX best practice, not invention.

### Stage 4 — Optimize (loop closure)

- Each finding → `createOrTouchImprovementSignal()` (`apps/web/lib/improvement-flywheel/signals.ts`) with `sourceType: "ux_friction"`, stable `sourceId` (e.g. `route+kind`). Dedupe + `recurrenceCount` means a recurring friction gets *louder*, not duplicated — recurrence becomes a priority signal.
- Findings above a confidence/severity threshold → `AgentActionProposal` (`actionType: create_backlog_item`) → on approval → `BacklogItem` with `source: automated-detection`, `workType: feature|bug`, body citing the evidence bundle. Governance approves on **evidence quality** (`governance-approves-evidence-not-provenance`), not on the fact that an agent proposed it.
- **Loop closes** when Build Studio ships the change and the *next* `hx-analyze` cycle re-measures the same `UxFrictionSignal` — if severity×reach dropped, the finding is auto-resolved with before/after evidence; if not, recurrence climbs and it re-surfaces. This is the "always analyzing, always improving" mechanic made concrete and measurable.

## Privacy, Consent & Governance

- **Mask-by-default**: rrweb mask-all + input-block; typed events carry enumerated identifiers only; no free-text, no keystroke content. Unmasking is explicit opt-in per element via `data-hx-allow`.
- **Pseudonymous, not anonymous** (`obfuscated-not-anonymous`): sessions tie to a stable pseudonymous `anonUserRef` so cohorts and repeat-friction are distinguishable, without storing raw identity in the event stream. Mapping to a real user (if ever needed for support) is a separate, access-controlled join.
- **Single-org, no egress**: data lives in the customer's own install DB. No third-party analytics vendor receives the stream — consistent with `single-org-per-install` and `dpf-as-integration-conduit`. This is a *selling point*, not just a constraint.
- **Consent & retention**: a config gate (Org-level) controls capture on/off and rrweb sampling; raw `InteractionEvent` and `UxReplayChunk` carry retention TTLs; derived `UxFrictionSignal`/`UxSession` aggregates can persist longer as they are non-identifying.
- **Auditability**: the coworker's proposals flow through the same `AgentActionProposal` audit trail as every other agent action; nothing auto-merges.

## Phased Implementation (slices to file as backlog items)

Each slice is independently shippable and verifiable. **Do not build ahead** — file the BI, plan it, build it, functionally verify it on the live install before the next slice.

- **Slice 0 — Spec ratification** (this document). Founder/architect review → commit → feed to planning.
- **Slice 1 — Capture SDK + collector + `InteractionEvent`.** Autocapture core (pageview, route, click, rage/dead-click, form, error) + typed-event registry + `/api/hx/collect` + masking + sampling. Verify: drive the portal, confirm events land masked and correctly routed.
- **Slice 2 — Sessionization + friction signals.** `hx-sessionize` job → `UxSession` + rule-based `UxFrictionSignal`. Verify: induce a rage-click / dead-click / form-abandon, confirm the correct signal rows appear.
- **Slice 3 — Deterministic analysis brief + server-side join.** Funnels, drop-offs, dwell, join to `GearInterface`/`AdapterRunTelemetry`. Verify: brief artifact matches hand-computed numbers on seeded data.
- **Slice 4 — UX Analyst coworker.** Registry + prompt + skill (composes `ui-ux-pro-max`), reasoning over the brief, emitting `ImprovementSignal`. Verify: coworker produces grounded, evidence-cited findings on a seeded friction scenario; no confabulation.
- **Slice 5 — Loop closure + proposal pipeline.** Findings → `AgentActionProposal` → `BacklogItem` (`automated-detection`); next-cycle re-measure + auto-resolve with before/after. Verify: full round-trip — induce friction → coworker proposes BI → (mock) fix → re-measure shows resolution.
- **Slice 6 (optional) — rrweb replay.** Flagged, masked, TTL'd `UxReplayChunk` + human replay viewer in `/platform/audit` or `/ops/improvements`. Verify: replay reconstructs a masked session for human diagnosis only.

## Open Questions for Founder / Architect

1. **rrweb session replay — in or out for v1?** It is the highest-value diagnostic and the highest privacy-surface. Recommendation: ship Slices 1–5 first (events + signals + coworker close the loop without replay), add replay as Slice 6 once masking is proven. *Decision needed.*
2. **Capture scope — internal portal users only, or also external `/portal` customer surface?** The IA audit lives in the internal shell. Recommendation: internal portal first (where the optimization target is the DPF product itself), extend to customer storefronts later as a *sellable* capability. *Decision needed.*
3. **Analysis cadence.** Recommendation: daily `hx-analyze` for signals, weekly coworker synthesis pass — matching the "2–4 weeks to statistically significant patterns" research finding while keeping signal latency low. *Decision needed.*
4. **Epic shape.** Propose new `EP-HX-LOOP` rather than folding into `EP-REDUCTION-GEAR-ARCH` (that epic is agent-side observability; this is human-side and large enough to stand alone, while reusing Gear primitives for the join). *Confirm.*

## Proposed Next Step

On approval of this research direction, file the epic `EP-HX-LOOP` and the Slice 0→1 backlog items (substrate-verified), then hand Slice 1 to `dpf-writing-plans` for a phased implementation plan. Per standing process, an approved spec is committed to main and fed to planning in the same step.
