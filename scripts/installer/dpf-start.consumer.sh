#!/usr/bin/env bash
# DPF autostart entrypoint for macOS and Linux (BI-084F85E5). Twin of
# dpf-start.consumer.ps1.
#
# The autostart unit runs ~/.dpf/dpf-autostart.sh, which lives outside the
# install directory, so a self-upgrade cannot change it. That launch script
# only points here, and this file ships as a verified release asset, so each
# self-upgrade replaces it in the install directory.
#
# Usage:
#   dpf-start.consumer.sh <install-dir> <install-state.json> [compose args...]
#   dpf-start.consumer.sh <install-dir> <install-state.json> --converge-only
#
# Brings the stack up on the compose chain the launch script recorded, waits
# for the portal, then converges the host side (the native host-upkeep agent at
# this release's version). Host convergence never fails startup and never
# reboots the host. Bash 3.2 baseline (macOS default).

set -euo pipefail

install_dir="${1:?install dir required}"
state_path="${2:?install-state path required}"
shift 2
cd "$install_dir"

host_platform="linux"
[ "$(uname -s 2>/dev/null)" = "Darwin" ] && host_platform="macos"

if [ "${1:-}" != "--converge-only" ]; then
  projection="$(node scripts/lib/resolve-capability-compose-profiles.mjs --state "$state_path" --host "$host_platform" --migrate --write)"
  COMPOSE_PROFILES="$(printf '%s' "$projection" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).composeProfiles.join(",")))')"
  export COMPOSE_PROFILES
  docker compose "$@" up -d
fi

healthy=0
attempt=0
max_attempts="${DPF_HEALTH_WAIT_ATTEMPTS:-60}"
while [ "$attempt" -lt "$max_attempts" ]; do
  if curl --silent --fail --max-time 3 http://localhost:3000/api/health >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 5
  attempt=$((attempt + 1))
done

if [ "$healthy" = "1" ] && [ -f scripts/installer/lib/host-convergence.sh ]; then
  # The edge choice the installer recorded: full role with edge, else host upkeep.
  edge_enabled="${DPF_INCLUDE_EDGE:-}"
  if [ -z "$edge_enabled" ] && [ -f "$state_path" ]; then
    edge_enabled="$(node -e 'try{const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").replace(/^﻿/,""));process.stdout.write(s.edge&&s.edge.enabled===true?"1":"0")}catch{process.stdout.write("0")}' "$state_path" 2>/dev/null || echo 0)"
  fi
  role="host-upkeep"
  [ "$edge_enabled" = "1" ] && role="full"
  # shellcheck source=lib/host-convergence.sh
  . scripts/installer/lib/host-convergence.sh
  result="$(dpf_host_converge "$install_dir" "$role" || echo failed)"
  printf 'Host convergence: %s\n' "$result"
fi
exit 0
