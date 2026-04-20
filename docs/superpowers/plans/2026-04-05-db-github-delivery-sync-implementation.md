# DB to GitHub Delivery Sync Implementation Plan

> **For implementation after approval:** use the branch/PR workflow for this spec. Create one short-lived intent-named branch from `main`, keep commits focused, open a draft PR early, and do not mark the work complete until targeted Vitest coverage and `pnpm --filter web exec next build` both pass.

**Spec:** `docs/superpowers/specs/2026-04-05-db-github-delivery-sync-design.md`

**Goal:** implement a DB-as-truth, GitHub-as-delivery-mirror workflow so implementation-ready `BacklogItem`s can sync to one configured GitHub repository and one configured GitHub Project without replacing the platform backlog as the system of record.

**Initial scope:** one repository, one GitHub Project, implementation-ready backlog items only, issue/project/PR linkage plus sync status, manual visibility plus operational reconciliation.

## Review Findings

### Current platform integration points

- `apps/web/lib/actions/backlog.ts` is the current write path for `BacklogItem` and `Epic` CRUD, so it is the natural place to trigger outbound sync when delivery-related fields change.
- `apps/web/lib/mcp-tools.ts` already exposes backlog tools (`create_backlog_item`, `update_backlog_item`, `query_backlog`) and can later surface sync/reconcile actions to coworkers if needed.
- `apps/web/lib/tak/agentic-loop.ts` already writes every tool execution into `ToolExecution`, which gives us existing audit plumbing we can reuse for sync observability instead of inventing a second opaque log.
- `apps/web/lib/tak/mcp-server-tools.ts` supports external HTTP MCP servers but blocks stdio execution in the portal, so the initial GitHub delivery sync should be a first-class server integration, not a stdio MCP dependency.
- `package.json` and `apps/web/package.json` do not show a dedicated GitHub SDK dependency today, and I did not find a first-class GitHub sync module in the reviewed paths. This looks like net-new domain code rather than an extension of an existing GitHub service.

### Current backlog/data shape relevant to this work

- `BacklogItem` already has the core platform identity and governance links surfaced through `apps/web/lib/actions/backlog.ts`: `itemId`, `title`, `type`, `status`, `priority`, `body`, `epicId`, `digitalProductId`, `taxonomyNodeId`, `submittedById`, and `completedAt`.
- `Epic`, `Portfolio`, `DigitalProduct`, and taxonomy relationships already exist in Prisma, so GitHub sync should reference platform IDs instead of duplicating portfolio/product truth in GitHub.
- Seed data is explicitly not runtime truth. Delivery sync must operate against live DB records only.

### Gaps to fill

- No durable join table currently links a backlog item to GitHub issue/project/PR artifacts.
- No delivery-specific status field currently separates engineering execution state from platform backlog/governance state.
- No reviewed GitHub webhook or reconciliation path was found in the inspected code.
- No reviewed first-class configuration path was found yet for a repository/project delivery target.

## Minimum Data Model Changes

Keep the first schema change set intentionally small.

### `BacklogItem` additions

- `executionPath String?`
- `deliveryStatus String?`
- `specPath String?`
- `planPath String?`

These fields keep the platform record directly navigable and let us distinguish business backlog state from repository delivery state.

### New `GitHubDeliveryLink` model

- `id String @id`
- `backlogItemId String @unique`
- `repositoryOwner String`
- `repositoryName String`
- `projectNumber Int`
- `issueNumber Int?`
- `issueUrl String?`
- `projectItemId String?`
- `latestPrNumber Int?`
- `latestPrUrl String?`
- `issueState String?`
- `projectStatus String?`
- `syncState String`
- `syncError String?`
- `lastSyncedAt DateTime?`
- `createdAt DateTime`
- `updatedAt DateTime`

This is the durable join plus retry/debug state. Do not denormalize `epicId`, `portfolioId`, or `digitalProductId` into this table in v1 because those already live on the platform side and can be joined.

### Configuration storage

- Reuse an existing configuration store such as `PlatformConfig` for one JSON config record describing the single GitHub owner, repo, project number, and label conventions.
- Keep the GitHub token in environment or existing secret storage, not in this config record.

## Sync Ownership Rules

### Platform authoritative

- Backlog item identity and lifecycle
- Epic, portfolio, and digital product linkage
- Priority and governance decisions
- `executionPath`
- `specPath` and `planPath`

### GitHub authoritative

- Issue open/closed state
- GitHub Project workflow column/status
- Linked PR number, URL, and merge state
- Assignee and review state

### Shared with clear direction

- Title and implementation description originate in the platform and overwrite GitHub on outbound sync
- Delivery execution status originates in GitHub and writes back into `BacklogItem.deliveryStatus`
- `BacklogItem.status` only auto-advances on narrow, explainable rules

## Sync-Back Proposal for `BacklogItem`

Use `deliveryStatus` for repository execution truth and keep `status` for platform backlog/governance truth.

### `deliveryStatus` mapping

- No link: `not_mirrored`
- Issue exists, not yet started: `ready`
- Project state `In Progress`: `in_progress`
- PR opened or project state `In Review`: `in_review`
- PR merged or project state `Merged`: `merged`
- Release marker present or project state `Released`: `released`
- Issue closed without merged PR: `closed_unmerged`
- Sync failure: `sync_error`

### Controlled updates to `BacklogItem.status`

- When a mirrored item first moves into active GitHub execution, platform may auto-move `status` from `open` to `in-progress`.
- When the linked PR is merged and the issue is closed, platform may auto-move `status` from `open` or `in-progress` to `done`.
- Never auto-set `deferred` from GitHub activity.
- Never let GitHub overwrite priority, epic, portfolio, digital product, or execution path.

This keeps GitHub execution state flowing back into the backlog without turning GitHub into the business system of record.

## Architecture

### Outbound path

1. User or system marks a backlog item as implementation-ready with `executionPath = github_delivery`.
2. Backlog action calls a dedicated GitHub delivery service.
3. Service creates or updates:
   - GitHub issue
   - GitHub Project item membership/status
   - `GitHubDeliveryLink`
   - `BacklogItem.deliveryStatus`
4. Service records sync timestamps, last error, and outcome for visibility.

### Inbound path

1. GitHub webhook receives issue, project item, and pull request events for the configured repo.
2. Webhook resolves the originating backlog item through `GitHubDeliveryLink`.
3. Webhook updates:
   - `GitHubDeliveryLink.issueState`
   - `GitHubDeliveryLink.projectStatus`
   - `GitHubDeliveryLink.latestPrNumber`
   - `GitHubDeliveryLink.latestPrUrl`
   - `GitHubDeliveryLink.syncState`
   - `BacklogItem.deliveryStatus`
   - `BacklogItem.status` only when the controlled rules above apply

### Reconciliation path

1. Add a manual “reconcile with GitHub” action for a single backlog item.
2. Add a scheduled reconciler later in the same service layer, but keep the first implementation callable on demand for debugging.
3. Reconciliation always treats DB identity as primary and repairs missing or stale GitHub linkage.

## Implementation Chunks

## Chunk 1: Schema and configuration

- [ ] Add the minimal `BacklogItem` fields listed above.
- [ ] Add `GitHubDeliveryLink`.
- [ ] Generate a Prisma migration and include any required backfill SQL inline.
- [ ] Add a single config reader for GitHub delivery target settings.
- [ ] Keep initial target config limited to one owner, one repo, and one project number.

## Chunk 2: GitHub client and mapping layer

- [ ] Add a first-class server-side GitHub client module under `apps/web/lib/`.
- [ ] Implement helpers for:
  - issue title/body generation
  - DPF label generation
  - GitHub Project item creation/update
  - PR linkage extraction
  - sync status mapping from GitHub to platform delivery status
- [ ] Keep the implementation explainable by storing raw identifiers and returned URLs in `GitHubDeliveryLink`.

## Chunk 3: Outbound sync from backlog actions

- [ ] Add a delivery sync service that is invoked from backlog update flows when delivery-related fields change.
- [ ] Only sync items whose `executionPath` is `github_delivery`.
- [ ] Require `specPath` and `planPath` before first issue creation so GitHub issues always link back to design intent.
- [ ] Make sync idempotent:
  - create issue/project item if link does not exist
  - update issue/project item if link already exists
- [ ] Persist `syncState`, `syncError`, and `lastSyncedAt` on every attempt.

## Chunk 4: Inbound GitHub webhook

- [ ] Add a GitHub webhook route in `apps/web/app/api/...` for issue, project, and PR events.
- [ ] Verify webhook signature.
- [ ] Filter aggressively to the configured repository and configured project only.
- [ ] Resolve the backlog item through `GitHubDeliveryLink`, not by fuzzy title matching.
- [ ] Update platform delivery fields using the ownership rules above.

## Chunk 5: Manual/debug visibility

- [ ] Add backlog UI visibility for:
  - execution path
  - delivery status
  - linked GitHub issue
  - linked PR
  - last sync time
  - sync error if present
- [ ] Add a manual per-item sync/reconcile action so the system stays explainable during rollout.
- [ ] Reuse existing audit patterns and `ToolExecution` logging where appropriate instead of inventing a hidden background-only flow.

## Chunk 6: Tests

- [ ] Add focused unit tests for:
  - issue body/label generation
  - GitHub state to `deliveryStatus` mapping
  - controlled `BacklogItem.status` transitions
  - idempotent link creation/update behavior
  - webhook payload handling and repo/project filtering
- [ ] Add tests around failure handling so sync errors are visible, persisted, and non-destructive.

## Chunk 7: Branch and PR workflow after approval

- [ ] Create a feature branch from `main` after plan approval.
- [ ] Suggested branch name: `feat/db-github-delivery-sync`
- [ ] Make small commits in this order:
  - schema/config
  - GitHub client + mapping
  - outbound sync
  - inbound webhook
  - UI visibility
  - tests
- [ ] Open a draft PR once the schema and service skeleton are in place so delivery artifacts dogfood the new workflow.

## Verification Gate

- [ ] Run focused tests for the touched files with `pnpm --filter web exec vitest run ...`
- [ ] If a migration is added, verify it applies cleanly without drift
- [ ] Run `pnpm --filter web exec next build`
- [ ] Do not claim completion until all three are green or any pre-existing blocker is explicitly identified

## Assumptions

- We will use one configured GitHub repository and one GitHub Project in v1.
- GitHub token management can rely on existing environment/secret handling rather than a new credentials UI in this first pass.
- Delivery sync is only for implementation-ready work, not for proposed backlog items.
- Platform specs and plans remain in git under `docs/superpowers/` and are linked from GitHub issues/PRs rather than copied into GitHub as source text.

## Approval Gate

After plan approval, implementation should begin on the feature branch using the chunk order above.
