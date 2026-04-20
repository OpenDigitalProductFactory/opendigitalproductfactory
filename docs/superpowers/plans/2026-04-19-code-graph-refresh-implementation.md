# Code Graph Refresh Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production slice of the code graph by keeping a committed-file projection fresh in Neo4j and exposing freshness state through Postgres and scheduled jobs.

**Architecture:** Persist graph freshness and per-file index state in Postgres, project committed files into Neo4j as `CodeFile` nodes, and refresh that projection from the host repo through Inngest cron plus host-commit event triggers. Keep the implementation commit-consistent: uncommitted workspace edits are observed for warnings, not indexed.

**Tech Stack:** Prisma, PostgreSQL, Neo4j, Inngest, Vitest, Next.js server utilities

---

## Chunk 1: Data Model And Pure Refresh Logic

### Task 1: Add persisted code-graph state

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260419120000_add_code_graph_index_state/migration.sql`

- [ ] **Step 1: Add failing tests for the refresh logic that depend on persisted state**
- [ ] **Step 2: Add `CodeGraphIndexState` and `CodeGraphFileHash` to Prisma**
- [ ] **Step 3: Generate Prisma client and create the migration**
- [ ] **Step 4: Verify schema generation and migration SQL are clean**

### Task 2: Implement the reconcile service

**Files:**
- Create: `apps/web/lib/integrate/code-graph-refresh.ts`
- Create: `apps/web/lib/integrate/code-graph-refresh.test.ts`
- Modify: `packages/db/src/neo4j-schema.ts`

- [ ] **Step 1: Write failing tests for branch/head detection, dirty-worktree reporting, incremental changed-file selection, and scheduled-job registration helpers**
- [ ] **Step 2: Implement host-repo helpers for current branch, `HEAD`, dirty state, and tracked-file enumeration**
- [ ] **Step 3: Project committed files into Neo4j as `CodeFile` nodes with a dedicated code namespace**
- [ ] **Step 4: Persist index state + file hashes and verify the tests pass**

## Chunk 2: Automation And Commit Triggers

### Task 3: Wire the scheduled reconciler

**Files:**
- Modify: `apps/web/lib/operate/discovery-scheduler.ts`
- Modify: `apps/web/lib/operate/discovery-scheduler.test.ts`
- Modify: `apps/web/lib/queue/inngest-client.ts`
- Create: `apps/web/lib/queue/functions/code-graph-reconcile.ts`
- Modify: `apps/web/lib/queue/functions/index.ts`

- [ ] **Step 1: Write failing tests for scheduled job upsert and queue trigger behavior**
- [ ] **Step 2: Register the `code-graph-reconcile` job on startup with an every-15-min cadence**
- [ ] **Step 3: Add the Inngest function for scheduled and event-driven reconcile runs**
- [ ] **Step 4: Verify the new queue wiring and scheduled job tests pass**

### Task 4: Trigger refresh after host commits

**Files:**
- Modify: `apps/web/lib/integrate/git-utils.ts`
- Modify: `apps/web/lib/integrate/git-utils.test.ts`
- Modify: `apps/web/lib/git-backup.ts`

- [ ] **Step 1: Write failing tests for commit-trigger enqueue helpers**
- [ ] **Step 2: Enqueue a code-graph reconcile after successful host commits in `git-utils.ts`**
- [ ] **Step 3: Enqueue the same reconcile after successful backup commits in `git-backup.ts`**
- [ ] **Step 4: Verify commit-trigger tests pass**

## Chunk 3: Verification

### Task 5: Run focused verification

**Files:**
- Test: `apps/web/lib/integrate/code-graph-refresh.test.ts`
- Test: `apps/web/lib/operate/discovery-scheduler.test.ts`
- Test: `apps/web/lib/integrate/git-utils.test.ts`

- [ ] **Step 1: Run the affected Vitest suites**
- [ ] **Step 2: Run `pnpm --filter @dpf/db exec prisma generate` if schema changes require regeneration**
- [ ] **Step 3: Run `pnpm --filter web exec next build`**
- [ ] **Step 4: Record any remaining gaps before moving to the next graph slice**
