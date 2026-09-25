# Machine trust for the install's own CA (BI-2D545A0C AC-1, design section 12.4.3).
# Source this file; do not execute it directly. Bash 3.2 compatible (macOS).
#
# The installer does not run as root. macOS adds the root to the user's login
# keychain (one keychain password dialog); Linux adds it to the system CA
# store through sudo (one password prompt), skipped when no terminal can ask.
# Those prompts are the operating system's own floor. Idempotent: a root that
# is already trusted is not added again.
#
# twin-contract: machine-trust-idempotent
# twin-contract: machine-trust-one-os-prompt

dpf_root_fingerprint() {
  openssl x509 -in "$1" -noout -fingerprint -sha256 2>/dev/null | sed 's/^.*=//; s/://g' | tr 'a-f' 'A-F'
}

# Usage: dpf_install_root_trust ROOT_CERT
# Prints one of: already-trusted, trusted, declined.
dpf_install_root_trust() {
  local root="$1" platform fingerprint target
  [ -f "$root" ] || { echo "root_certificate_missing" >&2; return 66; }
  platform="${DPF_TRUST_PLATFORM:-$(uname -s)}"
  fingerprint="$(dpf_root_fingerprint "$root")"
  case "$platform" in
    Darwin)
      if security find-certificate -a -Z "$HOME/Library/Keychains/login.keychain-db" 2>/dev/null \
        | grep -qi "SHA-256 hash: $fingerprint"; then
        echo "already-trusted"; return 0
      fi
      if security add-trusted-cert -r trustRoot -k "$HOME/Library/Keychains/login.keychain-db" "$root" 2>/dev/null; then
        echo "trusted"
      else
        echo "declined"
      fi
      ;;
    Linux)
      target=""
      if [ -d /usr/local/share/ca-certificates ]; then
        target="/usr/local/share/ca-certificates/dpf-organization-root.crt"
      elif [ -d /etc/pki/ca-trust/source/anchors ]; then
        target="/etc/pki/ca-trust/source/anchors/dpf-organization-root.crt"
      fi
      if [ -n "$target" ] && [ -f "$target" ] && [ "$(dpf_root_fingerprint "$target")" = "$fingerprint" ]; then
        echo "already-trusted"; return 0
      fi
      if [ -z "$target" ] || ! [ -t 0 ]; then echo "declined"; return 0; fi
      if sudo cp "$root" "$target" && { sudo update-ca-certificates >/dev/null 2>&1 || sudo update-ca-trust >/dev/null 2>&1; }; then
        echo "trusted"
      else
        echo "declined"
      fi
      ;;
    *) echo "declined" ;;
  esac
}
