# Phase 3 Implementation Brief — Audit Refinement

**Design spec:** `docs/superpowers/specs/2026-04-12-unified-capability-and-integration-lifecycle-design.md` (Sections 8, 8.3, 8.4, 9.1.C, 12 Phase 3, 15)
**Date:** 2026-04-12
**Phase:** 3 of 4
**Depends on:** Phase 1 Workstream B (`AUDIT_CLASSES` enum in `apps/web/lib/audit-classes.ts`). Phase 2 is NOT a hard dependency — Phase 3 may begin once Phase 1 lands. Phase 2's `sync-capabilities.ts` and the enriched `PlatformCapability.manifest.auditClass` field are useful for Workstream C (backfill) but are not required to start Workstreams A and B.
**Unblocks:** Phase 4 (MCP resources/prompts — benefits from reduced audit noise before adding new event types)
**Parallelism:** Workstreams A and B are fully independent and can run concurrently. Workstream C (backfill) depends on Workstream A landing first. Workstream D (UI split) depends on Workstream A and on the existing Audit & Operations nav structure from Phase 1.

---

## What this phase delivers

1. **`auditClass` and `capabilityId` columns on `ToolExecution`** — additive schema change; new writes begin stamping class immediately
2. **`capabilityId` backfill** — populate from `toolName` using `platform:toolName` convention; MCP tools use `mcp:serverSlug__toolName`
3. **Selective payload retention for `metrics_only`** — suppress full parameter/result JSON storage on new writes when `auditClass = "metrics_only"`; store a summary string instead
4. **Probe chatter aggregation** — detect repeated read-only cycles within a single thread and collapse them into a count row rather than N identical rows
5. **Audit UI split** — add a Capability Journal tab and an Operational Metrics tab to the Audit & Operations section; the Authority page's Tool Execution Log section moves to Capability Journal; aggregate metrics surface in Operational Metrics

These workstreams share one migration. The UI workstream is the largest piece.

---

## Read before implementing

These files define the existing patterns you must follow:

1. `apps/web/lib/audit-classes.ts` — the `AUDIT_CLASSES` constant and `AuditClass` type defined in Phase 1. Import this type everywhere; do not redefine it inline.
2. `packages/db/prisma/schema.prisma` — the `ToolExecution` model. Confirm the exact current columns before writing the migration. The model currently has: `id`, `threadId`, `agentId`, `userId`, `toolName`, `parameters`, `result`, `success`, `executionMode`, `routeContext`, `durationMs`, `createdAt`.
3. `apps/web/lib/tak/agentic-loop.ts` — the single write path: `prisma.toolExecution.create(...)`. This is the only place `ToolExecution` rows are written. All Phase 3 enrichment logic goes here.
4. `apps/web/lib/tool-execution-data.ts` — `ToolExecutionRow` type and the query functions (`getToolExecutions`, `getToolExecutionStats`). Both must be extended to surface `auditClass` and `capabilityId` to callers.
5. `apps/web/app/(shell)/platform/audit/authority/page.tsx` — the Tool Execution Log section. This section moves to the new Capability Journal page. The Authority page retains only the three authority panels (Authority Matrix, Delegation Chain, Effective Permissions Inspector).
6. `apps/web/components/platform/ToolExecutionLogClient.tsx` — the existing tool execution log UI component. Capability Journal reuses and extends this component pattern with an `auditClass` filter column.
7. `apps/web/components/platform/AuditTabNav.tsx` — current four-tab nav. Phase 3 adds two tabs: `Capability Journal` and `Operational Metrics`.
8. `apps/web/app/(shell)/platform/audit/layout.tsx` — renders `AuditTabNav`. No changes needed to the layout itself.
9. `packages/db/src/sync-capabilities.ts` — `deriveAuditClass()`. The same derivation logic used for `PlatformCapability.manifest.auditClass` must be replicated (or imported from a shared location) in the write path to stamp `ToolExecution.auditClass` at execution time.
10. `apps/web/lib/mcp-tools.ts` — `ToolDefinition` type and `PLATFORM_TOOLS` array. Inspect the `sideEffect` and `requiresExternalAccess` fields. Phase 3 adds an optional `auditClass` override field to `ToolDefinition` so explicit overrides can be set without requiring a migration.

---

## Workstream A: DB migration and write-path enrichment

### Migration: `20260412220000_tool_execution_audit_class`

Add three nullable columns to `ToolExecution`:

```sql
ALTER TABLE "ToolExecution"
  ADD COLUMN IF NOT EXISTS "auditClass"    TEXT,
  ADD COLUMN IF NOT EXISTS "capabilityId"  TEXT,
  ADD COLUMN IF NOT EXISTS "summary"       TEXT;

CREATE INDEX IF NOT EXISTS "ToolExecution_auditClass_createdAt_idx"
  ON "ToolExecution" ("auditClass", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "ToolExecution_capabilityId_createdAt_idx"
  ON "ToolExecution" ("capabilityId", "createdAt" DESC);
```

Update `packages/db/prisma/schema.prisma` to add the three fields and indexes:

```prisma
  auditClass    String?
  capabilityId  String?
  summary       String?

  @@index([auditClass, createdAt(sort: Desc)])
  @@index([capabilityId, createdAt(sort: Desc)])
```

Do not make the new columns `NOT NULL` in Phase 3 — existing rows and any write paths not yet updated must not break.

Run: `pnpm --filter @dpf/db exec prisma migrate dev --name tool_execution_audit_class`

### Audit class derivation at write time

Add helpers in `apps/web/lib/tak/agentic-loop.ts`:

```typescript
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import type { AuditClass } from "@/lib/audit-classes";

function deriveAuditClassForTool(toolName: string): AuditClass {
  const tool = PLATFORM_TOOLS.find((t) => t.name === toolName);
  if (!tool) return "journal"; // unknown tool — treat as journal, not metrics_only
  // Explicit override wins if annotated directly on the tool definition
  if ("auditClass" in tool && tool.auditClass) return tool.auditClass as AuditClass;
  if (tool.sideEffect) return "ledger";
  if (tool.requiresExternalAccess) return "journal";
  return "metrics_only";
}

function deriveCapabilityId(toolName: string): string {
  // Platform tools use platform:toolName. MCP tools (serverSlug__toolName)
  // are not written via agentic-loop.ts yet — handled by MCP adapter layer.
  return `platform:${toolName}`;
}
```

### Selective payload retention

Modify `prisma.toolExecution.create(...)` in `agentic-loop.ts`:

```typescript
const auditClass = deriveAuditClassForTool(tc.name);
const capabilityId = deriveCapabilityId(tc.name);
const isMetricsOnly = auditClass === "metrics_only";

prisma.toolExecution.create({
  data: {
    // ... existing fields unchanged ...
    parameters: isMetricsOnly ? {} : (tc.arguments as any),
    result:     isMetricsOnly ? {} : (toolResult as any),
    auditClass,
    capabilityId,
    summary: isMetricsOnly
      ? `${tc.name}: ${toolResult.success ? "ok" : "failed"}${toolResult.durationMs ? ` (${toolResult.durationMs}ms)` : ""}`
      : null,
  },
}).catch(() => {});
```

`success`, `durationMs`, and `routeContext` are always stored regardless of audit class — they are needed for metrics aggregation.

### Probe chatter aggregation

Detect three or more consecutive executions of the same `metrics_only` tool within the same `threadId` within a 60-second window. Write the first two occurrences normally; suppress the rest.

Add in-memory buffer to `runAgenticLoop()` before the iteration loop:

```typescript
const metricsOnlyBuffer = new Map<string, { count: number; firstAt: number }>();
```

At the write site, before creating the row:

```typescript
if (isMetricsOnly) {
  const key = `${threadId}:${tc.name}`;
  const now = Date.now();
  const existing = metricsOnlyBuffer.get(key);
  const WINDOW_MS = 60_000;
  const COLLAPSE_THRESHOLD = 3;

  if (existing && (now - existing.firstAt) < WINDOW_MS) {
    existing.count++;
    if (existing.count >= COLLAPSE_THRESHOLD) {
      // TODO Phase 4: upsert an aggregate row with count instead of silently skipping
      continue; // suppress — absorbed into the buffer
    }
  } else {
    metricsOnlyBuffer.set(key, { count: 1, firstAt: now });
  }
}
```

---

## Workstream B: `ToolExecutionRow` type and query layer

### Update `apps/web/lib/tool-execution-data.ts`

Add the new fields to `ToolExecutionRow`:

```typescript
export type ToolExecutionRow = {
  // ... existing fields ...
  auditClass: "ledger" | "journal" | "metrics_only" | null;
  capabilityId: string | null;
  summary: string | null;
};
```

Update all `select` objects in the existing query functions to include the three new fields. Update the `.map()` calls to pass them through.

Add two new filtered query functions:

```typescript
// Journal + ledger executions — the "what did agents do?" view.
// Excludes metrics_only rows (probes, reads).
export const getJournalToolExecutions = cache(async (limit = 500): Promise<ToolExecutionRow[]>)

// Ledger-only executions — side-effecting writes and failures.
export const getLedgerToolExecutions = cache(async (limit = 200): Promise<ToolExecutionRow[]>)
```

Add aggregate stats function for Operational Metrics:

```typescript
export type ToolExecutionMetrics = {
  totalExecutions: number;
  byAuditClass: { ledger: number; journal: number; metrics_only: number; unknown: number };
  successRate: number; // 0..1
  avgDurationMs: number | null;
  topTools: Array<{ toolName: string; count: number; successRate: number }>;
  recentErrorRate: number; // errors in last 24h / total in last 24h
};

export const getToolExecutionMetrics = cache(async (): Promise<ToolExecutionMetrics>)
```

Use `prisma.toolExecution.groupBy` for `topTools`, `prisma.toolExecution.aggregate` for `avgDurationMs`, and `prisma.toolExecution.count` with `where` filters for `byAuditClass`.

---

## Workstream C: `capabilityId` backfill

Run manually after Workstream A deploys and after Phase 2's `sync-capabilities.ts` has populated `PlatformCapability` rows.

**New file:** `packages/db/src/backfill-capability-ids.ts`

```typescript
// packages/db/src/backfill-capability-ids.ts
// One-time backfill: populate capabilityId and auditClass on existing ToolExecution rows.
// Run after Phase 3 migration deploys. Safe to re-run — uses WHERE IS NULL guard.
// Do NOT add to portal-init or seed.ts. Run manually with operator oversight.
```

Backfill SQL (run in order):

```sql
-- 1. Platform tools (no __ in name)
UPDATE "ToolExecution"
SET "capabilityId" = 'platform:' || "toolName"
WHERE "capabilityId" IS NULL
  AND "toolName" NOT LIKE '%__%';

-- 2. MCP tools (serverSlug__toolName format)
UPDATE "ToolExecution"
SET "capabilityId" = 'mcp:' || "toolName"
WHERE "capabilityId" IS NULL
  AND "toolName" LIKE '%__%';

-- 3. auditClass backfill from PlatformCapability manifest
-- (requires Phase 2 sync-capabilities to have run)
UPDATE "ToolExecution" te
SET "auditClass" = COALESCE(
  (
    SELECT (pc.manifest->>'auditClass')
    FROM "PlatformCapability" pc
    WHERE pc."capabilityId" = 'platform:' || te."toolName"
    LIMIT 1
  ),
  'journal'  -- conservative fallback
)
WHERE te."auditClass" IS NULL;
```

The script must check that `PlatformCapability` is non-empty before running step 3, and warn if not:

```typescript
const capCount = await prisma.platformCapability.count();
if (capCount === 0) {
  console.warn("[backfill] PlatformCapability is empty — auditClass backfill skipped. Run sync-capabilities (Phase 2) first.");
}
```

Verify after running:

```sql
SELECT "auditClass", COUNT(*) FROM "ToolExecution" GROUP BY "auditClass";
SELECT COUNT(*) FROM "ToolExecution" WHERE "capabilityId" IS NULL;
-- Second query should return 0
```

---

## Workstream D: Audit UI split

### D1 — `AuditTabNav.tsx`

Replace the `TABS` array with six tabs in this order:

```typescript
const TABS = [
  { label: "Action Ledger",           href: "/platform/audit/ledger" },
  { label: "Capability Journal",      href: "/platform/audit/journal" },
  { label: "Routes",                  href: "/platform/audit/routes" },
  { label: "Long-running Operations", href: "/platform/audit/operations" },
  { label: "Authority",               href: "/platform/audit/authority" },
  { label: "Operational Metrics",     href: "/platform/audit/metrics" },
];
```

No other changes — the `pathname.startsWith(href)` active-tab logic handles new tabs automatically.

### D2 — New page: Capability Journal

**New file:** `apps/web/app/(shell)/platform/audit/journal/page.tsx`

- Page heading: "Capability Journal"
- Subtitle: "Execution history for journal-class and ledger-class tool calls. Read-only probes are aggregated in Operational Metrics."
- Stats bar: total executions, success count, failure count, unique agents, unique capabilities
- Filter bar: audit class (All / Ledger only / Journal only), success filter, search by tool name or capability
- Table: use new `CapabilityJournalClient` component (D3 below)
- Empty state: "No journal-class tool executions recorded yet."
- Data source: `getJournalToolExecutions()` from Workstream B

### D3 — New component: `CapabilityJournalClient.tsx`

**New file:** `apps/web/components/platform/CapabilityJournalClient.tsx`

Extended version of `ToolExecutionLogClient` with two additional columns: **Audit Class** (badge) and **Capability** (monospace, prefix dimmed). Do not modify `ToolExecutionLogClient.tsx` — it is still used elsewhere.

- `auditClass` badge colors: `ledger` = amber, `journal` = blue
- `capabilityId` display: `platform:` prefix in muted text, tool name in regular text
- For rows with `summary` set and empty `parameters`/`result`: show the summary string in the expanded row instead of empty JSON

### D4 — New page: Operational Metrics

**New file:** `apps/web/app/(shell)/platform/audit/metrics/page.tsx`

- Page heading: "Operational Metrics"
- Subtitle: "Aggregate counts, success rates, and latency across all tool executions including probe chatter."
- Stat cards: Total Executions, Ledger Events, Journal Events, Metrics-Only Events, Success Rate, Avg Duration
- Top tools table: tool name, count, success rate, avg duration, audit class — sorted by count descending
- Recent error rate card: errors in last 24h / total in last 24h
- Warning banner if `PlatformCapability` table is empty (Phase 2 not yet run)
- Data source: `getToolExecutionMetrics()` from Workstream B
- No client component needed — server-rendered

### D5 — Update Authority page

**Modified file:** `apps/web/app/(shell)/platform/audit/authority/page.tsx`

Remove the Tool Execution Log section and its imports (`getToolExecutions`, `getToolExecutionStats`, `ToolExecutionLogClient`, and the tool execution stat cards). Retain:

- Authority Matrix panel
- Delegation Chain panel
- Effective Permissions Inspector panel

Update the page subtitle to: "Agent grants, delegation chains, and effective permissions. Tool execution history is in Capability Journal."

---

## Acceptance criteria (from design spec Sections 8.4 and 15)

- [ ] `ToolExecution` has nullable `auditClass`, `capabilityId`, and `summary` columns after migration
- [ ] New executions written after deploy have `auditClass` and `capabilityId` populated — no row written post-Phase-3 has `auditClass = NULL`
- [ ] `metrics_only` executions store `{}` for `parameters` and `result`, and a non-null `summary` string
- [ ] Three or more consecutive `metrics_only` executions of the same tool within 60 seconds in one thread result in at most two persisted rows
- [ ] Capability Journal at `/platform/audit/journal` shows `ledger` + `journal` executions with audit class badges and capability ID column
- [ ] Operational Metrics at `/platform/audit/metrics` shows aggregate counts and top tools table
- [ ] `AuditTabNav` shows six tabs: Action Ledger, Capability Journal, Routes, Long-running Operations, Authority, Operational Metrics
- [ ] Authority page no longer contains the Tool Execution Log section
- [ ] `ToolExecutionRow` type includes `auditClass`, `capabilityId`, and `summary`
- [ ] Backfill script exists, is documented, and is safe to re-run
- [ ] TypeScript and lint pass with no new warnings

---

## What NOT to do in Phase 3

- Do not remove `toolName` or make it nullable — it remains the primary key for pre-Phase-3 rows and human-readable label
- Do not migrate UI consumers from `toolName` filtering to `capabilityId` filtering — that is Phase 3c per the spec's migration path
- Do not implement operator-configurable retention windows — the 30-day `journal` retention default is hardcoded for Phase 3
- Do not delete rows older than 30 days — retention enforcement (scheduled cleanup job) is out of scope for Phase 3
- Do not add `auditClass` filtering to the Action Ledger page — that page shows `AgentActionProposal` records, not `ToolExecution` rows
- Do not implement a new normalized `AuditEvent` model as an alternative to extending `ToolExecution` — the additive column approach is the prescribed Phase 3 path; the normalized model is Phase 4+
- Do not change the `AgentActionProposal` data model or the Action Ledger page
- Do not add Capability Journal or Operational Metrics entries to `ToolsTabNav` — these are Audit pages only
- Do not add trust policy enforcement or per-user credential state — those remain deferred
