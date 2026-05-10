#!/usr/bin/env bash
# Unsupported-host preflight detector for the DPF installer.
# Source this file; do not execute directly.
#
# Per the installer-parity roadmap Phase 6: detect known-unsupported
# host configurations during preflight and refuse to proceed with a
# crisp Reason + Next message rather than failing opaquely later.
#
# Bash 3.2 baseline.

if [ "${DPF_LIB_PREFLIGHT_LOADED:-}" = "1" ]; then
  return 0
fi
DPF_LIB_PREFLIGHT_LOADED=1

# Source logging if not already loaded so we can emit warn/info uniformly.
if [ -z "${DPF_LIB_LOGGING_LOADED:-}" ]; then
  # shellcheck source=logging.sh
  . "$(dirname "${BASH_SOURCE[0]}")/logging.sh"
fi

# Each refusal exits non-zero with a clear "Reason:" and "Next:" line.
# Operators can override the unsupported decision by setting
# DPF_FORCE_UNSUPPORTED_HOST=1; the installer logs the override and
# proceeds at the operator's risk.
_dpf_preflight_refuse() {
  local reason="$1"
  local next="$2"
  if [ "${DPF_FORCE_UNSUPPORTED_HOST:-0}" = "1" ]; then
    warn "Unsupported host detected, but DPF_FORCE_UNSUPPORTED_HOST=1 — proceeding."
    info "  Reason: $reason"
    info "  Next: $next"
    return 0
  fi
  printf '\n%bUnsupported host detected.%b\n' "${DPF_RED:-}" "${DPF_NC:-}" >&2
  printf '  %bReason:%b %s\n' "${DPF_YELLOW:-}" "${DPF_NC:-}" "$reason" >&2
  printf '  %bNext:%b   %s\n' "${DPF_YELLOW:-}" "${DPF_NC:-}" "$next" >&2
  printf '\n  Override (advanced): DPF_FORCE_UNSUPPORTED_HOST=1 bash %s\n\n' "$0" >&2
  exit 64  # EX_USAGE-ish: configuration error
}

# Run all unsupported-host checks. Exits non-zero on any failure unless
# DPF_FORCE_UNSUPPORTED_HOST=1.
dpf_preflight_unsupported_host() {
  local kernel; kernel="$(uname -s)"
  local arch;   arch="$(uname -m)"

  # Intel Mac — out of scope per the installer-parity roadmap.
  if [ "$kernel" = "Darwin" ] && [ "$arch" = "x86_64" ]; then
    _dpf_preflight_refuse \
      "Intel Mac is out of scope for the macOS installer." \
      "Use the Windows installer (install-dpf.ps1), or run inside a Linux VM on this host."
  fi

  # WSL2 without Docker Desktop.
  if [ "$kernel" = "Linux" ] && uname -r 2>/dev/null | grep -qi "microsoft"; then
    if ! docker info 2>/dev/null | grep -qi "Docker Desktop"; then
      _dpf_preflight_refuse \
        "WSL2 detected without Docker Desktop integration." \
        "Install Docker Desktop for Windows and enable WSL2 integration, or run install-dpf.sh on a native Linux host."
    fi
  fi

  # Rootless Docker — host-network and host-gateway semantics differ.
  if command -v docker >/dev/null 2>&1; then
    if docker info 2>/dev/null | grep -qi "rootless"; then
      _dpf_preflight_refuse \
        "Rootless Docker detected." \
        "DPF requires standard Docker Engine for host-gateway and selected-profile host-network semantics. Reinstall with rootful Docker, or run on Docker Desktop."
    fi

    # Podman or containerd masquerading as docker.
    local docker_ver; docker_ver="$(docker --version 2>/dev/null || true)"
    case "$docker_ver" in
      *podman*|*Podman*)
        _dpf_preflight_refuse \
          "Podman detected via the 'docker' command alias." \
          "DPF currently requires standard Docker Engine. Install Docker Engine alongside Podman or remove the alias."
        ;;
    esac
  fi

  # Older Linux distros — warn-only with override flag, default refuse.
  if [ "$kernel" = "Linux" ] && [ -r /etc/os-release ]; then
    local distro_id distro_ver
    # shellcheck disable=SC1091
    distro_id="$(. /etc/os-release && echo "${ID:-}")"
    distro_ver="$(. /etc/os-release && echo "${VERSION_ID:-}")"
    case "$distro_id" in
      ubuntu)
        # Require Ubuntu 22.04+
        local major; major="$(echo "$distro_ver" | cut -d. -f1)"
        if [ -n "$major" ] && [ "$major" -lt 22 ] 2>/dev/null; then
          _dpf_preflight_refuse \
            "Ubuntu $distro_ver is below the supported floor (Ubuntu 22.04)." \
            "Upgrade to Ubuntu 22.04+ or override with DPF_FORCE_UNSUPPORTED_HOST=1."
        fi
        ;;
      debian)
        local major; major="$(echo "$distro_ver" | cut -d. -f1)"
        if [ -n "$major" ] && [ "$major" -lt 12 ] 2>/dev/null; then
          _dpf_preflight_refuse \
            "Debian $distro_ver is below the supported floor (Debian 12)." \
            "Upgrade to Debian 12+ or override with DPF_FORCE_UNSUPPORTED_HOST=1."
        fi
        ;;
      fedora)
        local major; major="$(echo "$distro_ver" | cut -d. -f1)"
        if [ -n "$major" ] && [ "$major" -lt 39 ] 2>/dev/null; then
          _dpf_preflight_refuse \
            "Fedora $distro_ver is below the supported floor (Fedora 39)." \
            "Upgrade to Fedora 39+ or override with DPF_FORCE_UNSUPPORTED_HOST=1."
        fi
        ;;
    esac
  fi

  # Air-gapped Linux — warn but allow proceeding.
  if [ "$kernel" = "Linux" ]; then
    if ! curl --silent --max-time 3 --output /dev/null https://github.com 2>/dev/null; then
      warn "Outbound network connectivity check to https://github.com failed."
      info "  Air-gapped or restricted-network installs aren't fully supported yet."
      info "  Install will proceed but image pulls and provider OAuth flows may fail."
    fi
  fi

  return 0
}
