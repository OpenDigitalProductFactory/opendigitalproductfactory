# Contributor Inventory Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-request `git`/`gh`/`fetch` shell-outs in `apps/web/lib/contributor-change-lanes/runners-node.ts` with a scheduled Inngest sync job that writes a `ContributorInventorySnapshot` Prisma table. The read model becomes a pure DB query; the Live portal renders the dashboard without GitHub auth or `gh` binary.

**Architecture:** Adopt Option A from the spec — one Inngest cron syncs local git inventory + remote GitHub PR state into one snapshot table, mirroring the existing DPF pattern (`token-expiry-monitor`, `mcp-catalog-sync`, `discovery-poll` + `discovery-sweep`). Read model queries DB only. `lane-projection.ts` and `types.ts` are not modified.

**Tech Stack:** Next.js app router, React server components, Prisma 7, Inngest cron functions with `gateAtEntry` quiescence gate, `ScheduledJob` heartbeat, plain `fetch` against `api.github.com` (no octokit), Vitest, existing `CredentialEntry` substrate.

---

## Phase 0: Branch And Substrate Guard

- [ ] Confirm work is on an isolated branch/worktree, not `main`.

  ```powershell
  git status --short --branch
  git branch --show-current
  ```

- [ ] Re-read the governing docs before implementation:
  - `AGENTS.md`
  - `docs/superpowers/specs/2026-05-26-contributor-inventory-sync-design.md`
  - `docs/superpowers/specs/2026-05-26-contributor-change-lanes-design.md`
  - `docs/superpowers/plans/2026-05-26-contributor-change-lanes.md`

- [ ] Verify the substrate the spec depends on still exists on `origin/main`:

  ```powershell
  git fetch origin
  git ls-tree -r origin/main --name-only |
    Select-String 'apps/web/lib/queue/functions/(token-expiry-monitor|mcp-catalog-sync|discovery-poll)\.ts$|apps/web/lib/queue/quiescence-gates\.ts$|apps/web/lib/contributor-change-lanes/(types|lane-projection|read-model|runners-node)\.ts$'
  ```

- [ ] Verify the contributor-change-lanes dashboard renders today (before this work changes anything). This is the regression baseline.

  ```powershell
  pnpm --filter web exec vitest run lib/contributor-change-lanes/
  ```

- [ ] Query live substrate via DPF MCP:
  - `list_epics` — confirm `EP-REDUCTION-GEAR-ARCH` exists.
  - `list_backlog_items` — confirm the BI for this work is registered (the BI is filed alongside this plan, see §Backlog Item).

## Phase 1: Schema And Sync-Run Records

Purpose: land the durable data shape before any worker writes to it. Migration must be reversible.

- [ ] Add Prisma models to `packages/db/prisma/schema.prisma`:

  ```prisma
  model ContributorInventorySnapshot {
    id        String   @id @default(cuid())
    source    String
    sourceKey String
    payload   Json
    syncRunId String
    fetchedAt DateTime @default(now())
    createdAt DateTime @default(now())
    @@unique([source, sourceKey, syncRunId])
    @@index([source, syncRunId])
    @@index([source, fetchedAt])
  }

  model ContributorInventorySyncRun {
    id              String    @id @default(cuid())
    syncRunId       String    @unique
    startedAt       DateTime  @default(now())
    completedAt     DateTime?
    status          String    @default("running")
    perSourceResult Json      @default("{}")
    triggeredBy     String    @default("cron")
    durationMs      Int?
  }
  ```

- [ ] Generate migration via the standard DPF migration helper. Verify the migration applies cleanly against the local DB and is reversible.

  ```powershell
  pnpm --filter @dpf/db prisma migrate dev --name contributor_inventory_snapshot
  ```

- [ ] Add seed entry for the `ScheduledJob` row with `jobId: "contributor-inventory-sync"`, `name: "Contributor inventory sync"`, `schedule: "*/10 * * * *"`. Follow the existing seed convention from `mcp-catalog-sync` and `token-expiry-monitor`.

- [ ] Add a focused vitest that asserts:
  - The migration creates both tables.
  - The unique index `(source, sourceKey, syncRunId)` enforces idempotency.
  - The `ScheduledJob` row is seeded.

## Phase 2: Sync Function — Skeleton + Local Git Sources

Purpose: get the cron function running with the two safe (local-only) data sources before adding network IO.

- [ ] Create `apps/web/lib/queue/functions/contributor-inventory-sync.ts`. Use `token-expiry-monitor.ts` as the template — pure scan function exported separately, thin Inngest wrapper calls it via `step.run`.

- [ ] Export a `runContributorInventorySync` function that:
  1. Generates `syncRunId = cuid()`.
  2. Creates a `ContributorInventorySyncRun` row with `status: "running"`.
  3. Runs three sub-readers in `Promise.allSettled`:
     - Local worktrees via `parseGitWorktreeList` (already in `git-inventory.ts`).
     - Local branches via `parseGitBranchList` (already in `git-inventory.ts`).
     - GitHub PRs — **stub for Phase 2**; returns `{ ok: false, error: "not implemented", rows: [] }`.
  4. Bulk-inserts successful rows via `prisma.contributorInventorySnapshot.createMany`.
  5. Updates the run row with `completedAt`, `durationMs`, `status` (`completed` / `partial` / `failed`), and `perSourceResult`.
  6. Upserts the `ScheduledJob` heartbeat row (mirror `mcp-catalog-sync.ts` lines 22-37).

- [ ] Wrap it in an Inngest function:

  ```ts
  export const contributorInventorySync = inngest.createFunction(
    {
      id: "ops/contributor-inventory-sync",
      retries: 2,
      concurrency: { limit: 1, scope: "fn" },
      triggers: [cron("*/10 * * * *"), { event: "ops/contributor-inventory-sync.run" }],
    },
    async ({ step }) => {
      const gate = await gateAtEntry(step);
      if (!gate.proceed) return { skipped: true, reason: gate.reason };
      return await step.run("run-sync", async () => runContributorInventorySync());
    },
  );
  ```

- [ ] Register the function with the Inngest serve handler (mirror the registration of `tokenExpiryMonitor` and `mcpCatalogSync`).

- [ ] Add `apps/web/lib/queue/functions/contributor-inventory-sync.test.ts`. Test cases (test-fakes-driven, no real Inngest harness):
  - Happy path: both local sources return rows → run row `completed`, snapshot rows written, ScheduledJob upserted.
  - Worktree source fails: run row `partial`, branch rows still written, error recorded in `perSourceResult`.
  - Branch source fails: run row `partial`, worktree rows still written.
  - Both local sources fail: run row `failed`, no snapshot rows, ScheduledJob updated with `lastStatus: "failed"`.
  - GitHub stub returns "not implemented": treated as a per-source failure, does not poison the local-git rows.
  - Idempotency: re-running the same `syncRunId` is a no-op (unique constraint).

- [ ] Run focused tests:

  ```powershell
  pnpm --filter web exec vitest run lib/queue/functions/contributor-inventory-sync.test.ts
  ```

## Phase 3: Read-Model Swap

Purpose: the page reads from the DB only; the sync job becomes the source of truth.

- [ ] Update `apps/web/lib/contributor-change-lanes/read-model.ts`:
  - Drop `LaneReadModelInventoryRunners` from `LaneReadModelArgs`.
  - Add an internal helper `readMostRecentSnapshot(db, source)` that joins `ContributorInventorySyncRun` (most recent `status IN ("completed", "partial")`) to `ContributorInventorySnapshot` and decodes `payload` into the existing `GitWorktreeSnapshot` / `GitBranchSnapshot` / `PullRequestSnapshot` shapes.
  - Build `LaneReadModelFreshness` from the run row's `perSourceResult`, not from runner-call wrapping.
  - Pass results into `projectContributorChangeLanes` unchanged.

- [ ] Update `apps/web/app/(shell)/platform/development/change-lanes/page.tsx`:
  - Remove import of `createNodeInventoryRunners` and `path`.
  - Call `loadContributorChangeLaneReadModel({ now })` with no `runners`.

- [ ] Update `apps/web/lib/contributor-change-lanes/read-model.test.ts`:
  - Replace runner mocks with fake DB returning snapshot/run rows.
  - Test cases:
    - All three sources present → all three sets of snapshot rows decoded, lanes projected.
    - Most recent run is `partial` with one failed source → freshness reports the failure, projection still runs for successful sources.
    - No completed run yet (cold-start, never synced) → freshness reports "no snapshot yet", page renders with Prisma sources only and an empty inventory.
    - Stale heartbeat (run completed >20 min ago) → freshness includes stale-warning flag.

- [ ] Run focused tests:

  ```powershell
  pnpm --filter web exec vitest run lib/contributor-change-lanes/
  ```

- [ ] Do **not** delete `runners-node.ts` yet — keep it on disk but unreferenced until Phase 6. This minimizes diff churn during operator review of the swap.

## Phase 4: GitHub Source

Purpose: replace the Phase 2 stub with a real REST reader against `api.github.com`.

- [ ] Create `apps/web/lib/contributor-change-lanes/github-rest-reader.ts`. It must:
  - Resolve the GitHub token via the existing `CredentialEntry` lookup pattern (mirror `apps/web/lib/integrate/contribution-review.ts` token resolution).
  - Return `{ ok: false, error: "no GitHub credential bound", rows: [] }` when no credential exists. This is **not** a sync failure; it is normal customer-install behavior.
  - Paginate `GET /repos/{owner}/{repo}/pulls?state=open&per_page=100&page=N` until the response is short or a hard cap (default 10 pages = 1000 PRs) is reached.
  - Send `If-None-Match` with the previous run's etag (read from `ContributorInventorySyncRun.perSourceResult.github-pr.etag`). On `304 Not Modified`, return the previous run's rows with `ok: true, unchanged: true`.
  - Parse responses into the existing `PullRequestSnapshot` shape; do **not** modify `types.ts`.
  - Surface rate-limit headers (`X-RateLimit-Remaining`, `X-RateLimit-Reset`) on the per-source result for observability.

- [ ] Resolve repo identity:
  - Read `PlatformDevConfig.upstreamRemoteUrl` for the `{owner}/{repo}` pair.
  - If empty, follow the existing fallback that other GitHub-touching code uses (see `apps/web/lib/actions/platform-dev-config.ts:307` for the hard-coded fallback comment).

- [ ] Wire the reader into `contributor-inventory-sync.ts`, replacing the Phase 2 stub.

- [ ] Add `github-rest-reader.test.ts`. Tests fake `fetch` and cover:
  - Happy path: paginated response → all rows parsed.
  - No credential → `ok: false, error: "no GitHub credential bound"`, run row marked `partial` not `failed`.
  - 304 Not Modified → returns prior rows with `unchanged: true`.
  - 401/403 (revoked / insufficient scope) → records actionable error.
  - Rate-limit headers captured.
  - Network error → recorded, does not throw past the sync function boundary.

- [ ] Update `contributor-inventory-sync.test.ts` GitHub-source cases to use the real reader's contract (mocked at the fetch boundary).

## Phase 5: Manual Trigger MCP Tool

Purpose: operator can refresh on demand without waiting for the cron interval.

- [ ] Add MCP tool `trigger_contributor_inventory_sync` to `apps/web/lib/mcp-tools.ts`:
  - Input: none (or optional `reason` string for audit).
  - Effect: sends `inngest.send({ name: "ops/contributor-inventory-sync.run", data: { triggeredBy: "mcp" } })`.
  - Output: the `eventId` returned by Inngest and the upcoming `syncRunId` once the run row exists.
  - Returns insufficient-scope error if the caller lacks admin scope.

- [ ] Update `apps/web/lib/tak/agent-grants.ts` `TOOL_TO_GRANTS` for the new tool. Scope tier: admin.

- [ ] Add `apps/web/lib/mcp-tools-contributor-inventory.test.ts`:
  - Happy path (admin token): event dispatched, response carries the event id.
  - Insufficient scope (read-only token): returns the existing MCP insufficient-scope shape — does not fall back to direct invocation.
  - Tool registered in catalog: `list_tools` includes it.

## Phase 6: Cleanup, Stale-Heartbeat Warning, Delete Runner

Purpose: complete the architectural shift; remove the deprecated code path.

- [ ] Add per-run retention cleanup inside `runContributorInventorySync`:
  - After the new run is written, delete `ContributorInventorySnapshot` rows whose `syncRunId` belongs to a `ContributorInventorySyncRun` older than 7 days.
  - Record `cleanupDeletedRows` count on the run row's `perSourceResult.cleanup`.
  - Failure to cleanup is recorded but does not fail the run.

- [ ] Update the dashboard freshness band:
  - `apps/web/components/platform/development/change-lanes/ChangeLaneSourceSummary.tsx` (or equivalent component) reads the snapshot age.
  - If `now - lastRunAt > 2× cron interval` (default 20 min), the band renders a yellow "stale" dot with the `ScheduledJob.lastError` (if any) on hover.

- [ ] Delete `apps/web/lib/contributor-change-lanes/runners-node.ts`.

- [ ] Remove the `LaneReadModelInventoryRunners` type from `read-model.ts` and any remaining unused imports in `page.tsx`.

- [ ] Verify nothing else imports the deleted module:

  ```powershell
  rg "runners-node|LaneReadModelInventoryRunners|createNodeInventoryRunners" apps/web -g "*.ts" -g "*.tsx"
  ```

## Phase 7: Functional Verification

- [ ] Run focused unit tests:

  ```powershell
  pnpm --filter web exec vitest run lib/contributor-change-lanes/ lib/queue/functions/contributor-inventory-sync.test.ts lib/mcp-tools-contributor-inventory.test.ts
  ```

- [ ] Run affected typecheck:

  ```powershell
  pnpm --filter web typecheck
  ```

- [ ] Run production build (this work touches Inngest registration + Prisma + UI):

  ```powershell
  pnpm --filter web build
  ```

- [ ] Confirm migrations apply on a freshly-seeded install (the standing seed-vs-runtime principle):

  ```powershell
  pnpm --filter @dpf/db prisma migrate reset --force
  pnpm --filter @dpf/db prisma db seed
  ```

- [ ] Functional verification against the Contributor preview (`dev-portal` on `:3001`), driving the dashboard via Claude-in-Chrome:
  - The page renders without 500 errors.
  - The source-freshness band shows three green dots after the first sync tick (or red GitHub if no credential is bound — both are valid).
  - A pushed branch shows up in the dashboard on the next cron tick (or immediately after invoking `trigger_contributor_inventory_sync` via MCP).
  - Tab filtering works: Active lanes / Branches needing handoff / Orphan worktrees / Stale leases / Merged branches safe to delete.
  - Disabling the GitHub credential (revoking the token in `CredentialEntry`) leaves the page rendering with local-git data only; the source-freshness band shows the GitHub dot as failed with the actionable error.
  - Stopping the cron (disabling the Inngest function) for >20 minutes makes the freshness band switch to the yellow stale state.

- [ ] Functional verification against the Live portal (`:3000`):
  - Same page renders.
  - Without a GitHub credential bound, the dashboard still shows local-git data; PR-related columns are empty (not failed).
  - This is the architecture goal: customer install renders the page meaningfully without contributor credentials.

- [ ] Drive the dashboard one more time, document the dynamic-analysis findings as prose (per the user's `dynamic_analysis_is_evidence` feedback memory), and hand turnover to operator for assurance review.

- [ ] Before ready-for-review handoff:
  - `git fetch origin`
  - Sweep for overlap: any other open PR touching `apps/web/lib/contributor-change-lanes/*` or `apps/web/lib/queue/functions/*`?
  - Merge-check / rebase against current `origin/main`.
  - Rerun focused tests + typecheck + build after the merge check.
  - Record evidence (test run output, browser observations) on the PR body.

## First Implementation Slice Recommendation

Implement Phases 1 through 4 first. This delivers the architectural shift (sync replaces shell-out) with both data sources working. Phases 5-6 add the operator affordances (manual trigger, retention, stale warning) once the core mechanism has been observed working against live data.

Phase 7 (functional verification) runs against the Phase-1-through-4 implementation; remaining phases (5-6) can be follow-up PRs if the first slice ships independently. The phased PR-per-slice pattern mirrors how PR #1207 shipped Phases 1-4 of the change-lanes plan and left Phases 5-8 for later.

## Backlog Item

This plan is tracked by `BI-063BDF1B` (type `product`, source `feature-gap`, triaged `build`, size `large`, linked to epic `EP-REDUCTION-GEAR-ARCH` to match PR #1207).

Build Studio is currently non-functional per project memory (`build-studio-non-functional-2026-05-26`); BI-063BDF1B is filed for tracking only and is **not** promoted to BS (`activeBuild: null`). Claude implements directly after operator approves the spec, mirroring how the change-lanes implementation in PR #1207 was driven.
