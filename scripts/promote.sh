#!/usr/bin/env bash
set -euo pipefail

# DPF self-upgrade promoter. Runs inside the dedicated `dpf-promoter` SIBLING
# container (Dockerfile.promoter) — never inside the portal — so it survives
# recreating the portal mid-swap. It drives the host docker daemon (mounted
# socket) to rebuild the portal image stamped with the target SHA, recreate the
# portal container, then health- and sha-verify the new portal.
#
# The orchestrating portal process dies when the portal is recreated, so it
# cannot mark the run succeeded. Boot reconciliation in the NEW portal
# (instrumentation.ts) records completion once it comes up reporting the target
# SHA. This script's exit code is still captured by whatever survives.

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

# Compose chain used to rebuild/recreate the portal. Defaults to the macOS
# dev chain; override with PROMOTE_COMPOSE_FILES (space-separated, relative to
# PROMOTE_SOURCE) for other platforms.
_project="${PROMOTE_COMPOSE_PROJECT:-dpf}"
# shellcheck disable=SC2206
_compose_files=(${PROMOTE_COMPOSE_FILES:-docker-compose.yml docker-compose.macos.yml})
_f_args=()
for _f in "${_compose_files[@]}"; do
  _f_args+=(-f "$PROMOTE_SOURCE/$_f")
done

# Emit a tagged step line; always prints in both dry-run and real modes.
# Only the step name and target SHA are printed — never source/backup/health
# paths — so logs are safe to surface to operators.
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
  mkdir -p "$PROMOTE_BACKUP_PATH" 2>/dev/null || true
  [[ -d "$PROMOTE_SOURCE" ]] || {
    printf 'error: PROMOTE_SOURCE is not a directory\n' >&2
    exit 1
  }
fi

# --- Step 2: backup ---
# Record the currently-deployed SHA so a rollback target is captured before the
# swap. Lightweight (no full tree copy); best-effort.
emit_step backup
if [[ $_dry_run -eq 0 ]]; then
  _prev_sha=$(curl -fsS "${PROMOTE_HEALTH_URL}/sha" 2>/dev/null | tr -d '[:space:]' || true)
  printf '%s\n' "${_prev_sha:-unknown}" > "$PROMOTE_BACKUP_PATH/previous-sha.txt" 2>/dev/null || true
fi

# --- Step 3: docker-build ---
# Rebuild the portal image from the host source, STAMPED with the target SHA
# (DPF_VERSION build-arg) so the new image reports a comparable git SHA.
emit_step docker-build
if [[ $_dry_run -eq 0 ]]; then
  export DPF_VERSION="$PROMOTE_TARGET_SHA"
  docker compose --project-directory "$PROMOTE_SOURCE" -p "$_project" \
    "${_f_args[@]}" build portal
fi

# --- Step 4: docker-up ---
# Recreate ONLY the portal from the freshly built image. --no-deps leaves
# postgres/neo4j/etc. running. DEPLOYED_SHA resolves to DPF_VERSION (target)
# via compose, so the new portal reports the target SHA at /api/health/sha.
emit_step docker-up
if [[ $_dry_run -eq 0 ]]; then
  export DPF_VERSION="$PROMOTE_TARGET_SHA"
  docker compose --project-directory "$PROMOTE_SOURCE" -p "$_project" \
    "${_f_args[@]}" up -d --no-deps --force-recreate portal
fi

# --- Step 5: health ---
# Wait for the recreated portal to report healthy (it takes time to boot).
emit_step health
if [[ $_dry_run -eq 0 ]]; then
  _healthy=0
  for _i in $(seq 1 60); do
    if curl -fsS "$PROMOTE_HEALTH_URL" >/dev/null 2>&1; then _healthy=1; break; fi
    sleep 5
  done
  [[ $_healthy -eq 1 ]] || {
    printf 'error: portal did not become healthy within timeout\n' >&2
    exit 1
  }
fi

# --- Step 6: sha-verify ---
# Confirm the running deployment reports the expected target SHA.
emit_step sha-verify
if [[ $_dry_run -eq 0 ]]; then
  _match=0
  _deployed_sha=""
  for _i in $(seq 1 30); do
    _deployed_sha=$(curl -fsS "${PROMOTE_HEALTH_URL}/sha" 2>/dev/null | tr -d '[:space:]' || true)
    if [[ "$_deployed_sha" == "$PROMOTE_TARGET_SHA" ]]; then _match=1; break; fi
    sleep 3
  done
  [[ $_match -eq 1 ]] || {
    printf 'error: deployed SHA %s does not match target %s\n' \
      "${_deployed_sha:-unknown}" "$PROMOTE_TARGET_SHA" >&2
    exit 1
  }
  printf 'step=done target=%s\n' "$PROMOTE_TARGET_SHA"
fi
