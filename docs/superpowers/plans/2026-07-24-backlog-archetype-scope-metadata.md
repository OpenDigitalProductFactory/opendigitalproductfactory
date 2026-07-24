# Backlog Archetype Scope Metadata Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make backlog and epic planning explicitly filterable by platform/common/archetype scope so vertical roadmapping and investment budgeting do not rely on title/body inference.

**Architecture:** Add nullable scope metadata directly to `BacklogItem` and `Epic`, using canonical enums/types in the shared backlog library and MCP schemas. Keep the first slice pragmatic: store category/leaf arrays and lifecycle tags as `String[]`, expose them through MCP create/update/read/list/query and the backlog workbook grid, and backfill nothing destructively.

**Tech Stack:** Prisma 7, PostgreSQL text arrays, Next.js/TypeScript, Vitest, MCP tool packs.

---

### Task 1: Canonical Scope Contract

**Files:**
- Modify: `apps/web/lib/explore/backlog.ts`
- Modify: `apps/web/lib/backlog-enums.test.ts`

- [ ] **Step 1: Write failing enum parity tests**

Add tests asserting `create_backlog_item`, `update_backlog_item`, `list_backlog_items`, `query_backlog`, `create_epic`, and `update_epic` expose the same `scopeKind` enum as the shared backlog library.

- [ ] **Step 2: Run red test**

Run: `pnpm --filter web exec vitest run apps/web/lib/backlog-enums.test.ts`

Expected: FAIL because `BACKLOG_SCOPE_KIND_VALUES` and the MCP schema fields do not exist.

- [ ] **Step 3: Add canonical enum/type**

Add `BACKLOG_SCOPE_KIND_VALUES = ["platform", "common", "archetype-category", "archetype-leaf", "multi-archetype", "unknown"] as const` and related `BacklogScopeKind` type.

- [ ] **Step 4: Thread schema enum into MCP definitions**

Use the shared enum for all scope-capable tool schema fields.

### Task 2: Persistence

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Add: `packages/db/prisma/migrations/20260724120000_add_backlog_archetype_scope/migration.sql`

- [ ] **Step 1: Add nullable fields**

Add to both `BacklogItem` and `Epic`:

```prisma
scopeKind           String?
archetypeCategories String[] @default([])
archetypeIds        String[] @default([])
scopeRationale      String?
lifecycleTags       String[] @default([])
```

- [ ] **Step 2: Add indexes**

Add indexes for `scopeKind`, `archetypeCategories`, `archetypeIds`, and `lifecycleTags` appropriate for Postgres array filtering.

- [ ] **Step 3: Add additive migration**

Use `ALTER TABLE ... ADD COLUMN` with defaults for arrays. No data tightening; no existing row can violate nullable/additive columns.

### Task 3: MCP Create/Update/Read

**Files:**
- Modify: `apps/web/lib/mcp/packs/backlog-pack.ts`
- Modify: `apps/web/lib/operate/backlog-ingest.ts`
- Modify: `apps/web/lib/backlog/mcp-epic-tools.ts`
- Modify: `apps/web/lib/mcp/packs/backlog-pack.test.ts`

- [ ] **Step 1: Write failing handler tests**

Verify create/read/list flows preserve:

```ts
scopeKind: "archetype-category",
archetypeCategories: ["fabric-care-services"],
archetypeIds: ["dry-cleaning-plant-network"],
scopeRationale: "Fabric-care vertical gap",
lifecycleTags: ["claim-ticket", "ready-promise"]
```

- [ ] **Step 2: Run red test**

Run: `pnpm --filter web exec vitest run apps/web/lib/mcp/packs/backlog-pack.test.ts`

Expected: FAIL because fields are not written, selected, or returned.

- [ ] **Step 3: Implement minimal write/read support**

Normalize string arrays, accept only known `scopeKind` values, pass metadata through backlog ingest and epic tools, and include metadata in `query_backlog`, `list_backlog_items`, `get_backlog_item`, and `list_epics`.

### Task 4: Roadmap/Budget Editing Surface

**Files:**
- Modify: `apps/web/lib/workbooks/backlog-adapter-mapping.ts`
- Add/modify tests near workbook mapping

- [ ] **Step 1: Write failing grid mapping tests**

Backlog grid rows should expose scope columns and `buildBacklogPatch` should produce scope metadata patches.

- [ ] **Step 2: Implement grid columns and patch mapping**

Add editable `scopeKind`, `archetypeCategories`, `archetypeIds`, `lifecycleTags`, and `scopeRationale` columns.

### Task 5: Documentation and Verification

**Files:**
- Modify: `docs/architecture/archetype-business-value-streams.md` or planning docs as needed
- Modify: `docs/testing/archetype-audit-plan.md` only if audit expectations change

- [ ] **Step 1: Add docs impact note**

Document the new scope fields and how they support roadmapping/budgeting.

- [ ] **Step 2: Run focused verification**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/backlog-enums.test.ts apps/web/lib/mcp/packs/backlog-pack.test.ts apps/web/lib/workbooks/backlog-adapter-mapping.test.ts
node scripts\check-doc-links.mjs
git diff --check
```

- [ ] **Step 3: Run broader gate when ready**

Use the shared local-CI gate before claiming the branch is ready.
