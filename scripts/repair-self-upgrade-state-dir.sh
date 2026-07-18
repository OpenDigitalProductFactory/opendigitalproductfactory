#!/usr/bin/env bash
# Repair a self-upgrade wedged by the #3262 "mounts denied" / DPF_STATE_DIR bug.
#
# Symptom it fixes: the upgrade builds the image fine, then dies at step=migrate
# with `mounts denied: The path /root/.dpf is not shared from the host`. Cause:
# the portal's /dpf-state mount falls back to ${HOME}/.dpf, which is /root/.dpf
# under the root-run promoter, and Docker Desktop refuses to share it. The fix is
# to pin DPF_STATE_DIR to an ABSOLUTE, Docker-Desktop-shared host path in .env.
#
# This is what the installer now does for you (install-dpf.sh/.ps1); this script
# is a lightweight one-shot for an already-wedged install without re-running the
# full installer. Idempotent + safe to run repeatedly. Run from the install
# directory, or pass it: `scripts/repair-self-upgrade-state-dir.sh /opt/dpf`.
set -euo pipefail

install_dir="${1:-$PWD}"
env_file="$install_dir/.env"
state_dir="${DPF_STATE_DIR:-$HOME/.dpf}"

if [ ! -f "$env_file" ]; then
  echo "error: no .env at $env_file — run from the install directory or pass its path." >&2
  exit 1
fi

if grep -qE '^DPF_STATE_DIR=.+' "$env_file"; then
  echo "DPF_STATE_DIR already set — nothing to repair:"
  grep -E '^DPF_STATE_DIR=' "$env_file"
  exit 0
fi

mkdir -p "$state_dir"

if grep -qE '^DPF_STATE_DIR=$' "$env_file"; then
  # An empty value is present — replace it in place (awk, portable across BSD/GNU).
  tmp="$(mktemp)"
  awk -v v="$state_dir" '/^DPF_STATE_DIR=$/ { print "DPF_STATE_DIR=" v; next } { print }' \
    "$env_file" >"$tmp" && mv "$tmp" "$env_file"
  echo "Filled empty DPF_STATE_DIR=$state_dir in $env_file"
else
  printf '\n# Added by repair-self-upgrade-state-dir.sh (#3262). ABSOLUTE + Docker-shared\n' >>"$env_file"
  printf '# so the root-run self-upgrade promoter does not fall back to /root/.dpf.\n' >>"$env_file"
  printf 'DPF_STATE_DIR=%s\n' "$state_dir" >>"$env_file"
  echo "Set DPF_STATE_DIR=$state_dir in $env_file"
fi

# Best-effort: confirm Docker can actually share the path (skipped if docker/the
# promoter image are absent — the .env change is applied regardless).
if command -v docker >/dev/null 2>&1 && docker image inspect dpf-promoter >/dev/null 2>&1; then
  if docker run --rm --entrypoint sh -v "$state_dir:/dpf-state:ro" dpf-promoter -c 'true' >/dev/null 2>&1; then
    echo "Verified: Docker can share $state_dir."
  else
    echo "WARNING: Docker could NOT share $state_dir — add it under Docker → Settings →" >&2
    echo "         Resources → File Sharing, then re-run this script." >&2
  fi
fi

echo "Next: re-trigger the self-upgrade (Self-Upgrade page → Emergency override)."
