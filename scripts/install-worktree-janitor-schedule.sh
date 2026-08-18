#!/usr/bin/env bash
# BI-E5C1ED0A — Register the worktree janitor as a scheduled task.
#
# The janitor itself (scripts/worktree-janitor.mjs, BI-AD949172) is complete and
# well tested. What was missing is a trigger: nothing ever ran it on a schedule,
# so worktree sprawl kept recurring and kept being re-treated by hand. This
# script is that trigger, and nothing else — it does not change janitor policy.
#
# USAGE
#   bash scripts/install-worktree-janitor-schedule.sh [--live] [--tier-a-only]
#                                                     [--grace-days N] [--hour H]
#   bash scripts/install-worktree-janitor-schedule.sh --uninstall
#   bash scripts/install-worktree-janitor-schedule.sh --status
#
# FLAGS
#   --live          Schedule a REAPING run. Omitted (default) schedules a
#                   dry-run that only reports. Reaping stays opt-in, matching
#                   the janitor's own dry-run default and the explicit-go rule
#                   in the dpf-worktree-hygiene skill.
#   --tier-a-only   With --live, reap only Tier A (merged + clean). Strongly
#                   recommended for anything unattended.
#   --grace-days N  Stale threshold passed through to the janitor (default 14).
#   --hour H        Local hour to run, 0-23 (default 3).
#   --uninstall     Remove the scheduled task. Leaves the janitor itself alone.
#   --status        Print whether the task is registered, and its next run.
#
# PLATFORMS
#   macOS    launchd user agent   local.dpf.worktree-janitor
#   Linux    systemd user timer   dpf-worktree-janitor.timer
#   Windows  Scheduled Task       DPF Worktree Janitor   (run from Git Bash;
#            registers via schtasks against pwsh/powershell)
#
# Re-running is idempotent: the task is replaced, not duplicated.

set -euo pipefail

LABEL="local.dpf.worktree-janitor"
TASK_NAME="DPF Worktree Janitor"
UNIT="dpf-worktree-janitor"

# Resolve the ROOT CLONE, not whatever tree we happen to be standing in. The
# janitor manages the root clone's worktrees, so scheduling it against a linked
# worktree would point it at the wrong tree (and that worktree may itself be
# reaped later). --git-common-dir is shared by every linked worktree and always
# resolves to the root clone's .git, so its parent is the root clone.
GIT_COMMON_DIR=$(git rev-parse --path-format=absolute --git-common-dir)
REPO_ROOT=$(dirname "$GIT_COMMON_DIR")
ENTRY="$REPO_ROOT/scripts/worktree-janitor.mjs"

MODE="install"
LIVE=0
TIER_A_ONLY=0
GRACE_DAYS=14
HOUR=3

while [ $# -gt 0 ]; do
  case "$1" in
    --live) LIVE=1 ;;
    --tier-a-only) TIER_A_ONLY=1 ;;
    --grace-days) GRACE_DAYS="${2:?--grace-days needs a value}"; shift ;;
    --hour) HOUR="${2:?--hour needs a value}"; shift ;;
    --uninstall) MODE="uninstall" ;;
    --status) MODE="status" ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

case "$GRACE_DAYS" in ''|*[!0-9]*) echo "--grace-days must be a positive integer" >&2; exit 2 ;; esac
case "$HOUR" in ''|*[!0-9]*) echo "--hour must be 0-23" >&2; exit 2 ;; esac
[ "$HOUR" -ge 0 ] && [ "$HOUR" -le 23 ] || { echo "--hour must be 0-23" >&2; exit 2; }

if [ "$MODE" = "install" ] && [ ! -f "$ENTRY" ]; then
  echo "janitor entry point not found: $ENTRY" >&2
  exit 1
fi

# Build the janitor argument list. Dry-run is the default and is passed
# explicitly so the scheduled command is self-describing in logs and plists.
JANITOR_ARGS="--root $REPO_ROOT --grace-days $GRACE_DAYS"
if [ "$LIVE" = "1" ]; then
  JANITOR_ARGS="$JANITOR_ARGS --live"
  [ "$TIER_A_ONLY" = "1" ] && JANITOR_ARGS="$JANITOR_ARGS --tier-a-only"
else
  JANITOR_ARGS="$JANITOR_ARGS --dry-run"
fi

NODE_BIN=$(command -v node || true)
[ -n "$NODE_BIN" ] || { [ "$MODE" = "install" ] && { echo "node not found on PATH" >&2; exit 1; }; }

# Logs go in the shared git dir: it exists for every checkout, is already
# ignored, and survives the root clone changing branches.
LOG_OUT="$GIT_COMMON_DIR/worktree-janitor.schedule.out"
LOG_ERR="$GIT_COMMON_DIR/worktree-janitor.schedule.err"

warn_live() {
  if [ "$LIVE" = "1" ] && [ "$TIER_A_ONLY" != "1" ]; then
    echo ""
    echo "WARNING: scheduling an unattended LIVE reap that is not --tier-a-only."
    echo "         Tier B (stale-but-unmerged) worktrees become removable. If that"
    echo "         is not what you meant, re-run with --tier-a-only."
  fi
}

os=$(uname -s 2>/dev/null || echo unknown)
case "$os" in
  Darwin) PLATFORM=macos ;;
  Linux)  PLATFORM=linux ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM=windows ;;
  *) PLATFORM=unknown ;;
esac

# ── macOS ────────────────────────────────────────────────────────────────────
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

macos_install() {
  mkdir -p "$(dirname "$PLIST")"
  {
    printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>'
    printf '%s\n' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    printf '%s\n' '<plist version="1.0">'
    printf '%s\n' '<dict>'
    printf '  <key>Label</key><string>%s</string>\n' "$LABEL"
    printf '%s\n' '  <key>ProgramArguments</key>'
    printf '%s\n' '  <array>'
    printf '    <string>%s</string>\n' "$NODE_BIN"
    printf '    <string>%s</string>\n' "$ENTRY"
    for a in $JANITOR_ARGS; do printf '    <string>%s</string>\n' "$a"; done
    printf '%s\n' '  </array>'
    printf '%s\n' '  <key>StartCalendarInterval</key>'
    printf '  <dict><key>Hour</key><integer>%s</integer><key>Minute</key><integer>0</integer></dict>\n' "$HOUR"
    printf '  <key>StandardOutPath</key><string>%s</string>\n' "$LOG_OUT"
    printf '  <key>StandardErrorPath</key><string>%s</string>\n' "$LOG_ERR"
    printf '%s\n' '  <key>RunAtLoad</key><false/>'
    printf '%s\n' '</dict>'
    printf '%s\n' '</plist>'
  } >"$PLIST"

  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null \
    || { launchctl unload "$PLIST" >/dev/null 2>&1 || true; launchctl load "$PLIST"; }
  echo "Installed launchd agent: $PLIST"
  echo "  runs daily at ${HOUR}:00 — node worktree-janitor.mjs $JANITOR_ARGS"
  echo "  logs: $LOG_OUT"
}

macos_uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 \
    || launchctl unload "$PLIST" >/dev/null 2>&1 || true
  [ -f "$PLIST" ] && rm -f "$PLIST" && echo "Removed $PLIST" || echo "No launchd agent installed."
}

macos_status() {
  if launchctl list 2>/dev/null | grep -q "$LABEL"; then
    echo "registered: launchd agent $LABEL"
    [ -f "$PLIST" ] && grep -o '<string>--[a-z-]*</string>' "$PLIST" | sed 's/<[^>]*>//g' | tr '\n' ' ' && echo ""
  else
    echo "not registered (macOS launchd)"
  fi
}

# ── Linux ────────────────────────────────────────────────────────────────────
SYSTEMD_DIR="$HOME/.config/systemd/user"

linux_install() {
  mkdir -p "$SYSTEMD_DIR"
  cat >"$SYSTEMD_DIR/$UNIT.service" <<EOF
[Unit]
Description=DPF worktree janitor (BI-E5C1ED0A)

[Service]
Type=oneshot
ExecStart=$NODE_BIN $ENTRY $JANITOR_ARGS
StandardOutput=append:$LOG_OUT
StandardError=append:$LOG_ERR
EOF
  cat >"$SYSTEMD_DIR/$UNIT.timer" <<EOF
[Unit]
Description=Run the DPF worktree janitor daily

[Timer]
OnCalendar=*-*-* $(printf '%02d' "$HOUR"):00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT.timer"
  echo "Installed systemd user timer: $UNIT.timer"
  echo "  runs daily at ${HOUR}:00 — node worktree-janitor.mjs $JANITOR_ARGS"
}

linux_uninstall() {
  systemctl --user disable --now "$UNIT.timer" >/dev/null 2>&1 || true
  rm -f "$SYSTEMD_DIR/$UNIT.timer" "$SYSTEMD_DIR/$UNIT.service"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  echo "Removed systemd user timer: $UNIT.timer"
}

linux_status() {
  if systemctl --user is-enabled "$UNIT.timer" >/dev/null 2>&1; then
    echo "registered: systemd user timer $UNIT.timer"
    systemctl --user list-timers "$UNIT.timer" --no-pager 2>/dev/null | sed -n '2p'
  else
    echo "not registered (systemd user timer)"
  fi
}

# ── Windows ──────────────────────────────────────────────────────────────────
windows_install() {
  local win_root win_entry shell_bin
  win_root=$(cygpath -w "$REPO_ROOT" 2>/dev/null || echo "$REPO_ROOT")
  win_entry=$(cygpath -w "$ENTRY" 2>/dev/null || echo "$ENTRY")
  shell_bin=$(command -v pwsh || command -v powershell || true)
  [ -n "$shell_bin" ] || { echo "pwsh/powershell not found on PATH" >&2; exit 1; }
  # schtasks replaces an existing task with /F, so re-running stays idempotent.
  schtasks //Create //F //TN "$TASK_NAME" //SC DAILY //ST "$(printf '%02d' "$HOUR"):00" \
    //TR "node \"$win_entry\" ${JANITOR_ARGS//$REPO_ROOT/$win_root}" >/dev/null
  echo "Installed Windows Scheduled Task: $TASK_NAME"
  echo "  runs daily at ${HOUR}:00 — node worktree-janitor.mjs $JANITOR_ARGS"
}

windows_uninstall() {
  schtasks //Delete //F //TN "$TASK_NAME" >/dev/null 2>&1 \
    && echo "Removed Windows Scheduled Task: $TASK_NAME" \
    || echo "No Windows Scheduled Task installed."
}

windows_status() {
  if schtasks //Query //TN "$TASK_NAME" >/dev/null 2>&1; then
    echo "registered: Windows Scheduled Task $TASK_NAME"
    schtasks //Query //TN "$TASK_NAME" //FO LIST 2>/dev/null | grep -iE 'next run|task to run' || true
  else
    echo "not registered (Windows Scheduled Task)"
  fi
}

case "$PLATFORM:$MODE" in
  macos:install)     warn_live; macos_install ;;
  macos:uninstall)   macos_uninstall ;;
  macos:status)      macos_status ;;
  linux:install)     warn_live; linux_install ;;
  linux:uninstall)   linux_uninstall ;;
  linux:status)      linux_status ;;
  windows:install)   warn_live; windows_install ;;
  windows:uninstall) windows_uninstall ;;
  windows:status)    windows_status ;;
  *) echo "unsupported platform: $os (expected Darwin, Linux, or Git Bash on Windows)" >&2; exit 1 ;;
esac
