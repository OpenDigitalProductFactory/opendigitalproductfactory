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
if [ -z "${DPF_LIB_STATE_LOADED:-}" ]; then
  # shellcheck source=state.sh
  . "$(dirname "${BASH_SOURCE[0]}")/state.sh"
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
#              ollama service and Linux host telemetry exporters)
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

  # Edge Node bundling. OPT-IN: default OFF (BI-72CFF89D / edge-topology
  # design §5). Callers resolve the deploy choice via
  # dpf_resolve_edge_enabled (state.sh) and export DPF_INCLUDE_EDGE=1
  # before calling this; set DPF_INCLUDE_EDGE=1 directly (or pass
  # --with-edge to install-dpf.sh / dpf-start.sh) to include it. Cloud /
  # Authority-only deployments and any host that will instead add Edge
  # Nodes from separate machines (docker-compose.edge-standalone.yml)
  # simply leave it off.
  #
  # The overlay's default `edge-node` service uses bridge networking
  # so it works on both Linux (no privileged caps required) and macOS
  # Docker Desktop (where host networking maps to the VM, not the
  # user's machine). Operators who want real-NIC visibility on Linux
  # can opt into the host-network profile by setting
  # COMPOSE_PROFILES=linux-host-network in the environment.
  # macOS uses the host-native Go process because Docker Desktop hides the
  # physical multicast interfaces. Linux retains the container overlay.
  if [ "${DPF_INCLUDE_EDGE:-0}" = "1" ] && [ "$DPF_PLATFORM" != "darwin" ]; then
    DPF_COMPOSE_FILES+=(-f docker-compose.edge.yml)
  fi

  # Organization members persist this marker only after a fingerprint-pinned
  # join succeeds. Trust/TLS is a member lifecycle concern; the Step CA
  # authority overlay is deliberately not added here.
  organization_trust="${DPF_ORGANIZATION_TRUST_ENABLED:-}"
  if [ -z "$organization_trust" ] && [ -f .env ]; then
    organization_trust="$(sed -n 's/^DPF_ORGANIZATION_TRUST_ENABLED=//p' .env | tail -1)"
  fi
  if [ "$organization_trust" = "1" ]; then
    DPF_COMPOSE_FILES+=(-f docker-compose.organization-trust.yml -f docker-compose.tls.yml)
  fi

  edge_actions="${DPF_EDGE_ACTION_DISPATCH_CONFIGURED:-}"
  if [ -z "$edge_actions" ] && [ -f .env ]; then
    edge_actions="$(sed -n 's/^DPF_EDGE_ACTION_DISPATCH_CONFIGURED=//p' .env | tail -1)"
  fi
  if [ "$edge_actions" = "1" ]; then
    DPF_COMPOSE_FILES+=(-f docker-compose.edge-actions.yml)
  fi

  # Append any caller-provided extras (e.g. docker-compose.dev.yml for
  # the developer port-exposing overlay).
  while [ "$#" -gt 0 ]; do
    DPF_COMPOSE_FILES+=(-f "$1")
    shift
  done

  # Every installer/start caller already passes through this assembler. Resolve
  # the runtime profiles here so POSIX lifecycle paths cannot forget the adapter.
  # A dry-run resolves but state.sh deliberately suppresses the snapshot write.
  if [ -f "$(dpf_state_path)" ]; then
    dpf_compose_profiles
  fi

  export DPF_COMPOSE_FILES
}

# Resolve COMPOSE_PROFILES through resolve-capability-compose-profiles.mjs via
# the state library. Lifecycle-only overlays are
# passed explicitly as additional adapter arguments (for example:
# --overlay promote); runtime profiles always come from the generated catalog.
dpf_compose_profiles() {
  local root="${REPO_ROOT:-$(pwd)}" projection operator_profiles="${COMPOSE_PROFILES:-}"
  projection="$(dpf_resolve_capability_compose_profiles "$root" "${DPF_PLATFORM:-}" --compose-profiles "$operator_profiles" "$@")" || return 1
  DPF_CAPABILITY_PROJECTION="$projection"
  COMPOSE_PROFILES="$(printf '%s' "$projection" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).composeProfiles.join(",")))')"
  export COMPOSE_PROFILES DPF_CAPABILITY_PROJECTION
}

dpf_capability_service_required() {
  local service="$1"
  [ -n "${DPF_CAPABILITY_PROJECTION:-}" ] || dpf_compose_profiles || return 1
  printf '%s' "$DPF_CAPABILITY_PROJECTION" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);process.exit(p.requiredServices.includes(process.argv[1])?0:1)})' "$service"
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

# Emit the assembled compose chain as a JSON array of filenames (the
# `-f` flag tokens stripped), e.g. ["docker-compose.yml",
# "docker-compose.macos.yml"]. Operates on the already-assembled
# DPF_COMPOSE_FILES so it reflects whatever mode/platform/edge options
# the prior dpf_compose_files call resolved. Recorded in
# install-state.json's composeFiles. Compose filenames are repo-literal
# (no quotes/backslashes), so manual JSON assembly is safe and keeps
# this dependency-free on hosts without jq.
dpf_compose_files_json() {
  local json="[" first=1 tok
  for tok in "${DPF_COMPOSE_FILES[@]}"; do
    [ "$tok" = "-f" ] && continue
    if [ "$first" = "1" ]; then first=0; else json="$json,"; fi
    json="$json\"$tok\""
  done
  printf '%s]' "$json"
}
