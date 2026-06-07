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

# Compose chain used to rebuild/recreate the portal. The orchestrator passes
# PROMOTE_COMPOSE_FILES (space-separated, relative to PROMOTE_SOURCE) carrying
# the platform-correct chain the install was created with — base + the host
# platform overlay (docker-compose.linux.yml / .macos.yml) + edge, recorded in
# install-state.json's composeFiles. The fallback is BASE-ONLY: it must never be
# a platform overlay, because force-applying e.g. docker-compose.macos.yml on a
# Windows/Linux host overrides portal env (TTS_PROVIDER=mlx, DPF_TTS_URL=:8771,
# ollama LLM_BASE_URL) with values for the wrong substrate. Base-only is the only
# safe platform-agnostic default; the recorded chain is what makes overlays apply
# where the install actually needs them.
_project="${PROMOTE_COMPOSE_PROJECT:-dpf}"
# shellcheck disable=SC2206
_compose_files=(${PROMOTE_COMPOSE_FILES:-docker-compose.yml})
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
#
# PROMOTE_TARGET_SHA is the orchestrator's intended identity (the stamp it
# computed after preparing/merging the source). The spec §4.3 / BI-5B6C1C35
# invariant is stamp == built HEAD == target, asserted PRE-SWAP. A divergence
# here means the bytes about to be deployed are NOT the bytes the orchestrator
# resolved — exactly the stale-image class of bug — so we FAIL LOUD before
# building rather than recreating the portal under a label that lies about its
# contents. (A dirty build tree is also rejected: a `-dirty` stamp can never
# equal a clean target SHA, and promoting uncommitted bytes is never intended.)
# The real platform version (DPF_PLATFORM_VERSION, from git tags) is baked in
# the same build.
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
  if [[ "$PROMOTE_TARGET_SHA" != "$_built_sha" ]]; then
    printf 'error: build source identity %s does not match promote target %s — refusing to build an image whose bytes diverge from the intended target (BI-5B6C1C35)\n' \
      "$_built_sha" "$PROMOTE_TARGET_SHA" >&2
    exit 1
  fi
  export DPF_VERSION="$_built_sha"
  # Force the classic BuildKit build path (via the docker daemon) instead of
  # Compose Bake. The promoter image's Compose can default to Bake, which
  # requires the buildx CLI plugin — absent in the promoter — and fails every
  # self-upgrade at docker-build with "Docker Compose is configured to build
  # using Bake, but buildx isn't installed". This matches the working manual
  # `docker compose build` path. (Self-upgrade docker-build failures, 2026-06-06.)
  export COMPOSE_BAKE=false
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

# --- Step 3b: migrate ---
# Apply DB migrations using the FRESHLY BUILT portal image BEFORE recreating the
# long-running portal. The swap in step 4 recreates ONLY `portal` (--no-deps),
# so it never runs the one-shot `portal-init` service that a normal
# `docker compose up` runs to migrate the DB. Without this step a self-upgrade
# that ships a migration leaves the live DB drifted, and every query for a new
# column throws Prisma P2022 ColumnNotFound — the 2026-06-07 crash incident
# (BI-D9BAB4FA) where /ops/self-upgrade, /build, /platform and /workbooks all
# died after a swap. Running `prisma migrate deploy` from the new image's own
# bytes is forward-only and FAIL-CLOSED: `set -e` aborts the upgrade on a
# migration error BEFORE the swap, so the OLD portal keeps serving the OLD code
# against a consistent DB rather than a new image landing on an un-migrated one.
# DPF migrations are additive (expand), so applying them while the old portal is
# still running is safe — it simply ignores the new columns until it is replaced.
emit_step migrate
if [[ $_dry_run -eq 0 ]]; then
  docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$PROMOTE_SOURCE" -p "$_project" \
    "${_f_args[@]}" run --rm -T --no-deps --entrypoint sh portal \
    -c 'cd /app && pnpm --filter @dpf/db exec prisma migrate deploy'
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
# ($_built_sha from step 3). Step 3 already asserted _built_sha == target, so a
# match here closes the three-way identity loop required by spec §4.3:
# stamp(/sha) == built HEAD == target. The stamp is derived from the build
# source's own HEAD (baked → DEPLOYED_SHA → /api/health/sha), so this genuinely
# proves the running runtime is at the built commit rather than echoing a value
# we chose. An EMPTY /sha is a hard failure, not a retry-until-timeout: it means
# DEPLOYED_SHA was never populated in the running portal (the BI-5B6C1C35
# symptom), so the runtime cannot prove its own identity and must not pass.
emit_step sha-verify
if [[ $_dry_run -eq 0 ]]; then
  _match=0
  _deployed_sha=""
  for _i in $(seq 1 30); do
    _deployed_sha=$(curl -fsS "${PROMOTE_HEALTH_URL}/sha" 2>/dev/null | tr -d '[:space:]' || true)
    # An EMPTY /sha is a hard failure, not a transient miss to retry: DEPLOYED_SHA
    # is unpopulated in the running image, so it can never report an identity no
    # matter how long we wait. Break immediately and fail loud below rather than
    # spinning the full retry budget (which would blow the verify timeout).
    [[ -z "$_deployed_sha" ]] && break
    if [[ "$_deployed_sha" == "$_built_sha" ]]; then _match=1; break; fi
    sleep 3
  done
  if [[ -z "$_deployed_sha" ]]; then
    printf 'error: running portal reported an EMPTY deployed SHA at /sha — DEPLOYED_SHA is not populated in the running image, so it cannot prove it carries the built bytes (BI-5B6C1C35)\n' >&2
    exit 1
  fi
  [[ $_match -eq 1 ]] || {
    printf 'error: deployed SHA %s does not match built/target SHA %s — running portal does not carry the bytes that were built (BI-5B6C1C35)\n' \
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
