# MCP client environment for the install's own machine (BI-2D545A0C AC-2/AC-4,
# design section 12.4.3). Source this file; do not execute it directly.
# Bash 3.2 compatible (macOS).
#
# The rule, in one place for the installer and the agent-toolchain bootstrap:
#   DPF_MCP_URL         = <PUBLIC_URL>/api/mcp/v1?tier=full when the install's
#                         .env names an https PUBLIC_URL; otherwise an explicit
#                         DPF_MCP_URL already in the environment; then the saved
#                         user endpoint; otherwise none
#                         (the client plugin's loopback default applies).
#   NODE_EXTRA_CA_CERTS = the organization root bundle, for an https endpoint
#                         only: DPF_PKI_TRUST_BUNDLE, then the install's .env,
#                         then saved NODE_EXTRA_CA_CERTS, then ~/.dpf/pki/root_ca.crt.
# Persisted for the installing user in ~/.dpf/agent-toolchain.env, sourced from
# ~/.zshenv and ~/.profile, and on macOS also in the launchd user environment so
# GUI-launched clients see them. Idempotent: each value has exactly one line and
# a re-run rewrites nothing that has not changed.
#
# Test seams: DPF_CLIENT_ENV_PLATFORM overrides uname -s; DPF_LAUNCHCTL names
# the launchctl command.
#
# twin-contract: mcp-client-env-endpoint-from-public-url
# twin-contract: mcp-client-env-idempotent

DPF_MCP_CLIENT_ENV_MARKER="# dpf-mcp-token"

# Print NAME from INSTALL_DIR/.env (last occurrence, quotes and CR removed).
dpf_mcp_install_env_value() {
  [ -f "$1/.env" ] || return 0
  sed -n "s/^$2=//p" "$1/.env" | tail -1 | tr -d '"' | tr -d '\r'
}

dpf_mcp_client_env_file() {
  printf '%s\n' "$HOME/.dpf/agent-toolchain.env"
}

# Decode only the single-quoted export format written below. Never source the
# file: it also contains credentials and may contain arbitrary shell commands.
dpf_mcp_saved_env_value() {
  local file
  case "$1" in DPF_MCP_URL|NODE_EXTRA_CA_CERTS) ;; *) return 64 ;; esac
  file="$(dpf_mcp_client_env_file)"
  [ -f "$file" ] || return 0
  awk -v name="$1" '
    BEGIN { q = sprintf("%c", 39); esc = q sprintf("%c", 92) q q; prefix = "export " name "=" }
    index($0, prefix) == 1 {
      result = ""; value = substr($0, length(prefix) + 1)
      if (substr(value, 1, 1) != q || substr(value, length(value), 1) != q) next
      value = substr(value, 2, length(value) - 2); decoded = ""; valid = 1
      while (length(value)) {
        if (index(value, esc) == 1) { decoded = decoded q; value = substr(value, 5) }
        else if (substr(value, 1, 1) == q) { valid = 0; break }
        else { decoded = decoded substr(value, 1, 1); value = substr(value, 2) }
      }
      if (valid) result = decoded
    }
    END { printf "%s", result }
  ' "$file"
}

# Usage: dpf_resolve_mcp_client_env INSTALL_DIR
# Sets DPF_MCP_CLIENT_URL and DPF_MCP_CLIENT_CA_BUNDLE (either may be empty).
dpf_resolve_mcp_client_env() {
  local install_dir="$1" public candidate
  DPF_MCP_CLIENT_URL=""
  DPF_MCP_CLIENT_CA_BUNDLE=""
  public="$(dpf_mcp_install_env_value "$install_dir" PUBLIC_URL)"
  case "$public" in
    https://*) DPF_MCP_CLIENT_URL="${public%/}/api/mcp/v1?tier=full" ;;
    *) DPF_MCP_CLIENT_URL="${DPF_MCP_URL:-$(dpf_mcp_saved_env_value DPF_MCP_URL)}" ;;
  esac
  case "$DPF_MCP_CLIENT_URL" in
    https://*)
      for candidate in "${DPF_PKI_TRUST_BUNDLE:-}" \
                       "$(dpf_mcp_install_env_value "$install_dir" DPF_PKI_TRUST_BUNDLE)" \
                       "$(dpf_mcp_saved_env_value NODE_EXTRA_CA_CERTS)" \
                       "$HOME/.dpf/pki/root_ca.crt"; do
        if [ -n "$candidate" ] && [ -f "$candidate" ]; then DPF_MCP_CLIENT_CA_BUNDLE="$candidate"; break; fi
      done
      ;;
  esac
}

# Usage: dpf_set_client_env_export NAME VALUE
# Replace NAME's export line in the managed env file; an empty VALUE removes it.
# Other lines (the bearer token, comments) are kept. Mode 600.
dpf_set_client_env_export() {
  local name="$1" value="$2" file dir tmp escaped
  case "$value" in *$'\n'*|*$'\r'*) echo "env_value_contains_newline" >&2; return 64 ;; esac
  file="$(dpf_mcp_client_env_file)"
  dir="$(dirname "$file")"
  mkdir -p "$dir"
  escaped=${value//\'/\'\\\'\'}
  tmp="$(mktemp "$file.XXXXXX")"
  {
    if [ -f "$file" ]; then
      grep -v "^export $name=" "$file" || true
    else
      printf '# DPF MCP client environment -- managed by the DPF installer and agent-toolchain bootstrap\n'
    fi
    if [ -n "$value" ]; then
      printf "export %s='%s'\n" "$name" "$escaped"
    fi
  } > "$tmp"
  chmod 600 "$tmp" 2>/dev/null || true
  if [ -f "$file" ] && cmp -s "$tmp" "$file"; then
    rm -f "$tmp"
  else
    mv "$tmp" "$file"
  fi
}

# Source the managed env file from login and non-login shells, once.
dpf_source_client_env_from_profiles() {
  local file profile
  file="$(dpf_mcp_client_env_file)"
  for profile in "$HOME/.zshenv" "$HOME/.profile"; do
    if [ -f "$profile" ] && grep -q 'dpf-mcp-token' "$profile" 2>/dev/null; then
      continue
    fi
    printf '. "%s"  %s\n' "$file" "$DPF_MCP_CLIENT_ENV_MARKER" >> "$profile"
  done
}

# Usage: dpf_launchd_setenv NAME VALUE -- macOS GUI clients do not read shell
# profiles; launchd's user environment carries the value for this boot. An
# empty VALUE is skipped, never unset: the launchd value may be the operator's.
dpf_launchd_setenv() {
  local launchctl_cmd="${DPF_LAUNCHCTL:-launchctl}"
  [ -n "$2" ] || return 0
  [ "${DPF_CLIENT_ENV_PLATFORM:-$(uname -s)}" = "Darwin" ] || return 0
  command -v "$launchctl_cmd" >/dev/null 2>&1 || return 0
  "$launchctl_cmd" setenv "$1" "$2" 2>/dev/null || true
}

# Usage: dpf_persist_mcp_client_env (after dpf_resolve_mcp_client_env)
# Returns 1 and writes nothing when the endpoint is not https.
dpf_persist_mcp_client_env() {
  case "${DPF_MCP_CLIENT_URL:-}" in https://*) ;; *) return 1 ;; esac
  dpf_set_client_env_export DPF_MCP_URL "$DPF_MCP_CLIENT_URL" || return $?
  dpf_set_client_env_export NODE_EXTRA_CA_CERTS "${DPF_MCP_CLIENT_CA_BUNDLE:-}" || return $?
  dpf_source_client_env_from_profiles
  dpf_launchd_setenv DPF_MCP_URL "$DPF_MCP_CLIENT_URL"
  dpf_launchd_setenv NODE_EXTRA_CA_CERTS "${DPF_MCP_CLIENT_CA_BUNDLE:-}"
  export DPF_MCP_URL="$DPF_MCP_CLIENT_URL"
  if [ -n "${DPF_MCP_CLIENT_CA_BUNDLE:-}" ]; then export NODE_EXTRA_CA_CERTS="$DPF_MCP_CLIENT_CA_BUNDLE"; fi
  return 0
}
