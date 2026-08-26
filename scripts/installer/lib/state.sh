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
DPF_STATE_SCHEMA_VERSION=2

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

dpf_state_validator_path() {
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  echo "$(dirname "$lib_dir")/validate-install-state.mjs"
}

dpf_state_migrator_path() {
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  echo "$(dirname "$lib_dir")/migrate-install-state.mjs"
}

dpf_state_catalog_path() {
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  echo "$(dirname "$(dirname "$lib_dir")")/lib/capability-service-catalog.generated.json"
}

dpf_state_owner_id() {
  if command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'; else echo "$$-$(date +%s)-${RANDOM:-0}"; fi
}

dpf_state_rfc3339_epoch() {
  if date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ >/dev/null 2>&1; then date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ
  else date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; fi
}

dpf_state_active_reclaim_first() {
  local lock="$1" now ticket expiry target current ticket_pid ticket_host local_host
  now="$(date +%s)"
  local_host="$(hostname)"
  current="$(sed -n 's/.*"ownerId":"\([^"]*\)".*/\1/p' "$lock" 2>/dev/null)"
  for ticket in "${lock}.reclaim-"*; do
    [ -f "$ticket" ] || continue
    target="$(sed -n 's/.*"targetOwnerId":"\([^"]*\)".*/\1/p' "$ticket" 2>/dev/null)"
    [ -n "$current" ] && [ "$target" = "$current" ] || continue
    expiry="$(sed -n 's/.*"expiresAtEpoch":\([0-9][0-9]*\).*/\1/p' "$ticket" 2>/dev/null)"
    ticket_pid="$(sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "$ticket" 2>/dev/null)"; ticket_host="$(sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p' "$ticket" 2>/dev/null)"
    if { [ -n "$expiry" ] && [ "$expiry" -gt "$now" ]; } || { [ "$ticket_host" = "$local_host" ] && kill -0 "$ticket_pid" 2>/dev/null; }; then echo "$ticket"; return 0; fi
  done
  return 1
}

dpf_state_lock_acquire() {
  local path="$1" lock="${1}.lock" owner_id run_id host now expires deadline
  owner_id="$(dpf_state_owner_id)"; run_id="${DPF_RUN_ID:-$(dpf_state_owner_id)}"; host="$(hostname)"; deadline=$(( $(date +%s) + ${DPF_STATE_LOCK_TIMEOUT_SECONDS:-30} ))
  while :; do
    # Both deadline paths in this function mean the same thing -- we gave up
    # waiting for the install-state lock -- so both must say so. This one used
    # to `return 1` bare, which install-dpf.sh surfaces as an unexplained exit 1
    # under `set -euo pipefail`: the exact undiagnosable shape #4367 fixed on the
    # neighbouring cleanup path. The suffix distinguishes losing the reclaim race
    # from losing the lock-file race below.
    if dpf_state_active_reclaim_first "$lock" >/dev/null; then
      now="$(date +%s)"
      [ "$now" -ge "$deadline" ] && { echo "install_state_lock_timeout: reclaim in progress by another install on $lock" >&2; return 1; }
      sleep 0.05
      continue
    fi
    if ( set -C; : > "$lock" ) 2>/dev/null; then
      if dpf_state_active_reclaim_first "$lock" >/dev/null; then rm -f "$lock"; sleep 0.05; continue; fi
      break
    fi
    now="$(date +%s)"
    local lock_expires lock_pid lock_host
    lock_expires="$(sed -n 's/.*"expiresAtEpoch":\([0-9][0-9]*\).*/\1/p' "$lock" 2>/dev/null)"
    lock_pid="$(sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "$lock" 2>/dev/null)"
    lock_host="$(sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p' "$lock" 2>/dev/null)"
    if [ -n "$lock_expires" ] && [ "$lock_expires" -le "$now" ] && { [ "$lock_host" != "$host" ] || ! kill -0 "$lock_pid" 2>/dev/null; }; then
      local stale_owner generation reclaim
      stale_owner="$(sed -n 's/.*"ownerId":"\([^"]*\)".*/\1/p' "$lock" 2>/dev/null)"
      generation="$(printf '%s' "$stale_owner" | { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; } | awk '{print substr($1,1,24)}')"
      local reclaim="${lock}.reclaim-${generation}"
      local reclaim_elected=0
      if ( set -C; : > "$reclaim" ) 2>/dev/null; then
        printf '{"protocolVersion":1,"ownerId":"%s","runId":"%s","targetOwnerId":"%s","pid":%s,"hostname":"%s","acquiredAt":"%s","expiresAt":"%s","expiresAtEpoch":%s}\n' "$owner_id" "$run_id" "$stale_owner" "$$" "$host" "$(dpf_state_rfc3339_epoch "$now")" "$(dpf_state_rfc3339_epoch "$((now + 5))")" "$((now + 5))" > "$reclaim"
        reclaim_elected=1
      else
        local reclaim_target reclaim_expiry reclaim_pid reclaim_host
        reclaim_target="$(sed -n 's/.*"targetOwnerId":"\([^"]*\)".*/\1/p' "$reclaim" 2>/dev/null)"; reclaim_expiry="$(sed -n 's/.*"expiresAtEpoch":\([0-9][0-9]*\).*/\1/p' "$reclaim" 2>/dev/null)"
        reclaim_pid="$(sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "$reclaim" 2>/dev/null)"; reclaim_host="$(sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p' "$reclaim" 2>/dev/null)"
        if [ "$reclaim_target" = "$stale_owner" ] && [ -n "$reclaim_expiry" ] && [ "$reclaim_expiry" -le "$now" ] && { [ "$reclaim_host" != "$host" ] || ! kill -0 "$reclaim_pid" 2>/dev/null; }; then reclaim_elected=1; fi
      fi
      if [ "$reclaim_elected" = 1 ]; then
        current="$(sed -n 's/.*"ownerId":"\([^"]*\)".*/\1/p' "$lock" 2>/dev/null)"; lock_expires="$(sed -n 's/.*"expiresAtEpoch":\([0-9][0-9]*\).*/\1/p' "$lock" 2>/dev/null)"
        if [ "$current" = "$stale_owner" ] && [ -n "$lock_expires" ] && [ "$lock_expires" -le "$now" ]; then mv "$lock" "${lock}.stale-${owner_id}" 2>/dev/null && rm -f "${lock}.stale-${owner_id}"; fi
        continue
      fi
    fi
    [ "$now" -ge "$deadline" ] && { echo "install_state_lock_timeout: lock held by another install on $lock" >&2; return 1; }
    sleep 0.05
  done
  now="$(date +%s)"; expires=$((now + 30))
  printf '{"protocolVersion":1,"ownerId":"%s","runId":"%s","pid":%s,"hostname":"%s","acquiredAt":"%s","expiresAt":"%s","expiresAtEpoch":%s}\n' "$owner_id" "$run_id" "$$" "$host" "$(dpf_state_rfc3339_epoch "$now")" "$(dpf_state_rfc3339_epoch "$expires")" "$expires" > "$lock"
  DPF_STATE_LOCK_OWNER_ID="$owner_id"; export DPF_STATE_LOCK_OWNER_ID
}

dpf_state_lock_release() {
  local lock="${1}.lock" current
  current="$(sed -n 's/.*"ownerId":"\([^"]*\)".*/\1/p' "$lock" 2>/dev/null)"
  if [ -n "$current" ] && [ "$current" = "${DPF_STATE_LOCK_OWNER_ID:-}" ]; then rm -f "$lock"; fi
}

dpf_state_cleanup_temps() {
  local path="$1" directory base temp
  directory="$(dirname "$path")"; base="$(basename "$path")"
  # No nullglob: an unmatched glob stays LITERAL, so on the common case -- a fresh
  # install with no leftover temps -- $temp is the pattern itself and `[ -f ]` is
  # false. As the loop's last command that made the whole function return 1, and
  # install-dpf.sh runs under `set -euo pipefail`, so a fresh install died right
  # after "No prior install state; initializing ..." with exit 1 and no message.
  # Guard with -e + continue, and return 0 explicitly so the exit status can never
  # be inherited from the final test again.
  for temp in "$directory/.${base}.tmp-"*; do
    [ -e "$temp" ] || continue
    rm -f "$temp"
  done
  return 0
}

dpf_state_temp_path() { echo "$(dirname "$1")/.$(basename "$1").tmp-${DPF_STATE_LOCK_OWNER_ID}"; }

dpf_state_validate_file() {
  node "$(dpf_state_validator_path)" "$1" >/dev/null
}

dpf_state_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

dpf_state_flush_file() {
  if command -v python3 >/dev/null 2>&1; then python3 -c 'import os,sys; f=open(sys.argv[1],"r+b"); os.fsync(f.fileno()); f.close()' "$1"; else sync; fi
}

dpf_state_commit_candidate() {
  local path="$1" temp="$2"
  dpf_state_validate_file "$temp" || return 1
  if [ -n "${DPF_STATE_SOURCE_SHA:-}" ] && [ "$(dpf_state_sha256 "$path")" != "$DPF_STATE_SOURCE_SHA" ]; then echo "install_state_cas_mismatch" >&2; return 1; fi
  dpf_state_flush_file "$temp" || return 1
  mv -f "$temp" "$path" || return 1
  dpf_state_validate_file "$path"
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
  case "$DPF_PLATFORM" in darwin|linux|win32) ;; *) echo "dpf_state_init: unsupported platform" >&2; return 1 ;; esac
  case "$DPF_ARCH" in arm64|amd64) ;; *) echo "dpf_state_init: unsupported architecture" >&2; return 1 ;; esac
  dpf_state_lock_acquire "$path" || return 1
  dpf_state_cleanup_temps "$path"
  if [ -f "$path" ]; then dpf_state_lock_release "$path"; return 0; fi
  DPF_STATE_SOURCE_SHA=""

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
  local temp; temp="$(dpf_state_temp_path "$path")"
  printf '%s\n' "$initial_json" > "$temp"
  dpf_state_commit_candidate "$path" "$temp" || { rm -f "$temp"; dpf_state_lock_release "$path"; return 1; }
  dpf_state_lock_release "$path"
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
  dpf_state_lock_acquire "$path" || return 1
  dpf_state_cleanup_temps "$path"
  DPF_STATE_SOURCE_SHA="$(dpf_state_sha256 "$path")"
  local temp; temp="$(dpf_state_temp_path "$path")"
  if command -v jq >/dev/null 2>&1; then
    local json_value
    if [ "$value" = "true" ] || [ "$value" = "false" ] || [ "$value" = "null" ]; then
      json_value="$value"
    elif echo "$value" | grep -qE '^-?[0-9]+(\.[0-9]+)?$'; then
      json_value="$value"
    else
      json_value="$(printf '%s' "$value" | jq -Rs .)"
    fi
    jq --arg k "$key" --argjson v "$json_value" '.[$k] = $v' "$path" > "$temp" || { dpf_state_lock_release "$path"; return 1; }
    dpf_state_commit_candidate "$path" "$temp" || { rm -f "$temp"; dpf_state_lock_release "$path"; return 1; }
    dpf_state_lock_release "$path"
    chmod 600 "$path" 2>/dev/null || true
  elif command -v python3 >/dev/null 2>&1; then
    local json_value
    if [ "$value" = "true" ] || [ "$value" = "false" ] || [ "$value" = "null" ] || echo "$value" | grep -qE '^-?[0-9]+(\.[0-9]+)?$'; then
      json_value="$value"
    else
      json_value="$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$value")"
    fi
    python3 - "$path" "$temp" "$key" "$json_value" <<'PY'
import json,sys
with open(sys.argv[1]) as f: state=json.load(f)
state[sys.argv[3]]=json.loads(sys.argv[4])
with open(sys.argv[2],"w",encoding="utf-8") as f: json.dump(state,f,indent=2)
PY
    dpf_state_commit_candidate "$path" "$temp" || { rm -f "$temp"; dpf_state_lock_release "$path"; return 1; }
    dpf_state_lock_release "$path"
    chmod 600 "$path" 2>/dev/null || true
  else
    dpf_state_lock_release "$path"
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

# Forward-migrate through the single Node schema owner. Bash transports verified
# host identity and never stamps schemaVersion independently.
# Args: none
dpf_state_migrate() {
  local file_ver; file_ver="$(dpf_state_read schemaVersion)"
  echo "dpf_state_migrate: migrating state from schema $file_ver to $DPF_STATE_SCHEMA_VERSION"
  dpf_platform || return 1
  dpf_arch || return 1
  node "$(dpf_state_migrator_path)" --state "$(dpf_state_path)" --catalog "$(dpf_state_catalog_path)" --host-platform "$DPF_PLATFORM" --host-arch "$DPF_ARCH" --write
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
  dpf_state_lock_acquire "$path" || return 1
  dpf_state_cleanup_temps "$path"
  DPF_STATE_SOURCE_SHA="$(dpf_state_sha256 "$path")"
  local temp; temp="$(dpf_state_temp_path "$path")"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$value" | jq -e . >/dev/null
    jq --arg k "$key" --argjson v "$value" '.[$k] = $v' "$path" > "$temp" || { dpf_state_lock_release "$path"; return 1; }
    dpf_state_commit_candidate "$path" "$temp" || { rm -f "$temp"; dpf_state_lock_release "$path"; return 1; }
    dpf_state_lock_release "$path"
    chmod 600 "$path" 2>/dev/null || true
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; json.loads(sys.argv[1])' "$value"
    python3 - "$path" "$temp" "$key" "$value" <<'PY'
import json,sys
with open(sys.argv[1]) as f: state=json.load(f)
state[sys.argv[3]]=json.loads(sys.argv[4])
with open(sys.argv[2],"w",encoding="utf-8") as f: json.dump(state,f,indent=2)
PY
    dpf_state_commit_candidate "$path" "$temp" || { rm -f "$temp"; dpf_state_lock_release "$path"; return 1; }
    dpf_state_lock_release "$path"
    chmod 600 "$path" 2>/dev/null || true
    return 0
  fi
  echo "dpf_state_write_json: needs jq or python3 to update JSON object/array values" >&2
  dpf_state_lock_release "$path"
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
