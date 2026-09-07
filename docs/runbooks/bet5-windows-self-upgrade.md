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

## Consumer release installs — artifact-native upgrades

A consumer install has release assets and tagged container images, but intentionally has no Git
checkout. Do **not** use the source-install bootstrap in Step 1 for that shape. The first release that
contains artifact-native self-upgrade still needs one governed installer/bootstrap run because the
currently running portal cannot acquire capabilities that are not already in its image. After that
bootstrap, use **Ops → Self-Upgrade → Upgrade now** for later releases.

The consumer path:

- resolves the verification-gated GHCR channel (`latest` unless
  `DPF_IMAGE_CHANNEL_TAG` overrides it), verifies its OCI manifests/config, and freezes the one
  immutable release tag that identifies the same bytes;
- compares the running portal container's config digest with the candidate config digest, rather
  than treating a recorded tag or GitHub release run as byte identity;
- pulls the portal and promoter for that exact immutable tag and verifies the expected portal
  config digest, OCI revision, and baked source-content identity before swapping;
- verifies `SHA256SUMS`, replaces only installer-managed lifecycle files, and preserves operator-owned
  files and environment settings;
- commits the release tag and install identity only after migration, health, SHA, and content checks
  pass; and
- restores the prior managed files, install state, and runtime tag if the identity commit fails.

If the Upgrade Center reports that install identity is unverified, re-run the current consumer
installer once to converge the canonical state; do not create a Git checkout beside the install.
If it reports that update status is unavailable, inspect the technical reason and registry access;
the page intentionally hides **Upgrade now** and queues nothing until it can prove a candidate.
A current state also has no upgrade action because the running config digest already equals the
verified channel candidate. Both states are safe and non-mutating.

### Ordinary restart after a consumer upgrade

Release promotion writes the verified tag and managed assets to the canonical install directory,
not to the temporary candidate workspace. On Windows, `dpf-start.ps1` then reads the consumer
install's recorded `imageTag` before Compose interpolation. That immutable recorded tag overrides a
contradictory process or root `.env` value such as `latest`, so an ordinary restart cannot silently
replace the deployed release with older cached bytes.

The start command stops before Docker mutation if a known consumer install has a missing, mutable,
malformed, or wrong-install-path release identity. Repair that state with the governed consumer
installer or Upgrade Center; do not edit `.env` or install-state by hand. Contributor/source installs
retain their existing local-image behavior.

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

## First question after any failed upgrade: how far did it get?

`promote.sh` appends every step it announces to a durable trail on the shared state
mount, so the answer survives the thing that destroyed it before — the orchestrating
portal dying mid-upgrade, whether from a Docker restart, a host reboot or a power cut.

```powershell
# on the host (DPF_STATE_DIR, default %USERPROFILE%\.dpf)
Get-Content "$env:USERPROFILE\.dpf\self-upgrade-steps.log" -Tail 20
```

```bash
# or through the portal, which mounts the same directory read-only
docker exec dpf-portal-1 tail -20 /dpf-state/self-upgrade-steps.log
```

Each line is `<utc>\t<mode>\t<step>\t<target-sha>`. Read the **last** line whose target
matches the failed run, and whose mode is `real` (a `dry-run` line never touched the
install):

| Last step reached | What it means |
| --- | --- |
| `prepare` … `migrate` | The container swap never started. The install is untouched and still on its pre-upgrade image; re-trigger the upgrade normally. |
| `docker-up` or later | The swap had begun. Check what is actually running (`docker ps`, `/api/health`) before re-triggering. |
| nothing for that target | The promotion died before its first step, or this install's promoter predates the trail. Treat the outcome as unknown. |

`migrate` counts as pre-swap: schema migrations run before the container is replaced and
are forward-only, so a re-run after an interruption there re-applies nothing.

The portal records the same verdict on the run itself
(`SelfUpgradeRun.completionEvidence.interruption`) the next time an upgrade is
requested, including an explicit indeterminate verdict with its basis. If the trail is
missing entirely the answer is "unknown" — never assume the install was untouched.

The file is bounded at 2000 lines and rotated to the newest 1000, so an old incident may
have aged out. Copy it before a long investigation.

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

## Failure class: host-out-of-memory (candidate build ENOMEM)

The candidate promoter `docker build` — run at the **preflight** stage, *before* quiescence, while the
portal is still fully active — fails during build-context load with:

```
error from sender: readdirent /host-dpf/.upgrade-workspace/scripts: cannot allocate memory
```

Canonical case **SUR-BF75ED2A (2026-08-11)**: the WSL2 VM (hard-capped 24 GB in `.wslconfig`) was
thrashing — swap in use, `MemFree` ~467 MB — so buildkit's context sender could not allocate a kernel
buffer to enumerate the build context and the build aborted (`promoter_candidate_build_failed` →
`promoter-readiness-failed` → run `failed`). It died **before any portal swap**, so the running portal
was never touched — a **safe** failure, not a bad deploy.

**This is host pressure, not a code defect.** The candidate build is the most memory-intensive step and
it runs *hot* (portal live) by design, so that a failed build never causes pointless downtime — but that
means it competes for memory with all 30 active surfaces. Quiescence (which stops activity for the
swap/migrate) happens *after* this build and does not free memory for it.

**Prevention (shipped):** a **host-memory-headroom guard** now runs before the candidate build
(`apps/web/lib/self-upgrade/host-memory-preflight.ts`, wired in `runSelfUpgrade`). When genuinely-available
memory is below the build floor (default 2 GiB) it **DEFERS the run** — `skipped` with reason
`host-memory-pressure`, plus a cooldown — instead of launching a doomed build; the next hourly cron retries
once memory recovers (WSL2 `autoMemoryReclaim=gradual`). The floor is measured against **MemAvailable**
(reclaimable-inclusive), *not* MemFree, so a busy-but-healthy host with large page cache is never starved —
the guard fires only under real exhaustion. It fails **open** when memory is unmeasurable, so it can never
wedge upgrades on a host whose meminfo cannot be read.

**Recovery for a run that already failed this way:** none needed — nothing was deployed. Free host memory
(let `autoMemoryReclaim` run, or shed heavy consumers / parallel Build Studio load) and re-trigger, or just
let the next cron tick retry. The `build-failure-classifier` now labels this class `host-out-of-memory`
(environment), so the failure surfaces as retryable rather than the old generic
`promoter-readiness-failed (unclassified)`.

## Failure class: promoter-context-n1 (a new COPY made the candidate unbuildable)

The candidate promoter build fails at **preflight**, before quiescence, with a docker checksum error
naming a file that plainly exists in the candidate tree:

```
promoter-readiness-failed: promoter_candidate_build_failed: release-assets.mjs
ERROR: failed to compute cache key: "/scripts/installer/install-release-assets.mjs": not found
```

Canonical case **SUR-75DAF829 (2026-08-22)**: the file existed in the candidate checkout *and* in the
upgrade workspace, which is what makes this one confusing. It was missing from the **build context**.

**Why.** The promoter's docker build context is staged by the **deployed (N-1) portal** from a file list
baked into its own image, while `Dockerfile.promoter` is **candidate-owned**. A release that added one
`COPY` therefore made its own candidate unbuildable by every already-deployed portal — the older caller
cannot stage a file that did not exist when it was built, and the upgrade that would teach it is the
blocked upgrade. Same self-wedging shape as the capability-catalog class above.

**Fixed.** `Dockerfile.promoter` now copies `scripts/` as a **directory**, so the caller decides the
contents and the candidate never demands a file an older caller could not supply. Staging is still
minimal, so the SUR-BF75ED2A OOM fix is intact. A CI step rebuilds the candidate promoter from a context
staged by the *previous* release's closure, so an N-1-unbuildable promoter change cannot merge again.

**Diagnosing a recurrence.** Compare what the deployed portal stages against what the candidate needs:

```bash
docker exec dpf-portal-1 grep -c '^COPY' /promoter/Dockerfile.promoter   # what the deployed caller knows
docker exec dpf-portal-1 ls -R /promoter/scripts                          # the files it can stage
```

**Recovery:** none needed — nothing was deployed. Upgrade to a build carrying the directory COPY.

## Failure class: capability-state-stale (a release moved the capability catalog)

Promoter **readiness** refuses before quiescence with:

```
promoter-readiness-failed: Promoter readiness check failed: capability_projection_failed
failures: [capability_projection_failed, install_state_projection_failed]
```

Canonical case **SUR-C45B5F4B (2026-08-22)**: the install was healthy and already at install-state
`schemaVersion: 2`. The candidate simply carried a capability service catalog in which `inngest` and
`redis` had moved from `runtime:durable-automation` into `runtime:core`. That legitimately moves
`catalogHash`, so the install's recorded `capabilityCatalogHash` was one release behind and every
projection refused with `capability_state_stale`.

Like the OOM class above, this dies **before any portal swap** — a safe refusal, not a bad deploy.

**This was a platform defect, now fixed.** The install-state migrator treated migration as purely a
*schema-version* edge, so a schema-2 state could never have its capability snapshot re-projected. The
first release to move the catalog therefore wedged every existing install, and the upgrade that would
have restamped the state *was* the blocked upgrade. A catalog that moves within schema 2 is now a
first-class migration: readiness re-projects it, and the promoter persists the restamp under the same
lock and compare-and-swap binding as a schema migration. See
[the design amendment](../superpowers/specs/2026-07-18-install-state-readiness-migration-design.md) §7.

**Recovery for a run that already failed this way:** none needed — nothing was deployed. Upgrade to a
build carrying the fix and re-trigger; the run restamps the install-state itself.

**A refusal still means something.** These two codes fail closed for causes that are *not* the
platform's doing, and they still do:

- the enabled capability set was edited without restamping (`capabilityStateVersion` disagrees with an
  **unchanged** catalog);
- the state names a capability the candidate catalog no longer defines
  (`unknown_runtime_capability:<id>`).

To tell them apart, read the failure `message`, not just the code — every readiness probe now carries
its underlying error, e.g. `capability_projection_failed: capability_state_stale`. Reproduce a refusal
by hand against the mounted state with:

```bash
docker run --rm --read-only -v "$PWD:/host-source:ro" -v "$HOME/.dpf:/dpf-state:ro" \
  -e DPF_PROMOTER_STATE_DIR=/dpf-state -e DPF_PROMOTER_DOCKER_PREFLIGHT=ready \
  -e PROMOTE_SOURCE=/host-source -e PROMOTE_TARGET_SHA="<target>" \
  -e PROMOTE_HEALTH_URL=http://host.docker.internal:3000/api/health \
  -e PROMOTE_COMPOSE_PROJECT=dpf -e PROMOTE_BACKUP_PATH=/backups/recovery \
  dpf-promoter:<target> --readiness
```

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
- **Exact human-principal alias collision**
  (`20260812110000_backfill_missing_human_principals`): the promoter automatically marks the row
  rolled back only when it is the sole unresolved migration, the row id and immutable migration
  checksum match, the failure is SQLSTATE `23505` on
  `PrincipalAlias_aliasType_aliasValue_issuer_key`, `applied_steps_count = 0`, and the candidate
  carries the exact preceding collision-preparation migration. It verifies the same ledger row
  after resolution, then normal deploy applies the preparation migration before retrying the
  immutable backfill. A different migration, checksum, constraint, SQLSTATE, step count, or
  corrective file fails closed before the portal swap.
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
