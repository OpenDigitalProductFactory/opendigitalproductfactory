#!/bin/sh
# scripts/backup-qdrant.sh — platform-managed Qdrant backup runner.
#
# Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md
#
# Qdrant supports ONLINE backups via the REST snapshot API. This script
# triggers a full-instance snapshot, downloads the resulting file, then
# deletes the in-container copy so Qdrant's storage doesn't bloat.
#
# Required env:
#   TARGET_DIR              absolute host dir for snapshot + manifest + sha256 + log
#   DPF_QDRANT_URL          internal URL (default: http://qdrant:6333)
#
# Exit codes:
#   0 success
#   2 prereq missing
#   3 snapshot create failed
#   4 download failed
#   5 cleanup failed (snapshot file downloaded but Qdrant copy not deleted — warning, not fatal)

set -eu

log() { printf '[backup-qdrant-trace] %s\n' "$*"; }
fail() {
  log "failed: $1"
  exit "${2:-1}"
}

TARGET_DIR="${TARGET_DIR:-}"
QDRANT_URL="${DPF_QDRANT_URL:-http://qdrant:6333}"

[ -n "$TARGET_DIR" ] || fail "TARGET_DIR not set" 2
command -v curl >/dev/null 2>&1 || fail "curl not available" 2
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum not available" 2

mkdir -p "$TARGET_DIR" || fail "could not create $TARGET_DIR" 2

DUMP_FILE="$TARGET_DIR/qdrant.snapshot"
SHA_FILE="$TARGET_DIR/qdrant.snapshot.sha256"
LOG_FILE="$TARGET_DIR/log.txt"
MANIFEST_FILE="$TARGET_DIR/manifest.json"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STARTED_EPOCH="$(date +%s)"

log "starting snapshot create url=$QDRANT_URL"

# Step 1: create the snapshot on Qdrant's side.
CREATE_RESPONSE=$(curl -sS -X POST "${QDRANT_URL}/snapshots" 2>>"$LOG_FILE") || fail "snapshot create request failed" 3
echo "$CREATE_RESPONSE" >> "$LOG_FILE"

# Parse the snapshot name from the JSON response without jq dependency.
# Response shape: {"result":{"name":"full-snapshot-2026-05-18-04-40-01.snapshot","creation_time":"...","size":N,"checksum":"..."},"status":"ok",...}
SNAPSHOT_NAME=$(echo "$CREATE_RESPONSE" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p' | head -1)
[ -n "$SNAPSHOT_NAME" ] || fail "could not parse snapshot name from Qdrant response" 3
log "snapshot created on Qdrant: $SNAPSHOT_NAME"

# Step 2: download the snapshot file to the host bind mount.
log "downloading snapshot"
if ! curl -sSf -o "$DUMP_FILE" "${QDRANT_URL}/snapshots/${SNAPSHOT_NAME}" 2>>"$LOG_FILE"; then
  fail "snapshot download failed" 4
fi

[ -s "$DUMP_FILE" ] || fail "downloaded snapshot is empty" 4

# Step 3: delete the snapshot from Qdrant to free storage. Non-fatal —
# orphaned snapshots inside Qdrant are recoverable next backup; the
# host-side copy is what matters.
CLEANUP_EXIT=0
curl -sS -X DELETE "${QDRANT_URL}/snapshots/${SNAPSHOT_NAME}" >> "$LOG_FILE" 2>&1 || CLEANUP_EXIT=$?
if [ "$CLEANUP_EXIT" -ne 0 ]; then
  log "WARN cleanup of in-Qdrant snapshot failed (exit=$CLEANUP_EXIT) — host copy is intact"
fi

# Checksum + manifest.
DUMP_SHA="$(sha256sum "$DUMP_FILE" | awk '{print $1}')"
printf '%s  qdrant.snapshot\n' "$DUMP_SHA" > "$SHA_FILE"

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FINISHED_EPOCH="$(date +%s)"
SIZE_BYTES="$(wc -c < "$DUMP_FILE" | tr -d ' ')"
DURATION_MS=$(( (FINISHED_EPOCH - STARTED_EPOCH) * 1000 ))

cat > "$MANIFEST_FILE" <<MANIFEST
{
  "schemaVersion": 1,
  "target": "qdrant",
  "qdrantUrl": "$QDRANT_URL",
  "snapshotName": "$SNAPSHOT_NAME",
  "startedAt": "$STARTED_AT",
  "finishedAt": "$FINISHED_AT",
  "durationMs": $DURATION_MS,
  "sizeBytes": $SIZE_BYTES,
  "sha256": "$DUMP_SHA",
  "dumpFormat": "qdrant snapshot (full instance)"
}
MANIFEST

log "ok sha256=$DUMP_SHA size=$SIZE_BYTES duration_ms=$DURATION_MS"
exit 0
