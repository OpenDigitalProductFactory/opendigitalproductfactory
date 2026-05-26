---
title: Contributor Inventory Sync - move git/GitHub inventory off the request path
status: draft-for-operator-review
author: Claude
date: 2026-05-26
related:
  - AGENTS.md
  - docs/superpowers/specs/2026-05-26-contributor-change-lanes-design.md
  - docs/superpowers/plans/2026-05-26-contributor-change-lanes.md
  - docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md
  - apps/web/lib/queue/functions/token-expiry-monitor.ts
  - apps/web/lib/queue/functions/mcp-catalog-sync.ts
  - apps/web/lib/queue/functions/discovery-poll.ts
  - apps/web/lib/contributor-change-lanes/runners-node.ts
  - apps/web/lib/contributor-change-lanes/read-model.ts
  - apps/web/lib/contributor-change-lanes/lane-projection.ts
upstream_prs:
  - https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1205
  - https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1207
  - https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1204
epics:
  - EP-REDUCTION-GEAR-ARCH
  - EP-CAPSULE
  - EP-WORKTREE-HYGIENE
backlog_item: BI-063BDF1B
---

# Contributor Inventory Sync Design

## Purpose

Move contributor inventory data (local git worktrees, remote branches, GitHub PR state) off the `/platform/development/change-lanes` request path. The dashboard architecture from [PR #1207](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1207) is sound from the projection layer up; what is wrong is that `apps/web/lib/contributor-change-lanes/runners-node.ts` shells out to `git worktree list`, `git for-each-ref`, and `gh pr list` from a Next.js server component on every page request.

This spec replaces the per-request shell-out boundary with a scheduled Inngest sync job that writes a `ContributorInventorySnapshot` Prisma table; the read model becomes a pure DB query.

The contracts that survive untouched:

- `apps/web/lib/contributor-change-lanes/types.ts` — `ContributorChangeLane`, snapshot shapes.
- `apps/web/lib/contributor-change-lanes/lane-projection.ts` — pure projection function and tests.
- `apps/web/components/platform/development/change-lanes/` — five dashboard components.

The contracts that change:

- `runners-node.ts` is deleted.
- `read-model.ts` no longer accepts `LaneReadModelInventoryRunners`; it reads the snapshot rows from Prisma.
- `apps/web/app/(shell)/platform/development/change-lanes/page.tsx` no longer instantiates runners.

## Problem Statement

Functional verification of PR #1207 against the `dev-portal` preview surfaced three coupling failures that the projection layer cannot fix on its own:

1. **Auth coupling.** `gh pr list` needs per-contributor GitHub credentials. The Live portal at `:3000` is customer-facing and must not require a GitHub account. Today the runner depends on `gh` finding a credential on disk; that is a contributor concern leaking into a customer surface.
2. **Environment coupling.** Shell-outs assume the `gh` binary is installed, the `cwd` resolves to a git repo, and the network reaches `api.github.com` within the 8-second timeout. Inside the `dev-portal` container today: `gh` is not present, the bind-mount `cwd` is not a valid git repo, and the page surfaces three red freshness errors per request.
3. **Performance coupling.** Three external processes with 8-second timeouts per page load. On a network blip the page can hang for 24 seconds — long enough that operators reach for a refresh button that does nothing because the page is still rendering.

PR #1207 handles all three gracefully (red dots in the freshness panel, table renders from Prisma sources, no 500). That graceful degradation is honest evidence that the architecture is wrong, not a fix. Failing per-request inventory is supposed to be exceptional; in production it is the default.

## Existing Substrate Findings

DPF already has every primitive this spec needs. The design must not add a parallel scheduler, a parallel snapshot pattern, or a parallel credential substrate.

### Inngest Cron Functions

The repo already runs scheduled background functions through Inngest, with a quiescence gate, retry policy, and ScheduledJob heartbeat:

- `apps/web/lib/queue/inngest-client.ts` — Inngest event client and event-type registry.
- `apps/web/lib/queue/functions/discovery-poll.ts` — `prometheusPoll` (hourly cron) and `fullDiscoverySweep` (hourly cron) for infrastructure discovery.
- `apps/web/lib/queue/functions/mcp-catalog-sync.ts` — event-triggered sync that upserts an MCP tool catalog and updates `ScheduledJob` heartbeat.
- `apps/web/lib/queue/functions/token-expiry-monitor.ts` — daily cron (`0 9 * * *`) that scans `CredentialEntry` rows and writes `PlatformNotification` rows. Cleanest in-repo template for a "scan-and-upsert" cron.
- `apps/web/lib/queue/functions/skill-curator.ts`, `model-discovery-refresh.ts`, `postgres-daily-backup.ts`, `code-graph-reconcile.ts`, `hive-scout-ingest.ts` — additional cron and event-triggered functions running today.
- `apps/web/lib/queue/quiescence-gates.ts` — `gateAtEntry` blocks new jobs from starting during platform drain while letting in-flight jobs complete.

Gap: no existing cron job covers contributor git/worktree/PR inventory. That is what this spec adds.

### Snapshot Tables

Established pattern: a Prisma model named `*Snapshot` (or similar cached-projection model) holds the result of a periodic ingest, with the read path going only to the DB:

- `TaxDecisionSnapshot`
- `EaSnapshot`
- `ComplianceSnapshot`
- `ContractUsageSnapshot`
- `DiscoverySweep` (functionally a snapshot, named per the discovery domain)
- `ScheduledJob` — heartbeat row keyed by `jobId`, tracks `lastRunAt` / `nextRunAt` / `lastStatus` / `lastError`.

Gap: no `ContributorInventorySnapshot` yet. The new model in this spec follows the same shape.

### GitHub API Access

GitHub is already reached from server-side code via plain `fetch` against `api.github.com`. There is no `@octokit/*` dependency to add:

- `apps/web/lib/integrate/contribution-review.ts` — posts PR comments, sets labels, sets commit statuses.
- `apps/web/lib/integrate/github-api-commit.ts` — pushes commits and opens PRs.
- `apps/web/lib/integrate/github-fork.ts` — validates fork existence.
- `apps/web/lib/integrate/issue-bridge.ts` — creates issues.

Credentials flow through `CredentialEntry` (`packages/db/prisma/schema.prisma`), with `tokenExpiresAt` instrumented by `token-expiry-monitor`. The contributor MCP readiness work in [PR #1204](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1204) is about **portal MCP tokens** (gating which DPF MCP tools a contributor can call) — it is disjoint from GitHub auth. This spec uses `CredentialEntry` for GitHub access and notes #1204 only to disambiguate.

Gap: no read path that lists open pull requests by base branch. The Inngest function will add one.

### Worktree Janitor

`scripts/worktree-janitor-lib.psm1` is a PowerShell predicate library. No TypeScript code invokes it today; it has no scheduled trigger. This spec does **not** call the janitor — `git worktree list` from the inside of the running container is the inventory source. The janitor remains a separate concern under EP-WORKTREE-HYGIENE.

## Architecture Decision

**Adopt Option A: one Inngest cron syncs both local git inventory and remote GitHub PR state into a single `ContributorInventorySnapshot` Prisma table. The read model queries the DB only; `runners-node.ts` is deleted.**

Rejected alternatives:

- **Option B: per-request GitHub REST API via the existing `CredentialEntry` token.** Keeps the request-path architecture and only swaps `gh` for `fetch`. Does not solve local git inventory at all (the REST API cannot see local worktrees or branches), still pays per-request latency, and forces the Live portal to hold a GitHub credential.
- **Option C: mixed — Inngest sync for local git inventory only; per-request REST for GitHub PR state.** Half-solves the problem. Removes the `gh`/`git` shell-outs but keeps the per-request GitHub API call and still requires a credential bound to the Live portal for the PR fields to populate.

### WWMD/kernel decision (2026-05-26)

The decision was scored against the closed `PRINCIPLE_DIMENSIONS` registry via `mcp__dpf__principle_decide` with `callingPopulation: external_coding_agent` and `ringScope: ["ring-2-workflow"]`. Result:

- **Recommendation:** `scheduled-sync-snapshot-table` (composite **5.998**, margin **1.74**, confidence **high**).
- **Runner-up:** `mixed-sync-local-git-rest-prs` (composite 4.26).
- **Last:** `per-request-github-rest` (composite 2.71).
- **Top contributing principles** (all commandment-tier, weight 1.0):
  - Never Fabricate (+0.82) — durable snapshots remove the per-request fail-soft fabrication risk.
  - Build Gate (Mandatory) (+0.81) — moves a known fragile read path off CI-visible failure surfaces.
  - All Changes Land via PR Against Main (+0.80) — favored architectures that align with existing PR-gated substrate patterns.
  - Never Assume — Verify (+0.75) — snapshot + heartbeat make freshness verifiable.
  - Never ask the user to run commands (+0.71) — Live portal user never asked to install `gh`.
  - Architecture Over Shortcuts (+0.64) — flipped the operator's "mixed is likely" pre-state.
- **Flags:** no commandment conflict; 0% semantic fallback (strong structured coverage).
- **Confidence drivers:** the 1.74 margin is roughly nine times the `tieMargin` threshold of 0.2; the kernel was not close to a tie.

The kernel inverted the operator's pre-stated lean ("a mixed model is likely") in favor of full Option A. Architecture Over Shortcuts and operational independence pulled hard enough against the convenience of keeping the GitHub call per-request that the mixed option lost decisively.

## Design Principles

1. **The read model is a DB query.** No shell-outs, no network, no per-request external dependencies. If the snapshot is stale, the dashboard says so and the operator decides whether to act.
2. **Sources fail independently.** If the GitHub portion of a sync fails, the local-git portion still writes its rows; the snapshot records per-source freshness.
3. **No credential required on the Live portal for the page to render.** If no GitHub credential is bound, the GitHub source records `ok: false, error: "no credential"` and the dashboard shows PR fields empty. The page still renders the local-git portion and the existing Prisma sources.
4. **Heartbeat is the freshness contract.** `ScheduledJob` row with `jobId: "contributor-inventory-sync"` is the durable timestamp the dashboard reads. The snapshot tables carry their own `fetchedAt` for per-source freshness.
5. **Pure projection survives unchanged.** `lane-projection.ts` and `types.ts` are not modified. The sync produces the same snapshot shapes the projection already consumes.
6. **No new credential substrate.** GitHub auth uses the existing `CredentialEntry` row, the same shape `apps/web/lib/integrate/contribution-review.ts` already consumes.
7. **No new scheduler.** Inngest cron, `gateAtEntry`, and `ScheduledJob` are the substrate.

## Data Model

### New Prisma model: `ContributorInventorySnapshot`

One row per inventory item, partitioned by `source`. The model is a denormalized projection; lane-projection.ts joins it the same way it joins live shell-out results today.

```prisma
model ContributorInventorySnapshot {
  id              String   @id @default(cuid())
  // One of: "git-worktree" | "git-branch" | "github-pr"
  source          String
  // Stable identity within a source. Branch name for "git-branch",
  // worktree path for "git-worktree", PR number as string for "github-pr".
  sourceKey       String
  // The full snapshot row payload, shape-compatible with the existing
  // GitWorktreeSnapshot / GitBranchSnapshot / PullRequestSnapshot types
  // from apps/web/lib/contributor-change-lanes/types.ts. JSON so the
  // projection layer can keep evolving its shapes without migrations.
  payload         Json
  // Sync run identity. All rows written by one sync invocation share
  // this id; the read model uses (source, syncRunId) to ignore partial
  // rewrites mid-sync.
  syncRunId       String
  // When this row was written. Per-row, not per-sync, because per-source
  // freshness may differ if one source failed mid-run.
  fetchedAt       DateTime @default(now())
  createdAt       DateTime @default(now())

  @@unique([source, sourceKey, syncRunId])
  @@index([source, syncRunId])
  @@index([source, fetchedAt])
}

model ContributorInventorySyncRun {
  id                  String   @id @default(cuid())
  syncRunId           String   @unique
  startedAt           DateTime @default(now())
  completedAt         DateTime?
  // "running" | "completed" | "failed" | "partial"
  status              String   @default("running")
  // Per-source result: { source -> { ok, count, error } }
  perSourceResult     Json     @default("{}")
  // For audit/debug only. Sync rows themselves are the source of truth.
  triggeredBy         String   @default("cron")
  durationMs          Int?
}
```

The `ScheduledJob` row with `jobId: "contributor-inventory-sync"` provides the user-facing heartbeat. `ContributorInventorySyncRun` provides the per-run audit detail (mirroring `BackupRun` from the postgres-daily-backup spec).

### Cleanup strategy

The read path queries the **most recent completed** `syncRunId` per source. Older `ContributorInventorySnapshot` rows are not needed for the dashboard but are kept for a short window (default 7 days) so operators can correlate "the dashboard showed X at 14:32 — what was the underlying inventory then?" against incident timelines. A small periodic pass inside the same cron deletes rows older than the window.

This window deliberately exceeds Mark's weekly travel cadence (memory `idle_is_not_abandoned`): a Monday operator must still be able to inspect last Wednesday's snapshot.

## Sync Job

### Identity and schedule

- Inngest function id: `ops/contributor-inventory-sync`.
- Cron: `*/10 * * * *` (every ten minutes). Rationale: the dashboard is operator-facing, not realtime; ten minutes is short enough that a contributor pushing a branch sees it within a refresh cycle, long enough that the GitHub API rate budget is comfortable.
- `concurrency: { limit: 1, scope: "fn" }` — overlapping runs would double-write.
- `retries: 2` — matches existing crons.
- Quiescence: `gateAtEntry(step)` — same drain-aware pattern as `mcp-catalog-sync`.

### Per-source work

The sync is a fan-out of three independent source readers. Each source reader returns `{ ok, count, error, rows }`; the sync writes whatever succeeded, and records per-source failure on the run row.

1. **Local git worktrees** — `git worktree list --porcelain`, parsed by the existing `parseGitWorktreeList` from `git-inventory.ts`. The sync runs inside the portal container, where `git` is available and the repo `cwd` is valid (the dev-portal bind-mount problem only affects the request-path runner today because the page server-component process is what hits the bind mount; the Inngest worker runs against the actual git repo). Optional filesystem-walk for unregistered worktree directories under `.claude/worktrees`.
2. **Local git branches** — `git for-each-ref refs/remotes/origin/...`, parsed by the existing `parseGitBranchList`.
3. **GitHub pull requests** — `fetch` to `https://api.github.com/repos/{owner}/{repo}/pulls?state=open&per_page=100&page=N` with `Authorization: Bearer ${token}` from `CredentialEntry`. Pagination until the response is short or the absolute cap is reached. Parsed into the existing `PullRequestSnapshot` shape via a new helper that mirrors `parseGhPrListJson` but consumes REST JSON. Conditional requests use `If-None-Match` against the previous run's etag (stored on `ContributorInventorySyncRun.perSourceResult`) to stay inside the 5,000-requests-per-hour budget.

If no GitHub credential is bound (customer install with no contributor connected yet), source 3 records `ok: false, error: "no GitHub credential bound"` and writes zero rows. The other two sources run normally.

### Write strategy

For each successful source:

1. Generate `syncRunId = cuid()` once per sync invocation.
2. For each row in that source, `INSERT` a new `ContributorInventorySnapshot` row with `source`, `sourceKey`, `payload`, `syncRunId`, `fetchedAt = now()`.
3. The read path uses `(source, max(syncRunId.startedAt))` semantics — failed mid-write partial rewrites stay invisible until the run row's `status` flips to `completed` or `partial`.

After all three sources finish:

1. Update the `ContributorInventorySyncRun` row with `completedAt`, `durationMs`, `status` (`completed` if all three sources ok; `partial` if any failed; `failed` only on infra crash), and `perSourceResult`.
2. Upsert the `ScheduledJob` row keyed by `jobId: "contributor-inventory-sync"` with `lastRunAt`, `lastStatus`, `lastError`, and `nextRunAt = startedAt + 10 minutes`.
3. Run cleanup: delete `ContributorInventorySnapshot` rows whose `syncRunId` is referenced only by `ContributorInventorySyncRun` rows older than the retention window.

### Manual trigger

A new MCP tool `trigger_contributor_inventory_sync` (admin scope) sends an `ops/contributor-inventory-sync.run` event that fires the same function on demand. Useful for operator-driven refreshes after a known external change (e.g., a contributor just pushed a branch and wants the dashboard to reflect it before the next cron tick).

## Read Model

### New shape: `loadContributorChangeLaneReadModel`

The function signature drops the `runners` argument and instead reads `ContributorInventorySnapshot` rows for the most recent completed sync, per source:

```ts
export type LaneReadModelArgs = {
  db?: ReadModelDb;
  now?: Date;
  staleHeartbeatThresholdMs?: number;
  staleVerifiedThresholdMs?: number;
};

export async function loadContributorChangeLaneReadModel(
  args: LaneReadModelArgs = {},
): Promise<LaneReadModelResult> { ... }
```

Internal flow:

1. Read `ContributorInventorySyncRun` for the most recent `status IN ("completed", "partial")` run; record its `syncRunId` and `perSourceResult`.
2. For each source ("git-worktree", "git-branch", "github-pr"), load `ContributorInventorySnapshot` rows for that `syncRunId` and decode `payload` into the existing snapshot shapes (typed via the same `GitWorktreeSnapshot`, `GitBranchSnapshot`, `PullRequestSnapshot` from `types.ts`).
3. Read Prisma sources (`WorkCapsule`, `RuntimeTarget`, `RuntimeVerification`, `NonProductionEnvironmentLease`) exactly as today.
4. Build `LaneReadModelFreshness` entries: live Prisma sources report `ok: true, fetchedAt: now`. Snapshot sources report the `fetchedAt` recorded on their rows (or the `perSourceResult` error if that source failed in the last run).
5. Pass everything into `projectContributorChangeLanes` unchanged.

### Freshness display

The dashboard already renders source freshness as a band of dots. Two changes:

1. The "fetchedAt" timestamp shown for git/GitHub sources is the snapshot timestamp, not `now`. Wording on the page changes from "Snapshot taken now" for those sources to "Inventory last synced at HH:MM (NN minutes ago)".
2. If the most recent sync is older than 2× the cron interval (default: 20 minutes), the band shows a yellow "stale" indicator and the snapshot panel surfaces the `lastError` from `ScheduledJob`.

### Page server component

`apps/web/app/(shell)/platform/development/change-lanes/page.tsx` no longer imports `createNodeInventoryRunners` and no longer passes `runners` to the read model. It becomes:

```tsx
export const dynamic = "force-dynamic";

export default async function ChangeLanesPage() {
  const now = new Date();
  const { lanes, freshness } = await loadContributorChangeLaneReadModel({ now });
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6">
      <ChangeLanesDashboard
        lanes={lanes}
        freshness={freshness}
        generatedAt={now.toISOString()}
      />
    </div>
  );
}
```

## Composition with PR #1204

PR #1204 (contributor MCP readiness) governs whether a contributor's **portal MCP token** is set up correctly. This spec governs whether the portal can show inventory data **without** requiring contributor credentials at the Live portal surface. The two compose cleanly:

- A contributor connects through `ContributorMcpReadinessCard` (PR #1204) → portal MCP scope grants are set.
- That contributor's GitHub credential (a separate `CredentialEntry` row from a Tier 2/3 PAT or device flow OAuth) authorizes the GitHub portion of this sync.
- The Live portal can render the dashboard for any user regardless of which contributor is connected; the snapshot is shared workspace-wide, not per-user.

No new MCP tool from PR #1204 is depended on. The `trigger_contributor_inventory_sync` tool added here is governed by the same `TOOL_TO_GRANTS` substrate (`apps/web/lib/tak/agent-grants.ts`) that PR #1204 follows.

## Customer-install behavior

The Live portal at a customer install — where no contributor has connected, no GitHub credential is bound, and the user does not have `gh` installed — must still render `/platform/development/change-lanes` meaningfully. Specifically:

- The cron runs locally (Inngest is bundled).
- `git worktree list` and `git for-each-ref` succeed (the portal container has `git`; the bind-mount is the repo).
- The GitHub source records `ok: false, error: "no GitHub credential bound"` and zero rows.
- The dashboard renders all locally-known lanes; PR-related columns are empty for branches that have no record.
- The source-freshness band shows two green dots (git-worktree, git-branch) and one neutral "not configured" indicator for GitHub.

This is the Live-portal-must-render constraint from the prompt, satisfied by the sources-fail-independently principle.

## Phasing

### Phase 1 — Schema and run row

Add the `ContributorInventorySnapshot` and `ContributorInventorySyncRun` Prisma models with a migration. No Inngest function yet. Tests for the migration apply cleanly.

### Phase 2 — Inngest sync function (local git only)

Implement the Inngest cron and the two local-git source readers. GitHub source returns "not implemented yet" so its row is `ok: false`. Read model is not yet wired. Test the function with fake `step.run` harnesses against fake git output.

### Phase 3 — Read model swap

Change `loadContributorChangeLaneReadModel` to read from snapshot rows. Update the page server component. Keep `runners-node.ts` on disk but unreferenced. Update `read-model.test.ts` to use fake snapshot rows; delete the runner-injection paths. The dashboard now renders from sync output.

### Phase 4 — GitHub source

Add the GitHub REST reader to the sync function. Token resolution goes through `CredentialEntry` (no new credential substrate). Pagination, conditional requests via `If-None-Match`, rate-limit handling, "no credential" path. Tests fake `fetch` and exercise success / no-credential / API-error / rate-limit-headers paths.

### Phase 5 — Manual trigger MCP tool

Add `trigger_contributor_inventory_sync` MCP tool; update `TOOL_TO_GRANTS`. Tests for the tool surface and the insufficient-scope path.

### Phase 6 — Cleanup and freshness wiring

Add the per-run retention sweep (delete snapshot rows older than the retention window). Wire stale-heartbeat warning in the dashboard freshness band. Delete `runners-node.ts` and the now-unused `LaneReadModelInventoryRunners` type.

### Phase 7 — Functional verification

Bring up the Contributor preview, drive the dashboard, confirm:

- Cron fires every 10 minutes and writes snapshot rows.
- A pushed branch shows up in the dashboard on the next cron tick.
- Disabling the GitHub credential leaves the page rendering with local-git data only.
- Stopping the cron for >20 minutes triggers the stale-heartbeat warning.
- The Live portal at `:3000` renders the same data the Contributor preview shows (proves the architecture goal).

## Risks And Mitigations

- **Risk: snapshot writes amplify DB load** if branch/worktree counts are large.
  - Mitigation: bulk inserts (`createMany`); typical inventory is ~100 branches and ~85 worktrees per the 2026-05-26 snapshot in [PR #1205](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1205); even 10× growth is comfortably under 1k rows per sync.
- **Risk: cron interval is wrong** — too short wastes API budget, too long makes the dashboard feel stale.
  - Mitigation: default 10 minutes is configurable per the `ScheduledJob.schedule` field; future tuning is a config change, not a code change.
- **Risk: contributor pushes a branch, runs `/platform/development/change-lanes`, doesn't see it** because the cron hasn't fired.
  - Mitigation: the manual trigger MCP tool exists for exactly this case. The dashboard surfaces "Last synced HH:MM (N minutes ago) — refresh now" affordance gated on admin scope.
- **Risk: GitHub API rate-limit during a burst of activity**.
  - Mitigation: conditional requests with etag; pagination caps; the 5,000 req/hr authenticated budget is comfortable at 10-minute polling.
- **Risk: snapshot rows accumulate without bound** if cleanup fails.
  - Mitigation: cleanup is part of the sync run, not a separate cron; failure to cleanup is recorded on the run row.
- **Risk: a partial-failure sync overwrites known-good data.**
  - Mitigation: read path filters on `syncRunId` from the most-recent `completed`/`partial` run; per-source success is tracked separately, so a failed GitHub source does not invalidate good local-git rows.
- **Risk: `git` is missing inside the worker container too**, not just the dev-portal one.
  - Mitigation: the Dockerfile for the portal already includes `git` (verified by the existing `code-graph-reconcile` cron and `discovery-runner`, both of which shell out to `git` from inside the same container). If a future image regression removes it, the sync source records `error: "git binary not found"`, the dashboard shows the source as failed, and the operator gets a Platform Notification — same failure-mode treatment as `token-expiry-monitor`.

## Acceptance Criteria

- `/platform/development/change-lanes` no longer shells out to `git`, `gh`, or `fetch` during a page render.
- `runners-node.ts` is deleted; `LaneReadModelInventoryRunners` type is removed.
- `loadContributorChangeLaneReadModel` reads `ContributorInventorySnapshot` rows and existing Prisma sources only.
- A scheduled Inngest function `ops/contributor-inventory-sync` runs every 10 minutes, writes snapshot rows, and updates `ScheduledJob` heartbeat.
- A Live-portal install with no GitHub credential renders the dashboard with local-git data and an empty (not failed) GitHub-PR column.
- A contributor pushing a branch sees it in the dashboard within one cron tick (or immediately after invoking `trigger_contributor_inventory_sync`).
- The cron handles per-source failure independently — one failed source does not invalidate other sources.
- `lane-projection.ts` and `types.ts` are not modified by this work.
- The freshness band shows snapshot-age, not request-time-now, for the three migrated sources.

## Provenance

Spec authored by Claude on 2026-05-26 as the long-term follow-up to [PR #1207](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1207). Operator (Mark) handed the task to Claude under PAR. Substrate verified against `origin/main` at commit `3787f481` before drafting. Kernel decision recorded inline in §Architecture Decision; the `mcp__dpf__principle_decide` invocation is the audit trail.

Tracked as `BI-063BDF1B` under epic `EP-REDUCTION-GEAR-ARCH` (triaged `build`, size `large`). Filed for tracking only — not promoted to Build Studio per project memory `build-studio-non-functional-2026-05-26`; Claude implements directly after operator approves the spec.

This is a `draft-for-operator-review` spec. No implementation has been started; that begins after operator approval of the design.
