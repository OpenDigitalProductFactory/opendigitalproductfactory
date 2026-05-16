# Business OS Readiness Audit Implementation Plan

| Field | Value |
|-------|-------|
| Status | Draft for execution |
| Spec | [`2026-05-15-business-os-readiness-audit-design.md`](../specs/2026-05-15-business-os-readiness-audit-design.md) |
| Parent | [Business OS Command Center](../specs/2026-05-15-business-os-command-center-design.md) (`/workspace`, `loadWorkspaceCommandCenter`) |
| Surfaces | Inngest cron + CLI script; new `/workspace` panel; one new Prisma model |

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the scheduled Business OS Readiness Audit — score six-C readiness on a 6-hour cadence, detect recurrence, and emit governed writes (`CoworkerCapabilityNeed`, `AgentActionProposal`, `BacklogItem`) through existing substrates when gaps cross threshold.

**Architecture:** One new minimal `WorkspaceReadinessAuditRun` Prisma model holds per-run verdict arrays. A pure verdict engine reuses `deriveReadinessCell` from the shipped command center. An Inngest cron + matching CLI script invoke the engine. A new `ReadinessGapPanel` renders open tracked gaps below the existing six-C matrix on `/workspace`. Write paths route through existing helpers (`submitCoworkerSelfAssessment`, `AgentActionProposal.create`, `BacklogItem.create`); suppression is keyed on a `sourceCell` metadata field carried on every emission.

**Tech Stack:** Next.js 16 App Router (React server components), Prisma 6.x via `@dpf/db`, Inngest 4.x, Vitest, Testing Library, DPF CSS custom properties.

---

## Constraints

- Work in the existing worktree at `D:/DPF/.claude/worktrees/business-os-readiness-audit`. Do not touch unrelated root changes; another concurrent session may be running elsewhere.
- Use TDD: write failing tests before production code.
- One Prisma migration only — name it `<timestamp>_workspace_readiness_audit_run` (timestamp pattern matches existing migrations: `YYYYMMDDHHMMSS`).
- No new top-level route. The panel mounts on `/workspace`.
- No hardcoded gray/white/black/hex colors in new UI. Use `var(--dpf-*)` tokens only.
- DCO sign-off on every commit: use `git commit -s -m ...`.
- Use `git add <specific files>` and `git commit --only <specific files>` style — never `git add -A` — to avoid sweeping concurrent-session changes (per AGENTS.md and Mark's worktree-per-session discipline).
- Every audit-emitted write MUST carry `sourceCell` metadata. Suppression depends on it; without it the audit creates duplicates.
- Run `pnpm --filter web typecheck` before final handoff. Run `pnpm --filter web exec vitest run` for the touched test files between chunks.
- The audit MUST NOT execute side-effect actions directly. Every write goes to a proposal/need/backlog row awaiting human decision.

## File Structure

**Create**

- `apps/web/lib/workspace/readiness-audit.ts` — pure verdict engine + write-path emitters
- `apps/web/lib/workspace/readiness-audit.test.ts` — unit tests for verdict classification, recurrence, suppression
- `apps/web/lib/queue/functions/workspace-readiness-audit.ts` — Inngest scheduled function
- `apps/web/lib/queue/functions/workspace-readiness-audit.test.ts` — function-level test (mock Prisma + emitters)
- `apps/web/scripts/run-readiness-audit.ts` — CLI invocation for first-run testing
- `apps/web/components/workspace/ReadinessGapPanel.tsx` — operator panel
- `apps/web/components/workspace/ReadinessGapPanel.test.tsx` — render test
- `packages/db/prisma/migrations/<timestamp>_workspace_readiness_audit_run/migration.sql` — migration

**Modify**

- `packages/db/prisma/schema.prisma` — add `WorkspaceReadinessAuditRun` model
- `apps/web/lib/queue/functions/index.ts` — register the new Inngest function in `allFunctions`
- `apps/web/app/(shell)/workspace/page.tsx` — render `<ReadinessGapPanel />` after the existing matrix
- `apps/web/package.json` — add `"audit:readiness": "tsx scripts/run-readiness-audit.ts"` to scripts

---

## Chunk 1: Schema And Migration

### Task 1: Add `WorkspaceReadinessAuditRun` Model

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_workspace_readiness_audit_run/migration.sql`

- [ ] **Step 1: Append the model to schema.prisma**

Add at the bottom of the file:

```prisma
model WorkspaceReadinessAuditRun {
  id          String    @id @default(cuid())
  runId       String    @unique
  startedAt   DateTime  @default(now())
  finishedAt  DateTime?
  verdictJson Json      // Array<{ domain, cell, state, verdict, writeRef? }>
  durationMs  Int?
  errorJson   Json?

  @@index([startedAt])
}
```

- [ ] **Step 2: Generate the migration**

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --create-only --name workspace_readiness_audit_run
```

Expected: a new directory under `packages/db/prisma/migrations/<timestamp>_workspace_readiness_audit_run/` containing `migration.sql` with a `CREATE TABLE "WorkspaceReadinessAuditRun" (...)` block and a `CREATE INDEX` on `startedAt`.

- [ ] **Step 3: Apply the migration to the dev database**

```powershell
pnpm --filter @dpf/db exec prisma migrate dev
```

Expected: `Database is now in sync with your schema`. If the dev DB isn't running, the user must start it — do not try to start Docker.

- [ ] **Step 4: Regenerate the Prisma client**

```powershell
pnpm --filter @dpf/db generate
```

Expected: `Generated Prisma Client`. Confirms `prisma.workspaceReadinessAuditRun` is now typed.

- [ ] **Step 5: Document the rollback**

Create `packages/db/prisma/migrations/<timestamp>_workspace_readiness_audit_run/README.md` with the rollback SQL and rationale:

```markdown
# workspace_readiness_audit_run

Adds the `WorkspaceReadinessAuditRun` table for the Business OS Readiness Audit
slice. One row per scheduled audit run; `verdictJson` carries the per-(domain, cell)
verdicts produced by `runReadinessAudit`.

## Rollback

```sql
DROP INDEX IF EXISTS "WorkspaceReadinessAuditRun_startedAt_idx";
DROP TABLE IF EXISTS "WorkspaceReadinessAuditRun";
```

The audit is idempotent and additive — dropping the table loses run history but
does not affect any downstream record (`CoworkerCapabilityNeed`,
`AgentActionProposal`, `BacklogItem` rows survive because `sourceCell` metadata
lives on those rows, not in this table).
```

- [ ] **Step 6: Commit**

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -s -m "feat(workspace): add WorkspaceReadinessAuditRun model"
```

---

## Chunk 2: Pure Verdict Engine

### Task 2: Audit Verdict Types And Per-Cell Rules

**Files:**
- Create: `apps/web/lib/workspace/readiness-audit.ts`
- Create: `apps/web/lib/workspace/readiness-audit.test.ts`

- [ ] **Step 1: Write failing tests for verdict classification**

Create `readiness-audit.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { classifyAuditVerdict, type AuditCellInput } from "./readiness-audit";

const baseInput: AuditCellInput = {
  domain: "ai-workforce",
  cell: "capabilities",
  state: "blocked",
  priorStates: ["blocked", "blocked", "attention", "good", "good"], // 2 of last 5 are bad
  hasOpenDownstreamRecord: false,
};

describe("classifyAuditVerdict", () => {
  it("returns clear for good cells with no prior streak", () => {
    expect(
      classifyAuditVerdict({ ...baseInput, state: "good", priorStates: ["good", "good", "good", "good", "good"] })
        .verdict,
    ).toBe("clear");
  });

  it("returns noted when degraded but recurrence threshold not met", () => {
    expect(
      classifyAuditVerdict({ ...baseInput, priorStates: ["good", "good", "good", "good", "good"] }).verdict,
    ).toBe("noted");
  });

  it("returns escalate-coworker for ai-workforce capabilities blocked with recurrence", () => {
    const verdict = classifyAuditVerdict({
      ...baseInput,
      priorStates: ["blocked", "blocked", "blocked", "good", "good"], // 3 of last 5
    });
    expect(verdict.verdict).toBe("escalate-coworker");
  });

  it("returns suppressed when downstream record is already open", () => {
    expect(
      classifyAuditVerdict({
        ...baseInput,
        priorStates: ["blocked", "blocked", "blocked", "good", "good"],
        hasOpenDownstreamRecord: true,
      }).verdict,
    ).toBe("suppressed");
  });

  it("returns noted for soft signals even with recurrence (default-conservative)", () => {
    // confidence-attention on ai-workforce is `noted only` per spec
    expect(
      classifyAuditVerdict({
        ...baseInput,
        cell: "confidence",
        state: "attention",
        priorStates: ["attention", "attention", "attention", "attention", "attention"],
      }).verdict,
    ).toBe("noted");
  });
});
```

- [ ] **Step 2: Verify RED**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement types and classifier**

In `readiness-audit.ts`:

```ts
import type { SixCKey, ReadinessState } from "./command-center";

export type AuditDomain =
  | "ai-workforce"
  | "customers-delivery"
  | "finance"
  | "compliance"
  | "people"
  | "platform-delivery";

export type AuditVerdict =
  | "clear"
  | "noted"
  | "escalate-coworker"
  | "escalate-action"
  | "escalate-platform"
  | "suppressed";

export type AuditCellInput = {
  domain: AuditDomain;
  cell: SixCKey;
  state: ReadinessState;
  priorStates: ReadinessState[]; // most-recent-first, up to RECURRENCE_WINDOW_RUNS
  hasOpenDownstreamRecord: boolean;
};

export type AuditCellOutput = {
  domain: AuditDomain;
  cell: SixCKey;
  state: ReadinessState;
  verdict: AuditVerdict;
  recurrenceStreak: number; // count of degraded states in priorStates + current
};

export const RECURRENCE_WINDOW_RUNS = 5;
export const RECURRENCE_THRESHOLD = 3;

const DEGRADED: ReadinessState[] = ["attention", "blocked"];

// Per-domain rules: which (cell, state) combinations escalate when recurrence is met.
// Anything not in this map produces `noted` only.
type EscalationRule = {
  triggerStates: ReadinessState[];
  verdict: Exclude<AuditVerdict, "clear" | "noted" | "suppressed">;
};

const ESCALATION_RULES: Record<AuditDomain, Partial<Record<SixCKey, EscalationRule>>> = {
  "ai-workforce": {
    capabilities: { triggerStates: ["blocked"], verdict: "escalate-coworker" },
    connections: { triggerStates: ["attention", "blocked"], verdict: "escalate-platform" },
    containment: { triggerStates: ["blocked"], verdict: "escalate-action" },
  },
  "customers-delivery": {
    capabilities: { triggerStates: ["blocked"], verdict: "escalate-platform" },
  },
  finance: {
    cadence: { triggerStates: ["attention"], verdict: "escalate-action" },
    containment: { triggerStates: ["blocked"], verdict: "escalate-platform" },
  },
  compliance: {
    cadence: { triggerStates: ["attention"], verdict: "escalate-action" },
    containment: { triggerStates: ["blocked"], verdict: "escalate-platform" },
  },
  people: {
    capabilities: { triggerStates: ["blocked"], verdict: "escalate-platform" },
    containment: { triggerStates: ["blocked"], verdict: "escalate-platform" },
  },
  "platform-delivery": {
    containment: { triggerStates: ["attention", "blocked"], verdict: "escalate-action" },
  },
};

export function classifyAuditVerdict(input: AuditCellInput): AuditCellOutput {
  const recurrenceStreak = countDegraded([input.state, ...input.priorStates].slice(0, RECURRENCE_WINDOW_RUNS));

  // Good or unknown with no prior streak: clear.
  if (input.state === "good" || (input.state === "unknown" && recurrenceStreak === 0)) {
    return { ...projectionFields(input), verdict: "clear", recurrenceStreak };
  }

  const rule = ESCALATION_RULES[input.domain]?.[input.cell];

  // No escalation rule: noted only.
  if (!rule || !rule.triggerStates.includes(input.state) || recurrenceStreak < RECURRENCE_THRESHOLD) {
    return { ...projectionFields(input), verdict: "noted", recurrenceStreak };
  }

  // Threshold met: suppress if downstream record already exists, else escalate.
  return {
    ...projectionFields(input),
    verdict: input.hasOpenDownstreamRecord ? "suppressed" : rule.verdict,
    recurrenceStreak,
  };
}

function countDegraded(states: ReadinessState[]): number {
  return states.filter((s) => DEGRADED.includes(s)).length;
}

function projectionFields(input: AuditCellInput): Pick<AuditCellOutput, "domain" | "cell" | "state"> {
  return { domain: input.domain, cell: input.cell, state: input.state };
}
```

- [ ] **Step 4: Verify GREEN**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit.test.ts
```

Expected: PASS (all 5 cases).

- [ ] **Step 5: Add table-driven tests for every domain rule in spec §"Per-Domain Audit Rules"**

Extend `readiness-audit.test.ts` with one `it.each` block covering every (domain, cell) entry in the `ESCALATION_RULES` map: assert that with `RECURRENCE_THRESHOLD` met and no downstream record, the verdict matches the spec table; assert that all cells *not* in the map return `noted` with the same input.

- [ ] **Step 6: Verify GREEN**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/lib/workspace/readiness-audit.ts apps/web/lib/workspace/readiness-audit.test.ts
git commit -s -m "feat(workspace): add readiness audit verdict engine"
```

---

## Chunk 3: Suppression Lookup + Recurrence Reconstruction

### Task 3: Suppression Helpers (Query Downstream Records by `sourceCell`)

**Files:**
- Modify: `apps/web/lib/workspace/readiness-audit.ts`
- Modify: `apps/web/lib/workspace/readiness-audit.test.ts`

- [ ] **Step 1: Write failing tests for suppression-key lookup**

Add tests that exercise:

```ts
import { findOpenDownstreamRecord, type AuditDb } from "./readiness-audit";

const mockDb = {
  coworkerCapabilityNeed: { findFirst: vi.fn() },
  agentActionProposal: { findFirst: vi.fn() },
  backlogItemActivity: { findFirst: vi.fn() },
} as unknown as AuditDb;

describe("findOpenDownstreamRecord", () => {
  it("returns a need ref when an open CoworkerCapabilityNeed matches sourceCell", async () => {
    mockDb.coworkerCapabilityNeed.findFirst = vi.fn().mockResolvedValue({ needId: "CN-123" });
    const ref = await findOpenDownstreamRecord(mockDb, "ai-workforce", "capabilities");
    expect(ref).toEqual({ kind: "capability-need", id: "CN-123" });
  });

  it("returns a backlog ref when a BacklogItemActivity matches and the parent item is triage/open", async () => {
    mockDb.coworkerCapabilityNeed.findFirst = vi.fn().mockResolvedValue(null);
    mockDb.agentActionProposal.findFirst = vi.fn().mockResolvedValue(null);
    mockDb.backlogItemActivity.findFirst = vi.fn().mockResolvedValue({
      backlogItem: { itemId: "BI-ABC12345" },
    });
    const ref = await findOpenDownstreamRecord(mockDb, "finance", "containment");
    expect(ref).toEqual({ kind: "backlog-item", id: "BI-ABC12345" });
  });

  it("returns null when no record matches", async () => {
    mockDb.coworkerCapabilityNeed.findFirst = vi.fn().mockResolvedValue(null);
    mockDb.agentActionProposal.findFirst = vi.fn().mockResolvedValue(null);
    mockDb.backlogItemActivity.findFirst = vi.fn().mockResolvedValue(null);
    expect(await findOpenDownstreamRecord(mockDb, "finance", "cadence")).toBeNull();
  });
});
```

- [ ] **Step 2: Verify RED**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit.test.ts
```

Expected: FAIL — `findOpenDownstreamRecord` not exported.

- [ ] **Step 3: Implement the suppression lookup**

Add to `readiness-audit.ts`:

```ts
import type { PrismaClient } from "@dpf/db";

export type AuditDb = Pick<
  PrismaClient,
  "coworkerCapabilityNeed" | "agentActionProposal" | "backlogItem" | "workspaceReadinessAuditRun"
>;

export type DownstreamRef =
  | { kind: "capability-need"; id: string }
  | { kind: "action-proposal"; id: string }
  | { kind: "backlog-item"; id: string };

export async function findOpenDownstreamRecord(
  db: AuditDb,
  domain: AuditDomain,
  cell: SixCKey,
): Promise<DownstreamRef | null> {
  const cellKey = `${domain}.${cell}`;

  const need = await db.coworkerCapabilityNeed.findFirst({
    where: {
      status: { in: ["submitted", "in-review"] },
      evidenceJson: { path: ["sourceCell"], equals: cellKey } as never,
    },
    select: { needId: true },
  });
  if (need) return { kind: "capability-need", id: need.needId };

  const proposal = await db.agentActionProposal.findFirst({
    where: {
      status: "proposed",
      actionType: "workspace_readiness_remediation",
      parameters: { path: ["sourceCell"], equals: cellKey } as never,
    },
    select: { proposalId: true },
  });
  if (proposal) return { kind: "action-proposal", id: proposal.proposalId };

  // BacklogItem has no JSON-metadata column; the suppression key lives on the
  // companion BacklogItemActivity row (kind="readiness-audit-emission", payload.sourceCell).
  // Query the activity table and verify the parent item is still triage/open.
  const activity = await db.backlogItemActivity.findFirst({
    where: {
      kind: "readiness-audit-emission",
      payload: { path: ["sourceCell"], equals: cellKey } as never,
      backlogItem: { status: { in: ["triage", "open"] } },
    },
    select: { backlogItem: { select: { itemId: true } } },
  });
  if (activity?.backlogItem) return { kind: "backlog-item", id: activity.backlogItem.itemId };

  return null;
}
```

Update the `AuditDb` type to include `backlogItemActivity`:

```ts
export type AuditDb = Pick<
  PrismaClient,
  | "coworkerCapabilityNeed"
  | "agentActionProposal"
  | "backlogItem"
  | "backlogItemActivity"
  | "workspaceReadinessAuditRun"
>;
```

- [ ] **Step 4: Verify GREEN**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add a test for recurrence reconstruction**

Add a test for `loadPriorStates(db, domain, cell, windowSize)` that:

- mocks `workspaceReadinessAuditRun.findMany` returning 5 prior runs with mixed verdictJson arrays
- asserts the function returns the prior states for the given (domain, cell) in most-recent-first order
- handles missing (domain, cell) entries in a run by returning `unknown` for that slot

- [ ] **Step 6: Implement `loadPriorStates`**

```ts
export async function loadPriorStates(
  db: AuditDb,
  domain: AuditDomain,
  cell: SixCKey,
  windowSize: number = RECURRENCE_WINDOW_RUNS,
): Promise<ReadinessState[]> {
  const recentRuns = await db.workspaceReadinessAuditRun.findMany({
    orderBy: { startedAt: "desc" },
    take: windowSize,
    select: { verdictJson: true },
  });

  return recentRuns.map((run) => {
    const verdicts = Array.isArray(run.verdictJson) ? (run.verdictJson as Array<{ domain: string; cell: string; state: ReadinessState }>) : [];
    const match = verdicts.find((v) => v.domain === domain && v.cell === cell);
    return match?.state ?? "unknown";
  });
}
```

- [ ] **Step 7: Verify GREEN**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/web/lib/workspace/readiness-audit.ts apps/web/lib/workspace/readiness-audit.test.ts
git commit -s -m "feat(workspace): add audit suppression and recurrence reconstruction"
```

---

## Chunk 4: Write-Path Emitters

### Task 4: Emit Capability Need, Proposal, And Backlog From Verdicts

**Files:**
- Modify: `apps/web/lib/workspace/readiness-audit.ts`
- Modify: `apps/web/lib/workspace/readiness-audit.test.ts`

- [ ] **Step 1: Write failing tests for each emitter**

Add tests for `emitCapabilityNeed`, `emitActionProposal`, `emitBacklogItem`:

- `emitCapabilityNeed` MUST set `evidenceJson.sourceCell = "<domain>.<cell>"`, MUST set `kind="registry"` (or matching coworker-need kind), MUST set `severity` from the input
- `emitActionProposal` MUST set `actionType="workspace_readiness_remediation"` and `parameters.sourceCell = "<domain>.<cell>"`
- `emitBacklogItem` MUST set `BacklogItem.type="readiness-gap"` and create a companion `BacklogItemActivity` with `kind="readiness-audit-emission"` and `payload.sourceCell = "<domain>.<cell>"`

Each test mocks Prisma and asserts the `create` call shape.

- [ ] **Step 2: Verify RED**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit.test.ts
```

Expected: FAIL — emitters not exported.

- [ ] **Step 3: Implement the emitters**

```ts
export type EmitContext = {
  db: AuditDb;
  auditAgentId: string; // GAID/principal of the audit agent, NOT the session user
  runId: string;
};

export async function emitCapabilityNeed(
  ctx: EmitContext,
  output: AuditCellOutput,
): Promise<DownstreamRef> {
  const sourceCell = cellKey(output.domain, output.cell);
  // Use the existing assessment-service helper rather than raw create.
  const { submitCoworkerSelfAssessment } = await import(
    "@/lib/coworker-self-assessment/assessment-service"
  );
  const result = await submitCoworkerSelfAssessment({
    agentId: ctx.auditAgentId,
    trigger: "readiness-audit",
    routeContext: null,
    verdict: "gaps",
    confidence: "high",
    missionSummary: `Readiness gap on ${sourceCell}`,
    capabilitySummary: null,
    rawPayload: { sourceCell, runId: ctx.runId, recurrenceStreak: output.recurrenceStreak },
    needs: [
      {
        kind: "registry",
        severity: output.state === "blocked" ? "high" : "medium",
        need: `Address recurring ${output.cell} gap on ${output.domain}`,
        blocks: `Workspace readiness audit ${ctx.runId}`,
        evidenceJson: { sourceCell, runId: ctx.runId, recurrenceStreak: output.recurrenceStreak },
      },
    ],
  });
  return { kind: "capability-need", id: result.needIds[0] };
}

export async function emitActionProposal(
  ctx: EmitContext,
  output: AuditCellOutput,
): Promise<DownstreamRef> {
  const sourceCell = cellKey(output.domain, output.cell);
  // Action proposals require a thread+message; for audit-emitted proposals we use
  // a dedicated audit thread. Helper:
  const { createReadinessAuditProposal } = await import(
    "@/lib/workspace/readiness-audit-thread"
  );
  const proposal = await createReadinessAuditProposal(ctx.db, {
    auditAgentId: ctx.auditAgentId,
    runId: ctx.runId,
    sourceCell,
    domain: output.domain,
    cell: output.cell,
    state: output.state,
    recurrenceStreak: output.recurrenceStreak,
  });
  return { kind: "action-proposal", id: proposal.proposalId };
}

export async function emitBacklogItem(
  ctx: EmitContext,
  output: AuditCellOutput,
): Promise<DownstreamRef> {
  const sourceCell = cellKey(output.domain, output.cell);
  // BacklogItem has `type` (not `kind`) and no JSON-metadata column. Store
  // sourceCell on a companion BacklogItemActivity.payload so suppression can
  // find it. Wrap in a transaction so a partial write can't drift.
  const item = await ctx.db.$transaction(async (tx) => {
    const created = await tx.backlogItem.create({
      data: {
        itemId: generateBacklogItemId(),
        title: `Readiness gap: ${output.domain} → ${output.cell}`,
        status: "triage",
        type: "readiness-gap",
        body:
          `Recurring readiness gap detected by the workspace readiness audit. ` +
          `sourceCell=${sourceCell}, runId=${ctx.runId}, recurrenceStreak=${output.recurrenceStreak}.`,
        agentId: ctx.auditAgentId,
      },
      select: { id: true, itemId: true },
    });
    await tx.backlogItemActivity.create({
      data: {
        backlogItemId: created.id,
        kind: "readiness-audit-emission",
        summary: `Readiness audit ${ctx.runId} created this item for ${sourceCell}.`,
        payload: { sourceCell, runId: ctx.runId, recurrenceStreak: output.recurrenceStreak } as never,
        recordedByAgentId: ctx.auditAgentId,
      },
    });
    return created;
  });
  return { kind: "backlog-item", id: item.itemId };
}

function cellKey(domain: AuditDomain, cell: SixCKey): string {
  return `${domain}.${cell}`;
}

function generateBacklogItemId(): string {
  // Match the convention used in apps/web/lib/actions/improvements.ts:63.
  // crypto.randomUUID() is the standard ID source — never Math.random().
  return `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}
```

> **Note on `createReadinessAuditProposal`.** This thin helper lives in a separate file (`readiness-audit-thread.ts`) because creating an `AgentActionProposal` requires a parent `AgentThread` + `AgentMessage`. The helper either creates a dedicated audit thread or reuses one — implement in Step 4 below.

- [ ] **Step 4a: Write a failing test for `createReadinessAuditProposal`**

Create `apps/web/lib/workspace/readiness-audit-thread.test.ts` with a test that mocks Prisma's `agentThread.findFirst`/`create`, `agentMessage.create`, and `agentActionProposal.create`, then calls the helper and asserts:

- the proposal is created with `actionType="workspace_readiness_remediation"`
- `parameters.sourceCell` equals the expected `<domain>.<cell>` key
- the message and thread are linked via `messageId` and `threadId`
- when an existing audit thread is found, no new thread is created (idempotency)

- [ ] **Step 4b: Verify RED**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit-thread.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4c: Implement `createReadinessAuditProposal`**

Create `apps/web/lib/workspace/readiness-audit-thread.ts`. The helper:

- looks up an `AgentThread` with `contextKey="workspace-readiness-audit"` for `userId=<audit-agent's user>`; creates it if absent
- creates an `AgentMessage` with `role="assistant"` and `content` describing the gap, linked to the thread
- creates an `AgentActionProposal` with `actionType="workspace_readiness_remediation"`, `parameters` carrying `{ sourceCell, runId, domain, cell, state, recurrenceStreak }`, linked to the message via `messageId`
- returns `{ proposalId }`

Return signature:

```ts
export async function createReadinessAuditProposal(
  db: AuditDb,
  input: {
    auditAgentId: string;
    runId: string;
    sourceCell: string;
    domain: string;
    cell: string;
    state: string;
    recurrenceStreak: number;
  },
): Promise<{ proposalId: string }>;
```

- [ ] **Step 5: Verify GREEN**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit.test.ts lib/workspace/readiness-audit-thread.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/workspace/readiness-audit.ts apps/web/lib/workspace/readiness-audit.test.ts apps/web/lib/workspace/readiness-audit-thread.ts apps/web/lib/workspace/readiness-audit-thread.test.ts
git commit -s -m "feat(workspace): add audit write-path emitters"
```

---

## Chunk 5: Run Orchestrator

### Task 5: Compose Verdict + Emitter Into A Single Run

**Files:**
- Modify: `apps/web/lib/workspace/readiness-audit.ts`
- Modify: `apps/web/lib/workspace/readiness-audit.test.ts`

- [ ] **Step 1: Write a failing test for `runReadinessAudit`**

Add:

```ts
describe("runReadinessAudit", () => {
  it("creates a WorkspaceReadinessAuditRun row, classifies every (domain, cell), and emits writes for escalate verdicts", async () => {
    const db = buildMockDb({
      // configure mocks to return:
      // - loadWorkspaceCommandCenter readiness with ai-workforce.capabilities=blocked
      // - 5 prior runs all with the same blocked state (recurrence met)
      // - no open downstream record
    });
    const result = await runReadinessAudit({ db, auditAgentId: "audit-agent" });

    expect(result.runId).toBeTruthy();
    expect(result.outputs.some((o) => o.verdict === "escalate-coworker")).toBe(true);
    expect(db.workspaceReadinessAuditRun.create).toHaveBeenCalledOnce();
    expect(db.coworkerCapabilityNeed.create.mock.calls.length + db.agentActionProposal.create.mock.calls.length + db.backlogItem.create.mock.calls.length).toBeGreaterThan(0);
  });

  it("emits zero writes when an open downstream record exists for the same sourceCell", async () => {
    const db = buildMockDb({ downstreamRecordOpen: true });
    await runReadinessAudit({ db, auditAgentId: "audit-agent" });
    expect(db.coworkerCapabilityNeed.create).not.toHaveBeenCalled();
    expect(db.agentActionProposal.create).not.toHaveBeenCalled();
    expect(db.backlogItem.create).not.toHaveBeenCalled();
  });

  it("writes errorJson and rethrows when the projection load fails", async () => {
    const db = buildMockDb({ projectionThrows: new Error("DB down") });
    await expect(runReadinessAudit({ db, auditAgentId: "audit-agent" })).rejects.toThrow("DB down");
    const createCall = (db.workspaceReadinessAuditRun.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(createCall.data.errorJson).toBeTruthy();
  });
});
```

- [ ] **Step 2: Verify RED**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit.test.ts
```

Expected: FAIL — `runReadinessAudit` not exported.

- [ ] **Step 3: Implement `runReadinessAudit`**

```ts
export type RunReadinessAuditInput = {
  db: AuditDb;
  auditAgentId: string;
  now?: Date;
};

export type ReadinessAuditRunResult = {
  runId: string;
  startedAt: Date;
  finishedAt: Date;
  outputs: Array<AuditCellOutput & { writeRef?: DownstreamRef }>;
};

export async function runReadinessAudit(input: RunReadinessAuditInput): Promise<ReadinessAuditRunResult> {
  const startedAt = input.now ?? new Date();
  const runId = `WRA-${startedAt.getTime().toString(36)}`;

  // Create the run row up-front so error paths can update it.
  await input.db.workspaceReadinessAuditRun.create({
    data: { runId, startedAt, verdictJson: [] as never },
  });

  try {
    const { loadWorkspaceCommandCenter } = await import("./command-center");
    const summary = await loadWorkspaceCommandCenter(input.db as never);

    const outputs: Array<AuditCellOutput & { writeRef?: DownstreamRef }> = [];
    const ctx: EmitContext = { db: input.db, auditAgentId: input.auditAgentId, runId };

    for (const row of summary.commandCenter.readiness) {
      for (const cell of row.cells) {
        const priorStates = await loadPriorStates(input.db, row.id as AuditDomain, cell.key);
        const downstream = await findOpenDownstreamRecord(input.db, row.id as AuditDomain, cell.key);
        const verdict = classifyAuditVerdict({
          domain: row.id as AuditDomain,
          cell: cell.key,
          state: cell.state,
          priorStates,
          hasOpenDownstreamRecord: downstream !== null,
        });

        let writeRef: DownstreamRef | undefined;
        switch (verdict.verdict) {
          case "escalate-coworker":
            writeRef = await emitCapabilityNeed(ctx, verdict);
            break;
          case "escalate-action":
            writeRef = await emitActionProposal(ctx, verdict);
            break;
          case "escalate-platform":
            writeRef = await emitBacklogItem(ctx, verdict);
            break;
          case "suppressed":
            writeRef = downstream ?? undefined;
            break;
        }
        outputs.push({ ...verdict, writeRef });
      }
    }

    const finishedAt = new Date();
    await input.db.workspaceReadinessAuditRun.update({
      where: { runId },
      data: {
        finishedAt,
        verdictJson: outputs as never,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
    });

    return { runId, startedAt, finishedAt, outputs };
  } catch (error) {
    await input.db.workspaceReadinessAuditRun.update({
      where: { runId },
      data: {
        finishedAt: new Date(),
        errorJson: { message: error instanceof Error ? error.message : String(error) } as never,
      },
    });
    throw error;
  }
}
```

- [ ] **Step 4: Verify GREEN**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/workspace/readiness-audit.ts apps/web/lib/workspace/readiness-audit.test.ts
git commit -s -m "feat(workspace): add readiness audit run orchestrator"
```

---

## Chunk 6: Inngest Schedule + CLI

### Task 6: Inngest Scheduled Function

**Files:**
- Create: `apps/web/lib/queue/functions/workspace-readiness-audit.ts`
- Create: `apps/web/lib/queue/functions/workspace-readiness-audit.test.ts`
- Modify: `apps/web/lib/queue/functions/index.ts`

- [ ] **Step 1: Write a failing test**

Create `apps/web/lib/queue/functions/workspace-readiness-audit.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

const runReadinessAuditMock = vi.fn().mockResolvedValue({
  runId: "WRA-test",
  startedAt: new Date(),
  finishedAt: new Date(),
  outputs: Array(36).fill({ verdict: "clear" }),
});
const getAgentIdMock = vi.fn().mockResolvedValue("workspace-readiness-audit");

vi.mock("@/lib/workspace/readiness-audit", () => ({
  runReadinessAudit: runReadinessAuditMock,
}));
vi.mock("@/lib/workspace/readiness-audit-identity", () => ({
  getReadinessAuditAgentId: getAgentIdMock,
}));

describe("workspaceReadinessAuditScheduled", () => {
  it("has the expected cron trigger and id", async () => {
    const { workspaceReadinessAuditScheduled } = await import("./workspace-readiness-audit");
    expect(workspaceReadinessAuditScheduled.id()).toContain("workspace/readiness-audit-scheduled");
  });

  it("invokes runReadinessAudit and returns the run summary", async () => {
    const { workspaceReadinessAuditScheduled } = await import("./workspace-readiness-audit");
    // Invoke the step function by extracting and calling it with a fake step harness.
    const step = { run: async (_name: string, fn: () => Promise<unknown>) => fn() };
    const handler = (workspaceReadinessAuditScheduled as never as { fn: (ctx: { step: typeof step }) => Promise<unknown> }).fn;
    const result = await handler({ step });
    expect(result).toMatchObject({ runId: "WRA-test", outputCount: 36 });
    expect(runReadinessAuditMock).toHaveBeenCalledWith({
      db: expect.anything(),
      auditAgentId: "workspace-readiness-audit",
    });
  });
});
```

- [ ] **Step 2: Verify RED**

```powershell
pnpm --filter web exec vitest run lib/queue/functions/workspace-readiness-audit.test.ts
```

Expected: FAIL — function not yet created.

- [ ] **Step 3: Implement the scheduled function**

Mirror the existing `codeGraphReconcileScheduled` pattern at `apps/web/lib/queue/functions/code-graph-reconcile.ts:26-50`:

```ts
import { cron } from "inngest";
import { inngest } from "../inngest-client";

export const workspaceReadinessAuditScheduled = inngest.createFunction(
  {
    id: "workspace/readiness-audit-scheduled",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("0 */6 * * *")], // every 6 hours
  },
  async ({ step }) => {
    return await step.run("run-readiness-audit", async () => {
      const { prisma } = await import("@dpf/db");
      const { runReadinessAudit } = await import("@/lib/workspace/readiness-audit");
      const { getReadinessAuditAgentId } = await import("@/lib/workspace/readiness-audit-identity");
      const auditAgentId = await getReadinessAuditAgentId(prisma);
      const result = await runReadinessAudit({ db: prisma, auditAgentId });
      return { runId: result.runId, outputCount: result.outputs.length };
    });
  },
);
```

- [ ] **Step 4: Implement `getReadinessAuditAgentId` helper**

Create `apps/web/lib/workspace/readiness-audit-identity.ts`:

```ts
import type { PrismaClient } from "@dpf/db";

const AUDIT_AGENT_KEY = "workspace-readiness-audit";

export async function getReadinessAuditAgentId(prisma: PrismaClient): Promise<string> {
  // Resolve the dedicated audit agent. If it does not exist, throw — seed must create it.
  const agent = await prisma.agent.findFirst({
    where: { agentId: AUDIT_AGENT_KEY },
    select: { agentId: true },
  });
  if (!agent) {
    throw new Error(
      `Readiness audit agent not seeded. Expected Agent.agentId="${AUDIT_AGENT_KEY}". Add to packages/db/data/agent_registry.json and re-seed.`,
    );
  }
  return agent.agentId;
}
```

Add the agent to `packages/db/data/agent_registry.json` if it does not exist. The registry uses **snake_case** field names and requires a `config_profile` block — copy the closest existing utility-tier entry as the structural template (see `AGT-ORCH-000` at the top of the file for the canonical shape):

```json
{
  "agent_id": "workspace-readiness-audit",
  "agent_name": "Workspace Readiness Auditor",
  "tier": "utility",
  "value_stream": "cross-cutting",
  "capability_domain": "Detect recurring six-C readiness gaps; emit governed writes (capability needs, action proposals, backlog items) for operator review.",
  "human_supervisor_id": "HR-000",
  "hitl_tier_default": 2,
  "delegates_to": [],
  "escalates_to": "HR-000",
  "it4it_sections": [],
  "status": "active",
  "config_profile": {
    "model_binding": null,
    "execution_runtime": { "type": "scheduled", "timeout_seconds": 300 },
    "token_budget": { "daily_limit": 0, "per_task_limit": 0 },
    "tool_grants": [
      "registry_read",
      "backlog_read",
      "backlog_write"
    ],
    "memory": { "enabled": false }
  }
}
```

> Verify two things before staging: (a) the snake-case field set above still matches the live registry shape (`head -50 packages/db/data/agent_registry.json` from PowerShell, or use the Read tool); (b) the seeder normalizes `agent_id` → `Agent.agentId` so `getReadinessAuditAgentId` can find the row. If seed normalization uppercases or alters the key, use the post-normalization form here.

- [ ] **Step 5: Register the function**

In `apps/web/lib/queue/functions/index.ts`:

```ts
import { workspaceReadinessAuditScheduled } from "./workspace-readiness-audit";

// in allFunctions array:
//   ...,
//   workspaceReadinessAuditScheduled,
```

- [ ] **Step 6: Verify GREEN**

```powershell
pnpm --filter web exec vitest run lib/queue/functions/workspace-readiness-audit.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/lib/queue/functions/workspace-readiness-audit.ts apps/web/lib/queue/functions/workspace-readiness-audit.test.ts apps/web/lib/queue/functions/index.ts apps/web/lib/workspace/readiness-audit-identity.ts packages/db/data/agent_registry.json
git commit -s -m "feat(workspace): schedule readiness audit via Inngest cron"
```

### Task 7: CLI Invocation

**Files:**
- Create: `apps/web/scripts/run-readiness-audit.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Create the script**

```ts
// apps/web/scripts/run-readiness-audit.ts
import { prisma } from "@dpf/db";
import { runReadinessAudit } from "@/lib/workspace/readiness-audit";
import { getReadinessAuditAgentId } from "@/lib/workspace/readiness-audit-identity";

async function main(): Promise<void> {
  const auditAgentId = await getReadinessAuditAgentId(prisma);
  const result = await runReadinessAudit({ db: prisma, auditAgentId });
  process.stdout.write(JSON.stringify({
    runId: result.runId,
    durationMs: result.finishedAt.getTime() - result.startedAt.getTime(),
    outputCount: result.outputs.length,
    escalations: result.outputs.filter((o) => o.verdict.startsWith("escalate")).map((o) => ({
      domain: o.domain,
      cell: o.cell,
      verdict: o.verdict,
      writeRef: o.writeRef,
    })),
  }, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  process.stderr.write(`Readiness audit failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script to `apps/web/package.json`**

In `"scripts"`:

```json
"audit:readiness": "tsx scripts/run-readiness-audit.ts"
```

- [ ] **Step 3: Smoke-test the CLI**

```powershell
pnpm --filter web run audit:readiness
```

Expected: JSON output to stdout with `runId` and at least one entry per (domain, cell). Errors are acceptable here only if the dev DB is not seeded with the audit agent — fix the seed and re-run.

- [ ] **Step 4: Commit**

```powershell
git add apps/web/scripts/run-readiness-audit.ts apps/web/package.json
git commit -s -m "feat(workspace): add readiness audit CLI invocation"
```

---

## Chunk 7: ReadinessGapPanel UI

### Task 8: Operator Panel On `/workspace`

**Files:**
- Create: `apps/web/components/workspace/ReadinessGapPanel.tsx`
- Create: `apps/web/components/workspace/ReadinessGapPanel.test.tsx`
- Modify: `apps/web/app/(shell)/workspace/page.tsx`

- [ ] **Step 1: Write a render test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReadinessGapPanel } from "./ReadinessGapPanel";

describe("ReadinessGapPanel", () => {
  it("renders one row per tracked gap with link to downstream record", () => {
    render(
      <ReadinessGapPanel
        lastRunAt={new Date("2026-05-15T12:00:00Z")}
        gaps={[
          {
            domain: "ai-workforce",
            cell: "capabilities",
            state: "blocked",
            recurrenceStreak: 3,
            writeRef: { kind: "capability-need", id: "CN-123" },
            href: "/platform/ai/capability-needs?id=CN-123",
          },
        ]}
      />,
    );
    expect(screen.getByText(/ai-workforce/i)).toBeInTheDocument();
    expect(screen.getByText(/capabilities/i)).toBeInTheDocument();
    expect(screen.getByText(/CN-123/i)).toBeInTheDocument();
  });

  it("renders nothing meaningful when gaps array is empty", () => {
    const { container } = render(<ReadinessGapPanel lastRunAt={null} gaps={[]} />);
    expect(container.textContent).not.toContain("CN-");
  });
});
```

- [ ] **Step 2: Verify RED**

```powershell
pnpm --filter web exec vitest run components/workspace/ReadinessGapPanel.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement the component**

Quiet, tabular layout matching the spec mockup. Use `var(--dpf-*)` tokens only. No card-in-card nesting. Empty state collapses.

```tsx
// apps/web/components/workspace/ReadinessGapPanel.tsx
import Link from "next/link";

export type ReadinessGapItem = {
  domain: string;
  cell: string;
  state: "good" | "attention" | "blocked" | "unknown";
  recurrenceStreak: number;
  writeRef: { kind: "capability-need" | "action-proposal" | "backlog-item"; id: string };
  href: string;
};

export type ReadinessGapPanelProps = {
  lastRunAt: Date | null;
  gaps: ReadinessGapItem[];
};

export function ReadinessGapPanel({ lastRunAt, gaps }: ReadinessGapPanelProps) {
  if (gaps.length === 0) {
    return (
      <section className="mt-6 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3">
        <header className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Tracked Readiness Gaps</h2>
          <span className="text-xs text-[var(--dpf-muted)]">
            {lastRunAt ? `Last audit: ${formatRelative(lastRunAt)}` : "No audit run yet"}
          </span>
        </header>
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">No tracked readiness gaps.</p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <header className="flex items-baseline justify-between border-b border-[var(--dpf-border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Tracked Readiness Gaps</h2>
        <span className="text-xs text-[var(--dpf-muted)]">
          Last audit: {lastRunAt ? formatRelative(lastRunAt) : "n/a"}
        </span>
      </header>
      <ul className="divide-y divide-[var(--dpf-border)]">
        {gaps.map((g, idx) => (
          <li key={`${g.domain}.${g.cell}.${idx}`} className="px-4 py-2 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-[var(--dpf-text)]">
                {g.domain} → {g.cell}
              </span>
              <span className="text-xs text-[var(--dpf-muted)]">
                {g.state} · streak {g.recurrenceStreak}
              </span>
            </div>
            <div className="mt-1 text-xs text-[var(--dpf-muted)]">
              Open: <Link className="underline" href={g.href}>{g.writeRef.id}</Link> ({g.writeRef.kind})
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
```

- [ ] **Step 4: Verify GREEN**

```powershell
pnpm --filter web exec vitest run components/workspace/ReadinessGapPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Search for prohibited color classes**

Use the harness Grep tool (or `Select-String` from PowerShell if running by hand) — direct `rg` is often not on PATH on Windows:

```powershell
Select-String -Pattern "text-gray-|bg-gray-|border-gray-|text-white|text-black|#[0-9a-fA-F]{3,6}" -Path apps\web\components\workspace\ReadinessGapPanel.tsx
```

Expected: no matches. All colors must come from `var(--dpf-*)` tokens.

- [ ] **Step 6a: Write a failing test for `loadOpenReadinessGaps`**

Add a test to `readiness-audit.test.ts` that mocks `workspaceReadinessAuditRun.findFirst` to return a run whose `verdictJson` contains one `escalate-coworker` entry with a `writeRef`. Assert:

- the loader returns `lastRunAt` from the row
- the `items` array contains exactly one entry with `domain`, `cell`, `state`, `recurrenceStreak`, `writeRef`, and `href`
- the `href` resolves to `/platform/ai/capability-needs?id=<id>` for `capability-need`, `/workspace/proposals/<id>` for `action-proposal`, and `/backlog/<id>` for `backlog-item`
- when no audit run exists, returns `{ lastRunAt: null, items: [] }`

- [ ] **Step 6b: Verify RED**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit.test.ts
```

Expected: FAIL — `loadOpenReadinessGaps` not exported.

- [ ] **Step 6c: Implement `loadOpenReadinessGaps`**

In `apps/web/lib/workspace/readiness-audit.ts`:

```ts
export type LoadedReadinessGaps = {
  lastRunAt: Date | null;
  items: Array<{
    domain: string;
    cell: string;
    state: ReadinessState;
    recurrenceStreak: number;
    writeRef: DownstreamRef;
    href: string;
  }>;
};

export async function loadOpenReadinessGaps(db: AuditDb): Promise<LoadedReadinessGaps> {
  const lastRun = await db.workspaceReadinessAuditRun.findFirst({
    orderBy: { startedAt: "desc" },
    select: { startedAt: true, verdictJson: true },
  });
  if (!lastRun) return { lastRunAt: null, items: [] };

  const verdicts = (Array.isArray(lastRun.verdictJson) ? lastRun.verdictJson : []) as Array<
    AuditCellOutput & { writeRef?: DownstreamRef }
  >;

  const items = verdicts
    .filter((v) => v.writeRef && v.verdict.startsWith("escalate"))
    .map((v) => ({
      domain: v.domain,
      cell: v.cell,
      state: v.state,
      recurrenceStreak: v.recurrenceStreak,
      writeRef: v.writeRef!,
      href: refToHref(v.writeRef!),
    }));

  return { lastRunAt: lastRun.startedAt, items };
}

function refToHref(ref: DownstreamRef): string {
  switch (ref.kind) {
    case "capability-need":
      return `/platform/ai/capability-needs?id=${ref.id}`;
    case "action-proposal":
      return `/workspace/proposals/${ref.id}`;
    case "backlog-item":
      return `/backlog/${ref.id}`;
  }
}
```

- [ ] **Step 6d: Verify GREEN**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit.test.ts
```

Expected: PASS.

- [ ] **Step 7: Mount the panel on `/workspace`**

In `apps/web/app/(shell)/workspace/page.tsx`:

```tsx
import { ReadinessGapPanel } from "@/components/workspace/ReadinessGapPanel";
import { loadOpenReadinessGaps } from "@/lib/workspace/readiness-audit";

// inside the component:
const readinessGaps = await loadOpenReadinessGaps(prisma);

// in JSX, after <BusinessCommandCenter />:
<ReadinessGapPanel lastRunAt={readinessGaps.lastRunAt} gaps={readinessGaps.items} />
```

- [ ] **Step 8: Verify GREEN**

```powershell
pnpm --filter web exec vitest run components/workspace/ReadinessGapPanel.test.tsx lib/workspace/readiness-audit.test.ts 'app/(shell)/workspace/page.test.tsx'
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add apps/web/components/workspace/ReadinessGapPanel.tsx apps/web/components/workspace/ReadinessGapPanel.test.tsx apps/web/lib/workspace/readiness-audit.ts apps/web/lib/workspace/readiness-audit.test.ts 'apps/web/app/(shell)/workspace/page.tsx'
git commit -s -m "feat(workspace): render tracked readiness gaps on /workspace"
```

---

## Chunk 8: Verification And First-Run

### Task 9: Full Verification

**Files:**
- No source edits unless verification exposes a bug.

- [ ] **Step 1: Run focused tests**

```powershell
pnpm --filter web exec vitest run lib/workspace/readiness-audit.test.ts lib/workspace/readiness-audit-thread.test.ts lib/queue/functions/workspace-readiness-audit.test.ts components/workspace/ReadinessGapPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full web typecheck**

```powershell
pnpm --filter web typecheck
```

Expected: PASS. Fix any errors before continuing.

- [ ] **Step 3: Run @dpf/db typecheck (catches Prisma-client/schema mismatches)**

```powershell
pnpm --filter @dpf/db typecheck
```

Expected: PASS.

- [ ] **Step 4: Run production build**

```powershell
pnpm --filter web build
```

Expected: PASS, or a pre-existing unrelated failure documented with exact output.

- [ ] **Step 5: First-run smoke test against the dev DB**

```powershell
pnpm --filter web run audit:readiness
```

Expected: JSON with `runId`, `outputCount` ≥ 36 (six domains × six cells), and an `escalations` array. Verify:

- exactly **one new** `WorkspaceReadinessAuditRun` row was written by this invocation, with the returned `runId` and a non-null `finishedAt`
- if any escalation fired, the corresponding downstream row exists with `sourceCell` populated in the right place:
  - `CoworkerCapabilityNeed.evidenceJson.sourceCell`
  - `AgentActionProposal.parameters.sourceCell`
  - `BacklogItemActivity.payload.sourceCell` (the parent `BacklogItem.type` is `"readiness-gap"`)
- a second invocation of the CLI produces **a second `WorkspaceReadinessAuditRun` row** (one per run) and **zero new** downstream writes — confirming both per-run uniqueness and suppression by `sourceCell`

- [ ] **Step 6: UX verification**

Use the production-served portal per `AGENTS.md`:

1. Read `ADMIN_PASSWORD` from repo-root `.env`.
2. Open the configured `AUTH_URL` or `APP_URL`.
3. Login as `admin@dpf.local`.
4. Visit `/workspace`.
5. Verify the new `ReadinessGapPanel` renders below the six-C matrix.
6. If at least one gap exists, verify the row links to the downstream record (capability need / proposal / backlog item).
7. If no gaps exist, verify the panel either renders an empty-state note or collapses cleanly.
8. Check browser console for runtime errors.

- [ ] **Step 7: Commit verification fixes**

Only if fixes were required:

```powershell
git add <changed-files>
git commit -s -m "fix(workspace): stabilize readiness audit verification"
```

---

## Completion Checklist

Procedural:

- [ ] Spec exists at [`docs/superpowers/specs/2026-05-15-business-os-readiness-audit-design.md`](../specs/2026-05-15-business-os-readiness-audit-design.md)
- [ ] Plan exists at [`docs/superpowers/plans/2026-05-15-business-os-readiness-audit.md`](2026-05-15-business-os-readiness-audit.md)
- [ ] Exactly one new Prisma model and one migration
- [ ] All unit tests pass
- [ ] `pnpm --filter web typecheck` passes
- [ ] `pnpm --filter @dpf/db typecheck` passes
- [ ] Production build passes (or pre-existing blocker documented)
- [ ] CLI smoke test produces a `WorkspaceReadinessAuditRun` row
- [ ] Second CLI run produces zero new escalations (suppression verified)
- [ ] `/workspace` verified in browser
- [ ] Branch has only readiness-audit files staged/committed (verified with `git status --short`)

Spec acceptance — each item maps to a numbered bullet in the spec's "Acceptance Criteria" section:

- [ ] `WorkspaceReadinessAuditRun` model and migration land cleanly; rollback documented in the migration directory
- [ ] Audit job runs on a 6-hour Inngest schedule and persists exactly one row per run
- [ ] Recurrence detection passes a test that simulates 5 prior runs and asserts the correct verdict for `3 of last 5`, `2 of last 5`, and `0 of last 5` cases (Task 2 Step 5; Chunk 5 Step 1)
- [ ] `submit_coworker_capability_need` invocation observed; `CoworkerCapabilityNeed` row created with `evidenceJson.sourceCell` populated (Task 4)
- [ ] `AgentActionProposal` row created with `actionType="workspace_readiness_remediation"` and `parameters.sourceCell` populated (Task 4)
- [ ] `BacklogItem` row created with `type="readiness-gap"`; companion `BacklogItemActivity` row carries `kind="readiness-audit-emission"` and `payload.sourceCell` (Task 4)
- [ ] Suppression test: a second run with the same gap and an open downstream record creates **zero** new writes (Task 3 + Chunk 8 Step 5)
- [ ] `ReadinessGapPanel` renders on `/workspace` with at least one open gap; renders empty-state cleanly with zero gaps (Task 8)
- [ ] All audit writes carry the audit agent's GAID/principal — not the session user's — verifiable via `ToolExecution.actingPrincipalId` (Task 6 Step 3 wires `auditAgentId`)
- [ ] Audit never executes side-effect actions directly; every write goes to a proposal/need/backlog row (enforced by emitter design in Task 4)
- [ ] Only `var(--dpf-*)` styling tokens are used in the new component (Task 8 Step 5)
- [ ] Unit tests cover every per-domain rule table entry (Task 2 Step 5)
