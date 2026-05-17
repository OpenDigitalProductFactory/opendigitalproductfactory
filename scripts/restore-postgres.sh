#!/bin/sh
# scripts/restore-postgres.sh — platform-managed Postgres restore runner.
#
# Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.6
# Plan: docs/superpowers/plans/2026-05-17-postgres-backup-slice-2-restore.md
#
# Mirrors scripts/backup-postgres.sh — runs inside the portal container,
# uses the mounted docker socket to exec into the postgres container, and
# streams the dump into pg_restore --clean --if-exists.
#
# Per the never-ask-user-to-run-commands kernel principle, this is never
# invoked by the operator. The TS orchestrator
# (apps/web/lib/operate/backups/postgres-restore-runner.ts) spawns it AFTER
# acquiring the portal-side mutex AND writing the pre-restore safety dump.
#
# Required env:
#   DUMP_PATH                    absolute path inside the portal container to
#                                the source .dump file (under /backups/)
#   POSTGRES_USER                DB role to restore as (default: dpf)
#   POSTGRES_DB                  target DB (default: dpf)
#   DPF_PRODUCTION_DB_CONTAINER  postgres container name (default: dpf-postgres-1)
#
# Optional env:
#   LOG_PATH                     where to append stdout/stderr (default: alongside DUMP_PATH)
#
# Exit codes:
#   0  success (pg_restore completed; warnings are normal during --clean)
#   2  prereq missing
#   3  pg_restore failed (non-zero exit + no recoverable errors-only path)

set -eu

log() { printf '[restore-trace] %s\n' "$*"; }
fail() {
  log "failed: $1"
  exit "${2:-1}"
}

DUMP_PATH="${DUMP_PATH:-}"
POSTGRES_USER="${POSTGRES_USER:-dpf}"
POSTGRES_DB="${POSTGRES_DB:-dpf}"
DB_CONTAINER="${DPF_PRODUCTION_DB_CONTAINER:-dpf-postgres-1}"
LOG_PATH="${LOG_PATH:-${DUMP_PATH}.restore-log.txt}"

[ -n "$DUMP_PATH" ] || fail "DUMP_PATH not set" 2
[ -r "$DUMP_PATH" ] || fail "dump not readable at $DUMP_PATH" 2
command -v docker >/dev/null 2>&1 || fail "docker CLI not available in runner image" 2

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STARTED_EPOCH="$(date +%s)"

SIZE_BYTES="$(wc -c < "$DUMP_PATH" | tr -d ' ')"

log "starting pg_restore container=$DB_CONTAINER user=$POSTGRES_USER db=$POSTGRES_DB dump=$DUMP_PATH size=$SIZE_BYTES"

# Stream the dump into pg_restore --clean --if-exists inside the postgres
# container. --clean drops objects before recreating them; --if-exists
# silences "does not exist" warnings on a fresh-state target.
#
# Note on warnings: pg_restore frequently emits "warning: errors ignored on
# restore: N" against a clean target. As long as the exit code is 0, the
# restore is functionally complete. We surface the full log either way for
# operator review via the audit row.
if docker exec -i "$DB_CONTAINER" pg_restore \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    < "$DUMP_PATH" > "$LOG_PATH" 2>&1; then
  FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  FINISHED_EPOCH="$(date +%s)"
  DURATION_MS=$(( (FINISHED_EPOCH - STARTED_EPOCH) * 1000 ))
  log "ok startedAt=$STARTED_AT finishedAt=$FINISHED_AT duration_ms=$DURATION_MS"
  exit 0
fi

EXIT=$?
log "pg_restore exit=$EXIT — tail of log:"
tail -n 20 "$LOG_PATH" >&2 || true
fail "pg_restore failed (exit=$EXIT)" 3
