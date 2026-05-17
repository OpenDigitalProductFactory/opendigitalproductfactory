#!/bin/sh
# scripts/backup-postgres.sh — platform-managed Postgres backup runner.
#
# Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md
# Plan: docs/superpowers/plans/2026-05-17-postgres-daily-backup-slice-1.md
#
# The TypeScript orchestrator in apps/web/lib/operate/backups/postgres-backup-runner.ts
# spawns this script. It runs INSIDE the portal container, where /var/run/docker.sock
# is mounted so we can exec into the postgres container, and where the host-bound
# /backups directory is mounted at /backups.
#
# Per the never-ask-user-to-run-commands kernel principle, this script is
# never invoked by the operator. It is platform plumbing.
#
# Required env:
#   TARGET_DIR              absolute path inside the portal container where the
#                           dump and metadata are written (e.g. /backups/postgres/<iso-ts>)
#   POSTGRES_USER           DB role to dump as (default: dpf)
#   POSTGRES_DB             DB to dump (default: dpf)
#   DPF_PRODUCTION_DB_CONTAINER  postgres container name (default: dpf-postgres-1)
#
# Optional env:
#   DPF_VERSION             value to record in manifest.json (default: empty)
#
# Exit codes:
#   0  success
#   2  prereq missing (missing tool or env)
#   3  pg_dump failed
#   4  checksum failed
#   5  manifest write failed

set -eu

log() { printf '[backup-trace] %s\n' "$*"; }
fail() {
  log "failed: $1"
  exit "${2:-1}"
}

TARGET_DIR="${TARGET_DIR:-}"
POSTGRES_USER="${POSTGRES_USER:-dpf}"
POSTGRES_DB="${POSTGRES_DB:-dpf}"
DB_CONTAINER="${DPF_PRODUCTION_DB_CONTAINER:-dpf-postgres-1}"
DPF_VERSION_VALUE="${DPF_VERSION:-}"

[ -n "$TARGET_DIR" ] || fail "TARGET_DIR not set" 2
command -v docker >/dev/null 2>&1 || fail "docker CLI not available in runner image" 2
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum not available" 2

mkdir -p "$TARGET_DIR" || fail "could not create target directory $TARGET_DIR" 2

DUMP_FILE="$TARGET_DIR/dpf.dump"
SHA_FILE="$TARGET_DIR/dpf.dump.sha256"
LOG_FILE="$TARGET_DIR/log.txt"
MANIFEST_FILE="$TARGET_DIR/manifest.json"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STARTED_EPOCH="$(date +%s)"

log "starting pg_dump container=$DB_CONTAINER user=$POSTGRES_USER db=$POSTGRES_DB target=$TARGET_DIR"

# Capture pg_version BEFORE we exec the dump so a dump failure doesn't deny us
# the version info for diagnostics.
PG_VERSION="$(docker exec "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "SHOW server_version" 2>/dev/null || echo "unknown")"
log "pg_version=$PG_VERSION"

# Run pg_dump inside the postgres container; stream output to a host file.
# Custom format (-Fc) is compressed, supports selective restore, and is what
# the existing promoter script uses (scripts/promote.sh:157).
if docker exec "$DB_CONTAINER" pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$DUMP_FILE" 2> "$LOG_FILE"; then
  log "pg_dump succeeded size=$(wc -c < "$DUMP_FILE")"
else
  EXIT=$?
  log "pg_dump exit=$EXIT — tail of log:"
  tail -n 20 "$LOG_FILE" >&2 || true
  fail "pg_dump failed (exit=$EXIT)" 3
fi

# sha256 checksum so the admin UX can verify integrity without re-reading the
# whole dump. We store the bare hash for easy comparison.
DUMP_SHA="$(sha256sum "$DUMP_FILE" | awk '{print $1}')" || fail "sha256sum failed" 4
printf '%s  dpf.dump\n' "$DUMP_SHA" > "$SHA_FILE" || fail "could not write sha256 file" 4

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FINISHED_EPOCH="$(date +%s)"
SIZE_BYTES="$(wc -c < "$DUMP_FILE" | tr -d ' ')"
DURATION_MS=$(( (FINISHED_EPOCH - STARTED_EPOCH) * 1000 ))

# Manifest. Keep this small and JSON-strict so the TS side can parse it
# with JSON.parse and not a YAML/TOML library.
cat > "$MANIFEST_FILE" <<MANIFEST || fail "could not write manifest" 5
{
  "schemaVersion": 1,
  "target": "postgres",
  "container": "$DB_CONTAINER",
  "postgresUser": "$POSTGRES_USER",
  "postgresDb": "$POSTGRES_DB",
  "pgVersion": "$PG_VERSION",
  "dpfVersion": "$DPF_VERSION_VALUE",
  "startedAt": "$STARTED_AT",
  "finishedAt": "$FINISHED_AT",
  "durationMs": $DURATION_MS,
  "sizeBytes": $SIZE_BYTES,
  "sha256": "$DUMP_SHA",
  "dumpFormat": "pg_dump -Fc"
}
MANIFEST

log "manifest written sha256=$DUMP_SHA size=$SIZE_BYTES duration_ms=$DURATION_MS"
log "ok"
exit 0
