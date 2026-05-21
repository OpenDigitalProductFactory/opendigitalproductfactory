#!/usr/bin/env bash
set -euo pipefail

_self_upgrade=0
_dry_run=0

for arg in "$@"; do
  case "$arg" in
    --self-upgrade) _self_upgrade=1 ;;
    --dry-run)      _dry_run=1 ;;
  esac
done

[[ $_self_upgrade -eq 1 ]] || { printf 'error: --self-upgrade flag required\n' >&2; exit 1; }

# Validate all required variables before any mutating work
_missing=()
[[ -n "${PROMOTE_SOURCE:-}"      ]] || _missing+=(PROMOTE_SOURCE)
[[ -n "${PROMOTE_TARGET_SHA:-}"  ]] || _missing+=(PROMOTE_TARGET_SHA)
[[ -n "${PROMOTE_BACKUP_PATH:-}" ]] || _missing+=(PROMOTE_BACKUP_PATH)
[[ -n "${PROMOTE_HEALTH_URL:-}"  ]] || _missing+=(PROMOTE_HEALTH_URL)

if [[ ${#_missing[@]} -gt 0 ]]; then
  printf 'error: missing required variables: %s\n' "${_missing[*]}" >&2
  exit 1
fi

# Emit a tagged step line; always prints in both dry-run and real modes.
emit_step() {
  if [[ $_dry_run -eq 1 ]]; then
    printf 'dry-run: step=%s target=%s\n' "$1" "$PROMOTE_TARGET_SHA"
  else
    printf 'step=%s target=%s\n' "$1" "$PROMOTE_TARGET_SHA"
  fi
}

# --- Step 1: prepare ---
# Ensure backup parent directory exists and source is present.
emit_step prepare
if [[ $_dry_run -eq 0 ]]; then
  mkdir -p "$PROMOTE_BACKUP_PATH"
  [[ -d "$PROMOTE_SOURCE" ]] || {
    printf 'error: PROMOTE_SOURCE %s is not a directory\n' "$PROMOTE_SOURCE" >&2
    exit 1
  }
fi

# --- Step 2: backup ---
# Copy current deployment to the backup path before any destructive changes.
emit_step backup
if [[ $_dry_run -eq 0 ]]; then
  cp -a "$PROMOTE_SOURCE/." "$PROMOTE_BACKUP_PATH/"
fi

# --- Step 3: docker-build ---
# Build a new image tagged with the target SHA.
emit_step docker-build
if [[ $_dry_run -eq 0 ]]; then
  docker build --label "sha=$PROMOTE_TARGET_SHA" \
    -t "app:$PROMOTE_TARGET_SHA" \
    "$PROMOTE_SOURCE"
fi

# --- Step 4: docker-up ---
# Start containers from the newly built image.
emit_step docker-up
if [[ $_dry_run -eq 0 ]]; then
  docker compose up -d --force-recreate
fi

# --- Step 5: health ---
# Wait for the application to report healthy.
emit_step health
if [[ $_dry_run -eq 0 ]]; then
  curl -fsS "$PROMOTE_HEALTH_URL" > /dev/null
fi

# --- Step 6: sha-verify ---
# Confirm the running deployment reports the expected target SHA.
emit_step sha-verify
if [[ $_dry_run -eq 0 ]]; then
  _deployed_sha=$(curl -fsS "${PROMOTE_HEALTH_URL}/sha" 2>/dev/null | tr -d '[:space:]')
  [[ "$_deployed_sha" == "$PROMOTE_TARGET_SHA" ]] || {
    printf 'error: deployed SHA %s does not match target %s\n' \
      "$_deployed_sha" "$PROMOTE_TARGET_SHA" >&2
    exit 1
  }
fi
