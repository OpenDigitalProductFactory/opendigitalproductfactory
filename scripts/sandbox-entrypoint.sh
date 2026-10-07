#!/bin/sh
set -eu

# The persistent source volume can advance between image recreations. Its
# bootstrap sentinel proves source exists, not that node_modules matches it.
# Converge dependencies before Next imports instrumentation (BI-FFFEA4ED).
workspace=${DPF_SANDBOX_WORKSPACE_ROOT:-/workspace}
while [ ! -f "$workspace/.dpf-version" ]; do
  echo 'Waiting for workspace bootstrap...'
  sleep 5
done
cd "$workspace"
echo '[sandbox-start] Converging dependencies for the current workspace'
# Match the source-volume bootstrap's script policy; generate Prisma explicitly.
# No unfrozen fallback: a source/lockfile mismatch must remain visible.
pnpm install --prefer-offline --frozen-lockfile --config.confirmModulesPurge=false --ignore-scripts
pnpm --filter @dpf/db exec prisma generate --schema prisma/schema
rm -rf apps/web/.next/dev/cache

# BI-B4F07CEB: supervise the dev server instead of exec-ing it. As the
# container's main process, a dev-server crash (it crashes when a workspace
# refresh changes the source under it) ended the container: Docker restarted
# dpf-sandbox-1 and every build's in-flight docker exec died with it. Now a
# crash restarts the server in place; a container stop (TERM/INT) still ends
# both promptly. DPF_SANDBOX_DEV_RESTART_LIMIT bounds restarts (unset: none).
dev_pid=
trap 'trap - TERM INT; [ -z "$dev_pid" ] || kill -TERM "$dev_pid" 2>/dev/null; [ -z "$dev_pid" ] || wait "$dev_pid" 2>/dev/null; exit 143' TERM INT
starts=0
while :; do
  pnpm --filter web dev &
  dev_pid=$!
  status=0
  wait "$dev_pid" || status=$?
  dev_pid=
  starts=$((starts + 1))
  if [ -n "${DPF_SANDBOX_DEV_RESTART_LIMIT:-}" ] && [ "$starts" -ge "$DPF_SANDBOX_DEV_RESTART_LIMIT" ]; then
    exit "$status"
  fi
  echo "[sandbox-start] dev server exited ($status); restarting" >&2
  rm -rf apps/web/.next/dev/cache
  sleep "${DPF_SANDBOX_DEV_RESTART_DELAY:-2}"
done
