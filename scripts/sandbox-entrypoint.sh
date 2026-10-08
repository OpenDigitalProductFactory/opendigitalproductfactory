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

# The sandbox's own Auth.js secret (BI-F1C680C7). Compose must never hand this
# container the portal's AUTH_SECRET: agent CLIs run here unprompted through
# `docker exec`, which inherits the container environment, and the portal's
# secret signs its sessions and MCP tokens. The sandbox app runs against its
# own database, so it needs a secret of its own, not the portal's. It lives on
# the workspace volume (stable across restarts and image recreations, so
# sandbox preview sessions survive), root-only, and reaches the dev server
# through the final exec alone, never an export. Its value is never printed:
# xtrace is off from here on and the value is never held in a shell variable.
set +x
secret_file="$workspace/.dpf-sandbox-auth-secret"
# Keep the file out of every git flow over the workspace, including a workspace
# whose tracked .gitignore predates the rule (the repo .gitignore carries it too).
if [ -d "$workspace/.git" ]; then
  exclude_file="$workspace/.git/info/exclude"
  if ! { mkdir -p "$workspace/.git/info" && touch "$exclude_file" && { grep -qxF '.dpf-sandbox-auth-secret' "$exclude_file" || echo '.dpf-sandbox-auth-secret' >> "$exclude_file"; }; } 2>/dev/null; then
    echo '[sandbox-start] WARN could not add .dpf-sandbox-auth-secret to .git/info/exclude; .gitignore still covers it' >&2
  fi
fi
if ! [ -f "$secret_file" ] || ! grep -Eqx '[0-9a-f]{64}' "$secret_file" 2>/dev/null; then
  if ! [ -w "$workspace" ]; then
    echo "[sandbox-start] ERROR cannot create the sandbox auth secret: $workspace is not writable (BI-F1C680C7)" >&2
    exit 14
  fi
  echo '[sandbox-start] Generating the sandbox-only auth secret'
  secret_tmp=$(umask 077 && mktemp "$workspace/.dpf-sandbox-auth-secret.XXXXXX") || {
    echo "[sandbox-start] ERROR cannot create the sandbox auth secret in $workspace (BI-F1C680C7)" >&2
    exit 14
  }
  if ! { head -c 32 /dev/urandom | od -An -v -tx1 | tr -d ' \n' > "$secret_tmp" && chmod 600 "$secret_tmp" && grep -Eqx '[0-9a-f]{64}' "$secret_tmp" && mv -f "$secret_tmp" "$secret_file"; }; then
    rm -f "$secret_tmp"
    echo "[sandbox-start] ERROR failed to write the sandbox auth secret in $workspace (BI-F1C680C7)" >&2
    exit 14
  fi
fi

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
  # `env` scopes the sandbox's own secret (BI-F1C680C7) to the dev server in
  # every POSIX shell, including the image's busybox ash; nothing else in this
  # script or any `docker exec` session inherits it. Re-read on each restart.
  env AUTH_SECRET="$(cat "$secret_file")" pnpm --filter web dev &
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
