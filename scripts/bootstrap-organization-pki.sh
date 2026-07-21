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
JOIN_PACKAGE=""
PACKAGE_OUTPUT=""
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

Issue a 15-minute package for one intended installation:
  bash scripts/bootstrap-organization-pki.sh --mode issue-join \
    --hostname <joining-private-name-or-IP> [--san <name-or-IP>] \
    --ca-url <https://private-ca:9000> --package-output <file.dpfjoin>

Join (another installation; one private package file only):
  bash scripts/bootstrap-organization-pki.sh --mode join \
    --join-package <mode-0600-file.dpfjoin> [--out-dir <directory>]

The root private key never leaves the Authority installation. Join mode accepts
only a fingerprint-pinned public root and a short-lived enrollment token. Both
modes write root_ca.crt, authority.crt, authority.key, and Caddyfile. Existing
CA state is reused; the script refuses silent CA replacement. A join package
uses the DPF_ORGANIZATION_JOIN_V1 contract and carries no CA private key.
EOF
}

append_san() {
  if [ -z "$SANS" ]; then SANS="$1"; else SANS="$SANS,$1"; fi
}

valid_name_or_ip() {
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._:-]+$'
}

valid_ca_url() {
  printf '%s' "$1" | grep -Eq '^https://[A-Za-z0-9._:-]+$'
}

valid_private_ca_url() {
  valid_ca_url "$1" || return 1
  ca_origin="${1#https://}"
  ca_host="${ca_origin%%:*}"
  case "$ca_host" in
    localhost|*.local|*.internal|host.docker.internal) return 0 ;;
  esac
  private_ipv4_or_loopback "$ca_host"
}

read_join_package() {
  package_path="$1"
  [ -f "$package_path" ] || { echo "Join package was not found" >&2; exit 64; }
  package_mode="$(stat -f '%Lp' "$package_path" 2>/dev/null || stat -c '%a' "$package_path" 2>/dev/null || echo unknown)"
  [ "$package_mode" = "600" ] || { echo "Join package must have mode 0600" >&2; exit 77; }

  package_header=""
  package_id=""
  package_ca_url=""
  package_fingerprint=""
  package_hostname=""
  package_sans=""
  package_expires_at=""
  package_token=""
  seen_package_id=0
  seen_ca_url=0
  seen_fingerprint=0
  seen_hostname=0
  seen_sans=0
  seen_expiry=0
  seen_token=0
  line_number=0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line_number=$((line_number + 1))
    if [ "$line_number" -eq 1 ]; then package_header="$line"; continue; fi
    [ -n "$line" ] || continue
    key="${line%%=*}"
    value="${line#*=}"
    [ "$key" != "$line" ] || { echo "Join package contains a malformed field" >&2; exit 77; }
    case "$key" in
      package_id) [ "$seen_package_id" = 0 ] || { echo "Join package contains duplicate fields" >&2; exit 77; }; seen_package_id=1; package_id="$value" ;;
      ca_url) [ "$seen_ca_url" = 0 ] || { echo "Join package contains duplicate fields" >&2; exit 77; }; seen_ca_url=1; package_ca_url="$value" ;;
      root_fingerprint) [ "$seen_fingerprint" = 0 ] || { echo "Join package contains duplicate fields" >&2; exit 77; }; seen_fingerprint=1; package_fingerprint="$value" ;;
      intended_hostname) [ "$seen_hostname" = 0 ] || { echo "Join package contains duplicate fields" >&2; exit 77; }; seen_hostname=1; package_hostname="$value" ;;
      intended_sans) [ "$seen_sans" = 0 ] || { echo "Join package contains duplicate fields" >&2; exit 77; }; seen_sans=1; package_sans="$value" ;;
      expires_at) [ "$seen_expiry" = 0 ] || { echo "Join package contains duplicate fields" >&2; exit 77; }; seen_expiry=1; package_expires_at="$value" ;;
      enrollment_token) [ "$seen_token" = 0 ] || { echo "Join package contains duplicate fields" >&2; exit 77; }; seen_token=1; package_token="$value" ;;
      *) echo "Join package contains an unknown field" >&2; exit 77 ;;
    esac
  done < "$package_path"

  [ "$package_header" = "DPF_ORGANIZATION_JOIN_V1" ] || { echo "Join package version is not supported" >&2; exit 77; }
  printf '%s' "$package_id" | grep -Eq '^[a-f0-9]{32}$' || { echo "Join package id is invalid" >&2; exit 77; }
  valid_private_ca_url "$package_ca_url" || { echo "Join package CA URL must be private or local HTTPS" >&2; exit 77; }
  printf '%s' "$package_fingerprint" | grep -Eq '^[A-Fa-f0-9]{64}$' || { echo "Join package root fingerprint is invalid" >&2; exit 77; }
  valid_name_or_ip "$package_hostname" || { echo "Join package intended peer is invalid" >&2; exit 77; }
  printf '%s' "$package_expires_at" | grep -Eq '^[0-9]{1,12}$' || { echo "Join package expiry is invalid" >&2; exit 77; }
  printf '%s' "$package_token" | grep -Eq '^[A-Za-z0-9._-]+$' || { echo "Join package enrollment authority is invalid" >&2; exit 77; }
  now_epoch="$(date +%s)"
  [ "$package_expires_at" -gt "$now_epoch" ] || { echo "Join package has expired" >&2; exit 77; }
  if [ -n "$HOSTNAME_VALUE" ] && [ "$HOSTNAME_VALUE" != "$package_hostname" ]; then
    echo "Join package is intended for another installation" >&2
    exit 77
  fi
  HOSTNAME_VALUE="$package_hostname"
  SANS="$package_sans"
  CA_URL="$package_ca_url"
  FINGERPRINT="$package_fingerprint"
  PACKAGE_ID="$package_id"
  PACKAGE_TOKEN="$package_token"
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
    --mode) shift; MODE="${1:?--mode requires authority, issue-join, or join}" ;;
    --hostname) shift; HOSTNAME_VALUE="${1:?--hostname requires a value}" ;;
    --san) shift; append_san "${1:?--san requires a value}" ;;
    --out-dir) shift; OUT_DIR="${1:?--out-dir requires a value}" ;;
    --bind-address) shift; BIND_ADDRESS="${1:?--bind-address requires a private IP}" ;;
    --ca-url) shift; CA_URL="${1:?--ca-url requires a value}" ;;
    --fingerprint) shift; FINGERPRINT="${1:?--fingerprint requires a value}" ;;
    --token-file) shift; TOKEN_FILE="${1:?--token-file requires a value}" ;;
    --join-package) shift; JOIN_PACKAGE="${1:?--join-package requires a value}" ;;
    --package-output) shift; PACKAGE_OUTPUT="${1:?--package-output requires a value}" ;;
    --org-name) shift; ORG_NAME="${1:?--org-name requires a value}" ;;
    --no-start-tls) START_TLS=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

case "$MODE" in authority|issue-join|join) ;; *) echo "--mode must be authority, issue-join, or join" >&2; exit 64 ;; esac
if [ "$MODE" = "join" ] && [ -n "$JOIN_PACKAGE" ]; then read_join_package "$JOIN_PACKAGE"; fi
[ -n "$HOSTNAME_VALUE" ] || { echo "--hostname is required" >&2; exit 64; }
valid_name_or_ip "$HOSTNAME_VALUE" || { echo "--hostname contains unsupported characters" >&2; exit 64; }
old_ifs="$IFS"
IFS=','
for san in $SANS; do valid_name_or_ip "$san" || { echo "--san contains unsupported characters" >&2; exit 64; }; done
IFS="$old_ifs"
private_ipv4_or_loopback "$BIND_ADDRESS" || { echo "--bind-address must be a private IPv4 address or loopback" >&2; exit 64; }
if [ "$MODE" = "issue-join" ]; then
  [ -n "$CA_URL" ] || { echo "issue-join mode requires --ca-url" >&2; exit 64; }
  valid_private_ca_url "$CA_URL" || { echo "issue-join mode requires a private or local origin-only HTTPS --ca-url" >&2; exit 64; }
  [ -n "$PACKAGE_OUTPUT" ] || { echo "issue-join mode requires --package-output" >&2; exit 64; }
  [ ! -e "$PACKAGE_OUTPUT" ] || { echo "Refusing to overwrite an existing join package" >&2; exit 73; }
fi
command -v docker >/dev/null 2>&1 || { echo "Docker is required" >&2; exit 69; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required" >&2; exit 69; }
if [ "$MODE" = "authority" ] || [ "$MODE" = "issue-join" ]; then
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

if [ "$MODE" = "join" ] && [ -n "$JOIN_PACKAGE" ]; then
  TOKEN_FILE="$OUT_DIR/secrets/.join-token-$PACKAGE_ID"
  umask 077
  printf '%s\n' "$PACKAGE_TOKEN" > "$TOKEN_FILE"
  chmod 0600 "$TOKEN_FILE"
  unset PACKAGE_TOKEN
  trap 'rm -f "$TOKEN_FILE"' EXIT HUP INT TERM
fi

compose() {
  local compose_files=(-f "$REPO_ROOT/docker-compose.yml" -f "$REPO_ROOT/docker-compose.organization-trust.yml")
  if [ "$MODE" = "authority" ] || [ "$MODE" = "issue-join" ]; then
    compose_files+=( -f "$REPO_ROOT/docker-compose.pki.yml" )
  fi
  DPF_PKI_PASSWORD_FILE="$PASSWORD_FILE_EFFECTIVE" \
  DPF_PKI_TRUST_BUNDLE="$ROOT_CERT" \
  DPF_PKI_BIND_ADDRESS="$BIND_ADDRESS" \
  DPF_PKI_DNS_NAMES="$HOSTNAME_VALUE,$SANS,$BIND_ADDRESS,localhost,127.0.0.1" \
  DPF_PKI_NAME="$ORG_NAME" \
  DPF_TLS_DIR="$OUT_DIR" \
  docker compose --project-directory "$REPO_ROOT" \
    "${compose_files[@]}" "$@"
}

persist_organization_trust() {
  env_file="$REPO_ROOT/.env"
  [ -f "$env_file" ] || return 0
  case "$OUT_DIR$ROOT_CERT" in *$'\n'*|*$'\r'*) echo "PKI paths must not contain newlines" >&2; exit 64 ;; esac
  env_tmp="$(mktemp "$env_file.organization-trust.XXXXXX")"
  awk -F= '$1 != "DPF_ORGANIZATION_TRUST_ENABLED" && $1 != "DPF_PKI_TRUST_BUNDLE" && $1 != "DPF_TLS_DIR" { print }' "$env_file" > "$env_tmp"
  {
    printf 'DPF_ORGANIZATION_TRUST_ENABLED=1\n'
    printf 'DPF_PKI_TRUST_BUNDLE=%s\n' "$ROOT_CERT"
    printf 'DPF_TLS_DIR=%s\n' "$OUT_DIR"
  } >> "$env_tmp"
  chmod 0600 "$env_tmp"
  mv "$env_tmp" "$env_file"
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
elif [ "$MODE" = "issue-join" ]; then
  [ -f "$PASSWORD_FILE" ] || { echo "Organization CA is not initialized on this installation" >&2; exit 69; }
  compose up -d step-ca
  compose exec -T step-ca step ca health --ca-url https://127.0.0.1:9000 \
    --root /home/step/certs/root_ca.crt >/dev/null
  FINGERPRINT="$(compose exec -T step-ca step certificate fingerprint /home/step/certs/root_ca.crt | tr -d '\r\n')"
  san_args="--san $HOSTNAME_VALUE"
  old_ifs="$IFS"
  IFS=','
  for san in $SANS; do san_args="$san_args --san $san"; done
  IFS="$old_ifs"
  # shellcheck disable=SC2086 # Values passed by word splitting were validated above.
  token="$(compose exec -T step-ca step ca token "$HOSTNAME_VALUE" $san_args \
    --not-after 15m --provisioner dpf-installer --password-file /run/secrets/step-ca-password)"
  package_id="$(openssl rand -hex 16)"
  expires_at="$(( $(date +%s) + 900 ))"
  umask 077
  {
    printf '%s\n' "DPF_ORGANIZATION_JOIN_V1"
    printf 'package_id=%s\n' "$package_id"
    printf 'ca_url=%s\n' "$CA_URL"
    printf 'root_fingerprint=%s\n' "$FINGERPRINT"
    printf 'intended_hostname=%s\n' "$HOSTNAME_VALUE"
    printf 'intended_sans=%s\n' "$SANS"
    printf 'expires_at=%s\n' "$expires_at"
    printf 'enrollment_token=%s\n' "$token"
  } > "$PACKAGE_OUTPUT"
  chmod 0600 "$PACKAGE_OUTPUT"
  unset token
  echo "Organization join package created at $PACKAGE_OUTPUT."
  echo "It expires in 15 minutes and is intended only for $HOSTNAME_VALUE."
  exit 0
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

persist_organization_trust

if [ "$START_TLS" = "1" ]; then
  compose -f "$REPO_ROOT/docker-compose.tls.yml" up -d portal portal-tls
  compose -f "$REPO_ROOT/docker-compose.tls.yml" restart portal-tls >/dev/null
fi

if [ "$MODE" = "join" ] && [ -n "$JOIN_PACKAGE" ]; then
  rm -f "$JOIN_PACKAGE" 2>/dev/null || true
fi

echo "Organization HTTPS is configured for $HOSTNAME_VALUE."
echo "Public root fingerprint: $FINGERPRINT"
echo "PKI recovery directory: $OUT_DIR (protect and back up with host secrets)."
