# Archetype Capability Applicability And MSP Segmentation Implementation Plan

> **Authority notice (2026-08-01):** This completed historical plan preserves delivery
> lineage; it does not grant the referenced V3 workbook normative or AI-evidence status.
> That artifact is `undetermined` under
> `SUD-PORTFOLIO-WORKBOOK-V3-2026-08-01`. Use current code and live data for observed
> state and the
> [Four-Portfolio Archetype and AI Workforce Operating Standard](../../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md)
> for target semantics and source-use controls.

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` if subagents are explicitly authorized, otherwise use `superpowers:executing-plans`. Track every checkbox as work proceeds. For TypeScript work, run `pnpm --filter web typecheck` before committing and fix any errors. For UI work, follow AGENTS.md theme-aware styling rules: use DPF CSS variables, no hardcoded colors, and verify the affected route in the running app.

**Goal:** Turn archetypes into typed operating-model activators so the MSP archetype can require customer estate segmentation, Edge Node customer deployment, service agreements, and billing readiness without forcing those workflows onto archetypes such as salons that primarily use appointment checkout or point-of-sale payment.

**Epic:** `EP-ARCH-8D4F2A` - Archetype Model V2: Unified Business Archetypes. Reopened and bound via live DPF MCP on 2026-05-22.

**Architecture:** Preserve the current `activationProfile` JSON field and legacy `modules` shape, but introduce a normalized runtime profile expressed as **operating-model axes + portfolio decomposition** (see design spec §6.5/§6.6). Capability applicability, scope policy, isolation, surfaces, and billing/payment pattern are *derived* from axis values through a small rules engine — not declared per archetype. The legal capability set is owned by a code-resident **Capability Registry** that names each capability's portfolio, IT4IT stage, default scope, and default isolation. Keep customer estate scoped inside one MSP organization for now, with a later path to true customer tenant boundaries if external customer portals require it.

**Refactoring allocation:** Reserve at least 20 percent of implementation time for shared contract cleanup and compatibility helpers. Do not implement MSP behavior as one-off `archetypeId === "it-managed-services"` checks in UI or server actions. Do not introduce a `profileType` string discriminator or a `version: N` field — the presence of `axes`/`portfolios` is the discriminator between legacy and new shape.

**Reference vocabularies (current authority clarification):** Axis value enums (`form`, `delivery`,
`primaryConsumer`, `consumptionChannel`, `commercialModel`, `provisioning`, `platform`) are now owned
by `packages/storefront-templates/src/types.ts`. The V3 workbook records historical lineage only and
is non-admissible while its SourceUseDecision is `undetermined`; new closed values follow the
governed typed-enum migration process, not a workbook-first update.

**Tech Stack:** Next.js App Router, TypeScript, Prisma 7, PostgreSQL, pnpm workspaces, vitest.

---

## File Structure

- Modify: `packages/storefront-templates/src/types.ts`
  Add operating-model axis enums, portfolio decomposition types, capability applicability enums, ownership-scope and transaction-context enums (split — see design §7), isolation modes, and billing/payment pattern types.
- Create: `packages/storefront-templates/src/capability-registry.ts`
  Code-resident registry mapping `capabilityKey` → `{ portfolio, it4itStage?, defaultOwnershipScope, defaultIsolation, surfaces[] }`. Single source of truth for legal capability keys; imported by archetype definitions, the rules engine, the activation summary, and scope helpers.
- Create: `packages/storefront-templates/src/capability-registry.test.ts`
  Unit tests asserting every key has a portfolio + scope, and that no consumer carries its own string union.
- Create: `packages/storefront-templates/src/applicability-rules.ts`
  Rules engine: `deriveCapabilityApplicability(axes, portfolios)` → `Map<capabilityKey, CapabilityActivation>`. Small, code-reviewed rule set described in design §6.5.
- Create: `packages/storefront-templates/src/applicability-rules.test.ts`
  Fixtures: MSP, salon, retail, HOA produce the §9 example rows from axis values alone. Adding a fixture archetype must not require editing the rules.
- Create: `packages/storefront-templates/src/activation-profile.ts`
  Shared normalizer that converts legacy and axis-shaped activation profiles into one runtime contract via the rules engine.
- Create: `packages/storefront-templates/src/activation-profile.test.ts`
  Unit tests for legacy MSP normalization, axis-shaped MSP/salon profiles, invalid axis values rejection, and billing pattern derivation.
- Modify: `packages/storefront-templates/src/index.ts`
  Export the new shared activation profile helpers.
- Modify: `apps/web/lib/storefront/archetype-activation.ts`
  Replace local parser sets with the shared normalizer and keep current exported helper behavior compatible.
- Modify: `apps/web/lib/storefront/archetype-activation.test.ts`
  Add compatibility tests around legacy input and v2 output.
- Modify: `packages/storefront-templates/src/archetypes/professional-services.ts`
  Extend `it-managed-services` with v2 applicability fields while preserving legacy fields for compatibility.
- Modify: `packages/storefront-templates/src/archetypes/beauty-personal-care.ts`
  Add non-MSP billing/payment profile defaults for appointment checkout and point-of-sale behavior.
- Modify: `packages/storefront-templates/src/archetypes/archetypes.test.ts`
  Assert MSP required capabilities and salon recurring billing optionality.
- Modify: `packages/finance-templates/src/types.ts`
  Add billing/payment pattern fields while temporarily retaining `recurringBillingEnabled`.
- Modify: `packages/finance-templates/src/profiles.ts`
  Populate payment patterns for professional services/MSP-compatible defaults and beauty/personal-care checkout defaults.
- Modify: `packages/finance-templates/src/profiles.test.ts`
  Assert every profile has a primary payment pattern and supported patterns.
- Modify: `apps/web/lib/finance/setup-profile.ts`
  Return payment/billing pattern metadata for setup UI consumers.
- Modify: `apps/web/lib/finance/setup-profile.test.ts`
  Cover professional services and beauty/personal-care finance setup behavior.
- Create: `apps/web/lib/customer-estate/scope-policy.ts`
  Shared helpers for required customer/site scope in MSP estate operations.
- Create: `apps/web/lib/customer-estate/scope-policy.test.ts`
  Unit tests for strict MSP scope, shared standard scope, and missing account/site failures.
- Modify: `apps/web/components/storefront-admin/FinancialSetupStep.tsx`
  Show billing/payment defaults from the resolved profile without hardcoded colors.
- Modify: `apps/web/components/storefront-admin/SetupWizard.tsx`
  Surface an archetype activation summary if the selected archetype has required/recommended capabilities.
- Create: `apps/web/components/storefront-admin/ArchetypeActivationSummary.tsx`
  Compact theme-aware summary of activated capabilities and payment patterns.
- Create: `apps/web/components/storefront-admin/ArchetypeActivationSummary.test.tsx`
  Render tests for MSP and beauty/personal-care activation summaries.
- Modify: `apps/web/components/storefront-admin/StorefrontAdminTabNav.tsx`
  Allow the setup/admin tab bar to wrap on mobile so setup previews do not introduce horizontal page overflow.
- Modify: `apps/web/components/shell/UpdatePendingBanner.tsx`
  Allow the platform-update banner to wrap long version hashes on mobile without widening setup pages.
- Modify: `docs/superpowers/specs/2026-04-23-it-service-provider-msp-archetype-design.md`
  Add a pointer to the new applicability spec as the canonical cross-archetype contract.

---

## Chunk 1: Shared Activation Contract

### Task 1: Add operating-model axes, portfolio decomposition, and capability types

**Files:**
- `packages/storefront-templates/src/types.ts`

- [x] Add `OperatingModelAxes` interface with: `form`, `delivery`, `primaryConsumer`, `consumptionChannel`, `commercialModel`, `provisioning`, `platform`. Each is a code-owned string-union enum; the historical workbook lineage is not current authority.
- [x] Add `PortfolioRole = "foundational" | "manufactureAndDeliver" | "forEmployees" | "productsAndServicesSold"` and `PortfolioScope = "absent" | "minimal" | "standard" | "primary"`.
- [x] Add `PortfolioDecomposition` interface keyed by `PortfolioRole` with `scope` and role-specific extras (e.g., `it4itStages[]` for `manufactureAndDeliver`).
- [x] Add `CapabilityApplicability = "required" | "recommended" | "optional" | "hidden" | "not-applicable"`.
- [x] Add `OwnershipScope = "organization" | "customer-account" | "customer-site" | "configuration-item" | "edge-node"` (where the row lives).
- [x] Add `TransactionContext = "service-agreement" | "engagement" | "appointment" | "order" | "billing-period" | "episode-of-care"` (what work-event bound it). Split from ownership scope per design §7.
- [x] Add `CapabilityIsolation = "organization-scope" | "strict-customer-scope" | "shared"`.
- [x] Add `PaymentPattern = "point-of-sale" | "appointment-checkout" | "ad-hoc-invoice" | "recurring-agreement" | "subscription" | "retainer" | "project-milestone" | "usage-based" | "donation" | "optional-package"`.
- [x] Add `CapabilityActivation`, `CapabilityOverride`, and `BillingPatternProfile` interfaces.
- [x] Extend `ActivationProfile` with optional `axes`, `portfolios`, `capabilityOverrides`, and `billingProfile`. **Do not add a `version` field or `profileType` discriminator** — presence of `axes`/`portfolios` is the discriminator (design §6).
- [x] Keep existing `modules`, `billingReadinessMode`, `customerGraph`, and `estateSeparation` fields required for backward compatibility in this slice.

### Task 1b: Stand up the Capability Registry

**Files:**
- `packages/storefront-templates/src/capability-registry.ts`
- `packages/storefront-templates/src/capability-registry.test.ts`

- [x] Define one record per capability with `portfolio`, optional `it4itStage`, `defaultOwnershipScope`, `defaultIsolation`, `surfaces[]`. Seed with the capabilities referenced in design §9 (customer-estate, customer-sites, edge-node-customer-deployment, network-inventory, cybersecurity-posture, backup-restore-posture, service-agreements, billing-readiness, appointment-checkout, point-of-sale, project-work, lifecycle-review-queues, remote-support).
- [x] Export `CapabilityKey` as a const-derived union — every consumer imports this, not its own string union.
- [x] Tests: registry is exhaustive over `CapabilityKey`; every key has a portfolio + default scope; no orphans.

### Task 1c: Implement the rules engine

**Files:**
- `packages/storefront-templates/src/applicability-rules.ts`
- `packages/storefront-templates/src/applicability-rules.test.ts`

- [x] Implement `deriveCapabilityApplicability(axes, portfolios)` returning `Map<CapabilityKey, CapabilityActivation>`.
- [x] Encode the rules listed in design §6.5 (B2B + manufactureAndDeliver → customer-estate required; recurring-agreement → service-agreements required; appointment-checkout → appointment-checkout required; detect-to-correct stage → edge-node-customer-deployment required; etc.).
- [x] Each rule is a small pure function with a name + reason string for traceability.
- [x] Apply `capabilityOverrides` last, with each override producing a debug log line tagged with the override reason.
- [x] Fixtures: MSP, salon, retail, HOA produce the exact §9 example matrix from axis input alone.
- [x] Fixture: adding a fifth archetype (e.g., dental practice) requires only axis values + portfolio scopes — no rules engine edits.

### Task 2: Implement shared normalizer

**Files:**
- `packages/storefront-templates/src/activation-profile.ts`
- `packages/storefront-templates/src/activation-profile.test.ts`
- `packages/storefront-templates/src/index.ts`

- [x] Write tests first for legacy MSP input being normalized: legacy `modules` + `customerGraph` + `estateSeparation` infer axes (`primaryConsumer=business`, `commercialModel=recurring-agreement`) + portfolios (`manufactureAndDeliver=primary`), and the rules engine produces the required capability set.
- [x] Write tests for a standard/non-MSP legacy profile inferring `primaryConsumer=individual`, organization-scope defaults, and non-recurring billing behavior.
- [x] Write tests rejecting invalid axis values, unknown `CapabilityKey` (from registry), and invalid payment patterns.
- [x] Implement `readActivationProfile(raw)` returning the normalized runtime shape (no `V2` in the name — there is no v1/v2).
- [x] Implement `activationHasCapability(profile, capabilityKey)` and `getCapabilityApplicability(profile, capabilityKey)` against the rules-engine output.
- [x] Export the new helpers from `packages/storefront-templates/src/index.ts`.
- [x] Run `pnpm --filter @dpf/storefront-templates test -- activation-profile`.

### Task 3: Refactor web activation helper to shared normalizer

**Files:**
- `apps/web/lib/storefront/archetype-activation.ts`
- `apps/web/lib/storefront/archetype-activation.test.ts`

- [x] Replace local validation sets with imports from `@dpf/storefront-templates`.
- [x] Keep `readActivationProfile`, `isManagedServiceProviderProfile`, `deriveRevenueModelFromActivationProfile`, and `deriveCustomerConfigurationItemDefaults` exports stable.
- [x] Add tests proving existing TAK, marketing, and customer-estate consumers still receive the legacy-compatible shape they expect.
- [x] Run `pnpm --filter web test -- archetype-activation`.

---

## Chunk 2: Archetype Profiles And Finance Patterns

### Task 4: Express MSP and beauty archetypes via axes + portfolios

**Files:**
- `packages/storefront-templates/src/archetypes/professional-services.ts`
- `packages/storefront-templates/src/archetypes/beauty-personal-care.ts`
- `packages/storefront-templates/src/archetypes/archetypes.test.ts`

- [x] Declare `it-managed-services` axes: `form=services, delivery=hybrid, primaryConsumer=business, consumptionChannel=onsite-plus-portal, commercialModel=recurring-agreement, provisioning=account-and-entitlement, platform=no`.
- [x] Declare `it-managed-services` portfolios: `manufactureAndDeliver={scope:primary, it4itStages:["detect-to-correct","deploy-to-operate","request-to-fulfill"]}`, `productsAndServicesSold={scope:primary}`, `forEmployees={scope:standard}`, `foundational={scope:minimal}`.
- [x] Add a single `capabilityOverride` for `it-managed-services`: `remote-support → recommended` with stated reason (consent gating not yet automated). All other MSP capabilities should fall out of the rules engine — do **not** list them inline.
- [x] Declare beauty/personal-care axes: `form=services, delivery=physical, primaryConsumer=individual, consumptionChannel=physical, commercialModel=appointment-checkout, provisioning=account-with-billing, platform=no`.
- [x] Declare beauty/personal-care portfolios: `productsAndServicesSold={scope:primary}`, others `minimal`.
- [x] **Test that the §9 example matrix is fully produced by the rules engine** from the axis + portfolio declarations above. Required-capability assertions live in the rules-engine tests; archetype tests assert axis values and overrides, not enumerated capability lists.
- [x] Test that beauty/personal-care does not activate `customer-estate`, `edge-node-customer-deployment`, or `recurring-agreement-billing` as required.
- [x] Run `pnpm --filter @dpf/storefront-templates test -- archetypes applicability-rules`.

### Task 5: Replace finance boolean semantics with billing patterns

**Files:**
- `packages/finance-templates/src/types.ts`
- `packages/finance-templates/src/profiles.ts`
- `packages/finance-templates/src/profiles.test.ts`
- `apps/web/lib/finance/setup-profile.ts`
- `apps/web/lib/finance/setup-profile.test.ts`

- [x] Add `billingPatternProfile` to `FinancialProfile`.
- [x] Keep `recurringBillingEnabled` as a derived compatibility field for now.
- [x] Set professional services to support recurring agreement, retainer, project milestone, and ad-hoc invoice.
- [x] Set beauty/personal care to appointment checkout and point-of-sale as primary/supported patterns, with recurring optional for packages or memberships.
- [x] Add a helper that derives `recurringBillingEnabled` from `billingPatternProfile.recurringBillingApplicability !== "not-applicable"` where existing callers still need it.
- [x] Update finance setup to expose `primaryPaymentPattern`, `supportedPaymentPatterns`, and `recurringBillingApplicability`.
- [x] Run `pnpm --filter @dpf/finance-templates test -- profiles`.
- [x] Run `pnpm --filter web test -- setup-profile`.

---

## Chunk 3: Customer Estate Scope Guardrails

### Task 6: Add reusable customer-estate scope policy helper

**Files:**
- `apps/web/lib/customer-estate/scope-policy.ts`
- `apps/web/lib/customer-estate/scope-policy.test.ts`

- [x] Write tests for strict MSP scope requiring `accountId`.
- [x] Write tests for site-bound operations requiring both `accountId` and `siteId`.
- [x] Write tests for standard/shared profile allowing organization-scoped operations when no customer estate capability is active.
- [x] Implement `resolveCustomerEstateScopePolicy(profile)`.
- [x] Implement `requireCustomerEstateScope(input, policy)`.
- [x] Implement a guard return shape that server actions can use without throwing UI-hostile errors.
- [x] Run `pnpm --filter web test -- scope-policy`.

### Task 7: First call sites for scope policy adoption

**Files (first-slice only — see note):**
- `apps/web/lib/customer-estate/account-estate-summary.ts`
- `apps/web/lib/customer-estate/lifecycle-evaluation.ts`
- `apps/web/components/customer/CustomerLifecycleReviewQueues.tsx`

- [x] Audit current loaders and components for implicit customer/site assumptions.
- [x] Adopt the helper only where it is required for the first slice and covered by tests. No existing call site was forced in this slice; current account estate pages already enter through an account route, and Edge Node binding remains deferred.
- [x] Put any later-migration notes in the implementation PR description, not inline code.

> **Deferred to Edge Node binding spec, not this plan:** `apps/web/components/inventory/DiscoveryOperationsPage.tsx`. It is an Edge Node surface and its scope policy depends on `EdgeNode.customerAccountId/siteId` fields that don't exist yet.

---

## Chunk 4: Setup And Admin UI

### Task 8: Add activation summary component

**Files:**
- `apps/web/components/storefront-admin/ArchetypeActivationSummary.tsx`
- `apps/web/components/storefront-admin/ArchetypeActivationSummary.test.tsx`

- [x] Build a compact summary using DPF theme variables only.
- [x] Use icons for capability groups where an existing icon library is already used in nearby setup/admin components.
- [x] Show required/recommended capability counts, primary payment pattern, and isolation mode.
- [x] Avoid visible instructional copy about how the app works; use concise labels and status values.
- [x] Add render tests for MSP and beauty/personal-care profiles.

### Task 9: Wire summary into setup flow

**Files:**
- `apps/web/components/storefront-admin/SetupWizard.tsx`
- `apps/web/components/storefront-admin/FinancialSetupStep.tsx`

- [x] Show the activation summary after an archetype is selected.
- [x] For MSP, surface customer estate, edge node, service agreements, backup/security posture, and billing readiness as required activation items.
- [x] For beauty/personal care, show appointment checkout/point-of-sale and keep recurring packages optional.
- [x] Update financial setup to read payment patterns from `resolveFinanceSetupProfile`.
- [x] Verify no hardcoded colors are introduced.
- [x] Run targeted component tests.

### Task 10: UX verification

**Files:**
- setup/admin routes affected by the implementation

- [x] Start or use the production-path Docker-served portal according to AGENTS.md. Root Docker portal was serving the root clone, so route QA used the worktree production build against a temporary Postgres clone `dpf_msp_qa` on `http://127.0.0.1:3108`; the clone was reseeded with `seedStorefrontArchetypes` and dropped after QA.
- [x] Log in with `admin@dpf.local` and `ADMIN_PASSWORD` from repo-root `.env`.
- [x] Exercise `/storefront/setup` with IT Managed Services selected.
- [x] Exercise `/storefront/setup` with a beauty/personal-care archetype selected.
- [x] Confirm text does not overflow in desktop and mobile widths.
- [x] Confirm the UI uses theme-aware colors and no nested cards.
- [x] Capture the exact URL, account, browser route, and observed result in the final implementation notes.

---

## Chunk 5: Hand-off to Edge Node binding (separate spec)

**Not a task in this plan.** Edge Node customer/site binding requires schema migration, route changes, and consent/authority design that is outside the applicability slice. After this plan ships, kick off a *new* writing-plans cycle for:

`docs/superpowers/specs/YYYY-MM-DD-edge-node-customer-site-binding-design.md`

Focused follow-on created:

- `docs/superpowers/specs/2026-05-22-edge-node-customer-site-binding-design.md`
- `docs/superpowers/plans/2026-05-22-edge-node-customer-site-binding-plan.md`

Inputs for that spec (recorded here so they aren't lost):

- Reference `EP-EDGE-NODE`, `EP-SITE-7C4D2B`, and `EP-CTRL-5E21A4`.
- Bootstrap token install intent for `customerAccountId` and optional `customerSiteId`.
- `resolveEdgeNodeAuth` exposing approved scope to discovery and telemetry routes.
- Schema additions on `EdgeNode`, `DiscoveryConnection`, and discovery run/customer mapping.
- Consent and authority boundaries for remote support.
- **Enforcement gap to close:** design §8 rule 3 says Edge Node enrollment must derive customer scope from the authority-issued bootstrap target, not from request-body customer IDs. The legacy untrusted path must be removed in that slice — flag explicitly in the follow-on spec.

Producing a new spec belongs in a writing-plans cycle, not in an executing-plans task list. Removing the create-a-spec checkbox from this plan keeps the plan executable end-to-end.

---

## Verification Gate

- [x] `pnpm --filter @dpf/storefront-templates test -- capability-registry applicability-rules activation-profile archetypes`
- [x] `pnpm --filter @dpf/finance-templates test -- profiles`
- [x] `pnpm --filter @dpf/db test -- seed-storefront-archetypes`
- [x] `pnpm --filter web test -- archetype-activation setup-profile scope-policy ArchetypeActivationSummary`
- [x] `pnpm --filter web typecheck`
- [x] `cd apps/web && pnpm exec next build`
- [x] Static grep for `archetypeId === "it-managed-services"` and similar string-id branches in `apps/web` returns no new matches. Existing matches outside this slice are listed in the PR description.
- [x] UX verification against the worktree production build for setup/admin changes. Root Docker portal served the root clone, so a temporary QA DB clone was used on `http://127.0.0.1:3108`; MSP and salon paths both exercised at 1440px and 390px.
- [x] No migrations in the first slice; if the follow-on Edge Node binding slice adds schema, run Prisma migrate dev and verify migration applies cleanly.

## Backlog Recommendation

Use existing active epics rather than creating a TeamLogic-only island. Live DPF MCP was checked on 2026-05-22 before implementation. The existing deferred Archetype Model V2 epic was the correct reusable home and was reopened as `EP-ARCH-8D4F2A`.

- Activation profile, capability registry, rules engine, and finance applicability → `EP-ARCH-8D4F2A`.
- Edge Node customer/site binding → `EP-EDGE-NODE`.
- Site/location binding → `EP-SITE-7C4D2B`.
- Remote support consent/isolation → `EP-CTRL-5E21A4`.
