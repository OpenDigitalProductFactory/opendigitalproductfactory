# EP-OPS-TRACE-001: Backlog & Epic Traceability Fields

**Status:** Draft
**Date:** 2026-03-16
**Scope:** Schema changes to Epic and BacklogItem models for submitter attribution and completion tracking

---

## Problem Statement

The platform targets regulated industries where evidence of decisions is critical. Currently, neither `Epic` nor `BacklogItem` records who created them or when they were completed. Both models have `createdAt` and `updatedAt` timestamps but no attribution (who) or completion timestamp (when done). This makes it impossible to:

- Trace who submitted a backlog item or epic (human or AI agent)
- Know which user authorized an agent-created item
- Measure cycle time or know when work was completed
- Reconstruct a timeline of events for audit or incident analysis

The `ImprovementProposal` model uses `submittedById` (FK to User) + `agentId` (string) for dual attribution. This spec extends that same pattern to epics and backlog items.

## Goals

1. Every epic and backlog item records who created it (user, agent, or both)
2. Completion timestamp captured when items reach terminal status
3. Attribution visible in the UI (list views and edit panels)
4. No breaking changes — all new fields nullable, existing records unaffected

## Non-Goals

- Full status history log (can be added later if needed)
- `startedAt` timestamp for in-progress transition (queryable from `updatedAt` if needed)
- Retroactive population of existing records
- Completion attribution (`completedById` / `completedByAgentId`) — valuable for audit but deferred

---

## Design

### Schema Changes

**BacklogItem** — add fields (partially done: `submittedById` and `completedAt` already exist in schema):

```prisma
model BacklogItem {
  // ... existing fields ...
  submittedById   String?
  submittedBy     User?     @relation("BacklogSubmissions", fields: [submittedById], references: [id])
  agentId         String?   // agent ID if created by AI coworker (e.g., "coo", "ops-coordinator")
  completedAt     DateTime? // set when status → "done" or "deferred"
}
```

Field naming follows the `ImprovementProposal` convention: `submittedById` for user FK, `agentId` for the agent string.

Note: `submittedById` and `completedAt` already exist on BacklogItem. Only `agentId` needs to be added.

**Epic** — add 3 fields:

```prisma
model Epic {
  // ... existing fields ...
  submittedById   String?
  submittedBy     User?     @relation("EpicSubmissions", fields: [submittedById], references: [id])
  agentId         String?   // agent ID from ROUTE_AGENT_MAP
  completedAt     DateTime? // set when status → "done"
}
```

**User model** — add reverse relation:

```prisma
model User {
  // ... existing relations ...
  epicSubmissions  Epic[]  @relation("EpicSubmissions")
}
```

The User model already has `backlogSubmissions BacklogItem[] @relation("BacklogSubmissions")` — only the Epic relation is new.

All new fields are nullable. Existing records retain `null` values — `createdAt` (already present) serves as the historical timestamp.

### Attribution Rules

| Creation Source | `submittedById` | `agentId` |
|----------------|-----------------|-----------|
| User via UI | Logged-in user ID | `null` |
| Agent via tool (user session) | Session user ID | Agent ID (e.g., `"coo"`) |
| Agent via scheduled task | User who scheduled it | Agent ID |

Both fields can be populated simultaneously — the agent acts, the human authorizes. This matches the HITL governance model where agents are part of the workforce.

### Completion Timestamp Rules

- **Set** when `status` transitions to `"done"` (epics and backlog items) or `"deferred"` (backlog items only)
- **Cleared** (set to `null`) if status is changed back to `"open"` or `"in-progress"`
- Captured as `DateTime` for precise event reconstruction

### Session User ID Strategy

Server actions should read the session internally via `auth()` (the same pattern used by `requireManageBacklog` and other permission-gated actions). The `submittedById` is NOT passed from the client — it's resolved server-side from the authenticated session. This prevents clients from self-reporting their own user ID.

### Code Path Audit

Both server actions AND MCP tool handlers create/update these entities via different code paths. ALL paths must set attribution and `completedAt`:

**Creation paths (must set `submittedById` + `agentId`):**
- `createBacklogItem` server action (UI creates)
- `create_backlog_item` MCP tool handler in `mcp-tools.ts` (agent creates)
- `register_tech_debt` MCP tool handler (creates BacklogItem directly via Prisma)
- `createEpic` server action (UI creates)
- `create_build_epic` MCP tool handler / `createBuildEpic` action (agent creates)

**Update paths (must handle `completedAt` transitions):**
- `updateBacklogItem` server action
- `update_backlog_item` MCP tool handler in `mcp-tools.ts` (calls Prisma directly, NOT through server action)
- `updateEpic` server action

### Agent Name Resolution

`agentId` stores a plain string like `"coo"` or `"ops-coordinator"`. For UI display, resolve to a human-readable name using the `AGENT_NAME_MAP` constant already exported from `agent-routing.ts`. This map already exists and maps agent IDs to display names (e.g., `"coo"` → `"COO"`, `"ops-coordinator"` → `"Scrum Master"`). Import it in the UI components that need it.

### UI Changes

**EpicCard row** (ops backlog page):
- Add a small metadata line below the title showing created date + submitter
- Format: `"Mar 16 · mark@example.com"` or `"Mar 16 · Scrum Master (via mark@example.com)"`
- Uses existing space within the `flex-1` title column — no column layout changes needed

**BacklogItemRow** (ops backlog page):
- Same metadata format below the item title

**Edit panels** (BacklogPanel, EpicPanel):
- Read-only metadata section at the bottom of the form showing:
  - Submitted by: user email and/or agent display name
  - Created at: formatted datetime
  - Completed at: formatted datetime (if applicable, otherwise "—")

### Data Queries

**`getEpics`** and **`getBacklogItems`** in `lib/backlog-data.ts` — extend `select` clauses to include:
- `submittedById`, `agentId`, `completedAt`
- `submittedBy: { select: { email: true } }` for display name resolution

**Type updates** in `lib/backlog.ts`:
- `BacklogItemWithRelations` — add `agentId: string | null`, ensure `submittedBy` and `completedAt` are present
- `EpicWithRelations` — add `submittedBy: { email: string } | null`, `agentId: string | null`, `completedAt: Date | null`

---

## Files Affected

**Schema:**
- `packages/db/prisma/schema.prisma` — add `agentId` to BacklogItem; add `submittedById`, `agentId`, `completedAt` to Epic; add `epicSubmissions` relation to User

**Migration:**
- `packages/db/prisma/migrations/YYYYMMDD_add_traceability_fields/migration.sql`

**Server actions:**
- `apps/web/lib/actions/backlog.ts` — update create/update actions for attribution and completedAt
- `apps/web/lib/mcp-tools.ts` — update `create_backlog_item`, `update_backlog_item`, `register_tech_debt`, `create_build_epic` handlers

**Data layer:**
- `apps/web/lib/backlog-data.ts` — extend queries to select new fields + submittedBy relation
- `apps/web/lib/backlog.ts` — extend TypeScript types

**UI components:**
- `apps/web/components/ops/EpicCard.tsx` — show created date + submitter metadata
- `apps/web/components/ops/BacklogItemRow.tsx` — show created date + submitter metadata
- `apps/web/components/ops/EpicPanel.tsx` — add read-only metadata section
- `apps/web/components/ops/BacklogPanel.tsx` — add read-only metadata section

## Future Considerations

- **Completion attribution** (`completedById` / `completedByAgentId`) — who marked the item done, not just who created it
- **Database index on `completedAt`** — for cycle-time reporting queries (e.g., "items completed this week")

## Testing Strategy

- Verify new fields are nullable and migration applies cleanly
- Verify UI creation sets `submittedById` from session (server-side, not client-passed)
- Verify agent tool creation sets both `submittedById` and `agentId`
- Verify `completedAt` is set on status → done/deferred and cleared on reopen
- Verify MCP tool handlers (`update_backlog_item`, `create_backlog_item`) also handle completedAt and attribution
- Verify attribution displays correctly in list views and edit panels
- Verify existing records with null attribution fields render gracefully
- Verify agent name resolution via AGENT_NAME_MAP displays correctly
