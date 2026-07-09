# Managed Backup/Restore Substrate — spec-driven runner dedup

- **Date:** 2026-07-09
- **BI:** BI-B72328D5 (EP-8DC217EB BET-11, "build-it-once" consolidation plan §4)
- **Scope:** `apps/web/lib/operate/backups/` — the six TypeScript runners only.
  The workflow half (Inngest functions, cron primitives, scheduled-jobs
  catalog) is **explicitly excluded** — see "Excluded workflow half" below.

## What / why

The three backup runners (`postgres-backup-runner.ts`, `neo4j-backup-runner.ts`,
`qdrant-backup-runner.ts`) and three restore runners each carried byte-identical
(or engine-token-swapped) copies of the same lifecycle:

- local `isoTsForDirectory`, `nextDailyRunAt`, `applyRetention`,
  `summarizeFailure` helpers (3× each),
- three copy-pasted `prisma.scheduledJob.update(...).catch(() => {})`
  heartbeat blocks per backup runner (start / success / failure),
- four per-engine Prometheus emits,
- the restore mutex + integrity + safety-dump + audit flow, duplicated with
  small wording drifts.

Adding engine #4 (or fixing a lifecycle bug) meant editing six files. This
slice collapses the lifecycle into **one shared engine per direction** driven
by **per-engine specs**:

| File | Role |
| --- | --- |
| `engine-specs.ts` | `BackupEngineSpec` / `RestoreEngineSpec` types + `POSTGRES/NEO4J/QDRANT_BACKUP_SPEC` + `*_RESTORE_SPEC`. Every real per-engine difference is data or a tiny hook here. |
| `managed-backup.ts` | `runManagedBackup(spec, args)` + canonical `isoTsForDirectory`, `nextDailyRunAt`, `applyRetention`, `summarizeScriptFailure`, and the single `recordJobHeartbeat` writer. |
| `managed-restore.ts` | `runManagedRestore(spec, args)` + canonical home of `acquireRestoreLock`, `isRestoreInFlight`, `RestoreLockedError`, `RestoreIntegrityError` (moved from `postgres-restore-runner.ts`, re-exported there for backward compatibility). |
| 6 runner files | Thin wrappers keeping their historical exports (`runPostgresBackup`, `runNeo4jRestore`, …) so the Inngest layer, server actions, MCP tools and self-upgrade rollback are untouched. |

## The spec type

`BackupEngineSpec` carries: `target` (existing `BackupTarget`), `jobId` +
`schedule` (from `constants.ts`), `subdir`, `scriptName`, `timeoutMs`,
`traceTag`, the failure-marker grammar (`failureMarker` / `failureStrip` /
`failureFallback`), lazy getters onto the **existing** metric objects, a
`buildEnv` hook (full script env), and an optional `successRowExtras` hook
(Postgres writes `pgVersion` from its manifest; the others do not).

`RestoreEngineSpec` adds `artifactFileName` (`dpf.dump` / `neo4j.dump` /
`qdrant.snapshot`), the per-engine operator-facing `messages` (wordings
preserved **verbatim**, including drift like "its file is no longer on disk"
vs "file is gone"), a default `takeSafetyBackup` (dynamic import of the
engine's backup wrapper, so `vi.mock` interception keeps working), optional
restore metrics (Postgres only — the others never emitted any), and the
Postgres-only `capturePreRestoreState` / `reinsertAuditRows` hook pair for
the pg_restore audit-row re-insert dance.

## Exact-behavior preservation

- **No Prometheus metric renames.** All 12 `dpf_*_backup_*` families and the
  `dpf_postgres_restore_*` pair still live in `apps/web/lib/operate/metrics.ts`
  under their original names; specs only hold references (as getters, so
  tests that partially mock the metrics module still load).
- Trace-tag strings (`[backup-trace]`, `[backup-trace][neo4j]`,
  `[restore-trace][qdrant]`, …), error fallbacks, integrity wordings,
  manifest handling, heartbeat payload shapes, retention semantics and the
  Postgres target-check omission are preserved exactly. The runner-level unit
  tests (`managed-backup.test.ts`, `managed-restore.test.ts`) pin them per
  engine; all pre-existing tests pass unmodified.
- Structural constraint honored: `backups-host-path-relocation.test.ts` pins
  the `DPF_BACKUPS_HOST_PATH` forwarding contract to the two neo4j runner
  files, so their env builders (`buildNeo4jBackupScriptEnv`,
  `buildNeo4jRestoreScriptEnv`) are defined **in the wrapper files** as
  hoisted function declarations and referenced by the specs (safe in every
  module-load order).
- Two stragglers were migrated onto the canonical helpers so the ratchet
  needs no allowlist: `postgres-trial-restore-runner.ts` (3 heartbeat blocks
  → `recordJobHeartbeat`) and `lib/actions/backups.ts` (local
  `nextDailyRunAt` → import).

## Ratchet

`scripts/check-no-local-backup-helper.mjs` (+ `.test.mjs` self-test, node:test)
is auto-discovered by the Repo Guard Loop CI job. Three rules, **empty
allowlist** (the migration completed in this PR):

1. **helper-definition** — a new local definition of `isoTsForDirectory` /
   `nextDailyRunAt` / `applyRetention` / `summarizeFailure` /
   `summarizeScriptFailure` / `recordJobHeartbeat` anywhere in `apps/web/lib`
   outside the two canonical files.
2. **inline-heartbeat** — a `scheduledJob.update(` call (including the
   multi-line idiom) inside `apps/web/lib/operate/backups/` outside the
   canonical files. Heartbeats for other jobs elsewhere in the tree are that
   substrate's business, not this ratchet's.
3. **stray-metric** — a `name: "dpf_*_backup_*"` / `dpf_*_restore_*`
   Prometheus registration outside `apps/web/lib/operate/metrics.ts`.

The self-test proves both directions: the matchers flag synthetic copies and
the live tree scans clean.

## Excluded workflow half (build-it-once)

BET-11's other half — collapsing the per-engine Inngest functions and cron
wiring (`apps/web/lib/queue/functions/**`, scheduled-jobs catalog) — is
deliberately **not** in this slice. Per the cross-epic build-it-once rule
(docs/superpowers/plans/2026-07-08-cross-epic-coordination-vertint-vs-insideout.md),
that layer waits for the Claude-Inside-Out workflow primitive
(BI-8E07CCA5 / BI-D80D16C4) so DPF grows ONE reusable scheduled-workflow
substrate instead of a backup-only mini-framework. The specs introduced here
are the intended input to that primitive: a fourth engine should be a spec
entry + one workflow registration, nothing more.
