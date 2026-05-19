# Backup — Slice 3: Neo4j + Qdrant coverage

> Status: **APPROVED** — proposed + operator-OK 2026-05-18
> Amends: `docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md`
>   §6 Slice 3, §10 Phase 2 — closing both out.
> Owning kernel principles:
>   [`consult-specs-first`](../../founder-kernel/wiki/principles/consult-specs-first.md),
>   [`research-before-implementing`](../../founder-kernel/wiki/principles/research-before-implementing.md),
>   [`structural-verification-is-not-functional`](../../founder-kernel/wiki/principles/structural-verification-is-not-functional.md),
>   [`never-ask-user-to-run-commands`](../../founder-kernel/wiki/principles/never-ask-user-to-run-commands.md).

## 1. Goal

Extend the platform-managed backup mechanism (Slices 1 + 2 — already
shipped) to cover Neo4j and Qdrant. After this slice, **a full-volume
wipe of any combination of `dpf_pgdata`, `dpf_neo4jdata`, and
`dpf_qdrant_data` is recoverable from host-bind backups**, not just
the Postgres volume.

Acceptance is FUNCTIONAL — drive a backup of each service end-to-end
through the admin UX, observe the dump file lands on the host bind
mount, restore each into a throwaway target, verify content matches.

## 2. Why both services matter

| Service | What's lost on a volume wipe |
|---|---|
| Postgres (`dpf_pgdata`) | Operator state: backlog, providers, employees, governance ledger. **Covered by Slice 1.** |
| Neo4j (`dpf_neo4jdata`) | Wiki link graph + PPR routing data + EA model topology. Regenerable from Postgres source-of-truth, but ingestion is expensive (~minutes-to-hours on a full re-walk) |
| Qdrant (`dpf_qdrant_data`) | Vector embeddings for wiki RAG, semantic memory, brand context. Regenerable but every page must be re-embedded — measured in hours on a populated install |

Slice 1 saved the irreplaceable state; Slice 3 saves the regenerable-but-
expensive state.

## 3. Decision

### 3.1 Per-service backup mechanism

| Service | Tool | Image-bundled? | Operates on running container? |
|---|---|---|---|
| Postgres | `pg_dump -Fc` | yes (postgres:16-alpine) | yes |
| **Neo4j** | `neo4j-admin database dump` | yes (neo4j:5-community) | **no — requires stopping the DB** |
| **Qdrant** | `POST /snapshots` REST API | yes (qdrant native HTTP) | yes |

Neo4j's offline-only requirement drives the architecture:

- The Slice 3 Neo4j runner must **stop the Neo4j container**, run the
  dump command (which uses the volume directly, not via Bolt protocol),
  then **start the container again**. Total downtime: ~5–15 s for the
  full sequence on a small graph.
- Qdrant runs entirely online — REST API call, no service interruption.
- Both are scheduled to run **after** the Postgres backup completes,
  on the same cron fire. If Postgres backup fails, Neo4j + Qdrant
  backups still run (independent failure modes).

### 3.2 BackupRun.target — already supports this

The Slice 1 schema (`BackupRun.target String @default("postgres")`)
already accommodates the discriminator. No migration needed. New target
values: `"neo4j"`, `"qdrant"`. Retention math is per-target, GFS
treats each service independently.

### 3.3 Storage layout

```
<DPF_HOST_INSTALL_PATH>/backups/
├── postgres/<ISO-ts>/dpf.dump + manifest.json + sha256 + log.txt
├── neo4j/<ISO-ts>/neo4j.dump + manifest.json + sha256 + log.txt
└── qdrant/<ISO-ts>/qdrant.snapshot + manifest.json + sha256 + log.txt
```

### 3.4 Admin UX — extend the existing readiness card

The Slice 1 `/admin/backups` page becomes **three readiness sections
stacked**: Postgres / Neo4j / Qdrant. Each carries its own:
- Last run / last success / next run
- Retention summary
- Storage path
- Manual trigger button
- History table (filtered by target)
- Restore wizard (Postgres-only for now; Slice 4 = restore-from-snapshot
  for Neo4j + Qdrant).

### 3.5 Scheduling

Single Inngest function `ops/all-backups-daily-scheduled` fires once
per day at 03:00 UTC and runs all three in sequence:

```
1. runPostgresBackup({ trigger: "scheduled" })
2. runNeo4jBackup({ trigger: "scheduled" })  # stops container + dumps + restarts
3. runQdrantBackup({ trigger: "scheduled" }) # REST snapshot
```

Each is independent: a Postgres failure does not abort Neo4j;
a Neo4j failure does not abort Qdrant. Each writes its own
`BackupRun` row and updates its own `ScheduledJob` heartbeat:
`postgres-daily-backup`, `neo4j-daily-backup`, `qdrant-daily-backup`.

Manual triggers also independent — each "Run backup now" button
emits a target-scoped Inngest event.

## 4. Out of scope

- **Restore wizard for Neo4j + Qdrant.** Slice 4 — same typed-RESTORE
  confirmation UX as Postgres, per-service runner. Phase 5 in the
  Slice 1 spec.
- **Snapshot-API-based Qdrant restore.** Slice 4.
- **Off-host replication (S3, restic, Backblaze).** Phase 3 in the
  Slice 1 spec.
- **Neo4j online backup via `neo4j-admin backup`** (Enterprise-only
  feature). We use `dump` which works on Community Edition.
- **Per-collection Qdrant snapshots** instead of full-instance.
  Phase 5+.

## 5. Acceptance criteria

The slice is complete ONLY when all observed live:

1. Fresh `docker compose up` brings up all three services + the
   portal. The new `ScheduledJob` rows for `neo4j-daily-backup` and
   `qdrant-daily-backup` exist with `schedule: "daily"`.
2. Admin opens `/admin/backups` and sees three readiness sections
   (Postgres / Neo4j / Qdrant), each showing "never run yet" until
   the first cron fire or manual trigger.
3. Clicking "Run backup now" on the Neo4j section:
   - Stops the Neo4j container
   - Writes `neo4j/<ISO-ts>/neo4j.dump` to the host bind mount
   - Restarts the Neo4j container
   - Inserts a `BackupRun` row with `target: "neo4j"`, `status: "ok"`
   - Surfaces success in the history table
4. Clicking "Run backup now" on the Qdrant section:
   - Calls `POST http://qdrant:6333/snapshots`
   - Downloads the snapshot file via GET
   - Writes `qdrant/<ISO-ts>/qdrant.snapshot` to the host bind mount
   - Inserts a `BackupRun` row with `target: "qdrant"`, `status: "ok"`
5. The Neo4j dump is restorable into a freshly created Neo4j 5
   instance (verified by spinning a throwaway container, mounting
   the dump, running `neo4j-admin database load`, and listing
   databases).
6. The Qdrant snapshot is restorable via the Qdrant REST API into a
   target instance.
7. When the Neo4j container fails to restart after a dump, the runner
   surfaces a clear inline error in the readiness card AND keeps
   trying to restart in background — never leaves Neo4j stopped.
8. Routing-invariants audit + typecheck + pre-commit hook all pass.

## 6. Open questions

- **Neo4j downtime window**: 5–15 s of unavailability per scheduled
  backup. Acceptable for daily 03:00 UTC fires; revisit when adding
  PITR (Phase 4). Documented in the admin card so operator isn't
  surprised.
- **Qdrant snapshot cleanup**: Qdrant retains snapshots inside the
  container's storage until explicitly deleted. The runner deletes
  the snapshot from Qdrant's storage after downloading it to the
  host. Otherwise we'd double-store every snapshot.
- **Cross-service consistency**: Slice 3 does NOT guarantee point-in-
  time consistency across Postgres + Neo4j + Qdrant. Each is backed
  up at slightly different timestamps within a single cron fire
  (~30 s apart). For DPF's use case this is acceptable — restore is
  catastrophic-loss recovery, not transactional rollback.

## 7. Recommendation

Single PR. Implementation is tactically straightforward:
- Two new shell runners (`scripts/backup-neo4j.sh`, `scripts/backup-qdrant.sh`)
- Two new TS orchestrators following the Slice 1 pattern
- One new combined Inngest function
- Admin UX extension (three sections instead of one)
- Two new seed entries for `ScheduledJob` heartbeats
- Functional verification of each end-to-end on the live install
