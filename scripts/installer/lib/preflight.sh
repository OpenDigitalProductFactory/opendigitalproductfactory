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

# ── Docker memory preflight ───────────────────────────────────────────────
# The Next.js production build needs ~4 GB of Node.js heap
# (NODE_OPTIONS=--max-old-space-size=4096). With parallel image builds and
# OS overhead the Docker VM needs at least 6 GB total. Docker Desktop on
# Windows defaults to 2 GB — catch this early rather than letting the build
# OOM silently inside the container.

DPF_DOCKER_MIN_MEM_MB="${DPF_DOCKER_MIN_MEM_MB:-6144}"   # 6 GB hard floor
DPF_DOCKER_WARN_MEM_MB="${DPF_DOCKER_WARN_MEM_MB:-8192}" # 8 GB soft target

# ── ...and a ceiling. ─────────────────────────────────────────────────────
# The floor check above is one-sided: the more memory the VM is given, the
# happier it is. That is wrong on macOS, and it cost nine fenced builds on a
# 128 GB host configured with a 68.5 GiB Docker VM running 3.5 GB of
# containers.
#
# The platform difference is architectural, not capacity:
#
#   Windows (WSL2)  the VM sizes dynamically and, since WSL 2.0,
#                   autoMemoryReclaim returns freed pages to Windows. A
#                   generous ceiling costs little because it is given back.
#   macOS (VZ)      a FIXED-size Apple Virtualization VM. Its resident size
#                   grows toward the ceiling as pages are touched and is
#                   NEVER returned to the host. Over-allocation ratchets
#                   until the host starves.
#
# Starving the host does not break the install — it breaks the local-CI
# capacity watchdog later, with `host-capacity-lost:host-memory-low` and no
# hint as to why. So this warns loudly with the actual remedy rather than
# refusing: the install itself is fine.
DPF_DOCKER_MAX_MEM_FRACTION="${DPF_DOCKER_MAX_MEM_FRACTION:-50}"  # percent of host RAM

# Host physical memory in MB, or 0 when it cannot be determined.
_dpf_host_mem_mb() {
  if [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
    local bytes
    bytes="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
    echo $(( bytes / 1048576 ))
  elif [ -r /proc/meminfo ]; then
    awk '/^MemTotal:/ { print int($2 / 1024); exit }' /proc/meminfo 2>/dev/null || echo 0
  else
    echo 0
  fi
}

dpf_preflight_docker_memory() {
  if ! command -v docker >/dev/null 2>&1; then
    return 0  # docker.sh will handle a missing daemon later
  fi
  if ! docker info >/dev/null 2>&1; then
    return 0  # daemon not running yet; docker.sh will start it
  fi

  local mem_bytes mem_mb
  mem_bytes="$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)"
  mem_mb=$(( mem_bytes / 1048576 ))

  if [ "$mem_mb" -lt "$DPF_DOCKER_MIN_MEM_MB" ] 2>/dev/null; then
    if [ "${DPF_FORCE_UNSUPPORTED_HOST:-0}" = "1" ]; then
      warn "Docker VM memory is ${mem_mb} MB (minimum: ${DPF_DOCKER_MIN_MEM_MB} MB), but DPF_FORCE_UNSUPPORTED_HOST=1 — proceeding."
      return 0
    fi
    printf '\n%bInsufficient Docker memory.%b\n' "${DPF_RED:-}" "${DPF_NC:-}" >&2
    printf '  %bReason:%b Docker VM has %s MB; the Next.js build requires at least %s MB.\n' \
      "${DPF_YELLOW:-}" "${DPF_NC:-}" "$mem_mb" "$DPF_DOCKER_MIN_MEM_MB" >&2
    printf '  %bNext:%b   Open Docker Desktop → Settings → Resources → Memory and set it to 8 GB, then re-run.\n' \
      "${DPF_YELLOW:-}" "${DPF_NC:-}" >&2
    printf '\n  Override (advanced): DPF_FORCE_UNSUPPORTED_HOST=1 bash %s\n\n' "$0" >&2
    return 64
  fi

  if [ "$mem_mb" -lt "$DPF_DOCKER_WARN_MEM_MB" ] 2>/dev/null; then
    warn "Docker VM memory is ${mem_mb} MB. 8 GB+ is recommended for parallel image builds."
    info "  To increase: Docker Desktop → Settings → Resources → Memory."
  else
    ok "Docker VM memory: ${mem_mb} MB"
  fi

  # Ceiling: an over-allocated VM starves the host it runs on.
  local host_mb ceiling_mb
  host_mb="$(_dpf_host_mem_mb)"
  if [ "${host_mb:-0}" -gt 0 ] 2>/dev/null; then
    ceiling_mb=$(( host_mb * DPF_DOCKER_MAX_MEM_FRACTION / 100 ))
    if [ "$mem_mb" -gt "$ceiling_mb" ] 2>/dev/null; then
      warn "Docker VM memory is ${mem_mb} MB of ${host_mb} MB host RAM (over ${DPF_DOCKER_MAX_MEM_FRACTION}%)."
      if [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then
        info "  On macOS the Docker VM never returns memory to the host, so this ratchets"
        info "  upward until builds fail with host-capacity-lost:host-memory-low."
        info "  Fix: Docker Desktop -> Settings -> Resources -> Memory. 16-24 GB is ample;"
        info "  DPF containers use around 4 GB and the rest is build headroom."
      else
        info "  WSL2 reclaims freed memory, so this is usually benign — but an explicit"
        info "  memory= in %USERPROFILE%\\.wslconfig pins it. Remove it, or lower it, and"
        info "  run: wsl --shutdown"
      fi
    fi
  fi
  return 0
}

# ── Port-conflict preflight ────────────────────────────────────────────────
# Catches the most common fresh-host install failure: port 3000 is
# already taken by some local dev process (Next.js, Grafana, Hubot,
# etc.). Detected at preflight rather than letting `docker compose up`
# bomb out with an opaque "address already in use" message later.
#
# Only the portal port (3000 by default) is gated; the rest of the
# stack's host ports are too noisy for a hard refusal (operators
# routinely run other DBs / monitoring tools on overlapping ports
# without it actually conflicting with DPF's docker-proxy binds).

# Detect whether $1 is bound LISTEN by some local process.
# Returns 0 if bound, 1 if free, 2 if no detection tool is available.
_dpf_port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  elif command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}$"
    return $?
  elif command -v netstat >/dev/null 2>&1; then
    netstat -anP tcp 2>/dev/null | grep -qE "[.:]${port}[[:space:]]+.*LISTEN" \
      || netstat -an 2>/dev/null | grep -qE "[.:]${port}[[:space:]]+.*LISTEN"
    return $?
  fi
  return 2  # no detection tool
}

# Best-effort: return the command name holding $1.
_dpf_port_holder() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -F c 2>/dev/null \
      | awk -F'^c' '/^c/ {print $2; exit}'
    return 0
  fi
  echo "unknown"
}

# Public: refuse to proceed if the portal port is bound by a non-DPF
# process. Override with DPF_PORT_CONFLICTS_IGNORE=1.
# Args: $1 = portal port (default 3000)
dpf_preflight_port_conflicts() {
  local primary_port="${1:-${DPF_PORTAL_PORT:-3000}}"

  local rc=0
  _dpf_port_in_use "$primary_port" || rc=$?
  case "$rc" in
    1) return 0 ;;   # port free
    2)               # no detection tool — best effort, allow
       info "No lsof/ss/netstat available; skipping port-conflict preflight."
       return 0 ;;
    0) : ;;          # port in use — investigate
  esac

  # In use. Is it our existing stack?
  # We use multiple strategies because:
  # - On macOS Docker Desktop the host listener is always owned by
  #   com.docker.backend (or vpnkit) for *any* published container port.
  # - `docker compose -p dpf ps -q` can be empty due to cwd, COMPOSE_FILE,
  #   env, partial restarts, or project metadata quirks even when containers
  #   are running and publishing the port.
  # Authoritative signals are the actual containers + their publish + labels.
  local is_our_stack=0
  if command -v docker >/dev/null 2>&1; then
    # Original compose project query (fast path when it works)
    if docker compose -p dpf ps -q 2>/dev/null | grep -q .; then
      is_our_stack=1
    fi
    # Robust: a dpf-* container is publishing this exact port (covers the
    # common case where lsof shows com.docker.backend).
    if [ "$is_our_stack" -eq 0 ]; then
      if docker ps --filter "publish=${primary_port}" --format '{{.Names}}' 2>/dev/null | grep -qE '^dpf-'; then
        is_our_stack=1
      fi
    fi
    # Strongest: compose-launched container for project "dpf" publishing it
    # (label survives even if name filter is odd).
    if [ "$is_our_stack" -eq 0 ]; then
      if docker ps --filter "label=com.docker.compose.project=dpf" \
                    --filter "publish=${primary_port}" -q 2>/dev/null | grep -q .; then
        is_our_stack=1
      fi
    fi
  fi

  if [ "$is_our_stack" -eq 1 ]; then
    info "Port ${primary_port} is bound, but an existing DPF stack is running — re-install will reuse it."
    return 0
  fi

  local holder; holder="$(_dpf_port_holder "$primary_port" 2>/dev/null || true)"
  [ -z "$holder" ] && holder="unknown"

  if [ "${DPF_PORT_CONFLICTS_IGNORE:-0}" = "1" ]; then
    warn "Port ${primary_port} is bound by '${holder}', but DPF_PORT_CONFLICTS_IGNORE=1 — proceeding (compose up may still fail)."
    return 0
  fi

  printf '\n%bPort conflict detected.%b\n' "${DPF_RED:-}" "${DPF_NC:-}" >&2
  printf '  %bReason:%b Port %s is bound by ''%s'' (no DPF container publishing it).\n' \
    "${DPF_YELLOW:-}" "${DPF_NC:-}" "$primary_port" "$holder" >&2
  printf '  %bNext:%b   Stop that process, or set DPF_PORTAL_PORT to an unused port before re-running.\n' \
    "${DPF_YELLOW:-}" "${DPF_NC:-}" >&2
  printf '\n  Override (advanced): DPF_PORT_CONFLICTS_IGNORE=1 bash %s\n\n' "$0" >&2
  return 64
}
