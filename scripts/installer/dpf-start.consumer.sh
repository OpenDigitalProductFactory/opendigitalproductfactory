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

# launchd (and a systemd user unit) starts this with a minimal PATH such as
# /usr/bin:/bin:/usr/sbin:/sbin. Homebrew's node and Docker Desktop's CLI live
# outside it, so on 2026-11-09 every sign-in start died here with "node: command
# not found" and the platform stayed down until someone started it by hand
# (BI-3E2F87FA). Add the usual tool directories that exist, after what is set.
host_tool_dirs="${DPF_HOST_TOOL_DIRS:-/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:${HOME:-/nonexistent}/.docker/bin}"
saved_ifs="$IFS"
IFS=":"
for tool_dir in $host_tool_dirs; do
  case ":$PATH:" in
    *":$tool_dir:"*) ;;
    *) [ -d "$tool_dir" ] && PATH="$PATH:$tool_dir" ;;
  esac
done
IFS="$saved_ifs"
export PATH

# Read-only snapshot of the host's power and Docker settings for the portal's
# installation page (BI-3E2F87FA). Never fails startup; changes no setting.
if [ -f scripts/installer/host-posture.mjs ] && command -v node >/dev/null 2>&1; then
  node scripts/installer/host-posture.mjs "$install_dir" || true
fi

# At sign-in Docker Desktop may still be starting, or not set to start at all.
# Start it on macOS and wait, bounded, rather than failing compose at once.
dpf_wait_for_docker() {
  docker info >/dev/null 2>&1 && return 0
  if [ "$host_platform" = "macos" ]; then
    echo "Docker is not running yet; starting Docker Desktop."
    open -g -a Docker >/dev/null 2>&1 || true
  fi
  local tries=0
  local max_tries="${DPF_DOCKER_WAIT_ATTEMPTS:-60}"
  while [ "$tries" -lt "$max_tries" ]; do
    sleep "${DPF_DOCKER_WAIT_INTERVAL:-5}"
    docker info >/dev/null 2>&1 && return 0
    tries=$((tries + 1))
  done
  echo "Docker did not start in time, so the platform was not started. Open Docker Desktop, then sign out of the computer and back in." >&2
  return 1
}

if [ "${1:-}" != "--converge-only" ]; then
  dpf_wait_for_docker
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
