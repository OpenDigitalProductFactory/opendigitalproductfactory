# Hive Scout → WikiPage Synthesis: Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a nullable `taskRunId` foreign key to `WikiIngestEvent` and thread it through `recordIngestEvent` + `commitIngestProposal` so a future Hive Scout autonomous run (Slice 3) can mark each wiki commit with its originating `TaskRun.id`. AI Operations Map projection (Slice 4) queries this single column to attribute wiki write-through to the originating coworker run.

**Architecture:** One nullable column on the per-commit audit primitive (`WikiIngestEvent`), one optional field on the two input types that flow into it (`RecordIngestEventInput`, `CommitProposalInput`). No new tables, no new helpers, no behavior change on existing callers. The founder-kernel seed and file-source ingest pipelines continue to pass nothing and produce null `taskRunId` rows.

**Tech Stack:** Prisma (PostgreSQL migration + generated client), TypeScript, Vitest. No new dependencies. No new MCP tools. No new grant keys.

**Spec:** [docs/superpowers/specs/2026-05-14-hive-scout-wikipage-synthesis-design.md §7 Slice 2 + §4.6](../specs/2026-05-14-hive-scout-wikipage-synthesis-design.md)

**Predecessor:** Slice 1 ([2026-05-14-hive-scout-wikipage-synthesis-slice-1.md](2026-05-14-hive-scout-wikipage-synthesis-slice-1.md), PR #646).

---

## Scope Boundaries

**In scope:**
- Add `taskRunId String?` + index `(taskRunId, createdAt)` to `WikiIngestEvent` Prisma model.
- Hand-author the migration SQL under `packages/db/prisma/migrations/` following the repo's existing date-stamped folder convention.
- Extend `RecordIngestEventInput` in `packages/db/src/wiki-store.ts` with an optional `taskRunId?: string | null` field; thread it through `recordIngestEvent`'s `data: {…}` block.
- Extend `CommitProposalInput` in `apps/web/lib/wiki/proposal-commit.ts` with the same optional field; thread to both `recordIngestEvent` call sites (lines 640 and 737 on `origin/main`).
- Extend `recordIngestEvent` unit tests (`packages/db/src/wiki-store.test.ts`) to verify round-trip: default null when omitted; populated when supplied.
- Verify the existing file-source ingest pipeline (`apps/web/lib/wiki/ingest.ts`) and founder-kernel seed (`packages/db/src/seed-wiki-kernel.ts`) continue to write null `taskRunId` rows without code change.

**Out of scope:**
- Hive Scout invoking `commitIngestProposal` with a populated `taskRunId` — that is **Slice 3**.
- AI Operations Map projection of `WikiIngestEvent` rows by `taskRunId` — that is **Slice 4**.
- Any change to `WikiPageRevision`, `WikiPage`, `RawSource`, or other models — out of scope; the spec deliberately put provenance on the per-commit audit row, not per-page.
- Backfill of historical `WikiIngestEvent` rows — every existing row will have `taskRunId = null`. Acceptable: pre-Slice-2 commits had no `TaskRun` attribution to recover.

---

## Pre-flight Checks

```bash
# Branch from fresh origin/main. Slice 1 (PR #646) is independent — Slice 2 has
# no dependency on it. Whether #646 has merged or not, base off origin/main.
git fetch origin main --quiet
git checkout -b feat/wiki-ingest-event-taskrun-id origin/main

# Migration-timestamp collision check: confirm no concurrent worktree has landed
# a migration in the [20260516000000..20260518000000] window since main was last
# fetched. The plan picks `20260518000000` because the latest existing is
# `20260517000000_skill_lifecycle_state`.
ls packages/db/prisma/migrations/ | sort | tail -5
# Expected: latest folder is `20260517000000_skill_lifecycle_state` (or later
# but not equal to the plan's chosen timestamp). If a collision is detected,
# bump the plan's migration timestamp to one minute past the latest.

# Confirm the model is still the shape this plan assumes (no taskRunId yet).
git grep -n -A 12 "^model WikiIngestEvent" -- packages/db/prisma/schema.prisma
# Expected: 8 fields (id, organizationId, sourceId, touchedPageIds, agentId,
# userId, kernelVersion, createdAt). NO taskRunId.

# Confirm the helper and tests are where the plan expects.
git grep -n "^export async function recordIngestEvent" -- packages/db/src/wiki-store.ts
# Expected: one match around line 489.

git grep -n "^describe(\"recordIngestEvent\"" -- packages/db/src/wiki-store.test.ts
# Expected: one match around line 711.

# Confirm both commit-step call sites are present.
git grep -n "recordIngestEvent(db" -- apps/web/lib/wiki/proposal-commit.ts
# Expected: two matches (commit path + early-exit path).

# Sanity baseline: wiki-store tests on origin/main.
pnpm --filter @dpf/db test src/wiki-store.test.ts
# Expected: all pass.
```

If any pre-flight fails, STOP and surface to human — the branch is not based on the assumed state.

---

## Task 1: Schema migration + Prisma model update

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (`WikiIngestEvent` model)
- Create: `packages/db/prisma/migrations/20260518000000_add_taskrun_id_to_wiki_ingest_event/migration.sql`

**Why:** Foundation for the rest of Slice 2 — every other change depends on the column existing. Hand-author the migration SQL so this plan does not require a live Postgres connection to land; the SQL file is reviewable on the PR and `prisma migrate deploy` applies it during normal deploy.

- [ ] **Step 1: Add `taskRunId String?` to the `WikiIngestEvent` model.** Locate the model in `schema.prisma` (around line 7270 on `origin/main`) and modify:

  ```prisma
  model WikiIngestEvent {
    id             String        @id @default(cuid())
    organizationId String?
    organization   Organization? @relation(fields: [organizationId], references: [id])
    sourceId       String
    touchedPageIds String[]
    agentId        String?
    agent          Agent?        @relation("WikiIngestEventAgent", fields: [agentId], references: [id])
    userId         String?
    user           User?         @relation("WikiIngestEventUser", fields: [userId], references: [id])
    kernelVersion  String?
    /// Optional FK to TaskRun.id when this commit was produced by an autonomous coworker
    /// run (Hive Scout, future autonomous ingest paths). Founder-kernel seed and operator-
    /// driven flows leave this null. AI Operations Map (Slice 4) joins through this column.
    taskRunId      String?
    taskRun        TaskRun?      @relation("WikiIngestEventTaskRun", fields: [taskRunId], references: [id])
    createdAt      DateTime      @default(now())

    @@index([sourceId])
    @@index([organizationId])
    @@index([taskRunId, createdAt])
  }
  ```

  **Important:** check whether `TaskRun` already has a back-relation named `wikiIngestEvents` or similar. Prisma requires both ends of a relation to name each other. Find the `TaskRun` model and add the back-relation if absent:

  ```prisma
  // inside model TaskRun { ... }
  wikiIngestEvents WikiIngestEvent[] @relation("WikiIngestEventTaskRun")
  ```

  Run `git grep -n "model TaskRun" -- packages/db/prisma/schema.prisma` to locate.

- [ ] **Step 2: Create the migration directory and SQL.**

  ```bash
  mkdir -p packages/db/prisma/migrations/20260518000000_add_taskrun_id_to_wiki_ingest_event
  ```

  Write `packages/db/prisma/migrations/20260518000000_add_taskrun_id_to_wiki_ingest_event/migration.sql`:

  ```sql
  -- AlterTable
  ALTER TABLE "WikiIngestEvent" ADD COLUMN "taskRunId" TEXT;

  -- CreateIndex
  CREATE INDEX "WikiIngestEvent_taskRunId_createdAt_idx" ON "WikiIngestEvent"("taskRunId", "createdAt");

  -- AddForeignKey
  ALTER TABLE "WikiIngestEvent" ADD CONSTRAINT "WikiIngestEvent_taskRunId_fkey"
    FOREIGN KEY ("taskRunId") REFERENCES "TaskRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ```

  **`ON DELETE SET NULL`** is intentional: if a `TaskRun` is later archived/deleted (rare but possible per `TaskRun.archivedAt`), the audit row survives with null attribution. The wiki commit itself is the durable artifact; losing the run pointer is acceptable.

- [ ] **Step 3: Regenerate the Prisma client.** No DB connection required.

  ```bash
  pnpm --filter @dpf/db run generate
  ```
  Expected: `✔ Generated Prisma Client`. If it fails on the new relation, double-check the back-relation name on `TaskRun` matches the `@relation("WikiIngestEventTaskRun")` annotation.

- [ ] **Step 4: Typecheck both packages.**

  ```bash
  pnpm --filter @dpf/db typecheck
  pnpm --filter web typecheck
  ```
  Expected: exit 0 from both. The generated client now has `taskRunId` on the `WikiIngestEventCreateInput` type, so existing callers that don't pass it will still compile (the field is nullable + optional).

- [ ] **Step 5: Commit.**

  ```bash
  git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260518000000_add_taskrun_id_to_wiki_ingest_event
  git commit -s -m "feat(db): add WikiIngestEvent.taskRunId for Slice 2 of wiki bridge"
  ```

---

## Task 2: Extend `RecordIngestEventInput` and `recordIngestEvent`

**Files:**
- Modify: `packages/db/src/wiki-store.ts` (`RecordIngestEventInput` type around line 471; `recordIngestEvent` helper around line 489)
- Modify: `packages/db/src/wiki-store.test.ts` (existing `describe("recordIngestEvent", …)` block around line 711)

**Why:** The migration adds the column; this step makes the helper accept and persist it. Tests extend the existing two-case pattern (default-null and forwards-every-field) to cover the new field.

- [ ] **Step 1: Extend `RecordIngestEventInput` with the optional field.** Edit `packages/db/src/wiki-store.ts` around line 471:

  ```ts
  export type RecordIngestEventInput = {
    sourceId: string;
    organizationId?: string | null;
    /** Wiki page ids touched by this ingest run; empty when only the source was upserted. */
    touchedPageIds?: string[];
    agentId?: string | null;
    userId?: string | null;
    /** Kernel version active at ingest time; null for org-only ingests. */
    kernelVersion?: string | null;
    /**
     * Optional FK to `TaskRun.id` when this ingest was produced by an autonomous
     * coworker run (Hive Scout, future autonomous ingest paths). Null for
     * founder-kernel seeds and operator-driven flows. AI Operations Map (Slice 4)
     * joins through this column to attribute wiki write-through to the run.
     */
    taskRunId?: string | null;
  };
  ```

- [ ] **Step 2: Thread `taskRunId` through the helper's `data` block.** Edit `recordIngestEvent` around line 489:

  ```ts
  export async function recordIngestEvent(
    db: WikiIngestEventClient,
    input: RecordIngestEventInput,
  ): Promise<unknown> {
    return db.wikiIngestEvent.create({
      data: {
        sourceId: input.sourceId,
        organizationId: input.organizationId ?? null,
        touchedPageIds: input.touchedPageIds ?? [],
        agentId: input.agentId ?? null,
        userId: input.userId ?? null,
        kernelVersion: input.kernelVersion ?? null,
        taskRunId: input.taskRunId ?? null,
      },
    });
  }
  ```

- [ ] **Step 3: Extend the unit tests.** In `packages/db/src/wiki-store.test.ts`, the existing two tests at line 711-755 both use `expect(create).toHaveBeenCalledWith({...})` with a strict payload — adding the new column to the `data` block in `recordIngestEvent` will cause both to fail until their expected payloads are updated. Keep the test intents intact:

  - **First test (default-null on omission):** add `taskRunId: null` to the expected `data` object. Do NOT add it to the input — the test's intent is "when nothing is supplied, the row gets nulls."
  - **Second test (forwards every supplied attribution field):** do NOT add `taskRunId` to this test. Its existing intent is "every currently-defined attribution field forwards correctly." Adding `taskRunId` to the input AND the expected payload here would conflate intents with the new third test below. Instead, only add `taskRunId: null` to the expected payload (matching the input which still omits it).

  Then append a new third test that specifically covers the new field's round-trip:

  ```ts
  it("forwards taskRunId when supplied without the other autonomous fields", async () => {
    const { db, create } = makeIngestEventMock();
    create.mockResolvedValueOnce({ id: "evt_3" });

    await recordIngestEvent(db, {
      sourceId: "rs_3",
      taskRunId: "TR-SCHED-HIVE2",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        sourceId: "rs_3",
        organizationId: null,
        touchedPageIds: [],
        agentId: null,
        userId: null,
        kernelVersion: null,
        taskRunId: "TR-SCHED-HIVE2",
      },
    });
  });
  ```

- [ ] **Step 4: Run wiki-store tests; confirm all pass.**

  ```bash
  pnpm --filter @dpf/db test src/wiki-store.test
  ```
  Expected: pre-existing tests still pass; the third new test passes. If a pre-existing test fails because its `expect.objectContaining` did not include the new field, that means I missed updating it — fix and re-run.

- [ ] **Step 5: Commit.**

  ```bash
  git add packages/db/src/wiki-store.ts packages/db/src/wiki-store.test.ts
  git commit -s -m "feat(db): thread taskRunId through recordIngestEvent"
  ```

---

## Task 3: Extend `CommitProposalInput` and thread to both call sites

**Files:**
- Modify: `apps/web/lib/wiki/proposal-commit.ts` (`CommitProposalInput` type around line 57; two `recordIngestEvent` call sites around lines 640 and 737)
- Modify: `apps/web/lib/wiki/proposal-commit.test.ts` (existing tests — verify they still pass; add one new round-trip test)

**Why:** Slice 3 (Hive Scout invoking the commit step) will pass `taskRunId` on `CommitProposalInput`. Without this thread, the field would land on `recordIngestEvent` but never reach it from the commit path. The two call sites both write `WikiIngestEvent` rows.

- [ ] **Step 1: Add the optional field to `CommitProposalInput`.** Edit around line 73 (right after `kernelVersion?: string | null;`):

  ```ts
  kernelVersion?: string | null;
  /**
   * Optional FK to `TaskRun.id` when the commit is invoked by an autonomous
   * coworker run (Hive Scout, future autonomous ingest paths). Forwarded to
   * `WikiIngestEvent.taskRunId` for AI Operations Map projection (Slice 4).
   * Founder-kernel seed and operator-driven flows leave this null.
   */
  taskRunId?: string | null;
  ```

- [ ] **Step 2: Find the two `recordIngestEvent` call sites.**

  ```bash
  git grep -n "recordIngestEvent(db" -- apps/web/lib/wiki/proposal-commit.ts
  ```
  Expected: lines 640 and 737 (verify against current file).

- [ ] **Step 3: At each call site, thread `taskRunId: input.taskRunId ?? null` into the input object.** Note: the two sites have **different payload shapes** — do not copy-paste blindly.

  **Site A — line 640 (kernel-refused early-exit path):** writes an audit row even when refusing the commit. Hard-codes `organizationId: null` and `touchedPageIds: []`. Add `taskRunId` AS-IS from input:

  ```ts
  const event = (await recordIngestEvent(db, {
    sourceId: input.rawSourceId,
    organizationId: null,
    touchedPageIds: [],
    agentId: input.agentId ?? null,
    userId: input.userId ?? null,
    kernelVersion: input.kernelVersion ?? null,
    taskRunId: input.taskRunId ?? null,  // ← NEW
  })) as { id: string };
  ```

  **Site B — line 737 (success path):** writes the audit row after the wiki writes complete. Uses `input.organizationId` and the accumulated `uniquePageIds`. Add `taskRunId`:

  ```ts
  const event = (await recordIngestEvent(db, {
    sourceId: input.rawSourceId,
    organizationId: input.organizationId,
    touchedPageIds: uniquePageIds,
    agentId: input.agentId ?? null,
    userId: input.userId ?? null,
    kernelVersion: input.kernelVersion ?? null,
    taskRunId: input.taskRunId ?? null,  // ← NEW
  })) as { id: string };
  ```

  Both sites preserve their existing payload shape — only the new field is added.

- [ ] **Step 4: Add one round-trip test in `proposal-commit.test.ts`.** Locate an existing happy-path test that already asserts on `WikiIngestEvent` creation (search `wikiIngestEvent.create` or `recordIngestEvent` in the test file). Either:

  (a) Add an `expect.objectContaining({ taskRunId: "TR-SCHED-WIKI1" })` assertion to that existing test plus pass `taskRunId` in the test's `commitIngestProposal({…})` call; OR

  (b) Add a new `it("forwards taskRunId from CommitProposalInput to the WikiIngestEvent row", …)` test that mirrors the simplest existing happy-path test plus the taskRunId assertion.

  Option (b) is preferred — keeps the new contract a single named test.

- [ ] **Step 5: Run proposal-commit tests; confirm all pass.**

  ```bash
  pnpm --filter web test lib/wiki/proposal-commit.test
  ```
  Expected: pre-existing tests still pass; the new test passes. If a pre-existing test fails because of the new field on the input, that means the test passes a strict-equal payload to `recordIngestEvent`; either widen the assertion or add `taskRunId: null` to the expected payload.

- [ ] **Step 6: Commit.**

  ```bash
  git add apps/web/lib/wiki/proposal-commit.ts apps/web/lib/wiki/proposal-commit.test.ts
  git commit -s -m "feat(wiki): thread taskRunId through commitIngestProposal"
  ```

---

## Task 4: Verify existing callers are unaffected; final verification + PR

**Files:**
- Read-only verify: `apps/web/lib/wiki/ingest.ts` (file-source ingest path — Phase 2.1)
- Read-only verify: `packages/db/src/seed-wiki-kernel.ts` (founder-kernel seed)

**Why:** The spec's Slice 2 acceptance includes "Existing kernel-seed path produces null `taskRunId` rows." Neither caller passes `taskRunId` today; with the field optional and defaulting to null at every layer, no code change is required at these sites. This task verifies that's true.

- [ ] **Step 1: Inspect `apps/web/lib/wiki/ingest.ts` around line 210.**

  ```bash
  git grep -n -A 8 "recordIngestEvent(db" -- apps/web/lib/wiki/ingest.ts
  ```
  Expected: the call passes `{ sourceId, organizationId, agentId, userId, kernelVersion }` (no `taskRunId`). Slice 2 changes nothing here. **Do not edit.**

- [ ] **Step 2: Inspect `packages/db/src/seed-wiki-kernel.ts`.**

  ```bash
  git grep -n "recordIngestEvent\|wikiIngestEvent.create" -- packages/db/src/seed-wiki-kernel.ts
  ```
  Expected: zero or one match. If the seed writes a `WikiIngestEvent` row, confirm it omits `taskRunId` so the row lands with null. **Do not edit unless a typecheck error appears.**

- [ ] **Step 3: Run the full vitest suite for both packages.**

  ```bash
  pnpm --filter web test
  pnpm --filter @dpf/db test
  ```
  Expected: all pass. The new test count is +1 in `@dpf/db` and +1 in `web` (or 0 if Step 4 of Task 3 chose option (a)).

- [ ] **Step 4: Run typecheck on both packages.**

  ```bash
  pnpm --filter web typecheck
  pnpm --filter @dpf/db typecheck
  ```
  Expected: exit 0 from both.

- [ ] **Step 5: Re-sweep for concurrent overlap before pushing.**

  ```bash
  git fetch origin main --quiet
  gh pr list --state open --search "WikiIngestEvent in:title,body" --limit 20
  gh pr list --state open --search "taskRunId wiki" --limit 20
  git log origin/main --since="2 days ago" --name-only -- \
    packages/db/prisma/schema.prisma packages/db/src/wiki-store.ts \
    apps/web/lib/wiki/proposal-commit.ts | head -40
  ```
  If anything touches `WikiIngestEvent`, `recordIngestEvent`, or `commitIngestProposal`, STOP and reconcile.

- [ ] **Step 6: Push and open the PR.**

  ```bash
  git push -u origin feat/wiki-ingest-event-taskrun-id
  gh pr create --title "feat(wiki): WikiIngestEvent.taskRunId (Slice 2 of wiki bridge)" --body "$(cat <<'EOF'
  ## Summary

  - Implements Slice 2 of [docs/superpowers/specs/2026-05-14-hive-scout-wikipage-synthesis-design.md](docs/superpowers/specs/2026-05-14-hive-scout-wikipage-synthesis-design.md): adds a nullable `WikiIngestEvent.taskRunId` FK to `TaskRun` plus an index on `(taskRunId, createdAt)`, threaded through `recordIngestEvent` and `commitIngestProposal`.
  - Foundation for Slice 3 (Hive Scout autonomous run populates the field) and Slice 4 (AI Operations Map projection joins through it). Behavior-neutral on its own — every existing caller continues to write null `taskRunId` rows.
  - One Prisma migration, one optional field on two input types, three threaded code paths. No new tables, no new helpers, no new dependencies.

  ## What this PR does NOT do

  - Does not call `commitIngestProposal` with a populated `taskRunId` — that is Slice 3.
  - Does not project `WikiIngestEvent` rows in AI Operations Map — that is Slice 4.
  - Does not backfill historical rows — pre-Slice-2 commits remain null-attributed (acceptable per spec scope).

  ## Test plan

  - [ ] `pnpm --filter @dpf/db test` clean; new round-trip test for `recordIngestEvent(taskRunId)`.
  - [ ] `pnpm --filter web test` clean; new round-trip test for `commitIngestProposal(taskRunId)`.
  - [ ] `pnpm --filter web typecheck` and `pnpm --filter @dpf/db typecheck` both clean.
  - [ ] File-source ingest path (`apps/web/lib/wiki/ingest.ts`) verified unchanged — still writes null `taskRunId` rows.
  - [ ] Founder-kernel seed verified unchanged — still writes null `taskRunId` rows.
  - [ ] `prisma migrate deploy` applies the migration cleanly against a clean DB (or noted as needing CI run if no local DB available).

  ## Stacking

  Independent of any open PR. Base = `main`. Slice 1 (#646) does not block this work — Slice 2 is a pure data-plane addition.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

---

## Risks & Edge Cases

| Risk | Mitigation in this plan |
| --- | --- |
| `TaskRun` already has a relation named `wikiIngestEvents` and I add a duplicate | Task 1 Step 1 explicitly says to check before adding the back-relation. |
| `ON DELETE SET NULL` allows orphan audit rows referencing a deleted run | Intentional: the wiki commit is the durable artifact; losing the run pointer is acceptable when a `TaskRun` is archived. The alternative (`CASCADE`) would delete audit history, which is worse. |
| Hand-authored SQL drifts from what `prisma migrate dev` would produce | The migration is reviewed on the PR; running `prisma migrate deploy` against a clean DB then `prisma migrate status` should confirm no drift. Add a manual verification step in CI later if drift is a recurring concern. |
| A pre-existing test asserts strict-equal on `recordIngestEvent`'s `data` payload and breaks when the new field appears | Task 2 Step 4 catches it; either widen the assertion or add `taskRunId: null` explicitly. |
| Migration timestamp `20260518000000` collides with a concurrent session's migration | Task 4 Step 5 sweeps before push; if a collision is detected, rename the migration directory to a later timestamp. |
| Generated Prisma client has the field but proposal-commit's call uses `data: { ... } as Prisma.InputJsonValue` or similar cast that erases type checking | Verify by reading the actual call site at Task 3 Step 3; if a cast is hiding the field, remove the cast scope or add `taskRunId` inside it. |

---

## Out of Scope (Do Not Implement in This PR)

- Hive Scout calling `commitIngestProposal` — Slice 3.
- AI Operations Map projection — Slice 4.
- Any change to `WikiPageRevision`, `WikiPage`, `RawSource`, or other models.
- Backfill of historical `WikiIngestEvent` rows.
- Validation that the supplied `taskRunId` actually corresponds to a real `TaskRun` row — the FK constraint enforces it at insert time; runtime validation would duplicate that.

---

## Definition of Done

1. Migration `20260518000000_add_taskrun_id_to_wiki_ingest_event` exists in the migrations directory and applies cleanly via `prisma migrate deploy` against a clean DB.
2. `RecordIngestEventInput` and `CommitProposalInput` both expose `taskRunId?: string | null`.
3. `recordIngestEvent` and both `commitIngestProposal` call sites pass `taskRunId` through to the DB write.
4. `pnpm --filter web test` and `pnpm --filter @dpf/db test` both pass.
5. `pnpm --filter web typecheck` and `pnpm --filter @dpf/db typecheck` both pass.
6. File-source ingest (`apps/web/lib/wiki/ingest.ts`) and founder-kernel seed write null `taskRunId` rows (no code change required, verified by inspection).
7. PR opened against `main`, DCO sign-off on every commit (`git commit -s`), overlap sweep clean.

Once merged, the Slice 3 plan picks up: extend Hive Scout's candidate loop (`apps/web/lib/actions/hive-scout/ingest-500-agents.ts`) to compose a `ProposalSource` from each ambiguity-reviewed entry and call `proposeWikiDiff` then `commitIngestProposal({ …, taskRunId: options.taskRunId })`. Slice 4 then projects the resulting `WikiIngestEvent` rows in `apps/web/lib/ai-operations-map/load-map-data.ts`.
