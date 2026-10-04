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
exec pnpm --filter web dev
