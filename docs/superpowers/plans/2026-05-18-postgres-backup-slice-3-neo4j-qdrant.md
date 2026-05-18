# Plan — Backup Slice 3: Neo4j + Qdrant coverage

> Spec: `docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md`
> Branch: `feat/backup-slice-3-neo4j-qdrant` (off `origin/main`)

## Files

### New scripts

- `scripts/backup-neo4j.sh` — POSIX shell. Stops `dpf-neo4j-1`, runs
  `neo4j-admin database dump` writing into `/backups/neo4j/<ISO-ts>/`,
  restarts the container. Emits manifest + sha256 + log mirror of
  Slice 1's pattern.
- `scripts/backup-qdrant.sh` — POSIX shell. Hits Qdrant `POST
  /snapshots` to create a snapshot, downloads it via GET, deletes
  it from Qdrant's internal storage. Writes the same manifest +
  sha256 + log shape.

### New TS orchestrators

- `apps/web/lib/operate/backups/neo4j-backup-runner.ts` — mirrors
  Slice 1's `postgres-backup-runner.ts`. Acquires a per-target lock,
  spawns the shell script, records `BackupRun` row with
  `target: "neo4j"`, updates `ScheduledJob` heartbeat for `neo4j-daily-backup`,
  applies GFS retention scoped to `target: "neo4j"`.
- `apps/web/lib/operate/backups/qdrant-backup-runner.ts` — same shape,
  `target: "qdrant"`, heartbeat `qdrant-daily-backup`.

### Modified

- `apps/web/lib/queue/functions/postgres-daily-backup.ts` — rename
  internally + extend to run all three services on the daily cron
  fire. The two existing event triggers stay (manual Postgres trigger).
  Add two more events: `ops/neo4j-backup.requested`,
  `ops/qdrant-backup.requested`.
- `apps/web/lib/operate/backups/constants.ts` — add the two new
  `*_BACKUP_JOB_ID` and event-name constants.
- `apps/web/lib/operate/backups/types.ts` — extend `BackupTarget`
  type to include `"neo4j"` and `"qdrant"`.
- `apps/web/lib/operate/backups/retention.ts` — already target-aware
  via `BackupRun.target`; verify pruning correctly partitions by
  target.
- `apps/web/lib/operate/backups/readiness.ts` — return three
  `ReadinessSummary` blocks (one per target) instead of one.
- `apps/web/lib/actions/backups.ts` — extend server actions to accept
  a `target` parameter; add `triggerNeo4jBackupNowAction`,
  `triggerQdrantBackupNowAction`.
- `apps/web/app/(shell)/admin/backups/page.tsx` + `BackupsClient.tsx`
  — render three readiness sections stacked, each with its own
  history table.
- `packages/db/src/seed-platform-backup.ts` — add two more
  `ScheduledJob` upserts for `neo4j-daily-backup`,
  `qdrant-daily-backup`.
- `apps/web/lib/operate/metrics.ts` — add Neo4j + Qdrant counterparts
  to the postgres backup metrics.

### No schema migration

`BackupRun.target` already exists with `@default("postgres")`. New
values (`"neo4j"`, `"qdrant"`) are accepted as-is. No migration.

## Chunk 1 — Shell runners

1. Author `scripts/backup-neo4j.sh`:
   - Stop `${DPF_NEO4J_CONTAINER:-dpf-neo4j-1}` via `docker stop`
     with a 30 s grace period
   - Run `docker run --rm -v dpf_neo4jdata:/data -v <host-target>:/dump
     neo4j:5-community neo4j-admin database dump --to-path=/dump neo4j`
     (the dump command can run against a stopped database via the
     volume mount; this is the standard offline-dump pattern)
   - Start the original container via `docker start`
   - Verify it returns to healthy before claiming success
   - Emit manifest + sha256 + log
2. Author `scripts/backup-qdrant.sh`:
   - `curl -X POST http://qdrant:6333/snapshots` to create snapshot
   - Parse the `result.name` from the response JSON
   - `curl -o /backups/qdrant/.../qdrant.snapshot http://qdrant:6333/snapshots/<name>`
   - `curl -X DELETE http://qdrant:6333/snapshots/<name>` to clean up
   - Emit manifest + sha256 + log
3. Smoke-test each against the live install.

**Exit:** Both scripts produce restorable artifacts on the host bind
mount with the expected manifest shape.

## Chunk 2 — TS orchestrators

1. Author the two runner files mirroring the Slice 1 pattern.
2. The orchestrators must:
   - Use a separate per-target lock (don't share Postgres's lock)
   - Insert `BackupRun` row in `status: "running"` BEFORE the shell
     runs (so a failure surfaces in admin UX even if the script
     hangs)
   - Update the row on completion / failure
   - Update the `ScheduledJob` heartbeat
   - Emit Prometheus metrics
3. Verify retention works per-target — a Neo4j backup should not
   prune Postgres backups.

**Exit:** Calling either runner end-to-end produces a `BackupRun`
row and a file on disk; the admin readiness card sees the run.

## Chunk 3 — Combined Inngest function

1. Replace the single `postgresDailyBackupScheduled` cron with a
   combined `allBackupsDailyScheduled` that runs all three in
   sequence.
2. Keep the existing event-driven `postgresBackupRequested` for
   backwards compat; add `neo4jBackupRequested` +
   `qdrantBackupRequested`.
3. Register the new functions in `apps/web/lib/queue/functions/index.ts`.

**Exit:** Inngest dashboard shows the new functions; firing the new
events triggers the appropriate runner.

## Chunk 4 — Admin UX

1. Refactor `BackupsClient.tsx` to render three sections by mapping
   over `[{ target: "postgres", ... }, { target: "neo4j", ... }, ...]`.
2. Add Neo4j-specific warning copy: "Manual trigger restarts the Neo4j
   container — expect ~10 s of unavailability."
3. The "Run backup now" button per section emits the appropriate
   event.
4. History table filters by target.
5. Restore wizard stays Postgres-only for this slice (deferred to
   Slice 4).

**Exit:** Operator opens `/admin/backups`, sees three sections, can
manually trigger each.

## Chunk 5 — Seed + heartbeats

1. Extend `seed-platform-backup.ts` to upsert all three
   `ScheduledJob` rows.
2. Verify on a fresh seed that all three appear with
   `schedule: "daily"`.

**Exit:** `pnpm --filter @dpf/db run seed` includes all three
ScheduledJob upserts; the routing-invariants audit still passes.

## Chunk 6 — FUNCTIONAL verification (per structural ≠ functional)

This is THE GATE. Not "tests pass" — actual end-to-end runs on the
live install with observable host-disk artifacts.

1. Seed test data into Neo4j (a few labeled nodes) so the dump has
   non-empty content
2. Seed a Qdrant collection with a few vectors so the snapshot has
   non-empty content
3. Manually trigger Neo4j backup via admin UX:
   - Observe `BackupRun` row appears with `target: "neo4j"`,
     `status: "running"`, then `status: "ok"`
   - Verify `${DPF_HOST_INSTALL_PATH}/backups/neo4j/<ISO-ts>/neo4j.dump`
     exists, non-zero size, sha256 matches manifest
   - Verify Neo4j container restarted to healthy
   - Restore the dump into a throwaway container, verify the labeled
     nodes are present
4. Manually trigger Qdrant backup:
   - Observe `BackupRun` row appears with `target: "qdrant"`
   - Verify `qdrant/<ISO-ts>/qdrant.snapshot` on host disk
   - Restore via Qdrant API into a target collection, verify the
     vectors are present
5. Capture the verification log in the PR description.

**Exit:** PR has a runnable verification log. Acceptance criteria 1–8
from the spec all observed.

## Chunk 7 — Open PR

Single PR. Verification log in the body. CI must pass before merge.

## What this slice deliberately leaves out

- Restore wizard for Neo4j + Qdrant (Slice 4)
- Off-host replication (Phase 3 in original spec)
- Per-collection Qdrant snapshots
- PITR / WAL archiving (Phase 4)
- Cross-service consistency (out of scope; restore is catastrophic-loss
  recovery, not transactional rollback)
