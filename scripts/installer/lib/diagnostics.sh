#!/usr/bin/env bash
# Supplementary diagnostics collector for DPF installations.
# Source this file; do not execute directly.
#
# Per the installer-parity roadmap Phase 10d. The core bundle in
# doctor.sh (Phase 6) already covers host info, docker version /
# context, compose chain + render hash, install-state, service logs,
# port-conflict scan, LLM reachability, and redacted env. This module
# adds the long-tail sections field experience flagged as missing:
#
#   - Autostart unit state (LaunchAgent on macOS, systemd-user unit
#     on Linux) — most "stack didn't come back after reboot" reports
#     trace back to a misconfigured or quarantined autostart unit.
#   - Full rendered compose YAML — the existing sha256 in doctor.sh
#     answers "did the chain change?", but the YAML itself is what
#     an investigator needs to see to diagnose overlay-merge issues.
#   - Disk space on key mount points — common silent failure on small
#     VMs / runners; the platform fills /var/lib/docker quickly with
#     5 GB of images.
#   - DNS resolution for the four hosts the installer + image pulls
#     depend on (github.com, ghcr.io, registry-1.docker.io,
#     model-runner.docker.internal).
#   - ~/.dpf perms snapshot — silent permission corruption (state
#     file world-readable after a misconfigured chmod, etc.) is hard
#     to debug without a perms dump.
#
# Bash 3.2 baseline.

if [ "${DPF_LIB_DIAGNOSTICS_LOADED:-}" = "1" ]; then
  return 0
fi
DPF_LIB_DIAGNOSTICS_LOADED=1

if [ -z "${DPF_LIB_LOGGING_LOADED:-}" ]; then
  # shellcheck source=logging.sh
  . "$(dirname "${BASH_SOURCE[0]}")/logging.sh"
fi
if [ -z "${DPF_LIB_STATE_LOADED:-}" ]; then
  # shellcheck source=state.sh
  . "$(dirname "${BASH_SOURCE[0]}")/state.sh"
fi
if [ -z "${DPF_LIB_COMPOSE_LOADED:-}" ]; then
  # shellcheck source=compose.sh
  . "$(dirname "${BASH_SOURCE[0]}")/compose.sh"
fi
if [ -z "${DPF_LIB_PLATFORM_LOADED:-}" ]; then
  # shellcheck source=platform.sh
  . "$(dirname "${BASH_SOURCE[0]}")/platform.sh"
fi

# Public: write the supplementary diagnostics into $1 (existing bundle
# directory created by doctor.sh). Best-effort throughout — every
# section is wrapped so a failing shell-out (e.g. no systemctl on a
# darwin box) doesn't abort the rest of the bundle. Caller is expected
# to have already relaxed `set -e` for the duration of doctor collect.
#
# Args:
#   $1 = bundle directory (already exists, owned by caller)
#   $2 = mode hint (dev|release) for compose chain assembly
dpf_diagnostics_collect() {
  local bundle_dir="$1"
  local mode="${2:-dev}"

  if [ -z "$bundle_dir" ] || [ ! -d "$bundle_dir" ]; then
    return 1
  fi

  dpf_platform

  # 1. Autostart unit state.
  {
    echo "Platform: $DPF_PLATFORM"
    echo
    case "$DPF_PLATFORM" in
      darwin)
        local plist="$HOME/Library/LaunchAgents/local.dpf-autostart.plist"
        echo "Expected plist: $plist"
        if [ -f "$plist" ]; then
          echo "  status: present"
          echo "  perms: $(ls -l "$plist" 2>/dev/null | awk '{print $1, $3, $4}')"
        else
          echo "  status: missing"
        fi
        echo
        echo "launchctl print gui/$UID/local.dpf-autostart:"
        launchctl print "gui/$UID/local.dpf-autostart" 2>&1 | head -50 || true
        echo
        echo "xattr (quarantine check):"
        [ -f "$plist" ] && xattr -l "$plist" 2>&1 || echo "  (plist not present)"
        ;;
      linux)
        local unit="$HOME/.config/systemd/user/dpf.service"
        echo "Expected unit: $unit"
        if [ -f "$unit" ]; then
          echo "  status: present"
          echo "  perms: $(ls -l "$unit" 2>/dev/null | awk '{print $1, $3, $4}')"
        else
          echo "  status: missing"
        fi
        echo
        if command -v systemctl >/dev/null 2>&1; then
          echo "systemctl --user status dpf.service:"
          systemctl --user status dpf.service 2>&1 | head -30 || true
          echo
          echo "systemctl --user is-enabled dpf.service:"
          systemctl --user is-enabled dpf.service 2>&1 || true
          echo
          if command -v loginctl >/dev/null 2>&1; then
            echo "loginctl show-user (linger):"
            loginctl show-user "$(id -un)" 2>&1 | grep -i linger || true
          fi
        else
          echo "(systemctl not available)"
        fi
        ;;
      *)
        echo "(autostart not implemented for platform: $DPF_PLATFORM)"
        ;;
    esac
  } > "$bundle_dir/autostart.txt"

  # 2. Full rendered compose YAML (caller already records sha256 in
  #    compose.txt; this is the content the hash summarizes).
  if dpf_compose_files "$mode" 2>/dev/null; then
    docker compose "${DPF_COMPOSE_FILES[@]}" config > "$bundle_dir/compose-rendered.yml" 2>&1 || \
      echo "(compose config failed — see file for stderr)" >> "$bundle_dir/compose-rendered.yml"
  fi

  # 3. Disk space on the paths the installer touches.
  {
    echo "Disk usage on DPF-relevant mount points:"
    echo
    # df -h with explicit POSIX-portable args. macOS df defaults to
    # 512-byte blocks; -h gives human-readable on both BSD and GNU.
    local paths="$HOME"
    [ -d "$(dpf_state_dir)" ] && paths="$paths $(dpf_state_dir)"
    [ -d "/var/lib/docker" ] && paths="$paths /var/lib/docker"
    [ -d "/" ] && paths="$paths /"
    # shellcheck disable=SC2086
    df -h $paths 2>&1 | sort -u
    echo
    echo "DPF state directory size:"
    if [ -d "$(dpf_state_dir)" ]; then
      du -sh "$(dpf_state_dir)" 2>&1 || true
    fi
  } > "$bundle_dir/disk.txt"

  # 4. DNS resolution + outbound reachability for the four hosts the
  #    installer + image pulls depend on.
  {
    echo "Outbound reachability:"
    echo
    for host in github.com ghcr.io registry-1.docker.io model-runner.docker.internal; do
      printf '  %-40s ' "$host"
      if command -v getent >/dev/null 2>&1; then
        getent hosts "$host" >/dev/null 2>&1 && echo -n "[DNS ok] " || echo -n "[DNS FAIL] "
      elif command -v host >/dev/null 2>&1; then
        host "$host" >/dev/null 2>&1 && echo -n "[DNS ok] " || echo -n "[DNS FAIL] "
      elif command -v dscacheutil >/dev/null 2>&1; then
        # macOS
        dscacheutil -q host -a name "$host" 2>/dev/null | grep -q "ip_address:" && echo -n "[DNS ok] " || echo -n "[DNS FAIL] "
      else
        echo -n "[DNS unknown] "
      fi
      curl --silent --max-time 5 --output /dev/null --write-out "HTTPS %{http_code} (%{time_total}s)\n" "https://$host" 2>&1 \
        || echo "HTTPS unreachable"
    done
  } > "$bundle_dir/connectivity.txt"

  # 5. ~/.dpf perms snapshot. Surfaces world-readable secrets, stale
  #    launch script perms, missing log directory, etc.
  {
    local state_dir; state_dir="$(dpf_state_dir)"
    echo "State dir: $state_dir"
    echo
    if [ -d "$state_dir" ]; then
      ls -la "$state_dir" 2>&1 || true
      if [ -d "$state_dir/logs" ]; then
        echo
        echo "logs/:"
        ls -la "$state_dir/logs" 2>&1 || true
      fi
    else
      echo "(state dir does not exist)"
    fi
    echo
    echo "Repo .env perms (if present):"
    if [ -f .env ]; then
      ls -l .env 2>&1 || true
    else
      echo "(.env not present in CWD)"
    fi
  } > "$bundle_dir/perms.txt"
}
