#!/bin/sh
# BI-0DF1F354 — image-baked entrypoint for the Dockerfile `dev` stage.
# Preflight is COPYed to /usr/local/bin so it still runs when the bind-mounted
# worktree is deleted/empty (the failure mode that previously crash-looped).
set -eu

PREFLIGHT="${DEV_PORTAL_PREFLIGHT_BIN:-/usr/local/bin/dev-portal-workspace-preflight.mjs}"

if ! node "$PREFLIGHT"; then
  # Preflight printed diagnosis and exited non-zero. Exit 0 so Docker
  # restart:on-failure does not thrash (planDevPortalBoot stop-clean).
  exit 0
fi

exec sh -c 'pnpm install && pnpm --filter @dpf/db exec prisma generate && pnpm --filter web dev'
