#!/usr/bin/env bash
# Host-native Edge Node installation for macOS and Linux. Docker Desktop
# containers do not own the host multicast interfaces, so federation.discovery
# must run on the host; and host upkeep (the operator-approved Docker VM
# restart, BI-28EFE18A) must run outside the VM it restarts. Every install gets
# the node; DPF_EDGE_ROLE=host-upkeep keeps it to heartbeat and host upkeep
# when the edge features are not enabled. Source this file from install-dpf.sh.

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

# Explicit supported opt-in for a qualified Mac. This stages immutable source
# and artifacts while the old Edge service stays online. Activation remains a
# separate approved, signed action; this grants no action type or capability.
_dpf_native_edge_prepare_managed_inference() {
  [ "${DPF_MANAGED_INFERENCE_ENABLED:-0}" = "1" ] || return 0
  local repo_root="$1" state_root="$2" source_sha="${DPF_MANAGED_INFERENCE_SOURCE_SHA:-}"
  if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
    echo "Managed inference is not qualified on this unsupported host." >&2; return 1
  fi
  [[ "$source_sha" =~ ^[a-f0-9]{40}$ ]] || { echo "An exact published native controller source is required." >&2; return 1; }
  local runtime_package="${DPF_MANAGED_INFERENCE_RUNTIME_PACKAGE:-}" report="${DPF_MANAGED_INFERENCE_REPORT:-}"
  local runtime_hash="${DPF_MANAGED_INFERENCE_RUNTIME_SHA256:-}" report_hash="${DPF_MANAGED_INFERENCE_REPORT_SHA256:-}"
  [[ "$runtime_hash" =~ ^[a-f0-9]{64}$ ]] && [[ "$report_hash" =~ ^[a-f0-9]{64}$ ]] &&
    [ -d "$runtime_package" ] && [ -f "$report" ] || { echo "Pinned runtime and qualification report are required." >&2; return 1; }
  command -v node >/dev/null && command -v go >/dev/null || { echo "The maintained native controller requires Node and Go." >&2; return 1; }
  GIT_NO_REPLACE_OBJECTS=1 git -C "$repo_root" merge-base --is-ancestor "$source_sha" refs/remotes/origin/main || return 1
  local source_dir controller_root baseline
  source_dir="$(umask 077; mktemp -d "$state_root/.native-controller-source.XXXXXX")" || return 1
  (set -o pipefail; GIT_NO_REPLACE_OBJECTS=1 git -C "$repo_root" archive "$source_sha" tools/mac-inference scripts/lib scripts/installer packages/db/src services/edge-node-go | tar -x -C "$source_dir") || return 1
  mkdir -p "$state_root/native-inference-controller" || return 1
  chmod 0700 "$state_root/native-inference-controller" || return 1
  controller_root="$state_root/native-inference-controller/$source_sha"
  baseline="$HOME/.docker/bin/inference/llama-server"
  (umask 077; node "$source_dir/tools/mac-inference/runtime-controller-package.mjs" --repo "$repo_root" --source "$source_sha" --out "$controller_root" --reuse > "$source_dir/controller.json") || return 1
  node "$controller_root/tools/mac-inference/runtime-provision.mjs" --state-directory "$state_root" \
    --runtime-package "$runtime_package" --source "$source_sha" --report "$report" \
    --runtime-manifest-sha256 "$runtime_hash" --report-sha256 "$report_hash" --baseline-engine "$baseline" \
    > "$source_dir/staging.json" || return 1
  local manifest_hash
  manifest_hash="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).manifestSha256)' "$source_dir/controller.json")" || return 1
  [[ "$manifest_hash" =~ ^[a-f0-9]{64}$ ]] || return 1
  (umask 077; {
    printf 'DPF_MANAGED_INFERENCE_ENABLED=1\n'
    printf 'DPF_MANAGED_INFERENCE_CONTROLLER_ROOT=%q\n' "$controller_root"
    printf 'DPF_MANAGED_INFERENCE_MANIFEST_SHA256=%q\n' "$manifest_hash"
    printf 'DPF_MANAGED_INFERENCE_SOURCE_SHA=%q\n' "$source_sha"
    printf 'DPF_MANAGED_INFERENCE_STATE_DIR=%q\n' "$state_root"
    printf 'DPF_MANAGED_INFERENCE_BASELINE_ENGINE=%q\n' "$baseline"
  } > "$state_root/native-inference-controller.env.next") || return 1
  _DPF_NATIVE_INFERENCE_BUILD_SOURCE="$source_dir"
}

_dpf_native_edge_acquire_macos() {
  local repo_root="$1" destination="$2" version="$3"
  # Every release publishes both Mac builds; an Intel Mac cannot run the arm64
  # one (BI-084F85E5). The same uname mapping as Linux.
  local arch; arch="$(_dpf_native_edge_linux_arch)"
  [ -n "$arch" ] || arch="arm64"
  local asset="dpf-edge-node-darwin-$arch"
  local source_binary="$repo_root/services/edge-node-go/bin/$asset"
  local temporary_dir
  temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/dpf-native-edge.XXXXXX")"

  if [ "${DPF_MANAGED_INFERENCE_ENABLED:-0}" = "1" ]; then
    [ -n "${_DPF_NATIVE_INFERENCE_BUILD_SOURCE:-}" ] || return 1
    (cd "$_DPF_NATIVE_INFERENCE_BUILD_SOURCE/services/edge-node-go" && \
      GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -trimpath \
        -ldflags "-s -w -X main.Version=$DPF_MANAGED_INFERENCE_SOURCE_SHA" -o "$destination" ./cmd/dpf-edge-node) || return 1
  elif [ -x "$source_binary" ]; then
    cp "$source_binary" "$destination"
  elif command -v go >/dev/null 2>&1 && [ -f "$repo_root/services/edge-node-go/go.mod" ]; then
    (cd "$repo_root/services/edge-node-go" && \
      GOOS=darwin GOARCH="$arch" CGO_ENABLED=0 go build -trimpath \
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
  local edge_role="${4:-full}"
  local platform_name
  platform_name="$(uname -s 2>/dev/null || true)"
  if [ "$platform_name" = "Linux" ]; then
    dpf_native_edge_install_linux "$repo_root" "$bootstrap_token" "$node_name" "$edge_role"
    return $?
  fi
  [ "$platform_name" = "Darwin" ] || return 0

  local state_root="${DPF_STATE_DIR:-$HOME/.dpf}"
  local bin_dir="$state_root/bin"
  local edge_state_dir="$state_root/edge-node"
  local log_dir="$state_root/logs"
  local env_file="$state_root/edge-node.env"
  local launch_script="$state_root/run-edge-node.sh"
  local binary="$bin_dir/dpf-edge-node"
  local binary_candidate="$binary.next"
  local binary_backup="$binary.previous"
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
  if [ "${DPF_MANAGED_INFERENCE_ENABLED:-0}" = "1" ]; then
    [ -n "$edge_action_url" ] && [ -f "$edge_action_ca" ] && [ -f "$edge_action_cert" ] && [ -f "$edge_action_key" ] && [ -f "$edge_action_public" ] || {
      echo "A complete enrolled host machine identity is required before managed inference provisioning." >&2; return 1;
    }
  fi
  _dpf_native_edge_prepare_managed_inference "$repo_root" "$state_root" || return 1
  # Acquire and verify the replacement while the current service stays online.
  rm -f "$binary_candidate"
  _dpf_native_edge_acquire_macos "$repo_root" "$binary_candidate" "$version" || return 1
  # Integrity is checked before this host-local mutation. Clearing quarantine
  # and applying an ad-hoc signature lets launchd execute contributor builds
  # and unsigned community release artifacts; official Developer ID signing
  # can replace the ad-hoc signature without changing the installer contract.
  xattr -d com.apple.quarantine "$binary_candidate" 2>/dev/null || true
  codesign --force --sign - "$binary_candidate" >/dev/null
  # Release the running image only after the replacement is ready.
  launchctl bootout "gui/$UID/local.dpf-edge-node" 2>/dev/null || true
  if [ -f "$binary" ]; then
    cp "$binary" "$binary_backup"
    chmod 0755 "$binary_backup"
  fi
  if [ -f "$env_file" ]; then cp "$env_file" "$env_file.previous"; chmod 0600 "$env_file.previous"; fi
  local native_env="$state_root/native-inference-controller.env"
  if [ -f "$native_env.next" ]; then
    if [ -f "$native_env" ]; then cp "$native_env" "$native_env.previous"; chmod 0600 "$native_env.previous"; fi
    mv "$native_env.next" "$native_env"
  fi
  mv "$binary_candidate" "$binary"

  {
    printf 'DPF_AUTHORITY_URL=%s\n' "$authority_url"
    printf 'DPF_BOOTSTRAP_TOKEN=%s\n' "$bootstrap_token"
    printf 'DPF_EDGE_NODE_NAME=%s\n' "$node_name"
    printf 'DPF_INSTALL_MODE=native\n'
    printf 'DPF_EDGE_ROLE=%s\n' "$edge_role"
    printf 'DPF_AUTOSTART_TASK_NAME=%s\n' "local.dpf-autostart"
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
    # Existing explicit selection survives ordinary host-agent upgrades. This
    # private fragment contains paths and hashes only, never machine keys.
    printf 'if [ -f %q ]; then . %q; fi\n' "$native_env" "$native_env"
    printf '%s\n' 'set +a'
    printf 'exec %q\n' "$binary"
  } > "$launch_script"
  chmod 0700 "$launch_script"

  sed -e "s|@@DPF_EDGE_LAUNCH_SCRIPT@@|$launch_script|g" \
      -e "s|@@DPF_EDGE_LOG_DIR@@|$log_dir|g" "$template" > "$plist"
  chmod 0644 "$plist"
  if launchctl bootstrap "gui/$UID" "$plist" 2>/dev/null; then
    ok "Native Edge Node installed and supervised by launchd"
  else
    if [ -f "$binary_backup" ]; then
      mv "$binary_backup" "$binary"
      if [ -f "$env_file.previous" ]; then mv "$env_file.previous" "$env_file"; fi
      if [ -f "$native_env.previous" ]; then mv "$native_env.previous" "$native_env"; fi
      launchctl bootstrap "gui/$UID" "$plist" 2>/dev/null || true
      warn "Native Edge Node could not start after upgrade; the prior binary was restored. See $log_dir/edge-node.err.log."
    else
      warn "Native Edge Node was installed but launchd could not start it. See $log_dir/edge-node.err.log."
    fi
    return 1
  fi
}

# Linux (BI-28EFE18A): the same native node under a systemd user unit, beside
# the platform's own dpf.service (scripts/installer/lib/autostart.sh, which
# also enables linger so both survive logout). Linux keeps its edge container
# for opted-in edge features; this node always runs the host-upkeep role.
_dpf_native_edge_linux_arch() {
  case "$(uname -m 2>/dev/null)" in
    x86_64|amd64) echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    *) echo "" ;;
  esac
}

_dpf_native_edge_acquire_linux() {
  local repo_root="$1" destination="$2" version="$3" arch="$4"
  local asset="dpf-edge-node-linux-$arch"
  local source_binary="$repo_root/services/edge-node-go/bin/$asset"
  local temporary_dir
  temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/dpf-native-edge.XXXXXX")"

  if [ -x "$source_binary" ]; then
    cp "$source_binary" "$destination"
  elif command -v go >/dev/null 2>&1 && [ -f "$repo_root/services/edge-node-go/go.mod" ]; then
    (cd "$repo_root/services/edge-node-go" && \
      GOOS=linux GOARCH="$arch" CGO_ENABLED=0 go build -trimpath \
        -ldflags "-s -w -X main.Version=${version:-dev}" \
        -o "$destination" ./cmd/dpf-edge-node)
  else
    local checksum_asset="dpf-edge-node-checksums.sha256"
    curl --fail --location --silent --show-error \
      "$(_dpf_native_edge_release_url "$version" "$asset")" -o "$temporary_dir/$asset"
    curl --fail --location --silent --show-error \
      "$(_dpf_native_edge_release_url "$version" "$checksum_asset")" -o "$temporary_dir/$checksum_asset"
    grep "  ${asset}$" "$temporary_dir/$checksum_asset" > "$temporary_dir/$asset.sha256"
    (cd "$temporary_dir" && sha256sum -c "$asset.sha256")
    cp "$temporary_dir/$asset" "$destination"
  fi

  chmod 0755 "$destination"
  rm -rf "$temporary_dir"
}

dpf_native_edge_install_linux() {
  local repo_root="$1"
  local bootstrap_token="${2:-}"
  local node_name="${3:-$(hostname -s 2>/dev/null || echo dpf-linux)}"
  local edge_role="${4:-host-upkeep}"
  local arch
  arch="$(_dpf_native_edge_linux_arch)"
  if [ -z "$arch" ]; then
    warn "Native Edge Node: unsupported CPU architecture $(uname -m 2>/dev/null); host upkeep stays unavailable on this host."
    return 1
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "Native Edge Node needs systemd user services; host upkeep stays unavailable on this host."
    return 1
  fi

  local state_root="${DPF_STATE_DIR:-$HOME/.dpf}"
  local bin_dir="$state_root/bin"
  local edge_state_dir="$state_root/edge-node"
  local log_dir="$state_root/logs"
  local env_file="$state_root/edge-node.env"
  local binary="$bin_dir/dpf-edge-node"
  local binary_candidate="$binary.next"
  local binary_backup="$binary.previous"
  local unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  local unit="$unit_dir/dpf-edge-node.service"
  local version="${DPF_NATIVE_EDGE_VERSION:-$(git -C "$repo_root" describe --tags --abbrev=0 2>/dev/null || echo latest)}"
  local authority_url="${DPF_LAN_AUTHORITY_URL:-http://127.0.0.1:3000}"
  local platform_env="$repo_root/.env"
  local edge_action_url edge_action_ca edge_action_cert edge_action_key edge_action_public
  edge_action_url="$(_dpf_native_edge_env_value "$platform_env" DPF_EDGE_ACTION_URL)"
  edge_action_ca="$(_dpf_native_edge_env_value "$platform_env" DPF_EDGE_ACTION_CA_FILE)"
  edge_action_cert="$(_dpf_native_edge_env_value "$platform_env" DPF_EDGE_ACTION_CERT_FILE)"
  edge_action_key="$(_dpf_native_edge_env_value "$platform_env" DPF_EDGE_ACTION_KEY_FILE)"
  edge_action_public="$(_dpf_native_edge_env_value "$platform_env" DPF_EDGE_ACTION_SIGNING_PUBLIC_KEY_FILE)"

  mkdir -p "$bin_dir" "$edge_state_dir" "$log_dir" "$unit_dir"
  chmod 0700 "$state_root" "$edge_state_dir"
  # Acquire and verify the replacement while the current service stays online.
  rm -f "$binary_candidate"
  _dpf_native_edge_acquire_linux "$repo_root" "$binary_candidate" "$version" "$arch"
  systemctl --user stop dpf-edge-node.service 2>/dev/null || true
  if [ -f "$binary" ]; then
    cp "$binary" "$binary_backup"
    chmod 0755 "$binary_backup"
  fi
  mv "$binary_candidate" "$binary"

  {
    printf 'DPF_AUTHORITY_URL=%s\n' "$authority_url"
    printf 'DPF_BOOTSTRAP_TOKEN=%s\n' "$bootstrap_token"
    printf 'DPF_EDGE_NODE_NAME=%s\n' "$node_name"
    printf 'DPF_INSTALL_MODE=native\n'
    printf 'DPF_EDGE_ROLE=%s\n' "$edge_role"
    printf 'DPF_AUTOSTART_TASK_NAME=%s\n' "dpf.service"
    printf 'DPF_EDGE_STATE_DIR=%s\n' "$edge_state_dir"
    printf 'DPF_INSTALL_ROOT=%s\n' "$repo_root"
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
    printf '%s\n' '[Unit]' 'Description=DPF native Edge Node (host upkeep)' 'After=network-online.target' ''
    printf '%s\n' '[Service]'
    printf 'EnvironmentFile=%s\n' "$env_file"
    printf 'ExecStart=%s\n' "$binary"
    printf '%s\n' 'Restart=always' 'RestartSec=10'
    printf 'StandardOutput=append:%s/edge-node.out.log\n' "$log_dir"
    printf 'StandardError=append:%s/edge-node.err.log\n' "$log_dir"
    printf '%s\n' '' '[Install]' 'WantedBy=default.target'
  } > "$unit"
  chmod 0644 "$unit"

  systemctl --user daemon-reload 2>/dev/null || true
  if systemctl --user enable --now dpf-edge-node.service 2>/dev/null; then
    ok "Native Edge Node installed and supervised by systemd (user unit)"
  else
    if [ -f "$binary_backup" ]; then
      mv "$binary_backup" "$binary"
      systemctl --user restart dpf-edge-node.service 2>/dev/null || true
      warn "Native Edge Node could not start after upgrade; the prior binary was restored. See $log_dir/edge-node.err.log."
    else
      warn "Native Edge Node was installed but systemd could not start it. See $log_dir/edge-node.err.log."
    fi
    return 1
  fi
}
