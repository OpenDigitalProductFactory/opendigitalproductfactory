#!/usr/bin/env bash
# Diagnostic bundle generator for DPF installations.
# Source this file; do not execute directly.
#
# Per the installer-parity roadmap Phase 6: ship a minimum dpf doctor
# alongside the installer skeleton so early macOS / Linux installs
# don't write bug reports in fog.
#
# Bundle contents (per Doctrine maturity-gate):
#   - Host OS + arch
#   - Docker version + context + info
#   - Compose -f chain (via compose.sh helper) + rendered config sha256
#   - install-state.json (redacted)
#   - docker compose ps
#   - tail -200 of core service logs (portal and postgres)
#   - Port-conflict scan
#   - LLM provider reachability
#   - Redacted env summary
#
# Output: tarball at $(dpf_state_dir)/doctor-<timestamp>.tar.gz plus
# a human-readable summary on stdout.
#
# Bash 3.2 baseline.

if [ "${DPF_LIB_DOCTOR_LOADED:-}" = "1" ]; then
  return 0
fi
DPF_LIB_DOCTOR_LOADED=1

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
# Supplementary diagnostics module (Phase 10d) adds autostart unit
# state, full rendered compose YAML, disk space, DNS reachability, and
# state-dir perms snapshot. Optional — older installs missing the file
# silently fall back to the Phase-6 core bundle.
if [ -z "${DPF_LIB_DIAGNOSTICS_LOADED:-}" ]; then
  if [ -f "$(dirname "${BASH_SOURCE[0]}")/diagnostics.sh" ]; then
    # shellcheck source=diagnostics.sh
    . "$(dirname "${BASH_SOURCE[0]}")/diagnostics.sh"
  fi
fi

# Redact common secret patterns from env / state output. Replaces values
# of any line matching SECRET|PASSWORD|TOKEN|KEY|AUTH (case-insensitive)
# with "***REDACTED***".
_dpf_doctor_redact() {
  sed -E 's/((SECRET|PASSWORD|TOKEN|KEY|AUTH)[A-Z_]*)(=|: )(.*)$/\1\3***REDACTED***/Ig'
}

# Redact secret VALUES wherever they appear, not only on their own key's line.
#
# Key-name redaction alone cannot see a secret embedded in another value. The
# common case is the password inside a connection string --
# DATABASE_URL=postgres://dpf:<password>@host -- whose key name matches none of
# the secret patterns above. Seeded from .env, which is what
# `docker compose config` interpolates from, so the values found here are
# exactly the ones the rendered output can contain.
#
# Values shorter than 8 characters are skipped: redacting "1", "true" or "dev"
# would corrupt the bundle for no gain. Passthrough when there is no readable
# env file or nothing to redact. Bash 3.2 baseline.
_dpf_doctor_redact_values() {
  local env_file="${1:-.env}"
  [ -r "$env_file" ] || { cat; return 0; }
  local script
  script="$(
    grep -Ei '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*(SECRET|PASSWORD|TOKEN|KEY|AUTH|PW)[A-Za-z0-9_]*=' "$env_file" 2>/dev/null \
      | sed -e 's/^[^=]*=//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//" \
      | awk 'length($0) >= 8' \
      | sort -u \
      | sed -e 's/[][\.*^$\/]/\\&/g' -e 's|^|s/|' -e 's|$|/***REDACTED***/g|'
  )"
  [ -n "$script" ] || { cat; return 0; }
  sed "$script"
}

# Common ports DPF binds. Used by the conflict scan.
_DPF_DOCTOR_PORTS="3000 3001 3002 3035 5432 8080 8500 8600 8700 9090 9100 9182 9187 11434 1455"

dpf_doctor_collect() {
  # Diagnostic gathering is best-effort. Many shell-outs (docker info
  # without daemon, compose config without .env, lsof/ss without those
  # tools installed) fail naturally; relax set -e for the duration so
  # partial bundles always produce useful output instead of aborting.
  set +e

  local timestamp; timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local state_dir; state_dir="$(dpf_state_dir)"
  local bundle_dir; bundle_dir="$(mktemp -d)"
  local tarball="${state_dir}/doctor-${timestamp}.tar.gz"

  mkdir -p "$state_dir"

  step "Collecting diagnostic bundle"

  # 1. Host info
  {
    echo "uname -a:"
    uname -a 2>&1
    echo
    echo "uname -srm:"
    uname -srm 2>&1
    echo
    if [ -r /etc/os-release ]; then
      echo "/etc/os-release:"
      cat /etc/os-release 2>&1
    fi
    if [ "$(uname -s)" = "Darwin" ]; then
      echo "sw_vers:"
      sw_vers 2>&1 || true
    fi
  } > "$bundle_dir/host.txt"

  # 2. Docker
  {
    echo "docker --version:"
    docker --version 2>&1 || true
    echo
    echo "docker context show:"
    docker context show 2>&1 || true
    echo
    echo "docker context inspect:"
    docker context inspect 2>&1 || true
    echo
    echo "docker info:"
    docker info 2>&1 || true
  } > "$bundle_dir/docker.txt"

  # 3. Compose chain + rendered config hash
  {
    if dpf_compose_files "${1:-dev}" 2>/dev/null; then
      echo "compose chain: ${DPF_COMPOSE_FILES[*]}"
      echo
      echo "rendered config sha256:"
      docker compose "${DPF_COMPOSE_FILES[@]}" config 2>/dev/null | sha256sum 2>/dev/null || echo "(unable to render — see container status)"
    else
      echo "(unable to assemble compose chain)"
    fi
  } > "$bundle_dir/compose.txt"

  # 4. install-state.json (redacted)
  if [ -f "$(dpf_state_path)" ]; then
    _dpf_doctor_redact < "$(dpf_state_path)" > "$bundle_dir/install-state.redacted.json"
  fi

  # 5. docker compose ps
  if dpf_compose_files "${1:-dev}" 2>/dev/null; then
    docker compose "${DPF_COMPOSE_FILES[@]}" ps 2>&1 > "$bundle_dir/compose-ps.txt" || true
  fi

  # 6. Core service logs (last 200 lines each)
  mkdir -p "$bundle_dir/logs"
  for svc in portal postgres; do
    if dpf_compose_files "${1:-dev}" 2>/dev/null; then
      docker compose "${DPF_COMPOSE_FILES[@]}" logs --tail=200 "$svc" 2>&1 > "$bundle_dir/logs/$svc.log" || true
    fi
  done

  # 7. Port-conflict scan
  {
    echo "Listening ports on common DPF binds:"
    echo
    for p in $_DPF_DOCTOR_PORTS; do
      local who
      if command -v lsof >/dev/null 2>&1; then
        who="$(lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{print $1, $2}' | sort -u | tr '\n' '; ')"
      elif command -v ss >/dev/null 2>&1; then
        who="$(ss -ltn "sport = :$p" 2>/dev/null | tail -n +2 | awk '{print $4}')"
      fi
      if [ -n "$who" ]; then
        echo "  $p: $who"
      fi
    done
  } > "$bundle_dir/ports.txt"

  # 8. LLM provider reachability
  {
    local llm_url="${LLM_BASE_URL:-http://model-runner.docker.internal/v1}"
    echo "LLM_BASE_URL: $llm_url"
    echo "DPF_LLM_PROVIDER: ${DPF_LLM_PROVIDER:-(auto-detect)}"
    echo
    if curl --silent --max-time 5 --output /dev/null --write-out "GET /models -> HTTP %{http_code} (%{time_total}s)\n" "${llm_url}/models" 2>&1; then
      :
    else
      echo "GET /models -> unreachable"
    fi
  } > "$bundle_dir/llm.txt"

  # 9. Redacted env summary (snapshot of known DPF envvars)
  {
    echo "DPF-related environment variables (redacted):"
    env | grep -iE '^(DPF_|LLM_|EMBEDDING_|BROWSER_USE_|GHCR_|POSTGRES_|AUTH_|ADMIN_|MCP_|DOCKER_)' \
      | _dpf_doctor_redact | sort
  } > "$bundle_dir/env.txt"

  # 10. Phase 10d supplementary diagnostics — autostart unit, full
  #     rendered compose YAML, disk usage, outbound reachability, perms.
  #     Best-effort; module is optional so older installs still work.
  if command -v dpf_diagnostics_collect >/dev/null 2>&1; then
    dpf_diagnostics_collect "$bundle_dir" "${1:-dev}" 2>/dev/null || true
  fi

  # Bundle and stamp the install-state with the bundle path.
  tar -czf "$tarball" -C "$bundle_dir" . 2>/dev/null
  rm -rf "$bundle_dir"

  if [ -f "$(dpf_state_path)" ]; then
    dpf_state_write lastDoctorBundlePath "$tarball" 2>/dev/null || true
  fi

  ok "Bundle written: $tarball"
  echo
  echo "  Send this file to support, or attach it to a GitHub issue."
  echo "  Secrets are redacted; review before sending to confirm."
  echo
  echo "$tarball"

  # Restore strict mode for the caller.
  set -e
}
