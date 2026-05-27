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

- [ ] Create `apps/web/lib/queue/functions/contributor-inventory-sync.ts`. Use `token-expiry-monitor.ts` as the template — pure runner function exported separately, thin Inngest wrappers call it via `step.run`.

- [ ] Export a `runContributorInventorySync(opts?: { triggeredBy?: string })` function that:
  1. Marks any `ContributorInventorySyncRun` rows with `status: "running"` and `startedAt < now - 10 min` as `status: "failed", error: "stuck — worker terminated before completion"`. (Stuck-run reaper.)
  2. Generates `syncRunId = cuid()`.
  3. Creates a `ContributorInventorySyncRun` row with `status: "running"`, `triggeredBy: opts?.triggeredBy ?? "cron"`.
  4. Runs three sub-readers in `Promise.allSettled`:
     - Local worktrees via `parseGitWorktreeList` (already in `git-inventory.ts`).
     - Local branches via `parseGitBranchList` (already in `git-inventory.ts`).
     - GitHub PRs — **stub for Phase 2**; returns `{ ok: false, error: "not implemented", rows: [] }`.
  5. Bulk-inserts successful rows via `prisma.contributorInventorySnapshot.createMany`.
  6. Updates the run row with `completedAt`, `durationMs`, `status` (`completed` / `partial` / `failed`), and `perSourceResult`.
  7. Upserts the `ScheduledJob` heartbeat row (mirror `mcp-catalog-sync.ts` lines 22-37).

- [ ] Wrap the runner in **two** Inngest functions sharing one concurrency group. Per `code-graph-reconcile.ts` and `governed-backlog-tee-up.ts`, the array-of-two-triggers shape is not used elsewhere in the codebase — use the two-function pattern that is:

  ```ts
  const sharedConfig = {
    retries: 2,
    concurrency: { limit: 1, scope: "fn-group" as const, key: "contributor-inventory-sync" },
  };

  export const contributorInventorySyncCron = inngest.createFunction(
    { id: "ops/contributor-inventory-sync-cron", ...sharedConfig, triggers: [cron("*/10 * * * *")] },
    async ({ step }) => {
      const gate = await gateAtEntry(step);
      if (!gate.proceed) return { skipped: true, reason: gate.reason };
      return await step.run("run-sync", async () => runContributorInventorySync({ triggeredBy: "cron" }));
    },
  );

  export const contributorInventorySyncOnDemand = inngest.createFunction(
    {
      id: "ops/contributor-inventory-sync-on-demand",
      ...sharedConfig,
      triggers: [{ event: "ops/contributor-inventory-sync.run" }],
    },
    async ({ event, step }) => {
      const gate = await gateAtEntry(step);
      if (!gate.proceed) return { skipped: true, reason: gate.reason };
      const triggeredBy = (event.data?.triggeredBy as string | undefined) ?? "mcp";
      return await step.run("run-sync", async () => runContributorInventorySync({ triggeredBy }));
    },
  );
  ```

- [ ] Register both functions with the Inngest serve handler (mirror the registration of `tokenExpiryMonitor` and `mcpCatalogSync`).

- [ ] Add `apps/web/lib/queue/functions/contributor-inventory-sync.test.ts`. Test cases (test-fakes-driven, no real Inngest harness):
  - Happy path: both local sources return rows → run row `completed`, snapshot rows written, ScheduledJob upserted.
  - Worktree source fails: run row `partial`, branch rows still written, error recorded in `perSourceResult`.
  - Branch source fails: run row `partial`, worktree rows still written.
  - Both local sources fail: run row `failed`, no snapshot rows, ScheduledJob updated with `lastStatus: "failed"`.
  - GitHub stub returns "not implemented": treated as a per-source failure, does not poison the local-git rows.
  - Stuck-run reaper: a pre-existing `running` row older than 10 min is marked `failed` before the new run starts; a row younger than 10 min is left alone.
  - Idempotency: re-running the same `syncRunId` is a no-op (unique constraint).

- [ ] Before pushing this phase, run the cross-PR overlap sweep:

  ```powershell
  git fetch origin
  gh pr list --state open --limit 100 --json number,headRefName,title |
    Select-String -Pattern 'contributor-inventory|change-lanes|queue/functions|ContributorInventory'
  ```

- [ ] Run focused tests:

  ```powershell
  pnpm --filter web exec vitest run lib/queue/functions/contributor-inventory-sync.test.ts
  ```

## Phase 3: Read-Model Swap + Freshness Type Extension + Cold-Start UI

Purpose: the page reads from the DB only via latest-successful-per-source semantics; the sync job becomes the source of truth; the freshness band and table empty-state speak honestly about state.

- [ ] Extend the `LaneReadModelFreshness` type in `apps/web/lib/contributor-change-lanes/read-model.ts`:

  ```ts
  export type LaneReadModelFreshness = {
    source: LaneReadModelSource;
    state: "ok" | "stale" | "error" | "not-configured" | "warming-up";
    fetchedAt: Date;
    message: string | null;
    count: number;
  };
  ```

  Drop the legacy `ok: boolean` and `error: string | null` fields. Every caller updates in the same PR slice.

- [ ] Update `apps/web/lib/contributor-change-lanes/read-model.ts`:
  - Drop `LaneReadModelInventoryRunners` from `LaneReadModelArgs`.
  - Add an internal helper `readLatestSuccessfulSnapshot(db, source)` that finds the most recent `ContributorInventorySyncRun` where `perSourceResult.<source>.ok === true`, then loads `ContributorInventorySnapshot` rows for that `syncRunId` and decodes `payload` into the existing snapshot shapes. Each of the three snapshot sources is resolved independently.
  - Build `LaneReadModelFreshness` with the new `state` discriminator:
    - `ok` if a successful snapshot was found within `staleHeartbeatThresholdMs` (default 20 min).
    - `stale` if found but older than that threshold.
    - `not-configured` for github-pr only, when no `CredentialEntry` with `providerId: "github-pr-sync"` exists.
    - `warming-up` if no successful run has happened yet for that source.
    - `error` only if the most recent run failed for this source AND there is no prior successful run to fall back to.
  - Pass results into `projectContributorChangeLanes` unchanged.

- [ ] Update `apps/web/components/platform/development/change-lanes/ChangeLaneSourceSummary.tsx`:
  - Replace the binary `f.ok ? success : error` dot with a five-state switch using `var(--dpf-success)`, `var(--dpf-warning)`, `var(--dpf-error)`, `var(--dpf-muted)` (+ pulsing animation for `warming-up`).
  - Group sources into two sub-rows: "Live data" (work-capsule, runtime-target, runtime-verification, nonprod-lease) and "Inventory snapshot" (the three sync sources).
  - Per-source label uses `formatRelative` from `ChangeLaneTable.tsx:154` for snapshot sources ("just now" / "8 min ago"); Prisma sources show count only.
  - Add aria-labels: `aria-label="${source} — ${state} (${message ?? humanized count})"`.

- [ ] Update `apps/web/components/platform/development/change-lanes/ChangeLaneTable.tsx`:
  - Add a "warming up" empty-state copy variant. When the caller passes `anySourceWarmingUp: true`, render "Inventory is still syncing — first results within ~10 minutes. Refresh the page once the freshness dots turn green." Otherwise keep "No lanes in this view."

- [ ] Update `apps/web/components/platform/development/change-lanes/ChangeLanesDashboard.tsx`:
  - Add a `(?)` warning glyph next to tab counts when any snapshot source has `state !== "ok"`, tooltip text "Counts may be incomplete — some inventory sources are not synced."
  - Pass `anySourceWarmingUp` through to the empty-state path of `ChangeLaneTable`.

- [ ] Update `apps/web/app/(shell)/platform/development/change-lanes/page.tsx`:
  - Remove import of `createNodeInventoryRunners` and `path`.
  - Call `loadContributorChangeLaneReadModel({ now })` with no `runners`.

- [ ] Update `apps/web/lib/contributor-change-lanes/read-model.test.ts`:
  - Replace runner mocks with fake DB returning snapshot/run rows.
  - Test cases:
    - All three sources have successful recent runs → all states `ok`, lanes projected.
    - Most recent run is `partial` with GitHub failed but a prior run had GitHub succeed → GitHub source resolves to the prior run's rows (`state: ok` if within threshold).
    - No successful run for one source yet → freshness reports `warming-up` and the table empty-state copy reflects that.
    - GitHub credential row absent → GitHub source freshness `not-configured`.
    - Stuck `running` rows are skipped by the per-source resolver (they are not `ok: true`).
    - Stale heartbeat (latest-successful run >20 min ago) → state `stale`, dashboard tab counts show `(?)`.

- [ ] Run focused tests:

  ```powershell
  pnpm --filter web exec vitest run lib/contributor-change-lanes/ components/platform/development/change-lanes/
  ```

- [ ] Do **not** delete `runners-node.ts` yet — keep it on disk but unreferenced until Phase 8. This minimizes diff churn during operator review and preserves rollback safety.

- [ ] Before pushing this phase, re-run the cross-PR overlap sweep.

## Phase 4: GitHub Source

Purpose: replace the Phase 2 stub with a real REST reader against `api.github.com`, plus the column-header annotation when the source is not configured.

- [ ] Create `apps/web/lib/contributor-change-lanes/github-rest-reader.ts`. It must:
  - Resolve the GitHub token by looking up `CredentialEntry` with `providerId: "github-pr-sync"`, `status: "active"`. Decrypt per the existing `CredentialEntry` decryption helper used by `apps/web/lib/integrate/contribution-review.ts`.
  - Return `{ ok: false, error: "no GitHub credential bound — connect GitHub on the contributor MCP readiness card to populate PR data", state: "not-configured", rows: [] }` when no credential exists. This is **not** a sync failure; it is normal customer-install behavior. The read-model maps `state: "not-configured"` into the freshness band's grey dot.
  - Paginate `GET /repos/{owner}/{repo}/pulls?state=open&per_page=100&page=N` until the response is short or a hard cap (default 10 pages = 1000 PRs) is reached.
  - Send `If-None-Match` with the etag from `ScheduledJob.metadata.githubPrEtag` (NOT from the previous `ContributorInventorySyncRun`, which can be retention-swept). On `304 Not Modified`, return `{ ok: true, unchanged: true, rows: [] }` — the read model will resolve this source to the previous successful run's rows automatically via latest-successful-per-source semantics.
  - After a successful 200 response, write the new `ETag` header back to `ScheduledJob.metadata.githubPrEtag`.
  - Parse responses into the existing `PullRequestSnapshot` shape; do **not** modify `types.ts`.
  - Surface rate-limit headers (`X-RateLimit-Remaining`, `X-RateLimit-Reset`) on the per-source result for observability.

- [ ] Resolve repo identity:
  - Read `PlatformDevConfig.upstreamRemoteUrl` for the `{owner}/{repo}` pair.
  - If empty, follow the existing fallback that other GitHub-touching code uses (see `apps/web/lib/actions/platform-dev-config.ts:307` for the hard-coded fallback comment).

- [ ] Wire the reader into `contributor-inventory-sync.ts`, replacing the Phase 2 stub.

- [ ] Add the "PR column not configured" header annotation in `apps/web/components/platform/development/change-lanes/ChangeLaneTable.tsx`. When `freshness["github-pr"].state === "not-configured"`, the PR column header carries a muted subtitle "GitHub not connected — connect on the Contributor MCP card to populate." When the state is `ok` or `stale`, no subtitle is rendered.

- [ ] Add `github-rest-reader.test.ts`. Tests fake `fetch` and cover:
  - Happy path: paginated response → all rows parsed, etag written to `ScheduledJob.metadata`.
  - No credential row → returns `not-configured`, run row marked `partial` not `failed`, no notification fired.
  - 304 Not Modified → returns `{ ok: true, unchanged: true }`; read-model fallback to prior run is exercised in a `read-model.test.ts` case.
  - 401/403 (revoked / insufficient scope) → records actionable error and `state: "error"`.
  - Rate-limit headers captured on `perSourceResult["github-pr"]`.
  - Network error → recorded, does not throw past the sync function boundary.
  - Etag survives retention sweep: after deleting the previous `ContributorInventorySyncRun` row, the etag still loads from `ScheduledJob.metadata`.

- [ ] Update `contributor-inventory-sync.test.ts` GitHub-source cases to use the real reader's contract (mocked at the fetch boundary).

- [ ] Before pushing this phase, re-run the cross-PR overlap sweep.

## Phase 5: Manual Refresh — UI Button + MCP Tool

Purpose: operators and agents can refresh on demand. The button is the operator surface; the MCP tool is the agent surface; both dispatch the same Inngest event.

- [ ] Add a server action `triggerContributorInventorySync()` in `apps/web/lib/actions/contributor-inventory.ts`:
  - Gated on admin scope via the existing platform-action permission check.
  - Dispatches `inngest.send({ name: "ops/contributor-inventory-sync.run", data: { triggeredBy: "ui" } })`.
  - Returns `{ eventId, syncRunId, status }` — `syncRunId` resolves once the runner has created the row (the action polls briefly until the row exists or returns the event id only if creation lags).

- [ ] Add a server action `getContributorInventorySyncStatus(syncRunId)` (read-only) that returns the current `ContributorInventorySyncRun.status` and `perSourceResult`. Used by the client poller.

- [ ] Add the Refresh button to `apps/web/components/platform/development/change-lanes/ChangeLaneSourceSummary.tsx`:
  - Visible only when the current session has admin scope (server-side check, passed as a prop from the page).
  - Click handler calls the server action, then polls `getContributorInventorySyncStatus` every 3 seconds.
  - In-flight: button is disabled, label changes to "Syncing…" with a spinner icon.
  - On `status IN ("completed", "partial")`: toast "Synced just now" and `router.refresh()` to revalidate the page data.
  - On `status: "failed"`: inline error message under the button with `var(--dpf-error)` color and the error string from `perSourceResult`.
  - Keyboard accessible: button has `aria-label="Refresh contributor inventory now"`, focus ring uses theme variables.

- [ ] Add MCP tool `trigger_contributor_inventory_sync` to `apps/web/lib/mcp-tools.ts`:
  - Input: optional `reason` string for audit, propagated to `triggeredBy: "mcp:${reason}"`.
  - Effect: sends `inngest.send({ name: "ops/contributor-inventory-sync.run", data: { triggeredBy: "mcp" } })`.
  - Output: the `eventId` returned by Inngest and the upcoming `syncRunId` once the run row exists.
  - Returns insufficient-scope error if the caller lacks admin scope.

- [ ] Update `apps/web/lib/tak/agent-grants.ts` `TOOL_TO_GRANTS` for the new tool. Scope tier: admin.

- [ ] Add `apps/web/lib/mcp-tools-contributor-inventory.test.ts`:
  - Happy path (admin token): event dispatched, response carries the event id.
  - Insufficient scope (read-only token): returns the existing MCP insufficient-scope shape — does not fall back to direct invocation.
  - Tool registered in catalog: `list_tools` includes it.

- [ ] Add component tests for the Refresh button:
  - Click dispatches once, button disables, label becomes "Syncing…".
  - Subsequent clicks while disabled are no-ops (do not dispatch).
  - On terminal status, button re-enables and toast renders.
  - Non-admin sessions do not see the button.

- [ ] Before pushing this phase, re-run the cross-PR overlap sweep.

## Phase 6: Cleanup, Notifications, Tab-Count Warning

Purpose: complete the architectural shift behaviors; **do not delete `runners-node.ts` yet** (deferred to Phase 8 to preserve rollback safety).

- [ ] Add per-run retention cleanup inside `runContributorInventorySync` with the latest-successful-per-source preservation guard:
  - Compute the set of `syncRunId`s that are the latest successful per source (at most three).
  - Delete `ContributorInventorySnapshot` rows whose `syncRunId` belongs to a `ContributorInventorySyncRun` older than 7 days **AND** whose `syncRunId` is NOT in that preserve set. Always preserve the corresponding `ContributorInventorySyncRun` rows.
  - Record `cleanupDeletedRows` count and `cleanupPreservedRunIds` on the run row's `perSourceResult.cleanup`.
  - Failure to cleanup is recorded but does not fail the run.

- [ ] Add `PlatformNotification` writes per spec §Operator notifications:
  - **Prolonged GitHub failure.** If `perSourceResult["github-pr"].ok === false` for ≥6 consecutive runs (look back at the most recent 6 `ContributorInventorySyncRun` rows ordered by `startedAt DESC`), upsert a notification with `category: "contributor-inventory-github"`, `severity: "warning"`, `subjectId: "github-pr-sync"`. Idempotency mirrors `token-expiry-monitor.ts:120-138`.
  - **Stale cron heartbeat.** Sub-task in a separate small cron (or in the cron entry path itself): if `ScheduledJob.lastRunAt` is older than 2 hours, upsert `category: "contributor-inventory-cron"`, `severity: "critical"`.
  - **`not-configured` does NOT fire a notification.**

- [ ] (Type/dot/copy work for the freshness band already landed in Phase 3 — this phase only adds behaviors that depend on having historical run data, which Phase 3 didn't yet have.)

- [ ] Add the tab-count `(?)` warning glyph wiring in `apps/web/components/platform/development/change-lanes/ChangeLanesDashboard.tsx` (the Phase 3 task placed the glyph; this task verifies it fires correctly off `freshness[*].state`).

- [ ] Add tests for:
  - Cleanup preserves the latest-successful-per-source rows even when they are older than 7 days.
  - Cleanup is a no-op when no rows are eligible.
  - Notification fires after the 6th consecutive failed GitHub run and is idempotent on the 7th.
  - Notification is resolved (`resolvedAt` set) when GitHub returns to `ok`.
  - Stale-cron notification fires when `ScheduledJob.lastRunAt` is >2h old.

- [ ] Before pushing this phase, re-run the cross-PR overlap sweep.

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
  - **Cold-start UX (must observe explicitly):** immediately after migration deploy, the freshness band shows `warming-up` dots and the table renders the warming-up empty-state copy — NOT a blank "No lanes in this view." After the first cron tick (≤10 min), the dots turn green.
  - The source-freshness band shows the correct dot color per state: green `ok`, yellow `stale`, red `error`, grey `not-configured`, pulsing-grey `warming-up`.
  - A pushed branch shows up in the dashboard on the next cron tick or immediately after clicking the Refresh button.
  - **Refresh button latency UX:** click the button, observe spinner + "Syncing…" label, watch the page revalidate after completion. Spam-click and confirm only one event dispatches.
  - **Latest-successful-per-source:** kill the GitHub source (revoke the token) AFTER one successful run has populated PR data, force another run, confirm the dashboard still shows the previously-synced PR data (does NOT regress to empty PR column) while the GitHub freshness dot turns `stale` then `error`.
  - **Stuck-run recovery:** SIGKILL the Inngest worker mid-`step.run`, restart the worker, confirm the next cron tick marks the orphaned row `failed` with the stuck error message.
  - **Etag durability:** observe `If-None-Match` header on the second GitHub request; manually delete the prior `ContributorInventorySyncRun` row; confirm next sync still sends the etag (from `ScheduledJob.metadata.githubPrEtag`).
  - **Prolonged-failure notification:** revoke GitHub credential, wait for 6 consecutive failed runs, confirm one `PlatformNotification` row appears. Re-issue the credential, confirm the notification is resolved.
  - **`not-configured` does NOT fire a notification.** Remove the credential row entirely (not just revoke), wait several cron ticks, confirm no `contributor-inventory-github` notification is created.
  - Disabling the GitHub credential moves the GitHub freshness dot to `not-configured` (grey), shows the column header "GitHub not connected" annotation.
  - Stopping the cron (disabling the Inngest function) for >20 minutes makes the freshness band switch to yellow `stale` and the tab counts grow a `(?)` glyph.
  - Tab filtering works: Active lanes / Branches needing handoff / Orphan worktrees / Stale leases / Merged branches safe to delete.

- [ ] Functional verification against the Live portal (`:3000`):
  - Same page renders.
  - Without a GitHub credential bound, the dashboard shows `not-configured` for GitHub (grey, not red), local-git dots green, PR column header annotated, PR cells `—`.
  - Architecture goal confirmed: customer install renders the page meaningfully without contributor credentials.

- [ ] Drive the dashboard one more time, document the dynamic-analysis findings as prose (per the user's `dynamic_analysis_is_evidence` feedback memory), and hand turnover to operator for assurance review.

- [ ] Before ready-for-review handoff (and before every push earlier in the plan):
  - `git fetch origin`
  - Sweep for overlap: any other open PR touching `apps/web/lib/contributor-change-lanes/*`, `apps/web/lib/queue/functions/*`, or `packages/db/prisma/schema.prisma`?
  - Merge-check / rebase against current `origin/main`.
  - Rerun focused tests + typecheck + build after the merge check.
  - Record evidence (test run output, browser observations) on the PR body.

## Phase 8: Deferred deletion of the runner (follow-up PR)

Purpose: remove the deprecated code path **only after** Phases 1-7 have been observed working in production for at least one rollback window.

- [ ] In a new branch / PR (separate from the main implementation slice):
  - Delete `apps/web/lib/contributor-change-lanes/runners-node.ts`.
  - Remove the `LaneReadModelInventoryRunners` type from `read-model.ts` and any remaining unused imports in `page.tsx`.
  - Verify nothing else imports the deleted module:

    ```powershell
    rg "runners-node|LaneReadModelInventoryRunners|createNodeInventoryRunners" apps/web -g "*.ts" -g "*.tsx"
    ```

  - Add a CHANGELOG / spec-frontmatter note recording the deferred-deletion completion.

## First Implementation Slice Recommendation

Implement Phases 1 through 4 first. This delivers the architectural shift (sync replaces shell-out) with both data sources working, plus the five-state freshness band and the cold-start rendering rules. Phases 5-6 add the operator affordances (Refresh button + MCP tool, retention guard, notifications, tab-count warnings) once the core mechanism has been observed working against live data. Phase 7 verifies the lot. Phase 8 (delete `runners-node.ts`) is a separate PR after one rollback window.

The phased PR-per-slice pattern mirrors how PR #1207 shipped Phases 1-4 of the change-lanes plan and left Phases 5-8 for later.

## Backlog Item

This plan is tracked by `BI-063BDF1B` (type `product`, source `feature-gap`, triaged `build`, size `large`, linked to epic `EP-REDUCTION-GEAR-ARCH` to match PR #1207).

Build Studio is currently non-functional per project memory (`build-studio-non-functional-2026-05-26`); BI-063BDF1B is filed for tracking only and is **not** promoted to BS (`activeBuild: null`). Claude implements directly after operator approves the spec, mirroring how the change-lanes implementation in PR #1207 was driven.
