# AI Provider Suitability Routing Implementation Plan

> **For agentic workers:** REQUIRED: Use the DPF-native `dpf-tdd`, `dpf-local-merge-ci-before-push`, and `dpf-pr-with-dco` skills plus the per-BI completion gate. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route each AI activity to a capable provider that is permitted for the organization's work, data, jurisdiction, contracts, and risk posture, and guide operators to configure that posture during onboarding.

**Architecture:** Extend the existing data-governance PDP, jurisdiction model, Golden Triangle compiler, `RequestContract`, and V2 router. A pure suitability adapter turns governed data/activity/business/provider facts into hard route constraints and explanations; `routeEndpointV2` remains the sole endpoint selector. Onboarding, OpenRouter controls, vertical overlays, evidence, and telemetry all consume that same contract.

**Tech Stack:** Next.js 16, TypeScript, Prisma 7/PostgreSQL, Vitest, existing DPF routing/data-governance/archetype/occupation/value-stream modules, OpenAI-compatible chat completions.

**Spec:** `docs/superpowers/specs/2026-07-19-ai-provider-suitability-routing-design.md`

**Live work:** `EP-AI-PROVIDER-SUITABILITY`; `BI-AIPS-001` through `BI-AIPS-008`. These IDs are canonical. Do not create replacements or per-vertical duplicates.

---

## Delivery Rules

1. Start every BI by re-reading the spec §3.4 ownership ledger and querying live epic/BI state. New overlap is a design input.
2. Do not create another router, data taxonomy, PDP, regulatory evaluator, onboarding shell, provider-health model, archetype registry, occupation registry, or value-stream taxonomy.
3. Hard policy and data-governance decisions outrank Golden Triangle preference, capacity, cost, quality, and latency. Unknown high-risk context fails closed.
4. Recommendations are not enforcement. UI copy may say recommended, allowed, needs evidence, or blocked; it may not claim legal compliance.
5. Every BI updates the relevant user, architecture, and implementation-history docs or records a concrete no-docs-needed reason.
6. Use TDD for runtime changes. Capture build, UX, migration, and live-routing evidence under the DPF build gate.

## Refactoring Budget: 20%

Reserve approximately 20% of delivery capacity for focused cleanup that makes the existing contracts authoritative:

| Refactor | Budget |
| --- | ---: |
| Unify provider allow/deny enforcement and readiness-preview eligibility through `getExclusionReasonV2()` | 5% |
| Keep suitability types in focused modules and remove duplicate provider/data labels encountered in scope | 5% |
| Consolidate OpenAI-compatible request construction so OpenRouter policy cannot bypass one execution path | 5% |
| Reuse one explanation/receipt projection across setup, provider detail, and operations views | 5% |

## Canonical Dependency References

| Program | Contracts/BIs | PR evidence |
| --- | --- | --- |
| Data governance | `EP-DATA-GOVERNANCE`; `BI-DG-002/003/011/012`; `apps/web/lib/govern/data/*` | #3185, #3251, #3255 |
| Jurisdiction and compliance | `BusinessContext` regional fields; `regulationApplies()`; compliance library | #2030, #2095, #2562 |
| Golden Triangle | `EP-GOLDEN-TRIANGLE`; `compileGoldenTrianglePolicy()` and route-context composition | #2284 |
| Routing/capacity | `RequestContract`; `routeEndpointV2`; provider capacity/health | #3034, #3145 |
| Provider access posture | `ModelProvider`; `CredentialEntry`; `ExecutionAdapterSelector`; `AiProviderFinanceProfile`; `SupplierContract`; provider/CLI capacity | #1147, #2666, #2745, #3065, #3072 |
| Activity/coworker routing | `ActivityContract`; capability broker; specialist router | #3224, #3227 |
| Work context | archetype, `OccupationProfile`, operational/twin value stream | #3114, #3135, #3194, #3063, #3067 |
| Governed runtime | capability catalog and shared health projection | #3262, #3266 |
| Onboarding trust, COO/A2A, and grounded compliance Q&A | `BI-C98C6AB7`; `docs/superpowers/plans/2026-07-19-governed-llm-provider-onboarding.md`; role-only COO; AGT-902; profession corpus | #3252, #3264, #3295 |

## Chunk 1: Reconcile And Enforce The Existing Contract

### Task 1: BI-AIPS-001 - Reconcile Substrate And Lock Ownership

**Files:**
- Modify: `docs/superpowers/specs/2026-07-19-ai-provider-suitability-routing-design.md`
- Modify: `docs/superpowers/plans/2026-07-19-ai-provider-suitability-routing.md`
- Review: `docs/superpowers/specs/2026-07-17-data-management-governance-design.md`
- Review: `docs/design/golden-triangle-design.md`
- Review: `docs/superpowers/specs/2026-07-17-coworker-capability-routing-evidence-integrity-design.md`
- Review: `docs/superpowers/specs/2026-07-16-employee-occupation-onboarding-and-role-tailored-workspace-design.md`

- [ ] Query live `EP-DATA-GOVERNANCE`, `EP-EMPLOYEE-OCCUPATION`, `EP-MODEL-TIER-ROUTING`, vertical epics, and every `BI-AIPS-*` item.
- [ ] Re-audit current implementations of data policy, jurisdiction capture, regulatory applicability, routing, provider health, setup, archetype, occupation, and value-stream derivation.
- [ ] Update the spec §3.4 ledger with any contracts or PRs landed after 2026-07-19.
- [ ] Record an explicit ownership decision for each proposed type/table/route before it appears in a later BI.
- [ ] Run `pnpm docs:index:check`, `pnpm docs:links`, and `git diff --check`.
- [ ] Commit with DCO: `docs: reconcile ai provider suitability substrate`.

### Task 2: BI-AIPS-002 - Make Provider Allow/Deny Load-Bearing

**Files:**
- Modify: `apps/web/lib/routing/request-contract.ts`
- Modify: `apps/web/lib/routing/request-contract.test.ts`
- Modify: `apps/web/lib/routing/pipeline-v2.ts`
- Modify: `apps/web/lib/routing/pipeline-v2.test.ts`
- Verify: `apps/web/lib/inference/phase-enable-candidates.test.ts`
- Review: `apps/web/lib/golden-triangle/compose.ts`

- [ ] Write failing contract tests that a typed `deniedProviders` route-context value survives `inferContract()` and that empty/duplicate provider IDs normalize deterministically.
- [ ] Write failing V2 tests proving an allowlist excludes every other provider and a denylist excludes a provider even when it is cheapest, healthiest, or the only non-local endpoint.
- [ ] Write precedence tests proving deny wins over allow, hard fences win over Golden Triangle posture, and an empty effective allow set returns no route rather than silently degrading.
- [ ] Run the targeted tests and confirm they fail because V2 ignores the declared fences.
- [ ] Add `deniedProviders?: string[]` beside `allowedProviders` on `RequestContract` and its caller override shape.
- [ ] Enforce both fields in `getExclusionReasonV2()` using canonical provider IDs. Keep readiness previews aligned because `phase-enable-candidates.ts` reuses this function.
- [ ] Run `pnpm --filter web exec vitest run lib/routing/request-contract.test.ts lib/routing/pipeline-v2.test.ts lib/inference/phase-enable-candidates.test.ts`.
- [ ] Run `pnpm --filter web typecheck` and the production build through the governed gate.
- [ ] Update `docs/user-guide/ai-workforce/model-routing-lifecycle.md` with hard-policy precedence.
- [ ] Commit with DCO: `feat(routing): enforce provider allow and deny policy`.

### Task 3: BI-AIPS-003 - Trust Facts And Pure Suitability Compiler

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/20260719233000_ai_provider_connection/migration.sql`
- Create: `packages/db/src/provider-connection.ts`
- Modify: `packages/db/src/seed.ts`
- Create: `packages/db/src/provider-trust-registry.test.ts`
- Create: `apps/web/lib/routing/provider-suitability/types.ts`
- Create: `apps/web/lib/routing/provider-suitability/workload-profile.ts`
- Create: `apps/web/lib/routing/provider-suitability/provider-trust.ts`
- Create: `apps/web/lib/routing/provider-suitability/compile.ts`
- Create: `apps/web/lib/routing/provider-suitability/compile.test.ts`
- Modify: `apps/web/lib/ai-provider-route-context.ts`
- Modify: `apps/web/lib/inference/ai-provider-types.ts`
- Modify: `apps/web/lib/actions/ai-providers.ts`
- Modify: `apps/web/lib/actions/ai-providers.test.ts`
- Modify: `apps/web/lib/govern/data/assets.ts`
- Create: `docs/data-impact/2026-07-19-ai-provider-connection.data-impact.json`
- Modify: `packages/db/data/providers-registry.json`
- Test: `apps/web/lib/ai-provider-route-context.test.ts`
- Test: provider-registry validation tests discovered by `pnpm --filter @dpf/db exec vitest run`

**Governed data-model decision:** `DI-8902B7A5BE49` selects a separate
`AiProviderConnection` identity. Existing provider rows are backfilled as
unreviewed connections; no account tier, contract, or entitlement is inferred.

- [x] Write failing type/derivation tests for public marketing, health PHI, student records, financial records, source code, and credentials.
- [x] Import `DataAssetId`, `DataFieldId`, `DataSensitivity`, `DataCategory`, `ProcessingPurposeKey`, and `ResidencyClassKey` from `apps/web/lib/govern/data/taxonomy.ts`; do not redeclare them.
- [x] Write failing compiler tests for dental, retail, credit union, training, software, unknown-classification, conflicting-residency, and missing-contract cases.
- [x] Define provider facts in two layers: vendor/catalog facts in the existing provider registry; organization/account attestations remain separate inputs and default to unknown.
- [x] Derive a connection-scoped access posture from existing auth, credential, finance, contract, execution-adapter, and capacity owners: execution channel, account class, commercial basis, auth method, contract linkage, and proven entitlements.
- [x] Write failing tests for the same provider/model over regular metered API, subscription/OAuth or host CLI, enterprise-contracted API/cloud, router, and local connections. Prove evidence and enterprise rights never transfer between connections.
- [x] Audit whether one-row-per-`providerId` can support simultaneous accounts for one vendor. If not, introduce the smallest connection/profile identity that preserves `ModelProvider` as catalog ownership rather than encoding account tier in provider IDs.
- [x] Implement `compileAiProviderSuitabilityPolicy()` as a pure adapter over business context, `regulationApplies()` output, governed data/PDP output, activity/work context, provider facts, and Golden Triangle posture.
- [x] Return `allowedProviders`, `deniedProviders`, `residencyPolicy`, OpenRouter obligations, effect (`allow|review|deny`), and structured explanations. Never select an endpoint.
- [x] Pass the compiled route context into existing `inferContract()` composition.
- [x] Run targeted tests, web typecheck, registry validation, and production build.
- [x] Commit with DCO: `feat(routing): compile provider suitability policy`.

## Chunk 2: Guide Setup And Bound Router Providers

### Task 4: BI-AIPS-004 - Jurisdiction-Aware Onboarding Recommendations

**Files:**
- Modify: `apps/web/components/storefront-admin/SetupWizard.tsx`
- Modify: `apps/web/lib/storefront/setup-questions.ts`
- Modify: `apps/web/lib/storefront/setup-questions.test.ts`
- Modify: `apps/web/components/admin/BusinessContextForm.tsx`
- Modify: `apps/web/app/(shell)/storefront/setup/page.tsx`
- Create: `apps/web/lib/routing/provider-suitability/recommendations.ts`
- Create: `apps/web/lib/routing/provider-suitability/recommendations.test.ts`
- Modify: `apps/web/app/(shell)/platform/ai/providers/page.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/providers/page.test.tsx`

**Implementation checkpoint (2026-07-19):** The first delivery reorders business context before provider choice, records account-class/no-training/region attestations on the existing `AiProviderConnection`, renders the canonical suitability projection as `use now` / `use after review` / `not for this work`, previews egress and blocking in plain language, adds conservative activation clearance, and updates the role-only COO + AGT-902 corpus/citation contract. Operator declarations remain attestations rather than contract proof. Remaining acceptance work below includes attention-item creation, full archetype/jurisdiction fixtures, and live accessibility/mobile/no-egress evidence.

**Remaining AIPS-004 decomposition:** BI-26684747 owns governed COO → AGT-902 A2A execution and the bounded advisory contract; BI-EDAAD429 owns local cold-start/no-egress fallback; BI-CA5B5AB9 owns citation validation and grounded-Q&A evaluation; BI-BF3DFDB8 owns accessibility and nontechnical comprehension evidence. AIPS-005 through AIPS-008 retain their existing ownership; no duplicate BIs were filed for those concerns. Detailed dependency-first plan: [provider-onboarding COO A2A](2026-07-19-provider-onboarding-coo-a2a.md).

**Local cold-start checkpoint (2026-07-20):** `BI-EDAAD429` carries a hard `local_only` residency boundary from the provider-compliance collaboration runtime through the canonical agentic route options, accepts only bounded non-approval local output, and falls back to a deterministic cited advisory when the local model is absent, malformed, attempts an unsupported approval, or the governed A2A consultation cannot start. The branch passed the merged-code production gate, and an authenticated shared-runtime walkthrough confirmed that the owner receives the conservative cited guidance without a cloud route or provider-policy mutation.

**Grounded-answer checkpoint (2026-07-20):** `BI-CA5B5AB9` gives the COO/AGT-902 return boundary a governed evidence gate. Material citations must resolve to an exact, current source claim and apply to the minimized company's provider, jurisdiction, and workload context. Provider-specific claims do not inherit unknown service/account entitlements. Unsupported, stale, mismatched, or ungoverned output is replaced by the deterministic safe advisory and recorded as a deduplicated legal-compliance corpus repair signal. The profession seed and runtime gate consume one source registry; authoritative provenance and applicability are retained in `RawSource.locator`.

- [ ] Write failing recommendation tests for declared `operatesIn`, `sellsTo`, `employsIn`, and `dataResidency` bases plus archetype, risk posture, and active provider state.
- [ ] Add plain-language setup questions only where existing `BusinessContext` or confirmed `DataProcessingActivity` cannot already answer them.
- [ ] Infer API/OAuth/CLI/local channel from the connection flow, then ask whether the connected account is regular, business/team, enterprise, cloud-tenant, or unknown and whether a contract/entitlement is on file. Explain that consumer subscriptions and metered APIs are separate surfaces.
- [ ] Persist regional answers through the existing business-context action. Persist processing confirmations through the data-governance path when available; otherwise retain an explicit unknown/review state rather than a temporary policy store.
- [ ] Render one recommendation projection with `use now`, `use after review`, and `not for this work` groups; use the same projection on setup and provider overview.
- [ ] Satisfy the BI-C98C6AB7 companion plan's cold-start contract: the role-only COO remains the owner's single conversational counterpart, consults AGT-902 through visible A2A using a minimized packet, and falls back to deterministic cited guidance without unapproved cloud egress.
- [x] Support natural-language follow-up questions in the same COO conversation. Material legal/provider claims require current, authoritative, applicable claim-level citations; missing, stale, conflicting, or mismatched evidence must produce conditional/`cannot_substantiate` rather than model-memory guessing. (`BI-CA5B5AB9`; the existing child conversation remains the interaction surface and every returned advisory crosses the evidence gate.)
- [ ] Preview the activation effect in business language—what may leave, what stays local, what DPF blocks, and one next action—and meet the companion plan's non-technical readability and comprehension evidence threshold.
- [ ] Add evidence-needed follow-ups through the existing attention/backlog mechanism without automatically approving providers.
- [ ] Verify keyboard navigation, mobile layout, long provider names, empty/no-local/no-cloud states, and non-technical copy in the running portal.
- [ ] Update `docs/user-guide/getting-started/` and `docs/user-guide/ai-workforce/connecting-providers.md`.
- [ ] Run targeted Vitest, typecheck, production build, and UX gate.
- [ ] Commit with DCO: `feat(onboarding): recommend suitable ai providers`.

### Task 5: BI-AIPS-005 - OpenRouter Policy Pass-Through And Evidence

**Files:**
- Create: `apps/web/lib/routing/provider-suitability/openrouter-policy.ts`
- Create: `apps/web/lib/routing/provider-suitability/openrouter-policy.test.ts`
- Modify: `apps/web/lib/routing/execution-plan.ts`
- Modify: `apps/web/lib/inference/ai-inference.ts`
- Modify: `apps/web/lib/inference/ai-inference.call-provider.test.ts`
- Review: `apps/web/lib/routing/adapter-openrouter.ts`

- [ ] Write failing compiler tests for ZDR, data-collection denial, provider order/only/ignore, parameter requirements, bounded fallback, and public price/latency routes.
- [ ] Write failing execution tests proving request body controls reach `/v1/chat/completions`, the metadata header is sent, and EU policy changes the base URL only with attested enterprise enablement.
- [ ] Write account-posture tests proving regular OpenRouter API access cannot inherit enterprise EU/ZDR entitlements and enterprise controls apply only to the linked credential/account and required endpoint.
- [ ] Write failing response tests for returned underlying-provider attempts, absent metadata, unknown fields, and malformed optional metadata.
- [ ] Add typed OpenRouter policy to the existing execution plan; do not hide it in arbitrary metadata.
- [ ] Consolidate OpenAI-compatible request construction if multiple paths could bypass policy injection.
- [ ] Fail closed for restricted routes when pass-through, regional entitlement, bounded provider identity, or required metadata evidence is unproven.
- [ ] Persist only policy-safe route evidence; never copy sensitive prompts or raw restricted output into receipts.
- [ ] Run targeted tests, typecheck, build, and a live OpenRouter request in the leased sandbox when credentials are available. Record unavailable credentials as an unrun functional gate, not a pass.
- [ ] Update provider connection and routing lifecycle docs.
- [ ] Commit with DCO: `feat(openrouter): enforce bounded provider policy`.

## Chunk 3: Add Work Context Without New Taxonomies

### Task 6: BI-AIPS-006 - Archetype, Value-Stream, Occupation, And Activity Bindings

**Files:**
- Create: `apps/web/lib/routing/provider-suitability/work-context.ts`
- Create: `apps/web/lib/routing/provider-suitability/work-context.test.ts`
- Modify: `apps/web/lib/routing/activity-contract.ts`
- Modify: `apps/web/lib/routing/activity-compiler.ts`
- Modify: `apps/web/lib/routing/activity-compiler.test.ts`
- Review: `packages/storefront-templates/src/operational-value-stream.ts`
- Review: `packages/storefront-templates/src/twin-value-stream.ts`
- Review: `apps/web/lib/workforce/occupation.ts`

- [ ] Write failing tests deriving work context from canonical archetype, real value-stream stage, resolved occupation, activity class, governed assets/fields, and purpose.
- [ ] Add optional governed data references and workload-class hints to `ActivityContract`; keep classification authority in `govern/data`.
- [ ] Implement category defaults plus bounded archetype overrides for healthcare, banking, education, public sector, software/MSP, and general SMB.
- [ ] Prove the same organization/provider may allow public marketing work and deny PHI/student/financial/credential work.
- [ ] Prove occupation focuses recommendations but never widens RBAC, coworker grants, or tool authority.
- [ ] Add all-archetype structural coverage tests and representative activity-level behavioral tests.
- [ ] Update archetype/value-stream and occupation docs with the provider-suitability overlay.
- [ ] Run storefront-template tests, targeted web tests, typecheck, build, and representative UX verification.
- [ ] Commit with DCO: `feat(routing): bind provider policy to business work context`.

## Chunk 4: Evidence, Receipts, And Continuous Suitability

### Task 7: BI-AIPS-007 - Provider Trust Evidence, Expiry, And Route Receipts

**Files:**
- Review first: `packages/db/prisma/schema.prisma` models `ModelProvider`, `SupplierContract`, `ComplianceEvidence`, and routing receipt/telemetry models
- Modify only after audit: `packages/db/prisma/schema.prisma`
- Add if schema changes: `packages/db/prisma/migrations/<timestamp>_provider_suitability_evidence/migration.sql`
- Create: `apps/web/lib/routing/provider-suitability/evidence.ts`
- Create: `apps/web/lib/routing/provider-suitability/evidence.test.ts`
- Modify: existing route-decision/telemetry writer selected during Task 1 audit
- Modify: `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx`

- [x] Decide whether `SupplierContract` + `ComplianceEvidence` + existing provider, credential, and finance metadata can express connection identity, account class, BAA/DPA, ZDR/no-training, regional entitlement, admin/audit controls, SLA/support, review status, and expiry. Add a new model only for facts those owners cannot represent.
- [x] If a migration is required, write forward-safe migration tests and an inline backfill/attestation per AGENTS.md migration rules.
- [x] Write failing evidence resolution tests for valid, missing, expired, rejected, conflicting, and superseded evidence.
- [x] Write failing isolation tests proving an enterprise contract or entitlement linked to one account/connection never authorizes a regular API key, subscription session, or second tenant for the same vendor.
- [x] Write failing receipt tests that capture policy/input versions, provider/underlying-provider identity, exclusions, obligations, and explanation codes without sensitive content.
- [x] Make expired evidence downgrade restricted eligibility immediately while leaving general/public routing governed by its own policy.
- [x] Render contract/evidence status and next action on the existing provider detail page; do not create another admin workspace.
- [x] Run migration, unit, typecheck, build, UX, and route-receipt evidence gates.
- [x] Update operations and AI provider docs.
- [x] Commit with DCO: `feat(ai-providers): govern trust evidence and route receipts`.

### Task 8: BI-AIPS-008 - Continuous Suitability, Rollout, And Completion Gate

**Files:**
- Create: `apps/web/lib/routing/provider-suitability/telemetry.ts`
- Create: `apps/web/lib/routing/provider-suitability/telemetry.test.ts`
- Modify: `apps/web/lib/inference/provider-routing-rollup.ts`
- Modify: `apps/web/lib/inference/provider-routing-rollup.test.ts`
- Modify: existing attention source selected during Task 7
- Modify: provider overview/detail and operations route-explanation surfaces selected during UX audit
- Modify: `docs/user-guide/ai-workforce/model-routing-lifecycle.md`

- [x] Write failing rollup tests partitioned by activity/workload class while preserving privacy thresholds and existing provider/model totals.
- [x] Add drift/expiry attention signals for provider catalog facts, account attestations, contract evidence, regional entitlement, and repeated route failure.
- [x] Add drift signals when the observed execution channel, account class, plan limit, endpoint, or credential no longer matches the attested contract/entitlement posture.
- [x] Keep telemetry advisory: it may promote/degrade recommendations inside hard policy but cannot override PDP, contract, residency, or operator denial.
- [x] Add rollout flags in this order: compiler shadow mode, admin preview, onboarding recommendation, selected vertical bindings, restricted OpenRouter, evidence enforcement, continuous tuning.
- [x] Exercise dental, retail, credit-union, training, and software-platform journeys against the running portal.
- [ ] Run the full affected unit suites, production build, UX gate, migration gate if applicable, docs checks, secret scan, and `pnpm pr:health` before PR readiness.
- [x] Record final evidence against every BI and the epic; unresolved restricted-route evidence keeps the epic open.
- [x] Commit with DCO: `feat(ai-routing): complete continuous provider suitability`.

## Completion Criteria

- Every new route constraint reaches `routeEndpointV2`; no direct provider call bypasses it for governed activities.
- Data classification and action authority come from `govern/data`; jurisdiction comes from `BusinessContext`; regulation applicability comes from the generic evaluator.
- Setup recommendations and runtime enforcement use the same pure suitability projection.
- BI-C98C6AB7 onboarding/trust acceptance is evidenced through the mapped AIPS BIs: the role-only COO preserves one owner-facing conversation, AGT-902 supplies governed specialist evidence through A2A, explicit operator action retains decision authority, and no second compliance assistant or policy evaluator exists.
- OpenRouter restricted routes prove provider controls, regional entitlement when required, and underlying-provider evidence or fail closed.
- Every governed route evaluates the concrete provider connection; provider/model identity alone never supplies API, subscription, business/team, or enterprise rights.
- Route receipts identify execution channel and account posture without storing credentials or external customer account identifiers.
- Occupation and work context never widen authority.
- Route receipts explain the decision without storing sensitive content.
- The PR is current with `main`, mechanically healthy, and linked to `EP-AI-PROVIDER-SUITABILITY` plus all eight BIs.
