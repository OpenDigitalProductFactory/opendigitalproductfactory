# Onboarding Source System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture "what are you switching from?" during onboarding as `BusinessContext.sourceSystem`.

**Architecture:** Store the answer on the existing `BusinessContext` record because it is first-party organization context gathered in the same setup flow as description, target market, and operating facts. The existing business-context setup API remains the single write path, and the existing `BusinessContextForm` renders one optional text field without adding a new onboarding model.

**Tech Stack:** Next.js 16, React, Vitest, Prisma 7, PostgreSQL.

---

## Chunk 1: Source-System Capture

### Task 1: Add tests for the new field

**Files:**
- Modify: `apps/web/app/api/business-context/setup/route.test.ts`
- Add: `apps/web/components/admin/BusinessContextForm.test.tsx`
- Add: `packages/db/src/business-context-source-system-schema.test.ts`

- [ ] **Step 1: Write failing API tests**

Assert that POST `/api/business-context/setup` includes `sourceSystem` in both `create` and `update` when the payload provides it, and omits it when absent.

- [ ] **Step 2: Write failing form render test**

Render `BusinessContextForm` with `sourceSystem: ""`; assert the UI includes the optional "What system or process are you switching from?" prompt and a controlled input initialized from the field.

- [ ] **Step 3: Write failing schema/migration test**

Read `packages/db/prisma/schema.prisma` and the migration directory; assert `BusinessContext` declares `sourceSystem String?` and a migration adds the column.

### Task 2: Implement persistence and UI

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/20260717033000_add_business_context_source_system/migration.sql`
- Modify: `apps/web/app/api/business-context/setup/route.ts`
- Modify: `apps/web/app/(shell)/storefront/settings/business/page.tsx`
- Modify: `apps/web/components/admin/BusinessContextForm.tsx`

- [ ] **Step 1: Add nullable schema column**

Add `sourceSystem String?` to `BusinessContext` near the other business-model context fields.

- [ ] **Step 2: Add migration**

Add SQL:

```sql
ALTER TABLE "BusinessContext" ADD COLUMN "sourceSystem" TEXT;
```

- [ ] **Step 3: Wire API payload**

Accept optional `sourceSystem?: string`, write it on create, and write it on update only when present.

- [ ] **Step 4: Wire page initial state**

Initialize `sourceSystem` from `businessContext?.sourceSystem ?? ""`.

- [ ] **Step 5: Render optional prompt**

Add a text input after "Who do you serve?" with concise helper copy explaining it helps import and migration decisions.

### Task 3: Verify and ship

- [ ] Run targeted tests:

```powershell
pnpm --filter web exec vitest run apps/web/app/api/business-context/setup/route.test.ts apps/web/components/admin/BusinessContextForm.test.tsx
pnpm --filter @dpf/db exec vitest run packages/db/src/business-context-source-system-schema.test.ts
```

- [ ] Run source checks:

```powershell
pnpm --filter web typecheck
git diff --check
```

- [ ] Commit with DCO sign-off, push, open a ready PR, record evidence, and mark `BI-9EFD3C3D` done after the branch is published.
