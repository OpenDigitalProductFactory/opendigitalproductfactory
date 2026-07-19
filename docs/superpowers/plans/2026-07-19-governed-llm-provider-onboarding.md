# Governed LLM Provider Onboarding Implementation Plan

**Backlog item:** BI-C98C6AB7

**Status:** Ready for Build Studio planning and phased delivery

**Date:** 2026-07-19

**Scope:** Provider selection, account ownership, sovereignty, compliance-coworker advice, activation, routing enforcement, data-loss prevention, retention, and existing-install remediation

## Outcome

DPF must help a company decide whether an LLM provider and account are appropriate before credentials make that provider routable, then enforce the resulting decision on every inference route. The experience begins with a small local model, gathers the minimum company and workload context needed for a defensible recommendation, asks the Data Governance coworker for evidence-backed advice through the existing A2A interface, and presents one clear recommendation with its reason and next action.

The implementation is complete only when guidance and enforcement agree:

- a personal/consumer account is never silently treated as suitable for business data;
- provider reachability is not mistaken for contractual or regulatory suitability;
- the selected account, region, retention/training terms, workload, and data class compile into routing policy;
- sensitive data is inspected immediately before external egress as defense in depth;
- an unapproved cloud route is excluded even if it is technically healthy and inexpensive;
- failure is closed: use a cleared local route when it is capable, otherwise block and explain the recovery action;
- audit evidence is useful without retaining unnecessary raw prompts, credentials, or personal data;
- the same posture is visible and repairable after onboarding at `/platform/ai/providers`.

This is decision support and technical policy enforcement, not legal advice or a claim of “absolute compliance.” A regulated or ambiguous posture must say what is known, what evidence is missing, and when qualified human review is required.

## Why the advisor review changes the plan

The external review correctly identifies that education alone is too weak. Its useful contribution is a systemic control plane: inspect before egress, gate activation, enforce hard action floors, minimize retained payloads, and keep platform guardrails outside editable prompts. The implementation adopts that direction while changing mechanisms that would create false assurance.

| Advisor proposal | Disposition | DPF implementation |
| --- | --- | --- |
| Local “Zero Leak” regex/NER interceptor before network calls | **Adopt with guardrails** | Add one canonical pre-egress policy stage for every routed inference. Structured `RequestContract` sensitivity and onboarding-derived data classes are primary; local content inspection is defense in depth. Redact only when task semantics and policy permit it; otherwise route locally or block. Regex/NER alone never establishes safety. |
| Verify keys with `/v1/models` and infer consumer/business tier | **Split** | Keep the reachability/authentication/model-discovery handshake. Do not infer account class, training terms, DPA, residency, or enterprise controls from that endpoint. Require an operator declaration plus dated provider/contract evidence; use provider-specific account APIs only where they authoritatively expose a fact. Unknown evidence produces restricted or non-routable posture. |
| Delete all raw payload histories after seven days | **Replace with policy-driven minimization** | Redact or avoid raw payloads at write time, then use the existing retention registry, industry floors, legal/incident holds, and dataset-specific windows. Do not put interceptor events into `DecisionInteraction` by default. Preserve compact policy-decision evidence in `RouteDecisionLog`/security audit surfaces without storing the sensitive value. |
| Hard risk floors and physical approval for destructive multi-step actions | **Reuse existing substrate** | Keep destructive/outbound action approval in `CoworkerActionEnvelope`; do not create a parallel action-envelope model. Provider activation is an explicit operator act. Ordinary approved inference does not require repeated approval, but it must pass policy on every route. |
| Archetype-locked immutable system preambles | **Adopt as defense in depth** | Reuse the immutable platform preamble and onboarding risk-envelope substrate. Add company jurisdiction, market, product/customer, account, and workload posture as governed context. Prompts explain and steer; routing, activation, authorization, and tool layers enforce. Archetype alone is not a compliance decision. |

Two advisor assumptions are explicitly rejected:

1. “Local” does not automatically mean compliant. Local capability, access control, encryption, host location, retention, and operational controls still matter.
2. Fallback does not always mean “send to local.” If no local model is capable or cleared, DPF must block/escalate rather than silently degrade the work or leak data.

## Existing substrate to extend

This work must extend the following sources of truth instead of creating parallel concepts:

- setup sequence and routes: `apps/web/lib/actions/setup-constants.ts`, `apps/web/components/setup/SetupOverlay.tsx`;
- company/market derivation: `apps/web/lib/onboarding/archetype-business-context.ts`, `apps/web/lib/onboarding/capture-market-context.ts`, `StorefrontConfig.archetypeId`, and business-context records;
- provider configuration and the one activation entry point: `ModelProvider`, `apps/web/lib/actions/ai-providers.ts`, `apps/web/lib/govern/activate-provider.ts`;
- provider/operator UX: `apps/web/app/(shell)/platform/ai/providers/`, `apps/web/components/platform/ProviderDetailForm.tsx`, `apps/web/lib/routing/provider-routing-eligibility.ts`;
- inference policy: `RequestContract.sensitivity`, `residencyPolicy`, `allowedProviders`, endpoint `sensitivityClearance`, and the canonical v2 routing pipeline;
- audit: `RouteDecisionLog`, `AuthorizationDecisionLog`, `SecurityEvent`, and `ToolExecution` summaries rather than raw secret-bearing payloads;
- destructive/outbound approvals: `CoworkerActionEnvelope`;
- retention: `apps/web/lib/operate/retention/policies.ts`, industry floors, retained-dataset guard tests, and the existing retention engine;
- A2A: `request_coworker`/`summon_coworker`, delegation chain of custody, the COO onboarding prompt, and AGT-902 Data Governance Agent;
- profession knowledge: `docs/professions/legal-compliance/wiki/` and the generated/indexed profession corpus;
- immutable prompt protection: the existing TAK platform preamble and onboarding risk-envelope/profile flow.

`ModelProvider.catalogEntry` may hold typed, seeded vendor/service facts, but install-specific account declarations and evidence must remain distinguishable from catalog claims. The first delivery slice must complete a schema-impact check before choosing whether the install-specific posture fits typed fields on `ModelProvider` or needs a related evidence record. It must not create a second provider or credential aggregate.

## Architecture and UX review

**Architecture verdict: aligned with concerns.** The design reuses the canonical provider, request-contract, routing, retention, action-envelope, A2A, and corpus substrates. The key architecture constraint is to compile one governed provider/workload posture and consume it at activation, eligibility projection, and runtime routing. UI badges and coworker prose are projections of that policy result, never separate policy stores.

**UX verdict: fits with guardrails.** Keep provider advice embedded in setup and on the existing provider pages; add no new global navigation, dashboard, or one-off compliance wizard.

- Served persona: a solo founder or business operator who may not know the difference between a consumer subscription, API account, enterprise agreement, region, or data-processing term.
- First viewport: one recommendation (`Recommended`, `Conditional`, or `Not suitable`), one plain-language reason, and one next action. Put evidence, citations, alternatives, and uncertainty behind “Why?” / “Review evidence.”
- A2A boundary: show that the COO is consulting the Data Governance coworker and preserve the delegation/audit chain. The local model may initiate the structured consultation; it may not activate cloud or invent missing facts.
- Skipping: company context may be deferred, but cloud activation must then remain restricted to public/synthetic evaluation data. Do not let “Skip” turn missing facts into approval.
- Recovery: unknown account class, missing evidence, unreachable local runtime, or inadequate local capability must produce a clear blocked/conditional state and a route to repair it.
- Lifecycle: the provider page must show posture, evidence age, allowed data classes/workloads, and reassessment action after onboarding.
- Theme/accessibility: use shared tokens and status components; convey status in text as well as color; keep keyboard and screen-reader behavior in the existing setup/provider interaction patterns.

## Governed decision contract

Implement one pure, versioned evaluation contract shared by onboarding, provider activation, provider settings, and routing.

### Inputs

- organization country and exact operating/customer jurisdictions;
- industry/market and applicable regulated-business signals;
- products/services and customer types (consumer, children, patient, employee, financial client, public sector, etc.);
- intended AI workloads;
- declared input/output data classes and sensitivity;
- required data residency/sovereignty posture;
- provider/service/model and selected region;
- credential owner (`organization` versus `individual`) and declared account class (`business_api`, `enterprise`, `consumer_subscription`, `unknown`);
- provider terms relevant to training, retention, subprocessors, residency, access, and DPA/BAA/contract coverage;
- evidence source, captured date, last verified date, and review/expiry date;
- local runtime capability and clearance for the workload.

Never store API keys, tokens, contract contents containing secrets, or detected sensitive values in this contract.

### Result

Return a stable structured result suitable for both a small local model and deterministic fallback:

- `verdict`: `recommended | conditional | not_suitable | unknown`;
- `allowedDataClasses` and `prohibitedDataClasses`;
- `allowedWorkloadTags` and `prohibitedWorkloadTags`;
- `residencyPolicy`: `local_only | approved_cloud` (do not generate `any_enabled` from onboarding);
- `allowedProviders` and, where required, allowed regions/models;
- `requiredActions` and missing evidence;
- concise reason and user-facing explanation;
- evidence citations and their dates;
- policy version and evaluation timestamp;
- escalation requirement.

The result must be deterministic for a fixed input/evidence set. The coworker may explain, compare alternatives, and ask for missing facts, but cannot broaden the compiled allowance.

### Enforcement semantics

1. Activation is transactional: valid credentials plus discovery are necessary but insufficient. `activateProvider()` must receive or resolve an approved governance posture before a cloud provider becomes generally routable.
2. A consumer/personal or unknown account is not silently forbidden for every possible use; it is restricted to explicitly allowed public/synthetic evaluation workloads unless authoritative evidence and company policy permit more.
3. The runtime merges the onboarding posture with the per-request `RequestContract`. The stricter sensitivity, residency, provider, region, and workload constraint wins.
4. Immediately before an external adapter sends bytes, a pre-egress guard revalidates the selected endpoint and inspects the final serialized request. This prevents alternate call paths or late prompt/tool-result additions from bypassing policy.
5. Content inspection yields metadata only: categories, confidence, action, policy version, and salted/deterministic fingerprint where needed for correlation. It never logs the matched value.
6. `redact` is allowed only when the policy identifies a safe transformation and the transformed payload still satisfies the task. Otherwise choose an eligible local route; if none exists, block with an operator-readable reason.
7. Provider terms or organization facts changing invalidates/reassesses posture. Stale evidence cannot remain indefinitely “approved.”

## Delivery sequence

Each phase is one independently reviewable concern/PR. Build Studio should promote the phases separately rather than attempt one x-large implementation PR.

### Phase 1 — Policy contract, evidence model, and deterministic fixtures

**Deliverable:** A typed, pure provider-governance evaluator and persistence decision grounded in the existing schema.

**Files likely affected:**

- `apps/web/lib/govern/provider-governance-types.ts` (new);
- `apps/web/lib/govern/evaluate-provider-posture.ts` (new);
- colocated unit tests and scenario fixtures;
- `packages/db/prisma/schema.prisma` and one new migration only if the schema-impact check proves existing typed fields/JSON cannot preserve install-specific evidence cleanly;
- `packages/db/src/seed.ts` or the canonical provider-catalog seed owner for vendor/service facts;
- `docs/superpowers/specs/2026-06-20-onboarding-intake-derivation-design.md` for the settled contract and source-of-truth map.

**Tasks:**

1. Trace every `ModelProvider.status = active` path and every inference adapter entry point; add invariants so the centralized activation and pre-egress paths remain complete.
2. Separate seeded vendor facts from organization/account declarations and evidence. Define closed enums before any data uses them.
3. Implement jurisdiction/workload/account/evidence evaluation as a side-effect-free function.
4. Add fixtures for EMEA, UK, healthcare, financial services, public-sector, consumer-account, unknown-evidence, local-incapable, and mixed-workload cases.
5. Define evidence freshness and invalidation rules; unknown or expired evidence narrows access.

**Verification:** targeted evaluator/schema tests; migration apply if added; seed idempotency; enum and activation-path invariant tests.

**Rollback:** evaluator remains dark/read-only until Phase 3. If a migration is needed, make it additive and preserve current provider state; disabling the feature flag restores current behavior without deleting evidence.

### Phase 2 — Legal/compliance corpus and AGT-902 A2A advice

**Deliverable:** The Data Governance coworker can return a small, cited, structured provider recommendation from company/workload context while the install is local-only.

**Files likely affected:**

- new or extended pages under `docs/professions/legal-compliance/wiki/` for provider-account governance, cross-border/provider due diligence, AI data minimization, and regulated-industry escalation;
- profession-corpus manifest/index/seed owner and corpus evidence tests;
- `prompts/specialist/data-governance-agent.prompt.md`;
- `prompts/route-persona/onboarding-coo.prompt.md` (confirm actual canonical slug before edit);
- `apps/web/lib/mcp/packs/coworker-pack.ts` only if the existing structured result cannot be carried without changing its generic A2A contract;
- A2A/delegation/corpus wiring tests.

**Tasks:**

1. Add primary-source, dated corpus entries for GDPR/UK GDPR, EU AI Act, DORA/NIS2 triggers, sectoral privacy, ISO/IEC 42001 governance, provider contracts/DPA evidence, residency versus access sovereignty, data minimization, and account ownership.
2. Correct AGT-902’s profession-corpus assignment so the legal/compliance pages are actually retrieved for this task.
3. Define the A2A objective/result schema around the Phase 1 contract. The COO gathers facts and calls `request_coworker`; AGT-902 assesses and cites; the COO explains.
4. Keep the initial response within the local served-model/tool budget. Retrieve only the relevant jurisdiction/industry pages and return a concise result.
5. Add a deterministic no-LLM fallback that computes the same verdict from captured facts and clearly marks missing evidence.

**Verification:** corpus-source and freshness tests; AGT-902 wiring test; A2A chain-of-custody test; local-only onboarding simulation with the cloud providers disabled; structured-output/fallback equivalence scenarios.

**Rollback:** corpus and prompt changes are reversible and do not activate providers. If the A2A call fails, the deterministic evaluator remains authoritative.

### Phase 3 — Reorder setup and gate provider activation

**Deliverable:** Setup captures enough company/workload context before provider selection, then prevents an unsuitable or unknown cloud account from becoming broadly routable.

**Files likely affected:**

- `apps/web/lib/actions/setup-constants.ts` and tests;
- `apps/web/components/setup/SetupOverlay.tsx` and setup progress/actions tests;
- canonical business-context capture/derivation modules;
- `apps/web/components/platform/ProviderDetailForm.tsx` and tests;
- `apps/web/lib/actions/ai-providers.ts`;
- `apps/web/lib/govern/activate-provider.ts` and tests;
- provider detail/list pages and eligibility projection tests.

**Tasks:**

1. Move the minimum company-context checkpoint before `ai-providers`. Do not duplicate the full storefront/business form; reuse its data owner and progressively ask only missing high-value facts.
2. During the provider step, ask who owns the credential/account, its class, region, intended workloads, and the evidence the operator can substantiate.
3. Run the visible COO → AGT-902 consultation and render one recommendation/reason/action, with evidence details progressively disclosed.
4. Separate “credentials verified” from “approved for these workloads.” `/v1/models` (or equivalent) establishes reachability/model access only.
5. Change `activateProvider()` so cloud clearance is derived from approved posture, not merely from provider category. Eliminate the current blanket cloud default of public/internal/confidential.
6. Allow a restricted evaluation mode for public/synthetic tests when company/account evidence is incomplete. Never infer general business clearance from a successful API call.
7. Existing local bootstrap remains available, but its capability/clearance is evaluated rather than presumed.

**Verification:** step-order and migration-of-in-progress-setup tests; activation-path invariants; personal-account, business-account, unknown-account, EMEA, regulated, skip, and A2A-failure UI scenarios; keyboard/screen-reader checks; live UX verification in the governed nonprod environment.

**Rollback:** preserve captured posture while feature-flagging the activation gate. A rollback may restore the old setup order, but must not broaden a provider whose posture was explicitly restricted.

### Phase 4 — Runtime policy compilation and pre-egress guard

**Deliverable:** Every inference route enforces the onboarding decision, and the final external payload passes a local pre-egress classification/redaction/block decision.

**Files likely affected:**

- `apps/web/lib/routing/request-contract.ts` and tests;
- `apps/web/lib/routing/pipeline-v2.ts`, loader/eligibility modules, and scenario tests;
- `apps/web/lib/inference/routed-inference.ts` and canonical adapter dispatch;
- a new focused module such as `apps/web/lib/inference/pre-egress-policy.ts` plus tests;
- `packages/integration-shared/src/redact.ts` only where its existing integration-input behavior can safely be generalized; do not overload it with provider-governance policy;
- routing decision logging/telemetry writers.

**Tasks:**

1. Compile the active organization/provider/workload posture into `residencyPolicy`, `allowedProviders`, sensitivity clearance, region/model constraints, and workload tags.
2. Merge constraints monotonically: no caller, prompt, tool result, model choice, or fallback may loosen them.
3. Add a final adapter-boundary guard after prompt/tool assembly and before network I/O. Cover chat, responses, image/audio/file payloads, and alternate provider adapters.
4. Use structured data classification first; add configurable country/industry-aware recognizers for unstructured content. Treat automated detection as fallible and test false-positive/false-negative handling.
5. Return one of `allow`, `transform`, `reroute`, or `block`. A transformation records which fields/categories changed, never their values.
6. Route policy denials into `RouteDecisionLog.excludedTrace`/`policyRulesApplied` and security telemetry with compact, masked evidence. Do not create a `DecisionInteraction` for routine routing decisions.
7. Guard every fallback. A provider rejected for policy cannot reappear later in the fallback chain.

**Verification:** unit/property tests for monotonic constraint merging; adapter coverage invariant; adversarial payload tests; no-sensitive-value logging tests; local reroute and no-capable-local block scenarios; production build and governed runtime inference exercises.

**Rollback:** ship in observe-only mode first, compare decisions without retaining raw payloads, then enforce by workload class. A kill switch may block all external egress; it must never mean bypass the guard.

### Phase 5 — Data minimization, retention, and audit evidence

**Deliverable:** Provider-governance and DLP events are auditable while raw sensitive content is minimized and lifecycle-managed under existing policy.

**Files likely affected:**

- telemetry/audit writers for `RouteDecisionLog`, `ToolExecution`, and `SecurityEvent`;
- `apps/web/lib/operate/retention/policies.ts`, industry floors, retained-dataset list, engine tests, and admin retention projection;
- schema/migration only if field-level masked summaries or holds cannot use existing structures;
- data-retention design spec and operator documentation.

**Tasks:**

1. Inventory fields where prompts, tool arguments/results, A2A context, or detected data can be persisted. Classify necessity and eliminate raw storage where not required.
2. Redact/pseudonymize at write time. Store policy id/version, category, action, provider/route, actor, timestamps, and correlation ids; do not retain matches.
3. Extend the central retention registry instead of adding a seven-day cleanup job. Dataset windows remain category-specific; industry floors only lengthen; regulated/incident/legal holds prevent purge.
4. Define status-aware `DecisionInteraction` retention separately if this work touches those records; do not assume vector weights/confidence are sufficient audit evidence.
5. Surface retention/evidence posture on provider and audit pages without exposing payloads.

**Verification:** seeded-secret/PII canary tests across DB audit fields and logs; retention dry-run/apply tests; industry-floor and hold tests; deletion batching/index tests; admin projection test.

**Rollback:** retention changes begin in report-only mode. A purge can be disabled through the existing scheduled-job control; raw-at-write minimization remains because rollback must not reintroduce sensitive logging.

### Phase 6 — Existing-install remediation and lifecycle reassessment

**Deliverable:** Existing active cloud providers are classified and repaired without surprise data egress, and posture remains current after onboarding.

**Files likely affected:**

- provider reconciliation/attention-source modules;
- provider list/detail UX;
- boot/reconciliation scheduling owner;
- provider governance actions and tests;
- setup progress only if a targeted remediation checkpoint is reused.

**Tasks:**

1. Backfill existing cloud providers to `unknown` evidence posture without fabricating account class or contract facts.
2. Preserve availability only for data/workloads already safe under the restricted posture; require reassessment before broader use.
3. Create one actionable attention item per provider (deduplicated), linking to the existing provider detail page.
4. Reassess on evidence expiry, provider/account/region change, organization jurisdiction/industry change, or relevant corpus/policy version change.
5. Show last assessment, reason, evidence age, allowed workloads/data classes, and next review date.

**Verification:** idempotent backfill/reconciliation tests; no silent clearance broadening; existing-install UX; evidence-expiry scenarios; full build gate and live happy-path verification.

**Rollback:** remediation is idempotent and preserves evidence. Do not downgrade an explicit restriction during rollback; operators can reassess or disable the provider.

## Cross-phase acceptance scenarios

At minimum, the end-to-end suite must cover:

1. A French healthcare company selects a personal consumer account for patient-summary work: not suitable; cloud remains excluded; capable cleared local is offered or the task blocks.
2. A German B2B company supplies a business API account, EU region, current DPA/no-training evidence, and internal non-personal workload: conditional/recommended according to policy; only the evidenced region/provider is eligible.
3. A UK company has valid credentials but unknown account/retention terms: handshake succeeds, governance remains unknown/restricted, and public synthetic evaluation is the maximum allowance.
4. A US solo entrepreneur with no regulated data selects a consumer subscription for public marketing ideation: allowed only if provider terms and company policy substantiate that workload; the product explains the limitation.
5. A financial-services user pastes an IBAN into a previously approved general cloud chat: pre-egress detection causes policy-driven transform/reroute/block; the raw IBAN appears nowhere in logs.
6. A prompt starts internal but a tool result adds restricted personal data: final pre-egress evaluation catches the late addition.
7. The approved provider fails: fallback considers only other providers allowed by the same posture; it never broadens to `any_enabled`.
8. The local model is down or too weak: DPF blocks/escalates rather than claiming local fallback succeeded.
9. AGT-902/A2A inference fails during onboarding: deterministic evaluation still produces the same enforcement result and a plainer explanation.
10. Evidence expires or the company adds an EMEA customer market: posture is invalidated, attention appears, and cloud allowance narrows until reassessed.
11. A coworker proposes a destructive external action during setup: the existing `CoworkerActionEnvelope` requires explicit approval and preserves chain of custody.
12. Retention runs under a regulated industry floor or active hold: required evidence remains; eligible operational telemetry is purged without orphaning relations.

## Research and standards grounding

The implementation should cite primary legal/regulatory texts in the profession corpus. The following implementation references inform mechanism and UX, not legal conclusions:

### Open-source patterns

- [Microsoft Presidio](https://microsoft.github.io/presidio/) combines regex, checksums, rules, context, and NER for detection/anonymization and explicitly warns that automated detection cannot find all sensitive information. Adopt the layered recognizer pattern and its limitation; do not treat detection as the policy source.
- [Open Policy Agent decision logs](https://www.openpolicyagent.org/docs/management-decision-logs) separate policy decision evidence from enforcement and provide masking before decision-log upload. Adopt decision ids, policy/version attribution, and masked audit evidence; DPF keeps its own policy/runtime rather than introducing OPA solely for this feature.
- DPF’s own `RequestContract`/routing pipeline provides the policy-input and enforcement substrate; prefer extending it over introducing a second gateway.

### Commercial patterns

- [Microsoft Purview DLP](https://learn.microsoft.com/en-ca/purview/dlp-learn-about-dlp) applies policy to sensitive data at multiple transmission/activity locations and combines multiple detection techniques. Adopt policy-driven actions and endpoint/egress coverage, not a standalone regex list.
- [Amazon Bedrock Guardrails sensitive-information filters](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html) support configurable block or mask actions for inputs and outputs. Adopt the explicit per-policy action vocabulary; do not delegate DPF’s cross-provider governance to a provider-specific control.
- Provider model-list/auth endpoints are connectivity evidence, not account-contract evidence. Each provider adapter must document exactly which facts its official APIs can and cannot prove.

### Standards posture

- Use ISO/IEC 42001 concepts for AI management-system responsibilities, documented controls, monitoring, and continual reassessment.
- Use privacy-by-design/data-minimization principles and exact jurisdiction/sector sources rather than a single global “compliance” flag.
- Treat data residency, access sovereignty, controller/processor obligations, and contractual evidence as related but distinct dimensions.
- Keep human approval for destructive/outbound actions aligned with DPF’s existing action-envelope governance.

## Dependencies and sequencing risks

- **AGT-902 corpus assignment:** the coworker cannot give defensible advice until legal/compliance pages are actually in its retrieval scope.
- **Local model capacity:** structured contracts and tight retrieval budgets are mandatory; free-form legal synthesis is not the cold-start dependency.
- **Activation blast radius:** `activateProvider()` is used by OAuth, API keys, tests, seed/bootstrap, and linked providers. Phase 1 must inventory all callers and provide safe treatment for bootstrap/system providers.
- **Alternate egress paths:** adapter coverage must be proven by an invariant test. A guard attached only to the chat UI is not sufficient.
- **Existing installations:** immediately setting every active provider to unusable may disrupt operations; staged restriction must still prevent newly disallowed sensitive egress.
- **False assurance:** the UI must distinguish declarations, provider-published facts, verified account facts, and inferred policy results.
- **Detection quality:** false negatives demand structured classification and fail-closed rules; false positives require reviewable categories and safe recovery, never a bypass button that silently allows the same payload.
- **Retention conflict:** privacy deletion and regulated audit/incident retention can conflict. The existing policy registry, floors, and holds arbitrate; no universal short window.
- **Related work:** coordinate healthcare-specific scenarios with BI-HEALTHCARE-053 and coworker authority work with EP-31815F97 rather than duplicating their controls.

## Definition of done

- The plan’s six phases have shipped through separate reviewable PRs with the mandatory build gate appropriate to each phase.
- A new install can complete the provider decision with only the local model and deterministic evaluator available.
- Setup identifies the company, exact jurisdiction/market, product/customer posture, workloads, data classes, provider account ownership/class, region, and evidence before broad cloud activation.
- COO → AGT-902 A2A advice is visible, cited, structured, and traceable to the human-originated setup session.
- Provider posture is one source of truth consumed by activation, provider UX, and runtime routing.
- Every external inference path has final pre-egress policy enforcement and masked audit evidence.
- Personal/consumer and unknown accounts cannot silently receive business-confidential/restricted workloads.
- Policy fallbacks never broaden provider, residency, sensitivity, region, or workload constraints.
- Existing action envelopes, retention registry, and immutable platform preamble are reused rather than duplicated.
- Existing active providers are reassessed without fabricated facts, and operators have a clear repair path.
- Legal/compliance corpus sources are primary, dated, and included in freshness/evidence tests.
- Live UX verification confirms the first-viewport recommendation, details, skip/restriction behavior, A2A consultation, provider repair, and failure states.
