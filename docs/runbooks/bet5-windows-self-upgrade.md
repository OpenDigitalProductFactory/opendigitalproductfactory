# Runbook — BET-5 self-upgrade on a pre-BET-5 install (Windows / any host)

**Audience:** an agent (or operator) driving the BET-5 datastore migration on an install whose
portal + promoter predate the BET-5 self-upgrade fixes. **Verified end-to-end on the Mac install
2026-07-14** before this runbook was written.

## What BET-5 does

Retires **Neo4j + Qdrant**, moving the platform to **Postgres only** — pgvector (`vector_embedding`)
for vectors and a `graph_node`/`graph_edge` mirror for the graph. It ships as a self-upgrade: the
portal's boot copies the legacy data into Postgres, then a gated teardown removes the old containers
and volumes. No data is lost.

## Why this box needs a one-time bootstrap

The self-upgrade is orchestrated by the **currently-running portal**, which spawns a sibling
`dpf-promoter` container that runs the baked `scripts/promote.sh`. On an install that predates BET-5:

- The running portal predates the "always rebuild the promoter" fix (PR #2974), so it will **reuse
  the old `dpf-promoter` image** instead of rebuilding it — meaning it runs the **old** `promote.sh`,
  which lacks the BET-5 fixes and will fail (it strands Postgres — see below).
- So you must **rebuild the promoter from current `main` once, by hand**, before triggering. After
  that, everything runs unattended.

The four fixes that make BET-5 fleet-safe (all merged to `main`):

| PR | Fix |
|----|-----|
| #2969 | `promote.sh` step 3a recreates Postgres onto the pgvector image before migrate |
| #2974 | portal always rebuilds the promoter before a swap + P3009 self-heal |
| **#2978** | `ensure-pgvector` recreate is image-agnostic + host-bind-safe (does NOT strand Postgres) |
| **#2981** | boot backfill force-exits so the portal can start serving (does NOT wedge boot) |

If this box runs the upgrade **without** the manual promoter rebuild, expect the same two failures we
hit on the Mac: (1) `dpf-postgres-1` left in `Created` state (DB offline) because the old
`ensure-pgvector` resolved a host bind to an unshareable `/host-source` path; and/or (2) the portal
wedged at `[bet5-backfill] done.` never serving, because the old boot backfill never exits. Both are
already fixed in `main` — the rebuild is what delivers those fixes to this box.

## Preconditions — capture current state first

Run these and record the output before doing anything:

```powershell
# postgres image: alpine => ensure-pgvector will RECREATE it onto pgvector this run;
#                  pgvector/pgvector:pg16 => ensure-pgvector will SKIP the recreate.
docker inspect dpf-postgres-1 --format "{{.Config.Image}}"

# what's still present (expect neo4j + qdrant on a pre-BET-5 box)
docker ps --format "{{.Names}}"

# current portal build (the sha it's serving)
curl -s http://localhost:3000/api/health/sha
```

## Step 1 — bootstrap the promoter from current `main`

In the DPF install repo on this box:

```powershell
git fetch origin main
git checkout main
git pull

# Rebuild the promoter so it carries the fixed promote.sh (build context = repo root)
docker build -f Dockerfile.promoter -t dpf-promoter .

# Confirm the fixes are baked (all three should print a non-zero count / 0 for the old path)
docker run --rm --entrypoint sh dpf-promoter -c "grep -c pg_available_extensions /promoter/promote.sh"     # >= 1
docker run --rm --entrypoint sh dpf-promoter -c "grep -c _recreate_pg_onto_pgvector /promoter/promote.sh"  # >= 3
docker run --rm --entrypoint sh dpf-promoter -c "grep -c /usr/local/share/postgresql/extension/vector.control /promoter/promote.sh"  # == 0
```

If any check is wrong, the checkout is not on current `main` — re-run the `git` steps.

## Step 2 — trigger the upgrade

Use the portal's **"Upgrade now"** button (Ops → Self-Upgrade). This is the clean path: the portal
action pre-creates the `SelfUpgradeRun` record and fires the event. **Do NOT** fire a raw Inngest
event with a fresh runId — it fails with "update on nonexistent run" because the record doesn't exist.

<details>
<summary>Fallback: programmatic trigger (only if the portal button is unavailable)</summary>

Pre-create the run row, then fire the event (adjust the psql user/db and the Inngest event key to
this install's env — locally the key is `INNGEST_EVENT_KEY`):

```powershell
docker exec dpf-postgres-1 psql -U dpf -d dpf -tAc "INSERT INTO \"SelfUpgradeRun\" (\"id\",\"runId\",\"status\",\"trigger\",\"createdAt\",\"updatedAt\") VALUES (gen_random_uuid()::text, 'SUR-WINVERIFY1', 'queued', 'manual:runbook', now(), now());"
# then POST {"name":"ops/self-upgrade.run","data":{"runId":"SUR-WINVERIFY1","triggeredBy":"manual:runbook"}} to http://localhost:8288/e/<INNGEST_EVENT_KEY>
```
</details>

## Step 3 — monitor the chain

The promoter container is `dpf-promoter-<RUNID>`. Follow its step markers:

```powershell
docker logs -f dpf-promoter-<RUNID>   # or: docker logs dpf-promoter-<RUNID> | Select-String "step="
```

Expected order (each `step=<name>`):
`prepare → backup → docker-build → ensure-pgvector → migrate → docker-up → seed → health →
sha-verify → content-verify → sandbox-refresh → (decommission) → cleanup → done`.

Key checkpoints:
- **`ensure-pgvector`** — if postgres was alpine, you'll see `step=ensure-pgvector-recreate` and the
  image flips to `pgvector/pgvector:pg16` (container stays **Up**, NOT `Created`). If it was already
  pgvector, the recreate is skipped. Either way postgres must stay **running**.
- **`migrate`** — applies `20260714110000_bet5_pgvector_foundation` + `20260714120000_bet5_graph_mirror`;
  `CREATE EXTENSION vector` succeeds. (A prior failed attempt is auto-healed via P3009 resolve.)
- Portal boot logs (`docker logs dpf-portal-1`) show `[bet5-backfill] ... done.` with counts, then the
  server starts (`✓ Ready`). With #2981 the backfill exits cleanly — **no manual intervention needed.**
- **decommission** — Neo4j + Qdrant containers **and** volumes are removed.

## Step 4 — verify Postgres-only (done criteria)

```powershell
docker ps -a --format "{{.Names}}" | Select-String -Pattern "neo4j|qdrant"   # expect NOTHING
docker volume ls --format "{{.Name}}" | Select-String -Pattern "neo4j|qdrant" # expect NOTHING
docker inspect dpf-postgres-1 --format "{{.Config.Image}}"                     # pgvector/pgvector:pg16
docker exec dpf-postgres-1 psql -U dpf -d dpf -tAc "select extversion from pg_extension where extname='vector';"  # 0.8.x
docker exec dpf-postgres-1 psql -U dpf -d dpf -tAc "select count(*) from graph_node;"        # > 0
docker exec dpf-postgres-1 psql -U dpf -d dpf -tAc "select count(*) from vector_embedding;"  # > 0 if there were vectors
curl -s http://localhost:3000/api/health   # 200; the sha should now differ from the pre-upgrade value
```

The self-upgrade swap **recreates the portal container**, which drops any open browser tab and clears
your session. After it completes, hard-refresh the portal and sign in again — this is expected, not a
fault.

## If it fails anyway (recovery)

These should not occur once the promoter is rebuilt from current `main`, but for reference:

- **Postgres stuck in `Created` / DB offline** (old `ensure-pgvector` bug): the container already has
  the right image + the intact named volume. Recreate it from the **real host** compose so the bind
  paths resolve —
  `docker rm dpf-postgres-1` then
  `docker compose -p dpf -f docker-compose.yml -f <host overlays> up -d --no-deps --no-build postgres`
  from the install root. Data is preserved (named `*_pgdata` volume untouched). Then re-trigger.
- **Portal wedged at `[bet5-backfill] done.`, never serving** (old boot-hang bug): the backfill work
  is already done; unblock boot with
  `docker exec dpf-portal-1 pkill -f bet5-decommission-backfill` — the boot script then proceeds to
  `exec node server.js` and the portal comes up. Then let the promoter's health step complete.
- **P3009 (migrations blocked by a failed record)**: `promote.sh` step 3a auto-resolves the
  `bet5_pgvector_foundation` record; if you need to do it by hand,
  `docker exec ... prisma migrate resolve --rolled-back 20260714110000_bet5_pgvector_foundation`.

## Failure class: migration-unique-violation (P3018 + 23505)

A data migration's bulk UPDATE/INSERT hits `duplicate key value violates unique constraint` and the
failed record then wedges ALL later upgrades via P3009. Two known producers:

1. **Concurrent writer** minting rows into a partial unique index while the migration backfills
   (SUR-859DB221, 2026-07-16).
2. **Damaged unique index holding heap duplicates** (BI-CF4ADDAC collation damage, self-upgrade
   2026-07-29): a bulk rewrite forces non-HOT row versions, each re-inserting into the unique index,
   and `_bt_check_unique` rejects duplicates the damaged index never caught — before the repair
   migration later in the batch can converge them.

Recovery decision (inspect `_prisma_migrations`: `applied_steps_count`, and whether the migration's
columns/indexes exist in the DB):

- **Exact inventory snapshot failure** (`20260728115900_snapshot_inventory_observation_facts`):
  the promoter automatically marks the row rolled back only when it is the sole unresolved
  migration in the entire Prisma ledger, its checksum matches the committed migration bytes, its
  database row id is a valid UUID, and the log names SQLSTATE `23505` and
  `InventoryEntity_entityKey_key`, `applied_steps_count = 0`, no durable
  `_dpfObservationSnapshot` exists, and the candidate carries the exact committed `11:58`
  quarantine migration. It verifies that same row after resolution before normal deploy. Any
  mismatch fails closed before the portal swap and requires the evidence-led decision below.
- **Schema half-applied** (columns/index present): `prisma migrate resolve --applied <name>` — NOT
  `--rolled-back`, which would re-run the `ADD COLUMN` and fail `already exists`.
- **Nothing applied** (`applied_steps_count = 0`, no DDL landed): fix the root cause (de-duplicate,
  or ship a corrected migration), then
  `docker compose --project-directory <install root> run --rm -T --no-deps --entrypoint sh portal -c
  'cd /app && pnpm --filter @dpf/db exec prisma migrate resolve --rolled-back <name>'`
  and re-trigger the upgrade.

Authoring rules that prevent the class:

- A bulk data migration on a table under active writes must not re-validate a **partial** unique
  index — lock the table (`SHARE ROW EXCLUSIVE`) for the bounded window.
- If a later migration in the same batch treats an index as **untrustworthy** (drops/rebuilds it),
  no earlier migration may bulk-rewrite rows of that table while the index is live — drop the
  damaged index first (the repair rebuilds and amcheck-validates it).
- Migration tests must model a damaged unique index as `indisunique = true` **with** committed
  duplicates and force **non-HOT** updates (index the rewritten column); a non-unique stand-in index
  or a single-page HOT-friendly fixture both hide the re-validation failure — that is exactly how
  the 2026-07-29 failure escaped `inventory-entity-index-integrity-migration.test.ts`.

## References

- Implementation record + all four fixes: `docs/superpowers/plans/2026-07-13-bet5-db-compression-plan.md`
- Fleet-safety follow-up (why this manual bootstrap should eventually go away): BI-8BE7DF8A —
  machinery-first Wave-1/Wave-2 re-sequencing.
