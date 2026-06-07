# Unified Lifecycle Backbone — Common Current / Future / Past State Across Physical and Non-Physical Governed Things

**Status:** Draft
**Date:** 2026-06-07
**Track:** Enterprise-architecture / platform-data-model design
**Primary audience:** Platform architects and operators establishing lifecycle as a shared, cross-cutting design element
**Backlog status (live, DB fallback 2026-06-07):** No live `EP-LIFECYCLE` epic exists. Closest live homes: `EP-PROACTIVE-OPS` (open, 11 items — *Digital Products as full-lifecycle assets, live status, drop detection, criticality*), `EP-DATA-ARCH` (open, 6 items — *data-model mirror into EA*), `EP-AI-OPSMAP` (open, 17 items — *discovery triage / ops map*), `EP-BIZ-CAP` (done — *capability map + maturity*). `EP-ONTOLOGY` referenced by the 2026-03 CSDM6 specs **no longer exists** as a live epic — that reference is stale.
**Chief-architect review note (2026-06-07):** Revised for DPF enum discipline, ArchiMate/CSDM alignment, logical-asset past-state handling, gap-register source truth, and UI/IA fit.
**Companion specs (do not duplicate):**
- [2026-03-12-phase-ea-modeling-foundation-design.md](2026-03-12-phase-ea-modeling-foundation-design.md) — EA meta-model, `EaElement`, lifecycle-native current/future overlay
- [2026-03-21-csdm6-digital-product-metamodel-and-ontology-design.md](2026-03-21-csdm6-digital-product-metamodel-and-ontology-design.md) — conceptual→logical→actual realization, governed things, Digital Product anchor
- [2026-03-26-csdm6-digital-product-ontology-validation-framework-mapping-and-analysis-patterns-design.md](2026-03-26-csdm6-digital-product-ontology-validation-framework-mapping-and-analysis-patterns-design.md) — controlled traversal, blast-radius, gap-pattern families
- [2026-04-02-infrastructure-auto-discovery-design.md](2026-04-02-infrastructure-auto-discovery-design.md) — discovery as current-state signal, staleness escalation
- [2026-04-30-discovery-portfolio-gap-closure-design.md](2026-04-30-discovery-portfolio-gap-closure-design.md) — freshness distinct from lifecycle status (iTop pattern)

---

## 1. Problem

The enterprise-architecture feature now has business architecture (capabilities, value streams), data architecture (the self-mirroring ERD under `EP-DATA-ARCH`), a notation-agnostic EA meta-model (`EaElement` / `EaRelationship` over ArchiMate 4), and a discovered operational estate (`InventoryEntity` / `InventoryRelationship`). What it does **not** have is a *single, common lifecycle definition* that lets the platform reason coherently about **current state, future (desired) state, and past state** for **every governed thing — physical and non-physical — through one model**.

Industry solves this with bifurcated tools: an **Asset Management** system for the physical/financial lifecycle, a **CMDB** for the operational/configuration lifecycle, an **EA tool** (ArchiMate/TOGAF) for the conceptual/future-state design, plus separate **vulnerability**, **SBOM/EOL**, and **data-quality** tools. The lifecycle of "the same thing" is therefore expressed in four-to-six disconnected vocabularies that never reconcile. DPF's stated position is to **amalgamate these into one common approach** rather than re-bifurcate them.

The platform has already drifted toward that bifurcation internally. Lifecycle/state is expressed today in at least five **non-reconciled** vocabularies (verbatim from `packages/db/prisma/schema.prisma`):

| Layer | Model | Lifecycle/state fields today | Axis it captures |
|---|---|---|---|
| EA design | `EaElement` | `lifecycleStage` (plan/design/build/production/retirement), `lifecycleStatus` (draft/active/inactive), `refinementLevel` (conceptual/logical/actual) | **future + structural** |
| Product | `DigitalProduct` | `lifecycleStage`, `lifecycleStatus`, `version` | future→current |
| Operational asset | `InventoryEntity` | `status` (active/inactive), `supportStatus` (unknown/supported/deprecated/end-of-life), `firstSeenAt`/`lastSeenAt`/`lastConfirmedRunId`, `observedVersion` | **current (observed)** |
| Service | `ServiceOffering` | `status` (draft/approved/active/discontinued), `effectiveFrom`/`effectiveTo` | current (commitment) |
| Document / Agent / Capability | `Document.currentState`, `Agent.lifecycleStage`, `BusinessCapability.currentMaturity`/`targetMaturity` | per-model bespoke | mixed |

Three structural gaps follow:

1. **No common lifecycle definition.** `EaElement`/`DigitalProduct`/`Agent` happen to share the `lifecycleStage`×`lifecycleStatus` pair, but `InventoryEntity`, `ServiceOffering`, and `Document` each invented their own. There is no single source of truth for "what are the lifecycle states and legal transitions," so the same real-world transition (a server going end-of-life; a capability being superseded; a product retiring) is modelled five different ways.
2. **No current↔future↔past relationship as a first-class thing.** The `Plateau` ("a relatively stable state of the architecture") and `Gap` ("a difference between two states") ArchiMate element types **are already seeded** (`seed-ea-archimate4.ts:72`, `:73`, relationship `gap associated_with plateau` at `:168`) — but they are inert nouns. Nothing **derives a current-state Plateau from the discovered estate**, **computes Gaps to a target Plateau**, or **scopes those Gaps into portfolio/product work**. This is exactly the ArchiMate weakness the goal calls out: ArchiMate models conceptual/future state well but "doesn't deal with current state" — because nothing populates the current-state plateau from operational reality.
3. **No common home for the cross-cutting "jobs and concerns."** Technology obsolescence/EOL, vulnerabilities, data-quality, and operational break-fix are each handled (or not) in isolation, with no shared mechanism that turns them into prioritised, fundable change at the portfolio level.

This design establishes lifecycle as a **shared platform design element** that closes all three gaps without adding a parallel tool.

---

## 2. Goals / Non-Goals

**Goals**
1. One **canonical lifecycle model** — a single source of truth for realization stage, lifecycle stage, operational condition, and currency — that *every* governed thing resolves to, physical and non-physical.
2. Make **current / future / past state** first-class and *relational*, anchored on ArchiMate `Plateau` + `Gap` (already seeded), with the **current-state plateau auto-derived from discovery/operational evidence**.
3. A **gap-analysis → portfolio/product investment** flow that scopes deltas into the *existing* backlog substrate (`Epic` / `BacklogItem` → `FeatureBuild` → Build Studio), so future-state design drives funded change.
4. Make **EOL / obsolescence, vulnerability, data-quality, and break-fix** uniform **gap generators** against the current-state baseline — the amalgamation of Asset Mgmt + CMDB + EA + vuln + DQ into one approach.
5. Keep complexity hidden from layman users (progressive disclosure) while the ontology underneath stays rich enough for mature use.

**Non-Goals**
- Replacing `InventoryEntity` discovery, `EP-PROACTIVE-OPS` operational status, or `EP-DATA-ARCH` mirroring — this **unifies and connects** them, it does not re-implement them.
- A formal OWL/JSON-LD serialization (deferred per the CSDM6 metamodel spec).
- Net-new asset-financial-management (depreciation schedules etc.) beyond the lifecycle hooks needed to drive planning.
- Forcing non-digital/physical-only assets into a digital-only model (they participate via the manifested axis).

---

## 3. Research & Benchmarking

Per AGENTS.md §10. Open-source data models read, not just feature lists.

| System | Pattern studied | Adopted | Rejected |
|---|---|---|---|
| **ServiceNow CSDM 5** | Two-attribute lifecycle: **lifecycle *stage*** (design→build→operate→retire family) separate from **install/operational *status*** (e.g. *Pipeline / Catalog / Operational / Retired / End-of-Life*). Plateau-like "desired state" lives in APM, not CMDB. | The stage-vs-status separation (already mirrored by DPF's `lifecycleStage`×`lifecycleStatus`). | Keeping desired-state in a *separate* product from operational state — that is the bifurcation we reject. |
| **iTop / Combodo** | Explicit `operational status` (production/stock/obsolete) **separate from discovery freshness**; stale CIs are *downgraded, not deleted*. | Freshness as an axis orthogonal to lifecycle status (already adopted in `2026-04-30-discovery-portfolio-gap-closure-design.md`). | — |
| **LeanIX** | Lifecycle as a **time-phased band** per fact sheet (plan/phase-in/active/phase-out/end-of-life *with dates*) driving an obsolescence-risk roadmap. | Time-phased currency dates (`supportEndsAt`, `targetDate` on plateaus) to drive obsolescence gaps. | LeanIX's separate "Technology Risk" surface — we fold it into the one gap register. |
| **BMC Helix / iTop CMDB** | Explicit CI classes + governed relationships; impact analysis only over typed edges. | Relationship-class-aware traversal (CSDM6 controlled-traversal rules). | Generic transitive closure as "impact." |
| **Backstage** | Compact `kind` + relations catalog; lifecycle as a simple enum (`experimental/production/deprecated`). | Compact shared enum + a shared validation library over inventing per-model status soup. | Too-narrow enum — insufficient for audit/portfolio. |
| **OpenMetadata** | First-class lifecycle *events* + lineage; state changes are append-only events. | A universal `LifecycleEvent` log (generalising the existing `DocumentLifecycleEvent`). | — |
| **TOGAF ADM Phase E/F + ArchiMate Implementation & Migration** | **Plateau** (a stable architecture state at a point in time), **Gap** (delta between two plateaus), **Work Package** + **Deliverable** to realise a transition; Architecture Roadmap = ordered plateaus. | The *entire* Plateau→Gap→Work-Package→Deliverable chain — **all four element types are already seeded** (`seed-ea-archimate4.ts:70-73`); we add the machinery. | Treating plateaus as purely conceptual artefacts disconnected from running reality. |

**Gap the design fills:** every system above either (a) keeps future-state design and current-state operations in separate tools, or (b) has the EA constructs (plateau/gap) but never populates the current-state plateau from live discovery. DPF's differentiator is to make the **baseline plateau a projection of the live estate** and the **gap register the single queue that EOL, vuln, DQ, and break-fix all feed** — one lifecycle, one planning surface.

**Standards / precedent anchors to keep in the spec:**
- ServiceNow CSDM standardises lifecycle as a **stage + stage-status value pair** and explicitly maps legacy asset/CI/service statuses into those pairs rather than deleting old fields. DPF should copy the migration pattern: canonical resolution first, destructive cleanup only after consumers converge. Source: [ServiceNow CSDM foundation domain](https://www.servicenow.com/docs/en-US/bundle/xanadu-servicenow-platform/page/product/csdm-implementation/concept/foundation-domain.html), [CSDM implementation stages](https://www.servicenow.com/docs/r/servicenow-platform/common-service-data-model-csdm/csdm-implementation-stages.html).
- ServiceNow also separates unsupported/end-of-support from retired: an operational CI can be unsupported without being retired. DPF's `currency` axis must therefore never imply `lifecycleStage = retirement` by itself. Source: [ServiceNow product lifecycle values](https://www.servicenow.com/docs/r/servicenow-platform/common-service-data-model-csdm/csdm-lifecycle-df-product.html).
- Backstage keeps a compact `spec.lifecycle`, but treats `relations` and `status` as processor-derived API fields. DPF should follow that precedent for baseline plateau membership: source rows remain authoritative, while projector jobs materialise relations/status for read performance. Source: [Backstage descriptor format](https://backstage.io/docs/features/software-catalog/descriptor-format/).
- ISO 55000:2024 frames asset management around value realisation across the asset lifecycle. DPF's portfolio payoff should stay value/risk/funding oriented, not just technically accurate. Source: [ISO 55000 overview](https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/08/30/83053.html).
- ArchiMate implementation/migration precedent is Plateau + Gap + Work Package + Deliverable; the design is aligned when the persisted analytic rows point back to those seeded EA elements instead of becoming a second notation. Source: [Sparx ArchiMate implementation and migration example](https://sparxsystems.com/enterprise_architect_user_guide/17.1/modeling_languages/implementation_and_migration_example.html).

## 3.1 Chief-Architect Alignment Findings Folded Into This Draft

1. **Keep canonical lifecycle as a resolver before a rewrite.** A big-bang `GovernedThingLifecycle` table would be elegant but high-risk. The industry migration precedent is value-pair mapping over legacy fields first; DPF should land `resolveLifecycle()` and validation invariants before moving storage.
2. **Do not let "currency" masquerade as lifecycle.** `unsupported` and `end-of-life` are risk/currency states for manifested assets. They generate gaps, but they do not automatically retire the object.
3. **Logical things still need a past state.** Capabilities, controls, information objects, service definitions, and policies are not "decommissioned," but they are superseded, replaced, withdrawn, or archived. Past-state derivation must work for logical things through Plateau membership + `LifecycleEvent` reason, not through `freshness` or vendor currency.
4. **Name analytic rows so they do not collide with ArchiMate element types.** The EA seed already has `gap`, `plateau`, `work_package`, and `deliverable` element types. Database rows should be named `LifecycleGap` and `PlateauMembership`, each optionally linked to the corresponding `EaElement`, so the rows are operational analysis records rather than a competing notation.
5. **Polymorphic references need an allowlisted contract.** `(governedThingKind, governedThingId)` must be validated through a shared `GovernedThingRef` registry, not raw strings accepted by every caller. This is the only way the generic event/membership/gap rows stay safe as more models join.

---

## 4. Core Design — Three Orthogonal Axes + A Temporal Relation

The amalgamation rests on separating axes that today are conflated into ad-hoc `status` strings. A governed thing's lifecycle is **three orthogonal axes plus a temporal perspective that is derived, not stored**.

### 4.1 Axis A — Realization stage *(structural maturity; already `EaElement.refinementLevel`)*
`conceptual | logical | actual` — the CSDM6 elaboration axis (intent → architected structure → operational reality). **Action:** promote from a free-form nullable string to a strongly-typed enum (AGENTS.md §3), index it, and make it a *shared* concept resolvable for any governed thing, not only `EaElement`.

### 4.2 Axis B — Lifecycle stage *(progression; already `lifecycleStage`)*
`plan | design | build | production | retirement` — IT4IT-value-stream-aligned. **This is the canonical progression and already the shared one.** No new vocabulary; the work is to make `InventoryEntity`/`ServiceOffering`/`Document` *resolve to it* rather than carry rivals.

### 4.3 Axis C — Operational condition *(current condition; `lifecycleStatus` + `freshness` + `currency`)*
- `lifecycleStatus`: `draft | active | inactive` (existing).
- `freshness`: `fresh | stale | retired` (existing on the discovery side, `2026-04-30` spec) — observed recency, **only meaningful for `actual`/manifested things**.
- `currency` *(new, manifested only)*: `current | approaching-eol | unsupported | end-of-life` derived from `supportEndsAt` / vendor support data — the obsolescence dimension. Hyphens are mandatory per AGENTS.md §3.

### 4.4 The temporal perspective is *derived*, via Plateau membership — not a fourth column
This is the key amalgamation move. "Current / future / past" is **not** a field on each row; it is *which plateau a governed thing's state belongs to*:

- **Future (desired) state** = governed things whose state is `realizationStage ∈ {conceptual, logical}` and/or `lifecycleStage ∈ {plan, design}` — *designed intent*. Grouped into one or more **target `Plateau`s** (each with a `targetDate`). This is where the enterprise architect works.
- **Current state** = governed things at `realizationStage = actual`, `lifecycleStatus = active`, **corroborated by an operational signal** (`freshness = fresh`, a passing health probe, or a confirmed discovery run). Grouped into the **baseline `Plateau`**, which is **auto-projected from the live estate** (§5). *Discovery is the evidence of current state* — closing the ArchiMate current-state gap.
- **Past state** = retained Plateau membership and append-only lifecycle events for things that were retired, disposed, superseded, withdrawn, archived, or no longer observed. Manifested assets usually enter past state through `lifecycleStage = retirement` or `freshness = retired`; logical assets usually enter it through `lifecycleStatus = inactive` plus a `LifecycleEvent.reason` such as `superseded`, `replaced`, or `withdrawn`. Retained for audit and historical traversal; never hard-deleted (iTop downgrade pattern).

### 4.5 Physical vs non-physical *(manifestationClass — derived, formalised)*
Already implicit in the seed's `LOGICAL_STAGES` vs `FULL_STAGES` split (`seed-ea-archimate4.ts:11-17`). Formalise as a derived classifier on element type:
- **`logical` (non-physical):** capabilities, information objects (conceptual), services, controls, value streams. **No `retirement`/`inactive`** — they are *superseded*, not decommissioned. No `freshness`/`currency`.
- **`logical` (non-physical):** capabilities, information objects (conceptual), services, controls, value streams. They do not have discovery `freshness` or vendor `currency`, but they still have history: a logical thing can be superseded, replaced, withdrawn, or archived and therefore appear in a past plateau.
- **`manifested` (physical/operational):** technology nodes, devices, deployed product instances, data stores, AI coworker endpoints. **Full lifecycle** including `retirement`, plus `freshness` and `currency`.

> **Net effect:** one lifecycle definition, four axes, two of which (freshness, currency) simply do not apply to non-physical things. No bifurcation — the same model degrades gracefully by manifestation class, and past state remains available for both logical and manifested things.

---

## 5. The Baseline Plateau Is a Projection of the Live Estate

The single most important mechanism, and the one that distinguishes this from every EA tool benchmarked.

- A **`baseline` Plateau** is continuously (re)projected from current-state evidence: `actual`/`active`/`fresh` `InventoryEntity` rows, their `InventoryRelationship`s, the `DigitalProduct`s they're bound to (`BI-PROACT-A2`), and `production/active` `EaElement`s. The projection is a *materialised membership*, refreshed by the same discovery cadence that already escalates staleness (`2026-04-02` spec).
- A **`target` Plateau** is authored by the architect (or proposed by a coworker) as the desired future state — additions, upgrades, retirements, consolidations.
- This makes "current state" a **living, evidence-backed artefact** rather than a hand-drawn diagram that rots. ArchiMate gets the current state it never had, sourced from the CMDB-equivalent discovery layer — the amalgamation in action.

**Reuses, does not add:** `Plateau`/`Gap`/`Work Package`/`Deliverable` element types (seeded), `InventoryEntity`/discovery (built), `EaElement` bridges `digitalProductId`/`infraCiKey` (built), freshness escalation (designed). The new substrate is plateau *membership* + the projector job.

### 5.1 Projection Contracts

The projector is a read-model builder, not a new source of truth.

- **Idempotent.** The same evidence snapshot produces the same `PlateauMembership` rows. Re-running a projection updates membership snapshots and provenance fields; it does not create duplicates.
- **Evidence-qualified.** Each baseline membership records why it is current: discovery run id, health probe id, manual confirmation, or source model timestamp. A row without evidence provenance cannot enter the baseline plateau.
- **Staleness preserves history.** When evidence goes stale, the current membership is closed or marked non-current, and a `LifecycleEvent` records the reason. The source object is not deleted.
- **Manual curation is separated.** Architect-authored target membership and projector-authored baseline membership use the same table but distinct `membershipSource` values: `projected | curated | imported`. This keeps human intent from being overwritten by the discovery job.
- **No generic traversal.** Gap generation uses the controlled traversal policies already seeded in `seed-ea-archimate4.ts`; `associated_with` is never treated as a universal impact edge.

---

## 6. Gap Analysis → Portfolio / Product Investment

A **`LifecycleGap`** is a typed delta between a baseline and a target plateau, computed + curated. It may link to an ArchiMate `Gap` `EaElement`, but it is not itself the notation element:

- **Gap kinds:** `add` (in target, not baseline), `change` (different state/version), `remove` (in baseline, not target), and the cross-cutting generators below.
- **Gap dimensions** (why it matters, for prioritisation/funding): `capability` (maturity shortfall — already `currentMaturity` vs `targetMaturity`), `technology_currency` (EOL/obsolescence), `vulnerability` (security), `data_quality` (trust/housekeeping), `operational` (drop/break-fix), `cost`, `regulatory`/`risk`.
- **Scoping into existing planning substrate (the investment driver):** each Gap is scoped to a level and lands as work:
  - **Portfolio level** → `BacklogItem.type = "portfolio"` (cross-product investment), optionally grouped under a **Work Package** element → `Epic`.
  - **Product level** → `BacklogItem.type = "product"` linked via `digitalProductId`.
  - The `Deliverable` element type represents the realised result, closing the loop back to the plateau when the work ships.
- This is the **portfolio-planning payoff**: the architect refines a desired future state → the platform computes gaps → gaps become prioritised, fundable backlog scoped at the right level → Build Studio executes → shipped `Deliverable`s advance the baseline plateau toward the target. Financial, regulatory, and risk goals are served because every gap carries its dimension and can be ranked by business value.

**Source-truth rule:** the backlog remains the work source of truth. A `LifecycleGap` can propose or link a `BacklogItem`, but it never owns work status. Work status comes from `BacklogItem` / `Epic` / `FeatureBuild`; architectural state comes from Plateau membership and lifecycle events.

**Deduplication rule:** a generator must produce a stable `gapKey` from `(dimension, governedThingRef, baselinePlateauId, targetPlateauId, signal identity)`. Repeated CVE, EOL, DQ, or break-fix signals update the same open `LifecycleGap` unless the underlying signal materially changes.

---

## 7. Cross-Cutting Concerns as Gap Generators (the amalgamation payoff)

Instead of separate Asset/CMDB/vuln/DQ tools, each concern is a **uniform producer of dimensioned gaps against the live baseline**:

| Concern ("job") | Signal source (existing/near) | Becomes |
|---|---|---|
| **Technology obsolescence / EOL** | `InventoryEntity.supportStatus` + new `supportEndsAt`/`currency`; LeanIX-style date bands | `technology_currency` gaps, ranked by criticality propagation (`BI-PROACT-D2`) |
| **Vulnerability** | findings on `actual` resources → CSDM6 blast-radius traversal (`resource → component → product → offer → consumer`) | `vulnerability` gaps with bounded impact |
| **Data quality / housekeeping** | `PortfolioQualityIssue`, `EaConformanceIssue`, MDM (`EP-MDM`) survivorship | `data_quality` gaps that gate trustworthy analysis |
| **Operational break-fix** | `EP-PROACTIVE-OPS` drop-detection, derived operational status (`BI-PROACT-B2`) | `operational` gaps |

One gap register, one prioritisation surface, one funding flow — across what industry splits into many tools. Data quality is explicitly in-scope because, as the goal states, you cannot do proper analysis/planning on a dirty baseline.

---

## 8. Schema & Library Changes (proposed, to be confirmed in planning)

Recommended **hybrid** (see §10 decision):

1. **`lib/lifecycle.ts` — single source of truth.** Canonical enums (`REALIZATION_STAGES`, `LIFECYCLE_STAGES`, `LIFECYCLE_STATUSES`, `FRESHNESS`, `CURRENCY`, `MANIFESTATION_CLASS`), legal-transition tables, and `resolveLifecycle(governedThing)` that maps any model (incl. `InventoryEntity`, `ServiceOffering`, `Document`) onto the common axes. Mirrors the `apps/web/lib/backlog.ts` enum pattern (AGENTS.md §3). *Unifies vocabulary with zero data migration risk first.*
2. **`lib/governed-thing-ref.ts` — allowlisted polymorphic references.** `GovernedThingKind` is a closed enum of models that may participate in lifecycle. The library validates ids, resolves display labels, and prevents arbitrary `(kind, id)` pairs from entering event/membership/gap rows.
3. **Promote `EaElement.refinementLevel`** to a typed, indexed enum; backfill. Keep enum values `conceptual | logical | actual`.
4. **`LifecycleEvent`** — universal append-only transition log keyed by `(governedThingKind, governedThingId, fromState, toState, reason, actorPrincipalId?, evidenceRef)`, generalising `DocumentLifecycleEvent`. Identity-bearing actors resolve through `Principal`, not a new actor table.
5. **`PlateauMembership`** — `(plateauElementId, governedThingKind, governedThingId, membershipSource, validFrom, validTo?, stateSnapshot, evidenceRef?)`; the baseline projector writes `projected` rows, the architect curates `curated` target rows.
6. **`LifecycleGap`** persistence — `(gapKey, baselinePlateauId, targetPlateauId?, kind, dimension, governedThingKind, governedThingId, severity, scopeLevel, backlogItemId?, workPackageElementId?, eaGapElementId?, status)`. The `Gap`/`Plateau`/`Work Package`/`Deliverable` *element types* already exist; this adds operational analytic rows that can point back to those elements.
7. **`InventoryEntity.supportEndsAt` + derived `currency`** for obsolescence. Values use hyphenated strings: `current`, `approaching-eol`, `unsupported`, `end-of-life`.

No change to the `BacklogItem`/`Epic`/`FeatureBuild` planning substrate — gaps *land in it*.

### 8.1 Invariants

- `LifecycleGap.backlogItemId` is nullable until scoped; once set, work status is read from `BacklogItem`.
- `LifecycleGap.status` is only the gap record lifecycle (`open | scoped | resolved | dismissed`), not implementation progress.
- A baseline `PlateauMembership` must have `membershipSource = "projected"` and a non-null `evidenceRef`.
- A target `PlateauMembership` must have `membershipSource = "curated"` or `"imported"` and a non-null `targetDate` on its Plateau element snapshot.
- `currency` applies only when `manifestationClass = "manifested"`. Resolver output for logical things must return `currency: null`, not `"current"`.
- `freshness` applies only when current-state evidence is observable. Resolver output for logical-only things must return `freshness: null`.

---

## 9. UX (progressive disclosure)

- **`/ea` → "States & Roadmap"**: baseline (current, live-projected) ↔ target plateaus side-by-side; lifecycle-stage overlay (`2026-03-12` use case "current vs future state overlay").
- **Gap register** (report-kit `DataTable` + `StatusBadge` + `FilterBar`, AGENTS.md §12): gaps by dimension/severity/scope, each with a "scope to backlog" action.
- **Portfolio investment view**: gaps rolled up to portfolio with business-value ranking → the planning/funding conversation.
- Layman users see "what's aging / at risk / needs attention and what it'll take to fix" via the coworker panel; plateaus/gaps/traversal stay backstage.

### 9.1 UX Fit Guardrails

**Decision:** fits-with-guardrails.

- **Owning area:** Platform / Enterprise Architecture, with layman summaries projected into Workspace or AI Coworker only when action is needed.
- **Route family:** canonical home is `/ea`; do not add a new global nav area for lifecycle. A secondary shortcut from portfolio/product pages may deep-link to a filtered gap register.
- **Primary persona:** founder/operator and platform architect deciding what to fund, retire, remediate, or defer.
- **Navigation layer touched:** section nav under `/ea`, plus contextual "scope to backlog" actions. No new global nav item.
- **Reuse/convergence:** reporting/data-display surfaces use report-kit (`DataTable`, `FilterBar`, `StatusBadge`, `StatCard`, `ExportButton`) and central `statusColors`. Do not hand-roll severity badges or KPI tiles.
- **Source truth:** visible gap status comes from `LifecycleGap`; visible work progress comes from `BacklogItem` / `Epic` / `FeatureBuild`; visible current-state evidence comes from `PlateauMembership.evidenceRef`.
- **Empty state:** a fresh install should say there is not enough discovery evidence to project a baseline and offer the next governed discovery action. It must not show a blank roadmap full of zeros.
- **Failure state:** if the projector is stale or failed, show last successful projection time and the failed evidence source; keep the last baseline visible but marked stale.
- **AI boundary:** gap cards and metric tiles navigate only. Any coworker-starting action must preview the gap context, proposed backlog scope, and expected next step before creating work.

---

## 10. Key Open Decision (for the architect)

**How to carry the canonical lifecycle across heterogeneous models?**
- **(A) Shared enums + validation library only** — fastest, unifies vocabulary, lowest risk; each model keeps its columns but they're validated/typed through one library and mapped by `resolveLifecycle()`. Weak on universal audit.
- **(B) Separate `GovernedThingLifecycle` table** — one polymorphic lifecycle record + event log for everything; strongest single-source-of-truth and audit, heaviest migration.
- **(C, recommended) Hybrid** — (A) now to kill the vocabulary fork with near-zero risk, plus the universal `LifecycleEvent` log and `Plateau`/`Gap` analytic rows from (B) for the current↔future machinery. Sequences cleanly into slices and lets value land before the heavy migration.

**Architect decision:** adopt **C, Hybrid**, with one refinement: do not call the analytic delta table `Gap`; call it `LifecycleGap` and link it to an optional ArchiMate `Gap` element. This keeps DPF aligned to CSDM migration precedent while preserving ArchiMate notation fidelity.

## 10.1 Implementation Slices

1. **Vocabulary resolver first:** `lib/lifecycle.ts`, `lib/governed-thing-ref.ts`, unit tests, and no migration except typed/indexed `EaElement.refinementLevel` if required by Prisma.
2. **Event and membership substrate:** `LifecycleEvent`, `PlateauMembership`, projector read-model job, idempotency tests, and backfill from existing `DocumentLifecycleEvent` only after the new event contract is proven.
3. **Baseline projection:** project actual/active/fresh inventory + bound digital products + production EA elements into a baseline Plateau; expose stale/failure states.
4. **LifecycleGap register:** add generator contract, stable `gapKey`, EOL/currency generator first, then capability maturity and data-quality generators.
5. **Backlog scoping:** add guarded "scope to backlog" flow that creates or links existing `BacklogItem` through the canonical backlog APIs/MCP path; do not mutate planning tables directly from the gap generator.
6. **UX:** `/ea` States & Roadmap plus gap register using report-kit; deep links from portfolio/product pages only after source-truth and permission states are clear.
7. **Convergence cleanup:** once consumers read through `resolveLifecycle()`, deprecate or migrate bespoke lifecycle/status fields model-by-model. This is the refactoring budget target, not slice 1.

---

## 11. Relationship to Live Epics

- **Extends `EP-PROACTIVE-OPS`** — its current-state operational signals (`BI-PROACT-A2` estate binding, `BI-PROACT-B2` derived status, `BI-PROACT-C1` expected-presence/desired-state) *feed the baseline plateau projection*. This backbone gives those items their unifying frame.
- **Complements `EP-DATA-ARCH`** — information-object lifecycle + DQ gaps.
- **Sits above `EP-AI-OPSMAP`** — discovery triage is the current-state evidence source.
- **Builds on `EP-BIZ-CAP`** (done) — `currentMaturity`/`targetMaturity` is the first capability-dimension gap.
- **Proposed epic:** `EP-LIFECYCLE` — *Unified Lifecycle Backbone & Gap-Driven Portfolio Planning* — or fold §8.1–8.2 (the canonical model) into `EP-PROACTIVE-OPS` and open `EP-LIFECYCLE` for the plateau/gap/investment machinery. (Overlap check + epic decision belongs in the filing step.)

---

## 12. Conformance Test

The backbone succeeds only if, end-to-end: an architect refines a target plateau → the platform computes dimensioned gaps against a **live-projected** baseline → gaps scope into portfolio/product backlog at the right level → Build Studio ships deliverables → the baseline plateau advances — **and** an EOL date, a CVE, and a data-quality issue all arrive as gaps in the *same* register feeding the *same* funding flow. One lifecycle, one planning surface, no bifurcation.

Additional acceptance checks:

1. `resolveLifecycle()` returns the same canonical axes for `EaElement`, `DigitalProduct`, `InventoryEntity`, `ServiceOffering`, and `Document` without callers reading model-specific status strings.
2. A logical capability can become historical through a superseding event and past Plateau membership without fake `freshness` or `currency`.
3. An unsupported but still running CI produces a `technology_currency` `LifecycleGap` without automatically setting the asset to retired.
4. Re-running the baseline projector over unchanged evidence produces no duplicate memberships or gaps.
5. Closing a scoped backlog item resolves or updates the linked `LifecycleGap` and records a `LifecycleEvent`.
6. `/ea` renders empty, stale-projector, no-permission, and happy-path states with report-kit primitives and DPF theme tokens.
