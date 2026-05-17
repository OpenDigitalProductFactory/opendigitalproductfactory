# Plan — Postgres Backup, Slice 2: Restore Wizard

> Spec: `docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md` §4.6, §6 Slice 2
> Slice 1 PR (merged): #715
> Substrate already in place from Slice 1:
> - `BackupRun` model with `storagePath`, `sizeBytes`, `sha256`, `pgVersion`, `prunedAt`
> - `BackupRestore` model with `sourceBackupRunId`, `preRestoreBackupRunId`, `status`,
>   `initiatedByUserId`, `errorMessage` (created in Slice 1 migration so Slice 2 doesn't
>   touch ordering)
> - Host-bound `/backups` mount on portal
> - GFS retention pruner (which Slice 2 extends to cover pre-restore safety dumps)
> - `/admin/backups` page with history table and existing per-row "View log" action
>
> Goal: ship the typed-confirmation restore wizard so an operator can recover the
> install from any retained BackupRun without touching shell — closing the loop
> on the never-ask-user-to-run-commands commandment for the catastrophic-loss
> case Slice 1 captured.

## Pre-Implementation Gate (binding before Task 1)

1. Spec is APPROVED. Slice 2 lands per spec §4.6 + §6 Slice 2 without further
   architectural review.
2. Branch: `feat/backup-restore-wizard` (created off `origin/main` at
   `c643cf11`).
3. PR target: `main` via `gh pr create`. DCO `-s` on every commit.
4. **Zero CLI surfacing in the operator path.** The whole point of this slice
   is to make recovery a click-only operation. Anything the operator must see
   in shell form is a spec violation; lint the diff for it before pushing.

## Reality Check (binding context for implementers)

- The portal already mounts `/var/run/docker.sock` and `docker exec`s into
  `dpf-postgres-1`. Slice 1 proved the pattern with `pg_dump`; Slice 2 mirrors
  it with `pg_restore`.
- `pg_restore --clean --if-exists` drops and recreates schema objects in
  place — no DB drop/recreate needed. The portal stays up; Prisma queries that
  are mid-flight during the restore window will fail with normal connection
  errors and recover when the restore finishes.
- The `BackupRestore` table already exists (Slice 1 migration). Slice 2 only
  writes to it; no migration in this slice.
- The portal-side lock is process-local — a single Next.js server. That's
  enough: there is one portal container per install (single-org-per-install
  per memory `project_single_org_per_install.md`), so cross-instance locking
  is not a concern.
- The Slice 1 retention pruner walks the `BackupRun` table by `target =
  "postgres"`. Pre-restore safety dumps must be written as `BackupRun` rows
  with a distinguishing tag so they're (a) visible in history and (b) subject
  to the same GFS retention. Use `trigger = "pre-restore-safety"` so the
  existing retention code keeps them per GFS without code changes.

## Scope Check

**In scope (Slice 2).**

1. `scripts/restore-postgres.sh` — POSIX shell, exec'd inside the portal
   container; takes a dump path, runs `pg_restore --clean --if-exists` against
   the running `dpf-postgres-1`.
2. `apps/web/lib/operate/backups/postgres-restore-runner.ts` — TS
   orchestrator: acquires portal-side lock, writes pre-restore safety dump
   (reuses the Slice 1 runner), invokes the shell script, records
   `BackupRestore` row, releases lock.
3. Server actions: `previewRestore(runId)`, `confirmRestore(runId, typedConfirmation)`,
   `listRestoreRuns({ limit })`. Admin-gated like the Slice 1 actions.
4. UI: restore-confirmation modal that opens from the existing per-row
   "Restore…" button (Slice 1's history table already renders a `[Restore…]`
   placeholder per spec §4.8; Slice 2 makes it functional). Modal shows
   impact preview + typed-`RESTORE` input + "Cancel / Restore" buttons.
5. Restore history section under the existing readiness card, showing recent
   restores with status + impact (how much pre-restore data they replaced).
6. Prometheus metrics: `dpf_postgres_restore_runs_total{status}` counter and
   `dpf_postgres_restore_duration_seconds` histogram.
7. Tests: lock semantics (mutex behavior), safety-dump invariant (always
   written before restore touches DB), confirmation gate (wrong text rejects),
   admin-gated server actions.

**Out of scope (deferred to Phase 5 per spec §4.6).**

- Partial / table-level restore.
- Restore from a dump that didn't originate in this install.
- Off-host backup pull-and-restore flow.
- Encryption-at-rest for the host bind directory.

## Files And Responsibilities

### New

- `scripts/restore-postgres.sh` *(new)* — POSIX shell. Takes `$DUMP_PATH`,
  exec's `pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"`
  via `docker exec`, streams stdout/stderr to `log.txt` next to the dump.
- `apps/web/lib/operate/backups/postgres-restore-runner.ts` *(new)* — orchestrator:
  - Module-scoped `restoreLockHeld: boolean` for portal-side mutex (no
    concurrent restores).
  - `runPostgresRestore({ sourceBackupRunId, userId })`:
    1. Acquire lock or throw `RestoreLockedError`.
    2. Resolve source `BackupRun`, verify file exists + sha256 matches.
    3. Trigger a pre-restore safety dump via the Slice 1 runner with a
       distinguishing trigger label (`pre-restore-safety`).
    4. Insert `BackupRestore` row with `status: "running"`,
       `sourceBackupRunId`, `preRestoreBackupRunId`.
    5. Spawn the restore script.
    6. On success: mark `BackupRestore.status = "ok"`, finishedAt. Emit
       Prometheus counter. **No Prisma hot-reload yet** — Prisma client
       handles dropped/recreated tables transparently because connections
       reconnect on next query. Future enhancement: `prisma.$disconnect()`
       then warm-up query.
    7. On failure: mark `status: "failed"`, errorMessage. Surface to the
       admin UX so the operator sees the failure with the safety dump still
       intact.
    8. Release lock in `finally`.
- `apps/web/lib/operate/backups/restore-types.ts` *(new)* — shared shape:
  `RestoreImpactPreview`, `RestoreRunListItem`.
- `apps/web/lib/operate/backups/restore-preview.ts` *(new)* — pure function
  + Prisma reads to compute "you will lose all changes since X" — diffs the
  source `BackupRun.finishedAt` against `Now()` and returns a structured
  impact preview (timestamp, size, ageMinutes, "estimated rollback window").
- `apps/web/lib/actions/backup-restore.ts` *(new)* — server actions:
  `previewRestore`, `confirmRestore`, `listRestoreRuns`. Same auth gate as
  Slice 1 (`manage_provider_connections`).
- `apps/web/app/(shell)/admin/backups/RestoreConfirmModal.tsx` *(new)* —
  client modal: impact preview + typed `RESTORE` input + Cancel/Confirm.
- `apps/web/app/(shell)/admin/backups/RestoreHistorySection.tsx` *(new)* —
  client section appended below the existing history table.

### Modified

- `apps/web/app/(shell)/admin/backups/BackupsClient.tsx` — wire `[Restore…]`
  button to open the new modal; render the new history section.
- `apps/web/lib/operate/backups/postgres-backup-runner.ts` — add an optional
  `trigger: "pre-restore-safety"` path (drop-in: just a label). Existing
  retention treats it the same as any other successful run.
- `apps/web/lib/operate/metrics.ts` — restore counter + histogram.

### Untouched

- No Prisma schema change (the `BackupRestore` model already exists from
  Slice 1).
- No `docker-compose.yml` change.
- No Inngest function — restore is synchronous, lock-bound, and operator-
  initiated only; not a background job.

## Chunk 1 — Restore runner

1. Author `scripts/restore-postgres.sh`. POSIX-portable shell. Same
   `docker exec` pattern as `backup-postgres.sh`. Streams the dump into
   `docker exec -i dpf-postgres-1 pg_restore --clean --if-exists -U dpf -d dpf`.
   Exit non-zero on failure with a single `[restore-trace] failed: <reason>`
   line for the orchestrator to surface.
2. Smoke-test on the running install AGAINST A TEST DB FIRST (the agent
   creates a temporary DB, restores the most-recent dump into it, drops it).
   The script is parameterized for `$POSTGRES_DB` so this is one env-var
   change. The user never sees a command.
3. Once smoke green, ready for orchestrator wiring.

**Exit criteria.** Restore script runs against a throwaway DB and emerges
with the same table count as the source.

## Chunk 2 — TS orchestrator + lock

1. Author `postgres-restore-runner.ts` with the module-scoped mutex.
2. Reuse the Slice 1 `runPostgresBackup({ trigger: "pre-restore-safety" })`
   to write the safety dump. Verify retention math treats `"pre-restore-safety"`
   the same as `"manual"` (already does because retention only inspects
   `status === "ok"` + `prunedAt`).
3. Compute sha256 of the source dump file before running `pg_restore`;
   abort if the file's actual hash doesn't match the stored `BackupRun.sha256`.
   This is the integrity check spec §4.4 promised.
4. Author `restore-preview.ts` for the impact computation.

**Exit criteria.** Calling `runPostgresRestore` end-to-end against a test
run: lock acquired, safety dump written, source restored, BackupRestore row
inserted with both refs populated.

## Chunk 3 — Server actions

1. Author `apps/web/lib/actions/backup-restore.ts` with admin gate.
2. `previewRestore(runId)` reads `BackupRun`, computes the impact preview.
3. `confirmRestore(runId, typedConfirmation)` requires
   `typedConfirmation === "RESTORE"` (case-sensitive). Anything else throws
   `Error("Confirmation text required")` with a 4xx posture (no shell
   surfacing in the message).
4. `listRestoreRuns({ limit })` returns recent `BackupRestore` rows for the
   history section.
5. Unit-test the auth gate + the confirmation-required check.

**Exit criteria.** `confirmRestore("BR-x", "RESTORE")` succeeds against a
test row; `confirmRestore("BR-x", "restore")` fails with the right error.

## Chunk 4 — UI: restore wizard

1. Build `RestoreConfirmModal.tsx`. Receives `runId` and the impact-preview
   payload. Renders:
   - **Impact summary card**: source timestamp, size, age, "this will
     replace ALL platform data created since `<finishedAt>`. Estimated data
     loss: `<lastBackup-now diff>` of activity."
   - **Pre-restore safety dump notice**: "We'll write a safety dump first
     so this is reversible."
   - **Typed confirmation**: text input requiring the literal `RESTORE`,
     case-sensitive. Confirm button disabled until valid.
   - **Cancel / Confirm buttons.** Confirm calls `confirmRestore`, then
     polls `listBackupRuns` + `listRestoreRuns` to refresh the page.
2. Build `RestoreHistorySection.tsx` for the history table directly below
   the existing backup history (status pill, source backup ts, safety
   backup id, duration, errorMessage when present).
3. Wire from `BackupsClient.tsx`:
   - Replace the Slice-1 placeholder `[Restore…]` button with a real
     `onClick` that calls `previewRestore(runId)` then opens the modal.
   - Render `<RestoreHistorySection runs={restoreRuns} />` below the
     existing history.

**Exit criteria.** Manual click path works in the running install:
operator clicks Restore, sees impact, types `RESTORE`, clicks Confirm,
sees the new history row appear.

## Chunk 5 — Tests + telemetry

1. Unit tests for the orchestrator's mutex (concurrent calls throw
   `RestoreLockedError`).
2. Unit test for sha256 mismatch path (corrupted dump throws before
   `pg_restore` runs).
3. Server-action auth-gate tests.
4. Architecture test: `confirmRestore` MUST NOT accept anything other than
   the literal `RESTORE`. Defense against regression.
5. Prometheus metrics emit on success + failure.

**Exit criteria.** `pnpm --filter web exec vitest run lib/operate/backups
lib/actions/backup-restore` — all green. `pnpm --filter web typecheck`
clean. Pre-commit hook green.

## Chunk 6 — Live verification + PR

1. Rebuild the portal image (already merged Slice 1 image, so this just
   layers Slice 2 source).
2. Restart portal.
3. **Self-test the wizard end-to-end** (the agent does this, not the
   operator). Sequence:
   - Take a fresh manual backup via the existing button.
   - Insert a sentinel row in the live DB (`INSERT INTO "BackupRun"
     (id, status, trigger, "storagePath") VALUES ('sentinel-pre-restore',
     'ok', 'sentinel', 'test')`).
   - Navigate (via Chrome MCP) to `/admin/backups`, click Restore on the
     newest dump, type `RESTORE`, confirm.
   - Verify post-restore: the sentinel row is GONE (because the dump
     pre-dates it), but the pre-restore safety dump is now in the history
     and the new `BackupRestore` row is `ok`.
   - Confirm the heartbeat row, scheduled cron, and Slice 1 readiness card
     are all still consistent.
4. Open PR.

**Exit criteria.** Live install successfully restored a dump end-to-end
via the wizard. PR opened with the verification log in the body.

## Open Questions Carried Forward

- **Prisma hot-reload after restore.** Slice 2 relies on Prisma client
  transparently reconnecting on next query. If we observe stale schema
  cache issues, the follow-up is to call `prisma.$disconnect()` after the
  restore + a warm-up query. Tracked as a follow-up; current spec §4.6
  doesn't require it.
- **Cross-version restore guard.** Source dump may have a different
  Prisma migration set than the current schema. Slice 2 logs the
  `pgVersion` + `dpfVersion` from the source manifest and surfaces a
  warning ("source dump was taken from DPF version X; current is Y"), but
  does NOT block. Operators recovering from a wipe will sometimes need to
  restore an older dump; gating the wizard on version match would defeat
  the use case.

## Recommended Execution Path

1. Chunk 1 → commit `feat(backup): postgres restore shell runner`.
2. Chunk 2 → commit `feat(backup): restore orchestrator + portal-side lock + sha256 integrity check`.
3. Chunk 3 → commit `feat(backup): restore server actions with typed-confirmation gate`.
4. Chunk 4 → commit `feat(backup): admin restore wizard UI + history section`.
5. Chunk 5 → commit `test(backup): restore lock, integrity, confirmation tests`.
6. Chunk 6 → live-verify + open PR `feat(backup): Slice 2 — restore wizard with typed confirmation + pre-restore safety dump`.

## What Slice 2 Deliberately Leaves Out

- Partial / table-level restore (spec Phase 5).
- Restore from off-host / S3 dumps (spec Phase 3).
- Restore to a different DB / different install (out of single-org-per-install
  scope).
- Automated post-restore validation suite (smoke queries; future enhancement).
- Encryption-at-rest for the host bind directory.
