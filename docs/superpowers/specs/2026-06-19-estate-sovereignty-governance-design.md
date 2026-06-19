# Estate-Wide Sovereignty Governance — Design

| Field | Value |
| --- | --- |
| Status | Draft — scoping spec |
| Date | 2026-06-19 |
| Owner | Enterprise Architect |
| Backlog state | `EP-ESTATE-SOVEREIGNTY` (to be filed) |
| References | [CADA strategy briefing](../strategy/2026-09-cada-cloud-sovereignty-architects-forum.md), [CADA architecture note](../architecture/2026-06-19-cada-cloud-sovereignty-architecture-note.md), [`data-sovereignty-follows-control`](../founder-kernel/wiki/principles/data-sovereignty-follows-control.md) |
| Related epics | `EP-ASSURANCE-LEDGER` (finding/evidence substrate), `EP-PROACTIVE-OPS` (digital products as lifecycle assets), `EP-ARCH-GRAPH-LIVE` (estate graph), `EP-DATA-RETENTION` |

## 1. Problem

The EU Cloud and AI Development Act (CADA) makes cloud/data sovereignty a binding, tiered obligation. For a large customer, the obligation is **not** limited to the DPF platform itself — it spans the whole estate: discovered infrastructure, edge nodes, and the many external digital products (SaaS, third-party applications) the organisation relies on outside DPF. CADA's compliance cascade pulls all of these into scope when the organisation is an EU public body, a NIS2 essential entity, a DORA-regulated firm, or a supplier to any of them.

DPF already has a governance area (regulations, obligations, controls, evidence, audit) and an estate model (customer sites, edge nodes, inventory entities, integration coverage). What it lacks is the connective tissue: a way to **assess** each estate element against a sovereignty tier, **plan** the remediation work, and **manage** it through the existing backlog — and the per-element metadata (who operates it, under whose law, where it runs) that a sovereignty judgement requires.

This spec scopes that opportunity. It is a scoping/design document; the build is phased and tracked in `EP-ESTATE-SOVEREIGNTY`.

## 2. Goals

1. Let an operator (and DPF coworkers) **assess** any estate element — DPF itself, a discovered host/edge node, or an external digital product — against the CADA four-tier framework (and the CSF/SEAL rubric).
2. **Plan** remediation: surface gaps as backlog items in the existing governed backlog, linked to the relevant obligations/controls.
3. **Manage** posture over time: a per-install sovereignty posture that rolls up element-level assessments to a target assurance level.
4. Reuse the existing finding/evidence, scoring, and estate substrate; add new substrate only where genuinely missing.
5. Keep the platform's own operation assessable too (the regulation applies to DPF itself, not only the customer's other systems).

## 3. Non-Goals

- Becoming a cloud provider or a certification body. DPF assesses and advises; it is not a CADA conformity-assessment authority.
- Auto-discovering cloud/SaaS estate beyond the LAN in Phase 1 (current discovery is on-prem/network-only; cloud discovery is a later phase).
- Replacing the compliance feature's regulation/obligation/control model — this extends it, it does not fork it.
- Claiming any "CADA-certified" status. CADA is a proposal; the platform produces evidence and tier mappings, not certifications.

## 4. Current-state substrate (verified)

**Reusable as-is:**
- Governance domain: `Regulation` / `Obligation` / `Control` / `ControlObligationLink` / `ComplianceEvidence` / `ComplianceAudit` (`apps/web/lib/actions/compliance.ts`, schema lines ~6388-6850). CADA is registered here via `seed-cada-regulation.ts`.
- Finding lifecycle: `AssuranceFinding` + `AssuranceRun` — **polymorphic** `affectedType`/`affectedId` (indexed), adapter-driven. The strongest attachment point for per-element findings. (`EP-ASSURANCE-LEDGER`.)
- Lightweight per-element flags: `PortfolioQualityIssue` — the only recorder with a native `inventoryEntityId` FK; already surfaces in estate posture badges.
- Scoring shape: `CapabilityMaturityAssessment` (`maturityScore`, `riskTier`, `confidenceGrade`, `maturityGaps`) — the right shape for a CADA L1–L4 / SEAL 0–4 score.
- Estate spine: `CustomerAccount → CustomerSite → {EdgeNode, InventoryEntity, CustomerConfigurationItem}`; site-level location via `Address` (lat/long → `Country`).
- External-application enumeration: `IntegrationCoverageProvider` (per-org, `posture`, `replacementIntent`) — names which external products an org relies on.
- Org jurisdiction: `BusinessContext.{operatesIn, sellsTo, employsIn, dataResidency, handlesCardPayments}`.
- Posture rollup: `summarize_estate_posture` (categorical badges per `InventoryEntity`).
- Countries: `Country` (ISO 3166, all 27 EU states seeded) + new `packages/db/src/eu-jurisdictions.ts` bloc grouping.
- Evidence: `RouteDecisionLog`, `ToolExecution`, `ChangeRequest`/`registerChange()`.

**Genuinely new (flagged honestly):**
- Per-element **jurisdiction / operator / hosting-region / data-classification** metadata. Today location lives only at the site level; ownership/operator lives nowhere.
- **External-application sovereignty fields** on `IntegrationCoverageProvider` (vendor ownership jurisdiction, hosting region, data residency, criticality, DPA/cross-border-transfer terms). It enumerates, it does not describe-for-sovereignty.
- **Cloud / SaaS discovery** (current discovery is LAN-only; no public IP / ASN / cloud-region inference).
- The **CSF/SEAL → CADA-level scoring logic** and verification adapters (attestation, SBOM/provenance — `EP-ASSURANCE-LEDGER` flags SBOM as the main Level 2 build-out).
- `BusinessContext.targetAssuranceLevel` and the **sovereignty posture dashboard**.

## 5. Standards & benchmarking

- **CADA** four Union assurance levels (the primary framework — see the corpus page and architecture note).
- **EU Cloud Sovereignty Framework (CSF) + SEAL 0–4** — the Commission's actual procurement rubric (8 SOV objectives); the scoring target.
- **CSA AICM / CCM / STAR for AI** — control matrices that map to the assessment evidence; align finding kinds to them.
- **BSI C5, ANSSI SecNumCloud 3.2** — the operational proxies that exist today (no provider is CADA-certified yet); use as tier evidence.

## 6. Decision

Extend, don't fork. Three reuse decisions and a bounded set of new fields:

1. **Assessment = `AssuranceFinding` with a sovereignty `findingKind` + an `InventoryEntity` FK** (the polymorphic pair already allows it; add a real FK for query ergonomics). One finding substrate, one lifecycle.
2. **Tier score = a `CapabilityMaturityAssessment`-shaped record** scoped to the assessed element, recording the CADA level / SEAL score, confidence grade, and gaps.
3. **External applications = `IntegrationCoverageProvider` + new sovereignty columns** (operator jurisdiction, hosting region, data residency, criticality). This makes the conduit register sovereignty-aware.
4. **Org target = `BusinessContext.targetAssuranceLevel`**, and a posture rollup that extends `summarize_estate_posture` with a sovereignty dimension.

The CSF SOV objectives map onto `Control`s; CADA obligations are the seeded `Obligation`s; per-element findings link to those obligations through the existing `ControlObligationLink` graph.

## 7. Concept mapping

| CADA / sovereignty concept | DPF concept | Substrate |
| --- | --- | --- |
| Assurance level (L1–L4) / SEAL 0–4 | Tier score on an estate element | `CapabilityMaturityAssessment`-shaped record `[new scope]` |
| "Is this element compliant?" finding | Sovereignty finding | `AssuranceFinding` (+ `InventoryEntity` FK) `[reuse + small new]` |
| Obligation (e.g. "EU-owned operator") | `Obligation` under `REG-CADA-2026` | `seed-cada-regulation.ts` `[done]` |
| Control (e.g. local-only inference) | `Control` linked to obligations | compliance domain `[reuse]` |
| External SaaS the org depends on | Integration coverage provider + sovereignty metadata | `IntegrationCoverageProvider` `[reuse + new fields]` |
| Discovered host / edge node | Inventory entity / edge node + per-element jurisdiction | `InventoryEntity` / `EdgeNode` `[reuse + new fields]` |
| "Countries affected" | EU/EEA member-state reference | `eu-jurisdictions.ts` + `Country` `[done]` |
| Target posture | Target assurance level + rollup | `BusinessContext.targetAssuranceLevel` `[new]` |
| Evidence (routing stayed local) | Route-decision / tool-execution log | `RouteDecisionLog` / `ToolExecution` `[reuse]` |

## 8. The three estate layers in scope

1. **The platform itself** — DPF's own operation, assessed against CADA (regulation already seeded; local-only + self-host already satisfy key controls).
2. **Discovered infrastructure & edge nodes** — `InventoryEntity` / `CustomerConfigurationItem` / `EdgeNode`, assessed once per-element jurisdiction/operator metadata exists.
3. **External digital products** — the many applications a large company relies on outside DPF, enumerated via `IntegrationCoverageProvider`, assessed once sovereignty metadata exists.

"Help" means the full governance loop for each: **assess** (tier score + findings) → **plan** (gaps become backlog items linked to obligations) → **manage** (posture rollup, remediation tracked through the existing backlog and change register).

## 9. Phased delivery plan

- **Phase 0 — Knowledge & registration (this PR).** Founder-kernel principle, CADA corpus page, affected-countries reference + test, the **sovereignty assurance-level scoring primitive** (`packages/db/src/sovereignty-assessment.ts`, implementing CON-CADA-1) + test, CADA regulation seed, this spec, the architecture note. Outcome: CADA is referenceable substrate, registered in the governance area for the platform's own operation, and the reusable tier-scoring brain is in place for Phases 1-3.
- **Phase 1 — Org-level assessment.** *(in progress)* The **CADA-readiness assessment** has landed: `computeInstallCadaReadiness()` (`packages/db/src/cada-readiness.ts`) derives the install's posture from the live local-only inference setting + declared jurisdiction + DPF's structural facts, scored by the primitive; surfaced via the `assessCadaReadiness()` server action and the `check-cada-readiness.ts` operator script (functionally verified against the live install). Still open: `BusinessContext.targetAssuranceLevel` as a **persisted** field (deferred — a schema regen in a junctioned worktree writes into the root clone's Prisma client, which is currently on another session's branch; target is a runtime param until this lands via an isolated client or Build Studio), and signed SBOM generation (Level 2, `EP-ASSURANCE-LEDGER`). Verifies REQ-CADA-3/6.
- **Phase 2 — Per-element infrastructure assessment.** Per-element jurisdiction/operator/region fields on `InventoryEntity`/`EdgeNode`; sovereignty `AssuranceFinding` kind + `InventoryEntity` FK; tier scoring; surfaced in `summarize_estate_posture`.
- **Phase 3 — External-application sovereignty register.** Sovereignty columns on `IntegrationCoverageProvider`; cloud/SaaS discovery beyond the LAN; assess external digital products against the tiers.
- **Phase 4 — Posture dashboard & remediation planning.** A sovereignty posture surface that rolls element scores to the target assurance level; gaps auto-filed as backlog items linked to CADA obligations.

## 10. Backlog

Epic `EP-ESTATE-SOVEREIGNTY` with one backlog item per phase deliverable (filed alongside this spec), linked to `EP-ASSURANCE-LEDGER` (findings/SBOM), `EP-PROACTIVE-OPS` (external digital products), and `EP-ARCH-GRAPH-LIVE` (estate graph).

## 11. New vs. reuse (honest summary)

| Need | Reuse / New |
| --- | --- |
| CADA regulation, obligations, controls | **Reuse** — compliance domain + seed (done) |
| CADA knowledge for coworkers/planning/marketing | **Reuse** — corpus page + principle + countries ref (done) |
| Per-element finding lifecycle | **Reuse** — `AssuranceFinding` (+ small FK) |
| Tier scoring (L1–L4 / SEAL 0–4) | **Primitive landed + reuse shape** — `sovereignty-assessment.ts` computes the level/gaps/cap; `CapabilityMaturityAssessment` persists it per element |
| External-app enumeration | **Reuse** — `IntegrationCoverageProvider` |
| External-app sovereignty metadata | **New** — operator jurisdiction / hosting region / residency / criticality columns |
| Per-element jurisdiction/operator | **New** — fields on `InventoryEntity` / `EdgeNode` |
| Cloud/SaaS discovery | **New** — discovery beyond the LAN |
| Target assurance level + posture rollup | **New** — `BusinessContext.targetAssuranceLevel` + dashboard |
| SBOM / attestation (Level 2/4) | **New** — `EP-ASSURANCE-LEDGER` build-out |
