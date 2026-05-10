#!/usr/bin/env bash
# Docker Engine detection + install helper for the DPF installer.
# Source this file; do not execute directly.
#
# Per the installer-parity roadmap Phase 7a (Linux Docker install).
# macOS .dmg flow lands in Phase 7b. Windows is install-dpf.ps1's job.
#
# Bash 3.2 baseline.

if [ "${DPF_LIB_DOCKER_LOADED:-}" = "1" ]; then
  return 0
fi
DPF_LIB_DOCKER_LOADED=1

if [ -z "${DPF_LIB_LOGGING_LOADED:-}" ]; then
  # shellcheck source=logging.sh
  . "$(dirname "${BASH_SOURCE[0]}")/logging.sh"
fi
if [ -z "${DPF_LIB_PLATFORM_LOADED:-}" ]; then
  # shellcheck source=platform.sh
  . "$(dirname "${BASH_SOURCE[0]}")/platform.sh"
fi

# Minimum Docker Engine version. host-gateway (used by base compose
# extra_hosts for all services) requires 20.10+; preflight refuses
# older.
DPF_DOCKER_MIN_VERSION="20.10"

# Return the installed Docker version (e.g. "27.3.1") or empty.
dpf_docker_version() {
  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi
  docker --version 2>/dev/null | sed -nE 's/^Docker version ([0-9]+\.[0-9]+(\.[0-9]+)?).*/\1/p'
}

# semver-ish compare: "20.10" <= "27.3.1". POSIX-compatible.
# Args: $1 = candidate, $2 = floor
# Returns 0 if candidate >= floor; non-zero otherwise.
dpf_docker_version_ge() {
  local candidate="$1"
  local floor="$2"
  local cand_major cand_minor floor_major floor_minor
  cand_major="$(echo "$candidate" | cut -d. -f1)"
  cand_minor="$(echo "$candidate" | cut -d. -f2)"
  floor_major="$(echo "$floor" | cut -d. -f1)"
  floor_minor="$(echo "$floor" | cut -d. -f2)"
  if [ "$cand_major" -gt "$floor_major" ] 2>/dev/null; then
    return 0
  fi
  if [ "$cand_major" -lt "$floor_major" ] 2>/dev/null; then
    return 1
  fi
  if [ "$cand_minor" -ge "$floor_minor" ] 2>/dev/null; then
    return 0
  fi
  return 1
}

# Resolve the active Docker context's endpoint (unix socket path or
# DOCKER_HOST URL). Returns empty string if no daemon configured.
dpf_docker_endpoint() {
  if [ -n "${DOCKER_HOST:-}" ]; then
    echo "$DOCKER_HOST"
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi
  # Prefer `docker context inspect`; fall back to the legacy socket
  # path. The context-inspect path is the canonical answer per the
  # cloud-deployment spec (Phase 5 docker.ts discovery alignment).
  docker context inspect 2>/dev/null \
    | grep -m1 '"Host"' \
    | sed -E 's/.*"Host"\s*:\s*"([^"]+)".*/\1/' \
    || echo ""
}

# Linux-only: install Docker Engine via the host's distro package
# manager. Refuses gracefully on unsupported distros; the caller
# (install-dpf.sh) preflight already weeded out older / unsupported
# distros, so this function trusts that gate.
#
# Args: none. Reads /etc/os-release.
dpf_docker_install_linux() {
  dpf_platform
  if [ "$DPF_PLATFORM" != "linux" ]; then
    fail "dpf_docker_install_linux: not on Linux"
  fi

  if [ ! -r /etc/os-release ]; then
    fail "Cannot read /etc/os-release; can't determine Linux distro for Docker install."
  fi

  local distro_id
  # shellcheck disable=SC1091
  distro_id="$(. /etc/os-release && echo "${ID:-}")"

  case "$distro_id" in
    ubuntu|debian)
      info "Installing Docker Engine via apt-get (Debian / Ubuntu)"
      # Use the official Docker apt repo per docs.docker.com/engine/install
      # We don't manage the keyring file directly here — distros 22.04+ /
      # 12+ already package docker.io which is functionally equivalent for
      # our purposes (Docker Engine 20.10+ with compose plugin available).
      # Customers who want the upstream `docker-ce` build can install it
      # themselves and re-run; preflight will detect the version.
      sudo apt-get update -y
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-plugin || \
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io
      ;;
    fedora|rhel|centos)
      info "Installing Docker Engine via dnf (Fedora / RHEL / CentOS)"
      sudo dnf install -y docker docker-compose-plugin || sudo dnf install -y moby-engine
      ;;
    *)
      fail "Unsupported Linux distro for automated Docker install: $distro_id. Install Docker Engine manually (https://docs.docker.com/engine/install/) and re-run."
      ;;
  esac

  # Enable and start the daemon.
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl enable --now docker || true
  fi

  # Add the invoking user to the docker group so non-sudo docker
  # commands work in the subsequent session. We DO NOT call newgrp
  # automatically (per the roadmap: "no magical newgrp dependency
  # unless tested"). The installer reports the requirement explicitly.
  local target_user="${SUDO_USER:-$USER}"
  if [ -n "$target_user" ] && [ "$target_user" != "root" ]; then
    sudo usermod -aG docker "$target_user" || true
    warn "Added '$target_user' to the docker group."
    info "  Log out and back in (or run 'newgrp docker') before continuing,"
    info "  then re-run install-dpf.sh to complete the install."
    return 75  # EX_TEMPFAIL-ish: caller should exit and ask operator to re-run
  fi
}

# Ensure Docker is present at acceptable version. Installs on Linux
# if missing. macOS .dmg flow is Phase 7b; preflight catches Intel
# Mac, so this function only encounters Apple Silicon Macs that
# either already have Docker Desktop or need the user to install it
# manually (until Phase 7b ships).
#
# Args: none.
# Returns:
#   0   Docker present and version acceptable
#   75  Docker just installed; operator must log out / newgrp and re-run
#   non-zero otherwise
dpf_docker_ensure_installed() {
  dpf_platform

  local version
  version="$(dpf_docker_version)"

  if [ -z "$version" ]; then
    info "Docker is not installed."
    if [ "$DPF_PLATFORM" = "linux" ]; then
      dpf_docker_install_linux
      return $?
    fi
    if [ "$DPF_PLATFORM" = "darwin" ]; then
      fail "Docker Desktop not detected. Until installer-parity Phase 7b ships the automated .dmg install, please install Docker Desktop manually from https://www.docker.com/products/docker-desktop/ and re-run install-dpf.sh."
    fi
    fail "Unsupported platform for Docker install: $DPF_PLATFORM"
  fi

  if ! dpf_docker_version_ge "$version" "$DPF_DOCKER_MIN_VERSION"; then
    fail "Docker $version is below the supported floor ($DPF_DOCKER_MIN_VERSION+; host-gateway support required). Upgrade Docker Engine and re-run install-dpf.sh."
  fi

  ok "Docker $version present"

  # Verify the daemon is reachable.
  if ! docker info >/dev/null 2>&1; then
    fail "Docker daemon is not reachable. On macOS: open Docker Desktop and wait for it to start. On Linux: sudo systemctl start docker."
  fi
  ok "Docker daemon reachable"

  return 0
}
