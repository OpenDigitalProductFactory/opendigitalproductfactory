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
    | sed -E 's/.*"Host"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
    || echo ""
}

# Resolve the name of the active Docker context (e.g. "desktop-linux"
# on macOS Docker Desktop, "default" on native Linux Docker Engine).
# Returns empty string if docker is unavailable. Recorded in
# install-state.json so lifecycle scripts don't re-detect the context.
dpf_docker_context() {
  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi
  docker context show 2>/dev/null || echo ""
}

# Apple Silicon Docker Desktop .dmg download URL. Hardcoded to the
# canonical Docker Desktop endpoint; can be overridden via env var
# for mirror / corporate-proxy setups.
DPF_DOCKER_DESKTOP_DMG_URL="${DPF_DOCKER_DESKTOP_DMG_URL:-https://desktop.docker.com/mac/main/arm64/Docker.dmg}"

# Docker Desktop ships its CLI inside the .app bundle. On first launch it
# writes /usr/local/bin symlinks, but those don't exist until the daemon
# has started at least once. Prepend the bundled bin dir to PATH so
# `docker info` polls work during first-run installation.
_dpf_docker_prepend_bundled_path() {
  local bundled="/Applications/Docker.app/Contents/Resources/bin"
  if [ -x "$bundled/docker" ]; then
    case ":$PATH:" in
      *":$bundled:"*) ;;  # already present
      *) export PATH="$bundled:$PATH" ;;
    esac
  fi
}

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

  # sudo cp -R bypasses Launch Services, so `open -a Docker` would fail.
  # Register the app explicitly before launching.
  /System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister \
    -f /Applications/Docker.app 2>/dev/null || true

  # Docker Desktop writes /usr/local/bin symlinks only after its first
  # successful launch. Prepend the bundled CLI so the daemon poll below
  # can call `docker info` before those symlinks exist.
  _dpf_docker_prepend_bundled_path

  info "Launching Docker.app and waiting for daemon..."
  open /Applications/Docker.app

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
# Compose is a separate package on Engine hosts. An Engine-only installation
# cannot run DPF. Check the CLI without requiring daemon access (the freshly
# added docker-group member may still need to log in again).
dpf_docker_require_compose() {
  local version major
  if ! version="$(docker compose version --short 2>/dev/null)"; then
    fail "Docker Compose plugin is missing. Install the Compose plugin from the same package source as Docker Engine, then re-run install-dpf.sh (https://docs.docker.com/compose/install/linux/)."
  fi
  version="${version#v}"
  major="${version%%.*}"
  case "$major" in
    ''|*[!0-9]*) fail "Cannot determine Docker Compose version: $version. Repair the Compose plugin and re-run." ;;
  esac
  if [ "$major" -lt 2 ]; then
    fail "Docker Compose $version is unsupported; the 'docker compose' plugin version 2 or newer is required."
  fi
  ok "Docker Compose $version present"
}

# Fresh-host setup uses one package family from Docker's signed repository.
# Existing working engines never enter this path. Refuse conflicting packages
# instead of removing another workload's runtime. Every mutation handles its
# error explicitly: the caller captures status 75 in an if, disabling errexit
# throughout the called function in Bash.
# Optional os-release path is for host-isolated verification.
dpf_docker_install_linux() {
  dpf_platform
  if [ "$DPF_PLATFORM" != "linux" ]; then
    fail "dpf_docker_install_linux: not on Linux"
  fi

  local os_release="${1:-/etc/os-release}"
  if [ ! -r "$os_release" ]; then
    fail "Cannot read $os_release; can't determine Linux distro for Docker install."
  fi

  local distro_id codename arch package
  # shellcheck disable=SC1090
  distro_id="$(. "$os_release" && echo "${ID:-}")"

  case "$distro_id" in
    ubuntu|debian)
      for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
        if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q '^install ok installed$'; then
          fail "Existing package '$package' conflicts with fresh Docker Engine setup. Have the host administrator reconcile the runtime packages using https://docs.docker.com/engine/install/$distro_id/ and re-run; DPF will not remove them."
        fi
      done
      # shellcheck disable=SC1090
      codename="$(. "$os_release" && echo "${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}")"
      case "$codename" in
        ''|*[!a-z0-9-]*) fail "Cannot determine a valid $distro_id release codename for Docker's repository." ;;
      esac
      arch="$(dpkg --print-architecture)" || fail "Failed to determine the host package architecture."
      info "Installing Docker Engine and Compose from Docker's $distro_id repository"
      sudo apt-get update -y || fail "Failed to refresh apt package indexes."
      sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl || fail "Failed to install Docker repository prerequisites."
      sudo install -m 0755 -d /etc/apt/keyrings || fail "Failed to create Docker's keyring directory."
      sudo curl -fsSL "https://download.docker.com/linux/$distro_id/gpg" -o /etc/apt/keyrings/docker.asc || fail "Failed to download Docker's repository key."
      sudo chmod a+r /etc/apt/keyrings/docker.asc || fail "Failed to set Docker repository key permissions."
      printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$distro_id" "$codename" "$arch" \
        | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null || fail "Failed to configure Docker's apt repository."
      sudo apt-get update -y || fail "Failed to refresh Docker's apt repository."
      sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || fail "Failed to install Docker Engine and Compose; no Engine-only fallback was attempted."
      ;;
    fedora|rhel|centos)
      for package in docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-selinux docker-engine-selinux docker-engine podman-docker moby-engine containerd runc; do
        if rpm -q "$package" >/dev/null 2>&1; then
          fail "Existing package '$package' conflicts with fresh Docker Engine setup. Have the host administrator reconcile the runtime packages using https://docs.docker.com/engine/install/$distro_id/ and re-run; DPF will not remove them."
        fi
      done
      info "Installing Docker Engine and Compose from Docker's $distro_id repository"
      # Fetch the official repo file directly to work with both dnf4 and dnf5.
      sudo curl -fsSL "https://download.docker.com/linux/$distro_id/docker-ce.repo" -o /etc/yum.repos.d/docker-ce.repo || fail "Failed to configure Docker's RPM repository."
      sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || fail "Failed to install Docker Engine and Compose; no Engine-only fallback was attempted."
      ;;
    *)
      fail "Unsupported Linux distro for automated Docker install: $distro_id. Install Docker Engine manually (https://docs.docker.com/engine/install/) and re-run."
      ;;
  esac

  dpf_docker_require_compose
  command -v systemctl >/dev/null 2>&1 || fail "systemctl is required for automated Docker service setup."
  sudo systemctl enable --now docker || fail "Failed to enable and start Docker's system service."
  sudo docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable after starting its system service."

  # Add the invoking user to the docker group so non-sudo docker
  # commands work in the subsequent session. We DO NOT call newgrp
  # automatically (per the roadmap: "no magical newgrp dependency
  # unless tested"). The installer reports the requirement explicitly.
  local target_user="${SUDO_USER:-$USER}"
  if [ -n "$target_user" ] && [ "$target_user" != "root" ]; then
    sudo usermod -aG docker "$target_user" || fail "Failed to add '$target_user' to the docker group."
    warn "Added '$target_user' to the docker group."
    info "  Log out and back in (or run 'newgrp docker') before continuing,"
    info "  then re-run install-dpf.sh to complete the install."
    return 75  # EX_TEMPFAIL-ish: caller should exit and ask operator to re-run
  fi
  return 0
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

  # Ensure the bundled CLI is reachable before any version check or
  # daemon poll — Docker Desktop writes /usr/local/bin symlinks only
  # after its first successful launch, so on a fresh install the CLI
  # is only in the .app bundle.
  if [ "$DPF_PLATFORM" = "darwin" ]; then
    _dpf_docker_prepend_bundled_path
  fi

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
        open /Applications/Docker.app
        local wait_seconds="${DPF_DOCKER_DESKTOP_START_TIMEOUT:-300}"
        local elapsed=0
        while [ "$elapsed" -lt "$wait_seconds" ]; do
          if docker info >/dev/null 2>&1; then
            dpf_docker_require_compose
            ok "Docker daemon reachable after ${elapsed}s"
            return 0
          fi
          sleep 5
          elapsed=$((elapsed + 5))
        done
        fail "Docker Desktop did not become reachable within ${wait_seconds}s. Open Docker.app, complete any first-run prompts, and re-run install-dpf.sh."
      fi
      # No Docker.app — install via .dmg.
      dpf_docker_install_darwin || return $?
      dpf_docker_require_compose
      return 0
    fi
    fail "Unsupported platform for Docker install: $DPF_PLATFORM"
  fi

  if ! dpf_docker_version_ge "$version" "$DPF_DOCKER_MIN_VERSION"; then
    fail "Docker $version is below the supported floor ($DPF_DOCKER_MIN_VERSION+; host-gateway support required). Upgrade Docker Engine / Docker Desktop and re-run install-dpf.sh."
  fi

  ok "Docker $version present"
  dpf_docker_require_compose

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
