# Plan — Postgres Daily Backup, Slice 1

> Spec: `docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md`
> Goal of this slice: ship the scheduled-daily-Postgres-backup pipeline +
> manual trigger + admin readiness UX (history table, log drawer).
> Restore wizard, Neo4j/Qdrant coverage, off-host replication, and PITR
> are explicit follow-up slices in the spec (§6 Slices 2–5).

## Pre-Implementation Gate (binding before Task 1)

1. Spec is APPROVED. Until then the plan is committed but no
   implementation tasks fire.
2. Branch name: `feat/postgres-backup-mechanism` (already created off
   `origin/main` at HEAD `2576da75`).
3. PR target: `main` via `gh pr create`. DCO `-s` on every commit
   (memory: `feedback_dco_signoff_required.md`).
4. **No CLI surfacing to the operator anywhere in the diff.** Verify
   by grepping the final diff for shell snippets directed at the user
   in MD / TSX. Permitted: internal `child_process.spawn` calls, shell
   scripts the platform itself executes.

## Reality Check (binding context for implementers)

- The promoter container already runs `docker exec dpf-postgres-1
  pg_dump -U dpf -Fc dpf` and writes the result to a host-bound
  `/backups` directory (`scripts/promote.sh:157`,
  `docker-compose.yml:240`). Re-use this proven pattern, do not invent
  a new one.
- The portal container already mounts `/var/run/docker.sock` and
  routinely shells out via `docker exec` for sandbox lifecycle ops
  (`apps/web/lib/integrate/sandbox/*`). Same pattern applies.
- `ScheduledJob` model is the existing heartbeat substrate (see
  `infra-prune.ts` for the canonical pattern: cron, run, upsert
  heartbeat with `computeNextRunAt`).
- The `name: ${COMPOSE_PROJECT_NAME:-dpf}` top-level setting in
  `docker-compose.yml` (PR #709) means we can rely on container names
  being `dpf-postgres-1` and `dpf-portal-1` in the standard install.
  Worktree-based dev installs override `COMPOSE_PROJECT_NAME` and get
  their own isolated stack — backups happen there independently, which
  is the desired behavior.
- Postgres image is `postgres:16-alpine`; `pg_dump`/`pg_restore` are
  available inside the postgres container — we exec into it.
- Inngest functions are registered in `apps/web/lib/queue/functions/index.ts`.
- Admin pages use `AdminTabNav` driven by `admin-nav.ts`; the
  `advanced` family is the right home for Backups (alongside
  Diagnostics, Issue Reports).

## Scope Check

In: scheduled daily backup, manual trigger, history table, view-log
drawer, retention pruner, BackupRun/BackupRestore data model, admin
nav entry, telemetry, tests.

Out (deferred to Slices 2–5):

- Restore wizard (Slice 2)
- Neo4j + Qdrant coverage (Slice 3)
- Off-host replication (Slice 4)
- PITR (Slice 5)
- Migrating promoter pre-promote dumps into BackupRun rows

## Files And Responsibilities

### Schema + migration

- `packages/db/prisma/schema.prisma` — add `BackupRun` and `BackupRestore` models per spec §4.7.
- `packages/db/prisma/migrations/<ts>_postgres_backup/migration.sql` — generated.
- `packages/db/src/seed-platform-backup.ts` *(new)* — idempotent: upsert `ScheduledJob` row `jobId: "postgres-daily-backup"`. Schedule `"daily"`. Wired into the seed orchestrator.
- `packages/db/src/seed.ts` (or equivalent orchestrator) — call the new seed.

### Backup runner

- `scripts/backup-postgres.sh` *(new)* — POSIX shell:
  1. Take `$TARGET_DIR` arg; create it.
  2. `docker exec` the postgres container (variable: container name from `DPF_PRODUCTION_DB_CONTAINER`, default `dpf-postgres-1`).
  3. `pg_dump -U "$POSTGRES_USER" -Fc -d "$POSTGRES_DB"` redirect to `$TARGET_DIR/dpf.dump`.
  4. `sha256sum dpf.dump > dpf.dump.sha256`.
  5. Emit `manifest.json` with start/end/size/checksum/pgVersion.
  6. Append stdout/stderr to `log.txt`.
  Exit non-zero on failure with structured stderr line `[backup-trace] failed: <reason>`.
- `apps/web/lib/operate/backups/postgres-backup-runner.ts` *(new)* — TS orchestrator:
  - Compute target directory (`/backups/postgres/<ISO-ts>/`).
  - `child_process.spawn` the shell script.
  - On success: insert `BackupRun` row with `status: "ok"`, store manifest fields.
  - On failure: insert `BackupRun` row with `status: "failed"`, errorMessage.
  - Call retention pruner.
  - Update `ScheduledJob` heartbeat.
  - Emit `[backup-trace]` log lines and Prometheus metric updates.
- `apps/web/lib/operate/backups/retention.ts` *(new)* — pure function `computeRetained(runs: BackupRun[], policy: { daily, weekly, monthly }): { keep: BackupRun[]; prune: BackupRun[] }`. GFS algorithm:
  - Daily bucket = last N successful daily-trigger runs.
  - Weekly bucket = most recent successful run per ISO week, last M weeks.
  - Monthly bucket = most recent successful run per calendar month, last P months.
  - Union = keep set; complement = prune set.
- `apps/web/lib/operate/backups/readiness.ts` *(new)* — `getBackupReadiness()` returns `{ schedule, nextRunAt, lastRun: BackupRun | null, lastSuccess: BackupRun | null, retention, storagePath, retainedCount, retainedBytes, failuresInLastThreeRuns: number }`.

### Inngest function

- `apps/web/lib/queue/functions/postgres-daily-backup.ts` *(new)* — `cron("0 3 * * *")` trigger AND `event("ops/postgres-backup.requested")` trigger; `concurrency: { limit: 1, scope: "fn" }`; calls runner.
- `apps/web/lib/queue/functions/index.ts` — register.

### Server actions

- `apps/web/lib/actions/backups.ts` *(new)* — `triggerBackupNow()`, `listBackupRuns({ limit })`, `getBackupRun(id)`, `getBackupReadiness()`, `readBackupLog(id)`. Auth-gated to admin role only.

### Admin UX

- `apps/web/app/(shell)/admin/backups/page.tsx` *(new)* — readiness card + history table + "Run backup now" button + per-row log drawer trigger.
- `apps/web/app/(shell)/admin/backups/BackupHistoryTable.tsx` *(new)* — client component, sortable table with row actions.
- `apps/web/app/(shell)/admin/backups/BackupLogDrawer.tsx` *(new)* — side drawer for `manifest.json` + `log.txt`.
- `apps/web/components/admin/admin-nav.ts` — add `{ label: "Backups", href: "/admin/backups" }` to the `advanced` family and to the `matchPrefixes` array.

### Compose + env

- `docker-compose.yml` — add `- ${DPF_HOST_INSTALL_PATH:-.}/backups:/backups` to the `portal` service's volumes block. (The promoter already mounts the same path; this just gives the portal r/w access.)
- `.env.docker.example` — document `DPF_BACKUP_PATH` is **derived from** `DPF_HOST_INSTALL_PATH/backups` and does not need a separate env var; mention the daily-backup mechanism uses this path.

### Tests

- `apps/web/lib/operate/backups/retention.test.ts` — unit tests for GFS math: 30 daily runs reduce to 7+4+12 = 23 (or fewer if collisions); 0 successful runs prune nothing; failed runs never count toward retention; today's run is always kept.
- `apps/web/lib/operate/backups/postgres-backup-runner.test.ts` — integration with mocked `spawn`; verifies `BackupRun` row on success/failure paths, heartbeat updated.
- `apps/web/lib/queue/functions/postgres-daily-backup.test.ts` — Inngest function shape (matches discovery-poll test conventions).
- `apps/web/lib/actions/backups.test.ts` — server-action auth gates.

### Telemetry

- `apps/web/lib/operate/backups/metrics.ts` *(new)* — emit:
  - `dpf_postgres_backup_last_success_seconds` (gauge)
  - `dpf_postgres_backup_runs_total{status}` (counter)
  - `dpf_postgres_backup_storage_bytes` (gauge, sum of retained run sizes)
  - `dpf_postgres_backup_duration_seconds` (histogram)
- `monitoring/prometheus/alerts.yml` — alert: `BackupOverdue` if `time() - dpf_postgres_backup_last_success_seconds > 36*3600`.

## Chunk 1 — Schema + Seed

1. Add `BackupRun`, `BackupRestore` to `schema.prisma`.
2. `pnpm --filter @dpf/db exec prisma migrate dev --name postgres_backup`.
3. Add `seed-platform-backup.ts` upserting the `ScheduledJob` row.
4. Wire it into the seed orchestrator (find the equivalent of
   `seed-discovery-triage.ts`/`seed-hive-scout.ts` registration).
5. Verify on a fresh install: row present with `schedule: "daily"`,
   `nextRunAt` ~24 h out.

**Exit criteria.** `pnpm --filter @dpf/db build` clean; `prisma
generate` clean; seed runs idempotently twice without errors.

## Chunk 2 — Runner + Script

1. Author `scripts/backup-postgres.sh` (POSIX shell). Test it
   standalone first against the live `dpf-postgres-1` container by
   the runner (NOT by the operator — per the kernel commandment, the
   agent runs verification, the operator never sees the command).
2. Author `postgres-backup-runner.ts`. Use `child_process.spawn` with
   an absolute path. Pipe stdout/stderr into the structured logger.
3. Author `retention.ts` with the GFS pruner.
4. Author `readiness.ts`.
5. Author `metrics.ts`.
6. Unit-test retention math.

**Exit criteria.** Runner can be invoked manually from a test
harness; produces a valid dump + manifest + sha256; row inserted;
heartbeat updated; old dumps pruned.

## Chunk 3 — Inngest Wiring

1. Author `postgres-daily-backup.ts` with both cron and event
   triggers.
2. Register in `functions/index.ts`.
3. Verify via the Inngest dev UI (the agent verifies, not the
   operator) that the function is registered at the expected cron
   schedule.

**Exit criteria.** A manually emitted `ops/postgres-backup.requested`
event produces a BackupRun row visible in the DB.

## Chunk 4 — Admin Surface

1. Author server actions in `apps/web/lib/actions/backups.ts`.
2. Author `admin/backups/page.tsx` + history table + log drawer.
3. Update `admin-nav.ts`.
4. Verify the admin nav shows "Backups" under Advanced; the page
   renders the readiness card and history table; the "Run backup
   now" button triggers a fresh backup that appears in the table
   after refresh.
5. Verify failure path: stop the postgres container, click "Run
   backup now", confirm the readiness card surfaces the failure with
   a non-actionable reason (no shell to copy).

**Exit criteria.** End-to-end click-only operator path works. Zero
CLI surfacing in any operator-visible string.

## Chunk 5 — Compose + Bind Mount

1. Add the `/backups` bind mount to the `portal` service in
   `docker-compose.yml`.
2. Document in `.env.docker.example` next to `DPF_HOST_INSTALL_PATH`
   that the daily backup path is derived from it.
3. Rebuild the portal image. Verify the mount appears inside the
   container at `/backups` and is writable.

**Exit criteria.** Portal container can write to `/backups/`; host
sees the file.

## Chunk 6 — Tests + Telemetry

1. All unit and integration tests pass.
2. `pnpm --filter @dpf/web typecheck` clean.
3. `pnpm --filter @dpf/web test` clean.
4. Pre-commit hooks pass (no `--no-verify`).
5. Prometheus scrape shows the new metrics.
6. Alert rule lints (`promtool check rules` — the agent runs this,
   not the operator).

**Exit criteria.** CI green. Backup metrics visible in Prometheus.

## Open Questions Carried Forward (do not block Slice 1)

- Should we expose retention as a Platform Config slider in Slice 1
  or wait for operator demand? Defaulting to 7/4/12 hardcoded is
  fine for Slice 1; surface as config when an operator asks.
- Should pre-promote dumps from the promoter be back-filled into
  `BackupRun` rows? Spec §9 defers.
- Should we add a "verify dump" job that runs `pg_restore --list`
  against the latest dump nightly? Tracked as Slice 4 enhancement
  but cheap enough that it might fit into Slice 1 if disk I/O
  permits — decide after profiling first runs.

## Recommended Execution Path

1. Chunk 1 → commit `recovery(platform): postgres backup schema + seed`.
2. Chunk 2 + Chunk 3 → commit `feat(platform): postgres daily backup runner + inngest cron`.
3. Chunk 4 → commit `feat(platform): admin backups UX (readiness + history + manual trigger)`.
4. Chunk 5 → commit `chore(compose): bind-mount /backups into portal`.
5. Chunk 6 → commit `test(platform): postgres backup retention + runner coverage`.
6. Open PR `feat(platform): daily Postgres backup mechanism + admin UX`.
7. After merge, monitor the first scheduled fire at 03:00 the next
   morning; agent verifies, no operator action required.

## What Slice 1 Deliberately Leaves Out

- Restore wizard (Slice 2 — gated on Slice 1 merge + first scheduled
  run observed working).
- Neo4j + Qdrant.
- S3 / off-host replication.
- PITR.
- Backup-of-backups verification job.
- Encryption-at-rest for the host bind directory.
