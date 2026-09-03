# Provider trust action projection design

**Backlog:** BI-9CFB483F  
**Workroom:** WC-73D771A9  
**Decision:** DI-16D8DE623703 (`compiler-projection`, high confidence, autonomy eligible)

## Problem

The provider detail route turns a fixed list of evidence claims into an aggregate warning. That makes every missing processing-region or DPA row look like work the operator must do, even when the canonical business context declares no data-residency constraint and the intended route is public or synthetic. The same page then labels the provider **Ready** based on credentials, catalog, and routing metadata. Both statements are technically explainable, but together they teach the wrong mental model.

The page also accepts arbitrary comma-separated region codes. Organization location, organization data-residency policy, provider catalog capability, and the connected account's contractual entitlement are separate facts; one must never be used as proof of another.

## Objective baseline

**OBJ-TRUST-RELEVANCE:** Provider setup derives questions and attention from the canonical business and workload policy, so optional region or contract evidence does not look mandatory.

**OBJ-ENTITLEMENT-INTEGRITY:** Organization locale and data-residency requirements remain distinct from a connected provider account's proven processing entitlement.

**OBJ-READINESS-CLARITY:** The page distinguishes technical connectivity from workload-specific data-use eligibility and names the smallest correct next action.

**OBJ-ROUTING-SAFETY:** Restricted, unknown-classification, and region-bound workloads remain denied when required evidence is absent or invalid.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-TRUST-01 | OBJ-TRUST-RELEVANCE | With no explicit canonical residency requirement, the provider page neither asks for arbitrary region codes nor raises action for missing region or DPA evidence. |
| AC-TRUST-02 | OBJ-ENTITLEMENT-INTEGRITY | When canonical policy requires regions, the page names them and records a connection-scoped guarantee without inferring entitlement from operating locale. |
| AC-TRUST-03 | OBJ-READINESS-CLARITY | Technical readiness and data-use eligibility use distinct labels, scope statements, and actions. |
| AC-TRUST-04 | OBJ-ROUTING-SAFETY | Existing deny-by-default compiler behavior remains covered for unknown classification, region-bound work, and restricted work. |
| AC-TRUST-05 | OBJ-TRUST-RELEVANCE | Saving account terms while no region is required preserves existing region evidence; a required positive guarantee persists normalized regions. |

## Design grounding

This change extends the existing provider-suitability design rather than creating a second policy engine.

- `loadProviderSuitabilitySourceContext` already builds the canonical `BusinessSuitabilityProfile` from `Organization`, `BusinessContext`, and storefront archetype state.
- `deriveOnboardingWorkloadClasses` already selects the representative workloads for provider onboarding.
- `compileAiProviderSuitabilityPolicy` already decides whether a concrete connection can serve those workloads and emits connection-scoped explanation codes.
- `resolveProviderTrustEvidence` remains the factual account-scoped evidence resolver. It does not decide whether a missing fact matters to current work.
- The 2026-07-19 provider-suitability design requires setup to ask only for facts it cannot prove and keeps catalog capability, connected-account posture, and proven entitlement separate.
- The platform usability standards require plain language, progressive disclosure, visible action results, theme tokens, and removal of avoidable operator choices.

## Options considered

1. `context-filter`: filter the fixed checklist in the page with local mappings from business context to claim keys. Fast, but duplicates policy rules in presentation code.
2. `compiler-projection`: project usable scopes, blocked scopes, and required actions from the canonical suitability layer, then render that projection. Selected by DI-16D8DE623703.
3. `observed-failures`: raise actions only after route receipts show a failed attempt. Evidence-rich but retrospective; it makes the operator fail once before setup becomes legible.

## Chosen architecture

### 1. Focused canonical context loader

Extract the organization/business-profile portion of `loadProviderSuitabilitySourceContext` into a focused loader that returns `businessProfile`, `handlesCardPayments`, and whether canonical business context is configured. The existing all-connections onboarding loader and the provider detail route both reuse it. This avoids calling the unbounded all-connections loader from a single detail page and keeps organization context construction in one place. A configured context with an empty `dataResidency` list means no explicit region constraint; a missing context is unknown and must not be collapsed into that state.

### 2. Pure per-connection review projection

Add a pure provider-suitability projection that compiles two scopes for one concrete connection:

- public/synthetic work, with organization data residency intentionally removed;
- representative company work, using the canonical organization context and onboarding workload classes.

The projection returns:

- current usable scope: company work, public/synthetic only, or blocked;
- a plain-language headline and summary;
- required processing regions from `businessProfile.dataResidency`;
- policy explanation codes for the concrete connection;
- evidence claim keys that are required for the blocked scope;
- non-claim actions such as linking an active supplier contract when the compiler requires one.

If canonical business context is missing, the projection remains usable for public/synthetic work but does not claim company-work eligibility. Copy describes the projection as based on the current business setup; it does not imply knowledge of every future activity. Runtime per-request suitability remains authoritative for each actual workload.

Explanation-code-to-action translation lives beside the compiler/onboarding projection, never in the React page. Existing evidence rows may still be shown as account history, but a missing optional row cannot produce **Action needed**.

### 3. Region control is requirement-driven

When no canonical data-residency region is required, the account form does not render a region control and saving other account terms does not supersede existing region evidence.

When one or more regions are required, the form names them and asks whether this connected account guarantees processing there. It does not ask the operator to invent region codes. A positive declaration records both the regional-processing entitlement and the normalized required regions for this account. Organization setup supplies the requirement; the operator declaration supplies account evidence. Neither substitutes for the other.

### 4. Evidence state and action state stay separate

`resolveProviderTrustEvidence` continues to classify facts as current, missing, expired, rejected, conflicting, or superseded. `ProviderTrustEvidencePanel` receives the projection's required claim keys and computes urgency only over that subset.

- Required and missing/invalid: **Action needed**, with the blocked scope and exact next action.
- Required and current: **Ready for company work** or equivalent projection copy.
- No required evidence gap: **No action needed**. Existing optional evidence may be displayed without an alarm.

DPA is not treated as universally required because the current compiler does not use `dpa-on-file` as a universal route gate. Supplier contract, BAA, student terms, financial oversight, and no-training requirements remain distinct and follow compiler explanation codes.

### 5. Technical readiness is labelled honestly

The provider configuration card changes **Provider readiness** to **Technical readiness** and says that credentials, catalog, and routing metadata are prepared. Data-use eligibility remains in the trust projection. This removes the apparent contradiction without weakening either state.

## UX fit review

- **Decision:** fits-with-guardrails
- **Owning area:** Platform
- **Route family:** `/platform/ai/providers/[providerId]`
- **Primary persona:** platform operator configuring an AI provider without needing to understand provider-contract taxonomy
- **Navigation layer:** local page content only; no navigation change
- **Reuse/convergence:** reuse the existing account form, evidence panel, suitability compiler, onboarding projection, and theme tokens; add no new route or dashboard
- **Source truth:** `BusinessContext.dataResidency`, canonical workload profiles, `AiProviderConnection`, `ComplianceEvidence`, supplier contract, and the provider-suitability compiler
- **Empty/failure behavior:** public/synthetic eligibility remains explicit; missing company-work evidence names the blocked scope and one next action; unavailable canonical context fails closed without inventing a region
- **AI boundary:** no coworker action is introduced
- **Guardrails:** do not infer account entitlement from locale; do not hide a real restricted-work block; do not add arbitrary region input; do not create a second status vocabulary
- **Evidence before merge:** component and pure-projection tests, persistence tests, compiler regression suite, prose/style guards, route-budget evidence, and live route exercise in both themes and narrow/desktop viewports

The measured UX-fit manifest is `docs/ux-fit/2026-08-27-provider-trust-action-projection.ux-fit.json`.

## Data architecture

No migration or new table is required. `Organization`/`BusinessContext` remain authoritative for business requirements. `AiProviderConnection` and connection-scoped evidence remain authoritative for account declarations and proof. The new object is a transient read projection.

## Scalability

The detail route reads one provider connection plus one organization/business context. It must not load every provider connection merely to render one provider. Pure compilation remains bounded by the representative onboarding workload set and one connection. The existing onboarding page may continue to evaluate all configured connections; any future pagination of that inventory remains outside this BI.

## Failure safety and rollback

The routing compiler and pre-egress enforcement are not weakened. Missing canonical context or a projection failure must omit optimistic company-work copy and retain safe blocked/review behavior. Rollback is a normal PR revert; no schema or persisted-data rollback is needed. Existing region evidence remains valid because hidden controls no longer erase it.

## Research and benchmarking

- DPF's 2026-07-19 provider-suitability design is the governing domain benchmark: ask only for facts the platform cannot prove and compile the stricter organization/workload/account posture.
- DPF platform usability standards provide the interaction benchmark: progressive disclosure, plain language, persistent status messaging, and theme-aware styling.
- The portal UX simplification spine requires literal labels, trustworthy first-view status, one source of truth, and roughly 20% refactoring effort inside each slice. This design spends that refactoring budget extracting the shared business-context loader and removing page-local status/checklist logic.

No external component library is adopted. This is a policy/read-model correction inside existing DPF primitives.
