# Portal Self-Upgrade Local Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:test-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the local implementation slice for `BI-CAPSULE-SELFUPGRADE-001`: detect when the Docker-served portal is behind `origin/main`, run a governed self-upgrade through the existing promoter surface, record durable run evidence, and complete merged Build Studio ship-phase records only after the running SHA is confirmed.

**Architecture:** Add a small `apps/web/lib/self-upgrade/*` module boundary around config validation, version checks, run persistence, promoter dispatch, completion reconciliation, and notifications. Extend `scripts/promote.sh` with `--self-upgrade` mode so the same backup, build, swap, health, and rollback path handles normal promotions and portal self-upgrade. Expose the path through an Inngest scheduled function and a compact Operations tab.

**Tech Stack:** Next.js server actions, Inngest, Prisma, Docker Compose, POSIX shell, Vitest.

**Backlog:** `BI-CAPSULE-SELFUPGRADE-001`.

---

## Status — 2026-05-20

The first implementation slice landed on `feat/portal-self-upgrade-local` (commit `8c129eb7`). The runtime is operational at the API/DB/script level; structural verification passed (typecheck, focused tests, build). **No functional `/ops/self-upgrade` drive has been completed yet,** and seven test files this plan called for did not ship (see "TDD debt" below).

The file structure that actually shipped diverges from the original plan in several places. The headings under each Task have been updated to reflect actual filenames so the next implementer reads accurate paths. Naming-of-record decisions made during implementation:

- `notification.ts` (singular) over `notifications.ts`
- `store.ts` over `run-store.ts`
- `apps/web/components/ops/SelfUpgradePanel.tsx` over `SelfUpgradeClient.tsx`
- `apps/web/lib/queue/functions/portal-self-upgrade.ts` over `self-upgrade.ts`
- New `apps/web/lib/actions/self-upgrade.ts` server-action surface, NOT a modification to `apps/web/lib/actions/promotions.ts`. The two surfaces share no code; self-upgrade is its own dispatcher.

### Canonical status enum

`SelfUpgradeRun.status` is one of: `queued | running | succeeded | failed | rolled_back | completing | skipped`. This lives as DB-stored strings and TS literals (no Prisma enum); any new state must update `store.ts`, `completion.ts`, and the dashboard. `completing` is the post-promoter-success-pre-build-reconciliation state; `succeeded` is reached only after `completeSelfUpgradeRun` confirms ancestry.

### Two Inngest functions, not one

The plan originally implied a single scheduled function. Implementation shipped THREE Inngest registrations in `apps/web/lib/queue/functions/portal-self-upgrade.ts`:

1. `portal/self-upgrade-scheduled` — daily cron (`0 8 * * *`), calls `runSelfUpgradeCycle({trigger:"scheduled"})`.
2. `portal/self-upgrade-requested` — event-triggered by `portal/self-upgrade.requested` (manual button), same cycle.
3. `portal/self-upgrade-completion-sweep` — separate cron (`*/15 * * * *`), reconciles runs in `completing` state to `succeeded` via `completePendingSelfUpgradeRuns`. Without this third function ship-phase builds never auto-complete.

### Capability gates (operator-facing)

`requireSelfUpgradeOperator(capability)` in `apps/web/lib/actions/self-upgrade.ts` gates two surfaces:

- Dashboard read (`getSelfUpgradeDashboardAction`) → `view_operations`.
- Manual trigger (`requestPortalSelfUpgradeAction`) → `manage_provider_connections`.

`manage_provider_connections` is the chosen gate because the local self-upgrade surface intentionally reuses the same "operator who manages production-touching infrastructure" capability rather than introducing a new `manage_self_upgrade` permission. If a separate gate is wanted for stricter governance, add the capability and update both this plan and the server action.

### Shell-injection / path-traversal defense

Config inputs flow into `docker run` argv via `execFile` and into `scripts/promote.sh` env vars used in `docker compose` invocations. The defense is:

- `apps/web/lib/self-upgrade/config.ts` enforces `SAFE_NAME_RE = /^[A-Za-z0-9_.:-]+$/` for container/image/branch/remote names and `SAFE_PATH_RE = /^[A-Za-z0-9_./:\\-]+$/` for host paths. Inputs that do not match are rejected at `loadSelfUpgradeConfig` time, before the promoter is ever started.
- `apps/web/lib/self-upgrade/promoter.ts` builds docker argv arrays (not shell strings) and uses `execFile` (not `exec`). `shellQuote` is exported for the rare cases that need it.
- `scripts/promote.sh` validates `SELF_UPGRADE_RUN_ID` against `^[a-zA-Z0-9_-]+$` and `TARGET_SHA` against `^[0-9a-fA-F]{40}$` before using either in SQL or docker calls.

Do not relax any of these constraints without re-reviewing the shell-injection surface.

### TDD debt — tests called for in this plan that did NOT ship

The plan declares `REQUIRED: superpowers:test-driven-development`. The following tests were listed under their respective tasks but never landed. They should land before this slice is closed:

- [x] `apps/web/lib/self-upgrade/store.test.ts` — idempotent run lifecycle (queued → running, run-id uniqueness, skipped variants) covered by the local hardening slice.
- [x] `apps/web/lib/self-upgrade/notification.test.ts` — message formatting per event type, severity mapping, and notification-failure logging covered by the local hardening slice.
- [x] `apps/web/lib/self-upgrade/promote-script-contract.test.ts` — round-trip: `buildPromoterDockerArgs` emits the env vars `scripts/promote.sh` reads (`SELF_UPGRADE_RUN_ID`, `SELF_UPGRADE_TARGET_SHA`, `DPF_HOST_SOURCE_PATH`, `DPF_COMPOSE_PROJECT`, `DPF_PORTAL_CONTAINER`, `DPF_PRODUCTION_DB_CONTAINER`, `DPF_SELF_UPGRADE_REMOTE`, `DPF_SELF_UPGRADE_BRANCH`, `DPF_SELF_UPGRADE_HEALTH_URL`) covered by the local hardening slice.
- [x] `apps/web/lib/queue/functions/portal-self-upgrade.test.ts` — function registration plus cron/event constants covered by the local hardening slice.
- [ ] `apps/web/lib/actions/self-upgrade.test.ts` (corresponds to the plan's `promotions.self-upgrade.test.ts`) — capability gate enforcement: an unauthenticated caller, a `view_operations`-only caller, and a `manage_provider_connections` caller; assert error wording for unauthorized.
- [ ] `apps/web/components/ops/SelfUpgradePanel.test.tsx` — renders current version, target version, recent runs, disabled state when config disabled, error state when `versionError` is set, manual-trigger button visibility per capability.
- [ ] `packages/db/src/self-upgrade-config.test.ts` — default PlatformConfig seed preserves operator edits (idempotent), and seed creates the row on a fresh DB.

### Known code-quality issues to address in a follow-up commit

- [x] `apps/web/lib/self-upgrade/completion.ts` had imports at the bottom of the file. Fixed in the local hardening slice.
- [x] `completeSelfUpgradeRun` retried forever on completion failure. The local hardening slice records `completionAttempts` in `completionEvidence`, caps retries at 4, and transitions exhausted runs to `failed` with `reason: "completion-retries-exhausted"`.
- [x] `notification.ts:36` swallowed notification errors silently. The local hardening slice logs the failure and keeps the intentional "notification must not break upgrade state" policy explicit in code.

### Files NOT mentioned in the original plan that landed

Add to the canonical file list for future readers:

- `docker-compose.yml` — adds `DPF_SELF_UPGRADE_HOST_SOURCE_MOUNT` env to the portal/worker services and a `${DPF_HOST_INSTALL_PATH}:/host-source:ro` mount.
- `packages/db/src/table-classification.ts` — classifies the new `SelfUpgradeRun` table.
- `apps/web/components/ops/OpsTabNav.tsx` — adds the Self-Upgrade tab link.
- `apps/web/lib/queue/inngest-client.ts` — registers the three functions above.

---

### Task 1: Persistence and Config

**Files (canonical, post-implementation):**
- Modified: `packages/db/prisma/schema.prisma` (added `SelfUpgradeRun` model)
- Created: `packages/db/prisma/migrations/20260520030000_self_upgrade_runs/migration.sql`
- Modified: `packages/db/src/seed.ts` (seeds `self_upgrade` PlatformConfig key)
- Modified: `packages/db/src/table-classification.ts` (classifies `SelfUpgradeRun`)
- Created: `apps/web/lib/self-upgrade/config.ts`
- Created: `apps/web/lib/self-upgrade/config.test.ts`

- [x] Add `SelfUpgradeRun` with status/SHA/log fields — landed.
- [x] Seed `self_upgrade` PlatformConfig defaults without overwriting operator edits — landed.
- [x] Implement `loadSelfUpgradeConfig` with zod schema + `SAFE_NAME_RE` / `SAFE_PATH_RE` validation — landed.
- [ ] **TDD debt:** `packages/db/src/self-upgrade-config.test.ts` — seed idempotency. Not yet shipped.

### Task 2: Version Detection and Promoter Dispatch

**Files (canonical, post-implementation):**
- Created: `apps/web/lib/self-upgrade/version.ts`
- Created: `apps/web/lib/self-upgrade/version.test.ts`
- Created: `apps/web/lib/self-upgrade/promoter.ts`
- Created: `apps/web/lib/self-upgrade/promoter.test.ts`
- Modified: `scripts/promote.sh` (~150 added lines for `--self-upgrade` branch)
- Modified: `docker-compose.yml` (host-source mount + env)

- [x] Compare `/app/.dpf-image-version` to the host checkout's `origin/main` — landed in `version.ts`.
- [x] Start `dpf-promoter` with `SELF_UPGRADE=1` and a writable host-source mount — `promoter.ts:buildPromoterDockerArgs`.
- [x] Extend `promote.sh --self-upgrade` to fetch, verify a clean host tree, build from host source, swap, health-check, and rollback — landed.
- [x] **TDD debt:** `apps/web/lib/self-upgrade/promote-script-contract.test.ts` — round-trip that the env vars `buildPromoterDockerArgs` emits are the same names `scripts/promote.sh` reads. This caught and fixed the `DPF_SELF_UPGRADE_HEALTH_URL` script mismatch.

> **Note on the source mount.** The host-source mount must be writable for the current design because `scripts/promote.sh --self-upgrade` fast-forwards the clean host checkout to the target SHA before building and swapping containers. The guardrail is not read-only mounting; it is the dirty-checkout refusal, target SHA validation, safe config validation, argv-based Docker dispatch, and shell-side run-id/SHA validation.

### Task 3: Run Store, Completion, and Notifications

**Files (canonical, post-implementation):**
- Created: `apps/web/lib/self-upgrade/store.ts` (was `run-store.ts` in original plan)
- Created: `apps/web/lib/self-upgrade/completion.ts`
- Created: `apps/web/lib/self-upgrade/completion.test.ts`
- Created: `apps/web/lib/self-upgrade/notification.ts` (was `notifications.ts` — singular won)

**Files originally proposed but not used:**
- `apps/web/lib/tak/agent-event-bus.ts` — NOT touched. Notifications go through `PlatformNotification` rows directly, not the agent event bus. If the agent event bus needs to surface self-upgrade events later, add a subscriber that reads `PlatformNotification` where `category = "self-upgrade"`.

- [x] Persist `queued | running | succeeded | failed | rolled_back | completing | skipped` runs — landed.
- [x] Complete only ship-phase FeatureBuilds whose branch/head SHA is an ancestor of the running production SHA — landed via `resolveBuildHeadCandidates` + `git merge-base --is-ancestor`.
- [x] Emit operator-visible self-upgrade events as `PlatformNotification` rows with `category = "self-upgrade"` and `severity = "info" | "warning"` — landed.
- [x] Idempotent ancestry-based completion test — landed in `completion.test.ts`.
- [x] **TDD debt:** `apps/web/lib/self-upgrade/store.test.ts` — covers `generateSelfUpgradeRunId`, `createSelfUpgradeRun` evidence, `markSelfUpgradeRunSkipped`, and `markSelfUpgradeRunStarted`.
- [x] **TDD debt:** `apps/web/lib/self-upgrade/notification.test.ts` — covers `notificationMessage()` per event type, severity mapping (only `"failed"` → `"warning"`), and notification write failure logging.
- [x] **Completion retry cap (see Status section).** `completeSelfUpgradeRun` now records attempts in `completionEvidence` and marks the run failed after 4 completion failures.
- [x] **Imports-at-bottom cleanup in `completion.ts`** (see Status section).

### Task 4: Queue and Operations UI

**Files (canonical, post-implementation):**
- Created: `apps/web/lib/self-upgrade/index.ts`
- Created: `apps/web/lib/self-upgrade/index.test.ts`
- Created: `apps/web/lib/queue/functions/portal-self-upgrade.ts` (was `self-upgrade.ts` in original plan)
- Modified: `apps/web/lib/queue/functions/index.ts`
- Modified: `apps/web/lib/queue/inngest-client.ts`
- Created: `apps/web/lib/actions/self-upgrade.ts` (NEW server-action surface — original plan said to modify `promotions.ts`; implementation correctly chose a separate file to keep capability gates and revalidation paths distinct)
- Created: `apps/web/components/ops/SelfUpgradePanel.tsx` (was `SelfUpgradeClient.tsx` in original plan)
- Modified: `apps/web/components/ops/OpsTabNav.tsx`
- Created: `apps/web/app/(shell)/ops/self-upgrade/page.tsx`

- [x] Add `portal/self-upgrade.requested` event handling + daily scheduled cycle — landed as two Inngest functions in `portal-self-upgrade.ts` (`portal/self-upgrade-scheduled`, `portal/self-upgrade-requested`).
- [x] Add separate `portal/self-upgrade-completion-sweep` Inngest function on `*/15 * * * *` cron to reconcile `completing` runs (NOT in original plan but architecturally required — see Status).
- [x] Add `requestPortalSelfUpgradeAction` and `getSelfUpgradeDashboardAction` server actions in `apps/web/lib/actions/self-upgrade.ts` — landed.
- [x] Capability gates: `view_operations` for dashboard read, `manage_provider_connections` for trigger — landed (see Status for the rationale on `manage_provider_connections`).
- [x] Add a small Operations tab showing current version, target version, recent runs, and a manual trigger — landed as `SelfUpgradePanel.tsx` rendered from `apps/web/app/(shell)/ops/self-upgrade/page.tsx`.
- [x] **TDD debt:** `apps/web/lib/queue/functions/portal-self-upgrade.test.ts` — asserts all three functions are registered and that `PORTAL_SELF_UPGRADE_EVENT === "portal/self-upgrade.requested"` plus the cron constants.
- [ ] **TDD debt:** `apps/web/lib/actions/self-upgrade.test.ts` — three-case capability gate (unauth, view-only, full), error wording for unauthorized, `revalidatePath("/ops/self-upgrade")` is called on success.
- [ ] **TDD debt:** `apps/web/components/ops/SelfUpgradePanel.test.tsx` — renders current/target versions, recent runs table, disabled state when `config.enabled === false`, error banner when `versionError` is set, manual-trigger button visibility per capability.

### Verification

#### Structural (landed in `8c129eb7`)

- [x] `pnpm install --frozen-lockfile`
- [x] Focused Vitest suites for self-upgrade (`config`, `version`, `promoter`, `completion`, `index`).
- [x] `pnpm --filter web typecheck`
- [x] `pnpm --filter @dpf/db typecheck`
- [x] `pnpm --filter @dpf/db exec prisma validate`
- [x] `pnpm --filter web exec next build`
- [x] Docker-served portal rebuild from clean worktree and health at configured `APP_URL` / `AUTH_URL` plus `http://localhost:3000`.

#### Functional drive (REQUIRED before this slice closes — `structural-verification-is-not-functional`)

Structural test passes do not prove the upgrade works. The following live drive against the Docker-served portal must happen on a host where `/host-source` is mounted from a clean checkout that has commits on `origin/main` beyond `/app/.dpf-image-version`:

- [ ] Log in as an operator with `view_operations` + `manage_provider_connections`. Open `/ops/self-upgrade`.
- [ ] Confirm the dashboard renders: current SHA, target SHA, "behind by N commits" or equivalent state, and an empty (or pre-existing) runs table.
- [ ] Verify that `getUpgradeVersionState` does NOT throw on the operator-visible path; if a Windows-Git-worktree mount is in play, the `toOperatorVersionError` translator should kick in with the documented hint instead of a raw stack.
- [ ] Trigger a manual upgrade. Assert:
  - [ ] A new `SelfUpgradeRun` row appears with `status = queued`, then `running`, then `completing`, then `succeeded`. (Watch via `psql` or by refreshing the dashboard.)
  - [ ] A `dpf-promoter-self-upgrade-<runId>` container starts, runs to completion, and is removed (`--rm`).
  - [ ] `/app/.dpf-image-version` inside the new portal container reports the target SHA.
  - [ ] `/api/health` responds 200 on both `localhost:3000` and the configured `APP_URL`.
  - [ ] At least one `PlatformNotification` row exists with `category = "self-upgrade"` describing the start and completion.
- [ ] Confirm completion sweep behavior: create a ship-phase FeatureBuild whose `buildBranch` resolves to a SHA that IS an ancestor of the new production SHA. Wait one `*/15 * * * *` cron tick (or trigger the sweep manually). Assert the build moves to `phase = "complete"` with `acceptanceMet.productionSha` set.
- [ ] Confirm rollback behavior: deliberately break the new build (e.g., inject a failing healthcheck), trigger upgrade, assert the run reaches `rolled_back` and the old portal container is restored.
- [ ] Capture screenshots and logs into `output/playwright/` or the active backlog item's evidence.

A live drive that cannot complete (e.g., dev hardware lacks docker-in-docker permissions) must be recorded as a known limitation against `BI-CAPSULE-SELFUPGRADE-001` — not silently skipped.
