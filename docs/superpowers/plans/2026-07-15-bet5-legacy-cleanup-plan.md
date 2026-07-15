# BET-5 legacy cleanup — retire the migration scaffolding (BI-2A3BE4D7)

**Status:** planned — execute SUPERVISED once zero-straggler is confirmed.
**BI:** BI-2A3BE4D7 · **Epic:** EP-8DC217EB (Vertical Integration Inward / BET-5)
**Predecessor:** BET-5 shipped + verified (PR #2967/#2969/#2974/#2978/#2981); fleet + Mac + Windows migrated.

## Why this is a follow-up, not part of BET-5

BET-5 kept the legacy Neo4j/Qdrant drivers on purpose: an install must be able to **read its old
stores during the one-time boot backfill** that copies data into Postgres. You cannot delete the
thing the migration depends on in the same release that performs the migration. Now that the known
fleet has migrated, the scaffolding can go — but only under a straggler gate (below).

## Current-state facts (verified on clean `main` 2026-07-15)

BET-5 is **complete and correct** on main. Do not re-litigate this:

- **Reads:** `packages/db/src/pg-graph.ts` (recursive CTEs over `graph_node`/`graph_edge`). The
  `neo4j-graph.ts` re-export seam points here.
- **Writes/projections:** `packages/db/src/neo4j-sync.ts` has **zero `runCypher` calls** — it
  `upsertGraphNode`/`upsertGraphEdge` into `graph_node`/`graph_edge` via `prisma.$executeRawUnsafe`.
  The mirror stays fresh on every write. **There is no EA-write correctness gap.**
  > ⚠️ A 2026-07-15 investigation briefly thought otherwise — that was a **stale root-clone** read
  > (`/Users/markbodman/dpf` sits on `feat/decision-gov-adjust-surfaces`, pre-BET-5, no `pg-graph.ts`).
  > Always verify BET-5 state in a fresh `origin/main` worktree.

### What STAYS (live — do NOT remove)
| File | Role |
|------|------|
| `packages/db/src/pg-graph.ts` | pg graph read model |
| `packages/db/src/neo4j-sync.ts` | **live** pg-mirror projection writer — consumed by `apps/web/lib/actions/ea.ts`, `apps/web/lib/actions/products.ts`, `apps/web/lib/inference/ollama.ts`, `apps/web/lib/ea/run-data-model-mirror.ts` |
| `packages/db/src/neo4j-schema.ts` | provides `NETWORK_RELATIONSHIP_TYPES` to `neo4j-sync.ts` |
| `packages/db/src/neo4j-graph.ts`, `qdrant.ts` | live re-export seams → pg impls |
| `NEO4J_/QDRANT_` env | still needed by the backfill until it is removed (see gate) |

### What is REMOVABLE once the straggler gate clears
| Artifact | Sole remaining consumer |
|----------|-------------------------|
| `packages/db/src/neo4j.ts` (Neo4j driver: `neo4jSession`/`runCypher`/`closeNeo4j`) | `neo4j-graph-backfill.ts` |
| `packages/db/src/qdrant-legacy.ts` (`scrollAllPoints`) | `pgvector-backfill.ts` |
| `neo4j-graph-backfill.ts`, `pgvector-backfill.ts`, `scripts/bet5-decommission-backfill.ts` | boot (`portal-migrate-boot.sh`) |
| `neo4j-driver` dep (`packages/db/package.json`) | `neo4j.ts` + the backfill |
| Boot/promote wiring: the `_bet5_backfill` block in `scripts/portal-migrate-boot.sh`; the step-7c / step-3a references in `scripts/promote.sh`; `scripts/decommission-neo4j-qdrant.{sh,ps1}` | — |
| Inert `NEO4J_/QDRANT_` env in `docker-compose.yml` + overlays | the backfill (once gone, env is dead) |
| `packages/db/scripts/init-neo4j.ts` | dev-only seed against Neo4j — dead post-retirement |

## The straggler gate (the one hard precondition)

Removing the backfill degrades any install that has **not** yet run the BET-5 migration: its boot would
create empty `graph_node`/`graph_edge` and no backfill would populate them (its data survives in its
still-present neo4j/qdrant containers, but the platform would read an empty mirror). So:

**Do not execute Phases 2–4 until zero un-migrated installs is confirmed.** Signals that an install is
still un-migrated: `dpf-neo4j-1`/`dpf-qdrant-1` present in `docker ps`, `graph_node` empty, portal on a
pre-BET-5 `/api/health/sha`. If a fleet migration-status signal exists, gate on it; otherwise treat this
as operator-confirmed ("the fleet is through", as reported 2026-07-15) and proceed with the deprecation
window below.

## Phases

### Phase 1 — Rename to kill the misleading names (SAFE, can ship independently of the gate)
The `neo4j-*` names on files that now write **Postgres** are actively misleading (they caused the false
alarm above). This is a pure rename, tsc-gated, no behavior change:
- `neo4j-sync.ts` → `graph-sync.ts`; `neo4j-schema.ts` → `graph-schema.ts`.
- Update `packages/db/src/index.ts` re-exports and the `@dpf/db/neo4j-sync` subpath export in
  `packages/db/package.json` (+ the `vi.mock("@dpf/db/neo4j-sync")` in `apps/web/lib/actions/ea.test.ts`).
- Keep `neo4j-graph.ts`/`qdrant.ts` seam names OR rename to `graph-read.ts`/`vector-store.ts` — optional.
- Gate: `pnpm --filter @dpf/db build` + `apps/web` tsc clean; full `@dpf/db` + EA suites green.
- **This phase is not straggler-gated** — it touches only live pg-writing code. It can land first.

### Phase 2 — Remove the backfill machinery (GATED)
- Delete `neo4j-graph-backfill.ts`, `pgvector-backfill.ts`, `scripts/bet5-decommission-backfill.ts`.
- Remove the `_bet5_backfill` invocation from `scripts/portal-migrate-boot.sh` (the block #2981 guarded).
- Remove the decommission-backfill references from `scripts/promote.sh`; decide whether to keep
  `scripts/decommission-neo4j-qdrant.{sh,ps1}` as a one-shot operator tool or retire it too.

### Phase 3 — Remove the legacy drivers + dep
- Delete `neo4j.ts`, `qdrant-legacy.ts`, `packages/db/scripts/init-neo4j.ts`.
- Remove `neo4j-driver` from `packages/db/package.json`; `pnpm install` to update the lockfile.
- Confirm nothing else imports them (grep on a clean main worktree, not the root clone).

### Phase 4 — Remove inert env + compose remnants
- Remove `NEO4J_/QDRANT_` env from `docker-compose.yml` + overlays (service defs are already gone).
- Sweep docs/AGENTS.md for stale Neo4j/Qdrant operational references.

## Verification
- `pnpm --filter @dpf/db build`; `apps/web` tsc 0 errors; full `@dpf/db` suite + EA + self-upgrade
  suites green (verify at `NODE_OPTIONS=--max-old-space-size=8192`; local prepush tsc OOMs cold).
- Boot a portal from a migrated DB and confirm no backfill invocation + graph reads/writes still work.
- Do NOT verify on the root clone — use a fresh `origin/main` worktree.

## Rollout
- Land **Phase 1 (rename) now** — safe, high-value (removes the naming trap), not gated.
- Land Phases 2–4 as ONE follow-up PR once zero-straggler is confirmed, with a deprecation window so a
  late straggler still migrates on the prior release. Reference the machinery-first sequencing lesson
  (memory `self-upgrade-fleet-safety-machinery-first`).
