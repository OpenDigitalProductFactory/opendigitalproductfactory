# Centralized compliance with contextual functional variants

**BI:** BI-0B867B67 · **Epic follow-up to:** BI-242F344C (horizontal software pack), BI-9DED0CE8 (archetype scoping)
**Kernel decision:** `principle_decide` chose `explicit-domain-tag` (high confidence, composite 14.6 vs 8.75 vs 7.05, no commandment conflict) over derive-from-trigger and owner/department attribution.

## Problem

The applicability engine (#2766/#3831) gives every install one central registry of what it must comply with, scoped by what the business does and where it operates. Two gaps remain: (1) the data-handling triggers have no operator-facing capture (they were DB-set to prove the mechanism); (2) there is no **functional attribution** — no way for each functional context (HR, finance, security…) to own its contextual compliance while everything rolls up to one central posture. `Obligation.category` holds workflow-type, not domain; the `employing` applicability basis is wired but unused; the seeded `compliance-officer` coworker is orphaned (bound to no route).

## Approach

Add a functional dimension on top of the (unchanged) applicability engine. `domain` is **attribution/reporting only** — it never enters `RegulationApplicability` and never affects `regulationApplies`.

- **`REGULATION_DOMAINS`** closed enum (`privacy-security`, `hr-employment`, `finance`, `ai-governance`, `consumer-marketing`, `accessibility`, `corporate-governance`, `sector`, `cross-cutting`) + `isRegulationDomain` guard in `regulation-applicability.ts`. `Regulation.domain` column; obligations inherit their regulation's domain (no second column). Additive migration + IS-NULL-guarded backfill (reuses the `20260710150000` regulationId lists); all seed packs carry `domain`.
- **By-function rollup**: `DomainScore` + pure `calculateDomainScores` in `reporting-types.ts`; `getCompliancePosture` returns `domainScores`; a "By Function" section on `/compliance/posture`. Also fixes a scoping bug where posture stat-cards counted org-wide while the by-regulation table was applicability-scoped.
- **Operator capture** (phase 2): finish the data-handling capture in `BusinessContextForm` + `/api/business-context/setup` + the business-settings page — the engine already reads `BusinessContext.dataHandling`, this writes it.
- **HR variant + coworker** (phase 3 — SHIPPED): a cited employment-law pack (`seed-hr-employment-compliance.ts`, 8 US statutes: FLSA, FMLA, Title VII/EEO, ADA Title I, ADEA, I-9/IRCA, OSHA, and a configurable state-employment row) gated on the `employing` basis, `domain: hr-employment` — the first regulations to use the previously-unused employing lane; the orphaned `compliance-officer` coworker is bound to `/compliance` (`ROUTE_AGENT_MAP`) with a `record_compliance_scope` MCP tool (`compliance-scope-pack` + `capture-compliance-scope`, `data_governance_validate` grant) so it captures the data-handling / employsIn profile conversationally, writing the same `BusinessContext` columns the setup form writes (union-merge). Adding another functional domain (finance, legal) is now just another pack with a `domain` tag — no new plumbing.

## Phasing

Three independently-shippable PRs: (1) central domain model + by-function reporting; (2) operator capture; (3) HR pack + coworker + capture tool.

## Verification

Unit: domain guard + all-pack domain integrity + backfill lockstep; `calculateDomainScores`; HR pack integrity; capture-tool grant/coercion. Live: run migrations+seed, confirm `/compliance/posture` By-Function renders and stat cards match the by-regulation totals; capture a data-handling profile through the form and the coworker; confirm HR regs flip review→applies once `employsIn` is declared. Each phase: DCO PR, babysit to green, redeploy live and verify (as done for #2766/#3831).

## Out of scope (follow-ups)

Controls + control-obligation links for the horizontal/HR regs (coverage stays honestly 0% until implemented); per-state privacy-threshold refinement; a `secondaryDomains` array if genuine multi-domain reporting is later required (single primary domain for now).
