#!/usr/bin/env bash
# Install-state file management for the DPF installer.
# Source this file; do not execute directly.
#
# Reads, writes, and migrates ~/.dpf/install-state.json. Schema lives at
# scripts/installer/install-state.schema.json. Per the deployment
# doctrine (Contract 2: runtime configuration; Contract 3: lifecycle).
#
# Bash 3.2 baseline.

if [ "${DPF_LIB_STATE_LOADED:-}" = "1" ]; then
  return 0
fi
DPF_LIB_STATE_LOADED=1

# Source platform.sh for dpf_platform / dpf_arch.
if [ -z "${DPF_LIB_PLATFORM_LOADED:-}" ]; then
  # shellcheck source=platform.sh
  . "$(dirname "${BASH_SOURCE[0]}")/platform.sh"
fi

# Current schema version this installer expects. Bump when adding
# required fields or breaking-changing existing field semantics.
DPF_STATE_SCHEMA_VERSION=1

# Resolve state directory honoring XDG_STATE_HOME on Linux.
dpf_state_dir() {
  if [ -n "${DPF_STATE_DIR:-}" ]; then
    echo "${DPF_STATE_DIR}"
  elif [ -n "${XDG_STATE_HOME:-}" ]; then
    echo "${XDG_STATE_HOME}/dpf"
  else
    echo "${HOME}/.dpf"
  fi
}

dpf_state_path() {
  echo "$(dpf_state_dir)/install-state.json"
}

dpf_state_transaction_path() {
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  echo "$(dirname "$lib_dir")/install-state-transaction.mjs"
}

# Initialize a fresh state file at the canonical path. Idempotent —
# returns 0 silently if file already exists.
# Args: $1 = installerVersion, $2 = installPath
dpf_state_init() {
  local installer_version="${1:-unknown}"
  local install_path="${2:-$(pwd)}"
  local state_dir; state_dir="$(dpf_state_dir)"
  local path; path="$(dpf_state_path)"

  mkdir -p "$state_dir"
  dpf_platform
  dpf_arch

  # Build the initial JSON. Keep it shell-only for bash 3.2 portability;
  # don't reach for jq here so the install can bootstrap on hosts that
  # haven't installed jq yet.
  local initial_json
  initial_json=$(cat <<EOF
{
  "schemaVersion": ${DPF_STATE_SCHEMA_VERSION},
  "installerVersion": "${installer_version}",
  "lastSuccessfulInstallVersion": null,
  "lastSuccessfulComposeHash": null,
  "composeProjectName": "dpf",
  "enabledRuntimeCapabilities": [],
  "capabilityCatalogHash": null,
  "capabilityStateVersion": null,
  "platform": "${DPF_PLATFORM}",
  "arch": "${DPF_ARCH}",
  "dockerContext": null,
  "dockerEndpoint": null,
  "installPath": "${install_path}",
  "stateDir": "${state_dir}",
  "installMode": null,
  "composeFiles": [],
  "edge": { "enabled": false, "mode": null },
  "imageTag": null,
  "llmProvider": null,
  "resourceLabels": { "dpf": "true" },
  "autostart": { "enabled": false, "kind": "none" },
  "lastHealthCheck": null,
  "lastBackupAt": null,
  "lastDoctorBundlePath": null
}
EOF
)
  local encoded
  encoded="$(printf '%s' "$initial_json" | base64 | tr -d '\r\n')"
  node "$(dpf_state_transaction_path)" init --state "$path" --value "$encoded" || return 1
  chmod 600 "$path" 2>/dev/null || true
}

# Read a top-level key from the state file. Uses jq if available,
# falling back to python3, falling back to a grep-based read for
# top-level scalar keys only. Emits empty string for missing keys.
# Args: $1 = key
dpf_state_read() {
  local key="$1"
  local path; path="$(dpf_state_path)"
  if [ ! -f "$path" ]; then
    return 0
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$key" '.[$k] // ""' "$path"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import json,sys; d=json.load(open('$path')); v=d.get('$key',''); print('' if v is None else (v if isinstance(v,str) else json.dumps(v)))"
  else
    # Last-resort scalar grep (string and number top-level fields).
    # Anchor the value extraction on the key, not on ".*:" — a greedy
    # ".*:" matches through to the LAST colon on the line, which mangles
    # values that themselves contain a colon (e.g. dockerEndpoint's
    # "unix:///var/run/docker.sock" would lose its "unix:" prefix).
    grep -E "\"${key}\"[[:space:]]*:" "$path" | head -1 \
      | sed -E "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"?([^\",}]*)\"?.*/\1/"
  fi
}

# Write a top-level scalar (string or number) to the state file.
# Numbers (no quotes) require value matching ^-?[0-9.]+$; everything
# else is treated as a string and quoted. For object/array fields,
# use jq directly via dpf_state_jq_set.
# Args: $1 = key, $2 = value
dpf_state_write() {
  local key="$1"
  local value="$2"
  local path; path="$(dpf_state_path)"
  if [ ! -f "$path" ]; then
    echo "dpf_state_write: state file missing; call dpf_state_init first" >&2
    return 1
  fi
  if command -v jq >/dev/null 2>&1; then
    local json_value
    if [ "$value" = "true" ] || [ "$value" = "false" ] || [ "$value" = "null" ]; then
      json_value="$value"
    elif echo "$value" | grep -qE '^-?[0-9]+(\.[0-9]+)?$'; then
      json_value="$value"
    else
      json_value="$(printf '%s' "$value" | jq -Rs .)"
    fi
    node "$(dpf_state_transaction_path)" set --state "$path" --key "$key" --value "$json_value" || return 1
    chmod 600 "$path" 2>/dev/null || true
  elif command -v python3 >/dev/null 2>&1; then
    local json_value
    if [ "$value" = "true" ] || [ "$value" = "false" ] || [ "$value" = "null" ] || echo "$value" | grep -qE '^-?[0-9]+(\.[0-9]+)?$'; then
      json_value="$value"
    else
      json_value="$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$value")"
    fi
    node "$(dpf_state_transaction_path)" set --state "$path" --key "$key" --value "$json_value" || return 1
    chmod 600 "$path" 2>/dev/null || true
  else
    echo "dpf_state_write: needs jq or python3 to update JSON" >&2
    return 1
  fi
}

# Validate the state file's schema version. Returns 0 if matches the
# installer's expected version; non-zero with a clear message if the
# file is from a future installer version (refuse) or older version
# (caller should run migration).
# Args: none
dpf_state_validate() {
  local path; path="$(dpf_state_path)"
  if [ ! -f "$path" ]; then
    return 2  # No state — fresh install
  fi
  local file_ver; file_ver="$(dpf_state_read schemaVersion)"
  if [ -z "$file_ver" ]; then
    echo "dpf_state_validate: state file at $path has no schemaVersion; treating as fresh." >&2
    return 2
  fi
  if [ "$file_ver" -gt "$DPF_STATE_SCHEMA_VERSION" ] 2>/dev/null; then
    echo "dpf_state_validate: state file is from a newer installer (schema $file_ver > $DPF_STATE_SCHEMA_VERSION). Update install-dpf.sh and re-run." >&2
    return 1
  fi
  if [ "$file_ver" -lt "$DPF_STATE_SCHEMA_VERSION" ] 2>/dev/null; then
    return 3  # Older — caller should run migration
  fi
  return 0
}

# Forward-migrate the state file. Currently a stub since
# DPF_STATE_SCHEMA_VERSION=1; future versions add cases here.
# Args: none
dpf_state_migrate() {
  local file_ver; file_ver="$(dpf_state_read schemaVersion)"
  echo "dpf_state_migrate: migrating state from schema $file_ver to $DPF_STATE_SCHEMA_VERSION"
  # Future: per-version migration cases.
  # case "$file_ver" in
  #   1) <migrate from 1 to 2> ;;
  # esac
  dpf_state_write schemaVersion "$DPF_STATE_SCHEMA_VERSION"
}

# Write a top-level key whose value is a JSON object/array/literal. Used by
# the agent-toolchain bootstrap (Phase 4 of BI-4B17051B) to persist the
# agentToolchain block. Differs from dpf_state_write in that it parses the
# value as JSON rather than coercing it to a string.
#
# Args: $1 = key, $2 = JSON-encoded value (object / array / true / false / null / number / string)
dpf_state_write_json() {
  local key="$1"
  local value="$2"
  local path; path="$(dpf_state_path)"
  if [ ! -f "$path" ]; then
    echo "dpf_state_write_json: state file missing; call dpf_state_init first" >&2
    return 1
  fi
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$value" | jq -e . >/dev/null
    node "$(dpf_state_transaction_path)" set --state "$path" --key "$key" --value "$value" || return 1
    chmod 600 "$path" 2>/dev/null || true
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; json.loads(sys.argv[1])' "$value"
    node "$(dpf_state_transaction_path)" set --state "$path" --key "$key" --value "$value" || return 1
    chmod 600 "$path" 2>/dev/null || true
    return 0
  fi
  echo "dpf_state_write_json: needs jq or python3 to update JSON object/array values" >&2
  return 1
}

# Print the one canonical machine-readable capability/profile projection and
# migrate a previous-release snapshot atomically. Callers must not duplicate
# capability service/profile lists in shell.
dpf_resolve_capability_compose_profiles() {
  local root="${1:-${REPO_ROOT:-$(pwd)}}" host="" write_arg="--write"
  [ "$#" -gt 0 ] && shift
  host="${1:-}"
  [ "$#" -gt 0 ] && shift
  [ -n "$host" ] || { dpf_platform; host="$DPF_PLATFORM"; }
  [ "$host" = "darwin" ] && host="macos"
  [ "${DPF_DRY_RUN:-0}" = "1" ] && write_arg=""
  node "$root/scripts/lib/resolve-capability-compose-profiles.mjs" \
    --state "$(dpf_state_path)" --host "$host" --migrate ${write_arg:+$write_arg} "$@"
}

# Resolve whether the bundled local Edge Node overlay should be active for
# THIS install (the deploy gate, BI-72CFF89D / edge-topology design §5).
# Edge deployment is OPT-IN: default OFF unless explicitly chosen or
# grandfathered. Precedence:
#   1. explicit DPF_INCLUDE_EDGE=0|1 in the environment (flags set this)
#   2. recorded choice in install-state.json (.edge.enabled)
#   3. grandfather: no recorded choice but .env carries a bundled-node
#      bootstrap token (a pre-flip install) -> keep it ON so an upgrade
#      never silently removes a running node (design §5.3)
#   4. default OFF
# Echoes "1" (include) or "0" (skip). $1 = install/repo root (for .env).
dpf_resolve_edge_enabled() {
  local root="${1:-${REPO_ROOT:-.}}"
  case "${DPF_INCLUDE_EDGE:-}" in
    0|1) echo "${DPF_INCLUDE_EDGE}"; return 0 ;;
  esac
  local path enabled=""
  path="$(dpf_state_path)"
  if [ -f "$path" ]; then
    if command -v jq >/dev/null 2>&1; then
      enabled="$(jq -r '.edge.enabled // empty' "$path" 2>/dev/null)"
    elif command -v python3 >/dev/null 2>&1; then
      enabled="$(python3 -c "import json;d=json.load(open('$path'));e=d.get('edge') or {};v=e.get('enabled');print('' if v is None else ('1' if v else '0'))" 2>/dev/null)"
    fi
  fi
  case "$enabled" in
    true|1)  echo 1; return 0 ;;
    false|0) echo 0; return 0 ;;
  esac
  # No recorded choice — grandfather a pre-flip install that already has a
  # bundled node (its .env carries the installer-issued bootstrap token).
  if [ -f "$root/.env" ] && grep -qE '^DPF_BOOTSTRAP_TOKEN=dpf' "$root/.env" 2>/dev/null; then
    echo 1; return 0
  fi
  echo 0
}
