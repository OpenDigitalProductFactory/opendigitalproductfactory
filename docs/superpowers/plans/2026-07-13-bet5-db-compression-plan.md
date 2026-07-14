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
