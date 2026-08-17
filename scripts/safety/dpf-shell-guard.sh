#!/bin/sh
# scripts/safety/dpf-shell-guard.sh
#
# DPF runtime kernel-commandment shell guard. Installer symlinks this
# script under names like `docker`, `git`, `prisma` in $DPF_DIR/safety-bin/
# and prepends that dir to PATH. When invoked, it constructs an
# ExecutionAttempt and asks /api/kernel/gate for a verdict.
#
# Spec: docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md
# Plan: docs/superpowers/plans/2026-05-24-runtime-kernel-commandments-slice-1.md
#
# Required runtime deps: jq (mandated by install-dpf.sh preflight), curl.
# Test stub: set DPF_GATE_CMD to a command that emits the desired JSON response.

set -eu

BIN_NAME="$(basename "$0")"
GATE_URL="${DPF_GATE_URL:-http://localhost:3000/api/kernel/gate}"
SESSION_CLASS="${DPF_AUTONOMOUS_SESSION_ID:+autonomous}"
SESSION_CLASS="${SESSION_CLASS:-interactive}"
# Portable script-dir discovery (macOS default readlink lacks -f).
GUARD_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load real-binary paths cached at install time. The installer probes for
# the real `docker` / `git` / `prisma` via `command -v` BEFORE adding the
# safety-bin to PATH and writes the absolute paths here. Sourcing the file
# is more robust than PATH manipulation — works even if PATH changes
# mid-session and avoids recursive exec.
[ -f "$GUARD_DIR/real-binaries.env" ] && . "$GUARD_DIR/real-binaries.env" || true
real_var="DPF_REAL_$(echo "$BIN_NAME" | tr '[:lower:]' '[:upper:]')"
eval "REAL_BIN=\${$real_var:-}"

# The cache above is written once, at install time, and was never revalidated.
# Tools move on upgrade -- Docker Desktop relocated its CLI to a per-user path
# hours after an install on Windows, which broke every `docker` call for the
# account because safety-bin is prepended to PATH. The same class of breakage
# applies here (brew/apt/Docker Desktop upgrades relocate binaries), and the old
# message told the operator to reinstall DPF because their toolchain updated.
#
# Re-resolve from PATH before giving up, then self-heal the cache.
if [ -z "$REAL_BIN" ] || [ ! -x "$REAL_BIN" ]; then
  # Search PATH with our own shim directory removed, so we never resolve to the
  # shim and recurse.
  _clean_path="$(printf '%s' "$PATH" | tr ':' '\n' | grep -vxF "$GUARD_DIR" | paste -sd: -)"
  _resolved="$(PATH="$_clean_path" command -v "$BIN_NAME" 2>/dev/null || true)"

  if [ -n "$_resolved" ] && [ -x "$_resolved" ]; then
    echo "[dpf-shell-guard] cached path for $BIN_NAME was stale; re-resolved to $_resolved" >&2
    REAL_BIN="$_resolved"
    # Best-effort cache repair; never let it block the operator's command.
    if [ -w "$GUARD_DIR" ]; then
      {
        _env_file="$GUARD_DIR/real-binaries.env"
        _tmp="$_env_file.tmp-$$"
        if [ -f "$_env_file" ]; then
          grep -v "^${real_var}=" "$_env_file" > "$_tmp" 2>/dev/null || : > "$_tmp"
        else
          : > "$_tmp"
        fi
        printf '%s=%s\n' "$real_var" "$_resolved" >> "$_tmp"
        mv -f "$_tmp" "$_env_file"
      } 2>/dev/null || echo "[dpf-shell-guard] could not update real-binaries.env (continuing)" >&2
    fi
  fi
fi

if [ -z "$REAL_BIN" ] || [ ! -x "$REAL_BIN" ]; then
  echo "[dpf-shell-guard] cannot find real $BIN_NAME on PATH or at the cached path" >&2
  echo "                  (set $real_var to its full path, or re-run the DPF installer)" >&2
  exit 127
fi

# jq is mandated by install-dpf.sh preflight; use unconditionally for both
# encoding (handles backslash, quotes, control chars, newlines) and decoding.
if ! command -v jq >/dev/null 2>&1; then
  echo "[dpf-shell-guard] jq not found — required dependency. Re-run install-dpf.sh." >&2
  echo "                  Falling through to real $BIN_NAME without gate evaluation." >&2
  exec "$REAL_BIN" "$@"
fi

JSON_ARGS=""
for a in "$@"; do
  esc="$(printf '%s' "$a" | jq -Rs .)"
  JSON_ARGS="${JSON_ARGS:+$JSON_ARGS,}$esc"
done
BODY=$(printf '{"attempt":{"kind":"shell","command":%s,"args":[%s]},"sessionClass":"%s"}' \
  "$(printf '%s' "$BIN_NAME" | jq -Rs .)" "$JSON_ARGS" "$SESSION_CLASS")

# Call the gate (overridable for tests via DPF_GATE_CMD).
if [ -n "${DPF_GATE_CMD:-}" ]; then
  RESP="$(eval "$DPF_GATE_CMD" 2>/dev/null || echo '{"verdict":"_unreachable"}')"
else
  RESP="$(curl -s --max-time 3 -X POST -H 'Content-Type: application/json' \
            -d "$BODY" "$GATE_URL" 2>/dev/null || echo '{"verdict":"_unreachable"}')"
fi

# Extract fields via jq. Bad gate JSON is equivalent to an unreachable gate:
# static fallback still protects destructive patterns, benign commands proceed.
read_field() { printf '%s' "$RESP" | jq -r ".$1 // empty" 2>/dev/null || true; }

fallback_match_rationale() {
  fallback_file="$1"
  cmdline="$2"
  jq -r --arg cmd "$cmdline" '
    [
      .patterns[]
      | select(.kind == "shell")
      | select(.regex as $regex | $cmd | test($regex))
      | .rationale
    ]
    | .[0] // empty
  ' "$fallback_file" 2>/dev/null || true
}
VERDICT="$(read_field verdict)"

case "$VERDICT" in
  allow)
    exec "$REAL_BIN" "$@"
    ;;
  refuse)
    SLUG="$(read_field principleSlug)"
    RAT="$(read_field rationale)"
    echo "[dpf-shell-guard] REFUSED by kernel commandment '$SLUG'" >&2
    echo "                  $RAT" >&2
    echo "                  Operator may bypass via absolute path: $REAL_BIN ..." >&2
    exit 1
    ;;
  require_confirm)
    SLUG="$(read_field principleSlug)"
    RAT="$(read_field rationale)"
    PHRASE="$(read_field requiredPhrase)"
    {
      echo ""
      echo "[dpf-shell-guard] Commandment '$SLUG' requires explicit operator go:"
      echo "                  $RAT"
      echo ""
      echo "  Type EXACTLY (no quotes): $PHRASE"
      printf "  > "
    } >&2
    read -r TYPED || TYPED=""
    if [ "$TYPED" != "$PHRASE" ]; then
      echo "[dpf-shell-guard] phrase mismatch — REFUSED" >&2
      exit 1
    fi

    # Operator confirmed — attempt the pre-destructive snapshot (BI-611C25F3)
    # BEFORE exec'ing the real binary. Per the warn-and-proceed decision:
    #   exit 0 -> snapshot ok, proceed normally
    #   exit 1 -> snapshot failed; loud second-confirm before proceeding
    #   exit 2 -> no strategy registered; warn + proceed (operator confirmed)
    SNAPSHOT_SCRIPT="$GUARD_DIR/pre-destructive-snapshot.sh"
    if [ -x "$SNAPSHOT_SCRIPT" ]; then
      "$SNAPSHOT_SCRIPT" "$BIN_NAME" "$@" >&2
      SNAPSHOT_RC=$?
      case "$SNAPSHOT_RC" in
        0)
          exec "$REAL_BIN" "$@" ;;
        1)
          {
            echo ""
            echo "[dpf-shell-guard] ⚠ PRE-DESTRUCTIVE SNAPSHOT FAILED"
            echo "                  The destructive action will proceed WITHOUT a rollback option."
            echo "                  See \$DPF_BACKUPS_HOST_PATH/pre-destructive/.snapshot.log for details."
            echo ""
            printf "  Type Y to proceed anyway, anything else to cancel: "
          } >&2
          read -r SECOND_CONFIRM || SECOND_CONFIRM=""
          if [ "$SECOND_CONFIRM" = "Y" ]; then
            exec "$REAL_BIN" "$@"
          fi
          echo "[dpf-shell-guard] second-confirm declined — REFUSED" >&2
          exit 1 ;;
        2)
          echo "[dpf-shell-guard] note: no snapshot strategy registered for this command — proceeding without rollback artifact" >&2
          exec "$REAL_BIN" "$@" ;;
        *)
          echo "[dpf-shell-guard] snapshot dispatcher exited unexpectedly ($SNAPSHOT_RC) — REFUSED" >&2
          exit 1 ;;
      esac
    fi
    # No snapshot script present (older installs not yet upgraded). Honor
    # the operator's typed-confirm and proceed.
    exec "$REAL_BIN" "$@"
    ;;
  _unreachable|"")
    # Fail-closed for tier-commandment patterns: load the static fallback,
    # regex-match the command line, refuse if any pattern matches.
    # Non-commandment commands fall through to exec (fail-open).
    FALLBACK="$GUARD_DIR/dpf-shell-guard-fallback-patterns.json"
    CMDLINE="$BIN_NAME $*"
    if [ -f "$FALLBACK" ]; then
      MATCH_RATIONALE="$(fallback_match_rationale "$FALLBACK" "$CMDLINE")"
      if [ -n "$MATCH_RATIONALE" ]; then
        echo "[dpf-shell-guard] gate unreachable AND command matches static fallback — REFUSED" >&2
        echo "                  $MATCH_RATIONALE" >&2
        echo "                  Operator may bypass via absolute path: $REAL_BIN ..." >&2
        exit 1
      fi
    fi
    exec "$REAL_BIN" "$@"
    ;;
  *)
    echo "[dpf-shell-guard] unknown verdict '$VERDICT'; refusing" >&2
    exit 1
    ;;
esac
