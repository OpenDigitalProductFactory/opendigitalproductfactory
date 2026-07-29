#!/bin/sh
# POSIX compatibility entry point. The Node runner is the single source of
# truth for slot identity, database provisioning, scratch cleanup, and exact
# integration evidence on every host.

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec node "$SCRIPT_DIR/local-ci-runner.mjs" "$@"
