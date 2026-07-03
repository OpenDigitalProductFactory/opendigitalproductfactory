# Generalized Governance-Controls Framework — Design

- **Status:** implemented (Phases 1–5). Phase 1 landed in #2562/#2570; Phases 2–5 land together in the follow-up PR. Phase 5 decision taken: **write-with-approval** (see §4 Phase 5 / §6).
- **Date:** 2026-07-03
- **Area:** compliance / GRC (customer-facing), compliance AI coworker, onboarding
- **Supersedes framing of:** `2026-07-03-uk-corporate-governance-provision-29-design.md` (Provision 29 becomes the first *instance* of this general framework, not a special-case)

## 1. Problem & intent

Provision 29 was added with a bespoke `classifyUkCorpGov` code branch (alongside `classifyCada`) and a hardcoded applicability const. That does not scale. The controls framework and process must apply to **any** governance requirement, added as **data**, not code. Founder directive (2026-07-03):

1. The whole controls framework/process applies to any governance requirement.
2. **Consolidate controls** when an org is subject to many frameworks (one control satisfies obligations across many regulations).
3. Each framework may demand **different forms of output**; the required deliverable may differ per obligation.
4. The specific controls **may not be known at seed time** — controls are authored/discovered at runtime.
5. This is an **ongoing area**: add new regulations and iterate existing ones over time.
6. **The compliance AI coworker is ultimately responsible** for authoring, mapping/consolidating, producing outputs, and keeping current.

## 2. Substrate audit — what already exists (verify-before-proposing-new)

Most primitives exist; the gaps are additive.

| Capability | Exists today | Gap |
|---|---|---|
| Generic applicability evaluator | `regulationApplies(spec, profile)` + data-shaped `RegulationApplicability` type (`packages/db/src/regulation-applicability.ts`) | Specs are hardcoded consts; dispatch is `regulationId`-keyed branches in `compliance-library.ts` (`classifyCada`, `classifyUkCorpGov`). No spec stored on the model. |
| Runtime CRUD | Full server-actions `createRegulation`/`createObligation`/`createControl`/`linkControlToObligation` (`apps/web/lib/actions/compliance.ts`), gated by `manage_compliance`; onboarding wizard | `createRegulation` captures no applicability spec. |
| Control consolidation | `Control` is global (no `regulationId`); `ControlObligationLink` M:N can span regulations (cooperative seed proves it); title-based dedup across packs | No stable control-catalog identity (dedup is fragile exact-title match); no control-centric coverage view. |
| Output forms | `RegulatorySubmission` (+`submissionType` enum), `ComplianceEvidence.evidenceType`, `RequirementCompletion` (attestations), `ComplianceSnapshot` | Nothing declares *what form* of output an obligation requires; Provision 29's declaration is prose-only; no obligation→submission link; no document/evidence-pack generator. |
| Lifecycle/versioning | `Regulation.changeDetected/lastKnownVersion/sourceCheckDate`; `RegulatoryMonitorScan`/`RegulatoryAlert`; `ComplianceSnapshot` | No immutable version lineage / supersedes relation; "iterate" = mutate the row. |
| Compliance coworker | `policy-specialist` agent + route-scoped `/compliance` coworker; `prefill_onboarding_wizard` MCP tool stages an `OnboardingDraft` for human commit | Coworker cannot directly write Regulation/Obligation/Control (explicitly instructed to file a backlog item instead). No `create_regulation`/`map_control` MCP tools. |

## 3. Research & Benchmarking

- **NIST OSCAL** (open standard) — the reference model for machine-readable controls: *catalog* (controls) / *profile* (which controls apply = baseline) / *component-definition* (how a control is satisfied) / *assessment*. **Adopted:** the separation of a shared **control catalog** from per-org **applicability (profile)** and from **evidence (assessment)**. **Rejected:** full OSCAL JSON schema — too heavy for a layman-facing product; we use the existing `Regulation→Obligation→Control→Evidence` chain as the lightweight equivalent.
- **secretlint/ComplyScribe / OpenControl `comply`** (open source) — control-narrative-as-data mapped to many framework families via a crosswalk. **Adopted:** the crosswalk idea — one control maps to many framework obligations. **Anti-pattern rejected:** per-framework control duplication.
- **Vanta / Drata / OneTrust** (commercial) — a single "Test/Control" satisfies many frameworks (SOC2 + ISO + GDPR) via a mapping matrix, and each framework has typed **deliverables** (report, attestation letter, evidence export). **Adopted:** control-centric coverage matrix + typed deliverables. **Gap this design fills:** the platform has the M:N link but no coverage matrix or typed deliverable.
- **Anti-pattern identified & already avoided in our code:** hanging governance requirements off the *industry archetype* — Provision 29 proved these are orthogonal (any archetype can be premium-listed), which is why `listingStatus` is a separate dimension.

## 4. Design — five phases

### Phase 1 — Data-driven applicability (implemented with this spec; low-risk)
- Add `Regulation.applicability Json?` storing a serialized `RegulationApplicability`.
- Replace the `regulationId`-keyed branches in `classifyRegulationForInstall` with: read `regulation.applicability` → generic `regulationApplies` → **one** generic tri-state narrative builder that generalizes the `applies / review (undeclared signal) / reference (known out-of-scope)` logic currently duplicated in `classifyCada`/`classifyUkCorpGov`.
- Backfill the two special-cased regulations (`REG-CADA-2026`, `REG-UK-CORP-GOV-CODE`) with a persisted `applicability` spec in their seeds; keep the legacy `industry`-string matcher as the fallback for rows without a spec (so the banking/public-sector packs are untouched this phase).
- `createRegulation`/`updateRegulation` (+`RegulationInput`) accept the applicability spec so a framework can be authored as **data, not code**. (The onboarding-wizard *form* that collects the spec from a human is Phase 2; the server-action + data path is complete now.)
- Net: `classifyCada`, `classifyUkCorpGov`, and the `classifyByApplicability`-superseded branches are deleted; the two canonical consts (`CADA_APPLICABILITY`, `UK_CORP_GOV_CODE_APPLICABILITY`) remain as seed inputs only. Behavior preserved (existing tests stay green + new data-driven tests); the classifier reason text is now generic (a minor, acceptable wording change).

### Phase 2 — Control catalog + consolidation view
- Introduce stable control identity (a `catalogKey` on `Control`, or a lightweight `ControlCatalog`/`ControlFramework` entity) so dedup is by identity, not exact title.
- Add a **control-centric coverage view**: "this one control covers N obligations across M regulations" (the inverse of today's per-regulation gap page). Fold in the "consolidate when subject to many" requirement.

### Phase 3 — Typed output/deliverable forms
- Add a `deliverableType` (typed enum: `board-declaration | regulatory-filing | attestation | evidence-pack | policy-acknowledgement | …`) to `Obligation` (and/or a first-class `Deliverable`/`OutputTemplate`), plus an `Obligation`↔`RegulatorySubmission` link.
- Lets the platform + coworker know *what artifact* each obligation requires and drive its production/tracking.

### Phase 4 — Regulation version lineage
- Add immutable version lineage (a `RegulationVersion` history / `supersedes` relation) so "iterate an existing regulation" is a governed new version, not a silent row mutation; wire `RegulatoryMonitorScan`/`RegulatoryAlert` to propose a version bump.

### Phase 5 — Compliance coworker authoring authority (DECIDED: write-with-approval)
- **Decision (2026-07-03): option (b) write-with-approval.** The coworker PROPOSES a GRC change into a `ComplianceProposal` staging row (a `control-mapping` crosswalk, a new regulation, an obligation) — proposing needs only *view* capability; a human APPROVES (needs *manage* capability), and approval commits via the existing create/link primitives. Implemented as `proposeComplianceChange` / `approveComplianceProposal` / `rejectComplianceProposal` (`apps/web/lib/actions/compliance-proposals.ts`) over the `ComplianceProposal` model, with a dependency-free validation core (`apps/web/lib/compliance-proposal.ts`). `control-mapping` commits end-to-end (creates a `ControlObligationLink`); `regulation`/`obligation` proposals stage for authoring and route their commit through the existing create form / onboarding wizard. This keeps authoritative writes human-in-the-loop (the platform's standing posture) while giving the coworker real, accountable authoring reach. Escalation to option (c) — autonomous within a `RegulatoryAutonomyPolicy` ceiling — remains a later, separately-governed step.

## 5. The two earlier follow-ups, folded in
- *Autonomy-ceiling wiring for the board declaration* → generalized in Phase 5 (obligations/controls can require human sign-off via `RegulatoryAutonomyPolicy`).
- *Dedicated Provision 29 checklist surface* → generalized in Phase 2 (control-centric coverage) + Phase 3 (typed deliverable tracking).

## 6. Open decisions for sign-off
1. **Phasing/sequence** — Phase 1 now; confirm order of 2–5.
2. **Coworker write authority (Phase 5)** — staging-only / write-with-approval / autonomous-within-ceiling. This is the one genuine governance call.
3. **Control catalog shape (Phase 2)** — lightweight `catalogKey` string vs a first-class `ControlCatalog` entity.

## 7. Verification posture
Each phase ships as its own reviewable PR with source-local gates (typecheck + unit tests) and DB-dependent gates (migration apply + seed) validated on an ephemeral/leased Postgres, per AGENTS.md §5. Phase 1's applicability refactor is fully unit-testable and behavior-preserving.
