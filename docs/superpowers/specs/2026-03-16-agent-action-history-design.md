# BI-EXEC-006: Agent Action History View — Design Spec

**Date:** 2026-03-16
**Backlog item:** BI-EXEC-006
**Epic:** EP-AGENT-EXEC-001 (Agent Task Execution with HITL Governance)
**Goal:** A dedicated page under the AI Workforce area where users can browse all agent action proposals, their status, who approved them, and what they produced. Closes the Agent Execution epic.

**Prerequisite:** AgentActionProposal schema, proposal creation, execution engine, approval actions — all complete.

---

## 1. Route

**Path:** `/platform/ai/history`

Linked from the AI Workforce area (`/platform/ai`) as a navigation item alongside the provider grid. The page is a server component that queries proposals from the database.

**Auth:** Requires `view_platform` capability (same gate as the parent `/platform` area).

---

## 2. Data Layer

**New file:** `apps/web/lib/proposal-data.ts`

Reusable query functions that both this page and the future process observer (EP-PROCESS-001) can import.

```typescript
type ProposalRow = {
  proposalId: string;
  agentId: string;
  actionType: string;
  parameters: Record<string, unknown>;
  status: string;
  proposedAt: string;
  decidedAt: string | null;
  decidedByEmail: string | null;
  executedAt: string | null;
  resultEntityId: string | null;
  resultError: string | null;
};
```

**Functions:**
- `getProposals(filters?: { status?: string; agentId?: string }): Promise<ProposalRow[]>` — returns all proposals, newest-first, with optional status/agent filtering. Joins `User` for `decidedByEmail`. Cached with React `cache()`.
- `getProposalStats(): Promise<{ total: number; proposed: number; executed: number; rejected: number; failed: number }>` — summary counts for the header cards.

---

## 3. Page Layout

### Header
- Title: "Agent Action History"
- Subtitle: count summary (e.g., "12 total · 8 executed · 2 pending · 1 rejected · 1 failed")
- Summary stat cards (same style as GovernanceOverviewPanel): Total, Executed (green), Pending (blue), Rejected (red), Failed (amber)

### Filters
- Status dropdown: All / Proposed / Executed / Rejected / Failed
- Agent dropdown: All / list of distinct agents from proposals
- Client component wrapping the filter controls and table

### Table
| Column | Source | Notes |
|--------|--------|-------|
| Agent | `agentId` | Human-friendly label from `ROUTE_AGENT_MAP` |
| Action | `actionType` | Human-friendly: `create_backlog_item` -> "Create Backlog Item" |
| Status | `status` | Color-coded badge: green (executed), blue (proposed), red (rejected), amber (failed) |
| Proposed | `proposedAt` | Relative time (e.g., "2 hours ago") |
| Decided by | `decidedByEmail` | Email of approver/rejector, or "—" if pending |
| Result | `resultEntityId` / `resultError` | Entity ID if success, truncated error if failed, "—" if pending |

### Row Expansion
Clicking a row expands an inline detail panel showing:
- Full parameters as labeled key-value pairs
- All timestamps (proposed, decided, executed)
- Result entity ID (linked if it's a backlog item ID like BI-XXXX)
- Error message (full text, not truncated)

### Empty State
When no proposals exist: centered message "No agent actions yet. Agent proposals will appear here when the AI co-worker suggests actions in conversation."

---

## 4. Navigation Link

Add "History" link to the AI Workforce page (`/platform/ai/page.tsx`) alongside the existing provider grid. This could be a simple text link or a tab depending on the existing navigation pattern on that page.

---

## 5. Files Affected

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/proposal-data.ts` | Reusable proposal query functions (shared with future observer) |
| `apps/web/app/(shell)/platform/ai/history/page.tsx` | Server component page |
| `apps/web/components/platform/ProposalHistoryClient.tsx` | Client component with filters + table + row expansion |

### Modified Files
| File | Change |
|------|--------|
| `apps/web/app/(shell)/platform/ai/page.tsx` | Add navigation link to `/platform/ai/history` |

---

## 6. Styling

Follow existing patterns:
- Summary cards: same as `GovernanceOverviewPanel` (border-left accent, uppercase label, large number)
- Table: same inline styles as provider grid and ops backlog (dark surface, border, monospace IDs)
- Status badges: same color scheme as proposal cards in chat (green=#4ade80, blue=#7c8cf8, red=#ef4444, amber=#fbbf24)
- Filters: same select/dropdown styling as ops backlog filters

---

## 7. Not in Scope

- Pagination (v1 loads all proposals; add pagination when volume warrants it)
- Export/download (future)
- Cross-referencing with AuthorizationDecisionLog entries (the data is there but not surfaced in v1)
- Process observer integration (EP-PROCESS-001 will consume `proposal-data.ts` when built)
