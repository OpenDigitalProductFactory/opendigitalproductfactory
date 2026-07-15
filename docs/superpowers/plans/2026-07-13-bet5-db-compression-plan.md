# BET-5 DB compression — implementation plan (Neo4j + Qdrant → Postgres)

_EP-8DC217EB · BI-A1E864A5 · status: **planned, gated on a named migration author** · 2026-07-13_
_Decision + evidence: [`2026-07-12-bet5-datastore-benchmark-results.md`](../specs/2026-07-12-bet5-datastore-benchmark-results.md) (kernel `retire_after_benchmark`, founder green-lit)_
_Parent: [`2026-07-07-vertical-integration-inward-plan.md`](2026-07-07-vertical-integration-inward-plan.md) §BET-5_

## Goal

Collapse the two non-authoritative auxiliary datastores onto Postgres so a self-hosted
install runs **Postgres (+pgvector) + Redis** instead of **Postgres + Neo4j + Qdrant + Redis**.
Removes 2 always-on containers + dev twins, 2 backup/restore runners, 2 npm drivers, all
`NEO4J_*`/`QDRANT_*` env, and their preflight tiles. Blast radius ≈ 119 neo4j-referencing
files + the Qdrant callers.

## Non-negotiable constraints (from the decision)

- **Single serialized migration author.** This plan mutates `packages/db/prisma/schema.prisma`
  (the cross-epic hot-zone). One owner, serialized, expand-contract migrations —
  coordinate with EP-CLAUDE-INSIDE-OUT so schema edits don't collide. **This is the one
  gate that must be satisfied before Phase 1 starts.**
- **Postgres stays the single source of truth.** Both stores are already documented
  non-authoritative projections; keep it that way (re-projection, not data migration).
- **Re-validate on real data before each cutover** by re-running
  `benchmarks/bet5-datastore/{vec_bench,graph_bench}.py` against the actual corpus/graph.
- **Deferred re-adopt path preserved** — the specialized-store option stays recorded with
  its scale triggers (100k+ vectors / >1M edges); this plan does not delete that option.

## Phases (expand → migrate → contract, each independently shippable)

### Phase 0 — Postgres carries the extensions (infra, no app-schema change)
- Swap the `postgres:16-alpine` image for a pgvector-enabled image (`pgvector/pgvector:pg16`)
  in `docker-compose.yml` + the sandbox/CI compose + the install image.
- `CREATE EXTENSION vector; CREATE EXTENSION ltree;` via a migration/bootstrap (evaluate
  Apache AGE only if recursive-CTE/ltree proves insufficient — benchmark says it won't).
- Verify existing suite unaffected. **Ships alone; reversible; unblocks Phases 1–2.**

### Phase 1 — Vectors: Qdrant → pgvector + HNSW
1. **Expand:** add pgvector-backed tables (768-dim `vector` cols + HNSW cosine indexes) +
   a `pgvectorStore` implementing the existing embedding/recall interface behind a flag.
2. **Backfill + dual-read:** re-embed/copy the 4 Qdrant collections into pgvector; A/B the
   two backends (recall@k) with the harness on real data.
3. **Cutover:** flip `wiki/recall`, `principle-recall`, `ppr`, `embeddings`, sandbox recall,
   and the agent-memory path to pgvector; keep Qdrant read-only one release for rollback.
4. **Contract:** delete `qdrant.ts`, the Qdrant backup/restore runners, the driver dep,
   `QDRANT_*` env, the compose service + preflight tile.

### Phase 2 — Graph: Neo4j → Postgres recursive CTE / ltree
1. **Expand:** model the code-graph/EA nodes+edges as Postgres tables (adjacency +
   indexes; `ltree` for hierarchical paths where it fits).
2. **Port queries:** translate `code-graph/graph-queries.ts`, `neo4j-graph.ts`,
   `neo4j-projection.ts`, `discovery-inference.ts`, PPR, and the reconcile paths to
   `WITH RECURSIVE` CTEs. Re-run `graph_bench.py` on the live-size graph to confirm parity
   (benchmark showed Postgres ~15–20× faster at current scale).
3. **Cutover:** repoint code-graph refresh/access + EA traversal; keep Neo4j sync
   one release for rollback.
4. **Contract:** delete `neo4j*.ts`, the Neo4j backup/restore runners, the driver dep,
   `NEO4J_*` env, the compose service + preflight tile, and the ~119-file references.

### Phase 3 — Fleet cleanup + docs
- Remove the datastores from all compose files, the install/self-host image, backup
  orchestration, health/preflight tiles, and env templates.
- Update install docs + the runtime-topology docs to the compressed stack.
- Confirm `check-*` guards, backup dedup (BET-11), and health surfaces reflect the new set.

### Phase 3b — Self-upgrade decommission of EXISTING installs (BI-922EBB99)

Removing the services from compose only affects **fresh** installs. Instances upgraded via
self-upgrade (e.g. the maintainer's macOS + Windows boxes) will otherwise keep **orphaned
Neo4j/Qdrant containers + named volumes + images** — `docker compose up -d` neither removes
services dropped from the file nor deletes named volumes. So the promoter/self-upgrade path
needs an explicit, one-time decommission:

1. **Data-safety gate first.** Verify Postgres holds the re-projected data before any
   teardown (both stores are non-authoritative projections → re-projection check, not a data
   migration). Abort teardown + log if the gate fails.
2. **Teardown:** `docker compose rm -sf neo4j qdrant`, remove their named volumes, optional
   image prune; add `--remove-orphans` to the promoter's `compose up` as a safety net.
   Idempotent (no-op once decommissioned) and written to the self-upgrade change-record.
3. **Cross-platform — both runtimes are live targets:** implement in the Mac/Linux `.sh`
   path (`scripts/setup.sh:134` `docker compose up -d postgres neo4j qdrant`,
   `.upgrade-workspace/*.sh`, `scripts/promote.sh`) **and** the Windows `.ps1` path
   (`scripts/setup.ps1`, `scripts/fresh-install.ps1`, `scripts/redeploy-portal.ps1`).
4. **Installer scripts** stop naming neo4j/qdrant.
5. **Gated ordering:** only fires after Phase 1/2 cutovers have landed + verified; runs once
   per install, rollback-aware.

## Sequencing & rollback

- Vectors (Phase 1) before graph (Phase 2): smaller blast radius, cleaner A/B, and it's the
  path `principle_decide` recall depends on — de-risk that first.
- Every phase is expand-contract: the store isn't deleted until reads have run on Postgres
  for a full release with the old store available for instant rollback.
- Merge discipline: serial single author, `pnpm --filter @dpf/db generate` after each
  schema step, full-suite verify, and the module-size/style-drift/guard-loop ratchets.

## What can start now vs. what's gated

- **Now (ungated):** this plan; Phase 0 image/extension prep is low-risk but touches shared
  compose, so it should still ride with the named author to avoid disrupting concurrent
  local stacks.
- **Gated on the named migration author:** Phases 1–3 (all schema-bearing).

## Related harvested work (Convex tool-eval, filed 2026-07-13)

Not part of BET-5, but they land on the same Postgres substrate this plan consolidates onto:
- **BI-E43DC136** — durable agent-workflow primitive (Postgres + Inngest).
- **BI-83E63277** — push-based reactive agent-progress (LISTEN/NOTIFY or SSE).

## Implementation record — delivered in one atomic PR (2026-07-14)

Shipped as a single branch (`feat/bet5-datastore-compression`) so no install is ever left
half-migrated. The seam pattern throughout: build the Postgres impl behind the existing
export surface, A/B it against the live store on real data, then flip a one-file re-export so
every caller is unchanged.

**Runtime cutover (app reads + writes now Postgres-only):**
- Vectors: `packages/db/src/pgvector-store.ts` reimplements the Qdrant surface on pgvector
  (`vector_embedding` table, per-collection HNSW). `qdrant.ts` re-exports it. A/B on the real
  wiki corpus: 1.000 top-5 ranking parity + identical payload-filter. **must_not fix:** the
  legacy client passed the whole filter to Qdrant, so `must_not` worked implicitly; the new
  `buildFilterSql` now handles `must_not` explicitly (else cross-thread memory exclusion would
  silently break). Filter types (`MatchClause`/`QdrantFilter`) are exported and adopted by the
  app callers (embeddings.ts, semantic-memory.ts).
- Graph: `packages/db/src/pg-graph.ts` reimplements the Neo4j read surface as recursive CTEs
  over `graph_node`/`graph_edge`; `neo4j-graph.ts` re-exports it. `neo4j-sync.ts` write path +
  the code-graph projection/queries now emit SQL. A/B on the real infra/EA graph: 40/40
  downstream-impact + 40/40 neighbours identical. New graph server-action helpers
  (`getInfraEdges`, `getEdgesAmong`, `deleteGraphNode`, `clearGraphByLabel`) replaced the last
  `runCypher` calls in `actions/graph.ts`, `actions/products.ts`, the rebuild scripts, and
  `neo4j-schema.ts` (now Postgres-managed; keeps only the osiLayer data backfill).

**One-time data migration (self-upgrade, BI-922EBB99):**
- `neo4j-graph-backfill.ts` + `pgvector-backfill.ts` copy the live stores into the mirror.
  Entry: `packages/db/scripts/bet5-decommission-backfill.ts`, run non-fatally on portal boot
  (`portal-migrate-boot.sh`, after `prisma migrate deploy`) — it reaches the still-running old
  containers by network alias. Idempotent (skip-if-populated + ON CONFLICT DO NOTHING) and
  fail-soft (a fresh install with no legacy store finds nothing to copy). **InfraCI nodes have
  no Prisma source of truth, so this backfill is the only thing that preserves them; code-graph
  nodes are excluded because they regenerate from the repo (no data loss).**
- Teardown: `scripts/decommission-neo4j-qdrant.{sh,ps1}` (Mac/Linux + Windows), **data-safety
  gated** — removes Neo4j only once the graph mirror holds InfraCI nodes, Qdrant only once
  `vector_embedding` has rows; idempotent; best-effort image reclaim. Wired into `promote.sh`
  as step 7c (after health/verify prove boot completed), fail-LOUD-but-not-ABORT like
  sandbox-refresh, so a good portal upgrade is never mislabelled.

**Contraction:**
- Compose: `neo4j`/`qdrant`/`dev-neo4j`/`dev-qdrant` service definitions + their volumes
  removed from `docker-compose*.yml` (so nothing recreates them post-teardown). `NEO4J_*` /
  `QDRANT_INTERNAL_URL` env kept on portal/sandbox/dev for the one-time backfill's reachability.
- Backup / health / rollback: Neo4j + Qdrant dropped from the active backup-target, recovery-
  point, rollback, dependency-health, service-restart, and health-probe paths (no more
  scheduled backups of, or false "down" alerts for, removed services).

**Deliberately deferred to a follow-up cleanup release** (cannot remove in the same release
that needs them to migrate): the `neo4j-driver` + `@qdrant/js-client-rest` npm deps, the legacy
driver modules (`neo4j.ts`, `qdrant-legacy.ts`), the dead manifest types/runner files, and the
now-inert `NEO4J_*`/`QDRANT_*` env — all backfill-only, retired once every install has upgraded.

**Optional specialized-store path (recorded, not built):** at very large scale a dedicated
vector/graph engine may again beat Postgres; for the target customer that is far off. The
seam-behind-a-re-export design means re-introducing one is a localized change, not a rewrite.

### Self-upgrade postgres-image recreate (follow-up, 2026-07-14)

A live self-upgrade of an existing install surfaced a gap the CI fix (pgvector CI service image)
did not cover: `promote.sh` recreates ONLY the portal (`--no-deps`), so an existing install's
`postgres` / `sandbox-postgres` containers keep the image they launched with (`postgres:16-alpine`).
The Phase-0 compose bump to `pgvector/pgvector:pg16` therefore never reaches a running install, and
`prisma migrate deploy` fails at `CREATE EXTENSION vector` ("extension vector is not available")
BEFORE the swap — the upgrade aborts safely (old portal keeps serving) but never completes.

Fix: `promote.sh` gains **step 3a `ensure-pgvector`** (recreate `postgres` onto the compose-pinned
pgvector image before migrate) and a sandbox-postgres recreate in **step 7b**. Both are idempotent
(skip when `vector.control` is already present — fresh installs and already-upgraded installs) and
data-preserving (`pgvector/pgvector:pg16` is the same PG16 engine on the same `pgdata` volume, a
strict superset image — no dump/restore). Step 3a is fail-closed (abort before swap); the
sandbox-postgres recreate is fail-loud-not-abort like the rest of 7b. This makes every existing
install (Mac + Windows) upgrade cleanly with no manual DB step.

### Self-upgrade promoter-staleness (the deeper gap the live test exposed, 2026-07-14)

The first live re-trigger still failed — and revealed a THIRD, more fundamental gap. The promoter
**bakes `promote.sh` into its image** (`Dockerfile.promoter` ENTRYPOINT), and the self-upgrade
pre-drain check only (re)built the promoter when its image was **absent** — a stale-but-present
`dpf-promoter` (built before BET-5) was reused as-is. So the `ensure-pgvector` (3a) and decommission
(7c) steps in the fixed `promote.sh` **never ran** — the promoter executed its old baked copy, went
straight to migrate, and died on `CREATE EXTENSION vector`. That first (pre-fix) attempt also left
the `20260714110000_bet5_pgvector_foundation` migration in a FAILED state, so every later attempt
then hit **P3009** ("failed migrations… new migrations will not be applied").

Fix (this PR):
- **Always rebuild the promoter before a swap** (`self-upgrade.ts` precheck now calls
  `ensurePromoterImage` unconditionally for JIT-buildable images, not only when absent), keeping the
  promoter's `promote.sh` in lock-step with the running portal. Custom/registry promoter images are
  still left to the operator's pull.
- **P3009 self-heal** in `promote.sh` step 3a: once pgvector is guaranteed present, `migrate resolve
  --rolled-back` the pgvector-foundation migration if a prior pre-fix attempt left it failed — scoped
  to that one migration (which fails at its first statement, so rolling it back is a data no-op).

**Bootstrap caveat:** a fix to the self-upgrade machinery can't retroactively un-stick an install
whose portal AND promoter both predate the fix — the orchestrating portal is the old one. Such an
install (this Mac, and Windows) needs ONE manual bootstrap — rebuild `dpf-promoter` from the target
source, which then carries the fixed `promote.sh` — after which `ensure-pgvector` + the P3009
self-heal complete the upgrade automatically. From then on the always-rebuild keeps it self-sustaining.

## Fix 3 — ensure-pgvector is fleet-fatal (recreate strands postgres) — 2026-07-14

The live re-trigger on the Mac box (with the always-rebuild promoter from Fix 2) got past
`docker-build`, entered `ensure-pgvector`, recreated `dpf-postgres-1` onto the pgvector image — and
**left it dead in `Created` state**, taking the whole DB offline and aborting the run before migrate.
Root cause = **two bugs in `promote.sh` step 3a `ensure-pgvector`** (both fleet-fatal — they would
brick postgres on the FIRST BET-5 upgrade of every existing install, and a non-technical operator
cannot recover a `Created` postgres at fleet scale):

1. **Wrong `vector.control` path.** The idempotency check tested
   `/usr/local/share/postgresql/extension/vector.control`, but the Debian-based
   `pgvector/pgvector:pg16` image keeps it at `/usr/share/postgresql/16/extension/vector.control`.
   So the "already pgvector, skip" branch NEVER fired → it `--force-recreate`d postgres on every run.
2. **The recreate stranded postgres.** It ran `docker compose --project-directory "$PROMOTE_SOURCE"
   up -d --force-recreate postgres` from INSIDE the promoter, where `PROMOTE_SOURCE`=`/host-source`
   (the promoter's in-container mount). The postgres service's RELATIVE host bind
   `./scripts/init-inngest-db.sh` therefore resolved to `/host-source/scripts/...` — a path the HOST
   docker daemon can't share → `mounts denied` → container stuck in `Created`. (The portal recreate
   escapes this because its only host bind uses the ABSOLUTE `${DPF_HOST_INSTALL_PATH:-.}` env, not a
   relative `./`.) Same bug in step 7b's `sandbox-postgres` recreate.

Fix (this PR):
- **Image-agnostic vector detection** — new `_pg_provides_vector()` helper queries
  `pg_available_extensions` (reflects the on-disk control file wherever it lives) instead of a
  hard-coded path. Used by both step 3a and step 7b.
- **Host-bind-safe recreate** — new `_recreate_pg_onto_pgvector()` helper recreates the service with
  an extra compose override (`!override`) that pins the pgvector image and resets volumes to ONLY the
  named data volume (`pgdata` / `sandbox_pgdata`), dropping the init-script host bind. The init script
  only runs on an empty data dir (never on an upgrade), so this is behaviourally a no-op AND fully
  data-preserving (the named volume is untouched).
- **Regression tests** (`promote-script-functional.test.ts`, run against the REAL script): (a) SKIPS
  the recreate when `pg_available_extensions` reports vector present; (b) when a recreate IS needed,
  the postgres recreate line carries a SECOND `-f` (the override) — a regression to the bare
  `up --force-recreate postgres` that dragged the host bind would carry only one.

**Live recovery of the Mac box** (data never at risk — the named `dpf_pgdata` volume was intact): the
stranded container already had the right image (pgvector) + volume, so `docker rm dpf-postgres-1` then
`docker compose -p dpf -f <host compose files> -f <override pinning pgvector image> up -d --no-deps
--no-build postgres` from the REAL host path brought it back Up (healthy) with all data. Portal kept
serving on the old sha throughout (fail-closed held). P3009 left in place so the fixed promoter's
self-heal is exercised on the next re-trigger.

**Fleet-readiness decision (kernel-routed, 2026-07-14):** this fix unblocks the Mac + Windows boxes
but BET-5 is NOT declared fleet-ready on it alone — the machinery-first Wave-1/Wave-2 re-sequencing
remains a tracked follow-up (a self-upgrade must never ship a step the currently-deployed machinery
can't execute). principle_decide ledger: fix-verify-hold-fleet 8.90 / fold-resequence 8.73 /
minimal-now 7.86 (confidence low; operator confirmed fix-verify-hold-fleet).
