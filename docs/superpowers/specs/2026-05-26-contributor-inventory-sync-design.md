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

- `read-model.ts` no longer accepts `LaneReadModelInventoryRunners`; it reads the snapshot rows from Prisma via latest-successful-per-source semantics, and its `LaneReadModelFreshness` type gains an explicit five-state `state` discriminator.
- `apps/web/app/(shell)/platform/development/change-lanes/page.tsx` no longer instantiates runners.
- `ChangeLaneSourceSummary.tsx` renders five freshness states (not two), grouped into "Live data" and "Inventory snapshot" sub-rows, with an admin-only Refresh button.
- `ChangeLaneTable.tsx` gets a `warming-up` empty-state copy and a "PR data not configured" header annotation triggered by `freshness["github-pr"].state === "not-configured"`.
- `runners-node.ts` is left on disk through the main implementation PR for rollback safety; its deletion ships in the follow-up Phase 8 PR after one rollback window has elapsed.

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

### Snapshot Tables And Audit Rows

Two patterns already in `packages/db/prisma/schema.prisma`:

- **Columnar snapshots** (the majority): `TaxDecisionSnapshot` (line 2849), `ComplianceSnapshot` (line 6540), `ContractUsageSnapshot` (line 7390) all use typed scalar columns with at most a small JSON sidecar for evidence/metadata. These are domain-rich enough that columnar pays off.
- **JSON-payload snapshot** (the minority): `EaSnapshot` (line 5674) holds the entire projection in a single `graphJson: Json` field. This is the precedent this spec follows — the lane projection consumes three known TypeScript shapes that already live in `apps/web/lib/contributor-change-lanes/types.ts`, and a JSON payload lets those shapes evolve under `types.ts` without a migration per shape change.
- **Per-run audit rows**: `BackupRun` (line 1709) records per-run status + duration + error for the `postgres-daily-backup` cron, while `ScheduledJob` (line 1691) holds the user-facing heartbeat. This spec mirrors that two-table split (sync rows + run audit + ScheduledJob heartbeat).

Gap: no `ContributorInventorySnapshot` yet. The new model follows the `EaSnapshot` JSON-payload precedent for snapshot rows and the `BackupRun` pattern for per-run audit.

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

**Adopt Option A: one runner shared by two Inngest functions (cron + on-demand event, same concurrency group) syncs both local git inventory and remote GitHub PR state into a single `ContributorInventorySnapshot` Prisma table. The read model queries the DB only via latest-successful-per-source semantics; `runners-node.ts` is left on disk for the main slice and deleted in a follow-up Phase 8 PR after one rollback window.**

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

The read path queries the latest-successful-per-source `syncRunId` (see §Read Model). Older `ContributorInventorySnapshot` rows are kept for a fixed retention window (default 7 days) to support incident-time forensic inspection via direct DB query — there is no UI for browsing historical snapshots in this slice. A small periodic pass inside the same cron deletes rows older than the window.

**The cleanup must never delete the rows the read path is currently resolving to.** Specifically, before deleting:

1. Compute the set of `syncRunId`s that are the latest successful per source across all three sources. This is at most three IDs.
2. Always preserve `ContributorInventorySnapshot` rows whose `syncRunId` is in that set, **regardless of age.**
3. Always preserve the corresponding `ContributorInventorySyncRun` rows (`ON DELETE` is by string join, not FK cascade).
4. Delete other rows older than the 7-day window only.

This defends against the "cron has been broken for >7 days" failure mode: the rule "preserve latest-successful-per-source" means even an old snapshot stays around as long as it's still the freshest the dashboard has. Without this guard, the cleanup pass would erase the only data the dashboard could read.

This 7-day window deliberately exceeds Mark's weekly travel cadence (memory `idle_is_not_abandoned`): a Monday operator must still be able to inspect last Wednesday's snapshot.

### Etag persistence

GitHub conditional requests use `If-None-Match` with the previous response's etag. Storing the etag on `ContributorInventorySyncRun.perSourceResult` is wrong because the retention sweep can delete that row: after 7 days of `304 Not Modified` on a quiet repo, the etag would vanish and the rate-budget protection would silently lapse.

The etag is stored instead on the **`ScheduledJob` row** for `jobId: "contributor-inventory-sync"`, in a new `metadata: Json` field (mirroring how other `ScheduledJob` rows hang per-job state off a `metadata` column where needed). `ScheduledJob` rows are upserted, never retention-swept, so the etag is durable across arbitrary cron-quiet periods. On each sync, the GitHub reader reads `ScheduledJob.metadata.githubPrEtag` for the `If-None-Match` header and writes the new etag back into the same field after a successful 200 or 304 response.

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
3. **GitHub pull requests** — `fetch` to `https://api.github.com/repos/{owner}/{repo}/pulls?state=open&per_page=100&page=N` with `Authorization: Bearer ${token}` resolved from the `CredentialEntry` row whose `providerId = "github-pr-sync"` and `status = "active"`. (New, dedicated providerId — disambiguates from the contribution-review path which uses the same store but a different row; both rows can coexist.) Pagination until the response is short or the absolute cap is reached. Parsed into the existing `PullRequestSnapshot` shape via a new helper that mirrors `parseGhPrListJson` but consumes REST JSON. Conditional requests use `If-None-Match` against the etag stored on `ScheduledJob.metadata.githubPrEtag` (see §Etag persistence) to stay inside the 5,000-requests-per-hour budget.

   The credential row is created and managed by the `ContributorMcpReadinessCard` flow (PR #1204) when a contributor connects their GitHub account. A customer install where no contributor has connected has no `github-pr-sync` row; that is the explicit "no credential bound" path described next. The UX panel that owns the connect/disconnect cycle is named in §Customer-install behavior so operators know which surface to act on.

If no GitHub credential is bound, source 3 records `ok: false, error: "no GitHub credential bound — connect GitHub on the contributor MCP readiness card to populate PR data"`, `state: "not-configured"`, and writes zero rows. The error string is operator-actionable wording, not a technical message. The other two sources run normally.

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

The function signature drops the `runners` argument and instead reads `ContributorInventorySnapshot` rows from the **latest successful run per source** — not the latest run overall. This preserves known-good data from a prior sync when a more recent sync had one source fail:

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

1. For each of the three snapshot sources (`"git-worktree"`, `"git-branch"`, `"github-pr"`), independently find the most recent `ContributorInventorySyncRun` where `perSourceResult.<source>.ok === true`, record that `syncRunId`, and load only the rows for that source. Sources are resolved independently: if the most recent overall run is "partial" because GitHub failed, the local-git sources read from that run while the GitHub source falls back to its own most recent successful run.
2. Decode each row's `payload` into the existing `GitWorktreeSnapshot` / `GitBranchSnapshot` / `PullRequestSnapshot` shapes from `types.ts` (unchanged).
3. Read Prisma sources (`WorkCapsule`, `RuntimeTarget`, `RuntimeVerification`, `NonProductionEnvironmentLease`) exactly as today.
4. Build `LaneReadModelFreshness` entries with an explicit `state` discriminator (`"ok" | "stale" | "error" | "not-configured" | "warming-up"`) and an actionable `message` string. Live Prisma sources are always `state: "ok"`. Snapshot sources report the `fetchedAt` of the row source resolved in step 1, plus `state: "stale"` if that timestamp is older than `staleHeartbeatThresholdMs` (default 20 minutes = 2× cron interval), or `state: "warming-up"` if no successful run exists yet (first 0–10 min after deploy).
5. Pass everything into `projectContributorChangeLanes` unchanged.

The `ContributorInventorySyncRun.status` field stays four-valued (`running` / `completed` / `partial` / `failed`) but is **audit-only**: the read path never compares it. This eliminates the "partial vs completed" semantic ambiguity — what matters is per-source `ok`, not the overall run rollup.

### Stuck-run recovery

If the Inngest worker is killed mid-`step.run`, a `ContributorInventorySyncRun` row stays at `status: "running"` indefinitely. On entry to every scheduled tick, the sync function first marks any `running` run row older than the cron interval (`startedAt < now - 10 min`) as `status: "failed"` with `error: "stuck — worker terminated before completion"`. This mirrors `apps/web/lib/integrate/agent-task-dispatch.ts`'s stale-running reaper. Without this rule the per-source freshness lookup would still skip the stuck row correctly (it's not `ok: true`), but the dashboard's audit panel would show a permanent in-flight sync that confuses operators. The reaper runs on cron entry only; manual MCP-triggered runs are queued behind any active run by `concurrency: { limit: 1 }`, so they cannot collide with one already in flight.

### Freshness display

The freshness band today (`apps/web/components/platform/development/change-lanes/ChangeLaneSourceSummary.tsx`) renders a binary `ok ? green : red` dot per source. This spec extends the contract.

**Type change.** `LaneReadModelFreshness` gains an explicit `state` discriminator:

```ts
export type LaneReadModelFreshness = {
  source: LaneReadModelSource;
  state: "ok" | "stale" | "error" | "not-configured" | "warming-up";
  fetchedAt: Date;
  message: string | null;
  count: number;
};
```

(The legacy `ok: boolean` and `error: string | null` fields are removed in the same Prisma-models PR slice; the component is updated to read `state` directly.)

**Dot color and label per state**, using existing theme variables only:

- `ok` — `var(--dpf-success)`, label is the per-source count.
- `stale` — `var(--dpf-warning)`, label is "stale — last synced HH:MM" with hover tooltip showing the `ScheduledJob.lastError` if any.
- `error` — `var(--dpf-error)`, label is the operator-actionable `message`.
- `not-configured` — `var(--dpf-muted)` (neutral dot), label is "GitHub not connected" (or equivalent per source). This is the customer-install no-credential case; deliberately not red because the absence of a credential is a normal state, not a failure.
- `warming-up` — `var(--dpf-muted)` with a pulsing animation, label is "Syncing — first results within ~10 min". This is the cold-start case after migration deploy or `prisma migrate reset` before the first cron tick has completed.

**Per-source timestamp wording.** Snapshot sources (git-worktree, git-branch, github-pr) show "Last synced X minutes ago" using the existing `formatRelative` helper in `apps/web/components/platform/development/change-lanes/ChangeLaneTable.tsx:154` (which already returns "just now" for sub-minute deltas). Live Prisma sources (work-capsule, runtime-target, runtime-verification, nonprod-lease) show only `count` as today; they have no snapshot lag. To keep the grammar consistent, the band groups sources into two sub-rows: **"Live data"** (the four Prisma sources) and **"Inventory snapshot"** (the three sync sources). A short separator + group header keeps the two grammars visually distinct.

**Stale threshold reuses existing knob.** The 20-minute stale threshold is `args.staleHeartbeatThresholdMs ?? 20 * 60_000` — the same `LaneReadModelArgs.staleHeartbeatThresholdMs` knob the read model already accepts (see `apps/web/lib/contributor-change-lanes/read-model.ts:48` and `lane-projection.ts:39`). No new threshold knob.

**Tab counts on partial syncs.** `apps/web/components/platform/development/change-lanes/ChangeLanesDashboard.tsx` derives tab counts from the projection output. When any snapshot source is in state `stale` / `error` / `warming-up`, the dashboard renders a `(?)` glyph adjacent to the count badges, with hover text "Counts may be incomplete — some inventory sources are not synced." This prevents the silent-undercount failure mode where, e.g., GitHub being out reduces "Branches needing handoff" from 11 to 7 with no visible warning.

### Cold-start (warming-up) page rendering

On a fresh install, after `prisma migrate reset --force`, or after the Inngest worker has been down longer than the retention window, no successful `ContributorInventorySyncRun` will exist for one or more snapshot sources. The page must not render as a broken empty state:

1. The three affected freshness dots show `state: "warming-up"` with the pulsing animation and label described above.
2. The table empty state changes from the current "No lanes in this view." (in `ChangeLaneTable.tsx`) to "Inventory is still syncing — the first results will appear within ~10 minutes. Refresh the page once the freshness dots turn green." — but only when at least one snapshot source is `warming-up`; the original "No lanes in this view." stays for genuine empty filters.
3. Live Prisma sources (work capsules, runtime targets, etc.) still render their lanes if any exist; "warming-up" applies only to the missing snapshot data.

### Manual refresh affordance

The page exposes a **single, in-portal Refresh button** in the `ChangeLaneSourceSummary.tsx` header, gated on admin scope and dispatching the same `ops/contributor-inventory-sync.run` event the MCP tool dispatches. The MCP tool exists as a programmatic surface for headless agents; the button is the operator surface.

Click behavior:

1. Button enters a disabled state with spinner and inline text "Syncing…" the moment the dispatch returns from the server action.
2. The server action returns the new `syncRunId` (or the in-flight one if `concurrency: { limit: 1 }` queued the request) and a polling hint.
3. The client polls a small read-only server action every 3 seconds for the run status. While `status: "running"`, the spinner stays. On `status IN ("completed", "partial", "failed")`, the spinner is replaced by either a "Synced X seconds ago" toast (success) or an inline `var(--dpf-error)` message (failure), and the page revalidates.
4. The button stays disabled for the duration; click spam is harmless because `concurrency: { limit: 1 }` collapses everything to one run anyway.

This resolves the prior internal contradiction in this spec between "MCP tool only" and "Last synced HH:MM — refresh now affordance": the refresh affordance is a real DOM button, and the MCP tool exists for agents/automation.

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

The Live portal at a customer install — where no contributor has connected, no `github-pr-sync` `CredentialEntry` row exists, and the user does not have `gh` installed — must still render `/platform/development/change-lanes` meaningfully:

- The cron runs locally (Inngest is bundled).
- `git worktree list` and `git for-each-ref` succeed (the portal container has `git`; the bind-mount is the repo).
- The GitHub source records `state: "not-configured"` with the operator-actionable message described in §Per-source work.
- The dashboard renders all locally-known lanes; PR-related columns render `—` per cell but the **PR column header itself is annotated** with "GitHub not connected — connect on the Contributor MCP card to populate" (a muted subtitle under the column header) so an `—` cell is never silently mistaken for "this branch has no PR."
- The source-freshness band shows two green dots (git-worktree, git-branch) under "Inventory snapshot" and one neutral grey dot for GitHub PRs labelled "GitHub not connected," distinct from a failed (red) dot.
- The path to remediate (link to `/platform/contributor-mcp` or wherever `ContributorMcpReadinessCard` lives) appears as a clickable line next to the GitHub freshness dot when `state === "not-configured"`.

This is the Live-portal-must-render constraint from the prompt, satisfied by the sources-fail-independently principle and the explicit no-credential rendering rule.

## Operator notifications

The dashboard is operator-facing but not always-open. Operators who never visit `/platform/development/change-lanes` need another signal that something is wrong. The sync writes `PlatformNotification` rows in two cases, mirroring `apps/web/lib/queue/functions/token-expiry-monitor.ts`:

- **Prolonged GitHub source failure.** If `perSourceResult["github-pr"].ok === false` for ≥6 consecutive completed/partial runs (≈ 1 hour at the default cadence), write one notification with `category: "contributor-inventory-github"`, `severity: "warning"`, `subjectId: "github-pr-sync"`, `message: "GitHub inventory sync has been failing for over an hour. Reconnect on the Contributor MCP card."` Idempotency follows the token-expiry monitor's pattern: an open notification with the same `subjectId` is left alone if the severity is unchanged.
- **Sync never ran.** If `ScheduledJob.lastRunAt` is older than 2 hours (12× cron interval), write `category: "contributor-inventory-cron"`, `severity: "critical"`, `message: "Contributor inventory sync has not run in over 2 hours. Check Inngest health."`

The `not-configured` state alone does **not** fire a notification — that's a normal install posture, not a failure.

## Phasing

### Phase 1 — Schema and run row

Add the `ContributorInventorySnapshot` and `ContributorInventorySyncRun` Prisma models, the `metadata: Json?` column on `ScheduledJob` (if not already present), and the migration. Add an explicit FK from `ContributorInventorySnapshot.syncRunId` → `ContributorInventorySyncRun.syncRunId` (rather than the string-join used in the prior draft) so cleanup queries cannot orphan rows.

### Phase 2 — Inngest sync function (local git only)

Implement two separate Inngest functions sharing one runner (`runContributorInventorySync`):

- `contributorInventorySyncCron` — `triggers: [cron("*/10 * * * *")]`, runs the stuck-run reaper then the runner.
- `contributorInventorySyncOnDemand` — `triggers: [{ event: "ops/contributor-inventory-sync.run" }]`, runs the runner only.

Both share `concurrency: { limit: 1, scope: "fn-group" }` so the second is queued behind the first. (This is the established pattern in `apps/web/lib/queue/functions/code-graph-reconcile.ts` and `governed-backlog-tee-up.ts` — a single function with two trigger types in one array is not used elsewhere in the codebase.) GitHub source returns "not implemented yet" so its row is `ok: false`. Read model is not yet wired.

### Phase 3 — Read model swap

Change `loadContributorChangeLaneReadModel` to read from snapshot rows using latest-successful-per-source semantics. Extend `LaneReadModelFreshness` with the new `state` discriminator and update `ChangeLaneSourceSummary.tsx` to render the five states with their dot colors and labels. Add the cold-start `warming-up` table empty-state copy to `ChangeLaneTable.tsx`. Update the page server component to drop the `runners` argument. Keep `runners-node.ts` on disk but unreferenced (deletion is deferred to a later slice — see Phase 8). Update `read-model.test.ts` to use fake snapshot rows; delete the runner-injection paths.

### Phase 4 — GitHub source

Add the GitHub REST reader to the sync function. Token resolution looks up the `CredentialEntry` row with `providerId: "github-pr-sync"`, `status: "active"`. Pagination, conditional requests via `If-None-Match` against `ScheduledJob.metadata.githubPrEtag`, rate-limit handling, "no credential bound → state: not-configured" path. Add the "PR column not configured" header annotation to `ChangeLaneTable.tsx` triggered by `freshness["github-pr"].state === "not-configured"`. Tests fake `fetch` and exercise success / no-credential / API-error / rate-limit-headers / 304-not-modified paths.

### Phase 5 — Manual refresh affordance (button + MCP tool)

Add the Refresh button on `ChangeLaneSourceSummary.tsx` with admin-scope gating, server-action dispatch, in-flight polling, and post-completion toast/inline-error rendering per §Manual refresh affordance. Add the `trigger_contributor_inventory_sync` MCP tool and update `TOOL_TO_GRANTS`. Tests for the tool surface (insufficient-scope path), the server action, and the polling client.

### Phase 6 — Cleanup, notifications, tab-count warning

Add the per-run retention sweep with the latest-successful-per-source preservation guard. Add the `PlatformNotification` writes for prolonged GitHub failure and stale cron heartbeat per §Operator notifications. Add the `(?)` partial-sync warning glyph on tab counts in `ChangeLanesDashboard.tsx`. **Do not delete `runners-node.ts` in this slice** — see Phase 8.

### Phase 7 — Functional verification

Bring up the Contributor preview, drive the dashboard, confirm:

- Cron fires every 10 minutes and writes snapshot rows.
- A pushed branch shows up in the dashboard on the next cron tick or immediately after clicking Refresh.
- Cold-start UX: after `prisma migrate reset --force`, the page renders `warming-up` dots and the table empty-state copy until the first cron tick.
- Latest-successful-per-source: forcing a `partial` run (kill GitHub mid-sync) preserves the previous run's GitHub data on the dashboard, not an empty PR column.
- Stuck-run recovery: kill the worker mid-`step.run`, confirm the next cron tick marks the row `failed` with the stuck error.
- Etag persistence: confirm `ScheduledJob.metadata.githubPrEtag` is written and re-used across runs (verify by a captured `If-None-Match` header in fetch logs).
- Notifications: simulate ≥6 consecutive GitHub failures, confirm one `PlatformNotification` row is written and is idempotent on the next run.
- Disabling the GitHub credential moves the GitHub freshness dot to `not-configured` (grey), shows the column header annotation, does NOT fire a notification.
- Stopping the cron for >20 minutes moves all snapshot dots to `stale` (yellow).
- The Live portal at `:3000` renders the same data the Contributor preview shows.
- The refresh button triggers a run, the spinner shows, the page revalidates after completion.

### Phase 8 — Deprecation cleanup (follow-up PR)

In a separate PR that ships **after** Phases 1-7 have been observed working in production for at least one full backup/rollback window, delete `runners-node.ts` and the now-unused `LaneReadModelInventoryRunners` type. The deferral mirrors how PR #1207 left Phases 5-8 of the change-lanes plan to a follow-up: small, audit-friendly slices ship faster than big-bang refactors.

## Risks And Mitigations

- **Risk: snapshot writes amplify DB load** if branch/worktree counts are large.
  - Mitigation: bulk inserts (`createMany`); typical inventory is ~100 branches and ~85 worktrees per the 2026-05-26 snapshot in [PR #1205](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1205); even 10× growth is comfortably under 1k rows per sync.
- **Risk: cron interval is wrong** — too short wastes API budget, too long makes the dashboard feel stale.
  - Mitigation: default 10 minutes is configurable per the `ScheduledJob.schedule` field; future tuning is a config change, not a code change.
- **Risk: contributor pushes a branch, runs `/platform/development/change-lanes`, doesn't see it** because the cron hasn't fired.
  - Mitigation: the manual refresh button in the freshness header (see §Manual refresh affordance) and the `trigger_contributor_inventory_sync` MCP tool both dispatch the same Inngest event. The contributor clicks the button or invokes MCP; the dashboard auto-refreshes once the run completes.
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
- `loadContributorChangeLaneReadModel` reads `ContributorInventorySnapshot` rows (via latest-successful-per-source) and existing Prisma sources only.
- Two Inngest functions, `contributorInventorySyncCron` (cron `*/10 * * * *`) and `contributorInventorySyncOnDemand` (event-triggered), share one runner and one concurrency group; both update the `ScheduledJob` heartbeat for `jobId: "contributor-inventory-sync"`.
- A Live-portal install with no GitHub credential renders the dashboard with local-git data, a grey `not-configured` GitHub freshness dot, and a `—` PR column whose header carries the "GitHub not connected" annotation (not silently empty).
- A contributor pushing a branch sees it in the dashboard within one cron tick, or immediately after clicking Refresh (UI) or invoking `trigger_contributor_inventory_sync` (MCP).
- The read model preserves the most recent **successful** rows per source: a `partial` run with one failed source does not erase the previous run's known-good rows for that source.
- The stuck-run reaper marks `running` run rows older than the cron interval as `failed` on the next cron tick.
- The retention sweep never deletes rows the read path is currently resolving to (latest-successful-per-source preservation guard).
- GitHub etag is persisted on `ScheduledJob.metadata.githubPrEtag` and survives the 7-day retention window.
- The freshness band has a five-state discriminator (`ok` / `stale` / `error` / `not-configured` / `warming-up`), each with a distinct theme-variable color and an aria-label for screen readers.
- A cold-start install (no successful run yet) shows `warming-up` dots and a distinct table empty-state, not a blank "No lanes in this view."
- Tab counts on the dashboard carry a `(?)` warning glyph whenever any snapshot source is not `ok`.
- `PlatformNotification` rows are written for prolonged GitHub failure (≥6 consecutive failed runs) and stale cron heartbeat (no run in >2 h). The `not-configured` state alone does NOT fire a notification.
- `lane-projection.ts` and `types.ts` are not modified by this work.
- `runners-node.ts` is left on disk through Phase 7; deletion ships in a follow-up PR (Phase 8) after at least one rollback window has elapsed.

## Provenance

Spec authored by Claude on 2026-05-26 as the long-term follow-up to [PR #1207](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1207). Operator (Mark) handed the task to Claude under PAR. Substrate verified against `origin/main` at commit `3787f481` before drafting. Kernel decision recorded inline in §Architecture Decision; the `mcp__dpf__principle_decide` invocation is the audit trail.

Tracked as `BI-063BDF1B` under epic `EP-REDUCTION-GEAR-ARCH` (triaged `build`, size `large`). Filed for tracking only — not promoted to Build Studio per project memory `build-studio-non-functional-2026-05-26`; Claude implements directly after operator approves the spec.

## Review Revisions (2026-05-26 second pass)

This spec was first drafted and then submitted to two specialist reviewers (Enterprise Architect, UX Specialist) before operator review. The revisions below reflect their findings:

**Architectural corrections (from EA review):**
- `DiscoverySweep` was cited as a snapshot-pattern precedent and does not exist; removed. `EaSnapshot` and `BackupRun` are now cited honestly as the real precedents.
- The "single Inngest function with array-of-two-triggers" shape was unverified against other functions in the codebase. Changed to two separate functions sharing a concurrency group, mirroring `code-graph-reconcile.ts` and `governed-backlog-tee-up.ts`.
- The cleanup sweep could delete the rows the dashboard was actively reading. Added the "latest-successful-per-source preservation guard."
- The GitHub etag was stored on `ContributorInventorySyncRun.perSourceResult`, which can be retention-swept. Moved to `ScheduledJob.metadata.githubPrEtag` (upserted, never swept).
- The read-model rule "most recent completed-or-partial run" lost prior successful data on a partial run. Changed to **latest-successful-per-source**: each source resolves independently.
- The first-cron-tick blank-dashboard window was not addressed. Added the explicit `warming-up` state and rendering rule.
- Added an explicit stuck-run reaper (cron-entry only) for `running` rows older than the cron interval.

**UX corrections (from UX review):**
- The "MCP tool only" vs "Last synced — refresh now" contradiction is resolved: a real Refresh button in `ChangeLaneSourceSummary.tsx` with admin-scope gating, in-flight spinner, polling, and post-completion toast. The MCP tool exists for headless agents.
- The freshness band was binary `ok`/`error`. Extended `LaneReadModelFreshness` to a five-state discriminator (`ok` / `stale` / `error` / `not-configured` / `warming-up`) with theme-variable colors and aria-labels.
- The customer-install no-credential case rendered `—` in PR cells that read as "this branch has no PR." Added the PR column header annotation "GitHub not connected — connect on the Contributor MCP card."
- Tab counts will silently misrepresent reality on partial syncs. Added a `(?)` warning glyph next to counts when any snapshot source is not `ok`.
- Added `PlatformNotification` writes for prolonged GitHub failure (≥6 consecutive failed runs) and stale cron heartbeat (>2 hours), mirroring `token-expiry-monitor.ts`.
- Removed the unsupported "operators can browse historical snapshots" claim (no UI was planned for this).
- Freshness band wording now uses the existing `formatRelative` helper rather than a custom format string.

**Sliced for safety:**
- Phase 8 (`runners-node.ts` deletion) is now a follow-up PR, not part of the main implementation slice. Preserves rollback safety across one production window.
- Cross-PR overlap sweep now runs before every push, not only the final handoff (per memory `feedback_continuous_overlap_check`).

This is a `draft-for-operator-review` spec. No implementation has been started; that begins after operator approval of the design.
