#!/bin/sh
# scripts/decommission-neo4j-qdrant.sh
# BET-5 (BI-922EBB99): remove the Neo4j + Qdrant containers and their data volumes AFTER
# their data has been copied into the Postgres mirror. DATA-SAFETY GATED and idempotent.
#
# Per-store gate (the copy is staged on portal boot by portal-migrate-boot.sh →
# bet5-decommission-backfill.ts):
#   * Neo4j is removed only once the Postgres graph mirror holds InfraCI nodes — the ONLY
#     non-regenerable payload (InfraCI has no Prisma source of truth). Its presence proves
#     the graph backfill ran.
#   * Qdrant is removed only once vector_embedding holds rows — proof the vector backfill ran.
# Set DPF_FORCE_DECOMMISSION=1 to bypass the gate (NOT recommended).
#
# Idempotent: a store whose container is already gone is skipped; re-running is a no-op.
#
# Env:
#   DPF_POSTGRES_CONTAINER   Postgres container (default: dpf-postgres-1)
#   DPF_DB_NAME              database name       (default: dpf)
#   DPF_DB_USER             database user       (default: dpf)
#   DPF_NEO4J_CONTAINER     (default: dpf-neo4j-1)     DPF_NEO4J_VOLUME  (default: dpf_neo4jdata)
#   DPF_QDRANT_CONTAINER    (default: dpf-qdrant-1)    DPF_QDRANT_VOLUME (default: dpf_qdrant_data)
#   DPF_FORCE_DECOMMISSION  set to 1 to skip the mirror-populated gate
#
# Exit codes: 0 done / no-op; 2 prereq missing; 3 safety gate failed (data not yet mirrored).

set -eu

log() { printf '[decommission] %s\n' "$*"; }
fail() { log "failed: $1"; exit "${2:-1}"; }

PG="${DPF_POSTGRES_CONTAINER:-dpf-postgres-1}"
DB_NAME="${DPF_DB_NAME:-dpf}"
DB_USER="${DPF_DB_USER:-dpf}"
NEO4J_CONTAINER="${DPF_NEO4J_CONTAINER:-dpf-neo4j-1}"
NEO4J_VOLUME="${DPF_NEO4J_VOLUME:-dpf_neo4jdata}"
QDRANT_CONTAINER="${DPF_QDRANT_CONTAINER:-dpf-qdrant-1}"
QDRANT_VOLUME="${DPF_QDRANT_VOLUME:-dpf_qdrant_data}"
FORCE="${DPF_FORCE_DECOMMISSION:-0}"

command -v docker >/dev/null 2>&1 || fail "docker CLI not available" 2

container_exists() { docker ps -a --format '{{.Names}}' | grep -qx "$1"; }
volume_exists()    { docker volume ls --format '{{.Name}}' | grep -qx "$1"; }

# Count rows via psql inside the Postgres container. Prints a number, or "" on any error
# (container down, table missing) — callers treat "" as "cannot confirm" → gate closed.
pg_count() {
  docker exec "$PG" psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>/dev/null | tr -d '[:space:]' || true
}

remove_store() {
  name="$1"; container="$2"; volume="$3"
  img=""
  if container_exists "$container"; then
    img="$(docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || true)"
    log "removing $name container: $container"
    docker rm -f "$container" >/dev/null 2>&1 || log "WARN could not remove container $container"
  else
    log "$name container $container not present — skipping"
  fi
  if volume_exists "$volume"; then
    log "removing $name volume: $volume"
    docker volume rm "$volume" >/dev/null 2>&1 || log "WARN could not remove volume $volume (still referenced?)"
  else
    log "$name volume $volume not present — skipping"
  fi
  # Best-effort image reclaim — never fails the run (image may be shared or in use).
  if [ -n "$img" ]; then
    log "reclaiming $name image: $img"
    docker rmi "$img" >/dev/null 2>&1 || log "note: $name image $img left in place (in use / shared)"
  fi
}

# Nothing to do at all?
if ! container_exists "$NEO4J_CONTAINER" && ! container_exists "$QDRANT_CONTAINER" \
   && ! volume_exists "$NEO4J_VOLUME" && ! volume_exists "$QDRANT_VOLUME"; then
  log "no Neo4j/Qdrant containers or volumes present — already decommissioned."
  exit 0
fi

# ── Neo4j: gate on InfraCI presence in the graph mirror ──────────────────────────────
if container_exists "$NEO4J_CONTAINER" || volume_exists "$NEO4J_VOLUME"; then
  if [ "$FORCE" = "1" ]; then
    log "FORCE set — skipping Neo4j mirror gate"
    remove_store "Neo4j" "$NEO4J_CONTAINER" "$NEO4J_VOLUME"
  else
    infra_n="$(pg_count "SELECT count(*) FROM graph_node WHERE 'InfraCI' = ANY(labels)")"
    if [ -n "$infra_n" ] && [ "$infra_n" -gt 0 ] 2>/dev/null; then
      log "graph mirror holds $infra_n InfraCI node(s) — Neo4j safe to remove"
      remove_store "Neo4j" "$NEO4J_CONTAINER" "$NEO4J_VOLUME"
    else
      fail "graph mirror has no InfraCI nodes yet (got '${infra_n:-<none>}') — boot the portal on the BET-5 image so the backfill runs, then re-run (or set DPF_FORCE_DECOMMISSION=1)" 3
    fi
  fi
fi

# ── Qdrant: gate on vector_embedding rows ────────────────────────────────────────────
if container_exists "$QDRANT_CONTAINER" || volume_exists "$QDRANT_VOLUME"; then
  if [ "$FORCE" = "1" ]; then
    log "FORCE set — skipping Qdrant mirror gate"
    remove_store "Qdrant" "$QDRANT_CONTAINER" "$QDRANT_VOLUME"
  else
    vec_n="$(pg_count "SELECT count(*) FROM vector_embedding")"
    if [ -n "$vec_n" ] && [ "$vec_n" -gt 0 ] 2>/dev/null; then
      log "vector mirror holds $vec_n embedding(s) — Qdrant safe to remove"
      remove_store "Qdrant" "$QDRANT_CONTAINER" "$QDRANT_VOLUME"
    else
      fail "vector mirror is empty (got '${vec_n:-<none>}') — boot the portal on the BET-5 image so the backfill runs, then re-run (or set DPF_FORCE_DECOMMISSION=1)" 3
    fi
  fi
fi

log "decommission complete."
exit 0
