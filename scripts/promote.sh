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
_env_args=()
if [[ -n "${PROMOTE_COMPOSE_ENV_FILE:-}" ]]; then
  [[ -f "$PROMOTE_COMPOSE_ENV_FILE" ]] || {
    printf 'error: PROMOTE_COMPOSE_ENV_FILE is not readable\n' >&2
    exit 1
  }
  _env_args+=(--env-file "$PROMOTE_COMPOSE_ENV_FILE")
fi

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

# Real platform version from the source's git release tags, baked into the new
# image so the portal keeps showing a real version (not version.json) after a
# self-upgrade. safe.directory: the mounted source is owned by the host user,
# not root, so git refuses to read it without this.
export DPF_PLATFORM_VERSION=""
if [[ $_dry_run -eq 0 ]]; then
  git config --global --add safe.directory '*' 2>/dev/null || true
  DPF_PLATFORM_VERSION="$(git -C "$PROMOTE_SOURCE" describe --tags --always 2>/dev/null | sed 's/^v//' || true)"
  export DPF_PLATFORM_VERSION
fi

# --- Step 3: docker-build ---
# Rebuild the portal image from the host source. The DPF_VERSION stamp is
# derived from the ACTUAL bytes being built — `rev-parse HEAD` of the build
# source (plus a `-dirty` suffix when the tree has uncommitted changes) — NOT
# from the caller-supplied target. This is the load-bearing truth fix: the
# image can only ever report the identity of the code it actually contains, so
# the later sha-verify is a real check rather than reading back a value we set.
# PROMOTE_TARGET_SHA is the orchestrator's EXPECTED identity (the stamp it
# computed after preparing/merging the source); a mismatch is surfaced as a
# warning so drift between prepare and build is visible without coupling this
# script to the orchestrator's rollout state. The real platform version
# (DPF_PLATFORM_VERSION, computed above from git tags) is baked in the same build.
emit_step docker-build
if [[ $_dry_run -eq 0 ]]; then
  _built_sha=$(git -C "$PROMOTE_SOURCE" rev-parse HEAD 2>/dev/null | tr -d '[:space:]' || true)
  [[ -n "$_built_sha" ]] || {
    printf 'error: cannot resolve HEAD of build source %s\n' "$PROMOTE_SOURCE" >&2
    exit 1
  }
  if [[ -n "$(git -C "$PROMOTE_SOURCE" status --porcelain 2>/dev/null || true)" ]]; then
    _built_sha="${_built_sha}-dirty"
  fi
  if [[ -n "${PROMOTE_TARGET_SHA:-}" && "$PROMOTE_TARGET_SHA" != "$_built_sha" ]]; then
    printf 'warning: build source identity %s differs from expected %s\n' \
      "$_built_sha" "$PROMOTE_TARGET_SHA" >&2
  fi
  export DPF_VERSION="$_built_sha"
  docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$PROMOTE_SOURCE" -p "$_project" \
    "${_f_args[@]}" build portal
  # Capture the source content hash baked into the FRESHLY BUILT image. It is
  # computed from the actual bundled source bytes (Dockerfile) independent of
  # the DPF_VERSION label, so the content-verify step can prove the recreated
  # container is this image and not a stale one. Portal has no `image:` field,
  # so compose tags the built image ${_project}-portal.
  _built_hash=$(docker run --rm "${_project}-portal" cat /app/.dpf-source-content-hash 2>/dev/null | tr -d '[:space:]' || true)
  [[ -n "$_built_hash" ]] || {
    printf 'error: freshly built image has no /app/.dpf-source-content-hash\n' >&2
    exit 1
  }
fi

# --- Step 4: docker-up ---
# Recreate ONLY the portal from the freshly built image. --no-deps leaves
# postgres/neo4j/etc. running. DEPLOYED_SHA resolves to DPF_VERSION (the
# derived built identity) via compose, so the new portal reports exactly the
# SHA of the code it is running at /api/health/sha.
emit_step docker-up
if [[ $_dry_run -eq 0 ]]; then
  docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$PROMOTE_SOURCE" -p "$_project" \
    "${_f_args[@]}" up -d --no-deps --force-recreate portal
fi  # DPF_PLATFORM_VERSION stays exported from above so any rebuild keeps the stamp

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
# Confirm the running deployment reports the SHA of the code we actually built
# ($_built_sha from step 3) — NOT the caller-supplied target. Because the stamp
# is derived from the build source's own HEAD, this genuinely proves the running
# runtime is at the built commit rather than echoing a value we chose.
emit_step sha-verify
if [[ $_dry_run -eq 0 ]]; then
  _match=0
  _deployed_sha=""
  for _i in $(seq 1 30); do
    _deployed_sha=$(curl -fsS "${PROMOTE_HEALTH_URL}/sha" 2>/dev/null | tr -d '[:space:]' || true)
    if [[ "$_deployed_sha" == "$_built_sha" ]]; then _match=1; break; fi
    sleep 3
  done
  [[ $_match -eq 1 ]] || {
    printf 'error: deployed SHA %s does not match built SHA %s\n' \
      "${_deployed_sha:-unknown}" "$_built_sha" >&2
    exit 1
  }
fi

# --- Step 7: content-verify ---
# Structural-verification-is-not-functional guard (BI-C8E90A79): prove the
# RUNNING container is the image we just built by comparing the source content
# hash baked into each. This catches a recreate that silently kept a STALE
# image — which sha-verify cannot, because a stale image left from a prior
# (broken) upgrade can carry the same SHA label. Neither hash is the
# DPF_VERSION we set; both are computed from actual source bytes, so the check
# is capable of failing.
emit_step content-verify
if [[ $_dry_run -eq 0 ]]; then
  _running_hash=$(docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$PROMOTE_SOURCE" -p "$_project" \
    "${_f_args[@]}" exec -T portal cat /app/.dpf-source-content-hash 2>/dev/null | tr -d '[:space:]' || true)
  [[ -n "$_running_hash" && "$_running_hash" == "$_built_hash" ]] || {
    printf 'error: running content hash %s does not match freshly built %s — recreate did not deploy the new image\n' \
      "${_running_hash:-unknown}" "$_built_hash" >&2
    exit 1
  }
  printf 'step=done target=%s\n' "$_built_sha"
fi
