# QuickBooks Import Review And Entity Link Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `BI-4025EF5F`: a persisted, read-only QuickBooks import review queue with durable accounting entity-link posture.

**Architecture:** Extend the existing source-attributed staging descriptors into a small persisted review substrate. QuickBooks remains read-only and external-owned; DPF stores review metadata, proposed local links, fingerprints, and operator posture without storing raw provider payloads or introducing QuickBooks writes.

**Tech Stack:** Next.js 16 app router, TypeScript, Prisma 7, PostgreSQL, Vitest, existing DPF integration readiness and finance lane components.

---

## Tracking Spine

Live MCP backlog items created on 2026-05-22 under `EP-INT-2E7C1A`:

| Sequence | Item | Scope |
| --- | --- | --- |
| Next | `BI-4025EF5F` | Persist QuickBooks import review queue and accounting entity links. |
| Later | `BI-2DB52EAB` | Reconcile QuickBooks, Stripe, payments, fees, payouts, and deposits. |
| Later | `BI-47366954` | Decide bank-feed source of truth and reconciliation evidence posture. |
| Later | `BI-47F08F7A` | Map tax, VAT, and sales-tax posture without filing claims. |
| Later | `BI-4291195F` | Reports, close workflow, and accountant evidence packet. |
| Gate | `BI-B1F6D8ED` | Approval-gated write-back and DPF-primary promotion gates. |

`BI-C61B5202` and `BI-07D76D6B` are complete and are prerequisites, not active work.

## Execution Update — 2026-05-22

- `BI-4025EF5F` implemented as a provider-agnostic import review queue plus QuickBooks projection and readiness/accountant-lane posture.
- Prisma schema validation and client generation pass.
- Migration SQL was validated against disposable Postgres database `dpf_import_review_verify`; local `prisma migrate dev` was blocked by worktree database context before schema diagnostics, so the durable SQL migration was verified directly.
- UI verification was run against this branch with `next start` on `http://127.0.0.1:3107`; root Docker was serving a different checkout.

## Scope Guardrails

- Keep QuickBooks read-only. Do not add create, update, delete, sync-write, webhook mutation, or background write-back paths.
- Persist only review-safe metadata: provider, entity family, external ID, source timestamp, owner side, proposed local link, display fields, source fingerprint, and review state.
- Do not store raw QuickBooks provider payloads in the review queue.
- Staged source records remain non-editable. Operator actions may only affect review/link posture in later slices.
- Do not claim DPF replaces QuickBooks. The visible state is `import-ready` or `review`, not `dpf-primary`.
- Spend a bounded refactoring budget on existing staging/readiness seams while touching them: remove duplication, clarify naming, and keep descriptors reusable across future providers.

## Proposed Model Shape

Add the smallest durable persistence substrate:

```prisma
model IntegrationImportBatch {
  id                  String   @id @default(cuid())
  batchRef            String   @unique
  sourceProvider      String
  providerEnvironment String?
  sourceTimestamp     DateTime?
  status              String   @default("reviewing")
  createdById         String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  records IntegrationImportStagedRecord[]

  @@index([sourceProvider, status])
  @@index([createdAt])
}

model IntegrationImportStagedRecord {
  id                      String   @id @default(cuid())
  importBatchId           String
  sourceProvider          String
  entityFamily            String
  externalId              String
  sourceTimestamp         DateTime?
  ownerSide               String
  reviewStatus            String   @default("candidate")
  proposedLocalEntityType String
  proposedLocalId         String?
  proposedLocalStatus     String   @default("candidate")
  proposedLocalConfidence String   @default("low")
  proposedLocalReason     String
  displayFields           Json
  sourceFingerprint       String
  readOnly                Boolean  @default(true)
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  batch IntegrationImportBatch @relation(fields: [importBatchId], references: [id], onDelete: Cascade)

  @@unique([importBatchId, entityFamily, externalId])
  @@index([sourceProvider, entityFamily, externalId])
  @@index([reviewStatus])
}
```

If implementation discovers an existing import batch model with the same responsibility, reuse it instead of adding these models.

## File Map

- Modify: `packages/db/prisma/schema.prisma`
  - Add the two import review models only if no existing model owns this responsibility.
- Create: `packages/db/prisma/migrations/<timestamp>_quickbooks_import_review_queue/migration.sql`
  - Add the tables, indexes, and unique constraints.
- Modify: `apps/web/lib/integrate/import-staging.ts`
  - Keep descriptor contracts stable; add only shared review-safe types if needed.
- Create: `apps/web/lib/integrate/import-review.ts`
  - Own provider-agnostic review queue types, source fingerprinting, validation, and batch normalization.
- Create: `apps/web/lib/integrate/import-review.test.ts`
  - Test read-only invariants, fingerprint stability, and raw payload exclusion.
- Create: `apps/web/lib/integrate/import-review-store.ts`
  - Own Prisma-compatible persistence for review batches.
- Create: `apps/web/lib/integrate/import-review-store.test.ts`
  - Test idempotent batch upsert and read-only record persistence shape.
- Create: `apps/web/lib/integrate/quickbooks/import-review.ts`
  - Convert QuickBooks staged records into import review batch entries.
- Create: `apps/web/lib/integrate/quickbooks/import-review.test.ts`
  - Test all nine QuickBooks families map to persisted review records with external ownership.
- Modify: `apps/web/lib/integrate/quickbooks/readiness.ts`
  - Surface import-review posture in the descriptor without changing write boundaries.
- Modify: `apps/web/components/integrations/IntegrationReadinessPanel.tsx`
  - Render review-queue posture in the QuickBooks readiness page.
- Modify: `apps/web/components/integrations/IntegrationReadinessPanel.test.tsx`
  - Assert non-editable import review state and no write action copy.
- Modify: `apps/web/lib/finance/accountant-work-lane.ts`
  - Point the next QuickBooks/Stripe/bank-feed workflow at `BI-4025EF5F` where appropriate.
- Modify: `apps/web/components/finance/AccountantWorkLanePanel.test.tsx`
  - Assert the accountant lane names the new item and preserves the promotion guardrail.

## Chunk 1: Review Contract And Tests

### Task 1: Provider-Agnostic Review Types

**Files:**
- Create: `apps/web/lib/integrate/import-review.test.ts`
- Create: `apps/web/lib/integrate/import-review.ts`

- [x] **Step 1: Write failing tests for review-safe normalization**

Test cases:
- A staged record becomes a review record with `reviewStatus: "candidate"`.
- `readOnly` remains `true`.
- The source fingerprint is stable for the same provider/family/external timestamp/display fields.
- Raw provider payload fields are not accepted or emitted.

Run:

```powershell
pnpm --filter web test -- lib/integrate/import-review.test.ts
```

Expected: fail because `import-review.ts` does not exist.

- [x] **Step 2: Implement minimal provider-agnostic review helpers**

Create types and helpers:
- `IntegrationImportReviewStatus`
- `IntegrationImportReviewRecord`
- `IntegrationImportReviewBatch`
- `buildIntegrationImportReviewBatch()`
- `fingerprintImportStagingRecord()`

- [x] **Step 3: Verify tests pass**

Run:

```powershell
pnpm --filter web test -- lib/integrate/import-review.test.ts
```

Expected: pass.

## Chunk 2: QuickBooks Review Projection

### Task 2: QuickBooks Review Mapper

**Files:**
- Create: `apps/web/lib/integrate/quickbooks/import-review.test.ts`
- Create: `apps/web/lib/integrate/quickbooks/import-review.ts`
- Modify: `apps/web/lib/integrate/quickbooks/import-staging.ts`

- [x] **Step 1: Write failing tests for all nine QuickBooks families**

Assert company, customers, invoices, vendors, bills, expenses, payments, accounts, and reports become review records with:
- `sourceProvider: "quickbooks"`
- `ownerSide: "external"`
- `reviewStatus: "candidate"`
- non-null `externalId`
- non-null `sourceFingerprint`
- `readOnly: true`

Run:

```powershell
pnpm --filter web test -- lib/integrate/quickbooks/import-review.test.ts
```

Expected: fail because the mapper does not exist.

- [x] **Step 2: Implement QuickBooks mapper**

Add `buildQuickBooksImportReviewBatch()` and keep it composed from the existing `stageQuickBooksCoreAccountingRecords()` output. Do not duplicate family definitions.

- [x] **Step 3: Apply bounded refactor**

While touching the mapper, extract any duplicated family lookup or display-field formatting only if it makes the staging and review path easier to read. Do not change public descriptor behavior.

- [x] **Step 4: Verify QuickBooks staging and review tests**

Run:

```powershell
pnpm --filter web test -- lib/integrate/quickbooks/import-staging.test.ts lib/integrate/quickbooks/import-review.test.ts
```

Expected: pass.

## Chunk 3: Persistence

### Task 3: Prisma Models, Migration, And Store

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_quickbooks_import_review_queue/migration.sql`
- Create: `apps/web/lib/integrate/import-review-store.test.ts`
- Create: `apps/web/lib/integrate/import-review-store.ts`

- [x] **Step 1: Audit existing models one more time**

Run:

```powershell
rg -n "ImportBatch|ImportStaged|IntegrationImport|sourceProvider|externalId|erpRefId" packages/db/prisma/schema.prisma
```

Expected: no existing durable model owns import review queue responsibility.

- [x] **Step 2: Add migration SQL and validate it**

Run:

```powershell
pnpm --filter @dpf/db exec prisma validate
Get-Content -Raw 'packages/db/prisma/migrations/20260522170000_quickbooks_import_review_queue/migration.sql' | docker exec -i dpf-dev-postgres-1 psql -U dpf -d dpf_import_review_verify -v ON_ERROR_STOP=1
```

Expected: schema validates and migration SQL applies cleanly in a disposable database.

- [x] **Step 3: Validate generated schema**

Run:

```powershell
pnpm --filter @dpf/db exec prisma validate
```

Expected: pass.

- [x] **Step 4: Add persistence adapter test first**

Run:

```powershell
pnpm --filter web test -- lib/integrate/import-review-store.test.ts
```

Expected: fail until `import-review-store.ts` exists.

- [x] **Step 5: Implement idempotent batch upsert adapter**

Use `IntegrationImportBatch.batchRef` as the stable upsert key. Replace records inside that batch on rerun and preserve `readOnly: true`.

- [x] **Step 6: Verify persistence adapter test passes**

Run:

```powershell
pnpm --filter web test -- lib/integrate/import-review-store.test.ts
```

Expected: pass.

## Chunk 4: UI And Accountant Lane

### Task 4: Readiness Surface And Lane Handoff

**Files:**
- Modify: `apps/web/lib/integrate/quickbooks/readiness.ts`
- Modify: `apps/web/components/integrations/IntegrationReadinessPanel.tsx`
- Modify: `apps/web/components/integrations/IntegrationReadinessPanel.test.tsx`
- Modify: `apps/web/lib/finance/accountant-work-lane.ts`
- Modify: `apps/web/components/finance/AccountantWorkLanePanel.test.tsx`

- [x] **Step 1: Write failing UI tests**

Assert the QuickBooks readiness panel shows:
- import review queue posture
- non-editable/source-attributed language
- `BI-4025EF5F` as the next workflow
- no create/update/write/sync action language

Run:

```powershell
pnpm --filter web test -- components/integrations/IntegrationReadinessPanel.test.tsx components/finance/AccountantWorkLanePanel.test.tsx
```

Expected: fail until UI and lane copy are updated.

- [x] **Step 2: Update UI using theme-aware styling**

Use `var(--dpf-*)` tokens only. Keep cards shallow, table layout stable, and labels compact enough for mobile and desktop.

- [x] **Step 3: Verify UI tests**

Run:

```powershell
pnpm --filter web test -- components/integrations/IntegrationReadinessPanel.test.tsx components/finance/AccountantWorkLanePanel.test.tsx
```

Expected: pass.

## Chunk 5: Verification And Evidence

### Task 5: Build Gate

**Files:**
- Modify only as required by fixes found in verification.

- [x] **Step 1: Run affected tests**

Run:

```powershell
pnpm --filter web test -- lib/integrate/import-review.test.ts lib/integrate/quickbooks/import-staging.test.ts lib/integrate/quickbooks/import-review.test.ts lib/integrate/quickbooks/readiness.test.ts components/integrations/IntegrationReadinessPanel.test.tsx lib/finance/accountant-work-lane.test.ts components/finance/AccountantWorkLanePanel.test.tsx
```

Expected: pass.

- [x] **Step 2: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: pass.

- [x] **Step 3: Run production build**

Run:

```powershell
cd apps/web
pnpm exec next build
```

Expected: pass.

- [x] **Step 4: Verify production UI path**

Use the Docker-served portal when it serves this checkout. For this manual worktree, verify a branch-local production server instead. Verify `/platform/tools/integrations/quickbooks` and `/finance` show import-review posture, preserve read-only language, and expose no write-back action.

- [x] **Step 5: Record MCP evidence and update status**

Use `record_execution_evidence` on `BI-4025EF5F`, then mark it done only after tests, typecheck, build, and UX verification pass.

## Out Of Scope

- QuickBooks writes.
- Payment execution.
- Bank-feed provider implementation.
- Tax filing authority.
- Ledger/journal ownership.
- DPF-primary promotion.
- Raw QuickBooks payload storage.
