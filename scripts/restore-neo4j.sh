#!/bin/sh
# scripts/restore-neo4j.sh — platform-managed Neo4j restore runner.
#
# Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md (Slice 4)
#
# Mirrors the offline dump approach used by backup-neo4j.sh:
#   1. Stop the running Neo4j container.
#   2. Run neo4j-admin database load against the volume from a one-shot
#      container (same image as the running Neo4j to ensure format parity).
#   3. Restart the original container.
#
# Per the never-ask-user-to-run-commands kernel principle, this script
# is never invoked by the operator. The admin restore wizard calls it
# after the operator types the typed-RESTORE confirmation.
#
# Required env:
#   DUMP_PATH              absolute path on host to neo4j.dump
#   DPF_NEO4J_CONTAINER    container name (default: dpf-neo4j-1)
#   DPF_NEO4J_VOLUME       named volume (default: dpf_neo4jdata)
#   DPF_NEO4J_DATABASE     database name (default: neo4j)
#   DPF_HOST_INSTALL_PATH  host install path for docker-in-docker bind translation
#
# Exit codes:
#   0 success
#   2 prereq missing
#   3 load failed (Neo4j container restarted regardless)
#   4 load succeeded but Neo4j container failed to restart

set -eu

log() { printf '[restore-neo4j-trace] %s\n' "$*"; }
fail() {
  log "failed: $1"
  exit "${2:-1}"
}

DUMP_PATH="${DUMP_PATH:-}"
NEO4J_CONTAINER="${DPF_NEO4J_CONTAINER:-dpf-neo4j-1}"
NEO4J_VOLUME="${DPF_NEO4J_VOLUME:-dpf_neo4jdata}"
NEO4J_DATABASE="${DPF_NEO4J_DATABASE:-neo4j}"
DPF_HOST_INSTALL_PATH="${DPF_HOST_INSTALL_PATH:-}"

[ -n "$DUMP_PATH" ] || fail "DUMP_PATH not set" 2
[ -n "$DPF_HOST_INSTALL_PATH" ] || fail "DPF_HOST_INSTALL_PATH not set" 2
[ -f "$DUMP_PATH" ] || fail "dump file does not exist: $DUMP_PATH" 2
command -v docker >/dev/null 2>&1 || fail "docker CLI not available" 2

# Translate the portal's /backups/... view to the host path the Docker daemon
# needs for bind mounts (same pattern as backup-neo4j.sh HOST_TARGET_DIR).
DUMP_DIR="$(dirname "$DUMP_PATH")"
DUMP_RELATIVE="${DUMP_DIR#/backups/}"
HOST_DUMP_DIR="${DPF_HOST_INSTALL_PATH}/backups/${DUMP_RELATIVE}"
HOST_DUMP_FILE="${HOST_DUMP_DIR}/neo4j.dump"
log "host dump path for bind mount: $HOST_DUMP_FILE"

# Capture the Neo4j image tag so the load runner uses the same version.
NEO4J_IMAGE="$(docker inspect "$NEO4J_CONTAINER" --format='{{.Config.Image}}' 2>/dev/null || echo "neo4j:5-community")"
log "neo4j_image=$NEO4J_IMAGE container=$NEO4J_CONTAINER volume=$NEO4J_VOLUME db=$NEO4J_DATABASE"

LOG_FILE="${DUMP_DIR}/restore-log.txt"
printf 'restore started %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LOG_FILE"

# Stop the running container. 30-second grace gives Neo4j time to flush.
log "stopping Neo4j container"
docker stop --timeout=30 "$NEO4J_CONTAINER" >> "$LOG_FILE" 2>&1 || fail "could not stop $NEO4J_CONTAINER" 2

# Always restart the container regardless of load outcome.
restart_neo4j() {
  log "restarting Neo4j container"
  if ! docker start "$NEO4J_CONTAINER" >> "$LOG_FILE" 2>&1; then
    log "WARN could not restart $NEO4J_CONTAINER — operator must check"
    return 1
  fi
  return 0
}

# Run the load from a one-shot container mounting the same volume.
# --overwrite-destination=true drops the existing database before loading.
LOAD_EXIT=0
docker run --rm \
  -v "${NEO4J_VOLUME}:/data" \
  -v "${HOST_DUMP_DIR}:/dump:ro" \
  "$NEO4J_IMAGE" \
  neo4j-admin database load \
    --from-path=/dump \
    --overwrite-destination=true \
    "$NEO4J_DATABASE" >> "$LOG_FILE" 2>&1 || LOAD_EXIT=$?

# Always restart, then check load exit.
restart_neo4j
RESTART_EXIT=$?

if [ "$LOAD_EXIT" -ne 0 ]; then
  log "load exit=$LOAD_EXIT — tail of log:"
  tail -n 20 "$LOG_FILE" >&2 || true
  fail "neo4j-admin database load failed (exit=$LOAD_EXIT)" 3
fi

if [ "$RESTART_EXIT" -ne 0 ]; then
  fail "Neo4j restart failed AFTER load — operator must verify container" 4
fi

log "ok load complete database=$NEO4J_DATABASE"
exit 0
