# Operational Value-Stream Architecture — Platform Implementation Design

- **Status:** Historical implementation design; current semantic authority is the 2026-08-01 FPAW standard
- **Author:** Claude (directed by maintainer: "design to implement the value-stream research across the platform — coworker facilitation/interop, capture value streams as architecture to measure & optimize each archetype's business model, repurpose surfaces over new screens, lean into coworker proactivity on critical activities")
- **Date:** 2026-06-12
- **Source artefact:** [`docs/architecture/archetype-business-value-streams.md`](../../architecture/archetype-business-value-streams.md) — the 2026-08-01 snapshot covers 24 categories and 106 unique leaf archetypes (the *what*; this spec is the historical *how*).
- **Related specs:** `2026-06-09-dap-experience-layer-design.md` (the experience layer this rides on), `2026-06-09-bian-banking-archetypes-design.md` (capability decomposition precedent), `2026-05-22-customer-surface-archetype-activation-design.md` (capability activation), `2026-06-09-civic-and-member-governed-archetypes-design.md` (governance axes).
- **Primary backlog:** [opendigitalproductfactory#1724](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/1724) (capture value-stream architecture at setup + WWWD substrate). Epics: `EP-ARCH-8D4F2A` (Archetype Model V2, primary), `EP-PROACTIVE-OPS`, `EP-COWORKER-RT`, `EP-A2A`, `EP-HX-LOOP`, `EP-AI-OPSMAP`, the DAP epic.

> **Backlog context note:** the `dpf` MCP backlog tools were not reachable in the authoring session, so the live-backlog sweep that normally opens a DPF spec is deferred. #1724 is the capture-phase BI; this spec is its umbrella design. Reconcile epic links when MCP is back.

> **Current authority (2026-08-01).** The [Four-Portfolio Archetype and AI Workforce Operating
> Standard](../../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md) owns the
> distinction between independent industry operational ValueStreams and explicit DigitalProduct
> lifecycle bindings. `PortfolioDecomposition.It4ItStage[]` is legacy migration metadata, not a
> semantic authority and not evidence that an industry stream is IT4IT `Consume`.

---

## 1. Problem statement

The value-stream research ([source artefact](../../architecture/archetype-business-value-streams.md)) established, for every archetype, the **operational value stream** the business runs in the real world — its six-stage backbone (Attract · Capture · Qualify · Deliver · Settle · Retain), its **load-bearing stage**, its **demand–capacity dynamics**, and its **trust gates**. That understanding lives only in a planning document. The running platform does not:

1. **Capture the value stream as architecture** — there is no persisted, portal-visible model of how *this org's* business actually works, so the EA surface, the coworkers, and the dashboards cannot reason about it.
2. **Measure and optimize the business model against it** — the platform holds the raw signals (inbox submissions, bookings, invoices, customer estate, compliance posture) but never composes them into *value-stream health* per stage, nor compares the load-bearing stage against its archetype's target band, nor proposes the §7.3 levers.
3. **Use it to coordinate coworkers and pre-empt critical activities** — coworkers answer what they are asked; they do not share a map of the business that lets them hand off along stage boundaries, nor proactively raise the demand/capacity inflections and trust-gate obligations a busy operator forgets (the holiday boarding peak, the pre-season HVAC maintenance shift, the disclosure renewal, the vaccination recall).

This spec designs all three **by repurposing existing surfaces and mechanisms**, adding essentially no new top-level screens.

## 2. Design tenets

1. **Derive, don't author.** The value-stream model is a pure function of the archetype's existing `OperatingModelAxes` / `ActivationProfile` / `SchedulingDefaults` / `BillingPatternProfile` (`packages/storefront-templates/src/types.ts`). No hand-authored per-org data, no new per-archetype tables (verify-substrate-before-proposing-new).
2. **Repurpose surfaces, don't multiply screens.** Every value-stream concern lands on a surface that already exists (Section 6). The single genuinely new *rendering* is an operational-value-stream **view type** on the EA canvas that already renders value streams — not a new route.
3. **Ambient proactivity, interrupt by exception.** All coworker proactivity is delivered through the DAP experience layer's existing policy (ambient periphery by default; cross-process inbox for decisions; IRC `riskClass` gates push) — never new popups. (`2026-06-09-dap-experience-layer-design.md`.)
4. **Business context is WWWD, not WWMD.** Every decision this design surfaces is a *business-of-the-customer* decision and consults the org's **WWWD** profile, kept strictly separate from the platform's WWMD profile (source artefact §8.8).
5. **One model, four consumers.** The persisted value-stream model is the single source the EA view, the dashboards, the coworkers, and the proactivity engine all read — no parallel representations.

## 3. The core object — the Operational Value Stream Model (OVSM)

### 3.1 What it is

A derived, persisted projection per org describing its operational value stream. One record set, computed at setup (and recomputed on archetype-reset), holding:

| Field | Source (existing substrate) |
|-------|------------------------------|
| `stages[]` (the six + two cross-cuts) | constant backbone (artefact §2) |
| `loadBearingStages[]` | derived from `commercialModel` (artefact §3 table) |
| per-stage `capabilityBindings[]` | `ActivationProfile.modules` + `CAPABILITY_REGISTRY` (artefact §5) |
| per-stage `metricBindings[]` | the KPI sources in Section 5 |
| `capacityUnit` + `demandSignature` | derived from axes + category (artefact §7.1–7.2) |
| `trustGates[]` | `GovernanceModel`, `ProvisioningModel`, `seededServiceCategories`, `disclosures` section (artefact §6) |
| `legacyIt4itStageMetadata` | `PortfolioDecomposition.It4ItStage[]`; migration input only, to be replaced by complete evidence-bearing DigitalProduct bindings |

### 3.2 Where it lives (decision — see §10 Q1)

Preferred: **a derived projection materialized as an EA view** (reusing the `eaView` / `viewElements` substrate behind `/ea/views/[id]`) plus a small derived cache keyed off `storefrontConfig.archetypeId` for the dashboards and coworkers to read cheaply. This avoids a new authoritative table — the OVSM is *generated*, never hand-edited, so it can be recomputed from the archetype at any time. The org's accumulated overrides (the WWWD overlay) sit beside it, not inside it.

### 3.3 Derivation

Extend the existing activation-profile derivation path (`apps/web/lib/storefront/archetype-activation.ts` → `readActivationProfile()`), which already runs at setup and on archetype-reset, to also emit the OVSM. This is the build target of #1724. Because it is the same axes the activation profile already reads, the OVSM is "free" data — the cost is the projection + render, not new capture.

**Backfill for pre-generator installs (landed 2026-06-20).** Because the OVSM is projected only at setup / archetype-reset, an install that completed storefront setup *before* the generator (#1798, 2026-06-13) was running on it — or that adopts the generator on a later upgrade — has a `StorefrontConfig` + archetype but no `archetype_value_stream` EaView, so `/ea/value-streams` shows the empty "No value-stream view generated yet." state with nothing to self-heal it (observed on the live `software-platform` install set up 2026-06-16). `apps/web/lib/storefront/backfill-operational-value-streams.ts` (`backfillOperationalValueStreamsOnBoot`) closes the gap: wired into `instrumentation.ts` boot alongside the other reconcilers, it runs the same idempotent projection for any storefront missing its operational-value-stream view. It is cheap when already present (one existence query per storefront, scoped on `${orgId}:operational`, no projection) and non-fatal per org — an archetype with no template OVSM derivation, or an unseeded EA notation, is logged and skipped rather than crashing boot.

## 4. Capture as architecture — the EA surface (repurpose `/ea`)

The EA feature already renders value streams: `/ea/value-streams` lists value-stream projections; `/ea/views/[id]` renders the Archimodel canvas (graph / swimlane / matrix / layered); `lib/actions/ea-archimate.ts` `exportArchimateFile()` exports them; `/ea/capabilities` renders the Business Capability Map.

**Plan (reuse, one new view type):**
- Generate the OVSM as an **operational value-stream EA view** — a swimlane of the six stages + two cross-cuts, each stage bound (serving relationship) to the capabilities (`ActivationProfile.modules`) that enable it (artefact §5), with the **load-bearing stage(s) emphasized** and the **capacity unit / demand signature / trust gate** annotated on the relevant stage.
- Surface it on the **existing** `/ea/value-streams` list alongside reference-model projections and render it on the **existing** `/ea/views/[id]` canvas. Distinguish the independent industry operational stream from IT4IT lifecycle streams through its type and label. Any join must use a complete, evidence-bearing DigitalProduct binding; `PortfolioDecomposition.It4ItStage` is migration metadata only.
- `exportArchimateFile()` gains the OVSM as an exportable scope — making the operational value stream a first-class ArchiMate **Value Stream** element (artefact §8, architecture/export presentation view), no new export surface.

This satisfies "capture the value streams as architectures" with **zero new routes** — it is a new *generator + view type* on the EA canvas that already exists.

## 5. Measure & optimize — stage KPIs on existing dashboards

### 5.1 Stage → KPI → existing data source → existing surface

Every stage's health is computed from data the platform already holds, and rendered on the metric-card surfaces that already exist (no new dashboards):

| Stage | KPI (value-stream health signal) | Existing data source | Existing surface to host the overlay |
|-------|----------------------------------|----------------------|--------------------------------------|
| S1 Attract | storefront published/legible; (later) portal views | `storefrontConfig`, sections/items | `/storefront` dashboard |
| S2 Capture | inbox submissions; capture→won conversion | `/storefront/inbox`, orders/bookings/donations | `/storefront` + `/customer` RevenueCockpit |
| S3 Qualify/Schedule | **utilization / occupancy; no-show rate; lead time** | `ProviderAvailability`, operating hours, bookings | `/workspace` (calendar), `/storefront` |
| S4 Deliver | estate completeness; delivery/fulfilment | customer estate, `ConfigurationItem`, sales-orders | `/customer` account + cockpit |
| S5 Settle | revenue, expense, P&L, AR/AP, recurring | finance module (`/finance`, P&L report) | `/finance` hub (FinanceSummaryCard) |
| S6 Retain | repeat rate; recurring agreements; renewals | customer estate, `service-agreements` module | `/customer` cockpit, `/workspace` |
| Trust gate | obligations/disclosures/license status | compliance module (`regulatoryAlert`, obligations) | `/compliance` dashboard (RegulatoryAlerts) |

### 5.2 The load-bearing headline metric

For each archetype, the **load-bearing stage's** KPI is promoted to the org's headline business-model metric (artefact §6–§7): salon → chair utilization against the 75–85% band; pet-boarding → kennel occupancy + peak advance-booking coverage; restaurant → covers/turns vs no-show; gym → retention/breakage; florist → perishable spoilage vs pre-order coverage; mortgage → underwriting throughput; accounting → workforce vs busy-season load; trades → capture quality + emergency-reserve adherence. This is the "measure the business model" deliverable, surfaced as the top card on the **existing** `/workspace` home (repurpose `PlatformWorkspaceHome` / `command-center.ts`), not a new analytics screen.

### 5.3 The optimization loop

`measure stage signal → compare to archetype target band → coworker proposes a §7.3 lever → WWWD-gate the proposal → human decides → track effect.` The proposal/decision/track machinery is the existing decision-perspective + ledger (`DecisionInteraction`); the levers are the §7.3 requirement set (booking windows, reorder points, waitlists, rostering, surcharge). This is where "optimize the business model" becomes a running loop rather than a static report.

## 6. Surface-reuse map (the "no new screens" contract)

| Value-stream need | Hosting surface (exists today) | Change verb |
|-------------------|-------------------------------|-------------|
| Capture as architecture | `/ea/value-streams`, `/ea/views/[id]`, `exportArchimateFile()` | **reuse + new view type** (generator) |
| Stage capability bindings | `/storefront/settings/capabilities` (`CapabilityActivationToggle`) | reuse (already shows activation) |
| Stage KPIs / health | `/finance`, `/customer`, `/storefront`, `/compliance` metric cards | **overlay** (add value-stream lens) |
| Load-bearing headline metric + nudges | `/workspace` home (`command-center.ts`) | **refactor** the "next recommended work" surface |
| Coworker facilitation | `AgentCoworkerShell` (mounted every route) | reuse (inject OVSM into prompt) |
| Proactive critical-activity alerts | DAP cross-process inbox + ambient periphery | **wire** (close the notifications gap) |
| Business-model templates | `/admin/business-models` (`INDUSTRY_TO_MODELS`) | reuse (link OVSM ↔ model) |

**Net new top-level screens: zero.** One new EA *view type*, several dashboard *overlays*, and prompt/profile/scheduler refactors.

## 7. AI coworker facilitation & interoperation

This is the heart of the design: the OVSM becomes **the shared map** that lets coworkers coordinate around the business instead of around isolated screens.

### 7.1 Stage ownership — map stages to the existing agent roster

The agent registry (`packages/db/data/agent_registry.json`, `agent-model-defaults.ts`) and the route→agent routing (`apps/web/lib/tak/agent-routing.ts`, `ROUTE_AGENT_MAP` with per-route `systemPrompt`) already exist. Assign each value-stream stage a primary coworker, and inject the OVSM stage context into that route agent's system prompt (refactor `RouteAgentEntry.systemPrompt`):

| Stage | Primary coworker (existing role) | Route it already owns |
|-------|----------------------------------|------------------------|
| S1 Attract / S2 Capture | Marketing-Specialist | `/storefront`, `/customer/marketing` |
| S3 Qualify / Schedule | COO / Ops-Coordinator | `/workspace`, `/ops` |
| S4 Deliver | Customer-Advisor | `/customer` |
| S5 Settle | Accountant | `/finance` |
| S6 Retain | Customer-Advisor / Marketing-Specialist | `/customer` |
| Trust gate | Compliance coworker | `/compliance` |
| Cross-stage orchestration | COO (orchestrator) | `/workspace` |

Each agent now reasons in value-stream terms ("you own Settle for an encounter-based vet clinic; the load-bearing stage upstream is Deliver, owned by the Customer-Advisor; the trust gate forbids clinical advice").

### 7.2 Interoperation along stage boundaries — reuse the agent event bus

Coworkers hand off along value-stream seams using the **existing** collaboration substrate (`apps/web/lib/tak/agent-event-bus.ts`): `collaboration:summon` (a coworker brings a peer in), `collaboration:handoff` (parent→child thread), `collaboration:return` (child returns with outcome). The orchestrator-worker pattern (`build-orchestrator.ts`) and the structured `PhaseHandoff` (summary / evidence / openIssues / userPreferences) are the model — reused for *business* handoffs rather than build phases.

Worked example: at S3 the COO detects a peak-demand capacity shortfall (boarding holiday week). Resolving it needs a pricing change (S5) and a marketing push (S2). The COO **summons** the Accountant (surcharge proposal) and the Marketing-Specialist (advance-booking campaign) via `collaboration:summon`, each returns a proposal via `collaboration:return`, and the COO composes the recommendation for the human — all on the existing bus, with the OVSM as the shared frame so the handoffs carry business context, not raw chat.

### 7.3 The WWWD decision profile — reuse the decision-perspective gate

The decision kernel (`apps/web/lib/decision-perspective/build-studio-gate.ts` → `evaluateDecisionPerspective()`, scoring in `lib/decision/option-scoring.ts`, ledger `DecisionInteraction`, outcomes `recommend | arbitrate | escalate | defer`) is profile-pluggable: today it loads `MARK_DPF_PLATFORM_PROFILE` (WWMD). 

**Add a per-org WWWD profile** (parallel seed to `packages/db/src/seed-decision-perspective.ts`) whose decision materials are **seeded from the OVSM** — the load-bearing stage, the capacity cost-asymmetry, the trust gates — giving a fresh install a business-context decision baseline before it has its own history (artefact §8.8). When a coworker proposes a §7.3 optimization (surcharge, overbook, reorder, roster), it is scored against the WWWD profile: `recommend` → coworker surfaces it; `arbitrate` → present options; `escalate` → push to the human via the inbox; `defer` → hold. As the org accepts/overrides, its WWWD overlay compounds. **No new decision engine** — a new profile + domain class on the existing one.

### 7.4 Human-in-the-loop — delegate, not assignee

Per the DAP layer, the human operator stays the **named owner**; coworkers act on their behalf. Every proactive action and optimization proposal is an *elicitation* (the DAP "ask") rendered in the cross-process inbox with L1/L2/L3 context (the decision, what changed, blast radius) — never a silent mutation of the business.

## 8. Proactivity — pre-empting critical activities

The operator's hardest, most-forgotten work is exactly the demand/capacity inflections and trust-gate obligations the OVSM now encodes. This turns the value-stream model into a **proactivity engine**.

### 8.1 Triggers from the OVSM

- **Demand-signature calendar.** Each archetype's peak windows (artefact §7.2) become scheduled look-ahead checks: boarding ~6 weeks before Thanksgiving/Christmas; HVAC pre-season maintenance shift into Feb–Apr; florist pre-order cutoff before Valentine's; accounting busy-season staffing 4–6 months out; retail Q4.
- **Capacity-vs-forecast.** When projected demand in a peak window exceeds the capacity unit (kennels, chair-hours, underwriting throughput), raise the relevant §7.3 lever proactively ("you have 12 kennels and ~40 likely holiday requests — open advance booking + deposit now?").
- **Trust-gate obligations.** Disclosure/license/insurance renewals and regulated-archetype duties (FDIC/NMLS/POST, gift-aid) → reminders ahead of expiry, sourced from the compliance module.
- **Recurring critical activities.** Vaccination recall (vet), benefit-year recall (dental), membership-renewal saves (gym, where January joiners churn by February), no-show protection and dead-weekday-fill (salon), perishable FIFO/pre-order (florist/bakery).
- **Utilization out of band.** Load-bearing-stage KPI drifting below/above its target band (salon <70% idle / >85% hire) → nudge with the corrective lever.

### 8.2 Engine — reuse the scheduler, watchdog, and command-center

- The marketing `ScheduledOutboundAction` dispatcher (`apps/web/lib/marketing/scheduler.ts`, `tickScheduler()` Inngest cron) already fires on lifecycle milestones — generalize it to fire OVSM look-ahead checks against the demand calendar.
- The `taskrun-watchdog` (`apps/web/lib/queue/functions/taskrun-watchdog.ts`) liveness pattern is the model for an OVSM "did the operator act on the critical reminder?" watch.
- `command-center.ts` ("next recommended work") is the home for the surfaced nudges; proactive items carry `TaskRun.source = "proactive"` (the existing proactive provenance).

### 8.3 Delivery — the DAP experience layer (no new popups)

Every proactive item flows through the **existing** DAP policy: ambient phase chip / periphery for non-urgent awareness; **cross-process inbox** for anything needing a decision, classified on the IRC model via `HitlNotificationEvent.riskClass` (a license-renewal-overdue is push; an off-peak utilization dip is ambient). This **closes the known DAP gap** (notifications API at `app/api/v1/notifications` is currently wired only for self-upgrade) by extending it to value-stream events — a wiring task, not a new surface.

## 9. Impact map (multiple impacts, repurpose-first)

| Area | File(s) / surface | Change | Risk |
|------|-------------------|--------|------|
| OVSM derivation | `lib/storefront/archetype-activation.ts` | extend activation derivation to emit OVSM (=#1724) | low — same axes already read |
| EA capture | `/ea/value-streams`, `/ea/views/[id]`, `lib/actions/ea-archimate.ts` | new operational-value-stream view type + export scope | medium — new generator, existing canvas |
| Dashboards | `/finance`, `/customer`, `/storefront`, `/compliance` | stage-KPI overlay (reuse metric cards) | low — additive overlays |
| Workspace home | `/workspace`, `lib/workspace/command-center.ts` | load-bearing headline metric + proactive nudges | medium — refactor "next work" surface |
| Coworker prompts | `lib/tak/agent-routing.ts` (`RouteAgentEntry.systemPrompt`) | inject OVSM stage ownership per route | low — prompt data |
| Coworker interop | `lib/tak/agent-event-bus.ts`, orchestrator | business handoffs along stage seams | medium — reuse build pattern for ops |
| Decision perspective | `seed-decision-perspective.ts`, `build-studio-gate.ts` | add per-org **WWWD** profile + domain class | medium — parallel to platform profile |
| Proactivity engine | `lib/marketing/scheduler.ts`, `taskrun-watchdog.ts` | OVSM demand-calendar look-ahead | medium — generalize scheduler |
| Notifications | `app/api/v1/notifications` + DAP inbox | wire value-stream events (closes DAP gap) | low–medium |

No schema-heavy new tables; the OVSM is a derived projection (§3.2). The largest conceptual additions are the **WWWD profile** and the **demand-calendar look-ahead** — both extensions of existing engines.

## 10. Open questions / decisions

1. **OVSM persistence home** — derived EA view + read-cache (preferred), vs a lightweight `OrgValueStream` record, vs pure on-read derivation. Lean to derived+cache to keep it regenerable and avoid authoritative drift. *(verify-substrate before adding any table.)*
2. **WWWD profile scope** — one profile per org seeded from the archetype, then overlaid by org decisions; confirm the domain-class taxonomy (parallel to `plan-readiness`).
3. **Measurement readiness** — S5/S3/S6 are computable from current data; **S1 Attract lacks portal-analytics capture** — flag as a dependency (small new signal, or accept a partial S1 metric initially).
4. **Net-new-surface tolerance** — confirm one new EA *view type* (not a route) is acceptable as the only new rendering.
5. **Proactivity cadence & noise budget** — the IRC `riskClass` thresholds per trigger class, so the engine helps without nagging (the explicit anti-goal).

## 11. Phasing

- **P0 — Capture (architecture).** Derive + persist OVSM; render on `/ea`; ArchiMate export. (Delivers #1724; unblocks everything.)
- **P1 — Measure.** Stage-KPI overlays on existing dashboards + load-bearing headline metric on `/workspace`.
- **P2 — Facilitate.** Stage ownership in route agent prompts; business handoffs on the agent event bus; seed + consult the WWWD profile.
- **P3 — Proactively optimize.** Demand-calendar/capacity look-ahead → DAP inbox/ambient; critical-activity reminders; the closed measure→propose→WWWD-gate→decide→track loop (EP-HX-LOOP alignment).

Each phase is independently shippable and rides existing surfaces, so value lands incrementally without a big-bang UI change.

## 12. Relationship to the source artefact

This spec implements the [value-stream artefact](../../architecture/archetype-business-value-streams.md): §3 commercial-model shapes → load-bearing derivation; §4 stage→surface bridge → Sections 5–6 here; §5 substrate binding → §3 OVSM fields; §7 demand–capacity → §8 proactivity; §8.8 WWWD separation → §7.3 decision profile; §10.1 rental gap → out of scope (separate archetype work). The artefact is the *what each archetype needs*; this is *how the platform delivers it through the surfaces and coworkers it already has*.
