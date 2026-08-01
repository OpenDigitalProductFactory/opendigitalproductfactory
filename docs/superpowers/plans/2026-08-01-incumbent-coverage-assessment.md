# Plan — Incumbent coverage assessment (D3, BI-548060D5)

**Backlog item:** BI-548060D5 (D3 — IncumbentCoverageAssessment: verdict model + four-stage matching pipeline)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-01 |
| **Epic** | EP-ASSET-INTELLIGENCE |
| **Design source** | `docs/superpowers/specs/2026-07-23-incumbent-application-coverage-design.md` §5.2 (the one new model), §5.4 (four-stage matching), §5.5 (gap→backlog is D4, not here) |
| **Depends on** | D0 (`BI-5B2F5447`, done — enums), D1 (`BI-ECO-001`, done — the live 108-row AbsorptionPosture matrix + `postureForArchetype`), D2 (`BI-BF12C25C`, P1+P2 done — incumbent `DigitalProduct` rows can exist) |
| **Consumed by** | D6 (`BI-69B957E4`, coverage surface), D4 (`BI-F4EE0E48`, gap→backlog) |

## 1. Why this, why now

The absorption matrix is live (108 postures on the install) but **inert** — nothing reads it. D3 is the consumer that turns a posture *default* into a per-customer, evidenced coverage *verdict* for one incumbent application. It is the connective tissue between the intake (D2) and the coverage surface (D6). All its dependencies now exist, so it is buildable.

## 2. Substrate verification (live, 2026-08-01)

- **No `IncumbentCoverageAssessment` model** — genuine new model.
- **AbsorptionPosture is live and seeded** — 108 rows, all `status=proposed`, 3 tiers. `postureForArchetype` exists; stage 1 matches by **provider**, so a by-provider lookup is added.
- **Verdict + status vocabulary already exists** — reuse `ABSORPTION_VERDICTS` and `ABSORPTION_STATUSES` from `packages/db/src/portfolio-sources/absorption-posture.ts` (the spec makes the vocabulary deliberately identical). `assessedVia` is new.
- **Incumbents are `DigitalProduct` where `coverageStatus='incumbent'`** (D2). Currently 0 on the install — the pipeline is correct over an empty set (produces 0 assessments) until intake runs; the model + logic are unit-tested with mock rows.
- **Governance:** a new persistent model triggers the full battery (data-impact manifest, table-classification, stewardship disposition, DATA_ASSET_REGISTRY entry, substrate-baseline `prismaModelCount` bump). Migration timestamp must exceed `20260801100000`.

## 3. Data model (§5.2)

```
IncumbentCoverageAssessment
  id / assessmentId(unique)
  digitalProductId            // the incumbent (coverageStatus=incumbent)
  catalogIdentityId?          // normalized identity (shared with Phase C)
  verdict                     // == ABSORPTION_VERDICTS (native_now|adapter_bridge|generic_connector|provider_led|do_not_absorb|gap)
  coveringCapabilityKey?      // CAPABILITY_REGISTRY key that covers it
  coveringBusinessCapabilityId?
  confidence                  // 0..1
  assessedVia                 // posture_matrix | rule | ai | human_confirmed
  evidence                    // Json — what matched, on what basis
  backlogItemId?              // set when verdict=gap (populated by D4, not here)
  status                      // proposed | confirmed | superseded
  assessedAt / supersededAt
  @@unique on the CURRENT assessment per (digitalProductId) via a partial index (status != superseded)
```

Closed enums (`verdict`, `assessedVia`, `status`) guarded by predicates + a parity test. `assessedVia=posture_matrix` is a *default*, not a claim (spec R3) — it must be distinguishable from `human_confirmed`.

## 4. Phases

### P1 — Model + deterministic backbone (this plan's shippable slice)
- The model (§3) + additive migration + `assessedVia` enum/predicate (reuse verdict/status enums).
- **Stage 1 (posture_matrix):** `assessIncumbentsViaPostureMatrix(db)` — for each incumbent `DigitalProduct`, match its provider (normalized name / observationConfig.vendor) against `AbsorptionPosture.providerName`. Match → assessment carrying the posture's verdict + `coveringPrimitive` (as `coveringCapabilityKey` when set) + confidence, `assessedVia=posture_matrix`, `status=proposed`, `evidence` naming the matched posture. No match → `verdict=gap`. Idempotent: supersede the prior current assessment for the same incumbent.
- **Stage 4 (human confirmation):** `confirmCoverageAssessment(db, id, verdict?)` — sets `assessedVia=human_confirmed`, `status=confirmed`. No verdict reaches `confirmed` without this (spec §7 non-goal, R3).
- **Accessor:** `coverageForIncumbent` / `listCoverageAssessments` (the typed read D6 consumes).
- **Acceptance:** enum predicates; stage-1 matching (hit → posture verdict; miss → gap; idempotent supersede); confirm transitions provenance; unit-tested with mock prisma; governance battery green; `prisma validate` clean.

### P2 — Stage 2 (rule) — covering capability via the category corpus — **SHIPPED**
Deterministic covering-capability resolution using the taxonomy the portfolio already carries. `assessIncumbentsViaRule` derives an incumbent's archetype category (posture `archetypeIds` → `StorefrontArchetype.category`) and resolves the covering **business** capability via the existing `CATEGORY_BUSINESS_CAPABILITY_PERSPECTIVES` corpus (`coveringBusinessCapabilityForCategory`) — no authored crosswalk. Enriches `coveringBusinessCapabilityId`; idempotent; never clobbers a human-confirmed row.
**Scope note:** a rule stage that produces a VERDICT for gap incumbents the posture matrix never named needs a crosswalk between the incumbent identity vocabulary (`CatalogIdentity` CPE `category`) and the archetype/capability vocabulary — that crosswalk does not exist and is a separate authoring effort. This stage resolves what the existing substrate deterministically supports.

### P3 — Stage 3 (AI) — inference-backed proposal — **SHIPPED**
`assessGapsViaAi` (apps/web, needs the inference chain) asks an injected proposer to classify gap incumbents; writes `assessedVia=ai`, always `status=proposed`, never auto-confirmed (spec §7). The LLM call is behind `routedInferenceProposer` (thin adapter over `routeAndCall`); `parseAiVerdict` validates against the closed verdict enum. Proposer errors are isolated. Correct over an empty set.

## 5. Verification
- Unit: enum predicates; stage-1 matching + gap + idempotent supersede; confirm; the accessor — all with mock prisma (source-only worktree).
- Migration: additive new table, no constraint tightened on existing rows — data-safe by construction.
- Governance: full new-model battery.
- No verdict reaches `confirmed` without the confirm path (governance).

## 6. Risks
| # | Risk | Mitigation |
|---|---|---|
| R1 | A `posture_matrix` default overstates coverage (spec R3) — most damaging in a sales surface. | `assessedVia` makes provenance explicit and un-collapsible; defaults are `proposed`; only `confirmCoverageAssessment` reaches `confirmed`. D6 must render a default distinctly. |
| R2 | Re-assessment duplicates rows. | One current assessment per incumbent; re-run supersedes (status=superseded) rather than inserting a rival. |
| R3 | Building ahead of data (0 incumbents live). | Pipeline is correct over an empty set; logic is unit-tested with mocks; real output appears once D2's UI/onboarding lands intake. No dependency inversion. |

## Backlog coverage
- Decision: decomposed
- Parent: BI-548060D5
- Receipt: cmsam5b400baf01qkne5z04y3
- Dependencies: P2 depends on P1; P3 depends on P1

Deliverable -> BacklogItem (all deliver the one umbrella BI-548060D5; phases are sequential slices of the four-stage pipeline, not separate backlog items):

- P1 model + posture_matrix stage + confirm + accessor -> BI-548060D5
- P2 rule stage (taxonomy) -> BI-548060D5
- P3 AI stage -> BI-548060D5
