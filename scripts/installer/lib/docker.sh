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

# Apple Silicon Docker Desktop .dmg download URL. Hardcoded to the
# canonical Docker Desktop endpoint; can be overridden via env var
# for mirror / corporate-proxy setups.
DPF_DOCKER_DESKTOP_DMG_URL="${DPF_DOCKER_DESKTOP_DMG_URL:-https://desktop.docker.com/mac/main/arm64/Docker.dmg}"

# macOS-only: install Docker Desktop by downloading the .dmg directly
# from Docker's official endpoint, mounting it via hdiutil, copying
# Docker.app into /Applications, ejecting the volume, then launching
# Docker.app and waiting for the daemon.
#
# Deliberately does NOT bootstrap Homebrew per the installer-parity
# roadmap. Customers who want Homebrew install it themselves; this
# function only needs Docker.app to land in /Applications.
#
# Args: none.
dpf_docker_install_darwin() {
  dpf_platform
  if [ "$DPF_PLATFORM" != "darwin" ]; then
    fail "dpf_docker_install_darwin: not on Darwin"
  fi

  # Apple Silicon-only per the installer-parity roadmap (preflight
  # refuses Intel Mac). Belt-and-suspenders check.
  if [ "$(uname -m)" != "arm64" ]; then
    fail "dpf_docker_install_darwin: only Apple Silicon is supported; preflight should have refused Intel Mac."
  fi

  local dmg="${TMPDIR:-/tmp}/DPF-DockerDesktop-$(date +%s).dmg"
  local mountpoint="/Volumes/Docker"

  info "Downloading Docker Desktop for Apple Silicon..."
  info "  Source: $DPF_DOCKER_DESKTOP_DMG_URL"
  info "  Target: $dmg"
  if ! curl -fsSL --max-time 600 -o "$dmg" "$DPF_DOCKER_DESKTOP_DMG_URL"; then
    fail "Failed to download Docker Desktop .dmg from $DPF_DOCKER_DESKTOP_DMG_URL. Check network connectivity, or install Docker Desktop manually from https://www.docker.com/products/docker-desktop/ and re-run install-dpf.sh."
  fi
  ok "Downloaded Docker Desktop .dmg"

  info "Mounting .dmg..."
  if ! hdiutil attach -nobrowse -quiet "$dmg"; then
    rm -f "$dmg"
    fail "Failed to mount Docker Desktop .dmg. The downloaded file may be corrupt; delete $dmg and re-run."
  fi

  # Cleanup trap — eject the .dmg and remove the download even if the
  # cp below fails.
  _dpf_dmg_cleanup() {
    hdiutil detach -quiet "$mountpoint" 2>/dev/null || true
    rm -f "$dmg"
  }
  trap _dpf_dmg_cleanup EXIT

  info "Copying Docker.app into /Applications..."
  if ! sudo cp -R "$mountpoint/Docker.app" /Applications/; then
    _dpf_dmg_cleanup
    trap - EXIT
    fail "Failed to copy Docker.app into /Applications. This often means MDM (corporate device management) restricts /Applications writes. Install Docker Desktop manually from https://www.docker.com/products/docker-desktop/ (drag Docker.app from the mounted .dmg yourself) and re-run install-dpf.sh."
  fi
  ok "Copied Docker.app into /Applications"

  _dpf_dmg_cleanup
  trap - EXIT

  info "Launching Docker.app and waiting for daemon..."
  open -a Docker

  # Wait-for-daemon loop. Docker Desktop typically takes 30-120s to
  # boot on a fresh install (first-run prompts not shown when --headless,
  # but the VM still has to start).
  local wait_seconds="${DPF_DOCKER_DESKTOP_START_TIMEOUT:-300}"
  local elapsed=0
  while [ "$elapsed" -lt "$wait_seconds" ]; do
    if docker info >/dev/null 2>&1; then
      ok "Docker daemon reachable after ${elapsed}s"
      return 0
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    if [ "$((elapsed % 30))" = "0" ]; then
      info "  Still waiting for Docker Desktop daemon... (${elapsed}s / ${wait_seconds}s)"
    fi
  done

  fail "Docker Desktop did not become reachable within ${wait_seconds}s. On first launch, Docker Desktop may show a Welcome / Privacy prompt that requires manual confirmation. Open Docker.app from /Applications, complete the first-run flow, then re-run install-dpf.sh."
}
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
# (apt/dnf) or macOS (Docker Desktop .dmg) if missing.
#
# Args: none.
# Returns:
#   0   Docker present and version acceptable
#   75  Docker just installed; operator must log out / newgrp and re-run
#       (Linux only — macOS does not require a re-login after install)
#   non-zero otherwise (fail messages emitted)
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
      # Check /Applications/Docker.app as a sanity step before downloading
      # the .dmg — if Docker.app is present but the CLI isn't on PATH,
      # the operator has Docker Desktop installed but never launched it.
      if [ -d "/Applications/Docker.app" ]; then
        info "Docker.app found in /Applications but the daemon isn't running."
        info "  Launching Docker.app and waiting..."
        open -a Docker
        local wait_seconds="${DPF_DOCKER_DESKTOP_START_TIMEOUT:-300}"
        local elapsed=0
        while [ "$elapsed" -lt "$wait_seconds" ]; do
          if docker info >/dev/null 2>&1; then
            ok "Docker daemon reachable after ${elapsed}s"
            return 0
          fi
          sleep 5
          elapsed=$((elapsed + 5))
        done
        fail "Docker Desktop did not become reachable within ${wait_seconds}s. Open Docker.app, complete any first-run prompts, and re-run install-dpf.sh."
      fi
      # No Docker.app — install via .dmg.
      dpf_docker_install_darwin
      return $?
    fi
    fail "Unsupported platform for Docker install: $DPF_PLATFORM"
  fi

  if ! dpf_docker_version_ge "$version" "$DPF_DOCKER_MIN_VERSION"; then
    fail "Docker $version is below the supported floor ($DPF_DOCKER_MIN_VERSION+; host-gateway support required). Upgrade Docker Engine / Docker Desktop and re-run install-dpf.sh."
  fi

  ok "Docker $version present"

  # Verify the daemon is reachable.
  if ! docker info >/dev/null 2>&1; then
    if [ "$DPF_PLATFORM" = "darwin" ] && [ -d "/Applications/Docker.app" ]; then
      info "Docker CLI present but daemon not running. Launching Docker.app..."
      open -a Docker
      local wait_seconds="${DPF_DOCKER_DESKTOP_START_TIMEOUT:-300}"
      local elapsed=0
      while [ "$elapsed" -lt "$wait_seconds" ]; do
        if docker info >/dev/null 2>&1; then
          ok "Docker daemon reachable after ${elapsed}s"
          return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
      done
      fail "Docker Desktop did not become reachable within ${wait_seconds}s."
    fi
    fail "Docker daemon is not reachable. On macOS: open Docker Desktop and wait for it to start. On Linux: sudo systemctl start docker."
  fi
  ok "Docker daemon reachable"

  return 0
}
