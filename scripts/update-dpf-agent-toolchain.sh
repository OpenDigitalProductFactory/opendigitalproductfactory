#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

exec bash "$REPO_ROOT/packages/dpf-skill-pack/scripts/update-agent-toolchain.sh" "$@"
