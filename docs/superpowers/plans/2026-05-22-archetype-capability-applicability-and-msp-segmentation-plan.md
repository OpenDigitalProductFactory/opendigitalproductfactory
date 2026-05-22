# Archetype Capability Applicability And MSP Segmentation Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` if subagents are explicitly authorized, otherwise use `superpowers:executing-plans`. Track every checkbox as work proceeds. For TypeScript work, run `pnpm --filter web typecheck` before committing and fix any errors. For UI work, follow AGENTS.md theme-aware styling rules: use DPF CSS variables, no hardcoded colors, and verify the affected route in the running app.

**Goal:** Turn archetypes into typed operating-model activators so the MSP archetype can require customer estate segmentation, Edge Node customer deployment, service agreements, and billing readiness without forcing those workflows onto archetypes such as salons that primarily use appointment checkout or point-of-sale payment.

**Architecture:** Preserve the current `activationProfile` JSON field and legacy `modules` shape, but introduce a normalized v2 runtime profile with capability applicability, scope policy, isolation, surfaces, and billing/payment patterns. Keep customer estate scoped inside one MSP organization for now, with a later path to true customer tenant boundaries if external customer portals require it.

**Refactoring allocation:** Reserve at least 20 percent of implementation time for shared contract cleanup and compatibility helpers. Do not implement MSP behavior as one-off `archetypeId === "it-managed-services"` checks in UI or server actions.

**Tech Stack:** Next.js App Router, TypeScript, Prisma 7, PostgreSQL, pnpm workspaces, vitest.

---

## File Structure

- Modify: `packages/storefront-templates/src/types.ts`
  Add v2 activation profile types, capability applicability enums, scope enums, isolation modes, and billing/payment pattern profile types.
- Create: `packages/storefront-templates/src/activation-profile.ts`
  Shared normalizer that converts legacy and v2 activation profiles into one runtime contract.
- Create: `packages/storefront-templates/src/activation-profile.test.ts`
  Unit tests for legacy MSP normalization, standard archetype defaults, invalid profile rejection, and billing pattern defaults.
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
- Modify: `docs/superpowers/specs/2026-04-23-it-service-provider-msp-archetype-design.md`
  Add a pointer to the new applicability spec as the canonical cross-archetype contract.

---

## Chunk 1: Shared Activation Contract

### Task 1: Add v2 activation profile types

**Files:**
- `packages/storefront-templates/src/types.ts`

- [ ] Add `CapabilityApplicability = "required" | "recommended" | "optional" | "hidden" | "not-applicable"`.
- [ ] Add `CapabilityScope = "organization" | "customer-account" | "customer-site" | "configuration-item" | "service-agreement" | "engagement" | "appointment" | "order" | "billing-period" | "edge-node"`.
- [ ] Add `CapabilityIsolation = "organization-scope" | "strict-customer-scope" | "shared"`.
- [ ] Add `PaymentPattern = "point-of-sale" | "appointment-checkout" | "ad-hoc-invoice" | "recurring-agreement" | "subscription" | "retainer" | "project-milestone" | "usage-based" | "donation" | "optional-package"`.
- [ ] Add `CapabilityActivation` and `BillingPatternProfile` interfaces.
- [ ] Extend `ActivationProfile` with optional `version`, `capabilities`, and `billingProfile`.
- [ ] Keep existing `modules`, `billingReadinessMode`, `customerGraph`, and `estateSeparation` fields required for backward compatibility in this slice.

### Task 2: Implement shared normalizer

**Files:**
- `packages/storefront-templates/src/activation-profile.ts`
- `packages/storefront-templates/src/activation-profile.test.ts`
- `packages/storefront-templates/src/index.ts`

- [ ] Write tests first for legacy MSP input normalizing into required v2 capabilities.
- [ ] Write tests for a standard/non-MSP profile defaulting to organization scope and non-recurring billing behavior.
- [ ] Write tests that invalid capability keys, scopes, and payment patterns are rejected.
- [ ] Implement `readActivationProfileV2(raw)` and `normalizeActivationProfile(raw)`.
- [ ] Implement `activationHasCapability(profile, capabilityKey)` and `getCapabilityApplicability(profile, capabilityKey)`.
- [ ] Export the new helpers from `packages/storefront-templates/src/index.ts`.
- [ ] Run `pnpm --filter @dpf/storefront-templates test -- activation-profile`.

### Task 3: Refactor web activation helper to shared normalizer

**Files:**
- `apps/web/lib/storefront/archetype-activation.ts`
- `apps/web/lib/storefront/archetype-activation.test.ts`

- [ ] Replace local validation sets with imports from `@dpf/storefront-templates`.
- [ ] Keep `readActivationProfile`, `isManagedServiceProviderProfile`, `deriveRevenueModelFromActivationProfile`, and `deriveCustomerConfigurationItemDefaults` exports stable.
- [ ] Add tests proving existing TAK, marketing, and customer-estate consumers still receive the legacy-compatible shape they expect.
- [ ] Run `pnpm --filter web test -- archetype-activation`.

---

## Chunk 2: Archetype Profiles And Finance Patterns

### Task 4: Extend MSP and beauty archetype definitions

**Files:**
- `packages/storefront-templates/src/archetypes/professional-services.ts`
- `packages/storefront-templates/src/archetypes/beauty-personal-care.ts`
- `packages/storefront-templates/src/archetypes/archetypes.test.ts`

- [ ] Add v2 `capabilities` to `it-managed-services`:
  - customer estate: required, strict customer scope
  - customer sites: required, strict customer scope
  - edge node customer deployment: required, strict customer scope
  - network inventory: required, strict customer scope
  - cybersecurity posture: required, strict customer scope
  - backup/restore posture: required, strict customer scope
  - service agreements: required, customer/service-agreement scope
  - billing readiness: required, billing-period scope
  - remote support: recommended, strict customer scope, consent-gated
- [ ] Add v2 `billingProfile` to `it-managed-services` with `primaryPaymentPattern: "recurring-agreement"`.
- [ ] Add v2 `billingProfile` to beauty/personal-care archetypes with `primaryPaymentPattern: "appointment-checkout"` and recurring optionality.
- [ ] Update tests so MSP required capabilities and beauty recurring optionality are explicit.
- [ ] Run `pnpm --filter @dpf/storefront-templates test -- archetypes`.

### Task 5: Replace finance boolean semantics with billing patterns

**Files:**
- `packages/finance-templates/src/types.ts`
- `packages/finance-templates/src/profiles.ts`
- `packages/finance-templates/src/profiles.test.ts`
- `apps/web/lib/finance/setup-profile.ts`
- `apps/web/lib/finance/setup-profile.test.ts`

- [ ] Add `billingPatternProfile` to `FinancialProfile`.
- [ ] Keep `recurringBillingEnabled` as a derived compatibility field for now.
- [ ] Set professional services to support recurring agreement, retainer, project milestone, and ad-hoc invoice.
- [ ] Set beauty/personal care to appointment checkout and point-of-sale as primary/supported patterns, with recurring optional for packages or memberships.
- [ ] Add a helper that derives `recurringBillingEnabled` from `billingPatternProfile.recurringBillingApplicability !== "not-applicable"` where existing callers still need it.
- [ ] Update finance setup to expose `primaryPaymentPattern`, `supportedPaymentPatterns`, and `recurringBillingApplicability`.
- [ ] Run `pnpm --filter @dpf/finance-templates test -- profiles`.
- [ ] Run `pnpm --filter web test -- setup-profile`.

---

## Chunk 3: Customer Estate Scope Guardrails

### Task 6: Add reusable customer-estate scope policy helper

**Files:**
- `apps/web/lib/customer-estate/scope-policy.ts`
- `apps/web/lib/customer-estate/scope-policy.test.ts`

- [ ] Write tests for strict MSP scope requiring `accountId`.
- [ ] Write tests for site-bound operations requiring both `accountId` and `siteId`.
- [ ] Write tests for standard/shared profile allowing organization-scoped operations when no customer estate capability is active.
- [ ] Implement `resolveCustomerEstateScopePolicy(profile)`.
- [ ] Implement `requireCustomerEstateScope(input, policy)`.
- [ ] Implement a guard return shape that server actions can use without throwing UI-hostile errors.
- [ ] Run `pnpm --filter web test -- scope-policy`.

### Task 7: Identify first call sites for scope policy adoption

**Files:**
- `apps/web/lib/customer-estate/account-estate-summary.ts`
- `apps/web/lib/customer-estate/lifecycle-evaluation.ts`
- `apps/web/components/customer/CustomerLifecycleReviewQueues.tsx`
- `apps/web/components/inventory/DiscoveryOperationsPage.tsx`

- [ ] Audit current loaders and components for implicit customer/site assumptions.
- [ ] Put any later-migration notes in the implementation PR description, not inline code.
- [ ] Adopt the helper only where it is required for the first slice and covered by tests.

---

## Chunk 4: Setup And Admin UI

### Task 8: Add activation summary component

**Files:**
- `apps/web/components/storefront-admin/ArchetypeActivationSummary.tsx`
- `apps/web/components/storefront-admin/ArchetypeActivationSummary.test.tsx`

- [ ] Build a compact summary using DPF theme variables only.
- [ ] Use icons for capability groups where an existing icon library is already used in nearby setup/admin components.
- [ ] Show required/recommended capability counts, primary payment pattern, and isolation mode.
- [ ] Avoid visible instructional copy about how the app works; use concise labels and status values.
- [ ] Add render tests for MSP and beauty/personal-care profiles.

### Task 9: Wire summary into setup flow

**Files:**
- `apps/web/components/storefront-admin/SetupWizard.tsx`
- `apps/web/components/storefront-admin/FinancialSetupStep.tsx`

- [ ] Show the activation summary after an archetype is selected.
- [ ] For MSP, surface customer estate, edge node, service agreements, backup/security posture, and billing readiness as required activation items.
- [ ] For beauty/personal care, show appointment checkout/point-of-sale and keep recurring packages optional.
- [ ] Update financial setup to read payment patterns from `resolveFinanceSetupProfile`.
- [ ] Verify no hardcoded colors are introduced.
- [ ] Run targeted component tests.

### Task 10: UX verification

**Files:**
- setup/admin routes affected by the implementation

- [ ] Start or use the production-path Docker-served portal according to AGENTS.md.
- [ ] Log in with `admin@dpf.local` and `ADMIN_PASSWORD` from repo-root `.env`.
- [ ] Exercise `/storefront/setup` with IT Managed Services selected.
- [ ] Exercise `/storefront/setup` with a beauty/personal-care archetype selected.
- [ ] Confirm text does not overflow in desktop and mobile widths.
- [ ] Confirm the UI uses theme-aware colors and no nested cards.
- [ ] Capture the exact URL, account, browser route, and observed result in the final implementation notes.

---

## Chunk 5: Edge Node Customer Binding Plan

### Task 11: Produce follow-on Edge Node customer binding mini-spec

**Files:**
- Create: `docs/superpowers/specs/YYYY-MM-DD-edge-node-customer-site-binding-design.md`

- [ ] Reference `EP-EDGE-NODE`, `EP-SITE-7C4D2B`, and `EP-CTRL-5E21A4`.
- [ ] Define bootstrap token install intent for `customerAccountId` and optional `customerSiteId`.
- [ ] Define how `resolveEdgeNodeAuth` exposes approved scope to discovery and telemetry routes.
- [ ] Define schema additions for `EdgeNode`, `DiscoveryConnection`, and discovery run/customer mapping.
- [ ] Define consent and authority boundaries for remote support as a dependency, not as part of this slice.

This is intentionally a follow-on spec, not part of the first applicability implementation. It requires schema and Edge Node route work and should land under its own branch.

---

## Verification Gate

- [ ] `pnpm --filter @dpf/storefront-templates test -- activation-profile archetypes`
- [ ] `pnpm --filter @dpf/finance-templates test -- profiles`
- [ ] `pnpm --filter web test -- archetype-activation setup-profile scope-policy ArchetypeActivationSummary`
- [ ] `pnpm --filter web typecheck`
- [ ] `cd apps/web && pnpm exec next build`
- [ ] UX verification against the Docker-served app for setup/admin changes
- [ ] No migrations in the first slice; if the follow-on Edge Node binding slice adds schema, run Prisma migrate dev and verify migration applies cleanly

## Backlog Recommendation

Use existing active epics rather than creating a TeamLogic-only island:

- Put activation profile and finance applicability work under a new or existing archetype/platform setup epic if one is active after the next live MCP check.
- Link Edge Node customer/site binding work to `EP-EDGE-NODE`.
- Link site/location binding work to `EP-SITE-7C4D2B`.
- Link remote support consent/isolation work to `EP-CTRL-5E21A4`.

If no active archetype/setup epic exists at implementation time, create one with a reusable title such as `Archetype Capability Applicability And Operating Profiles`, not `TeamLogic Customization`.
