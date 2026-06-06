#!/usr/bin/env bash
# scripts/dpf-tooling-upgrade.sh
#
# Operator-triggered "quiesce-for-tooling-upgrade" routine (POSIX). Counterpart
# of dpf-tooling-upgrade.ps1.
#
# Spec: docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-
#       alignment-design.md S4.2 ("Upgrade windows") + decision #2
#       ("Tooling-upgrade authority -> operator-triggered"). Drains active host
#       agent sessions, reaps the orphaned per-session MCP/node sidecars so the
#       host CLIs (Codex, Claude Code) can update, then prints the next steps.
#
# OPERATOR-TRIGGERED ONLY -- there is NO scheduling. Because it terminates the
# operator's interactive CLI sessions, it requires an explicit confirmation
# (or --force) and prints a pre-flight summary first (decision #2:
# never-ask-the-user + destructive-actions-require-explicit-go).
#
# It does NOT touch docker, the portal, or any database -- only the host CLI
# tool processes and their sidecars.
#
# Usage: bash scripts/dpf-tooling-upgrade.sh [--force] [--dry-run]

set -u

FORCE=0
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --force)   FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      cat <<EOF
Usage: bash dpf-tooling-upgrade.sh [--force] [--dry-run]

Operator-triggered quiesce-for-tooling-upgrade: drains host agent sessions and
reaps orphaned sidecars so Claude Code / Codex can update. Operator-triggered
only; no scheduling.

  --force     Skip the interactive confirmation (still prints what it reaps).
  --dry-run   List the processes that WOULD be terminated and exit.
EOF
      exit 0
      ;;
    *) printf '  [WARN] Unknown argument: %s\n' "$1" >&2 ;;
  esac
  shift
done

step() { printf '  [..] %s\n' "$1"; }
ok()   { printf '  [OK] %s\n' "$1"; }
warn() { printf '  [WARN] %s\n' "$1"; }

printf '\n-> DPF tooling-upgrade quiesce (operator-triggered)\n'
printf '   Drains host agent sessions + reaps orphaned sidecars so the host\n'
printf '   CLIs (Codex, Claude Code) can update.\n\n'

# --- 1. Discover host agent surface processes + sidecars ---------------------
#
# Surface CLIs (codex, claude) and their per-session sidecars. node/npx are
# reaped only when their command line references a DPF path, to avoid killing
# unrelated node processes.
SELF_PID=$$
CANDIDATES=""
if command -v ps >/dev/null 2>&1; then
  # pid + full args. Match surface/sidecar binaries OR node/npx referencing DPF.
  CANDIDATES="$(ps -ww -eo pid=,args= 2>/dev/null \
    | grep -E '(^| |/)(codex|claude|app-server|node_repl)( |$)|(^| |/)(node|npx)( .*(/DPF|\.codex|\.claude|dpf-platform))' \
    | grep -vE '(^| )([0-9]+) +.*dpf-tooling-upgrade' \
    | awk '{print $1}' \
    | grep -v "^${SELF_PID}$")"
fi

if [ -z "$CANDIDATES" ]; then
  ok "No active host agent sessions or orphaned sidecars found."
  printf '\n  Tools are already quiesced. You may update Claude Code / Codex now.\n\n'
  exit 0
fi

COUNT="$(printf '%s\n' "$CANDIDATES" | grep -c . )"
step "Found $COUNT process(es) to drain/reap:"
for _pid in $CANDIDATES; do
  _line="$(ps -ww -p "$_pid" -o pid=,comm= 2>/dev/null)"
  [ -n "$_line" ] && printf '    %s\n' "$_line"
done
printf '\n'

if [ "$DRY_RUN" -eq 1 ]; then
  ok "DRY-RUN: no processes terminated."
  exit 0
fi

# --- 2. Confirm (operator-triggered, explicit go) ---------------------------
if [ "$FORCE" -ne 1 ]; then
  warn "This terminates your interactive Claude Code / Codex sessions."
  printf '  Proceed with quiesce-for-upgrade? (y/N) '
  read -r _answer
  case "$_answer" in
    y|Y) ;;
    *) printf '  Aborted; no processes terminated.\n'; exit 0 ;;
  esac
fi

# --- 3. Reap -----------------------------------------------------------------
REAPED=0
for _pid in $CANDIDATES; do
  if kill -TERM "$_pid" 2>/dev/null; then
    REAPED=$((REAPED + 1))
  fi
done
ok "Reaped $REAPED of $COUNT process(es)."

# --- 4. Next steps -----------------------------------------------------------
printf '\n'
printf '================================================================\n'
printf '  Tooling quiesced -- safe to upgrade.\n'
printf '  Next steps:\n'
printf '    1. Update Codex (its app-server/node_repl sidecars are gone now).\n'
printf '    2. Update Claude Code.\n'
printf '    3. Resume: open a session in your worktree and run\n'
printf '       bash scripts/dpf-bootstrap-agent-toolchain.sh to re-converge the\n'
printf '       DPF-scoped client profile + reconnect the DPF MCP.\n'
printf '================================================================\n\n'

exit 0
