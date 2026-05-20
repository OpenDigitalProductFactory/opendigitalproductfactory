# Portal Self-Upgrade Local Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:test-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the local implementation slice for `BI-CAPSULE-SELFUPGRADE-001`: detect when the Docker-served portal is behind `origin/main`, run a governed self-upgrade through the existing promoter surface, record durable run evidence, and complete merged Build Studio ship-phase records only after the running SHA is confirmed.

**Architecture:** Add a small `apps/web/lib/self-upgrade/*` module boundary around config validation, version checks, run persistence, promoter dispatch, completion reconciliation, and notifications. Extend `scripts/promote.sh` with `--self-upgrade` mode so the same backup, build, swap, health, and rollback path handles normal promotions and portal self-upgrade. Expose the path through an Inngest scheduled function and a compact Operations tab.

**Tech Stack:** Next.js server actions, Inngest, Prisma, Docker Compose, POSIX shell, Vitest.

---

### Task 1: Persistence and Config

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260520030000_self_upgrade_runs/migration.sql`
- Modify: `packages/db/src/seed.ts`
- Create: `packages/db/src/self-upgrade-config.test.ts`
- Create: `apps/web/lib/self-upgrade/config.ts`
- Create: `apps/web/lib/self-upgrade/config.test.ts`

- [ ] Write failing tests for default PlatformConfig seed and config validation.
- [ ] Add `SelfUpgradeRun` with status/SHA/log fields.
- [ ] Seed `self_upgrade` PlatformConfig defaults without overwriting operator edits.
- [ ] Implement `loadSelfUpgradeConfig`.

### Task 2: Version Detection and Promoter Dispatch

**Files:**
- Create: `apps/web/lib/self-upgrade/version.ts`
- Create: `apps/web/lib/self-upgrade/version.test.ts`
- Create: `apps/web/lib/self-upgrade/promoter.ts`
- Create: `apps/web/lib/self-upgrade/promoter.test.ts`
- Modify: `scripts/promote.sh`
- Create: `apps/web/lib/self-upgrade/promote-script-contract.test.ts`

- [ ] Write failing tests for SHA comparison and promoter command construction.
- [ ] Compare `/app/.dpf-image-version` to the host checkout's `origin/main`.
- [ ] Start `dpf-promoter` with `SELF_UPGRADE=1` and a writable host-source mount.
- [ ] Extend `promote.sh --self-upgrade` to fetch, verify a clean host tree, build from host source, swap, health-check, and rollback.

### Task 3: Run Store, Completion, and Notifications

**Files:**
- Create: `apps/web/lib/self-upgrade/run-store.ts`
- Create: `apps/web/lib/self-upgrade/run-store.test.ts`
- Create: `apps/web/lib/self-upgrade/completion.ts`
- Create: `apps/web/lib/self-upgrade/completion.test.ts`
- Create: `apps/web/lib/self-upgrade/notifications.ts`
- Create: `apps/web/lib/self-upgrade/notifications.test.ts`
- Modify: `apps/web/lib/tak/agent-event-bus.ts`

- [ ] Write failing tests for idempotent run lifecycle, ancestry-based build completion, and notification events.
- [ ] Persist queued/running/succeeded/failed/rolled_back/completing runs.
- [ ] Complete only ship-phase FeatureBuilds whose branch/head SHA is an ancestor of the running production SHA.
- [ ] Emit operator-visible self-upgrade events.

### Task 4: Queue and Operations UI

**Files:**
- Create: `apps/web/lib/self-upgrade/index.ts`
- Create: `apps/web/lib/self-upgrade/index.test.ts`
- Create: `apps/web/lib/queue/functions/self-upgrade.ts`
- Create: `apps/web/lib/queue/functions/self-upgrade.test.ts`
- Modify: `apps/web/lib/queue/functions/index.ts`
- Modify: `apps/web/lib/queue/inngest-client.ts`
- Modify: `apps/web/lib/actions/promotions.ts`
- Create: `apps/web/lib/actions/promotions.self-upgrade.test.ts`
- Create: `apps/web/components/ops/SelfUpgradeClient.tsx`
- Create: `apps/web/components/ops/SelfUpgradeClient.test.tsx`
- Modify: `apps/web/components/ops/OpsTabNav.tsx`
- Create: `apps/web/app/(shell)/ops/self-upgrade/page.tsx`

- [ ] Write failing tests for scheduled/manual upgrade orchestration and UI actions.
- [ ] Add `portal/self-upgrade` scheduled and manual event handling.
- [ ] Add `triggerSelfUpgrade` server action.
- [ ] Add a small Operations tab showing current version, target version, recent runs, and a manual trigger.

### Verification

- [ ] `pnpm install --frozen-lockfile`
- [ ] Focused Vitest suites for self-upgrade, promoter, queue, ops UI, and seed config.
- [ ] `pnpm --filter web typecheck`
- [ ] `pnpm --filter @dpf/db typecheck`
- [ ] `pnpm --filter @dpf/db exec prisma validate`
- [ ] `pnpm --filter web exec next build`
- [ ] Docker-served portal rebuild from clean worktree and health at configured `APP_URL`/`AUTH_URL` plus `http://localhost:3000`.
