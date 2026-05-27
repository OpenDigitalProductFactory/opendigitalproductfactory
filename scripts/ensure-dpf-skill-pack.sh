#!/usr/bin/env bash
# Open Digital Product Factory -- contributor plugin installer (POSIX)
#
# DEPRECATED SHIM (since 2026-05-27, BI-4B17051B Phase 4).
#
# This script is preserved as a backward-compatibility shim for callers that
# invoke `scripts/ensure-dpf-skill-pack.sh` (worktree seed scripts, custom
# operator workflows). The canonical entry point is now:
#
#     scripts/dpf-bootstrap-agent-toolchain.sh
#
# which covers Claude Code AND Codex CLI AND kernel-memory seeding AND a
# functional readiness probe, with idempotent state persistence in
# ~/.dpf/install-state.json.
#
# This shim execs the new script and forwards the repo root. It will be
# removed one release cycle after Phase 4 lands.

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
new_script="$script_dir/dpf-bootstrap-agent-toolchain.sh"

if [ ! -f "$new_script" ]; then
  printf '  [FAIL] dpf-bootstrap-agent-toolchain.sh missing at %s\n' "$new_script" >&2
  exit 1
fi

exec bash "$new_script" "${1:-$PWD}"
