#!/usr/bin/env bash
# GitHub CLI (gh) provisioning for the DPF installer.
# Source this file; do not execute directly.
#
# Installs the official `gh` binary into a user-writable directory (no
# Homebrew, no sudo) when it is missing, and adds that directory to PATH via
# an idempotent shell-rc marker block. This is the contributor-onboarding
# slice that removes the manual "install gh" friction on a fresh machine.
#
# OAuth sign-in (`gh auth login`) is intentionally NOT performed here — it is
# an interactive browser flow, and it is the org-policy-friendly path (OAuth
# tokens are exempt from the fine-grained-PAT lifetime limits some orgs set).
# The installer points the operator at it; wiring the git credential helper
# (`gh auth setup-git`) is a follow-up slice.
#
# Bash 3.2 baseline (macOS default).

if [ "${DPF_LIB_GITHUB_CLI_LOADED:-}" = "1" ]; then
  return 0
fi
DPF_LIB_GITHUB_CLI_LOADED=1

# Pull in platform.sh (dpf_platform / dpf_arch) and logging.sh (ok/info/warn)
# so the lib is usable standalone (e.g. in unit tests), not only when sourced
# after them by install-dpf.sh.
if [ -z "${DPF_LIB_PLATFORM_LOADED:-}" ]; then
  # shellcheck source=platform.sh
  . "$(dirname "${BASH_SOURCE[0]}")/platform.sh"
fi
if [ -z "${DPF_LIB_LOGGING_LOADED:-}" ]; then
  # shellcheck source=logging.sh
  . "$(dirname "${BASH_SOURCE[0]}")/logging.sh"
fi

# Directory where DPF installs user-local CLIs. Host-level (under ~/.dpf, the
# install-state home) so it survives a repo re-clone. Override with
# DPF_TOOLS_DIR for tests.
dpf_tools_bin() {
  echo "${DPF_TOOLS_DIR:-$HOME/.dpf/tools}/bin"
}

# Prepend a directory to PATH via an idempotent marker block in the operator's
# shell rc files. Mirrors the safety-bin PATH wiring in install-dpf.sh, but
# also (a) covers ~/.zprofile — the zsh login file that modern macOS uses — and
# (b) creates ~/.zprofile if NONE of the candidate rc files exist, so a fresh
# zsh account (no .zshrc/.profile) still gets the PATH change. Without that, the
# block would land nowhere and the tool would vanish in new terminals.
# Args: $1 = directory, $2 = marker label (e.g. "dpf-tools-bin")
dpf_add_dir_to_path() {
  local dir="$1" label="$2"
  local begin="# >>> ${label} >>>"
  local end="# <<< ${label} <<<"
  local block="${begin}
export PATH=\"${dir}:\$PATH\"
${end}"
  local rc wrote=0
  for rc in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.zprofile"; do
    [ -e "$rc" ] || continue
    if grep -q "$begin" "$rc" 2>/dev/null; then
      wrote=1            # already present — counts as wired
    else
      printf '\n%s\n' "$block" >> "$rc"
      wrote=1
    fi
  done
  # No shell rc existed at all (common on a brand-new zsh account): create the
  # zsh login file so the PATH change actually persists.
  if [ "$wrote" = "0" ]; then
    printf '\n%s\n' "$block" >> "$HOME/.zprofile"
  fi
  export PATH="${dir}:$PATH"
}

# Portable sha256 of a file (macOS shasum / Linux sha256sum). Empty if neither.
dpf_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    echo ""
  fi
}

# Ensure the GitHub CLI (`gh`) is available, installing it without Homebrew or
# sudo if missing. Honors DPF_DRY_RUN (reports intent, no download).
# Returns 0 if gh ends up available, non-zero (non-fatal to the caller) if the
# auto-install could not complete — the caller should treat it as advisory.
dpf_ensure_gh() {
  if command -v gh >/dev/null 2>&1; then
    ok "GitHub CLI present ($(gh --version 2>/dev/null | head -1))"
    return 0
  fi

  if [ "${DPF_DRY_RUN:-0}" = "1" ]; then
    info "DRY-RUN: would download + install the GitHub CLI (gh) into $(dpf_tools_bin)"
    return 0
  fi

  dpf_platform
  dpf_arch

  local gh_os gh_ext
  case "$DPF_PLATFORM" in
    darwin) gh_os="macOS"; gh_ext="zip" ;;
    linux)  gh_os="linux"; gh_ext="tar.gz" ;;
    *) warn "Unsupported platform '$DPF_PLATFORM' for gh auto-install; install manually from https://cli.github.com"; return 1 ;;
  esac
  local gh_arch
  case "$DPF_ARCH" in
    arm64) gh_arch="arm64" ;;
    amd64) gh_arch="amd64" ;;
    *) warn "Unknown arch '$DPF_ARCH' for gh auto-install; install manually from https://cli.github.com"; return 1 ;;
  esac

  if ! command -v curl >/dev/null 2>&1; then
    warn "curl not found; cannot auto-install gh. Install manually from https://cli.github.com"
    return 1
  fi

  # Resolve the latest release + matching asset via the GitHub API. jq is a
  # hard installer dependency (verified in install-dpf.sh preflight).
  local rel tag ver asset url sums_url
  rel="$(curl -fsSL -H 'Accept: application/vnd.github+json' \
         https://api.github.com/repos/cli/cli/releases/latest 2>/dev/null)" || rel=""
  if [ -z "$rel" ]; then
    warn "Could not reach the GitHub API to resolve the latest gh release; install manually from https://cli.github.com"
    return 1
  fi
  tag="$(printf '%s' "$rel" | jq -r '.tag_name // empty')"
  ver="${tag#v}"
  if [ -z "$ver" ]; then
    warn "Could not parse the latest gh version; install manually from https://cli.github.com"
    return 1
  fi
  asset="gh_${ver}_${gh_os}_${gh_arch}.${gh_ext}"
  url="$(printf '%s' "$rel" | jq -r --arg a "$asset" '.assets[] | select(.name==$a) | .browser_download_url' | head -1)"
  if [ -z "$url" ] || [ "$url" = "null" ]; then
    warn "No gh release asset named '$asset' in $tag; install manually from https://cli.github.com"
    return 1
  fi
  sums_url="$(printf '%s' "$rel" | jq -r '.assets[] | select(.name|endswith("checksums.txt")) | .browser_download_url' | head -1)"

  local tmp; tmp="$(mktemp -d)"
  info "Downloading GitHub CLI $tag ($asset)..."
  if ! curl -fsSL "$url" -o "$tmp/$asset"; then
    warn "gh download failed; install manually from https://cli.github.com"
    rm -rf "$tmp"; return 1
  fi

  # Verify against the release checksums when available; refuse on mismatch.
  if [ -n "$sums_url" ] && [ "$sums_url" != "null" ] && curl -fsSL "$sums_url" -o "$tmp/checksums.txt" 2>/dev/null; then
    local expected actual
    expected="$(grep " ${asset}\$" "$tmp/checksums.txt" 2>/dev/null | awk '{print $1}' | head -1)"
    actual="$(dpf_sha256 "$tmp/$asset")"
    if [ -n "$expected" ] && [ -n "$actual" ]; then
      if [ "$expected" != "$actual" ]; then
        warn "Checksum mismatch for $asset; refusing to install. Get gh from https://cli.github.com"
        rm -rf "$tmp"; return 1
      fi
      ok "Checksum verified for $asset"
    else
      warn "Could not compute/locate checksum for $asset; proceeding (binary is smoke-tested below)."
    fi
  else
    warn "Release checksums unavailable; proceeding (binary is smoke-tested below)."
  fi

  # Extract.
  local extract_dir="$tmp/extract"
  mkdir -p "$extract_dir"
  case "$gh_ext" in
    zip)
      if ! unzip -q "$tmp/$asset" -d "$extract_dir" 2>/dev/null; then
        warn "Could not unzip the gh archive; install manually from https://cli.github.com"
        rm -rf "$tmp"; return 1
      fi ;;
    tar.gz)
      if ! tar -xzf "$tmp/$asset" -C "$extract_dir" 2>/dev/null; then
        warn "Could not untar the gh archive; install manually from https://cli.github.com"
        rm -rf "$tmp"; return 1
      fi ;;
  esac

  # Locate the gh binary (archive layout: gh_<ver>_<os>_<arch>/bin/gh).
  local gh_bin
  gh_bin="$(find "$extract_dir" -type f -name gh -path '*/bin/gh' 2>/dev/null | head -1)"
  [ -n "$gh_bin" ] || gh_bin="$(find "$extract_dir" -type f -name gh 2>/dev/null | head -1)"
  if [ -z "$gh_bin" ]; then
    warn "Could not find the gh binary in the download; install manually from https://cli.github.com"
    rm -rf "$tmp"; return 1
  fi

  local bin_dir; bin_dir="$(dpf_tools_bin)"
  mkdir -p "$bin_dir"
  cp "$gh_bin" "$bin_dir/gh"
  chmod +x "$bin_dir/gh"
  rm -rf "$tmp"

  dpf_add_dir_to_path "$bin_dir" "dpf-tools-bin"

  if "$bin_dir/gh" --version >/dev/null 2>&1; then
    ok "GitHub CLI installed: $("$bin_dir/gh" --version 2>/dev/null | head -1)"
    info "  Installed at $bin_dir/gh — open a new terminal for PATH changes in other shells."
    return 0
  fi
  warn "Installed gh but it failed to run; install manually from https://cli.github.com"
  return 1
}
