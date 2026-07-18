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

# Runtime capability transitions use this universal-core entrypoint. Until the
# signed envelope/receipt protocol lands (Task 3 Step 7), recognize the mode but
# fail before reading install state or invoking Docker. Exit 78 = configuration
# unavailable; stdout is structured and contains no secrets.
if [[ "${1:-}" == "--runtime-capability-transition" ]]; then
  _transition_id="${2:-}"
  [[ "$_transition_id" =~ ^RCT-[A-Za-z0-9-]{1,48}$ ]] || {
    printf '{"status":"failed","failure":"invalid_transition_id"}\n' >&2
    exit 64
  }
  printf '{"status":"failed","failure":"signed_protocol_unavailable","transitionId":"%s"}\n' "$_transition_id" >&2
  exit 78
fi

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

# BET-5 (BI-A1E864A5): does this Postgres container's IMAGE provide the pgvector
# extension? Image-agnostic — query pg_available_extensions (which reflects the
# on-disk control file wherever it lives) instead of probing a hard-coded path.
# The Debian-based pgvector/pgvector image keeps vector.control at
# /usr/share/postgresql/16/extension, NOT /usr/local/share/postgresql/extension
# (a source build's path), so a path probe wrongly reports "absent" on the very
# image we recreate onto — making the idempotent skip never fire and recreating
# Postgres on every upgrade. `psql -U` connects over the local socket (trust), so
# no password is needed. Returns 0 (yes) / non-zero (no).
_pg_provides_vector() {
  local _c="$1" _out
  _out="$(docker exec "$_c" psql -U "${POSTGRES_USER:-dpf}" -d "${POSTGRES_DB:-dpf}" -tAc \
    "select 1 from pg_available_extensions where name = 'vector' limit 1" 2>/dev/null | tr -d '[:space:]')"
  [[ "$_out" == "1" ]]
}

# BET-5 (BI-A1E864A5): recreate a Postgres service onto the pgvector image WITHOUT
# dragging any host bind mount. The promoter runs compose with
# --project-directory="$PROMOTE_SOURCE" (its in-container /host-source mount), so a
# service's RELATIVE host bind — the main postgres mounts ./scripts/init-inngest-db.sh
# — resolves to /host-source/scripts/..., a path the HOST docker daemon cannot share,
# stranding the container in `Created` (DB offline, migrate never runs). The init
# script only runs on an EMPTY data dir (never on an upgrade), so recreate with a
# compose override that pins the pgvector image and replaces the service volumes with
# only its named data volume. Data-preserving: the named volume is never touched.
# Args: <service> <named-data-volume>.
_recreate_pg_onto_pgvector() {
  local _svc="$1" _datavol="$2" _ov _rc=0
  _ov="$(mktemp)" || return 1
  cat > "$_ov" <<YAML
services:
  ${_svc}:
    image: pgvector/pgvector:pg16
    volumes: !override
      - ${_datavol}:/var/lib/postgresql/data
YAML
  docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$PROMOTE_SOURCE" -p "$_project" \
    "${_f_args[@]}" -f "$_ov" up -d --no-deps --force-recreate "$_svc" || _rc=1
  rm -f "$_ov"
  return "$_rc"
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
  # BI-145214F0 — refresh tags before describe (same root cause as
  # install-dpf.sh). PROMOTE_SOURCE is the host source mount inside the
  # dpf-promoter container; without this the promoter inherits whatever
  # stale tag cache the host had and stamps every rebuilt portal image
  # with an out-of-date release-line label. Best-effort: failure (offline,
  # auth, etc.) must not abort the upgrade — the SHA stamp is still honest.
  git -C "$PROMOTE_SOURCE" fetch --tags --force origin 2>/dev/null || true
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
  # Build portal AND postgres. postgres is now a first-party built image
  # (docker/postgres/Dockerfile — pgvector + baked init script, BI-4796D52B);
  # building it here guarantees the image exists before any recreate, and the
  # build context is streamed to the daemon so it works from /host-source where
  # a host bind mount could not. The build is a single COPY over the cached
  # pgvector base — negligible cost.
  docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$PROMOTE_SOURCE" -p "$_project" \
    "${_f_args[@]}" build portal postgres
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

# --- Step 3a: ensure Postgres provides pgvector ---
# BET-5 (BI-A1E864A5): the vector migration runs `CREATE EXTENSION vector`, which the plain
# `postgres:16` image does not ship. A self-upgrade recreates ONLY the portal (step 4, --no-deps),
# so an existing install's postgres container keeps whatever image it launched with — and the
# Phase-0 compose bump to `pgvector/pgvector:pg16` never reaches it. Without this step, step 3b
# `migrate deploy` fails with "extension \"vector\" is not available" and the upgrade aborts
# before the swap. Recreate postgres onto the compose-pinned pgvector image BEFORE migrate.
#
# IDEMPOTENT: skips when the running container's image already provides pgvector (a fresh install
# built from the new compose, or an install already upgraded), detected image-agnostically via
# pg_available_extensions. DATA-PRESERVING: pgvector/pgvector is the same PG16 engine as postgres:16
# on the same pgdata volume (a strict superset image), so the recreate keeps all data — no
# dump/restore. FAIL-CLOSED like migrate: if the recreate or the readiness wait fails, abort before
# the swap so the old portal keeps serving the old code.
emit_step ensure-pgvector
if [[ $_dry_run -eq 0 ]]; then
  _pg_container="${DPF_PRODUCTION_DB_CONTAINER:-${_project}-postgres-1}"
  if _pg_provides_vector "$_pg_container"; then _has_vector=yes; else _has_vector=no; fi
  if [[ "$_has_vector" != "yes" ]]; then
    printf 'step=ensure-pgvector-recreate target=%s\n' "$PROMOTE_TARGET_SHA"
    _recreate_pg_onto_pgvector postgres pgdata || {
        printf 'error: could not recreate postgres onto the pgvector image — the BET-5 vector migration cannot apply\n' >&2
        exit 1
      }
    # Wait for the recreated postgres to accept connections before migrate.
    _pg_ready=0
    for _i in $(seq 1 30); do
      if docker exec "$_pg_container" pg_isready -U "${POSTGRES_USER:-dpf}" >/dev/null 2>&1; then _pg_ready=1; break; fi
      sleep 2
    done
    [[ $_pg_ready -eq 1 ]] || { printf 'error: postgres did not become ready after the pgvector recreate\n' >&2; exit 1; }
  fi
  # P3009 recovery (BET-5): an install that attempted this upgrade on a pre-fix promoter (no
  # pgvector) left the pgvector-foundation migration in a FAILED state, which then blocks ALL
  # subsequent `migrate deploy` with P3009 — even after pgvector is present. Now that pgvector
  # is guaranteed available above, clear that ONE failed record so deploy can re-apply it.
  # Scoped to this single migration, which fails at its first statement (CREATE EXTENSION), so
  # nothing was applied and rolling it back is a no-op on data. Best-effort (`|| true`): a
  # clean install has no such record and this is a harmless miss.
  docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$PROMOTE_SOURCE" -p "$_project" \
    "${_f_args[@]}" run --rm -T --no-deps --entrypoint sh portal \
    -c 'cd /app && pnpm --filter @dpf/db exec prisma migrate resolve --rolled-back 20260714110000_bet5_pgvector_foundation' >/dev/null 2>&1 || true
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
# NOTE: step 4b (seed) re-runs the full /docker-entrypoint.sh AFTER the swap,
# which includes migrations as part of its retry loop — safe because migrate
# deploy is idempotent. Step 3b is still needed as the pre-swap schema guard.
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

# --- Step 4b: seed ---
# Re-run /docker-entrypoint.sh from the freshly swapped portal image so that
# any new reference data (archetypes, regulatory entries, EA reference models,
# capability perspectives, provider registries, catalog reconciliation) ships
# atomically with the code that expects it.
#
# promote.sh step 4 uses --no-deps, so portal-init (the one-shot service that
# normally runs the full entrypoint at install time) never runs. The running
# portal's CMD is the app server, not /docker-entrypoint.sh. Without this step
# a self-upgrade that ships new seed rows leaves the live DB at the previous
# seed state — features that depend on the new rows silently degrade or throw
# missing-row errors. This was the root cause of the banking archetype
# post-upgrade invisibility that required a manual seed recovery (BI-86FC0336).
#
# All seed operations use upsert, so re-running is IDEMPOTENT. This step is
# FAIL-CLOSED: set -e aborts the upgrade here if the seed fails, keeping the
# stale-data failure visible rather than letting it silently pass health checks.
# The seed runs in a one-shot sibling container (--rm) that talks directly to
# postgres; the portal is already started and the two containers run concurrently,
# which is safe because all seed writes are additive. The -T flag drops the
# pseudo-tty so structured log output reaches the promoter's stdout cleanly.
emit_step seed
if [[ $_dry_run -eq 0 ]]; then
  docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$PROMOTE_SOURCE" -p "$_project" \
    "${_f_args[@]}" run --rm -T --no-deps --entrypoint /docker-entrypoint.sh portal
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
fi

# --- Step 7b: sandbox-refresh ---
# Rebuild + recreate the dpf-sandbox image the same way step 3/4 do the portal
# (BI-A8686CFC). The promote chain historically rebuilt ONLY the portal, so
# every improvement to Dockerfile.sandbox — the opencode coding agent that the
# Build Studio build phase shells into, the macOS TTS env wiring, provisioned
# build engines — never reached an installed sandbox via self-upgrade. Its
# image would sit at whatever was built at install time (a month stale on the
# install that surfaced this), so BS builds died at the coding phase (exit 127,
# `opencode` not found) and env-only compose fixes never took effect until a
# manual `--force-recreate`. Kernel decision: mirror the portal contract
# exactly — unconditional build every upgrade, letting the BuildKit layer cache
# make an unchanged Dockerfile.sandbox near-instant, rather than a git-diff gate
# whose missed input would silently reintroduce the very staleness this fixes.
#
# Sequenced AFTER the portal is fully verified and deliberately fail-LOUD but
# NOT fail-ABORT: the portal swap already happened at step 4 and the
# orchestrator process died with it, so a non-zero exit here reverts nothing —
# it would only mislabel a genuinely-promoted portal as a failed upgrade. A
# stale sandbox is a recoverable degraded state (recover_sandbox tool, the
# health-alert surface) so we emit an explicit sandbox-refresh-failed marker and
# continue to cleanup + done rather than aborting. This is the opposite of the
# original silent bug: the rebuild always runs, and its failure is never hidden.
emit_step sandbox-refresh
if [[ $_dry_run -eq 0 ]]; then
  _sandbox_ok=1
  # BET-5 (BI-A1E864A5): the sandbox runs the same schema, so its Postgres also needs pgvector
  # for `CREATE EXTENSION vector`. Recreate sandbox-postgres onto the pgvector image first — same
  # image-agnostic idempotency check (pg_available_extensions) and host-bind-safe recreate as
  # step 3a. Fail-LOUD-not-ABORT like the rest of 7b: a sandbox-postgres it cannot upgrade degrades
  # Build Studio, it never reverts the already-promoted portal.
  _sbx_pg="${_project}-sandbox-postgres-1"
  if docker inspect "$_sbx_pg" >/dev/null 2>&1; then
    if _pg_provides_vector "$_sbx_pg"; then _sbx_has_vector=yes; else _sbx_has_vector=no; fi
    if [[ "$_sbx_has_vector" != "yes" ]]; then
      _recreate_pg_onto_pgvector sandbox-postgres sandbox_pgdata || _sandbox_ok=0
    fi
  fi
  if [[ $_sandbox_ok -eq 1 ]]; then
    docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$PROMOTE_SOURCE" -p "$_project" \
      "${_f_args[@]}" build sandbox || _sandbox_ok=0
  fi
  if [[ $_sandbox_ok -eq 1 ]]; then
    docker compose ${_env_args[@]+"${_env_args[@]}"} --project-directory "$PROMOTE_SOURCE" -p "$_project" \
      "${_f_args[@]}" up -d --no-deps --force-recreate sandbox || _sandbox_ok=0
  fi
  if [[ $_sandbox_ok -eq 0 ]]; then
    printf 'step=sandbox-refresh-failed target=%s\n' "$_built_sha"
    printf 'warning: dpf-sandbox rebuild/recreate failed after a successful portal promotion — the portal upgrade stands, but the sandbox may be stale (Build Studio builds can fail at the coding phase until it is refreshed via recover_sandbox or a manual `docker compose build sandbox && docker compose up -d --force-recreate sandbox`) (BI-A8686CFC)\n' >&2
  fi
fi

# --- Step 7c: legacy-datastore decommission ---
# BET-5 (BI-922EBB99 / BI-2A3BE4D7): the portal now runs on Postgres only (pgvector for
# vectors, a graph mirror for the graph). The one-time boot backfill that staged legacy data
# into Postgres was retired once the fleet finished migrating; the platform is Postgres-only
# and new installs never provision Neo4j/Qdrant. This teardown remains DATA-SAFETY GATED (it
# refuses to delete a store until its data is confirmed in the mirror) and IDEMPOTENT — now a
# no-op on every current install (containers already gone, or never present), kept as a safety
# net that removes any lingering legacy container/volume it finds.
#
# Fail-LOUD but NOT fail-ABORT, exactly like sandbox-refresh: the portal swap already
# succeeded, so a hiccup here (or data not yet mirrored) must never mislabel a good upgrade. A
# store left standing is a recoverable degraded state — the next upgrade retries, or the
# operator runs scripts/decommission-neo4j-qdrant.{sh,ps1} directly.
emit_step decommission-legacy-stores
if [[ $_dry_run -eq 0 ]]; then
  if [[ -f "$PROMOTE_SOURCE/scripts/decommission-neo4j-qdrant.sh" ]]; then
    DPF_POSTGRES_CONTAINER="${DPF_PRODUCTION_DB_CONTAINER:-${_project}-postgres-1}" \
    DPF_NEO4J_CONTAINER="${_project}-neo4j-1" \
    DPF_NEO4J_VOLUME="${_project}_neo4jdata" \
    DPF_QDRANT_CONTAINER="${_project}-qdrant-1" \
    DPF_QDRANT_VOLUME="${_project}_qdrant_data" \
      sh "$PROMOTE_SOURCE/scripts/decommission-neo4j-qdrant.sh" || {
        printf 'step=decommission-legacy-stores-deferred target=%s\n' "$_built_sha"
        printf 'warning: Neo4j/Qdrant decommission did not complete (data not yet mirrored or a docker hiccup) — the portal upgrade stands; it retries on the next upgrade or via scripts/decommission-neo4j-qdrant.sh (BI-922EBB99)\n' >&2
      }
  fi
fi

# --- Step 8: cleanup ---
# A successful swap leaves the PREVIOUS portal image untagged (dangling) plus BuildKit
# cache layers from step 3's rebuild. Nothing else sweeps them, so across upgrades they
# pile into tens of GB of dead disk on Docker's fixed VM disk — and once it fills, the
# NEXT `docker compose build` (step 3) fails with "no space left on device", i.e. the
# accumulation eventually breaks the very upgrade that produced it. Reclaim it now, but
# ONLY after every verify above has passed (so a still-needed rollback image is never
# pruned) and BEST-EFFORT (a cleanup hiccup must never fail an upgrade that succeeded).
#
# The two piles are treated differently on purpose:
#   * Dangling images — the superseded previous portal version, zero value once the tag
#     moved to the new build. Removed outright (never `docker image prune -a`, which
#     would delete tagged images the compose stack still needs).
#   * Build cache — a PERFORMANCE asset: those layers make the next rebuild fast, so we
#     BOUND it (keep ~10GB; Docker evicts the oldest beyond that) rather than wiping it.
#     Capping reclaims runaway disk without making every future upgrade rebuild cold.
# Volumes are NEVER touched here — operator DB/state lives in volumes.
emit_step cleanup
if [[ $_dry_run -eq 0 ]]; then
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f --keep-storage "${PROMOTE_BUILD_CACHE_KEEP:-10GB}" >/dev/null 2>&1 || true
  # BI-9B7FC928: `image prune` above only removes DANGLING images. The TAGGED
  # throwaway images left by Build Studio's content-verify / main-compare /
  # local-integration flows (dpf-*-build-test:*, dpf-*-build-compare:*,
  # dpf-*:verify) survive it and leaked ~3.7 GB per successful upgrade until the
  # disk filled. Reclaim them by exact ephemeral naming: the running
  # dpf-portal / dpf-promoter images NEVER carry a -build-test / -build-compare
  # suffix or a :verify tag, so removing these cannot touch the already-deployed
  # portal (and this runs only after every verify passed). Best-effort — never
  # fails the upgrade. Volumes are still never touched.
  for _ref in 'dpf-*-build-test' 'dpf-*-build-compare' 'dpf-*:verify'; do
    _imgs="$(docker images --filter "reference=${_ref}" -q 2>/dev/null | sort -u)"
    [[ -n "${_imgs}" ]] && docker rmi -f ${_imgs} >/dev/null 2>&1 || true
  done
fi

# Terminal success marker — emitted only after every verify AND the cleanup sweep, so
# `step=done` continues to mean "fully promoted" for the orchestrator.
if [[ $_dry_run -eq 0 ]]; then
  printf 'step=done target=%s\n' "$_built_sha"
fi
