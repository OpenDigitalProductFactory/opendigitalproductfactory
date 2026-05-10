#!/usr/bin/env bash
# Shared logging helpers for DPF installer + setup scripts.
# Source this file; do not execute directly.
#
# Provides: ok, warn, fail, step, info — all writing to stderr-aware stdout
# with ANSI color when the terminal supports it (NO_COLOR honored).
#
# Bash 3.2 baseline (macOS default). No associative arrays, no ${var^^}.

# Idempotency guard so multiple sources don't redefine.
if [ "${DPF_LIB_LOGGING_LOADED:-}" = "1" ]; then
  return 0
fi
DPF_LIB_LOGGING_LOADED=1

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  DPF_GREEN='\033[0;32m'
  DPF_YELLOW='\033[1;33m'
  DPF_RED='\033[0;31m'
  DPF_BLUE='\033[0;34m'
  DPF_NC='\033[0m'
else
  DPF_GREEN=''
  DPF_YELLOW=''
  DPF_RED=''
  DPF_BLUE=''
  DPF_NC=''
fi

ok()   { printf '%b  OK %s%b\n'   "$DPF_GREEN"  "$1" "$DPF_NC"; }
warn() { printf '%b  !  %s%b\n'   "$DPF_YELLOW" "$1" "$DPF_NC"; }
info() { printf '%b  -  %s%b\n'   "$DPF_BLUE"   "$1" "$DPF_NC"; }
fail() { printf '%b  X  %s%b\n'   "$DPF_RED"    "$1" "$DPF_NC" >&2; exit 1; }
step() { printf '\n%b-> %s%b\n'   "$DPF_YELLOW" "$1" "$DPF_NC"; }
