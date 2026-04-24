# AI Provider Finance Bridge Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` when implementing this plan in a fresh session. Verify file existence and route behavior before reporting completion.

**Goal:** Make AI providers finance-owned suppliers with draft contracts, allowance tracking, daily evaluation, and dedicated finance visibility.

**Architecture:** Extend the existing finance AP domain instead of creating a parallel billing system. Seed finance ownership during provider setup, store plan posture in dedicated finance-bridge models, and surface the result in both provider configuration and finance spend workflows.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, existing provider actions, finance server actions, finance components, Vitest, Next production build.

---

## File Structure

### New files

- `apps/web/lib/finance/ai-provider-finance-validation.ts`
- `apps/web/lib/finance/ai-provider-finance.ts`
- `apps/web/lib/finance/ai-provider-finance-validation.test.ts`
- `apps/web/lib/finance/ai-provider-finance.test.ts`
- `apps/web/lib/actions/ai-provider-finance.ts`
- `apps/web/lib/actions/ai-provider-finance.test.ts`
- `apps/web/components/finance/AiSpendSummaryCard.tsx`
- `apps/web/components/finance/AiProviderFinancePanel.tsx`
- `apps/web/components/finance/AiSupplierFinancePanel.tsx`
- `apps/web/components/finance/AiSpendWorkspace.tsx`
- `apps/web/app/(shell)/finance/spend/ai/page.tsx`
- `packages/db/prisma/migrations/20260423193000_add_ai_provider_finance_bridge/migration.sql`
- `docs/user-guide/finance/ai-spend.md`

### Existing files modified

- `apps/web/lib/actions/ai-providers.ts`
- `apps/web/lib/actions/ai-providers.test.ts`
- `apps/web/components/finance/finance-nav.ts`
- `apps/web/components/finance/FinanceTabNav.test.tsx`
- `apps/web/app/(shell)/finance/spend/page.tsx`
- `apps/web/app/(shell)/finance/suppliers/[id]/page.tsx`
- `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx`
- `packages/db/prisma/schema.prisma`
- `tests/e2e/platform-qa-plan.md`
- `docs/user-guide/finance/index.md`
- `docs/user-guide/ai-workforce/index.md`
- `docs/user-guide/ai-workforce/connecting-providers.md`

## Chunk 1: Schema and Validation Foundation

### Task 1: Add finance-bridge schema and validation

- [ ] Add schema models:
  - `AiProviderFinanceProfile`
  - `SupplierContract`
  - `ContractAllowance`
  - `ContractUsageSnapshot`
  - `FinanceWorkItem`
- [ ] Add related enums for status, cadence, reconciliation strategy, valuation method, and snapshot confidence.
- [ ] Attach required relations to `ModelProvider`, `Supplier`, and `EmployeeProfile`.
- [ ] Add validation schemas for:
  - finance bridge seeding
  - contract activation
  - usage snapshot creation
  - finance work item creation
- [ ] Generate Prisma client.
- [ ] Verify the schema validates cleanly before proceeding.

## Chunk 2: Finance Service Layer

### Task 2: Build the AI provider finance service

- [ ] Create `apps/web/lib/finance/ai-provider-finance.ts`.
- [ ] Implement supplier ensure/create behavior from provider seed data.
- [ ] Implement finance bridge seeding:
  - upsert finance profile
  - create supplier contract
  - create plan-detail work item when needed
- [ ] Implement contract activation with allowance persistence.
- [ ] Implement daily allowance evaluation helpers.
- [ ] Implement usage snapshot persistence.
- [ ] Implement AI spend overview aggregation.
- [ ] Implement due-checked daily evaluation job wrapper.
- [ ] Implement draft AP bill generation for fixed commitments.

### Task 3: Add focused service tests

- [ ] Cover incomplete plan seeding.
- [ ] Cover allowance persistence on activation.
- [ ] Cover threshold evaluation behavior.
- [ ] Cover draft bill generation behavior.

## Chunk 3: Provider Setup Integration

### Task 4: Seed finance ownership from provider setup

- [ ] Extend `configureProvider()` so successful provider setup also seeds the finance bridge.
- [ ] Keep provider setup resilient:
  - finance seeding should not block technical configuration if it fails
- [ ] Do not require standalone finance permissions for this seed path.
- [ ] Add integration-style action tests for the provider setup hook.

## Chunk 4: Finance Actions and UI Surfaces

### Task 5: Add finance actions

- [ ] Create finance-guarded actions for:
  - seeding bridge manually
  - activating contracts
  - loading AI spend overview
  - loading provider finance detail
  - loading supplier finance detail

### Task 6: Extend Finance navigation and spend hub

- [ ] Add `AI Spend` to the spend-family sub-navigation.
- [ ] Add AI spend summary card to `/finance/spend`.
- [ ] Ensure the spend hub triggers the daily evaluation check opportunistically.
- [ ] Add navigation tests for the new sub-item.

### Task 7: Build the dedicated AI spend workspace

- [ ] Implement `/finance/spend/ai`.
- [ ] Load finance overview and profile rows from the real service/data layer.
- [ ] Show:
  - AI supplier count
  - committed spend
  - contracts needing setup
  - open work items
  - utilization table

### Task 8: Add provider and supplier bridge panels

- [ ] Render finance bridge context on `/platform/ai/providers/[providerId]`.
- [ ] Render AI supplier finance context on `/finance/suppliers/[id]`.
- [ ] Keep both panels additive and non-disruptive to the existing pages.

## Chunk 5: Documentation and QA

### Task 9: Restore design artifacts

- [ ] Save the AI provider finance bridge design in `docs/superpowers/specs/`.
- [ ] Save this implementation plan in `docs/superpowers/plans/`.
- [ ] Verify both files exist on disk before closing the session.

### Task 10: Update route and feature documentation

- [ ] Update Finance overview docs to mention AI provider supplier ownership and AI spend workspace.
- [ ] Update AI workforce overview docs to mention the Finance Bridge as part of provider operations.
- [ ] Update provider-connection docs with route-level guidance for:
  - provider detail finance bridge panel
  - `/finance/spend/ai`
  - supplier detail AI finance context
- [ ] Add a dedicated user guide page for `/finance/spend/ai`.

### Task 11: Update QA coverage

- [ ] Ensure QA plan includes:
  - provider setup with incomplete plan details
  - finance spend summary card
  - dedicated AI spend workspace
  - supplier detail AI finance context

## Verification

- [ ] `pnpm --filter @dpf/db generate`
- [ ] `pnpm --filter web test -- lib/finance/ai-provider-finance-validation.test.ts lib/finance/ai-provider-finance.test.ts lib/actions/ai-provider-finance.test.ts lib/actions/ai-providers.test.ts components/finance/FinanceTabNav.test.tsx`
- [ ] `pnpm --filter web typecheck`
- [ ] `cd apps/web && npx next build`
- [ ] Browser-level verification for:
  - `/platform/ai/providers/[providerId]`
  - `/finance/spend`
  - `/finance/spend/ai`
  - `/finance/suppliers/[id]`

## Known Follow-Ups

- provider-specific billing/usage API reconciliation
- governed coworker handoff from provider setup to finance coworker
- alert/messaging queue integration for finance work items
- broader forecasting and budget reporting built on top of the daily snapshots
