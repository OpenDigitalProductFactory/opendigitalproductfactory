# Canonical install origin resolver (BI-6DC1CD5B, design section 12.4.1).
# Source this file; do not execute it directly. Bash 3.2 compatible (macOS).
#
# One https origin per install, chosen without operator input:
#   1. an explicit operator name (PUBLIC_URL already in .env, or an argument);
#   2. the loopback name when the install serves this machine only
#      (DPF_HOST_BIND_ADDRESS is a loopback address);
#   3. the machine's DNS name when the network resolves it to one of this
#      machine's own non-loopback IPv4 addresses;
#   4. otherwise "localhost".
# The certificate names are the canonical host plus the loopback spellings, so
# a browser that types localhost or 127.0.0.1 gets a valid certificate and is
# then redirected to the canonical origin by the portal (PUBLIC_URL_ALIASES is
# deliberately left empty: an alias would be served, not redirected).
#
# twin-contract: canonical-origin-choice-order
# twin-contract: canonical-origin-https-only
# twin-contract: canonical-origin-certificate-sans

# Print the value of NAME from INSTALL_DIR/.env (last occurrence, quotes removed).
dpf_env_value() {
  local install_dir="$1" name="$2"
  [ -f "$install_dir/.env" ] || return 0
  sed -n "s/^${name}=//p" "$install_dir/.env" | tail -1 | tr -d '"' | tr -d '\r'
}

dpf_is_loopback_address() {
  case "${1:-}" in
    ""|localhost|::1|127.*) return 0 ;;
    *) return 1 ;;
  esac
}

# This machine's non-loopback IPv4 addresses, one per line.
dpf_local_ipv4_addresses() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -v '^127\.'
  elif command -v ifconfig >/dev/null 2>&1; then
    ifconfig 2>/dev/null | awk '/inet /{print $2}' | sed 's/^addr://' | grep -v '^127\.'
  fi
}

# The machine's DNS name, lower-cased, only when it is a dotted, non-.local name.
dpf_machine_dns_name() {
  local name
  name="$(hostname -f 2>/dev/null || hostname 2>/dev/null)"
  name="$(printf '%s' "$name" | tr 'A-Z' 'a-z' | sed 's/\.$//')"
  case "$name" in
    *.local|"") return 0 ;;
    *.*) printf '%s\n' "$name" ;;
  esac
}

# IPv4 addresses NAME resolves to, one per line.
dpf_resolve_ipv4() {
  if command -v getent >/dev/null 2>&1; then
    getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u
  elif command -v dscacheutil >/dev/null 2>&1; then
    dscacheutil -q host -a name "$1" 2>/dev/null | awk '/ip_address:/{print $2}' | sort -u
  fi
}

dpf_name_resolves_to_this_machine() {
  local name="$1" address
  for address in $(dpf_resolve_ipv4 "$name"); do
    if dpf_local_ipv4_addresses | grep -qx "$address"; then return 0; fi
  done
  return 1
}

# Usage: dpf_resolve_canonical_origin INSTALL_DIR [EXPLICIT_HOST]
# Sets DPF_CANONICAL_HOST, DPF_CANONICAL_PUBLIC_URL, DPF_CANONICAL_MCP_URL,
# DPF_CANONICAL_CERT_SANS (comma-separated, canonical host excluded) and
# DPF_CANONICAL_SOURCE. Test seams: DPF_CANONICAL_MACHINE_DNS_NAME overrides the
# machine name, DPF_CANONICAL_RESOLVES_HERE=1|0 overrides the resolution check.
dpf_resolve_canonical_origin() {
  local install_dir="$1" explicit="${2:-}" existing bind machine resolves host source sans name
  host=""
  source=""
  if [ -n "$explicit" ]; then
    host="$(printf '%s' "$explicit" | tr 'A-Z' 'a-z')"; source="explicit"
  else
    existing="$(dpf_env_value "$install_dir" PUBLIC_URL)"
    case "$existing" in
      https://*)
        host="$(printf '%s' "$existing" | sed -E 's#^https://##; s#[/:?].*$##' | tr 'A-Z' 'a-z')"
        source="existing-public-url"
        ;;
    esac
  fi
  if [ -z "$host" ]; then
    bind="${DPF_HOST_BIND_ADDRESS:-$(dpf_env_value "$install_dir" DPF_HOST_BIND_ADDRESS)}"
    machine="${DPF_CANONICAL_MACHINE_DNS_NAME-$(dpf_machine_dns_name)}"
    if dpf_is_loopback_address "$bind"; then
      host="localhost"; source="loopback-bind"
    else
      resolves=1
      if [ -n "$machine" ]; then
        if [ -n "${DPF_CANONICAL_RESOLVES_HERE:-}" ]; then
          [ "$DPF_CANONICAL_RESOLVES_HERE" = "1" ] && resolves=0
        elif dpf_name_resolves_to_this_machine "$machine"; then
          resolves=0
        fi
      fi
      if [ -n "$machine" ] && [ "$resolves" -eq 0 ]; then
        host="$machine"; source="machine-dns-name"
      else
        host="localhost"; source="no-network-name"
      fi
    fi
  fi
  case "$host" in
    *[!a-z0-9.-]*|"") echo "canonical_host_invalid" >&2; return 64 ;;
  esac
  sans=""
  for name in localhost 127.0.0.1; do
    [ "$name" = "$host" ] && continue
    sans="${sans:+$sans,}$name"
  done
  DPF_CANONICAL_HOST="$host"
  DPF_CANONICAL_PUBLIC_URL="https://$host"
  DPF_CANONICAL_MCP_URL="https://$host/api/mcp/v1?tier=full"
  DPF_CANONICAL_CERT_SANS="$sans"
  DPF_CANONICAL_SOURCE="$source"
  export DPF_CANONICAL_HOST DPF_CANONICAL_PUBLIC_URL DPF_CANONICAL_MCP_URL DPF_CANONICAL_CERT_SANS DPF_CANONICAL_SOURCE
}

# Usage: dpf_set_env_value INSTALL_DIR NAME VALUE — replace or append NAME=VALUE.
dpf_set_env_value() {
  local install_dir="$1" name="$2" value="$3" env_file tmp
  case "$value" in *$'\n'*|*$'\r'*) echo "env_value_contains_newline" >&2; return 64 ;; esac
  env_file="$install_dir/.env"
  tmp="$(mktemp "$env_file.XXXXXX")"
  if [ -f "$env_file" ]; then
    awk -F= -v key="$name" '$1 != key { print }' "$env_file" > "$tmp"
  fi
  printf '%s=%s\n' "$name" "$value" >> "$tmp"
  mv "$tmp" "$env_file"
}
