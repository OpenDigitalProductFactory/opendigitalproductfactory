# Postgres Daily Backup — In-Platform Schedule + Admin UX

> Status: **PROPOSED** — drafted 2026-05-17
> Owner: platform / data-substrate
> Related kernel principles: `never-ask-user-to-run-commands`
> (`docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md`),
> `agent-as-work-conduit`, `actionable-coworker-responses`.
> Sibling worktree-hardening commit that prevents the orphan-volume-recreation
> bug: PR #709 (`fix(dev): isolate compose harness project state`).
> Trigger: the 2026-05-17T04:35:45Z `dpf_pgdata` volume wipe destroyed all
> user-created backlog data. Reconstruction took a full session of forensic
> recovery from PRs / specs / plans / worktrees because no backup existed.
> This spec closes the gap.

## 1. Problem statement

DPF's substrate today is **single-volume-survivable, not single-volume-recoverable**.

- All authoritative state lives in the `dpf_pgdata` named Docker volume
  (43 epics + 280 BacklogItems at restore time, plus DigitalProduct,
  Org, OAuth provider state, brand context, governance ledger, scheduled
  job heartbeats, ScheduledTask cron registrations, employee directory,
  Inngest queue state, etc.).
- The volume is destroyed by any of: `docker compose down -v`,
  `docker volume rm dpf_pgdata`, a worktree-induced compose project
  re-label (root cause of the 2026-05-17 wipe, fixed by PR #709), or
  manual operator action.
- The only existing backup is **the pre-promote dump the promoter writes
  before a Build Studio promotion** (`scripts/promote.sh:157`). That dump
  is:
  - **Tied to promotion events, not to time.** A user who runs the
    platform for weeks without a promotion has zero backups.
  - **Mounted at `${DPF_HOST_INSTALL_PATH}/backups/` on the host** — i.e.
    it survives a volume wipe, but **only if the promoter has run**.
  - **Not exposed to the operator.** There is no UI, no readiness
    surface, no manual trigger, no restore wizard. The recovery
    procedure is a hand-written runbook (`D:\Backups\RESTORE.md`) that
    requires shell access to run `pg_restore`.
- DPF's product thesis is **non-technical operators run real businesses
  on AI coworkers** (kernel principle `never-ask-user-to-run-commands`).
  A backup mechanism that requires the operator to know `docker exec`,
  `pg_dump`, or `pg_restore` is a thesis violation.

Resilience cost of the gap: 6+ hours of catastrophic recovery work and
~99.4% (not 100%) reconstruction accuracy from secondary sources after
the May-17 wipe. With a daily backup in place, the same wipe would have
been recovered in minutes from the previous night's dump.

## 2. Goals and non-goals

**Goals.**

1. Postgres data is backed up **on a daily schedule** by the platform,
   with no human action required after install.
2. Backups are **stored on a path that survives volume destruction**
   (host bind mount, not a Docker volume).
3. The operator has an **admin UX** to see backup readiness, last/next
   run, history with size and duration, and to trigger a manual backup
   or initiate a restore — all without ever leaving the portal.
4. Retention is **self-managed**: the platform prunes old backups on a
   GFS schedule (daily/weekly/monthly tiers) without operator
   intervention.
5. The mechanism is **rollback-able in a single revert** and produces
   an auditable run log (success, failure, duration, size, checksum).
6. **No CLI is ever surfaced to the operator.** Per the
   `never-ask-user-to-run-commands` commandment, restore is initiated
   via a typed-confirmation wizard in the UI, executed by the platform.

**Non-goals (this slice).**

1. Neo4j and Qdrant backup. They hold derived/regenerable state and
   carry less catastrophic loss cost; they are tracked as Phase 2
   under §10 Future Work.
2. Sandbox-postgres backup. Build Studio sandboxes are by-design
   ephemeral; no operator state lives there.
3. Off-host / cloud / S3 / encrypted-bucket backup. This slice ships
   host-local backup only. Cloud-replication is Phase 3.
4. Point-in-time-recovery (WAL archiving / PITR). Phase 4 — daily
   `pg_dump` covers the catastrophic-loss case this spec exists to
   prevent. Sub-day RPO is not in scope.
5. Multi-org backup partitioning. DPF is single-org per install
   (memory: `project_single_org_per_install.md`); the whole DB is one
   tenant.

## 3. Current repo grounding

| Surface | File | What it gives us |
|---|---|---|
| Existing `pg_dump` invocation | `scripts/promote.sh:157` | `docker exec <db> pg_dump -U <user> -Fc <db>` shape, proven in production by promotion flow |
| Backup directory convention | `docker-compose.yml:240` | Promoter already host-mounts `${DPF_HOST_INSTALL_PATH:-.}/backups:/backups` — reuse this path |
| Cron scheduling pattern | `apps/web/lib/queue/functions/discovery-poll.ts`, `infra-prune.ts` | Inngest `cron(...)` triggers + `prisma.scheduledJob` heartbeat + `computeNextRunAt` |
| Schedule registry | `packages/db/prisma/schema.prisma:1515` (`ScheduledJob`) | `jobId`, `name`, `schedule`, `lastRunAt`, `nextRunAt`, `lastStatus`, `lastError` — drop-in |
| Schedule helpers | `apps/web/lib/inference/ai-provider-types.ts:6,21` | `SCHEDULE_INTERVALS_MS` includes `daily`; `computeNextRunAt(schedule, from)` |
| Admin tab nav family | `apps/web/components/admin/admin-nav.ts:54` (`advanced`) | Add Backups under Advanced family alongside Diagnostics / Issue Reports |
| Function registration | `apps/web/lib/queue/functions/index.ts` | Single place to register the new cron function |
| Postgres client in container | `Dockerfile.promoter:4` (`postgresql16-client`) | We need the same `pg_dump`/`pg_restore` available wherever the runner executes |

What does **not** exist yet:

- `scripts/backup-postgres.sh` (or equivalent runner)
- Any Prisma model for backup history (we'll add one — `BackupRun`)
- Any admin route under `/admin/backups`
- Any server actions for trigger/list/inspect/restore
- Any retention policy or pruner

## 4. Decision

**Architecture in one sentence:** an Inngest cron function fires once a
day, asks the portal container to shell out to `pg_dump -Fc` against the
`postgres` service, writes the dump file + manifest to a host-bound
`/backups/` directory, records a `BackupRun` row, and prunes per a
GFS retention policy; the admin UX exposes status, history, manual
trigger, and a strongly-confirmed restore wizard.

### 4.1 Where the work runs

| Option | Pros | Cons | Decision |
|---|---|---|---|
| **(A) Portal container shells out via `docker exec`** | No new container; reuses promoter pattern; portal already has `/var/run/docker.sock` mounted | Couples backup runner to Docker socket | **Chosen** — promoter already proves this pattern; isolation isn't worth the cost for daily ops housekeeping |
| (B) Separate `dpf-backup` one-shot container | Stronger isolation | New image, new lifecycle, new failure mode | Deferred — no current need |
| (C) Postgres-side `pg_basebackup` cron inside the postgres container | Native | Couples backup logic to the database image; harder to evolve | Rejected |

The portal already exec's into containers for sandbox lifecycle
operations (`apps/web/lib/integrate/sandbox/*`); this is consistent.

### 4.2 Scheduler

**Inngest cron**, identical pattern to `infra-prune.ts`. One function:
`ops/postgres-daily-backup`, trigger `0 3 * * *` (03:00 local install
timezone) with `retries: 2` and `concurrency: { limit: 1 }`. The
`ScheduledJob` row (`jobId: "postgres-daily-backup"`) is the heartbeat
record the admin UI reads for "last run / next run / last status".

We don't use the existing generic `ScheduledTask` cron substrate
because that's user-facing scheduled work (HRIS sync, hive scout
ingest) — backups are platform plumbing, not user workflows.

### 4.3 Storage layout

```
<DPF_HOST_INSTALL_PATH>/backups/
├── postgres/
│   ├── 2026-05-17T03-00-00Z/
│   │   ├── dpf.dump            # pg_dump -Fc output, ~tens-of-MB compressed
│   │   ├── manifest.json       # { runId, startedAt, finishedAt, sizeBytes,
│   │   │                       #   sha256, pgVersion, dpfVersion, schedule,
│   │   │                       #   trigger: "scheduled"|"manual", durationMs }
│   │   └── log.txt             # stdout/stderr from pg_dump
│   └── 2026-05-16T03-00-00Z/...
└── pre-promote/                # legacy promoter dumps continue here unchanged
    └── pre-promote-<buildId>-*.dump
```

Daily backups live under `postgres/<ISO-ts>/`; the existing promoter
output stays under `pre-promote/` so we don't disturb that flow.

Host bind mount (added to `docker-compose.yml`):

```yaml
portal:
  volumes:
    - ${DPF_HOST_INSTALL_PATH:-.}/backups:/backups
```

The path is the same one the promoter already mounts; the portal gets
read+write access. **Critical**: it's a host bind mount, not a Docker
volume — so `docker volume rm`, project re-labeling, or `down -v`
cannot destroy backups.

### 4.4 Dump format

`pg_dump -Fc` (PostgreSQL custom format).

- Compressed by default (zlib level 6).
- Supports selective restore (`pg_restore --table=`, `--schema=`,
  `--list`) which we'll need for the Phase B "restore the backlog
  only" use case Mark explicitly called out 2026-05-17.
- Already proven by `scripts/promote.sh:157`.

We also write a sidecar `manifest.json` and a `sha256` checksum file
so the UI can verify integrity without re-reading the whole dump.

### 4.5 Retention (self-managed)

**GFS (Grandfather-Father-Son) — fully automatic.** Defaults configurable
in `PlatformConfig`:

- Keep **last 7 daily** backups (rolling window).
- Keep **last 4 weekly** backups (Sundays).
- Keep **last 12 monthly** backups (first of each month).

Pruner runs at the **end of each successful backup**, so retention
state is self-healing. Failed runs do not prune.

Worst-case footprint: 7 + 4 + 12 = 23 retained dumps. At ~50 MB
compressed (current DPF DB scale) → ~1.2 GB. Well within reasonable
disk budget; documented and surfaced in the admin card.

### 4.6 Restore — strongly gated, never automatic

Restore is **never** triggered by the scheduler, by background jobs,
or by any agent. It is initiated **only** by an explicit operator
click in the admin UI, followed by a typed-confirmation step.

Restore wizard flow:

1. Operator opens **Admin → Advanced → Backups → [select a run] →
   Restore from this backup**.
2. UI shows an **impact preview**: dump timestamp, dump size, table
   count, "you will lose all changes since `<lastRunAt>`".
3. Operator types the literal string `RESTORE` to confirm.
4. UI calls a `restoreBackupRun` server action which:
   - Acquires a portal-side lock (no concurrent restores).
   - Writes a **pre-restore safety dump** to `backups/pre-restore/<ts>/`.
   - Calls `pg_restore --clean --if-exists` against the `postgres`
     service.
   - Records a `BackupRestore` row.
   - Hot-reloads Prisma state.
5. The pre-restore safety dump is itself retained per GFS so a
   misclick is recoverable.

**Out-of-scope for restore**: partial / table-level restore. Phase 5
work — current scope is whole-DB.

### 4.7 Data model addition

```prisma
model BackupRun {
  id            String   @id @default(cuid())
  startedAt     DateTime @default(now())
  finishedAt    DateTime?
  status        String   // "running" | "ok" | "failed"
  trigger       String   // "scheduled" | "manual"
  schedule      String?  // "daily" when scheduled
  sizeBytes     BigInt?
  durationMs    Int?
  sha256        String?
  pgVersion     String?
  dpfVersion    String?
  storagePath   String   // absolute path inside /backups/ on host bind
  errorMessage  String?
  prunedAt      DateTime?  // set when retention removed this run's files
  createdAt     DateTime @default(now())

  @@index([startedAt])
  @@index([status])
}

model BackupRestore {
  id                String   @id @default(cuid())
  startedAt         DateTime @default(now())
  finishedAt        DateTime?
  status            String   // "running" | "ok" | "failed"
  initiatedByUserId String?
  sourceBackupRunId String
  preRestoreBackupRunId String?  // safety dump
  errorMessage      String?
  createdAt         DateTime @default(now())

  @@index([startedAt])
}
```

`ScheduledJob` row `jobId: "postgres-daily-backup"` is the heartbeat;
`BackupRun` rows are the audit log.

### 4.8 Admin UX surface

**Location**: `/admin/backups`, registered in `admin-nav.ts` under the
`advanced` family.

**Page layout**:

```
─ Backups ──────────────────────────────────────────────────────────
 [ Readiness card ]                                  [ Run backup now ]
   ✓ Daily backup scheduled at 03:00 (DPF timezone)
   ✓ Last run: 2026-05-17T03:00 UTC — OK — 47 MB — 8.3s
   ✓ Next run: 2026-05-18T03:00 UTC
   ✓ Retention: 7 daily / 4 weekly / 12 monthly (23 dumps, 1.1 GB)
   ✓ Storage path: <DPF_HOST_INSTALL_PATH>/backups/postgres/
   ✗ <red banner only if> Last 3 runs failed: <reason>

 [ History table ]
   Timestamp                Status    Trigger    Size      Duration   Actions
   2026-05-17T03:00Z        ✓ ok      scheduled  47.2 MB   8.3s       [Restore…] [View log]
   2026-05-16T03:00Z        ✓ ok      scheduled  47.0 MB   8.1s       [Restore…] [View log]
   2026-05-15T14:22Z        ✓ ok      manual     46.8 MB   7.9s       [Restore…] [View log]
   …
   [pruned rows shown faded with "pruned 2026-05-10"]
```

**Manual trigger**: button calls `triggerBackupNow()` server action →
emits Inngest event `ops/postgres-backup.requested` → same function
handles both scheduled and event-driven invocations.

**Restore wizard**: modal with impact preview + typed-`RESTORE`
confirmation. No raw SQL, no shell, no command anywhere in the
operator's view.

**View log**: opens a side drawer showing `manifest.json` +
truncated `log.txt`. Read-only.

### 4.9 No-CLI-for-the-user proof

Per the commandment principle
(`docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md`),
this design contains **zero** copy-paste shell. Specifically:

| Operator intent | What they do | What the platform does for them |
|---|---|---|
| Verify backup ran today | Open `/admin/backups` | Readiness card shows last run, status, size, duration |
| Force a fresh backup | Click "Run backup now" | Platform triggers Inngest event, runs `pg_dump`, refreshes UI |
| Restore from a backup | Click `[Restore…]` → type `RESTORE` | Platform writes safety dump, runs `pg_restore`, hot-reloads, refreshes UI |
| Investigate a failed backup | Click `[View log]` | Drawer renders stored stdout/stderr |
| Adjust retention | Edit Platform Config slider | Pruner re-runs on next backup |

Operator never sees `docker exec`, `pg_dump`, `pg_restore`, file paths
to copy, or SQL.

## 5. Research and benchmarking

Backup design for managed Postgres is well-trodden territory. The
choices DPF makes here align with the consensus best practices and
deviate only where DPF's substrate (single-org per install, all-state-in-Postgres,
operator-is-non-technical) makes a different trade-off correct.

### 5.1 `pg_dump -Fc` vs alternatives

| Approach | RPO | RTO | Op complexity | Choice |
|---|---|---|---|---|
| **`pg_dump -Fc` daily** | 24h | minutes (selective restore supported) | **lowest** — single binary, no extra config | **Chosen** for v1 |
| `pg_basebackup` + WAL archiving (PITR) | seconds | minutes | high — WAL retention, archive_command, recovery.conf | Phase 4 (see §10) |
| Logical replication to a standby | seconds | seconds | very high — replica lifecycle | Out of scope (one-org-per-install) |
| Filesystem snapshots (ZFS / LVM) | minutes | seconds | requires non-portable host filesystem | Out of scope |

The Postgres docs' own recommendation
(<https://www.postgresql.org/docs/16/backup-dump.html>) explicitly calls
out `pg_dump` as the right tool for small-to-medium DBs with daily-grain
RPO requirements. DPF fits that bracket comfortably — even at 10×
current scale we're well under the 100 GB threshold where dump time
starts to bite.

### 5.2 Schedule library

`infraPrune` and `discoveryPoll` already use Inngest `cron(...)`
triggers. No new dependency. The DPF install ships Inngest as a first-class
service (see `docker-compose.yml` `inngest:` block) — using anything
else would be inconsistent with `feedback_consult_specs_first.md`.

### 5.3 Storage path

Host bind mount under `${DPF_BACKUPS_HOST_PATH}` (a sibling directory of
the install root, e.g. `$DPF_DIR-backups\`) means a single tree the
operator can back up off-host later (Phase 3) by pointing
restic/rclone/Backblaze at one directory. Living OUTSIDE the install
root is load-bearing: `dpf-reinstall.ps1` and `uninstall-dpf.ps1` can
`Remove-Item $DPF_DIR -Recurse` without ever touching the backup tree.

> **Hazard resolved (addendum 2026-05-23 → 2026-05-24, BI-8004BCD8).**
> First-pass defense-in-depth (PR #1040, 2026-05-23): both Windows
> scripts moved `$DPF_DIR\backups\` to a sibling `$DPF_DIR-backups\`
> before the rm, and `install-dpf.ps1` folded them back in.
> Architectural fix (2026-05-24): introduced `DPF_BACKUPS_HOST_PATH`
> env var; installer defaults it to the sibling directory; compose
> bind-mount source reads from it; `scripts/backup-neo4j.sh` /
> `scripts/restore-neo4j.sh` use it for host-path translation in
> docker-in-docker bind mounts, with a fallback to
> `${DPF_HOST_INSTALL_PATH}/backups` for pre-relocation installs.
> The reinstall/uninstall preserve dance is retained as belt-and-
> suspenders for operators upgrading from a pre-relocation install
> (where backups are still in-tree) and becomes a no-op once the
> migration runs.

### 5.4 Retention policy (GFS)

7/4/12 GFS is the default in nearly every backup tool that defaults at
all (restic snapshot policies, BorgBackup, Veeam, pg_basebackup
tutorials). Defaults configurable via Platform Config so an operator
on a small VPS can drop monthlies.

## 6. Implementation slices

### Slice 1 — Scheduled daily Postgres backup with admin readiness UX

In scope for the first PR (this spec's plan):

- `BackupRun` and `BackupRestore` Prisma models + migration + seed (idempotent — `ScheduledJob` row created if missing).
- `scripts/backup-postgres.sh` — pure shell entrypoint that the runner exec's. Takes a target directory, writes `dpf.dump` + `manifest.json` + `log.txt` + `dpf.dump.sha256`.
- `apps/web/lib/operate/backups/postgres-backup-runner.ts` — TypeScript orchestrator: shells the script via `docker exec dpf-postgres-1`, then records `BackupRun`, then prunes.
- `apps/web/lib/operate/backups/retention.ts` — GFS pruner.
- `apps/web/lib/queue/functions/postgres-daily-backup.ts` — Inngest function (cron + event), registered in `functions/index.ts`.
- Server actions: `triggerBackupNow()`, `listBackupRuns({ limit })`, `getBackupRun(id)`, `getBackupReadiness()`.
- Admin page: `/admin/backups` with readiness card + history table + "Run backup now" button + per-row "View log" drawer.
- Nav: register Backups under Admin → Advanced.
- Docker compose: add `${DPF_HOST_INSTALL_PATH:-.}/backups:/backups` mount to the `portal` service.
- Tests: unit (retention math, manifest emission), integration (server actions hit a stub backup directory).
- Telemetry: log every run as `[backup-trace]` and emit a Prometheus metric `dpf_postgres_backup_last_success_seconds`.

### Slice 2 — Restore wizard

- Restore server action with safety-dump + locking.
- Restore UI with typed-`RESTORE` confirmation.
- `BackupRestore` history surface.
- Hot Prisma reload after restore.

### Slice 3 — Neo4j + Qdrant coverage

- Per-service runners (`backup-neo4j.sh` using `neo4j-admin database
  dump`; `backup-qdrant.sh` using qdrant snapshot API).
- Unified `BackupRun.targets` array and per-target status.

### Slice 4 — Off-host replication

- Pluggable destination (`local`, `s3`, `restic`).
- Encryption-at-rest for off-host destinations.
- Verification job that fetches a daily dump back from off-host and runs `pg_restore --list` against it.

### Slice 5 — Point-in-time recovery (PITR)

- WAL archiving via `archive_command`.
- Restore-to-point-in-time UI.

## 7. Integration contracts

- Inngest event: `ops/postgres-backup.requested { trigger: "manual" | "scheduled", initiatedByUserId?: string }`.
- ScheduledJob heartbeat: `jobId = "postgres-daily-backup"`, written on every run start (status `running`) and update (status `ok`/`failed`).
- BackupRun.storagePath is **relative to the host bind mount** (`/backups/postgres/<iso-ts>`), not absolute — so restoring on a different host path still works.

## 8. Telemetry and evidence

- `[backup-trace]` log lines at start / finish / failure (matches `[tool-trace]` convention from `project_tool_trace_logging.md`).
- Prometheus gauge `dpf_postgres_backup_last_success_seconds` (epoch seconds of last successful backup). Alert if `time() - dpf_postgres_backup_last_success_seconds > 36*3600` (i.e. >36 h since last success).
- Prometheus counter `dpf_postgres_backup_runs_total{status}`.
- Prometheus gauge `dpf_postgres_backup_storage_bytes`.

## 9. Open questions

1. **Encryption-at-rest for the host bind mount.** Defer to Phase 4; for v1, document that backups inherit the security posture of the host filesystem.
2. **Cross-platform shell.** `backup-postgres.sh` is bash. The portal container is `node:24-alpine` (already has busybox `sh`); we'll write to POSIX-portable shell, not bash-specific. Promoter already does this — same constraint.
3. **Pre-promote dumps under the new model.** Should `scripts/promote.sh` be migrated to write `BackupRun` rows so all dumps are visible in the admin UX? Defer to follow-up; v1 just keeps `pre-promote/` co-located, admin UX shows them in a separate section labeled "Pre-promotion safety dumps (legacy path)".

## 10. Future work

- **Phase 2**: Neo4j + Qdrant.
- **Phase 3**: Off-host replication (S3 / restic / Backblaze).
- **Phase 4**: WAL archiving / PITR.
- **Phase 5**: Partial / table-level restore.
- **Phase 6**: Cross-install backup federation (one customer's installs back each other up via the hive mind).

## 11. Acceptance criteria (Slice 1)

1. Fresh install — first daily backup writes `<DPF_HOST_INSTALL_PATH>/backups/postgres/<ISO-ts>/dpf.dump` within 30 s of cron fire, with a `manifest.json` and matching `sha256`.
2. `/admin/backups` shows readiness card with last run, next run, retention summary; loads <1 s.
3. "Run backup now" button creates a fresh backup, refreshes the table.
4. Killing the `postgres` container mid-run causes the function to fail, write a `BackupRun` row with `status: "failed"`, and surface the failure in the readiness card.
5. After 8 daily runs, exactly 7 daily dumps remain (oldest pruned).
6. Reverting the PR + running the migration revert leaves no dangling tables, services, or schedule rows.
7. Zero command-line surfacing in the operator's path. The only operator gestures are clicks and typed confirmation.

## 12. Recommendation

Approve and proceed to plan + Slice 1 implementation. The cost of
**not** having this mechanism was demonstrated 6 hours ago — the only
reason DPF recovered from the May-17 wipe was that PRs and specs
happened to preserve enough breadcrumbs to reconstruct ~99.4% of the
backlog. The next wipe might land between two recoverable substrates
(e.g. governance ledger, OAuth provider state, employee directory) and
there will be no breadcrumbs.

Slice 1 is small, self-contained, and reverts cleanly. Slices 2–5 can
be sequenced based on operator demand without changing the data model
introduced here.
