#!/bin/sh
# scripts/backup-neo4j.sh — platform-managed Neo4j backup runner.
#
# Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md
#
# Neo4j Community Edition only supports OFFLINE dumps via
# `neo4j-admin database dump`. This script stops the running Neo4j
# container, runs the dump against the volume mount, and restarts the
# container.
#
# Per the never-ask-user-to-run-commands kernel principle, this is
# never invoked by the operator. The admin UX warns about the
# ~10-second unavailability window before invoking.
#
# Required env:
#   TARGET_DIR              absolute path on host where neo4j.dump + manifest + sha256 + log land
#   DPF_NEO4J_CONTAINER     container name (default: dpf-neo4j-1)
#   DPF_NEO4J_VOLUME        named volume (default: dpf_neo4jdata)
#   DPF_NEO4J_DATABASE      database name (default: neo4j)
#
# Exit codes:
#   0 success
#   2 prereq missing
#   3 dump failed (Neo4j container restarted regardless)
#   4 dump succeeded but Neo4j container failed to restart

set -eu

log() { printf '[backup-neo4j-trace] %s\n' "$*"; }
fail() {
  log "failed: $1"
  exit "${2:-1}"
}

TARGET_DIR="${TARGET_DIR:-}"
NEO4J_CONTAINER="${DPF_NEO4J_CONTAINER:-dpf-neo4j-1}"
NEO4J_VOLUME="${DPF_NEO4J_VOLUME:-dpf_neo4jdata}"
NEO4J_DATABASE="${DPF_NEO4J_DATABASE:-neo4j}"
DPF_HOST_INSTALL_PATH="${DPF_HOST_INSTALL_PATH:-}"

[ -n "$TARGET_DIR" ] || fail "TARGET_DIR not set" 2
[ -n "$DPF_HOST_INSTALL_PATH" ] || fail "DPF_HOST_INSTALL_PATH not set — required to translate portal's /backups view to the host path that docker-in-docker bind mounts need" 2
command -v docker >/dev/null 2>&1 || fail "docker CLI not available" 2
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum not available" 2

mkdir -p "$TARGET_DIR" || fail "could not create $TARGET_DIR" 2
# Neo4j runs the dump container as user `neo4j` (UID 7474). The host
# bind mount is created by the portal (root), so without explicit
# chmod the dump container gets AccessDeniedException writing to
# /dump. 0777 is safe here because the host-side directory lives
# under the operator-controlled DPF_HOST_INSTALL_PATH/backups tree.
chmod 0777 "$TARGET_DIR" || fail "could not chmod $TARGET_DIR" 2

# Translate the portal's view of TARGET_DIR (/backups/neo4j/<ts>) to the
# host path the docker daemon needs for the dump container's bind
# mount. Without this translation docker rejects the mount with
# "invalid path" or silently creates an empty dir, and the dump fails
# with AccessDeniedException. Same pattern the promoter uses
# (docker-compose.yml line ~240).
TARGET_REL="${TARGET_DIR#/backups/}"
HOST_TARGET_DIR="${DPF_HOST_INSTALL_PATH}/backups/${TARGET_REL}"
log "host path for dump container: $HOST_TARGET_DIR"

DUMP_FILE="$TARGET_DIR/neo4j.dump"
SHA_FILE="$TARGET_DIR/neo4j.dump.sha256"
LOG_FILE="$TARGET_DIR/log.txt"
MANIFEST_FILE="$TARGET_DIR/manifest.json"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STARTED_EPOCH="$(date +%s)"

log "starting offline dump container=$NEO4J_CONTAINER volume=$NEO4J_VOLUME db=$NEO4J_DATABASE"

# Capture the Neo4j image tag so the dump runner uses the same version.
# Mismatched versions (dump with newer admin against older data) fail.
NEO4J_IMAGE="$(docker inspect "$NEO4J_CONTAINER" --format='{{.Config.Image}}' 2>/dev/null || echo "neo4j:5-community")"
log "neo4j_image=$NEO4J_IMAGE"

# Stop the running container so the database is offline for the dump.
# 30-second grace period gives Neo4j time to flush + checkpoint.
log "stopping Neo4j container"
docker stop --timeout=30 "$NEO4J_CONTAINER" > "$LOG_FILE" 2>&1 || fail "could not stop $NEO4J_CONTAINER" 3

# Helper to restart the container on every exit path. Defined before the
# dump so a dump failure still restarts Neo4j. We track success/fail of
# the dump separately from the restart.
restart_neo4j() {
  log "restarting Neo4j container"
  if ! docker start "$NEO4J_CONTAINER" >> "$LOG_FILE" 2>&1; then
    log "WARN could not restart $NEO4J_CONTAINER — operator must check"
    return 1
  fi
  return 0
}

# Run the dump from a one-shot container mounted on the same volume.
# Output writes to the host target dir via a bind mount.
#
# Don't pass --user — the neo4j image's default user (neo4j, UID 7474)
# is what owns /data and has dump-write permissions.
#
# The bind mount source MUST be the HOST path (HOST_TARGET_DIR), not
# the portal's view (TARGET_DIR). The docker daemon resolves paths
# from the host's filesystem.
DUMP_EXIT=0
docker run --rm \
  -v "${NEO4J_VOLUME}:/data" \
  -v "${HOST_TARGET_DIR}:/dump" \
  "$NEO4J_IMAGE" \
  neo4j-admin database dump \
    --to-path=/dump \
    --overwrite-destination=true \
    "$NEO4J_DATABASE" >> "$LOG_FILE" 2>&1 || DUMP_EXIT=$?

# Always restart Neo4j before checking dump exit.
restart_neo4j
RESTART_EXIT=$?

if [ "$DUMP_EXIT" -ne 0 ]; then
  log "dump exit=$DUMP_EXIT — tail of log:"
  tail -n 20 "$LOG_FILE" >&2 || true
  fail "neo4j-admin database dump failed (exit=$DUMP_EXIT)" 3
fi

if [ "$RESTART_EXIT" -ne 0 ]; then
  fail "Neo4j restart failed AFTER dump — operator must verify container" 4
fi

# neo4j-admin emits <database>.dump (e.g. neo4j.dump) — normalize the name
# to a stable "neo4j.dump" regardless of database name so the orchestrator
# always knows where to find the file.
ACTUAL_DUMP="$TARGET_DIR/${NEO4J_DATABASE}.dump"
if [ -f "$ACTUAL_DUMP" ] && [ "$ACTUAL_DUMP" != "$DUMP_FILE" ]; then
  mv "$ACTUAL_DUMP" "$DUMP_FILE"
fi

[ -f "$DUMP_FILE" ] || fail "dump file did not appear at $DUMP_FILE" 3

# Checksum + manifest.
DUMP_SHA="$(sha256sum "$DUMP_FILE" | awk '{print $1}')"
printf '%s  neo4j.dump\n' "$DUMP_SHA" > "$SHA_FILE"

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FINISHED_EPOCH="$(date +%s)"
SIZE_BYTES="$(wc -c < "$DUMP_FILE" | tr -d ' ')"
DURATION_MS=$(( (FINISHED_EPOCH - STARTED_EPOCH) * 1000 ))

# Capture the actual neo4j image used for restore parity.
cat > "$MANIFEST_FILE" <<MANIFEST
{
  "schemaVersion": 1,
  "target": "neo4j",
  "container": "$NEO4J_CONTAINER",
  "volume": "$NEO4J_VOLUME",
  "database": "$NEO4J_DATABASE",
  "image": "$NEO4J_IMAGE",
  "startedAt": "$STARTED_AT",
  "finishedAt": "$FINISHED_AT",
  "durationMs": $DURATION_MS,
  "sizeBytes": $SIZE_BYTES,
  "sha256": "$DUMP_SHA",
  "dumpFormat": "neo4j-admin database dump"
}
MANIFEST

log "ok sha256=$DUMP_SHA size=$SIZE_BYTES duration_ms=$DURATION_MS"
exit 0
