# Coworker Service Offer Catalog Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first governed slice of the DPF Coworker Service Catalog, Offer Catalog, and engagement interface.

**Architecture:** Add a small catalog layer over the existing coworker substrate: provider capabilities (`CoworkerService`), consumable packages (`CoworkerOffer`), and actual demand (`CoworkerEngagement`). Keep projection, MCP handlers, and UI as thin layers over shared service functions.

**Tech Stack:** Next.js 16 app router, Prisma 7, pnpm workspaces, Vitest, React Testing Library, DPF MCP tool surface.

---

## Chunk 1: Schema and Types

### Task 1: Add catalog type guards

**Files:**
- Create: `apps/web/lib/coworker-service-catalog/types.ts`
- Test: `apps/web/lib/coworker-service-catalog/types.test.ts`

- [ ] **Step 1: Write failing tests** for status, risk, authority, availability, and engagement status guards.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run apps/web/lib/coworker-service-catalog/types.test.ts`
- [ ] **Step 3: Implement type arrays, unions, and guards.**
- [ ] **Step 4: Re-run the targeted test.**

### Task 2: Add Prisma schema models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create migration: `packages/db/prisma/migrations/<timestamp>_coworker_service_offer_catalog/migration.sql`

- [ ] **Step 1: Add model-boundary tests that reference expected Prisma delegates in service tests.**
- [ ] **Step 2: Add `CoworkerService`, `CoworkerOffer`, and `CoworkerEngagement` schema models with stable business IDs.**
- [ ] **Step 3: Generate migration with `pnpm --filter @dpf/db exec prisma migrate dev --name coworker_service_offer_catalog` if local DB is available; otherwise hand-author SQL and report migration apply as unrun until canonical runtime.**

## Chunk 2: Projection and Engagement Service

### Task 3: Implement catalog projection

**Files:**
- Create: `apps/web/lib/coworker-service-catalog/catalog.ts`
- Test: `apps/web/lib/coworker-service-catalog/catalog.test.ts`

- [ ] **Step 1: Write failing tests** for service/offer boundary projection, skill/tool/grant enrichment, legal coworker visibility, and filtering.
- [ ] **Step 2: Run the test and verify RED.**
- [ ] **Step 3: Implement projection and filters.**
- [ ] **Step 4: Re-run and verify GREEN.**

### Task 4: Implement engagement creation

**Files:**
- Create: `apps/web/lib/coworker-service-catalog/engagements.ts`
- Test: `apps/web/lib/coworker-service-catalog/engagements.test.ts`

- [ ] **Step 1: Write failing tests** for normal request, high-risk approval status, external-provider terms requirement, and Work Capsule non-creation by default.
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Implement engagement creation.**
- [ ] **Step 4: Run GREEN.**

## Chunk 3: MCP Surface

### Task 5: Add tool definitions and grant mappings

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/tak/agent-grants.ts`
- Test: `apps/web/lib/mcp-tools-coworker-service-catalog.test.ts`

- [ ] **Step 1: Write failing tests** proving the four tools exist and have grant mappings.
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Add tool definitions and execute handlers as thin wrappers.**
- [ ] **Step 4: Add `coworker_catalog_read` and `coworker_engagement_write` mappings.**
- [ ] **Step 5: Run GREEN.**

## Chunk 4: UI Route

### Task 6: Add AI Workforce catalog UI

**Files:**
- Modify: `apps/web/lib/navigation/portal-navigation-model.ts`
- Create: `apps/web/app/(shell)/platform/ai/catalog/page.tsx`
- Create: `apps/web/components/platform/coworker-service-catalog/CoworkerCatalogView.tsx`
- Test: `apps/web/app/(shell)/platform/ai/catalog/page.test.tsx`
- Test: `apps/web/components/platform/coworker-service-catalog/CoworkerCatalogView.test.tsx`

- [ ] **Step 1: Write failing page/component tests** for Legal Operations Counsel visibility and dense service/offer/engagement separation.
- [ ] **Step 2: Run RED.**
- [ ] **Step 3: Implement route and components with theme-aware styling.**
- [ ] **Step 4: Run GREEN.**

## Chunk 5: Verification

### Task 7: Run gates

**Files:**
- All touched files.

- [ ] **Step 1: Run targeted Vitest suite for catalog files.**
- [ ] **Step 2: Run `pnpm --filter web build`.**
- [ ] **Step 3: Claim `local-integration-ci` lease before runtime/UX verification.**
- [ ] **Step 4: Exercise `/platform/ai/catalog` on the running portal and capture evidence.**
- [ ] **Step 5: Record any blocked gate honestly; do not treat unrun gates as passed.**

