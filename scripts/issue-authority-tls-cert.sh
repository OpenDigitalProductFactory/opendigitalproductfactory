#!/usr/bin/env bash
# scripts/issue-authority-tls-cert.sh
#
# Generate a self-signed TLS certificate for the DPF Authority Core so
# Edge Nodes on the LAN can speak HTTPS to it. This is the operator
# helper that closes T2 gap G2 (bearer tokens over plain HTTP on the
# LAN are sniffable).
#
# Output (under $DPF_TLS_DIR, default ~/.dpf/tls):
#   - authority.crt   self-signed certificate (also serves as CA cert)
#   - authority.key   private key (0600)
#   - ca-bundle.crt   the CA the Edge Node trusts (== authority.crt for
#                     self-signed; separate name keeps the operator's
#                     mental model clean and supports a future swap to
#                     a real CA-issued cert without a flag change)
#   - Caddyfile       drop-in reverse-proxy config for the Authority
#                     host (used by docker-compose.tls.yml)
#
# What the operator does next:
#
#   1. On the Authority host, start the TLS sidecar:
#
#        docker compose -f docker-compose.yml \
#                       -f docker-compose.tls.yml up -d portal portal-tls
#
#      Caddy listens on :443, terminates TLS with authority.{crt,key},
#      reverse-proxies to portal:3000 inside the compose network.
#
#   2. Copy ca-bundle.crt to the Edge Node host. Any safe channel works:
#
#        scp ~/.dpf/tls/ca-bundle.crt operator@edge-host:/etc/dpf-edge/
#
#   3. On the Edge Node host, point the Edge Node container at the CA
#      bundle by setting these in the Edge Node .env:
#
#        DPF_AUTHORITY_URL=https://dpf-authority.lan:443
#        DPF_AUTHORITY_CA_CERT=/etc/dpf-edge/ca-bundle.crt
#
#      The standalone compose mounts that host path into the container
#      and sets NODE_EXTRA_CA_CERTS so undici trusts the cert.
#
# Phase 0 / T2 scope. T4 introduces mTLS where the Edge Node also
# holds a client cert. This script is single-direction TLS only.
#
# Bash 3.2 baseline (macOS stock /bin/bash). Requires openssl in PATH.

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<EOF
Open Digital Product Factory — Authority Core TLS cert helper

Usage:
  bash scripts/issue-authority-tls-cert.sh --hostname <name> [flags]

Required:
  --hostname H         Authority Core hostname / IP that Edge Nodes
                       use in DPF_AUTHORITY_URL. Multi-SAN supported
                       by repeating --hostname.
                         e.g. --hostname dpf-authority.lan \\
                              --hostname 192.168.1.42

Optional:
  --out-dir D          Where to write authority.{crt,key} and
                       ca-bundle.crt. Default: \$DPF_TLS_DIR or
                       \$HOME/.dpf/tls.
  --days N             Cert validity in days. Default: 825 (matches
                       Apple's MAX cert lifetime so the cert can be
                       trusted by both macOS and Linux Edge Nodes
                       without complaint).
  --org "Org Name"     Organization field on the cert. Default:
                       "Open Digital Product Factory".
  --force              Overwrite existing files in --out-dir. Default
                       is to refuse if any output file is present.
  -h, --help           Show this help.

Output files:
  <out-dir>/authority.crt       self-signed cert + CA in one
  <out-dir>/authority.key       private key (mode 0600)
  <out-dir>/ca-bundle.crt       copy of the cert; this is what Edge
                                Nodes mount as NODE_EXTRA_CA_CERTS
  <out-dir>/Caddyfile           reverse-proxy config for the
                                Authority host's TLS sidecar

Next steps after running this:
  - Start the TLS sidecar:
      docker compose -f docker-compose.yml \\
                     -f docker-compose.tls.yml up -d
  - Copy ca-bundle.crt to each Edge Node host.
  - Set DPF_AUTHORITY_URL=https://<hostname>:443 +
        DPF_AUTHORITY_CA_CERT=/path/to/ca-bundle.crt
    in each Edge Node's .env (see docker-compose.edge-standalone.yml).

Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
Plan: docs/superpowers/plans/2026-05-12-edge-node-t2-multi-host-lan.md (T2.2)
EOF
}

HOSTNAMES=()
OUT_DIR="${DPF_TLS_DIR:-$HOME/.dpf/tls}"
DAYS=825
ORG="Open Digital Product Factory"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --hostname)   shift; HOSTNAMES+=("${1:?--hostname requires a value}") ;;
    --out-dir)    shift; OUT_DIR="${1:?--out-dir requires a value}" ;;
    --days)       shift; DAYS="${1:?--days requires a value}" ;;
    --org)        shift; ORG="${1:?--org requires a value}" ;;
    --force)      FORCE=1 ;;
    -h|--help)    usage; exit 0 ;;
    *)
      echo "$SCRIPT_NAME: unknown argument: $1" >&2
      echo "Run '$SCRIPT_NAME --help' for usage." >&2
      exit 64
      ;;
  esac
  shift
done

if [ "${#HOSTNAMES[@]}" -eq 0 ]; then
  echo "$SCRIPT_NAME: --hostname is required (at least one)." >&2
  echo "Run '$SCRIPT_NAME --help' for usage." >&2
  exit 64
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "$SCRIPT_NAME: openssl not found in PATH. Install it and re-run." >&2
  exit 69
fi

mkdir -p "$OUT_DIR"

CRT="$OUT_DIR/authority.crt"
KEY="$OUT_DIR/authority.key"
CA="$OUT_DIR/ca-bundle.crt"
CADDYFILE="$OUT_DIR/Caddyfile"

# Refuse to overwrite unless --force; an accidental reissue invalidates
# every Edge Node's CA-bundle on the LAN until they're redistributed,
# which is exactly the kind of silent break the spec § Architecture
# over shortcuts principle warns against.
for f in "$CRT" "$KEY" "$CA" "$CADDYFILE"; do
  if [ -e "$f" ] && [ "$FORCE" = "0" ]; then
    echo "$SCRIPT_NAME: $f already exists. Pass --force to overwrite (this invalidates Edge Node trust on the LAN until you redistribute the CA bundle)." >&2
    exit 73
  fi
done

# Build the SAN list — first hostname is the CN, all hostnames are
# subjectAltName entries. IPs are detected and emitted as IP: entries;
# everything else is DNS: (this matches RFC 5280 conventions and
# Caddy's expectations).
SAN_LINES=""
i=0
for h in "${HOSTNAMES[@]}"; do
  i=$((i + 1))
  if echo "$h" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
    SAN_LINES="${SAN_LINES}IP.${i} = ${h}
"
  else
    SAN_LINES="${SAN_LINES}DNS.${i} = ${h}
"
  fi
done

PRIMARY_CN="${HOSTNAMES[0]}"

# OpenSSL config — bundles CN, SAN, basicConstraints, keyUsage so the
# resulting cert is valid as both a server cert AND a self-signing CA
# (since for self-signed the cert IS its own CA). basicConstraints:CA:TRUE
# is what lets Node's TLS layer accept this cert in NODE_EXTRA_CA_CERTS
# as a trust anchor.
OPENSSL_CONF="$(mktemp)"
cat > "$OPENSSL_CONF" <<EOF
[req]
default_bits       = 4096
prompt             = no
default_md         = sha256
req_extensions     = req_ext
distinguished_name = dn

[dn]
CN = ${PRIMARY_CN}
O  = ${ORG}

[req_ext]
subjectAltName     = @san
basicConstraints   = critical, CA:TRUE
keyUsage           = critical, digitalSignature, keyEncipherment, keyCertSign
extendedKeyUsage   = serverAuth

[san]
${SAN_LINES}
EOF

trap 'rm -f "$OPENSSL_CONF"' EXIT

echo "Generating private key…"
openssl genrsa -out "$KEY" 4096 >/dev/null 2>&1
chmod 0600 "$KEY"

echo "Generating self-signed certificate…"
openssl req -new -x509 \
  -key "$KEY" \
  -out "$CRT" \
  -days "$DAYS" \
  -config "$OPENSSL_CONF" \
  -extensions req_ext \
  >/dev/null 2>&1
chmod 0644 "$CRT"

# The CA bundle for self-signed is just a copy of the cert. Naming it
# distinctly makes the operator's runbook clean: "copy ca-bundle.crt
# to each Edge Node, set NODE_EXTRA_CA_CERTS to it." When the operator
# upgrades to a real CA-issued cert, this file becomes "the issuing
# CA's chain" and the runbook line stays the same.
cp "$CRT" "$CA"
chmod 0644 "$CA"

# Caddyfile for the TLS sidecar. Uses Caddy's tls directive with
# explicit cert/key paths so we don't trip on Caddy's ACME default.
# The hostname list goes in the site address line — Caddy accepts
# multiple comma-separated hosts.
HOSTNAME_LINE="$(IFS=', '; echo "${HOSTNAMES[*]}")"
cat > "$CADDYFILE" <<EOF
# DPF Authority Core — TLS reverse proxy.
# Generated by scripts/issue-authority-tls-cert.sh.
#
# Caddy terminates TLS with the self-signed cert/key in this same
# directory and reverse-proxies to the portal container on its
# compose-internal name (portal:3000). The Edge Node trusts the
# matching ca-bundle.crt via NODE_EXTRA_CA_CERTS.

{
    # Disable automatic HTTPS via ACME — we're using a fixed
    # self-signed cert on a LAN that has no public DNS / ACME path.
    auto_https off
}

${HOSTNAME_LINE}:443 {
    tls /etc/caddy/tls/authority.crt /etc/caddy/tls/authority.key
    reverse_proxy portal:3000
}

# Optional: redirect HTTP to HTTPS for operators who keep typing
# http:// out of habit. Comment out if you intentionally want the
# Authority to be HTTPS-only with no port 80 listener at all.
http://${HOSTNAME_LINE//, /, http://} {
    redir https://{host}{uri} permanent
}
EOF

echo
echo "Issued for hostnames: ${HOSTNAMES[*]}"
echo
echo "  Certificate (CA + server in one): $CRT"
echo "  Private key:                      $KEY"
echo "  CA bundle for Edge Nodes:         $CA"
echo "  Caddyfile for TLS sidecar:        $CADDYFILE"
echo
echo "Expiry:"
openssl x509 -in "$CRT" -noout -enddate
echo "Fingerprint:"
openssl x509 -in "$CRT" -noout -fingerprint -sha256
echo
echo "Next steps:"
echo "  1. On THIS host (Authority Core): start the TLS sidecar."
echo "     export DPF_TLS_DIR='$OUT_DIR'"
echo "     docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d"
echo
echo "  2. On each Edge Node host: copy '$CA' to a known path, e.g."
echo "     scp '$CA' edge-host:/etc/dpf-edge/ca-bundle.crt"
echo
echo "  3. On each Edge Node: set in .env:"
echo "       DPF_AUTHORITY_URL=https://${PRIMARY_CN}:443"
echo "       DPF_AUTHORITY_CA_CERT=/etc/dpf-edge/ca-bundle.crt"
echo
echo "  4. Restart Edge Node: docker compose -f docker-compose.edge-standalone.yml up -d"
