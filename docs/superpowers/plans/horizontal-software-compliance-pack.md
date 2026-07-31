# Horizontal software compliance pack + data-handling applicability predicates

**BI:** BI-242F344C · **Epic follow-up to:** BI-9DED0CE8 (archetype-scoped obligations)
**Kernel decision:** `principle_decide` chose `data-handling-predicate` (high confidence, composite 15.05 vs 8.95 vs 5.26, no commandment conflict) over jurisdiction-only approximation and reuse of the capability-activation substrate.

## Problem

BI-9DED0CE8 scoped the vertical compliance packs (banking, public-sector, law-enforcement, cooperative, UK corp-gov) to the archetype chosen at setup. That correctly removed noise — but exposed that the corpus is **100% vertical**: a software-platform install now sees **zero** obligations. Software obligations are **horizontal** (privacy, breach, AI governance, marketing, accessibility, sector overlays) and gate on **what an org does with data**, not on its industry archetype. The applicability engine could not express those triggers, and `handlesCardPayments` was captured at setup but consumed by nothing.

## Approach

Model the legal trigger as a first-class dimension, then seed a horizontal pack that gates on it.

1. **`DATA_HANDLING_PREDICATES`** — a closed predicate set in `regulation-applicability.ts` (`processes-personal-data`, `serves-consumers`, `handles-card-data`, `deploys-automated-decisioning`, `sends-marketing`, `publicly-accessible-service`, `handles-health-data`, `handles-financial-data`, `handles-education-data`, `government-customers`).
2. **`dataHandlingGate`** — composed into `regulationApplies` alongside archetype/listing/nexus. ANY-match; an **undeclared** profile → `review` (we haven't asked), a **declared-but-non-matching** profile → `reference` (definitive out-of-scope). EU/UK regimes stay `nexus`-gated (basis+jurisdiction), not predicate-gated.
3. **`BusinessContext.dataHandling String[]`** — persists the declared predicates; `handlesCardPayments=true` bridges to `handles-card-data` at resolve time so the two stay consistent.
4. **`seed-software-horizontal-compliance.ts`** — 18 regulations across 8 families, one row per regime (state-law families modeled as a single row, per the public-sector pattern). Statutory rows are `sourceType:"external"`; SOC 2 / ISO 27001 / NIST AI RMF are `sourceType:"framework"` — **not law**, surfaced as expected/contractual controls.
5. **Consuming surfaces** already scope via `resolveApplicableRegulationDbIds` (BI-9DED0CE8); no change needed — the horizontal regs flow through the same classifier.

## Determination provenance

Families → gating predicate → applies-now to a US B2B AI SaaS (no cards, no EU nexus):
US state privacy (CCPA + VCDPA-family) & breach notification → `processes-personal-data`; SOC 2/ISO (framework) → contractual; AI governance (NIST RMF framework, TX TRAIGA now, CO AI Act 2027, CA ADMT) → `deploys-automated-decisioning`; CAN-SPAM/TCPA → `sends-marketing`; ADA/WCAG → `publicly-accessible-service`; HIPAA/GLBA/FERPA/FedRAMP → sector predicates (dormant); GDPR/UK-GDPR/EU-AI-Act → EU/UK nexus (dormant). Sources cited in each seed row.

## Verification

- Unit: `dataHandlingGate` review/reference/applies + nexus composition; pack integrity (gated, unique, framework-labeled) + the software-platform scenario.
- Live: a US software install declaring `processes-personal-data` + `sends-marketing` sees privacy/breach/CAN-SPAM as **Applies**, sector overlays and EU regimes as out-of-scope/dormant — no blank page.

## Out of scope (follow-ups)

Controls + control-obligation links for the horizontal regs (coverage stays honestly 0% until implemented); a dedicated setup-wizard step for the data-handling interview (this PR adds the field + resolver; capture UI can be a fast-follow); per-state privacy-threshold refinement.
