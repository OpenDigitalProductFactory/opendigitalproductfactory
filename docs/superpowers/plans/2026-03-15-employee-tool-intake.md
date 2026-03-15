# Employee Tool Intake — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the employee software registration intake slice that creates per-company inventory and finance placeholder metadata for core productivity tools, while consuming upload-derived artifacts once `EP-UPLOAD-001` completes.

**Architecture:** Add a small intake domain (`tool-intake`) with a staging model (`ToolIntakeDraft`) plus source/run metadata, then wire it through existing inventory and product application pathways (`InventoryEntity`, `DigitalProduct`), and extend workspace cards with role-aware entry actions.

**Tech Stack:** TypeScript, Prisma, Next.js 14 App Router, Vitest.

**Spec:** `docs/superpowers/specs/2026-03-15-employee-tool-intake-design.md`

**Dependency:** This plan assumes `EP-UPLOAD-001` has delivered a reliable upload event/attachment contract before enabling the batch upload ingestion mode.

---

## File Map

### New Files

- `apps/web/lib/tool-intake-types.ts`
- `apps/web/lib/tool-intake-adapters.ts`
- `apps/web/lib/tool-intake-templates.ts`
- `apps/web/lib/actions/tool-intake.ts`
- `apps/web/lib/tool-intake.test.ts`
- `apps/web/components/employee/ToolIntakeDashboard.tsx`
- `apps/web/components/employee/ToolIntakeUploadBridge.tsx`
- `packages/db/prisma/migrations/20260315_tool_intake_models/migration.sql`

### Modified Files

- `packages/db/prisma/schema.prisma`
- `apps/web/lib/inventory-data.ts`
- `apps/web/lib/actions/inventory.ts`
- `apps/web/app/(shell)/employee/page.tsx`
- `apps/web/app/(shell)/platform/page.tsx`
- `docs/superpowers/specs/2026-03-15-employee-tool-intake-design.md`

---

## Chunk 1: Model foundation

### Task 1: Add Tool Intake Prisma models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260315_tool_intake_models/migration.sql`

- [ ] **Step 1: Add ToolIntakeSource model**

Add:

```prisma
model ToolIntakeSource {
  id            String   @id @default(cuid())
  slug          String   @unique
  provider      String
  mode          String
  enabled       Boolean  @default(true)
  companyScope  String?
  environment   String?
  syncSchedule  String?
  calendarRef   String?
  lastRunAt     DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

- [ ] **Step 2: Add ToolIntakeRun model**

Add model with `sourceId`, `status`, `summary`, `startedAt`, `completedAt`, and `runRef`.

- [ ] **Step 3: Add ToolIntakeDraft model**

Add staging model with `state` enum values: `new`, `review_required`, `approved`, `rejected`, `applied`, `archived`, plus JSON candidate and finance hint fields.

- [ ] **Step 4: Add ToolInstanceFinanceMetadata model**

Add finance placeholder table with fields for environment, license model, seat count, renewal cadence/date, monthly run rate, and cost references.

- [ ] **Step 5: Create migration and verify schema parse**

```bash
cd d:/OpenDigitalProductFactory && pnpm --filter db generate -- --name tool-intake-models
```

Expected: Migration generated and `pnpm --filter db format` succeeds.

---

## Chunk 2: Upload bridge (unblocked when EP-UPLOAD-001 is available)

### Task 2: Consume upload events into intake drafts

**Files:**
- Create: `apps/web/lib/tool-intake-adapters.ts`
- Create: `apps/web/lib/tool-intake-templates.ts`
- Create: `apps/web/lib/actions/tool-intake.ts`
- Create: `apps/web/lib/tool-intake.test.ts`

- [ ] **Step 1: Define parser contract adapters**

Map `AgentAttachment` payload to draft candidates:

```ts
type UploadImportEvent = {
  attachmentId: string;
  threadId: string;
  parsedColumns: string[];
  sampleRows: string[][];
}
```

- [ ] **Step 2: Add adapter tests**

Test:
- required columns reject with review_required
- optional columns map into finance hints
- missing columns create deterministic `sourceRowRef` fingerprint

- [ ] **Step 3: Gate upload ingestion until EP-UPLOAD-001 complete**

`tool-intake.ts` should check a feature flag:

```ts
if (!hasUploadContract) return "blocked: upload_contract_missing";
```

When contract exists, process attachment events and create `ToolIntakeDraft` rows.

- [ ] **Step 4: Write a test for blocked state**

Add one test asserting blocked mode when contract is absent, and successful parse ingestion when contract metadata exists.

---

## Chunk 3: Manual intake + draft apply

### Task 3: Manual entry and apply flow

**Files:**
- Create: `apps/web/components/employee/ToolIntakeDashboard.tsx`
- Modify: `apps/web/lib/actions/tool-intake.ts`
- Modify: `apps/web/lib/inventory-data.ts`
- Modify: `apps/web/lib/actions/inventory.ts`

- [ ] **Step 1: Manual intake action test**

Create failing test for draft creation with:
- duplicate detection by `companyScope + vendor + product + version + sourceRef`
- conflict handling for changed payload
- finance metadata persistence

- [ ] **Step 2: Implement draft create/apply helpers**

Add `createToolIntakeDraft`, `listToolIntakeDrafts`, `applyToolIntakeDraft` helpers.

- [ ] **Step 3: Connect to inventory application**

`applyToolIntakeDraft` creates/updates:
- `InventoryEntity`
- `DigitalProduct`
- optional `ToolInstanceFinanceMetadata`

If candidate already exists with same fingerprint, return no-op and append audit note.

---

## Chunk 4: Workspace integration and role-aware actions

### Task 4: Show intake actions in the existing workspace shell

**Files:**
- Create: `apps/web/components/employee/ToolIntakeUploadBridge.tsx`
- Modify: `apps/web/app/(shell)/employee/page.tsx`
- Modify: `apps/web/app/(shell)/platform/page.tsx`

- [ ] **Step 1: Add card actions**

Add card-level actions for:
- request approval for finance context
- open tool instance inventory record
- set/update seat/license fields

- [ ] **Step 2: Keep one shell, role-aware render**

Same page for all roles; hide actions by capability and role (all roles see service tile, with role-filtered action set).

- [ ] **Step 3: Add smoke test for role visibility**

Test that users with `manage_products` can apply drafts, users without cannot.

---

## Chunk 5: Backlog / docs sync and status

### Task 5: Update backlog context for dependency-driven sequencing

**Files:**
- Modify: `docs/superpowers/specs/2026-03-15-employee-tool-intake-design.md`
- Modify: (if used) `scripts/update-intake-epic.sql` or existing backlog seed scripts

- [ ] **Step 1: Add explicit dependency note**

Keep spec and backlog artifact noting upload dependency and blocked status for batch mode.

- [ ] **Step 2: Add execution notes**

Update planning notes with:
- “Blocked step: batch ingest waits for EP-UPLOAD-001”
- “Manual mode is green for release planning”

- [ ] **Step 3: Run validation checks**

```bash
pnpm --filter web test -- apps/web/lib/tool-intake.test.ts
pnpm --filter web test -- apps/web/app/(shell)/employee/page.test.tsx
pnpm --filter db test --schema packages/db/prisma/schema.prisma
```

---

Plan complete and saved to `docs/superpowers/plans/2026-03-15-employee-tool-intake.md`.
Ready to execute?
