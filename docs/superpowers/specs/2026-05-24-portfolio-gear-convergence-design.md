---
title: Portfolio × Gear Convergence — binding shared substrate between the four-portfolio maturity model and the reduction-gear architecture
authoredAt: 2026-05-24
authoredBy: mark-bodman
status: draft
specKind: convergence
parentSpecs:
  - docs/superpowers/specs/2026-05-21-four-portfolio-agent-control-plane-maturity-design.md
  - docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md
relatedSpecs:
  - docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md
  - docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md
  - docs/superpowers/specs/2026-05-16-ux-auditor-coworker-design.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md
  - docs/founder-kernel/wiki/principles/consult-specs-first.md
  - docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md
  - docs/founder-kernel/wiki/principles/structural-verification-is-not-functional.md
---

# Portfolio × Gear Convergence

## Role of this spec

This is a **convergence spec**. It does not own any schema, route, or backlog mutation. It exists to bind two simultaneously-authored operating models — the four-portfolio agent control plane maturity design and the reduction-gear architecture — so that the substrate they share is implemented once, not twice.

Neither parent spec owns this binding because the binding outcome may amend either parent. Both authors retain veto on convergence proposals; the binding decisions in §4 are subject to operator ratification and may flow back as amendments to either parent before any implementation slice lands.

**Pre-condition for any implementation work touching either parent:** consult §4 and §6 of this spec. Implementation that violates a §4 binding decision is rejected at review regardless of which parent it cites.

## 1. The two operating models

| Operating model | Axis 1 | Axis 2 | Operator question answered |
|-----------------|--------|--------|---------------------------|
| **Four-Portfolio Maturity** ([spec](2026-05-21-four-portfolio-agent-control-plane-maturity-design.md)) | Breadth — the four portfolio roots (Foundational, Manufacturing & Delivery, For Employees, Products & Services Sold) | Investment posture — 0–5 `maturityScore`, `confidenceGrade ∈ {verified, evidenced, claimed, stale}`, `effectiveMaturity` dependency cascade | "Where do we own, build, buy, or avoid? Where is the platform investment-ready, operations-ready, or productize-ready?" |
| **Reduction Gear Architecture** ([spec](2026-05-24-reduction-gear-architecture-design.md)) | Depth — five concentric rings (Coworker → Workflow → Archetype → Sandbox→Prod → Hive) | Trust ladder — HITL-required → HITL-fallback → auto-confirm → auto-silent, with explicit graduation events keyed by `{agent_id, capability_name, archetype_context}` | "Where is torque being lost in the gear train right now? Which triples are ready to graduate? What does the operator need to lubricate?" |

By construction these axes are orthogonal — neither parent spec mentions the other, and neither needs to. They are two diagnostic surfaces over one capability fabric. The platform must not pay for that fabric twice.

```
                      INVESTMENT POSTURE (Four-Portfolio)
                      claimed → evidenced → verified
                          ↑
                          │
                          │   capability fabric
   BREADTH ◄──── Foundational ─┼─ M&D ─ Employees ─ Sold ────► (Four-Portfolio)
   axis                       │
                              │
   DEPTH ◄──── Ring 1 ─ Ring 2 ─ Ring 3 ─ Ring 4 ─ Ring 5 ────► (Reduction Gear)
   axis                       │
                              │
                              ↓
                      TRUST LADDER (Reduction Gear)
                      HITL-required → hitl-fallback → auto-confirm → auto-silent
```

Both axes index the same set of capabilities, archetypes, agents, and evidence rows. The convergence question is which substrate they share and which they keep local.

## 2. Why this spec exists separately

A unified spec would force one author to pick architectural sides on day one. A pair of amendments to the parents would scatter the binding across two files and lose coordination. A separate convergence spec:

- gives both parent authors a neutral surface to negotiate the shared decisions;
- gives implementation reviewers a single page to cite when a slice in either parent forks a shared substrate;
- gives operators a single page to read when they want to understand how the two diagnostic surfaces compose;
- gives the next coordination wave (cross-customer, hive federation, productization) a stable contract to extend.

If this spec is wrong, both parents stay correct. If a parent is wrong, this spec absorbs the correction without re-opening the other parent. Convergence is the cheap, recoverable layer.

## 3. Substrate ownership map

This table inventories every load-bearing primitive named by either parent and assigns ownership. **Shared** means both surfaces read from one source; **local** means each parent keeps its own. The §4 binding decisions resolve every disputed row.

| Primitive | Owned by | Four-Portfolio role | Reduction Gear role | Convergence decision |
|-----------|----------|---------------------|---------------------|----------------------|
| Capability vocabulary | **Shared** (new module) | `capabilityCategory` enumerated set | `capability_name` derived vocabulary | §4.1 |
| Archetype-scoped runtime state | **Shared** | `installScope = customer_overlay` + `archetypeScope` on `CapabilityMaturityAssessment` | `ArchetypeCapabilityProfile` (proposed) | §4.2 |
| Trust + maturity relationship | **Shared formula** | `maturityScore`, `effectiveMaturity` | autonomy tier, graduation events | §4.3 |
| Evidence ledger feed | **Shared (gear → maturity)** | `evidenceFreshness` → `confidenceGrade` | `GearInterface` rows are emission events | §4.4 |
| WWMD governance engine | **Shared** | Quarterly capability reviewer | Per-execution Autonomy Governor | §4.5 |
| Operator surface composition | **Shared component layer** | `/portfolio` per-portfolio maturity overlay | Cockpit cross-ring gear view | §4.6 |
| MCP / tool gateway policy | Four-Portfolio (`tool_gateway` category) | Maturity-scored | Consumed by gear as a capability | (no fork) |
| Identity / authority | Four-Portfolio (`identity_authority` category) | Maturity-scored | `actorPrincipalId` on every GearInterface row | (no fork) |
| Append-only mutation log | **Shared substrate** | `MaturityScoreEvent` (per spec §8.1.A) | Graduation events (per gear §3.4, §6.4) | §4.7 (downstream of §4.4) |
| Productization gate | Four-Portfolio (`productizationStatus` lifecycle) | Owns the gate | Hive contribution must compose it | §5.1 |
| Hive contribution package | Reduction Gear (`CalibratedCapabilityPack`) | Productize gate is a pre-condition | Owns the format | §5.1 |
| External coordination adapter | Reduction Gear (bridged-mode shims) | Classified as `boundary_adapter` per Four-Portfolio §11 | Owns the adapter substrate | §5.2 |
| Theme tokens / audit-lens helpers | **Shared `packages/maturity-ui`** | `/portfolio` consumes | Cockpit consumes | §4.6 + §5.3 |

## 4. The six binding decisions

Each decision is written as a single sentence that any implementation reviewer can cite. The rationale paragraphs explain the trade-off; the binding sentence is what governs code.

### 4.1 Capability vocabulary

**Binding decision:** Capability names live in one module — proposed `packages/capability-taxonomy` — owned by neither parent. Both `CapabilityMaturityAssessment.capabilityCategory` and `GearInterface.capabilityName` import from this module. No surface authors a parallel enum.

*Rationale.* Four-Portfolio §8 enumerates seven categories (`runtime`, `identity_authority`, `tool_gateway`, `data_plane`, `budget_spend`, `evidence_eval`, `human_override`) plus an `composition_helper` escape hatch. Reduction Gear §3.3 + §11(1) calls for a derived vocabulary from `AgentModelConfig.minimumCapabilities`, `SkillDefinition.allowedTools`, `TOOL_TO_GRANTS`, task types, and route outcomes. These are not the same granularity — Four-Portfolio names categories; Reduction Gear names leaf capabilities. The convergence is hierarchical: Four-Portfolio's eight values are the **parent categories**; Reduction Gear's leaves are the **operationally-emitted names**. The shared module exports both, with a typed parent-of relationship. Neither parent can amend the enum unilaterally.

*Implementation hook.* `packages/maturity` (per Four-Portfolio §17 #6) imports from `packages/capability-taxonomy`. Reduction Gear's GearInterface writer imports from the same. Migrations that add a leaf without a parent category, or a category not previously declared, fail review.

### 4.2 Archetype-scoped runtime state

**Binding decision:** Archetype-scoped capability state lives in one table consumed by both surfaces. The proposed `ArchetypeCapabilityProfile` (Reduction Gear §4.2) is the runtime-evolving projection; the Four-Portfolio `CapabilityMaturityAssessment` row with `installScope = customer_overlay` and `archetypeScope` set is the management-evaluation projection of the same state. They reconcile through the `archetypeId` + canonical capability key, not through parallel writes.

*Rationale.* Both specs correctly refuse to aggregate across archetypes silently (Reduction Gear §7.3, Four-Portfolio §10.2 + AC #15). But each introduces its own carrier — `ArchetypeCapabilityProfile` (Reduction Gear) vs `customer_overlay` rows (Four-Portfolio). Two carriers of the same archetype-scoped truth means two writers, two staleness profiles, two drift surfaces. The convergence picks one carrier as authoritative (`ArchetypeCapabilityProfile` for live calibration state) and treats the maturity-overlay row as the **derived management view** computed from it on demand.

*Implementation hook.* The Four-Portfolio writer module (`packages/maturity`) reads `ArchetypeCapabilityProfile` when constructing customer-overlay rows; it never writes to `ArchetypeCapabilityProfile`. The single-writer discipline in Four-Portfolio AC #20 extends across the boundary — only the gear ingestion writer mutates the profile.

### 4.3 Trust ↔ maturity relationship

**Binding decision:** `effectiveMaturity` is capped by the **median autonomy tier** of the graduated triples under its capability category, computed by the maturity writer at evaluation time. Specifically: a capability category cannot show `effectiveMaturity ≥ 4` unless the median triple under it has graduated past `hitl-required`. A category at `maturityScore = 4` with zero `auto-confirm` triples is rendered as `effectiveMaturity = 3` with a "no graduated triples" annotation.

*Rationale.* Today neither spec relates the two scoring systems, so a category could sit at `maturityScore = 4` while no agent has graduated past HITL on a single triple in the category — vanity maturity. The convergence makes the relationship one-directional and conservative: graduation density is a necessary signal for high maturity, but maturity does not imply autonomy for any specific triple. The reverse direction (maturity cap on autonomy elevation) is rejected — the Autonomy Governor must remain free to escalate or block any individual triple regardless of category maturity.

*Implementation hook.* `packages/maturity` adds `deriveAutonomyFloorContribution(capabilityCategory, calibrator): { medianTier, sampleSize, contributesCap }` consulted before `effectiveMaturity` is finalized. Test: a category with five `hitl-required` triples and no graduations cannot render above effective 3 regardless of seeded `maturityScore`.

### 4.4 Evidence ledger feed

**Binding decision:** `GearInterface` is the **primary** feed into Four-Portfolio's `evidenceFreshness` and `lastAssessmentAt`. Other evidence sources (PRs, tests, user outcomes) remain valid but are secondary — a capability whose GearInterface stream has been silent for > 30 days demotes to `stale` regardless of other evidence types. This is the same anti-rot rule already in Four-Portfolio §5.3, with `GearInterface` named as the canonical staleness signal.

*Rationale.* Four-Portfolio's `evidenceSources` is a heterogeneous list; without a canonical primary, the `confidenceGrade` calculation has to weight types it doesn't fully understand. Reduction Gear's GearInterface is exactly the right shape for this: a typed, indexed, idempotent record per capability emission. Naming it primary closes the rot vector and ties the two specs' staleness rules to one signal.

*Implementation hook.* `packages/maturity` queries `GearInterface` by `capabilityName` to compute `evidenceFreshness`. The Phase 0 Ring 1→2 pilot in Reduction Gear (§9.1) is the **earliest** that maturity scoring can transition from "claimed bootstrap" to "evidenced" for the capabilities Build Studio covers. Capabilities not on Build Studio's path stay `claimed` until their own ring emitter ships.

### 4.5 WWMD governance engine

**Binding decision:** The Autonomy Governor (Reduction Gear §6.2) and the quarterly maturity reviewer (Four-Portfolio §8.1) are the **same WWMD engine instantiated at two cadences**. The quarterly review consumes the Autonomy Governor's graduation log as primary evidence for score and `vendorReplacementConfidence` updates.

*Rationale.* Both surfaces correctly delegate decisions to WWMD-arbitrated coworkers per the [WWMD decision-perspective kernel](2026-05-17-wwmd-decision-perspective-kernel-design.md). Without naming them as one engine, two reviewer personas drift, two evidence-citation patterns emerge, and the quarterly review loses the per-execution signal that proves capability health. Naming them as one engine with two cadences keeps the trust loop closed.

*Implementation hook.* The quarterly review job (Four-Portfolio §8.1 critical/elevated cadence) queries the graduation log from the Calibrator (Reduction Gear §6.1) as its primary input. "This capability graduated 14 triples to `auto-confirm` last quarter" is a stronger maturity signal than any seeded score and overrides `claimed` on its own. Human escalation per Four-Portfolio §8.1 applies identically to both cadences.

### 4.6 Operator surface composition

**Binding decision:** `/portfolio` and the Cockpit are **sister surfaces sharing a component library** (`packages/maturity-ui`). The Cockpit lives at its own route (`/platform/ai/cockpit` or similar) because it is cross-portfolio by construction; the maturity view lives at `/portfolio` per the Four-Portfolio §12.4 layer-on-existing-nav invariant. Both consume the same theme tokens, drill paths, and §12.5 audit-lens test helpers.

*Rationale.* The Cockpit cannot live under `/portfolio` because it spans all four portfolios — it would violate the per-portfolio scope of that route. The maturity surface cannot move to the Cockpit because Four-Portfolio §12.4 forbids inventing new top-level nav for the maturity view. Resolution: two routes, one component library. Drill paths cross-link: a maturity row's "show me what's actually happening" button opens the Cockpit filtered to that capability's gear-train segment; a Cockpit triple's "show me management context" button opens the maturity row in `/portfolio`.

*Implementation hook.* The §12.5 audit-lens assertions from PR #1004 become test helpers exported from `packages/maturity-ui` and consumed by both Cockpit and `/portfolio` test suites. AGT-906 (UX auditor coworker) is the gating reviewer for both surfaces.

### 4.7 Append-only mutation log

**Binding decision:** `MaturityScoreEvent` (per Four-Portfolio §8.1.A) and graduation events (per Reduction Gear §3.4 / §6.4) emit to **one append-only event substrate** with a discriminator field. They are two `eventKind` values, not two tables. The substrate enforces immutability for both kinds and supports compensating events as the only correction path.

*Rationale.* Both are: immutable, evidence-linked, governance-relevant, queried by operator UIs. Two tables would re-fragment the audit trail the gear spec is trying to consolidate. One table with a discriminator preserves both specs' invariants (Four-Portfolio AC #19 + #20, Reduction Gear §3.4 idempotency) under a single writer.

*Implementation hook.* Schema: one Prisma model `PlatformMutationEvent` with `eventKind ∈ {maturity-score, graduation, veto, autonomy-change, ...}` and discriminator-specific payload. Both writer modules (`packages/maturity` and the Calibrator) import the same event writer. Migrations that introduce a second event table for either purpose are rejected.

## 5. Downstream composing decisions

These follow from §4 once it is ratified. They are recorded here for visibility but do not introduce additional binding contracts beyond what §4 already implies.

### 5.1 Productize gate composes Hive federation gate

`productizationStatus = candidate` (Four-Portfolio §10.4) requires, in addition to its existing criteria, a minimum graduated-triple count from the Calibrator: the capability has graduated at least N triples to `auto-confirm` across at least one archetype. `CalibratedCapabilityPack` (Reduction Gear §7.1) cannot ship for a capability whose `productizationStatus` is `not_eligible`. The two gates are layered: productize gates "may we offer this for sale?"; CalibratedCapabilityPack additionally gates "may we ship calibrated trust about this to peer installs?". A capability that has graduated triples internally but is not productized may still ship code via the existing `FeaturePack` path; the trust payload is what requires productization.

### 5.2 Boundary adapters are bridged-mode external coordination

Reduction Gear §8.2 (bridged mode adapters: EDI, OAGIS, FHIR, etc.) and Four-Portfolio §11 (`strategicOwnership = boundary_adapter`) name the same artifact. A bridged adapter is a `boundary_adapter` capability under the `tool_gateway` parent category, with the §11 qualifying criteria (customer-owned counterparty, open/multi-vendor protocol, DPF retains source-of-truth, swap-out testable, attributable evidence) as its gate. Adapters that fail those criteria are downgraded to `avoid`, not embedded as `boundary_adapter` by default.

### 5.3 BI-CTRL-2B7F31 reconciliation

The "unified control plane" backlog item (BI-CTRL-2B7F31, surfaced in Reduction Gear §9.7) is also functionally what Four-Portfolio §12 describes for `/portfolio`. Three things converging on the same epic risk three parallel implementations. The item should be retitled to make the composition explicit ("Unified Control Plane = Cockpit + Maturity Surface + sharing `packages/maturity-ui`") and the two parent specs both cite it as the integration point. If the item is currently scoped only to Cockpit, it should expand; the maturity surface PRs #1001/#1004 already published its component layer needs.

## 6. Impacted endpoints — coordination inventory

The following endpoints MUST be coordinated when any §4 binding decision is implemented. This list is the contract for the next planning pass.

### 6.1 Specs

- [Four-Portfolio Agent Control Plane Maturity Design](2026-05-21-four-portfolio-agent-control-plane-maturity-design.md) — must reference this spec in its frontmatter and §8 (capability vocabulary), §10 (archetype scope), §5.3 (evidence staleness), §8.1 (reviewer cadence), §10.4 (productize gate), §12 (operator surface)
- [Reduction Gear Architecture Design](2026-05-24-reduction-gear-architecture-design.md) — must reference this spec in its frontmatter and §3.3 (capability vocabulary), §4.2 (archetype profile carrier), §5 (operator surface), §6 (governance), §7 (hive composition), §8 (external coordination)
- [WWMD Decision-Perspective Kernel Design](2026-05-17-wwmd-decision-perspective-kernel-design.md) — governs both cadences per §4.5; no edit required unless reviewer persona templates expand
- [Runtime Kernel Commandments](2026-05-24-runtime-kernel-commandments.md) — composes with the Autonomy Governor per the gear spec; commandment additions for §4.3 autonomy-floor rule may follow
- [UX Auditor Coworker (AGT-906) Design](2026-05-16-ux-auditor-coworker-design.md) — must gate both surfaces (§4.6); audit-lens assertions live in `packages/maturity-ui` per §5.3

### 6.2 Schema (Prisma)

- `CapabilityMaturityAssessment` (Four-Portfolio §8) — adds dependency on canonical capability key from `packages/capability-taxonomy`; loses any local enum for `capabilityCategory`
- `GearInterface` (Reduction Gear §3.1) — adds dependency on canonical capability key from `packages/capability-taxonomy`; `capabilityName` becomes a typed foreign key, not free text
- `ArchetypeCapabilityProfile` (proposed in Reduction Gear §4.2) — becomes the **single** archetype-scoped runtime state table per §4.2
- `MaturityScoreEvent` (Four-Portfolio §8.1.A) — folded into `PlatformMutationEvent` per §4.7
- Graduation events (Reduction Gear §3.4 / §6.4) — folded into `PlatformMutationEvent` per §4.7
- `StorefrontArchetype` — read by both writer modules; not mutated by either; the existing JSON fields (`activationProfile`, `customVocabulary`, `marketingSkillRules`) remain bootstrap, per the seed-is-bootstrap principle and Reduction Gear §1.2.1
- `FeaturePack` / `CalibratedCapabilityPack` — `CalibratedCapabilityPack` creation gated by `productizationStatus` per §5.1

### 6.3 Modules

- `packages/capability-taxonomy` — **new**, owned by neither parent, exports the canonical capability hierarchy (parent categories from Four-Portfolio §8; leaf names from Reduction Gear's normalization pass)
- `packages/maturity` (proposed in Four-Portfolio §17 #6) — single writer for `CapabilityMaturityAssessment`; reads `ArchetypeCapabilityProfile`, the Calibrator graduation log, and `GearInterface` evidence stream
- `packages/maturity-ui` — **new**, shared component library for `/portfolio` and Cockpit
- Calibrator service (Reduction Gear §6.1) — single writer for `ArchetypeCapabilityProfile`; emits to `PlatformMutationEvent`
- Autonomy Governor (Reduction Gear §6.2) — consumes the Calibrator; also serves as the per-execution arm of the WWMD reviewer of record per §4.5
- `PlatformMutationEvent` writer — single writer for §4.7 substrate; mutation logic for either eventKind goes through it

### 6.4 Routes / UI

- `/portfolio` (Four-Portfolio §12) — consumes `packages/maturity-ui`; renders maturity overlay per §12.0–§12.5
- `/platform/ai/cockpit` (Reduction Gear §5; proposed route) — consumes `packages/maturity-ui`; renders gear train + drill paths
- Cross-links between the two surfaces are first-class affordances, not afterthoughts

### 6.5 Coworkers / governance

- WWMD reviewer of record (Four-Portfolio §8.1 + Reduction Gear §6.2) — one persona, two cadences
- AGT-906 UX auditor (referenced by both surfaces via §12.5 / §4.6) — gating reviewer for both `/portfolio` and Cockpit

### 6.6 Backlog items / epics

- `BI-CTRL-2B7F31` (unified control plane) — retitle per §5.3
- `EP-WWMD-MCP` — Autonomy Governor implementation
- `EP-BUILD-9DB5B0` — Calibrator's first consumer, also the natural anchor for the Phase 0 Ring 1→2 pilot
- `EP-ASSURANCE-LEDGER` — `PlatformMutationEvent` substrate
- `EP-COST-001` — cost-as-torque integration on `GearInterface`
- New umbrella `EP-PORTFOLIO-GEAR-CONVERGENCE` (governance epic) — owns this spec; does NOT own implementation work, only the §4 binding decisions and their ratification trail

### 6.7 Hive / external coordination

- `contribute_to_hive` — gates `CalibratedCapabilityPack` creation per §5.1
- `hive-scout-ingest` — Bayesian prior merge per Reduction Gear §7.2; no convergence amendment required
- Bridged adapters (Reduction Gear §8.2) — classified per §5.2 boundary_adapter criteria before any adapter ships

## 7. Phased convergence sequencing

Convergence does not block either parent's Phase 0 if the §4 decisions are ratified before code lands. The sequencing below is what implementation should follow.

### 7.1 Pre-Phase-0 (now, before any code)

- Operator ratifies this spec (or amends §4 and re-ratifies)
- Both parents add this spec to their frontmatter and reference §4 at the relevant sections
- `EP-PORTFOLIO-GEAR-CONVERGENCE` filed as governance-only epic
- `packages/capability-taxonomy` skeleton created (no enum content yet; just the module shape)

### 7.2 Phase 0 — Foundation (both parents in parallel)

- `packages/capability-taxonomy` lands with the Four-Portfolio eight parent categories + the Reduction Gear normalization pass produces the leaf vocabulary; both surfaces import
- `PlatformMutationEvent` schema + writer lands per §4.7
- `packages/maturity-ui` skeleton (just the audit-lens assertion helpers ported from PR #1004's §12.5)
- Reduction Gear's Ring 1→2 pilot (gear §9.1) lands; capabilities on Build Studio's path become first evidenced-tier maturity rows
- Four-Portfolio's slice 1 (per its merged plan + Task 8) lands; reads from `packages/capability-taxonomy` and consults `GearInterface` for `evidenceFreshness`

### 7.3 Phase 1 — Calibration ↔ Maturity link

- Calibrator service lands (gear §9.2); maturity quarterly review begins consuming the graduation log per §4.5
- `ArchetypeCapabilityProfile` lands as the single archetype-scoped table per §4.2; Four-Portfolio's customer-overlay rows derive from it
- The §4.3 autonomy-floor cap on `effectiveMaturity` lands in `packages/maturity`

### 7.4 Phase 2 — Cockpit + `/portfolio` sister surfaces

- Cockpit MVP and `/portfolio` maturity overlay both consume `packages/maturity-ui`
- Cross-links between the two routes ship together
- AGT-906 gates both surfaces

### 7.5 Phase 3 — Productize ⊃ Hive federation

- `productizationStatus = candidate` requires graduated-triple count per §5.1
- `CalibratedCapabilityPack` creation gates on `productizationStatus`
- Hive federation ships with the composed gate, not before

### 7.6 Phase 4 — Bridged external coordination = boundary adapters

- Each bridged adapter (EDI 850/810 first per gear §9.5) classified per §5.2 / Four-Portfolio §11 before shipping
- `strategicOwnership = boundary_adapter` becomes the contract surface for these adapters

## 8. Acceptance criteria

### 8.1 Functional (the convergence is real for operators)

1. An operator navigating from `/portfolio` to a capability row can cross-link to its Cockpit gear-train segment in one click; the reverse path also exists.
2. The quarterly maturity review for any capability shows graduation-log evidence from the Calibrator as the primary source.
3. A capability scored at `maturityScore ≥ 4` with no graduated triples renders at `effectiveMaturity = 3` with a "no graduated triples" annotation.
4. `productizationStatus = candidate` cannot be set on a capability without minimum graduated-triple coverage from the Calibrator.
5. Bridged-mode adapters appear in `/portfolio` under their `tool_gateway` parent with `strategicOwnership = boundary_adapter` and the §11 qualifying-criteria checklist.

### 8.2 Architectural (invariants the implementation must preserve)

6. **One capability vocabulary** — `packages/capability-taxonomy` is imported by every surface touching capability identity; no parallel enum exists in either parent's schema.
7. **One archetype-scoped runtime carrier** — `ArchetypeCapabilityProfile` is the single live store; `customer_overlay` maturity rows are derived, not authored.
8. **One mutation event substrate** — `PlatformMutationEvent` carries both maturity score changes and graduation events under one writer.
9. **One evidence-staleness signal** — `evidenceFreshness` on the maturity record is computed from `GearInterface` query; other evidence sources are secondary.
10. **One WWMD reviewer persona** — the quarterly review and the Autonomy Governor are the same WWMD-arbitrated coworker at two cadences.
11. **One UI component library** — `packages/maturity-ui` is the shared layer between `/portfolio` and Cockpit; neither surface owns a private copy.
12. **No third "unified control plane" candidate** — BI-CTRL-2B7F31 retitled and scoped per §5.3; no new epic claims that title.

## 9. Open questions / deferred to ratification

These are decisions where the convergence spec deliberately stops short of binding, because operator input is required:

1. **Naming of `packages/capability-taxonomy`** — could be `capability-vocabulary` or `capability-ontology`. Defer to first PR.
2. **Granularity of the §4.3 autonomy-floor formula** — "median of constituent triples" is one choice; alternatives include "minimum tier with sample size ≥ N" or "weighted by archetype coverage". Pick at Phase 1 plan time with calibration data in view.
3. **Cockpit route slug** — `/platform/ai/cockpit`, `/platform/cockpit`, or `/cockpit`. Decide with the operator and AGT-906 in the loop.
4. **`PlatformMutationEvent` discriminator naming** — `eventKind` values for graduation vs maturity score change vs veto vs autonomy-change. Catalog at §4.7 implementation time.
5. **Cross-archetype trust transfer** — Reduction Gear §7.3 / §11 already defers this; the convergence spec inherits the deferral.
6. **Productize-eligible graduated-triple minimum (N) in §5.1** — picking N requires calibration data we do not yet have. Phase 3 plan time, with operator on the call.
7. **Migration path for any existing `BacklogItemActivity` / `WorkCapsuleActivity` / `BuildActivity` reads** — Reduction Gear §9.6 already defers; the convergence spec inherits.

## 10. What this spec is NOT

- Not a substrate redesign — both parents stand on their own merits; this spec binds where they touch.
- Not a phasing override — both parents' phase plans remain authoritative for their own phases.
- Not a re-scoping — neither parent loses or gains scope; capability-fabric ownership is named, not moved.
- Not a UI design — `packages/maturity-ui` is named here but its component contracts are specified in PR #1004 and the gear spec §5.4.
- Not a migration plan — Phase 5 of the gear spec retains ownership of legacy event-table sunset; the convergence spec only requires that no new fragmentation is introduced.

## 11. Ratification trail

This spec is ratified when both parent specs reference it in their frontmatter, `EP-PORTFOLIO-GEAR-CONVERGENCE` is filed, and the operator approves the §4 binding decisions in writing (PR review comment is sufficient). Any §4 amendment after ratification requires re-approval. The ratification trail is itself an entry in `PlatformMutationEvent` once that substrate exists; until then, the trail lives in the governance epic's activity log.
