#!/bin/sh
# scripts/postgres-trial-restore.sh
#
# Nightly trial-restore verification — proves the latest postgres backup is
# functionally restorable WITHOUT touching the production DB. Same posture
# as the operator restore wizard (scripts/restore-postgres.sh) except the
# target is a freshly-created temp DB that gets dropped after verification.
#
# Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.7 (verification)
# BI:   BI-31C9FBDF (EP-DR-HARDENING-2026-05-23)
#
# What this catches that the sha256 check + pg_dump exit code do NOT:
#   - Truncated dumps that decode cleanly but contain no rows
#   - Schema-vs-dump mismatch from concurrent migrations during pg_dump
#   - On-disk FS corruption between dump-time and restore-time
#   - Encoding / locale drift that breaks pg_restore even on valid bytes
#
# Per the never-ask-user-to-run-commands kernel principle, this is never
# invoked by the operator. The TS orchestrator
# (apps/web/lib/operate/backups/postgres-trial-restore-runner.ts) spawns it
# from the nightly Inngest cron after the postgres backup completes.
#
# Required env:
#   DUMP_PATH                    absolute path inside the portal container
#                                to the source .dump file (under /backups/)
#   POSTGRES_USER                DB role to restore as (default: dpf)
#   DPF_PRODUCTION_DB_CONTAINER  postgres container name (default: dpf-postgres-1)
#   ASSERT_TABLES                comma-separated list of tables to row-count-check
#                                (default: BacklogItem,Epic,ModelProvider,User)
#
# Optional env:
#   TRIAL_DB_PREFIX              prefix for the temp DB name (default: dpf_trial_)
#   LOG_PATH                     where to append stdout/stderr
#                                (default: alongside DUMP_PATH with .trial-restore-log.txt suffix)
#
# Output (last line on stdout, machine-readable):
#   "RESULT ok|failed assert_<table>=<count> ..."
#
# Exit codes:
#   0  success — restore + all assertions passed
#   2  prereq missing (env, docker CLI, dump file)
#   3  CREATE DATABASE failed
#   4  pg_restore failed
#   5  assertion failed (a critical table had 0 rows)
#   6  cleanup failed but restore + assertions ok (warn-level; backup itself
#      is fine, but the operator may want to clean up the orphan temp DB)

set -eu

log() { printf '[trial-restore-trace] %s\n' "$*"; }
fail() {
  log "failed: $1"
  exit "${2:-1}"
}

DUMP_PATH="${DUMP_PATH:-}"
POSTGRES_USER="${POSTGRES_USER:-dpf}"
DB_CONTAINER="${DPF_PRODUCTION_DB_CONTAINER:-dpf-postgres-1}"
TRIAL_DB_PREFIX="${TRIAL_DB_PREFIX:-dpf_trial_}"
ASSERT_TABLES="${ASSERT_TABLES:-BacklogItem,Epic,ModelProvider,User}"
LOG_PATH="${LOG_PATH:-${DUMP_PATH}.trial-restore-log.txt}"

[ -n "$DUMP_PATH" ] || fail "DUMP_PATH not set" 2
[ -r "$DUMP_PATH" ] || fail "dump not readable at $DUMP_PATH" 2
command -v docker >/dev/null 2>&1 || fail "docker CLI not available in runner image" 2

# Garbage-collect any stragglers from previous failed runs (>24h old).
# Names match TRIAL_DB_PREFIX*; we drop unconditionally since these DBs are
# ephemeral by design.
log "garbage-collecting orphan trial DBs older than 24h"
ORPHAN_QUERY="SELECT datname FROM pg_database WHERE datname LIKE '${TRIAL_DB_PREFIX}%' AND (pg_stat_file('base/' || oid)).modification < (now() - interval '24 hours');"
ORPHANS="$(docker exec "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d postgres -t -A -c "$ORPHAN_QUERY" 2>/dev/null || true)"
if [ -n "$ORPHANS" ]; then
  echo "$ORPHANS" | while IFS= read -r orphan; do
    [ -n "$orphan" ] || continue
    log "dropping orphan: $orphan"
    docker exec "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d postgres \
      -c "DROP DATABASE IF EXISTS \"$orphan\";" >/dev/null 2>&1 || true
  done
fi

# Build a unique trial-DB name. POSIX-safe (`date +%s` is widely available).
TRIAL_DB="${TRIAL_DB_PREFIX}$(date +%s)_$$"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STARTED_EPOCH="$(date +%s)"
SIZE_BYTES="$(wc -c < "$DUMP_PATH" | tr -d ' ')"

log "starting trial restore trial_db=$TRIAL_DB dump=$DUMP_PATH size=$SIZE_BYTES"

# trap-based cleanup: ALWAYS drop the trial DB on exit, even on assertion
# failure. We track whether cleanup itself succeeded so we can surface
# exit code 6 if cleanup orphans the DB.
CLEANUP_OK=1
cleanup() {
  log "cleaning up trial DB $TRIAL_DB"
  if ! docker exec "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d postgres \
       -c "DROP DATABASE IF EXISTS \"$TRIAL_DB\";" >> "$LOG_PATH" 2>&1; then
    log "WARN: failed to drop $TRIAL_DB; operator may need to clean up manually"
    CLEANUP_OK=0
  fi
}
trap cleanup EXIT

# Initialize the log + write a header.
{
  echo "=== trial restore started $STARTED_AT ==="
  echo "  trial_db=$TRIAL_DB"
  echo "  dump=$DUMP_PATH ($SIZE_BYTES bytes)"
  echo "  assert_tables=$ASSERT_TABLES"
} > "$LOG_PATH"

# Step 1: CREATE DATABASE. Requires CREATEDB privilege on the role.
log "creating trial DB"
if ! docker exec "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d postgres \
     -c "CREATE DATABASE \"$TRIAL_DB\";" >> "$LOG_PATH" 2>&1; then
  fail "CREATE DATABASE failed (does $POSTGRES_USER have CREATEDB privilege?)" 3
fi

# Step 2: pg_restore into the trial DB. No --clean since the DB is fresh.
# --no-owner / --no-privileges keeps role differences from blowing up the
# restore (same flags the operator restore script uses).
log "running pg_restore"
if ! docker exec -i "$DB_CONTAINER" pg_restore \
     --no-owner --no-privileges \
     -U "$POSTGRES_USER" \
     -d "$TRIAL_DB" \
     < "$DUMP_PATH" >> "$LOG_PATH" 2>&1; then
  EXIT=$?
  log "pg_restore exit=$EXIT — tail of log:"
  tail -n 20 "$LOG_PATH" >&2 || true
  fail "pg_restore failed (exit=$EXIT)" 4
fi

# Step 3: row-count assertions on each critical table. We assert > 0 rather
# than comparing to production counts so the check works on fresh installs
# (where production may also be near-empty) and catches the failure mode we
# actually care about: dumps that contain schema but no rows.
log "asserting row counts on: $ASSERT_TABLES"
RESULTS=""
ASSERTION_FAIL=""
IFS=','
for table in $ASSERT_TABLES; do
  COUNT="$(docker exec "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d "$TRIAL_DB" \
           -t -A -c "SELECT count(*) FROM \"$table\";" 2>>"$LOG_PATH" || echo "-1")"
  COUNT="$(echo "$COUNT" | tr -d ' \n\r')"
  RESULTS="${RESULTS}assert_${table}=${COUNT} "
  log "  $table = $COUNT"
  if [ "$COUNT" = "-1" ]; then
    ASSERTION_FAIL="${ASSERTION_FAIL}$table:query-failed "
  elif [ "$COUNT" = "0" ]; then
    ASSERTION_FAIL="${ASSERTION_FAIL}$table:zero-rows "
  fi
done
unset IFS

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FINISHED_EPOCH="$(date +%s)"
DURATION_MS=$(( (FINISHED_EPOCH - STARTED_EPOCH) * 1000 ))

if [ -n "$ASSERTION_FAIL" ]; then
  log "assertion(s) failed: $ASSERTION_FAIL"
  log "RESULT failed ${RESULTS}duration_ms=${DURATION_MS} reason=$ASSERTION_FAIL"
  printf 'RESULT failed %sduration_ms=%s reason=%s\n' "$RESULTS" "$DURATION_MS" "$ASSERTION_FAIL"
  exit 5
fi

log "RESULT ok ${RESULTS}duration_ms=${DURATION_MS}"
printf 'RESULT ok %sduration_ms=%s\n' "$RESULTS" "$DURATION_MS"

# If cleanup fails after we already declared success, exit 6 so the runner
# can warn the operator about the orphan without marking the verification
# itself as failed.
if [ "$CLEANUP_OK" = "0" ]; then
  exit 6
fi
exit 0
