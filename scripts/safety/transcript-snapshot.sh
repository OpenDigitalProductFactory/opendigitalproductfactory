#!/bin/sh
# scripts/safety/transcript-snapshot.sh
#
# POSIX counterpart of transcript-snapshot.ps1 — out-of-band Claude Code
# transcript snapshot.
#
# BI:   BI-C8655C8C (EP-DR-HARDENING-2026-05-23)
# Lessons: 2026-05-23 incident lost the entire forensic trail.
#
# Invoked by Claude Code hooks (.claude/settings.json). Receives a JSON
# payload on stdin:
#   { "session_id": "...", "transcript_path": "...",
#     "tool_name": "...", "hook_event_name": "PostToolUse"|"SessionEnd" }
#
# Requires: jq (mandated by the install-dpf.sh preflight added for the
# kernel-commandment shell guard — same dependency).
#
# Exit 0 ALWAYS — a snapshot failure must never block the user's tool call.

set -u

# Read payload from stdin.
PAYLOAD="$(cat || true)"
[ -n "$PAYLOAD" ] || exit 0

# jq required; absent jq = silent skip (don't break Claude Code).
command -v jq >/dev/null 2>&1 || exit 0

SESSION_ID="$(printf '%s' "$PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null)"
TRANSCRIPT_PATH="$(printf '%s' "$PAYLOAD" | jq -r '.transcript_path // empty' 2>/dev/null)"
TOOL_NAME="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty' 2>/dev/null)"
HOOK_EVENT="$(printf '%s' "$PAYLOAD" | jq -r '.hook_event_name // empty' 2>/dev/null)"

[ -n "$SESSION_ID" ] || exit 0
[ -n "$TRANSCRIPT_PATH" ] || exit 0
[ -f "$TRANSCRIPT_PATH" ] || exit 0

# ─── Resolve install root + $DPF_BACKUPS_HOST_PATH ──────────────────────────

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

# ─── Skip read-only tools on PostToolUse ─────────────────────────────────────

case "$HOOK_EVENT" in
    PostToolUse)
        case "$TOOL_NAME" in
            Read|Glob|Grep|WebFetch|WebSearch|TodoWrite|TaskList|TaskGet)
                exit 0 ;;
        esac ;;
esac

# ─── Snapshot destination + throttle state ──────────────────────────────────

DATE_DIR="$(date -u +%Y-%m-%d)"
SNAPSHOT_ROOT="$BACKUPS_HOST_PATH/session-transcripts"
SNAPSHOT_DAY="$SNAPSHOT_ROOT/$DATE_DIR"
SNAPSHOT_FILE="$SNAPSHOT_DAY/$SESSION_ID.jsonl"
STATE_DIR="${HOME}/.claude/hook-state"
STATE_FILE="$STATE_DIR/$SESSION_ID.last-snapshot"
LOG_FILE="$SNAPSHOT_ROOT/.snapshot.log"

THROTTLE_SECONDS=120

# Throttle: skip when last snapshot was <$THROTTLE_SECONDS ago. SessionEnd
# always honored.
if [ "$HOOK_EVENT" = "PostToolUse" ] && [ -f "$STATE_FILE" ]; then
    LAST_EPOCH="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
    NOW_EPOCH="$(date +%s)"
    if [ "$LAST_EPOCH" -gt 0 ] 2>/dev/null && [ $((NOW_EPOCH - LAST_EPOCH)) -lt "$THROTTLE_SECONDS" ]; then
        exit 0
    fi
fi

# ─── Snapshot ────────────────────────────────────────────────────────────────

mkdir -p "$SNAPSHOT_DAY" "$STATE_DIR" 2>/dev/null
if cp -f "$TRANSCRIPT_PATH" "$SNAPSHOT_FILE" 2>/dev/null; then
    date +%s > "$STATE_FILE"
    SIZE_BYTES="$(wc -c < "$SNAPSHOT_FILE" | tr -d ' ')"
    TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
    LOG_LINE="$(jq -c -n \
        --arg ts "$TIMESTAMP" \
        --arg sid "$SESSION_ID" \
        --arg he "$HOOK_EVENT" \
        --arg tn "$TOOL_NAME" \
        --arg sp "$SNAPSHOT_FILE" \
        --argjson sz "$SIZE_BYTES" \
        --arg ir "$INSTALL_ROOT" \
        --arg br "$BACKUPS_HOST_PATH" \
        '{timestamp:$ts,session_id:$sid,hook_event:$he,tool_name:$tn,snapshot_path:$sp,size_bytes:$sz,install_root:$ir,backups_root:$br}' \
        2>/dev/null)"
    [ -n "$LOG_LINE" ] && printf '%s\n' "$LOG_LINE" >> "$LOG_FILE" 2>/dev/null
else
    # Snapshot failed — write a single error line. Never block.
    TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
    printf '{"timestamp":"%s","session_id":"%s","error":"snapshot copy failed"}\n' \
        "$TIMESTAMP" "$SESSION_ID" >> "$LOG_FILE" 2>/dev/null || true
fi

# ─── Retention pruning (best-effort) ────────────────────────────────────────

RETENTION_DAYS=30
if [ -d "$SNAPSHOT_ROOT" ]; then
    find "$SNAPSHOT_ROOT" -maxdepth 1 -type d -name '????-??-??' -mtime "+$RETENTION_DAYS" \
        -exec rm -rf {} + 2>/dev/null || true
fi

exit 0
