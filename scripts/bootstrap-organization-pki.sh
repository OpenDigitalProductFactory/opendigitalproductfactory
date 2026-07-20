#!/usr/bin/env bash
# Bash 3.2-compatible organization PKI bootstrap for macOS and Linux.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STEP_IMAGE="smallstep/step-ca:0.30.2@sha256:a2b17872915c193259b75a5474c398326f41bd199f0842093e52cf4182bc8270"
MODE="authority"
HOSTNAME_VALUE=""
OUT_DIR="${DPF_PKI_DIR:-$HOME/.dpf/pki}"
BIND_ADDRESS="${DPF_PKI_BIND_ADDRESS:-127.0.0.1}"
CA_URL=""
FINGERPRINT=""
TOKEN_FILE=""
ORG_NAME="${DPF_PKI_NAME:-DPF Organization CA}"
START_TLS=1
SANS=""

usage() {
  cat <<'EOF'
Bootstrap certificate-valid DPF HTTPS with the organization private CA.

Authority (first installation):
  bash scripts/bootstrap-organization-pki.sh --mode authority \
    --hostname <private-name-or-IP> [--san <name-or-IP>] \
    [--bind-address <private-IP>] [--out-dir <directory>]

Join (another installation; public root fingerprint + one-time token only):
  bash scripts/bootstrap-organization-pki.sh --mode join \
    --hostname <private-name-or-IP> --ca-url <https://private-ca:9000> \
    --fingerprint <sha256> --token-file <mode-0600-file>

The root private key never leaves the Authority installation. Join mode accepts
only a fingerprint-pinned public root and a short-lived enrollment token. Both
modes write root_ca.crt, authority.crt, authority.key, and Caddyfile. Existing
CA state is reused; the script refuses silent CA replacement.
EOF
}

append_san() {
  if [ -z "$SANS" ]; then SANS="$1"; else SANS="$SANS,$1"; fi
}

valid_name_or_ip() {
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._:-]+$'
}

private_ipv4_or_loopback() {
  case "$1" in
    127.*|10.*|192.168.*) return 0 ;;
    172.*)
      second="$(printf '%s' "$1" | cut -d. -f2)"
      [ "$second" -ge 16 ] 2>/dev/null && [ "$second" -le 31 ] 2>/dev/null
      return $?
      ;;
    *) return 1 ;;
  esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode) shift; MODE="${1:?--mode requires authority or join}" ;;
    --hostname) shift; HOSTNAME_VALUE="${1:?--hostname requires a value}" ;;
    --san) shift; append_san "${1:?--san requires a value}" ;;
    --out-dir) shift; OUT_DIR="${1:?--out-dir requires a value}" ;;
    --bind-address) shift; BIND_ADDRESS="${1:?--bind-address requires a private IP}" ;;
    --ca-url) shift; CA_URL="${1:?--ca-url requires a value}" ;;
    --fingerprint) shift; FINGERPRINT="${1:?--fingerprint requires a value}" ;;
    --token-file) shift; TOKEN_FILE="${1:?--token-file requires a value}" ;;
    --org-name) shift; ORG_NAME="${1:?--org-name requires a value}" ;;
    --no-start-tls) START_TLS=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

case "$MODE" in authority|join) ;; *) echo "--mode must be authority or join" >&2; exit 64 ;; esac
[ -n "$HOSTNAME_VALUE" ] || { echo "--hostname is required" >&2; exit 64; }
valid_name_or_ip "$HOSTNAME_VALUE" || { echo "--hostname contains unsupported characters" >&2; exit 64; }
old_ifs="$IFS"
IFS=','
for san in $SANS; do valid_name_or_ip "$san" || { echo "--san contains unsupported characters" >&2; exit 64; }; done
IFS="$old_ifs"
private_ipv4_or_loopback "$BIND_ADDRESS" || { echo "--bind-address must be a private IPv4 address or loopback" >&2; exit 64; }
command -v docker >/dev/null 2>&1 || { echo "Docker is required" >&2; exit 69; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required" >&2; exit 69; }
if [ "$MODE" = "authority" ]; then
  command -v openssl >/dev/null 2>&1 || { echo "OpenSSL is required in authority mode" >&2; exit 69; }
fi

mkdir -p "$OUT_DIR" "$OUT_DIR/secrets"
chmod 0700 "$OUT_DIR" "$OUT_DIR/secrets"
ROOT_CERT="$OUT_DIR/root_ca.crt"
FINGERPRINT_FILE="$OUT_DIR/root_ca.fingerprint"
PASSWORD_FILE="$OUT_DIR/secrets/step-ca-password"
PASSWORD_FILE_EFFECTIVE="$PASSWORD_FILE"
AUTHORITY_CERT="$OUT_DIR/authority.crt"
AUTHORITY_KEY="$OUT_DIR/authority.key"
CADDYFILE="$OUT_DIR/Caddyfile"

compose() {
  DPF_PKI_PASSWORD_FILE="$PASSWORD_FILE_EFFECTIVE" \
  DPF_PKI_TRUST_BUNDLE="$ROOT_CERT" \
  DPF_PKI_BIND_ADDRESS="$BIND_ADDRESS" \
  DPF_PKI_DNS_NAMES="$HOSTNAME_VALUE,$BIND_ADDRESS,localhost,127.0.0.1" \
  DPF_PKI_NAME="$ORG_NAME" \
  DPF_TLS_DIR="$OUT_DIR" \
  docker compose --project-directory "$REPO_ROOT" \
    -f "$REPO_ROOT/docker-compose.yml" \
    -f "$REPO_ROOT/docker-compose.pki.yml" "$@"
}

if [ "$MODE" = "authority" ]; then
  if [ ! -f "$PASSWORD_FILE" ]; then
    umask 077
    openssl rand -hex 32 > "$PASSWORD_FILE"
    chmod 0600 "$PASSWORD_FILE"
  fi

  # A populated CA volume is always reused. Replacing it implicitly would
  # invalidate every enrolled installation, so there is deliberately no force
  # or reinitialize option in this installer-facing command.
  compose up -d step-ca
  ready=0
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    if compose exec -T step-ca step ca health --ca-url https://127.0.0.1:9000 \
      --root /home/step/certs/root_ca.crt >/dev/null 2>&1; then ready=1; break; fi
    attempts=$((attempts + 1))
    sleep 1
  done
  [ "$ready" = "1" ] || { echo "Organization CA did not become healthy" >&2; exit 70; }
  compose cp step-ca:/home/step/certs/root_ca.crt "$ROOT_CERT" >/dev/null
  FINGERPRINT="$(compose exec -T step-ca step certificate fingerprint /home/step/certs/root_ca.crt | tr -d '\r\n')"

  san_args="--san $HOSTNAME_VALUE"
  old_ifs="$IFS"
  IFS=','
  for san in $SANS; do san_args="$san_args --san $san"; done
  IFS="$old_ifs"
  if compose exec -T step-ca test -f /home/step/certs/dpf-portal.crt && \
     compose exec -T step-ca test -f /home/step/secrets/dpf-portal.key; then
    compose exec -T step-ca step ca renew /home/step/certs/dpf-portal.crt \
      /home/step/secrets/dpf-portal.key --ca-url https://127.0.0.1:9000 \
      --root /home/step/certs/root_ca.crt --force >/dev/null
  else
    # shellcheck disable=SC2086 # Values passed by word splitting were validated above.
    token="$(compose exec -T step-ca step ca token "$HOSTNAME_VALUE" $san_args \
      --provisioner dpf-installer --password-file /run/secrets/step-ca-password)"
    # shellcheck disable=SC2086
    compose exec -T step-ca step ca certificate "$HOSTNAME_VALUE" \
      /home/step/certs/dpf-portal.crt /home/step/secrets/dpf-portal.key \
      --token "$token" --ca-url https://127.0.0.1:9000 \
      --root /home/step/certs/root_ca.crt --force >/dev/null
    unset token
  fi
  compose cp step-ca:/home/step/certs/dpf-portal.crt "$AUTHORITY_CERT" >/dev/null
  compose cp step-ca:/home/step/secrets/dpf-portal.key "$AUTHORITY_KEY" >/dev/null
else
  [ -n "$CA_URL" ] || { echo "join mode requires --ca-url" >&2; exit 64; }
  [ -n "$FINGERPRINT" ] || { echo "join mode requires --fingerprint" >&2; exit 64; }
  case "$CA_URL" in https://*) ;; *) echo "join mode requires an HTTPS --ca-url" >&2; exit 64 ;; esac
  if [ -f "$AUTHORITY_CERT" ] && [ -f "$AUTHORITY_KEY" ]; then
    PASSWORD_FILE_EFFECTIVE="$AUTHORITY_KEY"
  else
    [ -f "$TOKEN_FILE" ] || { echo "first join requires an existing --token-file" >&2; exit 64; }
    token_mode="$(stat -f '%Lp' "$TOKEN_FILE" 2>/dev/null || stat -c '%a' "$TOKEN_FILE" 2>/dev/null || echo unknown)"
    [ "$token_mode" = "600" ] || { echo "Enrollment token file must have mode 0600" >&2; exit 77; }
    PASSWORD_FILE_EFFECTIVE="$TOKEN_FILE"
  fi

  docker run --rm --mount "type=bind,src=$OUT_DIR,dst=/work" "$STEP_IMAGE" \
    step ca root /work/root_ca.crt --ca-url "$CA_URL" --fingerprint "$FINGERPRINT" --force >/dev/null
  if [ -f "$AUTHORITY_CERT" ] && [ -f "$AUTHORITY_KEY" ]; then
    docker run --rm --mount "type=bind,src=$OUT_DIR,dst=/work" "$STEP_IMAGE" \
      step ca renew /work/authority.crt /work/authority.key --ca-url "$CA_URL" \
      --root /work/root_ca.crt --force >/dev/null
  else
    docker run --rm --mount "type=bind,src=$OUT_DIR,dst=/work" \
      --mount "type=bind,src=$TOKEN_FILE,dst=/run/secrets/enrollment-token,readonly" \
      "$STEP_IMAGE" sh -c 'step ca certificate "$1" /work/authority.crt /work/authority.key --token "$(cat /run/secrets/enrollment-token)" --ca-url "$2" --root /work/root_ca.crt --force' \
      sh "$HOSTNAME_VALUE" "$CA_URL" >/dev/null
  fi
fi

printf '%s\n' "$FINGERPRINT" > "$FINGERPRINT_FILE"
chmod 0644 "$ROOT_CERT" "$FINGERPRINT_FILE" "$AUTHORITY_CERT"
chmod 0600 "$AUTHORITY_KEY" "$PASSWORD_FILE" 2>/dev/null || true

HOSTS="$HOSTNAME_VALUE:443"
old_ifs="$IFS"
IFS=','
for san in $SANS; do HOSTS="$HOSTS, $san:443"; done
IFS="$old_ifs"
cat > "$CADDYFILE" <<EOF
{
    auto_https off
}

$HOSTS {
    tls /etc/caddy/tls/authority.crt /etc/caddy/tls/authority.key
    reverse_proxy portal:3000
}
EOF
chmod 0644 "$CADDYFILE"

if [ "$START_TLS" = "1" ]; then
  compose -f "$REPO_ROOT/docker-compose.tls.yml" up -d portal portal-tls
  compose -f "$REPO_ROOT/docker-compose.tls.yml" restart portal-tls >/dev/null
fi

echo "Organization HTTPS is configured for $HOSTNAME_VALUE."
echo "Public root fingerprint: $FINGERPRINT"
echo "PKI recovery directory: $OUT_DIR (protect and back up with host secrets)."
