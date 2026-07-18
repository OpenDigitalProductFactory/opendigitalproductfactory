#!/usr/bin/env bash
# Shared platform-detection helpers for DPF installer + setup scripts.
# Source this file; do not execute directly.
#
# Provides:
#   dpf_platform        - exports DPF_PLATFORM = "darwin" | "linux" | "win32"
#   dpf_arch            - exports DPF_ARCH     = "arm64" | "amd64"
#   dpf_sed_inplace     - portable sed -i wrapper that works on GNU sed
#                          (Linux) and BSD sed (macOS) without bak files
#                          left behind. Usage: dpf_sed_inplace 's|a|b|' file
#
# Bash 3.2 baseline (macOS default).

if [ "${DPF_LIB_PLATFORM_LOADED:-}" = "1" ]; then
  return 0
fi
DPF_LIB_PLATFORM_LOADED=1

dpf_platform() {
  case "$(uname -s)" in
    Darwin)  DPF_PLATFORM="darwin" ;;
    Linux)   DPF_PLATFORM="linux"  ;;
    MINGW*|MSYS*|CYGWIN*) DPF_PLATFORM="win32" ;;
    *) echo "dpf_platform: unsupported host platform: $(uname -s)" >&2; return 1 ;;
  esac
  export DPF_PLATFORM
}

dpf_arch() {
  case "$(uname -m)" in
    arm64|aarch64)  DPF_ARCH="arm64" ;;
    x86_64|amd64)   DPF_ARCH="amd64" ;;
    *) echo "dpf_arch: unsupported host architecture: $(uname -m)" >&2; return 1 ;;
  esac
  export DPF_ARCH
}

# Portable in-place sed.
#   GNU sed (Linux):  sed -i 'EXPR' file
#   BSD sed (macOS):  sed -i '' 'EXPR' file
# We avoid leaving .bak files by always passing an empty backup suffix on BSD.
# Caller is responsible for ensuring EXPR is properly escaped.
dpf_sed_inplace() {
  local expr="$1"
  local file="$2"
  if [ -z "$expr" ] || [ -z "$file" ]; then
    echo "dpf_sed_inplace: requires expression and file args" >&2
    return 1
  fi
  if sed --version >/dev/null 2>&1; then
    # GNU sed
    sed -i "$expr" "$file"
  else
    # BSD sed (macOS); empty backup suffix means no .bak left behind
    sed -i '' "$expr" "$file"
  fi
}
