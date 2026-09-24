#!/usr/bin/env bash
# Shared interactive-prompt helpers for DPF installer + setup scripts.
# Source this file; do not execute directly.
#
# Provides:
#   dpf_yes_no              - prompt with default; sets DPF_REPLY = "yes" | "no"
#                             Honors --headless / DPF_HEADLESS=1 (uses default).
#   dpf_default_value       - prompt with default value; sets DPF_REPLY
#   dpf_random_secret_hex   - emit a hex secret (openssl, falling back to
#                             python3.secrets, falling back to a clearly
#                             marked dev-grade secret)
#   dpf_random_secret_b64   - emit a base64 secret (same fallback chain)
#   dpf_env_ensure_secret_hex - give an env key a hex secret only when it has
#                             none (never rotates an existing value)
#
# Bash 3.2 baseline.

if [ "${DPF_LIB_PROMPTS_LOADED:-}" = "1" ]; then
  return 0
fi
DPF_LIB_PROMPTS_LOADED=1

# Read a yes/no from the user with a default. Returns via DPF_REPLY.
# Args: $1 = prompt, $2 = default ("yes" or "no")
dpf_yes_no() {
  local prompt="$1"
  local default="${2:-no}"
  if [ "${DPF_HEADLESS:-0}" = "1" ]; then
    DPF_REPLY="$default"
    return 0
  fi
  local hint
  if [ "$default" = "yes" ]; then hint="[Y/n]"; else hint="[y/N]"; fi
  printf '%s %s ' "$prompt" "$hint"
  local answer
  read -r answer
  case "${answer:-$default}" in
    y|Y|yes|YES) DPF_REPLY="yes" ;;
    *)           DPF_REPLY="no"  ;;
  esac
}

# Read a value with a default. Returns via DPF_REPLY.
# Args: $1 = prompt, $2 = default value
dpf_default_value() {
  local prompt="$1"
  local default="${2:-}"
  if [ "${DPF_HEADLESS:-0}" = "1" ]; then
    DPF_REPLY="$default"
    return 0
  fi
  if [ -n "$default" ]; then
    printf '%s [%s]: ' "$prompt" "$default"
  else
    printf '%s: ' "$prompt"
  fi
  local answer
  read -r answer
  DPF_REPLY="${answer:-$default}"
}

# Generate a random hex secret. 32 bytes = 64 hex chars by default.
# Args: $1 = byte length (default 32)
dpf_random_secret_hex() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import secrets; print(secrets.token_hex($bytes))"
  else
    # Last resort; clearly marked so a grep over .env catches dev-grade secrets.
    echo "dpf-dev-secret-$(date +%s)-NOT-FOR-PRODUCTION"
  fi
}

# Generate a random base64 secret. 32 bytes = 44 base64 chars by default.
# Args: $1 = byte length (default 32)
dpf_random_secret_b64() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$bytes"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import secrets, base64; print(base64.b64encode(secrets.token_bytes($bytes)).decode())"
  else
    echo "dpf-dev-secret-$(date +%s)-NOT-FOR-PRODUCTION"
  fi
}

# Give KEY in an env file a random hex secret unless it already has a real one.
# An existing value is NEVER replaced: an operator may have pasted it into
# another system (the GitHub webhook Secret field for DPF_GIT_WEBHOOK_SECRET),
# and rotating it silently would break that. An absent key, a blank value, or
# an unfilled `<...>` example placeholder counts as missing. The file is
# rewritten in place so its permissions survive. The secret is never printed.
# Prints one word: added | filled | kept.
# Args: $1 = key, $2 = env file, $3 = byte length (default 32),
#       $4 = optional comment line written above an appended key
dpf_env_ensure_secret_hex() {
  local key="$1" file="$2" bytes="${3:-32}" comment="${4:-}"
  local current value tmp
  # `|| true`: callers run under `set -euo pipefail`, and grep finding no line
  # is the normal "missing" answer, not a failure.
  current="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d "\"' \t\r" || true)"
  case "$current" in
    ''|'<'*) ;;
    *) printf 'kept\n'; return 0 ;;
  esac
  value="$(dpf_random_secret_hex "$bytes")"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    tmp="${file}.dpf-secret.$$"
    awk -v prefix="${key}=" -v value="$value" \
      'index($0, prefix) == 1 { print prefix value; next } { print }' "$file" > "$tmp" \
      && cat "$tmp" > "$file"
    rm -f "$tmp"
    printf 'filled\n'
    return 0
  fi
  if [ -s "$file" ] && [ -n "$(tail -c 1 "$file")" ]; then
    printf '\n' >> "$file"
  fi
  if [ -n "$comment" ]; then
    printf '%s\n' "$comment" >> "$file"
  fi
  printf '%s=%s\n' "$key" "$value" >> "$file"
  printf 'added\n'
}
