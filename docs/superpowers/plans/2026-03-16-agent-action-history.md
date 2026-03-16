# Agent Action History View — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/platform/ai/history` page that displays all agent action proposals with status, filtering, and expandable detail rows.

**Architecture:** Server component page queries `AgentActionProposal` via a new reusable `proposal-data.ts` module. Client component handles filtering and row expansion. Navigation link added to the AI Workforce page.

**Tech Stack:** Next.js 16 (App Router, Server Components), Prisma 5, TypeScript strict, React 18.

**Spec:** `docs/superpowers/specs/2026-03-16-agent-action-history-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/proposal-data.ts` | Reusable proposal query functions (cached) |
| `apps/web/app/(shell)/platform/ai/history/page.tsx` | Server component: fetches data, renders header + summary cards |
| `apps/web/components/platform/ProposalHistoryClient.tsx` | Client component: filters, table, row expansion |

### Modified Files
| File | Change |
|------|--------|
| `apps/web/app/(shell)/platform/ai/page.tsx` | Add "Agent History" nav link |

---

## Chunk 1: Data Layer

### Task 1: Create proposal-data.ts

**Files:**
- Create: `apps/web/lib/proposal-data.ts`

- [ ] **Step 1: Create the data module**

```typescript
// apps/web/lib/proposal-data.ts
import { cache } from "react";
import { prisma } from "@dpf/db";

export type ProposalRow = {
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

export type ProposalStats = {
  total: number;
  proposed: number;
  executed: number;
  rejected: number;
  failed: number;
};

export const getProposals = cache(async (): Promise<ProposalRow[]> => {
  const rows = await prisma.agentActionProposal.findMany({
    orderBy: { proposedAt: "desc" },
    include: {
      decidedBy: { select: { email: true } },
    },
  });

  return rows.map((r) => ({
    proposalId: r.proposalId,
    agentId: r.agentId,
    actionType: r.actionType,
    parameters: r.parameters as Record<string, unknown>,
    status: r.status,
    proposedAt: r.proposedAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decidedByEmail: r.decidedBy?.email ?? null,
    executedAt: r.executedAt?.toISOString() ?? null,
    resultEntityId: r.resultEntityId,
    resultError: r.resultError,
  }));
});

export const getProposalStats = cache(async (): Promise<ProposalStats> => {
  const [total, proposed, executed, rejected, failed] = await Promise.all([
    prisma.agentActionProposal.count(),
    prisma.agentActionProposal.count({ where: { status: "proposed" } }),
    prisma.agentActionProposal.count({ where: { status: "executed" } }),
    prisma.agentActionProposal.count({ where: { status: "rejected" } }),
    prisma.agentActionProposal.count({ where: { status: "failed" } }),
  ]);
  return { total, proposed, executed, rejected, failed };
});
```

- [ ] **Step 2: Verify types**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/proposal-data.ts
git commit -m "feat: add proposal-data.ts with reusable query functions for agent action history"
```

---

## Chunk 2: Client Component

### Task 2: Create ProposalHistoryClient

**Files:**
- Create: `apps/web/components/platform/ProposalHistoryClient.tsx`

- [ ] **Step 1: Create the client component**

```typescript
"use client";

import { useState } from "react";
import { AGENT_NAME_MAP } from "@/lib/agent-routing";
import type { ProposalRow } from "@/lib/proposal-data";

type Props = {
  proposals: ProposalRow[];
};

const STATUS_COLOURS: Record<string, string> = {
  proposed: "#7c8cf8",
  executed: "#4ade80",
  rejected: "#ef4444",
  failed: "#fbbf24",
};

function formatAction(actionType: string): string {
  return actionType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ProposalHistoryClient({ proposals }: Props) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const agents = [...new Set(proposals.map((p) => p.agentId))];

  const filtered = proposals.filter((p) => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (agentFilter !== "all" && p.agentId !== agentFilter) return false;
    return true;
  });

  const selectStyle: React.CSSProperties = {
    background: "#1a1a2e",
    border: "1px solid #2a2a40",
    color: "#e0e0ff",
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 4,
  };

  return (
    <div>
      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="all">All statuses</option>
          <option value="proposed">Proposed</option>
          <option value="executed">Executed</option>
          <option value="rejected">Rejected</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="all">All agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>{AGENT_NAME_MAP[a] ?? a}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: "48px 20px",
          color: "#8888a0",
          fontSize: 13,
        }}>
          {proposals.length === 0
            ? "No agent actions yet. Agent proposals will appear here when the AI co-worker suggests actions in conversation."
            : "No proposals match the selected filters."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {/* Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1.5fr 100px 100px 1fr 1fr",
            gap: 8,
            padding: "8px 12px",
            fontSize: 10,
            fontWeight: 600,
            color: "#8888a0",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}>
            <span>Agent</span>
            <span>Action</span>
            <span>Status</span>
            <span>When</span>
            <span>Decided by</span>
            <span>Result</span>
          </div>

          {/* Rows */}
          {filtered.map((p) => {
            const isExpanded = expandedId === p.proposalId;
            const statusColour = STATUS_COLOURS[p.status] ?? "#8888a0";

            return (
              <div key={p.proposalId}>
                <div
                  onClick={() => setExpandedId(isExpanded ? null : p.proposalId)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1.5fr 100px 100px 1fr 1fr",
                    gap: 8,
                    padding: "10px 12px",
                    background: isExpanded ? "#1e1e35" : "#1a1a2e",
                    border: "1px solid #2a2a40",
                    borderRadius: isExpanded ? "6px 6px 0 0" : 6,
                    cursor: "pointer",
                    fontSize: 12,
                    color: "#e0e0ff",
                    alignItems: "center",
                  }}
                >
                  <span>{AGENT_NAME_MAP[p.agentId] ?? p.agentId}</span>
                  <span>{formatAction(p.actionType)}</span>
                  <span style={{
                    color: statusColour,
                    fontSize: 11,
                    fontWeight: 600,
                  }}>
                    {p.status}
                  </span>
                  <span style={{ color: "#8888a0", fontSize: 11 }}>
                    {timeAgo(p.proposedAt)}
                  </span>
                  <span style={{ color: "#8888a0", fontSize: 11 }}>
                    {p.decidedByEmail ?? "\u2014"}
                  </span>
                  <span style={{ color: "#8888a0", fontSize: 11 }}>
                    {p.resultEntityId ?? (p.resultError ? p.resultError.slice(0, 30) + (p.resultError.length > 30 ? "..." : "") : "\u2014")}
                  </span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{
                    background: "#161625",
                    border: "1px solid #2a2a40",
                    borderTop: "none",
                    borderRadius: "0 0 6px 6px",
                    padding: "12px 16px",
                    fontSize: 12,
                  }}>
                    <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>
                      Parameters
                    </div>
                    {Object.entries(p.parameters).map(([k, v]) => (
                      <div key={k} style={{ marginBottom: 4 }}>
                        <span style={{ color: "#8888a0" }}>{k}: </span>
                        <span style={{ color: "#e0e0ff" }}>{String(v)}</span>
                      </div>
                    ))}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12, fontSize: 11, color: "#8888a0" }}>
                      <div>
                        <span style={{ color: "#666" }}>Proposed: </span>
                        {new Date(p.proposedAt).toLocaleString()}
                      </div>
                      {p.decidedAt && (
                        <div>
                          <span style={{ color: "#666" }}>Decided: </span>
                          {new Date(p.decidedAt).toLocaleString()}
                        </div>
                      )}
                      {p.executedAt && (
                        <div>
                          <span style={{ color: "#666" }}>Executed: </span>
                          {new Date(p.executedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                    {p.resultEntityId && (
                      <div style={{ marginTop: 8 }}>
                        <span style={{ color: "#666", fontSize: 11 }}>Created: </span>
                        <span style={{ color: "#4ade80", fontSize: 11 }}>{p.resultEntityId}</span>
                      </div>
                    )}
                    {p.resultError && (
                      <div style={{ marginTop: 8, color: "#ef4444", fontSize: 11 }}>
                        {p.resultError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/platform/ProposalHistoryClient.tsx
git commit -m "feat: add ProposalHistoryClient with filters, table, and expandable detail rows"
```

---

## Chunk 3: Page + Navigation

### Task 3: Create the history page

**Files:**
- Create: `apps/web/app/(shell)/platform/ai/history/page.tsx`

- [ ] **Step 1: Create the server component page**

```typescript
// apps/web/app/(shell)/platform/ai/history/page.tsx
import Link from "next/link";
import { getProposals, getProposalStats } from "@/lib/proposal-data";
import { ProposalHistoryClient } from "@/components/platform/ProposalHistoryClient";

const STAT_CARDS: Array<{ key: "total" | "executed" | "proposed" | "rejected" | "failed"; label: string; accent: string }> = [
  { key: "total", label: "Total", accent: "#7c8cf8" },
  { key: "executed", label: "Executed", accent: "#4ade80" },
  { key: "proposed", label: "Pending", accent: "#38bdf8" },
  { key: "rejected", label: "Rejected", accent: "#ef4444" },
  { key: "failed", label: "Failed", accent: "#fbbf24" },
];

export default async function AgentHistoryPage() {
  const [proposals, stats] = await Promise.all([
    getProposals(),
    getProposalStats(),
  ]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link href="/platform/ai" style={{ color: "#b0b0c8", fontSize: 12 }}>
          &larr; AI Providers
        </Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: "6px 0 2px" }}>
          Agent Action History
        </h1>
        <p style={{ fontSize: 11, color: "#8888a0", marginTop: 2 }}>
          {stats.total} proposal{stats.total !== 1 ? "s" : ""} recorded
        </p>
      </div>

      {/* Summary cards */}
      {stats.total > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: 8,
          marginBottom: 24,
        }}>
          {STAT_CARDS.map((card) => (
            <div
              key={card.key}
              style={{
                background: "#1a1a2e",
                border: "1px solid #2a2a40",
                borderLeft: `3px solid ${card.accent}`,
                borderRadius: 6,
                padding: "10px 12px",
              }}
            >
              <div style={{ fontSize: 10, color: "#8888a0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {card.label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, color: "#fff", marginTop: 4 }}>
                {stats[card.key]}
              </div>
            </div>
          ))}
        </div>
      )}

      <ProposalHistoryClient proposals={proposals} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(shell)/platform/ai/history/page.tsx
git commit -m "feat: add /platform/ai/history server component page with summary cards"
```

---

### Task 4: Add navigation link to AI Workforce page

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/page.tsx`

- [ ] **Step 1: Add Agent History link**

In `apps/web/app/(shell)/platform/ai/page.tsx`, add a link after the page title/subtitle (around line 68):

```typescript
// Add after the closing </p> of the subtitle, before the closing </div> of the header:
<div style={{ marginTop: 8 }}>
  <Link href="/platform/ai/history" style={{ color: "#7c8cf8", fontSize: 12 }}>
    Agent Action History &rarr;
  </Link>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(shell)/platform/ai/page.tsx
git commit -m "feat: add Agent History navigation link to AI Workforce page"
```

---

## Chunk 4: Verification

### Task 5: Final verification

- [ ] **Step 1: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Visual verification**

1. Navigate to `/platform/ai` — confirm "Agent Action History" link appears
2. Click the link — confirm `/platform/ai/history` loads
3. Verify empty state message shows ("No agent actions yet...")
4. Summary cards should not appear when there are 0 proposals

- [ ] **Step 3: Commit any fixes and push**

```bash
git push origin main
```
