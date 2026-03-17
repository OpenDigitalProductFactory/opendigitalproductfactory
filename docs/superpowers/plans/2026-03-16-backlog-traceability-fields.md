# Backlog & Epic Traceability Fields Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add submitter attribution (`submittedById` + `agentId`) and completion timestamp (`completedAt`) to both Epic and BacklogItem models, display them in the UI, and set them in all creation/update code paths.

**Architecture:** Schema migration adds nullable fields to Epic (3 new) and BacklogItem (1 new — `agentId`, since `submittedById` and `completedAt` already exist). Server actions and MCP tool handlers set attribution on create and manage `completedAt` on status transitions. UI components show metadata inline.

**Tech Stack:** Prisma ORM, PostgreSQL, Next.js server actions, Vitest, existing MCP tool system.

**Spec:** `docs/superpowers/specs/2026-03-16-backlog-traceability-fields-design.md`

---

## Current State

**BacklogItem** already has:
- `submittedById` + `submittedBy` relation (schema + query + type + UI display)
- `completedAt` (schema + query + type + UI display)
- MCP `create_backlog_item` sets `submittedById` and `completedAt`
- MCP `update_backlog_item` handles `completedAt` for `done` (but NOT `deferred`)
- Missing: `agentId` field

**Epic** has NONE of the traceability fields.

**`register_tech_debt`** MCP handler creates BacklogItems without `submittedById` or `agentId`.

**`createBacklogItem` server action** (UI path) does NOT set `submittedById`.

---

## Chunk 1: Schema, Migration, Server Actions, MCP Tools, UI

### Task 1: Schema Migration — Add Fields

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260316210000_add_traceability_fields/migration.sql`

- [ ] **Step 1: Add `agentId` to BacklogItem and traceability fields to Epic in schema**

In `packages/db/prisma/schema.prisma`:

Add to `BacklogItem` model (after `completedAt`):
```prisma
  agentId         String?   // agent ID if created by AI coworker
```

Replace the `Epic` model with:
```prisma
model Epic {
  id              String          @id @default(cuid())
  epicId          String          @unique
  title           String
  description     String?
  status          String          @default("open")
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  submittedById   String?
  submittedBy     User?           @relation("EpicSubmissions", fields: [submittedById], references: [id])
  agentId         String?
  completedAt     DateTime?

  portfolios  EpicPortfolio[]
  items       BacklogItem[]
}
```

Add to `User` model (after `backlogSubmissions`):
```prisma
  epicSubmissions        Epic[]            @relation("EpicSubmissions")
```

- [ ] **Step 2: Create migration SQL**

Create `packages/db/prisma/migrations/20260316210000_add_traceability_fields/migration.sql`:
```sql
-- Add agentId to BacklogItem
ALTER TABLE "BacklogItem" ADD COLUMN "agentId" TEXT;

-- Add traceability fields to Epic
ALTER TABLE "Epic" ADD COLUMN "submittedById" TEXT;
ALTER TABLE "Epic" ADD COLUMN "agentId" TEXT;
ALTER TABLE "Epic" ADD COLUMN "completedAt" TIMESTAMP(3);

-- Add foreign key for Epic.submittedById
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Apply migration and regenerate client**

```bash
cd packages/db && DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx prisma migrate deploy
cd packages/db && DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx prisma generate
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260316210000_add_traceability_fields/
git commit -m "feat: add traceability fields to Epic and agentId to BacklogItem"
```

---

### Task 2: Update Types and Data Queries

**Files:**
- Modify: `apps/web/lib/backlog.ts`
- Modify: `apps/web/lib/backlog-data.ts`

- [ ] **Step 1: Add `agentId` to `BacklogItemWithRelations` type**

In `apps/web/lib/backlog.ts`, add `agentId: string | null;` to the `BacklogItemWithRelations` type (after `completedAt`).

- [ ] **Step 2: Add traceability fields to `EpicWithRelations` type**

In `apps/web/lib/backlog.ts`, add to the `EpicWithRelations` type (after `updatedAt`):
```ts
  submittedBy: { email: string } | null;
  agentId: string | null;
  completedAt: Date | null;
```

- [ ] **Step 3: Update `getBacklogItems` query to select `agentId`**

In `apps/web/lib/backlog-data.ts`, add `agentId: true,` to the `getBacklogItems` select clause (after `completedAt: true`).

- [ ] **Step 4: Update `getEpics` query to select traceability fields**

In `apps/web/lib/backlog-data.ts`, add to the `getEpics` select clause (after `updatedAt: true`):
```ts
      submittedBy: { select: { email: true } },
      agentId: true,
      completedAt: true,
```

Also add to the nested `items` select inside `getEpics` (after `completedAt: true`):
```ts
          agentId: true,
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/backlog.ts apps/web/lib/backlog-data.ts
git commit -m "feat: extend types and queries for traceability fields"
```

---

### Task 3: Update Server Actions — Attribution + completedAt

**Files:**
- Modify: `apps/web/lib/actions/backlog.ts`

- [ ] **Step 1: Create helper to get session user ID**

Add at the top of `apps/web/lib/actions/backlog.ts` (after `requireManageBacklog`):

```ts
async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
```

- [ ] **Step 2: Update `createBacklogItem` to set `submittedById`**

In the `createData` object, add:
```ts
    submittedById:    await getSessionUserId(),
```

- [ ] **Step 3: Update `updateBacklogItem` to handle `completedAt` transitions**

After setting `updateData`, add completedAt logic. Read the current item first to check status transition:

Replace `updateBacklogItem`:
```ts
export async function updateBacklogItem(id: string, input: BacklogItemInput): Promise<void> {
  await requireManageBacklog();
  const error = validateBacklogInput(input);
  if (error) throw new Error(error);

  const existing = await prisma.backlogItem.findUnique({ where: { id }, select: { status: true } });

  const isNowDone = input.status === "done" || input.status === "deferred";
  const wasDone = existing?.status === "done" || existing?.status === "deferred";

  const updateData = {
    title:            input.title.trim(),
    type:             input.type,
    status:           input.status,
    priority:         input.priority ?? null,
    taxonomyNodeId:   input.taxonomyNodeId ?? null,
    digitalProductId: input.digitalProductId ?? null,
    epicId:           input.epicId ?? null,
    ...(input.body !== undefined && { body: input.body.trim() || null }),
    ...(isNowDone && !wasDone ? { completedAt: new Date() } : {}),
    ...(!isNowDone && wasDone ? { completedAt: null } : {}),
  };
  await prisma.backlogItem.update({ where: { id }, data: updateData });
}
```

- [ ] **Step 4: Update `createEpic` to set `submittedById`**

In the `tx.epic.create` data object, add:
```ts
        submittedById: await getSessionUserId(),
```

- [ ] **Step 5: Update `updateEpic` to handle `completedAt` transitions**

Read current status and set completedAt. Replace `updateEpic`:
```ts
export async function updateEpic(id: string, input: EpicInput): Promise<void> {
  await requireManageBacklog();
  const error = validateEpicInput(input);
  if (error) throw new Error(error);

  const existing = await prisma.epic.findUnique({ where: { id }, select: { status: true } });
  const isNowDone = input.status === "done";
  const wasDone = existing?.status === "done";

  await prisma.$transaction(async (tx) => {
    await tx.epic.update({
      where: { id },
      data: {
        title:  input.title.trim(),
        status: input.status,
        ...(input.description !== undefined && {
          description: input.description.trim() || null,
        }),
        ...(isNowDone && !wasDone ? { completedAt: new Date() } : {}),
        ...(!isNowDone && wasDone ? { completedAt: null } : {}),
      },
    });
    await tx.epicPortfolio.deleteMany({ where: { epicId: id } });
    if (input.portfolioIds.length > 0) {
      await tx.epicPortfolio.createMany({
        data: input.portfolioIds.map((portfolioId) => ({ epicId: id, portfolioId })),
      });
    }
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/actions/backlog.ts
git commit -m "feat: set submittedById and completedAt in backlog server actions"
```

---

### Task 4: Update MCP Tool Handlers

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Add `agentId` to `create_backlog_item` handler**

In the `create_backlog_item` case (~line 450), the `prisma.backlogItem.create` data object already has `submittedById: userId`. Add `agentId` from the execution context. The `executeTool` function receives `agentId` — check the function signature and pass it through.

Find the `executeTool` function signature. If it doesn't have `agentId`, add it. Then in `create_backlog_item` data, add:
```ts
          agentId: agentId ?? null,
```

- [ ] **Step 2: Handle `deferred` in `update_backlog_item` completedAt logic**

In the `update_backlog_item` case (~line 470-478), the current code only handles `done`. Update to also handle `deferred`:

Replace the completedAt logic:
```ts
        const isTerminal = params["status"] === "done" || params["status"] === "deferred";
        const wasTerminal = existing.status === "done" || existing.status === "deferred";
        if (isTerminal && !wasTerminal) {
          data["completedAt"] = new Date();
        } else if (!isTerminal && wasTerminal) {
          data["completedAt"] = null;
        }
```

- [ ] **Step 3: Add attribution to `register_tech_debt` handler**

In the `register_tech_debt` case (~line 741-742), the `prisma.backlogItem.create` data does not include `submittedById` or `agentId`. Add them:

```ts
      await prisma.backlogItem.create({
        data: {
          itemId: item.itemId,
          title: item.title,
          type: item.type,
          status: item.status,
          body: item.body,
          priority: item.priority,
          submittedById: userId,
          agentId: agentId ?? null,
          ...(refactorEpic ? { epicId: refactorEpic.id } : {}),
        },
      });
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/mcp-tools.ts
git commit -m "feat: add agentId attribution and deferred completedAt to MCP tools"
```

---

### Task 5: Update UI — EpicCard and BacklogItemRow Metadata

**Files:**
- Modify: `apps/web/components/ops/EpicCard.tsx`
- Modify: `apps/web/components/ops/BacklogItemRow.tsx`

- [ ] **Step 1: Import AGENT_NAME_MAP in EpicCard**

Add import to `apps/web/components/ops/EpicCard.tsx`:
```ts
import { AGENT_NAME_MAP } from "@/lib/agent-routing";
```

Check that `AGENT_NAME_MAP` is exported from `agent-routing.ts`. If not, find the equivalent export and use it.

- [ ] **Step 2: Add submitter + date metadata to EpicCard title row**

In `EpicCard.tsx`, after the title `<p>` tag (~line 90-93), add a metadata line:

```tsx
        <p className="flex-1 min-w-0 text-xs text-white truncate">
          {epic.title}
          <span className="ml-1.5 text-[9px] text-[var(--dpf-muted)] tabular-nums">({totalCount})</span>
          <span className="ml-2 text-[9px] text-[var(--dpf-muted)]">
            {new Date(epic.createdAt).toLocaleDateString()}
            {epic.agentId ? ` · ${AGENT_NAME_MAP[epic.agentId] ?? epic.agentId}` : ""}
            {epic.submittedBy ? ` · ${epic.submittedBy.email}` : ""}
            {epic.completedAt ? ` · done ${new Date(epic.completedAt).toLocaleDateString()}` : ""}
          </span>
        </p>
```

- [ ] **Step 3: Add agentId display to BacklogItemRow**

In `BacklogItemRow.tsx`, the metadata line (~line 37-43) already shows `submittedBy.email`, `createdAt`, and `completedAt`. Add `agentId`:

Import at top:
```ts
import { AGENT_NAME_MAP } from "@/lib/agent-routing";
```

Update the metadata `<p>` tag to include agentId:
```tsx
        <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5 truncate">
          {item.taxonomyNode?.nodeId ?? "—"}
          {item.digitalProduct ? ` · ${item.digitalProduct.name}` : ""}
          {item.agentId ? ` · ${AGENT_NAME_MAP[item.agentId] ?? item.agentId}` : ""}
          {item.submittedBy ? ` · by ${item.submittedBy.email}` : ""}
          {" · "}{new Date(item.createdAt).toLocaleDateString()}
          {item.completedAt ? ` · done ${new Date(item.completedAt).toLocaleDateString()}` : ""}
        </p>
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ops/EpicCard.tsx apps/web/components/ops/BacklogItemRow.tsx
git commit -m "feat: show submitter, agent, and completion date in epic/backlog rows"
```

---

### Task 6: Update Edit Panels — Read-Only Metadata

**Files:**
- Modify: `apps/web/components/ops/EpicPanel.tsx`
- Modify: `apps/web/components/ops/BacklogPanel.tsx`

- [ ] **Step 1: Add metadata section to EpicPanel**

In `apps/web/components/ops/EpicPanel.tsx`, read the file first. Add a read-only metadata section above the footer (before the `{/* Footer */}` comment). Import `AGENT_NAME_MAP`.

```tsx
        {/* Metadata (read-only) */}
        {epic && (
          <div className="px-5 py-3 border-t border-[var(--dpf-border)] space-y-1">
            <p className="text-[10px] text-[var(--dpf-muted)]">
              Created: {new Date(epic.createdAt).toLocaleString()}
              {epic.submittedBy ? ` by ${epic.submittedBy.email}` : ""}
              {epic.agentId ? ` (${AGENT_NAME_MAP[epic.agentId] ?? epic.agentId})` : ""}
            </p>
            <p className="text-[10px] text-[var(--dpf-muted)]">
              Completed: {epic.completedAt ? new Date(epic.completedAt).toLocaleString() : "—"}
            </p>
          </div>
        )}
```

- [ ] **Step 2: Add metadata section to BacklogPanel**

Same pattern in `apps/web/components/ops/BacklogPanel.tsx`. Add above the footer:

```tsx
        {/* Metadata (read-only) */}
        {item && (
          <div className="px-5 py-3 border-t border-[var(--dpf-border)] space-y-1">
            <p className="text-[10px] text-[var(--dpf-muted)]">
              Created: {new Date(item.createdAt).toLocaleString()}
              {item.submittedBy ? ` by ${item.submittedBy.email}` : ""}
              {item.agentId ? ` (${AGENT_NAME_MAP[item.agentId] ?? item.agentId})` : ""}
            </p>
            <p className="text-[10px] text-[var(--dpf-muted)]">
              Completed: {item.completedAt ? new Date(item.completedAt).toLocaleString() : "—"}
            </p>
          </div>
        )}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ops/EpicPanel.tsx apps/web/components/ops/BacklogPanel.tsx
git commit -m "feat: show traceability metadata in backlog/epic edit panels"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run tests**

```bash
cd apps/web && pnpm test
```

Check that no new failures were introduced.

- [ ] **Step 2: Verify on the ops page**

- Navigate to `/ops`
- Epics should show created date, submitter email, and agent name (if applicable)
- Backlog items should show the same
- Edit an epic → change status to "done" → save → verify `completedAt` appears
- Change it back to "open" → verify `completedAt` clears
- Edit panels should show read-only metadata section at bottom

- [ ] **Step 3: Update epic status in DB**

```bash
cd packages/db && DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx prisma db execute --stdin --schema prisma/schema.prisma <<'SQL'
UPDATE "Epic" SET "completedAt" = NOW() WHERE status = 'done' AND "completedAt" IS NULL;
SQL
```

- [ ] **Step 4: Push**

```bash
git push
```
