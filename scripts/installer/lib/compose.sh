#!/usr/bin/env bash
# Compose -f chain assembler for DPF deployments.
# Source this file; do not execute directly.
#
# Provides the single source of truth for which compose files to chain
# given a deployment mode + the host platform. Used by:
#   - scripts/setup.sh (contributor mode; dev only)
#   - install-dpf.sh (when installer-parity Phase 6+ lands; release mode)
#   - dpf-{start,stop,reinstall}.sh (lifecycle scripts; Phase 8)
#   - .github/workflows/ci.yml (compose-render policy checks; Phase 9)
#
# Per the deployment doctrine: a single canonical -f chain assembler
# means substrate-specific deltas can never silently drift between
# scripts that all need to agree on the active compose set.
#
# Bash 3.2 baseline.

if [ "${DPF_LIB_COMPOSE_LOADED:-}" = "1" ]; then
  return 0
fi
DPF_LIB_COMPOSE_LOADED=1

# Pull in platform.sh for dpf_platform if not already loaded. We resolve
# the path relative to this file so callers don't have to know about it.
if [ -z "${DPF_LIB_PLATFORM_LOADED:-}" ]; then
  # shellcheck source=platform.sh
  . "$(dirname "${BASH_SOURCE[0]}")/platform.sh"
fi

# Populate the global DPF_COMPOSE_FILES array with the right -f flags
# for the requested mode + the detected host platform.
#
# Args:
#   $1 = mode: "dev" (default) or "release"
#   $2.. = optional extra overlay paths (e.g. "docker-compose.dev.yml"
#          for the developer port-exposing overlay)
#
# Sets:
#   DPF_COMPOSE_FILES — array of "-f <path>" tokens, ready to splat
#                       into a docker compose invocation:
#                       docker compose "${DPF_COMPOSE_FILES[@]}" up -d
#
# Mode rules:
#   dev      = base only; services build locally
#   release  = base + release.yml overlay; services pull pre-built
#              GHCR images per Doctrine Contract 1
#
# Platform rules:
#   darwin   = adds docker-compose.macos.yml
#   linux    = adds docker-compose.linux.yml (which also brings up the
#              ollama service and enables the linux-monitoring profile
#              by default)
#   else     = no platform overlay added; caller proceeds at their own
#              risk (e.g. raw Linux container without the linux overlay)
dpf_compose_files() {
  local mode="${1:-dev}"
  shift || true

  # Ensure DPF_PLATFORM is set.
  dpf_platform

  DPF_COMPOSE_FILES=(-f docker-compose.yml)

  case "$mode" in
    dev)
      :  # base only
      ;;
    release)
      DPF_COMPOSE_FILES+=(-f docker-compose.release.yml)
      ;;
    *)
      echo "dpf_compose_files: unknown mode '$mode' (expected dev|release)" >&2
      return 1
      ;;
  esac

  case "$DPF_PLATFORM" in
    darwin)  DPF_COMPOSE_FILES+=(-f docker-compose.macos.yml) ;;
    linux)   DPF_COMPOSE_FILES+=(-f docker-compose.linux.yml) ;;
    *)       : ;;  # no platform overlay
  esac

  # Edge Node bundling. Default ON for single-host installs; set
  # DPF_INCLUDE_EDGE=0 (or pass --no-edge to install-dpf.sh) to skip
  # — useful for cloud / Authority-only deployments where Edge Nodes
  # will be added later from separate hosts via
  # docker-compose.edge-standalone.yml.
  #
  # The overlay's default `edge-node` service uses bridge networking
  # so it works on both Linux (no privileged caps required) and macOS
  # Docker Desktop (where host networking maps to the VM, not the
  # user's machine). Operators who want real-NIC visibility on Linux
  # can opt into the host-network profile by setting
  # COMPOSE_PROFILES=linux-host-network in the environment.
  if [ "${DPF_INCLUDE_EDGE:-1}" = "1" ]; then
    DPF_COMPOSE_FILES+=(-f docker-compose.edge.yml)
  fi

  # Append any caller-provided extras (e.g. docker-compose.dev.yml for
  # the developer port-exposing overlay).
  while [ "$#" -gt 0 ]; do
    DPF_COMPOSE_FILES+=(-f "$1")
    shift
  done

  export DPF_COMPOSE_FILES
}

# Convenience: print the assembled chain as a space-separated string,
# useful for logging or for callers that prefer a string.
#
# Usage: chain=$(dpf_compose_chain release); docker compose $chain up -d
# Note: prefer the array form ${DPF_COMPOSE_FILES[@]} to avoid quoting
# pitfalls; this string form is for logging.
dpf_compose_chain() {
  dpf_compose_files "$@"
  printf '%s ' "${DPF_COMPOSE_FILES[@]}" | sed 's/ $//'
}
