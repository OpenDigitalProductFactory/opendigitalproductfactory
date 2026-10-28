#!/usr/bin/env bash
# Host-side convergence for an existing macOS or Linux install (BI-084F85E5).
# Twin of host-convergence.ps1.
#
# A self-upgrade replaces containers and the verified release assets in the
# install directory; it cannot install a host service. The shipped start
# script (scripts/installer/dpf-start.consumer.sh, run by the autostart unit)
# calls dpf_host_converge once the portal is healthy, so the native
# host-upkeep agent (BI-28EFE18A) reaches every install and follows each
# release with no human step.
#
# dpf_host_converge prints a status and always returns 0: a convergence
# failure is logged and never stops the platform from starting. Nothing here
# reboots or shuts down the host. Bash 3.2 baseline (macOS default).

command -v warn >/dev/null 2>&1 || warn() { printf '  !  %s\n' "$1" >&2; }
command -v info >/dev/null 2>&1 || info() { printf '  -  %s\n' "$1" >&2; }
command -v ok >/dev/null 2>&1 || ok() { printf '  ok %s\n' "$1" >&2; }

# Same root the native agent installer uses (native-edge-host.sh).
dpf_host_state_root() {
  printf '%s' "${DPF_STATE_DIR:-$HOME/.dpf}"
}

dpf_host_convergence_log() {
  local log_dir
  log_dir="$(dpf_host_state_root)/logs"
  mkdir -p "$log_dir" 2>/dev/null || return 0
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$log_dir/host-convergence.log" 2>/dev/null || true
}

# The release this install runs, as recorded by the verified asset install.
# A source checkout carries no record and follows "latest".
dpf_installed_release_version() {
  local record="$1/.verified-release-assets-version" value=""
  [ -f "$record" ] && value="$(tr -d '[:space:]' < "$record")"
  if printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'; then
    printf '%s' "$value"
  else
    printf 'latest'
  fi
}

dpf_native_edge_marker_path() {
  printf '%s/edge-node/installed-version' "$(dpf_host_state_root)"
}

dpf_native_edge_service_present() {
  case "$(uname -s 2>/dev/null)" in
    Darwin) launchctl print "gui/$(id -u)/local.dpf-edge-node" >/dev/null 2>&1 ;;
    Linux) systemctl --user is-enabled dpf-edge-node.service >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

# Current means the agent's service exists and was installed for this release
# and role. Anything else (no service, an older release, another role) is
# converged again.
dpf_native_edge_current() {
  local version="$1" role="$2" marker
  dpf_native_edge_service_present || return 1
  marker="$(dpf_native_edge_marker_path)"
  [ -f "$marker" ] || return 1
  [ "$(tr -d '[:space:]' < "$marker")" = "$version|$role" ]
}

# Mint a single-use auto-approve enrollment token inside this install's portal
# container. Prints the token, or nothing when issuance failed.
dpf_new_edge_bootstrap_token() {
  local install_dir="$1" container output
  container="$(docker ps -q --filter label=com.docker.compose.service=portal \
    --filter "label=com.docker.compose.project.working_dir=$install_dir" 2>/dev/null | head -1)"
  [ -n "$container" ] || container="dpf-portal-1"
  output="$(docker exec "$container" sh -c 'cd /app/apps/web-src && /app/node_modules/.pnpm/node_modules/.bin/tsx scripts/issue-edge-bootstrap-token.ts --ttl-minutes 30 --auto-approve' 2>/dev/null)" || return 0
  printf '%s\n' "$output" | sed 's/[[:space:]]*$//' | grep -E '^dpfboot_' | tail -1
}

# Prints one of: current, converged, token-failed, module-missing, failed.
dpf_host_converge() {
  local install_dir="$1" role="${2:-host-upkeep}" version token="" module marker
  version="$(dpf_installed_release_version "$install_dir")"
  if dpf_native_edge_current "$version" "$role"; then
    dpf_host_convergence_log "current version=$version role=$role"
    printf 'current\n'
    return 0
  fi
  module="$install_dir/scripts/installer/native-edge-host.sh"
  if [ ! -f "$module" ]; then
    dpf_host_convergence_log "module-missing path=$module"
    printf 'module-missing\n'
    return 0
  fi
  # shellcheck source=../native-edge-host.sh
  . "$module"

  if [ ! -f "$(dpf_host_state_root)/edge-node/state.json" ]; then
    token="$(dpf_new_edge_bootstrap_token "$install_dir")"
    if [ -z "$token" ]; then
      dpf_host_convergence_log "token-failed version=$version role=$role"
      printf 'token-failed\n'
      return 0
    fi
  fi

  if DPF_NATIVE_EDGE_VERSION="$version" dpf_native_edge_install "$install_dir" "$token" \
       "$(hostname -s 2>/dev/null || echo dpf-host)" "$role" >&2; then
    marker="$(dpf_native_edge_marker_path)"
    mkdir -p "$(dirname "$marker")" 2>/dev/null || true
    printf '%s|%s' "$version" "$role" > "$marker"
    dpf_host_convergence_log "converged version=$version role=$role"
    printf 'converged\n'
  else
    dpf_host_convergence_log "failed version=$version role=$role reason=install-returned-nonzero"
    printf 'failed\n'
  fi
  return 0
}
