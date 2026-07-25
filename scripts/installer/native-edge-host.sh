#!/usr/bin/env bash
# Host-native Edge Node installation for macOS. Docker Desktop containers do
# not own the host multicast interfaces, so federation.discovery must run on
# the host. Source this file from install-dpf.sh.

if [ "${DPF_NATIVE_EDGE_HOST_LOADED:-}" = "1" ]; then
  return 0
fi
DPF_NATIVE_EDGE_HOST_LOADED=1

_dpf_native_edge_env_value() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -1
}

_dpf_native_edge_release_url() {
  local version="$1" asset="$2"
  if [ -n "$version" ] && [ "$version" != "latest" ]; then
    printf 'https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/releases/download/%s/%s' "$version" "$asset"
  else
    printf 'https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/releases/latest/download/%s' "$asset"
  fi
}

_dpf_native_edge_acquire_macos() {
  local repo_root="$1" destination="$2" version="$3"
  local asset="dpf-edge-node-darwin-arm64"
  local source_binary="$repo_root/services/edge-node-go/bin/$asset"
  local temporary_dir
  temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/dpf-native-edge.XXXXXX")"

  if [ -x "$source_binary" ]; then
    cp "$source_binary" "$destination"
  elif command -v go >/dev/null 2>&1 && [ -f "$repo_root/services/edge-node-go/go.mod" ]; then
    (cd "$repo_root/services/edge-node-go" && \
      GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -trimpath \
        -ldflags "-s -w -X main.Version=${version:-dev}" \
        -o "$destination" ./cmd/dpf-edge-node)
  else
    local checksum_asset="dpf-edge-node-checksums.sha256"
    curl --fail --location --silent --show-error \
      "$(_dpf_native_edge_release_url "$version" "$asset")" -o "$temporary_dir/$asset"
    curl --fail --location --silent --show-error \
      "$(_dpf_native_edge_release_url "$version" "$checksum_asset")" -o "$temporary_dir/$checksum_asset"
    grep "  ${asset}$" "$temporary_dir/$checksum_asset" > "$temporary_dir/$asset.sha256"
    (cd "$temporary_dir" && shasum -a 256 -c "$asset.sha256")
    cp "$temporary_dir/$asset" "$destination"
  fi

  chmod 0755 "$destination"
  rm -rf "$temporary_dir"
}

dpf_native_edge_install() {
  local repo_root="$1"
  local bootstrap_token="${2:-}"
  local node_name="${3:-$(hostname -s 2>/dev/null || echo dpf-macos)}"
  local platform_name
  platform_name="$(uname -s 2>/dev/null || true)"
  [ "$platform_name" = "Darwin" ] || return 0

  local state_root="${DPF_STATE_DIR:-$HOME/.dpf}"
  local bin_dir="$state_root/bin"
  local edge_state_dir="$state_root/edge-node"
  local log_dir="$state_root/logs"
  local env_file="$state_root/edge-node.env"
  local launch_script="$state_root/run-edge-node.sh"
  local binary="$bin_dir/dpf-edge-node"
  local plist="$HOME/Library/LaunchAgents/local.dpf-edge-node.plist"
  local template="$repo_root/scripts/installer/macos-edge-node.plist.tmpl"
  local version="${DPF_NATIVE_EDGE_VERSION:-$(git -C "$repo_root" describe --tags --abbrev=0 2>/dev/null || echo latest)}"
  local authority_url="${DPF_LAN_AUTHORITY_URL:-}"
  local platform_env="$repo_root/.env"
  local edge_action_url edge_action_ca edge_action_cert edge_action_key edge_action_public
  local organization_role organization_ca_url organization_pki_dir
  edge_action_url="$(_dpf_native_edge_env_value "$platform_env" DPF_EDGE_ACTION_URL)"
  edge_action_ca="$(_dpf_native_edge_env_value "$platform_env" DPF_EDGE_ACTION_CA_FILE)"
  edge_action_cert="$(_dpf_native_edge_env_value "$platform_env" DPF_EDGE_ACTION_CERT_FILE)"
  edge_action_key="$(_dpf_native_edge_env_value "$platform_env" DPF_EDGE_ACTION_KEY_FILE)"
  edge_action_public="$(_dpf_native_edge_env_value "$platform_env" DPF_EDGE_ACTION_SIGNING_PUBLIC_KEY_FILE)"
  organization_role="$(_dpf_native_edge_env_value "$platform_env" DPF_ORGANIZATION_TRUST_ROLE)"
  organization_ca_url="$(_dpf_native_edge_env_value "$platform_env" DPF_ORGANIZATION_CA_URL)"
  organization_pki_dir="$(_dpf_native_edge_env_value "$platform_env" DPF_PKI_DIR)"
  [ -n "$organization_role" ] || organization_role="member"
  [ -n "$organization_pki_dir" ] || organization_pki_dir="${DPF_PKI_DIR:-$HOME/.dpf/pki}"

  if [ -z "$authority_url" ]; then
    local lan_ip
    lan_ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
    if [ -n "$lan_ip" ]; then
      authority_url="http://$lan_ip:3000"
    else
      authority_url="http://127.0.0.1:3000"
      warn "No active private IPv4 address was detected; nearby peers cannot reach this installation until DPF_LAN_AUTHORITY_URL is set."
    fi
  fi
  case "$authority_url" in
    https://*) ;;
    *) warn "Nearby discovery will work at $authority_url, but automatic pairing remains blocked until DPF_LAN_AUTHORITY_URL is certificate-valid HTTPS." ;;
  esac

  mkdir -p "$bin_dir" "$edge_state_dir" "$log_dir" "$HOME/Library/LaunchAgents"
  chmod 0700 "$state_root" "$edge_state_dir"
  _dpf_native_edge_acquire_macos "$repo_root" "$binary" "$version"
  # Integrity is checked before this host-local mutation. Clearing quarantine
  # and applying an ad-hoc signature lets launchd execute contributor builds
  # and unsigned community release artifacts; official Developer ID signing
  # can replace the ad-hoc signature without changing the installer contract.
  xattr -d com.apple.quarantine "$binary" 2>/dev/null || true
  codesign --force --sign - "$binary" >/dev/null

  {
    printf 'DPF_AUTHORITY_URL=%s\n' "$authority_url"
    printf 'DPF_BOOTSTRAP_TOKEN=%s\n' "$bootstrap_token"
    printf 'DPF_EDGE_NODE_NAME=%s\n' "$node_name"
    printf 'DPF_INSTALL_MODE=native\n'
    printf 'DPF_EDGE_STATE_DIR=%s\n' "$edge_state_dir"
    printf 'DPF_INSTALL_ROOT=%s\n' "$repo_root"
    printf 'DPF_ORGANIZATION_TRUST_ROLE=%s\n' "$organization_role"
    printf 'DPF_PKI_DIR=%s\n' "$organization_pki_dir"
    if [ -n "$organization_ca_url" ]; then printf 'DPF_ORGANIZATION_CA_URL=%s\n' "$organization_ca_url"; fi
    if [ -n "$edge_action_url" ] && [ -f "$edge_action_ca" ] && [ -f "$edge_action_cert" ] && [ -f "$edge_action_key" ] && [ -f "$edge_action_public" ]; then
      printf 'DPF_EDGE_ACTION_URL=%s\n' "$edge_action_url"
      printf 'DPF_EDGE_ACTION_CA_FILE=%s\n' "$edge_action_ca"
      printf 'DPF_EDGE_ACTION_CERT_FILE=%s\n' "$edge_action_cert"
      printf 'DPF_EDGE_ACTION_KEY_FILE=%s\n' "$edge_action_key"
      printf 'DPF_EDGE_ACTION_SIGNING_PUBLIC_KEY_FILE=%s\n' "$edge_action_public"
    fi
  } > "$env_file"
  chmod 0600 "$env_file"

  {
    printf '%s\n' '#!/usr/bin/env bash' 'set -a'
    printf '. %q\n' "$env_file"
    printf '%s\n' 'set +a'
    printf 'exec %q\n' "$binary"
  } > "$launch_script"
  chmod 0700 "$launch_script"

  sed -e "s|@@DPF_EDGE_LAUNCH_SCRIPT@@|$launch_script|g" \
      -e "s|@@DPF_EDGE_LOG_DIR@@|$log_dir|g" "$template" > "$plist"
  chmod 0644 "$plist"
  launchctl bootout "gui/$UID/local.dpf-edge-node" 2>/dev/null || true
  if launchctl bootstrap "gui/$UID" "$plist" 2>/dev/null; then
    ok "Native Edge Node installed and supervised by launchd"
  else
    warn "Native Edge Node was installed but launchd could not start it. See $log_dir/edge-node.err.log."
    return 1
  fi
}
