# EP-FEEDBACK-001: Platform Improvement Feedback Loop — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every AI agent the ability to propose platform improvements during conversations, with human attribution, governance pipeline, and a review page.

**Architecture:** New `ImprovementProposal` Prisma model with governance stages. New `propose_improvement` MCP tool (proposal mode, no capability gate). New `/ops/improvements` page with filter/stage-transition UI. Data layer follows existing `proposal-data.ts` cache pattern.

**Tech Stack:** Next.js 16, TypeScript strict, Prisma ORM, existing MCP tool registry, existing HITL approval flow.

**Spec:** `docs/superpowers/specs/2026-03-16-platform-feedback-loop-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/improvement-data.ts` | Cached query functions for improvement proposals |
| `apps/web/lib/actions/improvements.ts` | Server actions: transition status, link to backlog |
| `apps/web/app/(shell)/ops/improvements/page.tsx` | Server page: fetches proposals, renders client |
| `apps/web/components/ops/ImprovementsClient.tsx` | Client component: filters, cards, stage transitions |
| `apps/web/components/ops/OpsTabNav.tsx` | Tab navigation: Backlog | Improvements |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `ImprovementProposal` model + User relations |
| `apps/web/lib/mcp-tools.ts` | Add `propose_improvement` tool definition + execution handler |
| `apps/web/app/(shell)/ops/page.tsx` | Add `OpsTabNav` to ops page header |

---

## Chunk 1: Schema & Migration

### Task 1: Add ImprovementProposal model

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add ImprovementProposal model to schema**

Add after the `Epic` model block (around line 360) in `packages/db/prisma/schema.prisma`:

```prisma
// ─── Improvement Proposals ──────────────────────────────────────────────────

model ImprovementProposal {
  id                  String    @id @default(cuid())
  proposalId          String    @unique                // "IP-XXXXX"
  title               String
  description         String    @db.Text
  category            String                           // ux_friction | missing_feature | performance | accessibility | security | process
  severity            String    @default("medium")     // low | medium | high | critical

  // Attribution
  submittedById       String
  submittedBy         User      @relation("ImprovementSubmissions", fields: [submittedById], references: [id])
  agentId             String                           // which agent proposed it
  routeContext        String                           // which page they were on
  threadId            String?                          // conversation thread

  // Evidence
  conversationExcerpt String?   @db.Text
  observedFriction    String?   @db.Text

  // Governance pipeline
  status              String    @default("proposed")   // proposed | reviewed | prioritized | in_progress | implemented | verified | rejected
  reviewedById        String?
  reviewedBy          User?     @relation("ImprovementReviews", fields: [reviewedById], references: [id])
  reviewedAt          DateTime?
  prioritizedAt       DateTime?
  backlogItemId       String?                          // links to BacklogItem once prioritized
  buildId             String?                          // links to FeatureBuild once implemented
  rejectionReason     String?
  verifiedAt          DateTime?

  // Hive Mind bridge
  contributionStatus  String    @default("local")      // local | proposed_for_sharing | contributed

  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  @@index([status])
  @@index([submittedById])
  @@index([routeContext])
}
```

- [ ] **Step 2: Add User relation fields**

In the `User` model (around line 13), add two new relation fields after `approvedProposals`:

```prisma
  improvementSubmissions ImprovementProposal[] @relation("ImprovementSubmissions")
  improvementReviews     ImprovementProposal[] @relation("ImprovementReviews")
```

- [ ] **Step 3: Run the migration**

```bash
cd packages/db && npx prisma migrate dev --name add-improvement-proposals
```

Expected: Migration created and applied. `prisma generate` runs automatically.

- [ ] **Step 4: Verify generated client**

```bash
cd packages/db && npx prisma generate
```

Expected: Prisma Client generated with `ImprovementProposal` model accessible as `prisma.improvementProposal`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat: add ImprovementProposal schema with governance pipeline"
```

---

## Chunk 2: Data Layer

### Task 2: Query functions for improvement proposals

**Files:**
- Create: `apps/web/lib/improvement-data.ts`

- [ ] **Step 1: Create improvement-data.ts**

Create `apps/web/lib/improvement-data.ts`:

```typescript
// apps/web/lib/improvement-data.ts
// Cached query functions for improvement proposals.

import { cache } from "react";
import { prisma } from "@dpf/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ImprovementRow = {
  id: string;
  proposalId: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  agentId: string;
  routeContext: string;
  threadId: string | null;
  observedFriction: string | null;
  conversationExcerpt: string | null;
  status: string;
  submittedByEmail: string;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  prioritizedAt: string | null;
  backlogItemId: string | null;
  rejectionReason: string | null;
  verifiedAt: string | null;
  contributionStatus: string;
  createdAt: string;
};

// ─── Queries ─────────────────────────────────────────────────────────────────

export const getImprovementProposals = cache(async (): Promise<ImprovementRow[]> => {
  const rows = await prisma.improvementProposal.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      submittedBy: { select: { email: true } },
      reviewedBy: { select: { email: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    proposalId: r.proposalId,
    title: r.title,
    description: r.description,
    category: r.category,
    severity: r.severity,
    agentId: r.agentId,
    routeContext: r.routeContext,
    threadId: r.threadId,
    observedFriction: r.observedFriction,
    conversationExcerpt: r.conversationExcerpt,
    status: r.status,
    submittedByEmail: r.submittedBy.email,
    reviewedByEmail: r.reviewedBy?.email ?? null,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    prioritizedAt: r.prioritizedAt?.toISOString() ?? null,
    backlogItemId: r.backlogItemId,
    rejectionReason: r.rejectionReason,
    verifiedAt: r.verifiedAt?.toISOString() ?? null,
    contributionStatus: r.contributionStatus,
    createdAt: r.createdAt.toISOString(),
  }));
});

export const getImprovementCounts = cache(async (): Promise<Record<string, number>> => {
  const rows = await prisma.improvementProposal.groupBy({
    by: ["status"],
    _count: true,
  });
  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.status] = r._count;
  }
  return counts;
});
```

- [ ] **Step 2: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/improvement-data.ts
git commit -m "feat: add improvement proposal query functions"
```

---

### Task 3: Server actions for governance transitions

**Files:**
- Create: `apps/web/lib/actions/improvements.ts`

- [ ] **Step 1: Create improvements.ts server actions**

Create `apps/web/lib/actions/improvements.ts`:

```typescript
// apps/web/lib/actions/improvements.ts
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import * as crypto from "crypto";

// ─── Allowed transitions ─────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  proposed: ["reviewed", "rejected"],
  reviewed: ["prioritized", "rejected"],
  prioritized: ["in_progress"],
  in_progress: ["implemented"],
  implemented: ["verified"],
};

async function transitionImprovement(
  proposalId: string,
  expectedStatus: string,
  data: Record<string, unknown>,
) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const proposal = await prisma.improvementProposal.findUnique({ where: { proposalId } });
  if (!proposal) return { error: "Not found" };

  const allowed = VALID_TRANSITIONS[proposal.status];
  const targetStatus = data["status"] as string;
  if (!allowed?.includes(targetStatus)) {
    return { error: `Cannot transition from "${proposal.status}" to "${targetStatus}"` };
  }

  await prisma.improvementProposal.update({ where: { proposalId }, data: data as never });

  revalidatePath("/ops/improvements");
  return { success: true, proposal };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function reviewImprovement(proposalId: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };
  return transitionImprovement(proposalId, "proposed", {
    status: "reviewed",
    reviewedById: session.user.id,
    reviewedAt: new Date(),
  });
}

export async function prioritizeImprovement(proposalId: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const proposal = await prisma.improvementProposal.findUnique({ where: { proposalId } });
  if (!proposal) return { error: "Not found" };
  if (proposal.status !== "reviewed") return { error: `Cannot prioritize from "${proposal.status}"` };

  // Create a linked backlog item
  const itemId = `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.backlogItem.create({
    data: {
      itemId,
      title: proposal.title,
      type: "product",
      status: "open",
      body: `${proposal.description}\n\n---\nFrom improvement proposal ${proposal.proposalId}\nCategory: ${proposal.category} | Severity: ${proposal.severity}\nObserved: ${proposal.observedFriction ?? "N/A"}`,
    },
  });

  await prisma.improvementProposal.update({
    where: { proposalId },
    data: {
      status: "prioritized",
      prioritizedAt: new Date(),
      backlogItemId: itemId,
    },
  });

  revalidatePath("/ops/improvements");
  revalidatePath("/ops");
  return { success: true, backlogItemId: itemId };
}

export async function startImprovement(proposalId: string) {
  return transitionImprovement(proposalId, "prioritized", { status: "in_progress" });
}

export async function completeImprovement(proposalId: string) {
  return transitionImprovement(proposalId, "in_progress", { status: "implemented" });
}

export async function rejectImprovement(proposalId: string, reason: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const proposal = await prisma.improvementProposal.findUnique({ where: { proposalId } });
  if (!proposal) return { error: "Not found" };
  if (!["proposed", "reviewed"].includes(proposal.status)) {
    return { error: `Cannot reject from "${proposal.status}"` };
  }

  await prisma.improvementProposal.update({
    where: { proposalId },
    data: {
      status: "rejected",
      rejectionReason: reason,
      reviewedById: session.user.id,
      reviewedAt: new Date(),
    },
  });

  revalidatePath("/ops/improvements");
  return { success: true };
}

export async function verifyImprovement(proposalId: string) {
  return transitionImprovement(proposalId, "implemented", {
    status: "verified",
    verifiedAt: new Date(),
  });
}
```

- [ ] **Step 2: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/improvements.ts
git commit -m "feat: add server actions for improvement governance transitions"
```

---

## Chunk 3: MCP Tool

### Task 4: Add propose_improvement tool

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Add tool definition to PLATFORM_TOOLS array**

In `apps/web/lib/mcp-tools.ts`, add to the `PLATFORM_TOOLS` array (before the closing `]`):

```typescript
  // ─── Feedback Loop ──────────────────────────────────────────────────────────
  {
    name: "propose_improvement",
    description:
      "Propose a platform improvement based on friction or a missing capability observed in this conversation. " +
      "Auto-attributes to the current user. No special permission needed.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the improvement (max 100 chars)" },
        description: { type: "string", description: "What should be improved and why" },
        category: {
          type: "string",
          enum: ["ux_friction", "missing_feature", "performance", "accessibility", "security", "process"],
          description: "Improvement category",
        },
        severity: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Impact severity (default: medium)",
        },
        observedFriction: { type: "string", description: "What you observed that prompted this suggestion" },
      },
      required: ["title", "description", "category"],
    },
    requiredCapability: null,
    executionMode: "proposal",
  },
```

- [ ] **Step 2: Add execution handler in executeTool switch**

In the `executeTool` function's `switch` block (around line 348), add a new case before the `default`:

```typescript
    case "propose_improvement": {
      const proposalId = `IP-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;

      // Capture conversation excerpt (last 5 messages) for evidence
      let conversationExcerpt: string | null = null;
      if (context?.threadId) {
        const recentMessages = await prisma.agentMessage.findMany({
          where: { threadId: context.threadId },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { role: true, content: true },
        });
        if (recentMessages.length > 0) {
          conversationExcerpt = recentMessages
            .reverse()
            .map((m) => `[${m.role}] ${m.content?.slice(0, 200)}`)
            .join("\n");
        }
      }

      const proposal = await prisma.improvementProposal.create({
        data: {
          proposalId,
          title: String(params["title"] ?? "Untitled improvement"),
          description: String(params["description"] ?? ""),
          category: String(params["category"] ?? "missing_feature"),
          severity: String(params["severity"] ?? "medium"),
          observedFriction: typeof params["observedFriction"] === "string" ? params["observedFriction"] : null,
          conversationExcerpt,
          submittedById: userId,
          agentId: context?.agentId ?? "unknown",
          routeContext: context?.routeContext ?? "unknown",
          threadId: context?.threadId ?? null,
        },
      });
      return {
        success: true,
        entityId: proposal.proposalId,
        message: `Improvement proposal ${proposal.proposalId} created: "${proposal.title}". It will be reviewed by a manager.`,
      };
    }
```

- [ ] **Step 3: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/mcp-tools.ts
git commit -m "feat: add propose_improvement MCP tool for feedback loop"
```

---

## Chunk 4: UI — Tab Navigation & Review Page

### Task 5: Ops tab navigation

**Files:**
- Create: `apps/web/components/ops/OpsTabNav.tsx`
- Modify: `apps/web/app/(shell)/ops/page.tsx`

- [ ] **Step 1: Create OpsTabNav component**

Create `apps/web/components/ops/OpsTabNav.tsx`:

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Backlog", href: "/ops" },
  { label: "Improvements", href: "/ops/improvements" },
];

export function OpsTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/ops" ? pathname === "/ops" : pathname.startsWith(href);

  return (
    <div className="flex gap-1 mb-6 border-b border-[var(--dpf-border)]">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={[
            "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
            active(t.href)
              ? "text-white border-b-2 border-[var(--dpf-accent)]"
              : "text-[var(--dpf-muted)] hover:text-white",
          ].join(" ")}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add OpsTabNav to ops page**

In `apps/web/app/(shell)/ops/page.tsx`, add the import at the top:

```typescript
import { OpsTabNav } from "@/components/ops/OpsTabNav";
```

Then insert `<OpsTabNav />` after the header `<div className="mb-6">...</div>` and before `<OpsClient`:

```tsx
      <OpsTabNav />

      <OpsClient
```

- [ ] **Step 3: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ops/OpsTabNav.tsx apps/web/app/(shell)/ops/page.tsx
git commit -m "feat: add ops tab navigation with Backlog and Improvements tabs"
```

---

### Task 6: Improvements client component

**Files:**
- Create: `apps/web/components/ops/ImprovementsClient.tsx`

- [ ] **Step 1: Create ImprovementsClient component**

Create `apps/web/components/ops/ImprovementsClient.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import type { ImprovementRow } from "@/lib/improvement-data";
import {
  reviewImprovement,
  prioritizeImprovement,
  startImprovement,
  completeImprovement,
  rejectImprovement,
  verifyImprovement,
} from "@/lib/actions/improvements";

const STATUS_COLOURS: Record<string, string> = {
  proposed: "#38bdf8",
  reviewed: "#a78bfa",
  prioritized: "#fb923c",
  in_progress: "#fbbf24",
  implemented: "#4ade80",
  verified: "#10b981",
  rejected: "#ef4444",
};

const CATEGORY_LABELS: Record<string, string> = {
  ux_friction: "UX Friction",
  missing_feature: "Missing Feature",
  performance: "Performance",
  accessibility: "Accessibility",
  security: "Security",
  process: "Process",
};

const SEVERITY_COLOURS: Record<string, string> = {
  low: "#8888a0",
  medium: "#38bdf8",
  high: "#fb923c",
  critical: "#ef4444",
};

const STATUS_FILTERS = ["all", "proposed", "reviewed", "prioritized", "in_progress", "implemented", "verified", "rejected"] as const;

type Props = {
  proposals: ImprovementRow[];
};

export function ImprovementsClient({ proposals }: Props) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const filtered = statusFilter === "all"
    ? proposals
    : proposals.filter((p) => p.status === statusFilter);

  function handleAction(action: () => Promise<unknown>) {
    startTransition(async () => {
      await action();
    });
  }

  return (
    <div>
      {/* Status filter bar */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {STATUS_FILTERS.map((s) => {
          const count = s === "all" ? proposals.length : proposals.filter((p) => p.status === s).length;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={[
                "px-2.5 py-1 text-[11px] rounded-full border transition-colors",
                statusFilter === s
                  ? "border-[var(--dpf-accent)] text-white bg-[var(--dpf-accent)]/20"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white",
              ].join(" ")}
            >
              {s === "all" ? "All" : s.replace("_", " ")} ({count})
            </button>
          );
        })}
      </div>

      {/* Proposals list */}
      {filtered.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)] py-8 text-center">
          No improvement proposals {statusFilter !== "all" ? `with status "${statusFilter.replace("_", " ")}"` : "yet"}.
        </p>
      )}

      <div className="space-y-3">
        {filtered.map((p) => (
          <div
            key={p.id}
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono text-[var(--dpf-muted)]">{p.proposalId}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{ background: `${STATUS_COLOURS[p.status] ?? "#888"}22`, color: STATUS_COLOURS[p.status] ?? "#888" }}
                  >
                    {p.status.replace("_", " ")}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ color: SEVERITY_COLOURS[p.severity] ?? "#888" }}
                  >
                    {p.severity}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-white leading-snug">{p.title}</h3>
              </div>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                style={{ background: "rgba(124,140,248,0.15)", color: "#7c8cf8" }}
              >
                {CATEGORY_LABELS[p.category] ?? p.category}
              </span>
            </div>

            {/* Description */}
            <p className="text-xs text-[var(--dpf-muted)] mb-2 line-clamp-3">{p.description}</p>

            {/* Observed friction */}
            {p.observedFriction && (
              <div className="text-[11px] text-[var(--dpf-muted)] mb-2 pl-3 border-l-2 border-[var(--dpf-border)] italic">
                {p.observedFriction}
              </div>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-3 text-[10px] text-[var(--dpf-muted)] mb-3">
              <span>By: {p.submittedByEmail}</span>
              <span>Agent: {p.agentId}</span>
              <span>Page: {p.routeContext}</span>
              <span>{new Date(p.createdAt).toLocaleDateString()}</span>
            </div>

            {/* Rejection reason */}
            {p.status === "rejected" && p.rejectionReason && (
              <div className="text-[11px] text-red-400 mb-2">
                Rejected: {p.rejectionReason}
              </div>
            )}

            {/* Backlog link */}
            {p.backlogItemId && (
              <div className="text-[11px] text-[var(--dpf-accent)] mb-2">
                Linked to backlog item
              </div>
            )}

            {/* Action buttons based on status */}
            <div className="flex gap-2 flex-wrap">
              {p.status === "proposed" && (
                <>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleAction(() => reviewImprovement(p.proposalId))}
                    className="px-2.5 py-1 text-[11px] rounded border border-purple-500/40 text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-50"
                  >
                    Mark Reviewed
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setRejectId(rejectId === p.proposalId ? null : p.proposalId)}
                    className="px-2.5 py-1 text-[11px] rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    Reject
                  </button>
                </>
              )}
              {p.status === "reviewed" && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleAction(() => prioritizeImprovement(p.proposalId))}
                  className="px-2.5 py-1 text-[11px] rounded border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 transition-colors disabled:opacity-50"
                >
                  Prioritize (create backlog item)
                </button>
              )}
              {p.status === "prioritized" && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleAction(() => startImprovement(p.proposalId))}
                  className="px-2.5 py-1 text-[11px] rounded border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 transition-colors disabled:opacity-50"
                >
                  Start Work
                </button>
              )}
              {p.status === "in_progress" && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleAction(() => completeImprovement(p.proposalId))}
                  className="px-2.5 py-1 text-[11px] rounded border border-green-500/40 text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50"
                >
                  Mark Implemented
                </button>
              )}
              {p.status === "implemented" && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleAction(() => verifyImprovement(p.proposalId))}
                  className="px-2.5 py-1 text-[11px] rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                >
                  Verify (confirm fix works)
                </button>
              )}
            </div>

            {/* Reject reason input */}
            {rejectId === p.proposalId && (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  placeholder="Rejection reason..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="flex-1 px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-white placeholder:text-[var(--dpf-muted)]"
                />
                <button
                  type="button"
                  disabled={isPending || !rejectReason.trim()}
                  onClick={() => {
                    handleAction(async () => {
                      await rejectImprovement(p.proposalId, rejectReason.trim());
                      setRejectId(null);
                      setRejectReason("");
                    });
                  }}
                  className="px-2.5 py-1 text-[11px] rounded bg-red-500/20 border border-red-500/40 text-red-400 disabled:opacity-50"
                >
                  Confirm Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ops/ImprovementsClient.tsx
git commit -m "feat: add improvements client component with governance transitions"
```

---

### Task 7: Improvements server page

**Files:**
- Create: `apps/web/app/(shell)/ops/improvements/page.tsx`

- [ ] **Step 1: Create the improvements page**

Create `apps/web/app/(shell)/ops/improvements/page.tsx`:

```typescript
// apps/web/app/(shell)/ops/improvements/page.tsx
import { getImprovementProposals, getImprovementCounts } from "@/lib/improvement-data";
import { ImprovementsClient } from "@/components/ops/ImprovementsClient";
import { OpsTabNav } from "@/components/ops/OpsTabNav";

export default async function ImprovementsPage() {
  const [proposals, counts] = await Promise.all([
    getImprovementProposals(),
    getImprovementCounts(),
  ]);

  const total = proposals.length;
  const actionable = (counts["proposed"] ?? 0) + (counts["reviewed"] ?? 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {total} improvement{total !== 1 ? "s" : ""}
          {actionable > 0 ? ` · ${actionable} need${actionable !== 1 ? "" : "s"} attention` : ""}
        </p>
      </div>

      <OpsTabNav />

      <ImprovementsClient proposals={proposals} />
    </div>
  );
}
```

- [ ] **Step 2: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(shell)/ops/improvements/page.tsx
git commit -m "feat: add /ops/improvements page with governance pipeline view"
```

---

## Chunk 5: Wire Agent Context

### Task 8: Pass agent context to propose_improvement

The `propose_improvement` tool needs the agent ID and thread ID from the conversation context. These are injected as hidden params by the chat execution layer.

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts` (executeTool context param)

- [ ] **Step 1: Extend the context type**

In `apps/web/lib/mcp-tools.ts`, update the `executeTool` function's `context` parameter type from:

```typescript
  context?: { routeContext?: string },
```

to:

```typescript
  context?: { routeContext?: string; agentId?: string; threadId?: string },
```

- [ ] **Step 2: Find where executeTool is called and ensure agentId/threadId are passed**

Search for all `executeTool(` call sites. The main call site is in the proposal approval flow (`apps/web/lib/actions/proposals.ts`). The `agentId` is already on the `AgentActionProposal` record and `threadId` on the thread. Update the call to pass these through the context.

In `apps/web/lib/actions/proposals.ts`, find the `executeTool` call and add to the context object:

```typescript
  agentId: proposal.agentId,
  threadId: proposal.threadId,
```

- [ ] **Step 3: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/mcp-tools.ts apps/web/lib/actions/proposals.ts
git commit -m "feat: pass agent/thread context through to propose_improvement tool"
```

---

## Chunk 6: Verification

### Task 9: Final verification

- [ ] **Step 1: Type check the full web app**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Build the web app**

```bash
pnpm --filter web build
```

Expected: Build succeeds.

- [ ] **Step 3: Manual verification plan**

1. Navigate to `/ops` — verify the Backlog | Improvements tab nav appears
2. Click "Improvements" — page loads with empty state message
3. Open the co-worker panel on any page (e.g., `/portfolio`)
4. Tell the agent: "The page takes too long to load, can you suggest an improvement?"
5. Agent should call `propose_improvement` — approve the proposal card
6. Navigate to `/ops/improvements` — the proposal should appear with "proposed" status
7. Click "Mark Reviewed" — status transitions to "reviewed"
8. Click "Prioritize" — a BacklogItem is created and linked
9. Switch to Backlog tab — the new backlog item should appear
10. Test rejection flow: create another proposal, click "Reject", enter reason, confirm

- [ ] **Step 4: Update backlog item statuses**

```sql
-- Mark completed items
UPDATE "BacklogItem" SET status = 'done' WHERE "itemId" IN ('BI-FEEDBACK-001', 'BI-FEEDBACK-002', 'BI-FEEDBACK-003');
-- BI-FEEDBACK-004 (agent preamble directive) was already done in commit 44e652d
UPDATE "BacklogItem" SET status = 'done' WHERE "itemId" = 'BI-FEEDBACK-004';
```

- [ ] **Step 5: Commit and push**

```bash
git push origin main
```
