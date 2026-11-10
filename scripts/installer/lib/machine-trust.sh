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
# Test seams (a fake store adapter per OS): DPF_TRUST_PLATFORM overrides
# uname -s; DPF_TRUST_SECURITY names the macOS security command;
# DPF_TRUST_SUDO names the Linux privilege command (an injected one needs no
# terminal); DPF_TRUST_LINUX_ANCHOR_DIRS lists the candidate system CA dirs.
dpf_install_root_trust() {
  local root="$1" platform fingerprint target dir security_cmd sudo_cmd keychain
  [ -f "$root" ] || { echo "root_certificate_missing" >&2; return 66; }
  platform="${DPF_TRUST_PLATFORM:-$(uname -s)}"
  fingerprint="$(dpf_root_fingerprint "$root")"
  case "$platform" in
    Darwin)
      security_cmd="${DPF_TRUST_SECURITY:-security}"
      keychain="$HOME/Library/Keychains/login.keychain-db"
      if "$security_cmd" find-certificate -a -Z "$keychain" 2>/dev/null \
        | grep -qi "SHA-256 hash: $fingerprint"; then
        echo "already-trusted"; return 0
      fi
      if "$security_cmd" add-trusted-cert -r trustRoot -k "$keychain" "$root" 2>/dev/null; then
        echo "trusted"
      else
        echo "declined"
      fi
      ;;
    Linux)
      sudo_cmd="${DPF_TRUST_SUDO:-sudo}"
      target=""
      for dir in ${DPF_TRUST_LINUX_ANCHOR_DIRS:-/usr/local/share/ca-certificates /etc/pki/ca-trust/source/anchors}; do
        if [ -d "$dir" ]; then target="$dir/dpf-organization-root.crt"; break; fi
      done
      if [ -n "$target" ] && [ -f "$target" ] && [ "$(dpf_root_fingerprint "$target")" = "$fingerprint" ]; then
        echo "already-trusted"; return 0
      fi
      if [ -z "$target" ]; then echo "declined"; return 0; fi
      if [ -z "${DPF_TRUST_SUDO:-}" ] && ! [ -t 0 ]; then echo "declined"; return 0; fi
      if "$sudo_cmd" cp "$root" "$target" && { "$sudo_cmd" update-ca-certificates >/dev/null 2>&1 || "$sudo_cmd" update-ca-trust >/dev/null 2>&1; }; then
        echo "trusted"
      else
        echo "declined"
      fi
      ;;
    *) echo "declined" ;;
  esac
}
