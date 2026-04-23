# MSP Customer Estate Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first reusable customer-estate foundation for the MSP archetype: customer sites, customer configuration items, and a shared lifecycle evaluation contract that can also serve the internal platform estate.

**Architecture:** Keep customer estate records separate from the platform's internal `InventoryEntity` domain, but introduce a shared lifecycle evaluator so both domains can use the same support/lifecycle determination rules. Surface the new data first through customer-account summaries instead of attempting the full MSP workspace in one slice.

**Tech Stack:** Next.js App Router, TypeScript, Prisma 7, PostgreSQL, vitest.

---

## File Structure

- Create: `apps/web/lib/customer-estate/lifecycle-evaluation.ts`
  Shared lifecycle determination helpers for commercial, open-source, and hybrid technology.
- Create: `apps/web/lib/customer-estate/lifecycle-evaluation.test.ts`
  Unit tests for lifecycle status, support determination, and licensing review rules.
- Create: `apps/web/lib/customer-estate/account-estate-summary.ts`
  Summary loader for customer account estate counts and lifecycle attention.
- Create: `apps/web/lib/customer-estate/account-estate-summary.test.ts`
  Unit tests for the summary loader.
- Modify: `packages/db/prisma/schema.prisma`
  Add `CustomerSite` and `CustomerConfigurationItem`.
- Create: `packages/db/prisma/migrations/20260423xxxxxx_add_customer_estate_foundation/migration.sql`
  Additive migration for the new customer-estate tables.
- Modify: `apps/web/app/(shell)/customer/[id]/page.tsx`
  Surface sites, managed CI counts, lifecycle attention, and recurring licensed items.
- Modify: `docs/superpowers/specs/2026-04-23-it-service-provider-msp-archetype-design.md`
  Capture the approved shared lifecycle authority and licensing direction.

## Chunk 1: Shared Lifecycle Authority

### Task 1: Add lifecycle evaluation contract

**Files:**
- Create: `apps/web/lib/customer-estate/lifecycle-evaluation.test.ts`
- Create: `apps/web/lib/customer-estate/lifecycle-evaluation.ts`

- [ ] **Step 1: Write failing tests for commercial, open-source, and renewal cases**
- [ ] **Step 2: Run the tests to confirm they fail**
- [ ] **Step 3: Implement the lifecycle evaluator**
- [ ] **Step 4: Run the tests to confirm they pass**

## Chunk 2: Customer Estate Schema

### Task 2: Add customer site and configuration item models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260423xxxxxx_add_customer_estate_foundation/migration.sql`

- [ ] **Step 1: Additive schema change for sites and customer CIs**
- [ ] **Step 2: Generate and inspect migration**
- [ ] **Step 3: Apply migration locally**

## Chunk 3: Customer Account Summary

### Task 3: Surface customer estate attention on the account page

**Files:**
- Create: `apps/web/lib/customer-estate/account-estate-summary.test.ts`
- Create: `apps/web/lib/customer-estate/account-estate-summary.ts`
- Modify: `apps/web/app/(shell)/customer/[id]/page.tsx`

- [ ] **Step 1: Write failing summary tests**
- [ ] **Step 2: Implement summary loader**
- [ ] **Step 3: Add customer estate section to the account page**
- [ ] **Step 4: Verify the targeted tests pass**

## Chunk 4: Verification Gate

### Task 4: Verify the slice

- [ ] **Step 1: Run targeted vitest coverage**
- [ ] **Step 2: Run `cd apps/web && npx next build`**
- [ ] **Step 3: Commit only the MSP customer-estate foundation files**
