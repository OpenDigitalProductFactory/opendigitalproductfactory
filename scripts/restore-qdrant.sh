#!/bin/sh
# scripts/restore-qdrant.sh — platform-managed Qdrant restore runner.
#
# Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md (Slice 4)
#
# Uses Qdrant's full-instance snapshot REST API to restore:
#   1. Upload the snapshot file via POST /snapshots/upload?wait=true.
#      Qdrant processes it and recovers all collections from the snapshot.
#   2. The running Qdrant instance is NOT stopped — the API handles
#      the recovery online.
#
# Per the never-ask-user-to-run-commands kernel principle, this script
# is only ever called by the portal's restore runner after the operator
# types the typed-RESTORE confirmation.
#
# Required env:
#   DUMP_PATH          absolute path inside the portal container to qdrant.snapshot
#   DPF_QDRANT_URL     internal Qdrant URL (default: http://qdrant:6333)
#
# Exit codes:
#   0 success
#   2 prereq missing
#   3 upload or restore failed

set -eu

log() { printf '[restore-qdrant-trace] %s\n' "$*"; }
fail() {
  log "failed: $1"
  exit "${2:-1}"
}

DUMP_PATH="${DUMP_PATH:-}"
QDRANT_URL="${DPF_QDRANT_URL:-http://qdrant:6333}"

[ -n "$DUMP_PATH" ] || fail "DUMP_PATH not set" 2
[ -f "$DUMP_PATH" ] || fail "snapshot file does not exist: $DUMP_PATH" 2
command -v curl >/dev/null 2>&1 || fail "curl not available" 2

DUMP_DIR="$(dirname "$DUMP_PATH")"
LOG_FILE="${DUMP_DIR}/restore-log.txt"
printf 'restore started %s url=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$QDRANT_URL" > "$LOG_FILE"

log "uploading snapshot to Qdrant url=$QDRANT_URL file=$DUMP_PATH"

# Upload the full-instance snapshot. ?wait=true means the request blocks
# until Qdrant has finished processing the snapshot (all collections restored).
# Qdrant 1.7+ supports this endpoint for full-instance snapshots.
HTTP_STATUS=$(curl -sS -o "$LOG_FILE.upload_response" -w "%{http_code}" \
  -X POST "${QDRANT_URL}/snapshots/upload?wait=true" \
  -H "Content-Type: multipart/form-data" \
  -F "snapshot=@${DUMP_PATH}" 2>>"$LOG_FILE") || fail "curl request failed" 3

cat "$LOG_FILE.upload_response" >> "$LOG_FILE" 2>/dev/null || true
rm -f "$LOG_FILE.upload_response"

log "upload HTTP status=$HTTP_STATUS"

# Qdrant returns 200 on success. 4xx/5xx indicate failure.
case "$HTTP_STATUS" in
  200|201|202)
    log "ok snapshot uploaded and restored"
    exit 0
    ;;
  *)
    log "unexpected HTTP status=$HTTP_STATUS from Qdrant"
    fail "Qdrant snapshot upload returned HTTP $HTTP_STATUS — check Qdrant logs for details" 3
    ;;
esac
