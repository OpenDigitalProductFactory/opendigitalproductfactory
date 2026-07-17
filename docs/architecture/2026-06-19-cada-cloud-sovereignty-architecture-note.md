# CADA & Cloud Sovereignty — SysML Architecture Note

| Field | Value |
| --- | --- |
| Date | 2026-06-19 |
| Status | Draft — current-state catch-up + forward requirements |
| Notation | SysML v2 (`sysml2` EA notation) — viewpoint over the canonical DPF EA graph |
| Package | `PKG-CADA` "CADA & Cloud Sovereignty" |
| Owner | Enterprise Architect |
| Source design | [`2026-09-cada-cloud-sovereignty-architects-forum.md`](../strategy/2026-09-cada-cloud-sovereignty-architects-forum.md), [`2026-06-19-estate-sovereignty-governance-design.md`](../superpowers/specs/2026-06-19-estate-sovereignty-governance-design.md) |
| Substrate spec | [`2026-06-14-sysml-architecture-substrate-design.md`](../superpowers/specs/2026-06-14-sysml-architecture-substrate-design.md) |
| Principle | [`data-sovereignty-follows-control`](../founder-kernel/wiki/principles/data-sovereignty-follows-control.md) |
| Model content (seed) | `packages/db/src/seed-ea-sysml-cada.ts` (BI-AA3A4144) |

This note captures how the EU Cloud and AI Development Act (CADA, proposed 3 June 2026) maps onto DPF's current architecture: which assurance-level obligations the shipped substrate already satisfies, and which are forward requirements. The canonical model is the DPF EA graph (`EaElement`/`EaRelationship`); this markdown is the human-readable companion. EA-graph materialization lives in `packages/db/src/seed-ea-sysml-cada.ts`; the sovereignty-relevant routing behaviour is verified by source-local tests today.

**Legend.** `[D]` = deterministic fact (grounded in code/schema). `[J]` = architect-authored judgment (design intent, not yet realized). Verification status: **green** = automated test passes today; **planned** = future slice.

---

## SysML Architecture Note (skill template)

- **Scope:** How CADA's four Union assurance levels apply to (a) the operation of the DPF platform itself and (b) the governance of compliance work across the customer's wider estate. Adds the CADA model package; introduces no new source-of-truth tables in this change.
- **Changed requirements/constraints:** REQ-CADA-1…8 + CON-CADA-1 (below). REQ-CADA-2/5/7 are green today; the rest are modeled and allocated, realized across later slices.
- **Changed interfaces/ports:** No runtime contract change in this PR. The forward work (target assurance level on `BusinessContext`, estate sovereignty assessment) is specified in the estate-sovereignty design.
- **Allocations:** residency → `local-only`/`pipeline-v2`; deployment → `docker-compose`/deployment-contracts; jurisdiction → `BusinessContext`; affected-countries → `eu-jurisdictions.ts` + `Country`; evidence → `RouteDecisionLog`/`ChangeRequest`/`ToolExecution`; knowledge → CADA corpus page + `seed-cada-regulation`. (Full table below.)
- **Verification cases:** VC-CADA-LOCAL, VC-CADA-COUNTRIES green today; others planned.
- **Data authority impact:** No new source-of-truth tables in this change. CADA is registered in the existing compliance domain (`Regulation`/`Obligation`/`Control`) via a seed; affected-countries reuse the existing `Country` table plus a bloc-membership constant.
- **EA/current-state catch-up:** New `PKG-CADA` model package + this note + `seed-ea-sysml-cada.ts`.
- **Open architecture risks:** (1) The strictest tier (Level 4) "no third-country control over software evolution" is a governance gap for a foreign-domiciled maintainer — mitigated by open source + EU steward + signed SBOM, not yet closed `[J]`. (2) Estate discovery is LAN-only today; per-element jurisdiction/operator metadata and external-application sovereignty fields are new substrate `[J]`. (3) CADA is a proposal; tier criteria may shift in trilogue.

---

## 1. Requirements (`requirement`)

Stable IDs are the planned `infraCiKey`s in the EA seed (`sysml:req:REQ-CADA-N`).

| ID | Requirement | Status |
| --- | --- | --- |
| REQ-CADA-1 | **Level 1 residency.** A platform deployment can keep infrastructure, assets, and customer data in the EU. | green (self-host on EU infra) `[D]` |
| REQ-CADA-2 | **Level 4 no AI-inference-data egress.** AI processing for a sovereign workload stays local and never silently falls back to a foreign cloud. | **green** (`residencyPolicy="local_only"`) `[D]` |
| REQ-CADA-3 | **Level 2 supply-chain transparency.** The platform's software supply chain is auditable, with a signed SBOM. | partial — open source `[D]`; signed SBOM planned `[J]` |
| REQ-CADA-4 | **Level 3/4 ownership & control.** The achievable tier follows the operating entity's ownership; no foreign entity holds effective control over software evolution. | partial — open-source/fork `[D]`; EU steward posture planned `[J]` |
| REQ-CADA-5 | **Assurance evidence.** The platform produces auditable evidence that local-only routing held and which model/provider served each request. | **green** (`RouteDecisionLog`, `ToolExecution`, `ChangeRequest`) `[D]` |
| REQ-CADA-6 | **Jurisdiction capture.** The install captures where it operates/sells/employs and its data-residency, and (forward) a target assurance level. | partial — `operatesIn/sellsTo/employsIn/dataResidency` exist `[D]`; `targetAssuranceLevel` planned `[J]` |
| REQ-CADA-7 | **Countries-affected reference.** The set of CADA-affected countries (27 EU + 3 EEA-EFTA + third-country test) is available for planning, marketing, and assessment. | **green** (`eu-jurisdictions.ts` + corpus + `Country`) `[D]` |
| REQ-CADA-8 | **Estate-wide assessment.** The governance area can assess, plan, and manage CADA compliance across discovered infrastructure, edge nodes, and external digital products. | planned `[J]` (tracked in `EP-ESTATE-SOVEREIGNTY`) |

## 2. Constraint / parametric (`constraint`)

**CON-CADA-1 — Sovereignty assurance constraint.** The achievable assurance level of a deployment is a function of `(operating-entity ownership × infrastructure location × inference locality × software control × key control)` — bounded by the weakest foreign-controlled dependency in the chain (see [[principles/data-sovereignty-follows-control]]). Invariants:

- `infra in EEA` ⇒ Level 1 residency satisfiable. `[D]`
- `residencyPolicy = local_only` ⇒ no AI-inference egress; the Level 4 AI test holds and routing fails loudly rather than reaching a foreign cloud. `[D]`
- `any operating entity controlled from a third country` ⇒ assurance capped at Level 2 for that dependency; Level 3/4 require EU ownership/control. `[J]` (CADA Art. — ownership tiers)
- `software open-source + customer can run/audit/fork` ⇒ the Level 2 supply-chain-transparency and the Level 3/4 vendor-control objections are answerable; Level 4 still needs SBOM + EU steward. `[J]`

This constraint is realized today by the routing pipeline's hard-filter on `residencyPolicy` and by the self-hosted single-tenant deployment model; the ownership/control invariants are governance posture captured in the principle and the strategy briefing.

## 3. Part definitions (`part_definition`) and allocations

Each block is **allocated** (`sysml_allocates`) to the substrate that realizes it.

| Block (ID) | Realizing substrate (allocation) | Satisfies |
| --- | --- | --- |
| `PART-CADA-residency` Local-only inference gate | `apps/web/lib/inference/local-only.ts`, `apps/web/lib/routing/pipeline-v2.ts` (`residencyPolicy` filter) `[D]` | REQ-CADA-2 |
| `PART-CADA-deploy` Self-hosted deployment | `docker-compose.yml`, `docs/superpowers/specs/2026-05-09-deployment-contracts.md` `[D]` | REQ-CADA-1 |
| `PART-CADA-jurisdiction` Jurisdiction model | `BusinessContext.{operatesIn,sellsTo,employsIn,dataResidency}` `[D]`; `targetAssuranceLevel` planned `[J]` | REQ-CADA-6 |
| `PART-CADA-countries` Affected-countries reference | `packages/db/src/eu-jurisdictions.ts` + `Country` table `[D]` | REQ-CADA-7 |
| `PART-CADA-evidence` Assurance evidence | `RouteDecisionLog`, `ToolExecution`, `ChangeRequest`/`registerChange()` `[D]` | REQ-CADA-5 |
| `PART-CADA-openness` Open supply chain | public open-source repo + DCO `[D]`; signed SBOM planned `[J]` | REQ-CADA-3, REQ-CADA-4 |
| `PART-CADA-knowledge` Regulatory knowledge | corpus page `docs/professions/legal-compliance/wiki/eu-cada-cloud-sovereignty.md` + `seed-cada-regulation.ts` `[D]` | REQ-CADA-6, REQ-CADA-8 |
| `PART-CADA-estate` Estate sovereignty assessment | reuse `AssuranceFinding` (polymorphic) + `CapabilityMaturityAssessment` scoring; new per-element jurisdiction + external-app sovereignty metadata `[J]` | REQ-CADA-8 |

## 4. Verification cases (`verification_case`)

| ID | Verifies | Evidence | Status |
| --- | --- | --- | --- |
| VC-CADA-LOCAL | REQ-CADA-2 | `apps/web/lib/routing/pipeline-v2.test.ts`, `fallback.test.ts` (local-only filter, no silent fallback) | **green** |
| VC-CADA-COUNTRIES | REQ-CADA-7 | `packages/db/src/eu-jurisdictions.test.ts` | **green** |
| VC-CADA-EVIDENCE | REQ-CADA-5 | `RouteDecisionLog` rows assert served endpoint/provider per request | **green** `[D]` |
| VC-CADA-SBOM | REQ-CADA-3 | signed SBOM generation + verification | planned |
| VC-CADA-TARGET | REQ-CADA-6 | `BusinessContext.targetAssuranceLevel` capture + enforcement test | planned |
| VC-CADA-ESTATE | REQ-CADA-8 | estate sovereignty assessment adapter + scoring test | planned |

## 5. Traceability summary

```
REQ-CADA-2 ──satisfies── PART-CADA-residency ──verifies── VC-CADA-LOCAL ✓
REQ-CADA-7 ──satisfies── PART-CADA-countries ──verifies── VC-CADA-COUNTRIES ✓
REQ-CADA-5 ──satisfies── PART-CADA-evidence ──verifies── VC-CADA-EVIDENCE ✓
CON-CADA-1 ──refines──── REQ-CADA-1, REQ-CADA-2, REQ-CADA-4
REQ-CADA-8 ──satisfies── PART-CADA-estate (planned) ──tracked── EP-ESTATE-SOVEREIGNTY
PART-CADA-residency ──sysml_traces──▶ principle:data-sovereignty-follows-control
```

## 6. What landed in this change vs. modeled-for-later

**Landed + verified `[D]`:**
- CADA registered as platform knowledge: founder-kernel principle, legal-compliance corpus page (runtime-injected), and the `eu-jurisdictions` affected-countries reference (+ test).
- CADA registered in the governance domain via `seed-cada-regulation.ts` (operator-run, mirrors DORA) — obligations + suggested controls mapped to DPF capabilities.
- The pre-existing local-only inference gate is recognized here as the Level-4 AI-egress control (REQ-CADA-2), already test-covered.
- The CADA SysML model is materialized into the EA graph by `packages/db/src/seed-ea-sysml-cada.ts` with requirements, allocations, verification cases, and traceability relationships.

**Modeled, realized later `[J]`:** REQ-CADA-3 (signed SBOM), REQ-CADA-4 (EU steward posture), REQ-CADA-6 (`targetAssuranceLevel`), and REQ-CADA-8 (estate-wide assessment). These are scoped in [`2026-06-19-estate-sovereignty-governance-design.md`](../superpowers/specs/2026-06-19-estate-sovereignty-governance-design.md) and tracked in `EP-ESTATE-SOVEREIGNTY`.
