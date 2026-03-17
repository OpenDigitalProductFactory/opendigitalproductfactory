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

The `ImprovementProposal` model already follows the dual-attribution pattern (`proposedByAgentId` + `proposedByUserId`) — this spec extends that pattern to epics and backlog items for consistency.

## Goals

1. Every epic and backlog item records who created it (user, agent, or both)
2. Completion timestamp captured when items reach terminal status
3. Attribution visible in the UI (list views and edit panels)
4. No breaking changes — all new fields nullable, existing records unaffected

## Non-Goals

- Full status history log (can be added later if needed)
- `startedAt` timestamp for in-progress transition (queryable from `updatedAt` if needed)
- Retroactive population of existing records

---

## Design

### Schema Changes

**BacklogItem** — add 3 fields (naming follows existing `submittedBy` convention in schema):

```prisma
model BacklogItem {
  // ... existing fields ...
  submittedById      String?
  submittedBy        User?     @relation("BacklogSubmissions", fields: [submittedById], references: [id])
  submittedByAgentId String?   // agent ID if created by AI coworker (e.g., "coo", "ops-coordinator")
  completedAt        DateTime? // set when status → "done" or "deferred"
}
```

Note: `submittedById` and `completedAt` are already added to the schema. `submittedByAgentId` still needs to be added.

**Epic** — add 3 fields (same naming pattern):

```prisma
model Epic {
  // ... existing fields ...
  submittedById      String?
  submittedBy        User?     @relation("EpicSubmissions", fields: [submittedById], references: [id])
  submittedByAgentId String?   // agent ID from ROUTE_AGENT_MAP
  completedAt        DateTime? // set when status → "done"
}
```

All fields are nullable. Existing records retain `null` values — `createdAt` (already present) serves as the historical timestamp.

### Attribution Rules

| Creation Source | `submittedById` | `submittedByAgentId` |
|----------------|-----------------|---------------------|
| User via UI | Logged-in user ID | `null` |
| Agent via tool (user session) | Session user ID | Agent ID (e.g., `"coo"`) |
| Agent via scheduled task | User who scheduled it | Agent ID |

Both fields can be populated simultaneously — the agent acts, the human authorizes. This matches the HITL governance model where agents are part of the workforce.

### Completion Timestamp Rules

- **Set** when `status` transitions to `"done"` (epics and backlog items) or `"deferred"` (backlog items only)
- **Cleared** (set to `null`) if status is changed back to `"open"` or `"in-progress"`
- Captured as `DateTime` for precise event reconstruction

### UI Changes

**EpicCard row** (ops backlog page):
- Show created date (formatted as short date) and submitter in the existing row layout
- If created by agent: show agent name. If created by user: show user email. If both: show "AgentName (via UserEmail)"

**BacklogItemRow** (ops backlog page):
- Show created date + submitter inline, similar to epic rows

**Edit panels** (BacklogPanel, EpicPanel):
- Read-only metadata section at the bottom of the form showing:
  - Submitted by: user email and/or agent name
  - Created at: formatted datetime
  - Completed at: formatted datetime (if applicable, otherwise "—")

### Server Action Changes

**`createEpic`** — accept and store `submittedById` from the session

**`updateEpic`** — when status changes to `"done"`, set `completedAt = new Date()`. When status changes away from `"done"`, set `completedAt = null`.

**`createBacklogItem`** / **`updateBacklogItem`** — same pattern. For items created via `create_backlog_item` MCP tool, pass both `submittedById` (from session user) and `submittedByAgentId` (from the agent context).

**`updateBacklogItem`** — when status changes to `"done"` or `"deferred"`, set `completedAt = new Date()`. When status changes away from terminal states, set `completedAt = null`.

### Data Queries

**Existing queries** (`getEpics`, `getBacklogItems` in `lib/backlog-data.ts`) need to include the new fields in their `select` clauses, and include the `submittedBy` relation for display name resolution.

**Type updates** (`lib/backlog.ts`) — extend `EpicWithRelations` and `BacklogItemWithRelations` types with the new fields.

---

## Files Affected

**Schema:**
- `packages/db/prisma/schema.prisma` — add fields to Epic model; add `submittedByAgentId` to BacklogItem

**Migration:**
- `packages/db/prisma/migrations/YYYYMMDD_add_traceability_fields/migration.sql`

**Server actions:**
- `apps/web/lib/actions/backlog.ts` (or equivalent) — update create/update actions for attribution and completedAt
- `apps/web/lib/mcp-tools.ts` — update `create_backlog_item` tool handler to pass submittedById + submittedByAgentId

**Data layer:**
- `apps/web/lib/backlog-data.ts` — extend queries to select new fields + submittedBy relation
- `apps/web/lib/backlog.ts` — extend TypeScript types

**UI components:**
- `apps/web/components/ops/EpicCard.tsx` — show created date + submitter
- `apps/web/components/ops/BacklogItemRow.tsx` — show created date + submitter
- `apps/web/components/ops/EpicPanel.tsx` — add read-only metadata section
- `apps/web/components/ops/BacklogPanel.tsx` — add read-only metadata section

## Testing Strategy

- Verify new fields are nullable and migration applies cleanly
- Verify UI creation sets `submittedById` from session
- Verify agent tool creation sets both `submittedById` and `submittedByAgentId`
- Verify `completedAt` is set on status → done/deferred and cleared on reopen
- Verify attribution displays correctly in list views and edit panels
- Verify existing records with null attribution fields render gracefully
