#!/bin/sh
# scripts/safety/pre-destructive-snapshot.sh
#
# Dispatcher for the pre-destructive snapshot mechanism (BI-611C25F3).
#
# Invoked by dpf-shell-guard.sh AFTER the operator typed-confirms a
# destructive command, BEFORE the real binary is exec'd. We route by
# command shape to the matching snapshot strategy (pg_dump / neo4j-admin
# dump / git stash / etc.), write the snapshot to
# $DPF_BACKUPS_HOST_PATH/pre-destructive/<YYYY-MM-DD>/<fingerprint>-<ts>.<ext>,
# and log a structured trace line.
#
# BI:   BI-611C25F3 (EP-DR-HARDENING-2026-05-23)
# Spec: docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md
#
# Exit codes (consumed by dpf-shell-guard.sh):
#   0 = snapshot succeeded (proceed normally)
#   1 = snapshot failed (caller prompts operator for second confirm)
#   2 = no snapshot strategy registered for this command (caller warn+proceed)

set -u

usage() {
    cat >&2 <<USAGE
Usage: pre-destructive-snapshot.sh <bin-name> [args...]

Routes by command shape and writes a snapshot of the affected resource
before the destructive action runs. See BI-611C25F3.
USAGE
}

if [ $# -lt 1 ]; then
    usage
    exit 2
fi

BIN_NAME="$1"
shift
CMDLINE="$BIN_NAME $*"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BACKUPS_HOST_PATH=""
if [ -n "${DPF_BACKUPS_HOST_PATH:-}" ]; then
    BACKUPS_HOST_PATH="$DPF_BACKUPS_HOST_PATH"
elif [ -f "$INSTALL_ROOT/.env" ]; then
    BACKUPS_HOST_PATH="$(sed -n 's/^DPF_BACKUPS_HOST_PATH=\(.*\)/\1/p' "$INSTALL_ROOT/.env" 2>/dev/null | head -1)"
fi
if [ -z "$BACKUPS_HOST_PATH" ]; then
    BACKUPS_HOST_PATH="${INSTALL_ROOT}-backups"
fi

POSTGRES_CONTAINER="${DPF_PRODUCTION_DB_CONTAINER:-dpf-postgres-1}"
POSTGRES_USER="${POSTGRES_USER:-dpf}"
POSTGRES_DB="${POSTGRES_DB:-dpf}"
NEO4J_CONTAINER="${DPF_NEO4J_CONTAINER:-dpf-neo4j-1}"
NEO4J_DATABASE="${DPF_NEO4J_DATABASE:-neo4j}"

DATE_DIR="$(date -u +%Y-%m-%d)"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT_ROOT="$BACKUPS_HOST_PATH/pre-destructive"
SNAPSHOT_DAY="$SNAPSHOT_ROOT/$DATE_DIR"
LOG_FILE="$SNAPSHOT_ROOT/.snapshot.log"

mkdir -p "$SNAPSHOT_DAY" 2>/dev/null

write_audit() {
    OUTCOME="$1"
    STRATEGY="$2"
    SNAPSHOT_PATH="$3"
    REASON="$4"
    if ! command -v jq >/dev/null 2>&1; then
        printf '%s pre-destructive-snapshot %s strategy=%s path=%s reason=%s cmd=%s\n' \
            "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$OUTCOME" "$STRATEGY" \
            "$SNAPSHOT_PATH" "$REASON" "$CMDLINE" >> "$LOG_FILE" 2>/dev/null || true
        return
    fi
    LOG_LINE="$(jq -c -n \
        --arg ts "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
        --arg outcome "$OUTCOME" \
        --arg strategy "$STRATEGY" \
        --arg path "$SNAPSHOT_PATH" \
        --arg reason "$REASON" \
        --arg cmd "$CMDLINE" \
        --arg install_root "$INSTALL_ROOT" \
        '{timestamp:$ts,event:"pre-destructive-snapshot",outcome:$outcome,strategy:$strategy,snapshot_path:$path,reason:$reason,cmd:$cmd,install_root:$install_root}' \
        2>/dev/null)"
    if [ -n "$LOG_LINE" ]; then
        printf '[pre-destructive-snapshot-trace] %s\n' "$LOG_LINE" >> "$LOG_FILE" 2>/dev/null || true
    fi
}

trace() {
    printf '[pre-destructive-snapshot-trace] %s\n' "$*" >&2
}

snapshot_pg_dump() {
    FINGERPRINT="$1"
    SNAPSHOT_PATH="$SNAPSHOT_DAY/${FINGERPRINT}-${TS}.dump"
    trace "strategy=pg_dump container=$POSTGRES_CONTAINER db=$POSTGRES_DB target=$SNAPSHOT_PATH"
    if ! command -v docker >/dev/null 2>&1; then
        write_audit "FAILED" "pg_dump" "$SNAPSHOT_PATH" "docker CLI not available"
        return 1
    fi
    if docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" \
         > "$SNAPSHOT_PATH" 2>>"$LOG_FILE.err"; then
        SIZE="$(wc -c < "$SNAPSHOT_PATH" 2>/dev/null | tr -d ' ')"
        if [ -n "$SIZE" ] && [ "$SIZE" -lt 100 ]; then
            write_audit "FAILED" "pg_dump" "$SNAPSHOT_PATH" "dump file too small ($SIZE bytes) — likely truncated"
            return 1
        fi
        write_audit "OK" "pg_dump" "$SNAPSHOT_PATH" "size=${SIZE:-unknown}"
        return 0
    fi
    write_audit "FAILED" "pg_dump" "$SNAPSHOT_PATH" "pg_dump exit non-zero (see ${LOG_FILE}.err tail)"
    return 1
}

snapshot_neo4j() {
    FINGERPRINT="$1"
    SNAPSHOT_PATH="$SNAPSHOT_DAY/${FINGERPRINT}-${TS}.neo4j.dump"
    trace "strategy=neo4j container=$NEO4J_CONTAINER db=$NEO4J_DATABASE target=$SNAPSHOT_PATH"
    # neo4j-admin database dump requires Neo4j stopped. Since the destructive
    # command we're snapshotting is itself about to take it offline, stopping
    # it just to snapshot is wasted complexity. Defer to the most recent
    # successful nightly Neo4j backup as the recovery artifact.
    if [ -d "$BACKUPS_HOST_PATH/neo4j" ]; then
        LATEST_NEO4J_BACKUP="$(ls -1dt "$BACKUPS_HOST_PATH"/neo4j/*/ 2>/dev/null | head -1)"
        if [ -n "$LATEST_NEO4J_BACKUP" ]; then
            write_audit "DEFERRED" "neo4j" "$LATEST_NEO4J_BACKUP" "deferred to nightly Neo4j backup (online dump would require stopping the DB)"
            return 0
        fi
    fi
    write_audit "FAILED" "neo4j" "$SNAPSHOT_PATH" "no nightly Neo4j backup found to defer to"
    return 1
}

snapshot_git_stash() {
    FINGERPRINT="$1"
    REPO="${PWD:-$INSTALL_ROOT}"
    if ! command -v git >/dev/null 2>&1; then
        write_audit "FAILED" "git-stash" "$REPO" "git CLI not available"
        return 1
    fi
    if [ -z "$(git -C "$REPO" status --porcelain 2>/dev/null)" ]; then
        write_audit "OK" "git-stash" "$REPO" "tree already clean; nothing to stash"
        return 0
    fi
    STASH_MSG="pre-destructive-snapshot $TS $FINGERPRINT"
    if git -C "$REPO" stash push -u -m "$STASH_MSG" >/dev/null 2>&1; then
        STASH_REF="$(git -C "$REPO" stash list 2>/dev/null | head -1 | cut -d: -f1)"
        write_audit "OK" "git-stash" "$REPO" "stashed as $STASH_REF ($STASH_MSG)"
        return 0
    fi
    write_audit "FAILED" "git-stash" "$REPO" "git stash push failed"
    return 1
}

snapshot_fs_essentials() {
    FINGERPRINT="$1"
    SNAPSHOT_PATH="$SNAPSHOT_DAY/${FINGERPRINT}-${TS}.essentials.tar.gz"
    trace "strategy=fs-essentials target=$SNAPSHOT_PATH"
    if ! command -v tar >/dev/null 2>&1; then
        write_audit "FAILED" "fs-essentials" "$SNAPSHOT_PATH" "tar CLI not available"
        return 1
    fi
    PATHS_TO_TAR=""
    for cand in .env .claude/settings.local.json .selected-model .host-profile.json; do
        if [ -e "$INSTALL_ROOT/$cand" ]; then
            PATHS_TO_TAR="$PATHS_TO_TAR $cand"
        fi
    done
    if [ -z "$PATHS_TO_TAR" ]; then
        write_audit "OK" "fs-essentials" "$SNAPSHOT_PATH" "no operator-private artifacts to capture"
        return 0
    fi
    # shellcheck disable=SC2086  # intentional word-split of PATHS_TO_TAR
    if tar -C "$INSTALL_ROOT" -czf "$SNAPSHOT_PATH" $PATHS_TO_TAR 2>>"$LOG_FILE.err"; then
        SIZE="$(wc -c < "$SNAPSHOT_PATH" 2>/dev/null | tr -d ' ')"
        write_audit "OK" "fs-essentials" "$SNAPSHOT_PATH" "size=${SIZE:-unknown} paths=$PATHS_TO_TAR"
        return 0
    fi
    write_audit "FAILED" "fs-essentials" "$SNAPSHOT_PATH" "tar exit non-zero"
    return 1
}

route_and_snapshot() {
    case "$CMDLINE" in
        "docker volume rm "*"dpf_pgdata"*)
            snapshot_pg_dump "docker-volume-rm-pgdata"
            return $? ;;
        "docker volume rm "*"dpf_neo4jdata"*)
            snapshot_neo4j "docker-volume-rm-neo4jdata"
            return $? ;;
        "docker volume rm "*)
            snapshot_pg_dump "docker-volume-rm-other"
            return $? ;;
        "docker compose down "*"-v"*)
            PG_RC=0
            snapshot_pg_dump "docker-compose-down-v" || PG_RC=$?
            NEO_RC=0
            snapshot_neo4j "docker-compose-down-v" || NEO_RC=$?
            if [ "$PG_RC" -ne 0 ] && [ "$NEO_RC" -ne 0 ]; then
                return 1
            fi
            return 0 ;;
        "prisma migrate reset"*|"pnpm "*"prisma migrate reset"*)
            snapshot_pg_dump "prisma-migrate-reset"
            return $? ;;
        "git reset --hard"*)
            snapshot_git_stash "git-reset-hard"
            return $? ;;
        "Remove-Item "*"-Recurse"*)
            snapshot_fs_essentials "remove-item-recurse"
            return $? ;;
        *)
            write_audit "NO_STRATEGY" "(none)" "" "no snapshot strategy registered for command shape"
            return 2 ;;
    esac
}

RETENTION_DAYS=90
if [ -d "$SNAPSHOT_ROOT" ]; then
    find "$SNAPSHOT_ROOT" -maxdepth 1 -type d -name '????-??-??' -mtime "+$RETENTION_DAYS" \
        -exec rm -rf {} + 2>/dev/null || true
fi

route_and_snapshot
EXIT_CODE=$?

trace "exit=$EXIT_CODE"
exit "$EXIT_CODE"
