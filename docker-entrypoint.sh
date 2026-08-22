#!/bin/sh
set -e

echo "=== DPF Portal Init ==="

echo "[1/5] Running database migrations..."
cd /app
# Retry migrations — on first-ever init, pg_isready passes before the dpf user
# is fully created, causing P1000 auth failures for 1-2 seconds.
migrate_attempts=0
while [ $migrate_attempts -lt 5 ]; do
  if pnpm --filter @dpf/db exec prisma migrate deploy 2>&1; then
    break
  fi
  migrate_attempts=$((migrate_attempts + 1))
  if [ $migrate_attempts -lt 5 ]; then
    echo "  Retrying migrations in 3s (attempt $((migrate_attempts + 1))/5)..."
    sleep 3
  else
    echo "  FATAL: Migrations failed after 5 attempts"
    exit 1
  fi
done
echo "  OK Migrations complete"

echo "[2/5] Syncing provider registry..."
cd /app
pnpm --filter @dpf/db exec tsx scripts/sync-provider-registry.ts || echo "  ⚠️  PROVIDER SYNC FAILED — provider catalog (new providers, auth methods, cliEngine) was NOT reconciled into the DB on this start. The portal will run, but provider/Build-Studio catalog updates from this release may be missing. See the error above."
echo "  OK Provider registry synced"

echo "[2b/5] Syncing build-engine registry..."
pnpm --filter @dpf/db exec tsx scripts/sync-engine-registry.ts || echo "  ⚠️  ENGINE SYNC FAILED — the build-engine catalog (claude/codex/grok) was NOT reconciled into the DB on this start. Build Studio dispatch still works, but engine readiness/provisioning may not reflect this release. See the error above."
echo "  OK Build-engine registry synced"

echo "[3/5] Seeding reference data..."
cd /app
pnpm --filter @dpf/db exec tsx src/seed.ts || echo "  ⚠️  SEED INCOMPLETE — one or more reconcile steps failed (see the 'SEED INCOMPLETE' summary above). The portal will start; catalog/reference updates from this release may be partial."
echo "  OK Seed complete"

echo "[3b/5] Reconciling model capability catalog..."
cd /app
pnpm --filter @dpf/db exec tsx scripts/reconcile-catalog-capabilities.ts || echo "  WARN Catalog reconciliation had warnings (non-fatal)"
echo "  OK Catalog reconciliation complete"

# Detect credentials that can no longer be decrypted (e.g. .env regenerated
# after DB volumes persisted) and flag them so the admin UI can prompt for
# re-authentication.  See PROVIDER-ACTIVATION-AUDIT.md F-15, F-16.
echo "[3c/5] Checking credential health..."
cd /app
pnpm --filter @dpf/db exec tsx scripts/credential-health-check.ts || echo "  WARN Credential health check had warnings (non-fatal)"
echo "  OK Credential health check complete"

echo "[4/5] Detecting hardware..."
if [ -n "$DPF_HOST_PROFILE" ]; then
  cd /app
  pnpm --filter @dpf/db exec tsx scripts/detect-hardware.ts || echo "  WARN Hardware detection had warnings (non-fatal)"
  echo "  OK Hardware profile saved"
else
  echo "  -- No host profile provided, skipping"
fi

echo "[5/5] Bootstrapping source volume..."
WORKSPACE=/workspace
IMAGE_VERSION=$(cat /app/.dpf-image-version 2>/dev/null | tr -cd '[:alnum:]._-')
IMAGE_VERSION=${IMAGE_VERSION:-dev}
USER_MANAGED_WORKSPACE=false
MANAGED_WORKSPACE=false

if [ -f "$WORKSPACE/.dpf-version" ]; then
  MANAGED_WORKSPACE=true
fi

if [ "$MANAGED_WORKSPACE" != "true" ] && [ -d "$WORKSPACE/.git" ] && [ -f "$WORKSPACE/package.json" ]; then
  USER_MANAGED_WORKSPACE=true
fi

sync_image_source_to_workspace() {
  echo "  Syncing source volume from image version $IMAGE_VERSION..."
  mkdir -p "$WORKSPACE/apps" "$WORKSPACE/docs" "$WORKSPACE/packages" "$WORKSPACE/scripts"
  rm -rf "$WORKSPACE/apps/web" "$WORKSPACE/docs/professions" "$WORKSPACE/packages" "$WORKSPACE/scripts"
  mkdir -p "$WORKSPACE/apps/web" "$WORKSPACE/docs/professions" "$WORKSPACE/packages" "$WORKSPACE/scripts"
  cp -r /app/apps/web-src/. "$WORKSPACE/apps/web/"
  cp -r /app/docs/professions/. "$WORKSPACE/docs/professions/"
  cp -r /app/packages-src/. "$WORKSPACE/packages/"
  rm -rf "$WORKSPACE/apps/web/.next" \
         "$WORKSPACE/apps/web/tsconfig.tsbuildinfo" \
         "$WORKSPACE/packages/db/generated"
  cp -r /app/scripts/. "$WORKSPACE/scripts/"
  # pnpm-workspace.yaml `patchedDependencies` resolves patch paths against the
  # workspace root, so the patches must land alongside it — otherwise
  # install_workspace_dependencies below exits non-zero on a missing patch file
  # (SUR-8AB3353C). Replace rather than merge so a removed patch does not linger.
  rm -rf "$WORKSPACE/patches"
  cp -r /app/patches "$WORKSPACE/" 2>/dev/null || true
  cp /app/pnpm-workspace.yaml "$WORKSPACE/" 2>/dev/null || true
  cp /app/pnpm-lock.yaml "$WORKSPACE/" 2>/dev/null || true
  cp /app/package.json "$WORKSPACE/" 2>/dev/null || true
  cp /app/tsconfig.base.json "$WORKSPACE/" 2>/dev/null || true
  cp /app/.gitignore "$WORKSPACE/" 2>/dev/null || true
}

install_workspace_dependencies() {
  echo "  Installing dependencies (this takes 1-2 minutes on first run)..."
  cd "$WORKSPACE"
  pnpm install --frozen-lockfile --config.confirmModulesPurge=false --ignore-scripts 2>&1 || pnpm install --config.confirmModulesPurge=false --ignore-scripts 2>&1
  echo "  Dependencies installed"
  pnpm --filter @dpf/db exec prisma generate --schema prisma/schema 2>&1 || echo "  WARN prisma generate failed (non-fatal)"
}

is_workspace_housekeeping_status() {
  case "$1" in
    "?? .dpf-version" | \
    "D  .pnpm-store/"* | \
    "D  node_modules/"* | \
    "D  \"node_modules/"* | \
    "D  .next/"* | \
    "D  apps/web/.next/"* | \
    "D  apps/web/tsconfig.tsbuildinfo" | \
    "A  .gitignore")
      return 0
      ;;
  esac
  return 1
}

status_line_path() {
  path=${1#???}
  case "$path" in
    \"*\")
      path=${path#\"}
      path=${path%\"}
      ;;
  esac
  printf '%s\n' "$path"
}

image_source_path_for_workspace_path() {
  case "$1" in
    apps/web/*)
      printf '/app/apps/web-src/%s\n' "${1#apps/web/}"
      ;;
    packages/*)
      printf '/app/packages-src/%s\n' "${1#packages/}"
      ;;
    scripts/*)
      printf '/app/scripts/%s\n' "${1#scripts/}"
      ;;
    docs/professions/*)
      printf '/app/docs/professions/%s\n' "${1#docs/professions/}"
      ;;
    pnpm-workspace.yaml | pnpm-lock.yaml | package.json | tsconfig.base.json | .gitignore)
      printf '/app/%s\n' "$1"
      ;;
    *)
      return 1
      ;;
  esac
}

workspace_path_matches_image_source() {
  workspace_path=$1
  image_path=$(image_source_path_for_workspace_path "$workspace_path" 2>/dev/null || true)
  [ -n "$image_path" ] || return 1

  if [ -f "$WORKSPACE/$workspace_path" ] && [ -f "$image_path" ]; then
    cmp -s "$WORKSPACE/$workspace_path" "$image_path"
    return $?
  fi

  if [ ! -e "$WORKSPACE/$workspace_path" ] && [ ! -e "$image_path" ]; then
    return 0
  fi

  return 1
}

ensure_workspace_safe_directory() {
  if [ -d "$WORKSPACE/.git" ]; then
    git config --global --get-all safe.directory 2>/dev/null | grep -qxF "$WORKSPACE" \
      || git config --global --add safe.directory "$WORKSPACE" >/dev/null 2>&1 \
      || true
  fi
}

workspace_has_user_changes() {
  ensure_workspace_safe_directory
  cd "$WORKSPACE"
  ensure_workspace_git_excludes
  # Older source-volume bootstraps accidentally tracked dependency stores.
  # Removing them from the managed git index is housekeeping, not user work.
  git rm -r --cached --ignore-unmatch -q .pnpm-store node_modules .next apps/web/.next apps/web/tsconfig.tsbuildinfo 2>/dev/null || true

  status_file=$(mktemp)
  git status --porcelain > "$status_file"
  has_user_changes=false
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    if is_workspace_housekeeping_status "$line"; then
      continue
    fi
    path=$(status_line_path "$line")
    if workspace_path_matches_image_source "$path"; then
      continue
    fi
    has_user_changes=true
    break
  done < "$status_file"
  rm -f "$status_file"

  [ "$has_user_changes" = "true" ]
}

ensure_workspace_git_excludes() {
  cd "$WORKSPACE"
  mkdir -p .git/info
  touch .git/info/exclude
  for entry in ".dpf-version" ".pnpm-store/" "node_modules/" ".next/" "apps/web/.next/" "*.tsbuildinfo"; do
    grep -qxF "$entry" .git/info/exclude || echo "$entry" >> .git/info/exclude
  done
}

commit_workspace_snapshot() {
  ensure_workspace_safe_directory
  cd "$WORKSPACE"
  git config user.email "build-studio@dpf.local"
  git config user.name "DPF Build Studio"
  ensure_workspace_git_excludes
  git rm -r --cached --ignore-unmatch -q .pnpm-store node_modules .next apps/web/.next apps/web/tsconfig.tsbuildinfo 2>/dev/null || true
  git add -A .
  git reset -- .dpf-version 2>/dev/null || true
  if git diff --cached --quiet; then
    echo "  -- Source volume already matches image content"
  else
    git commit -m "chore: sync from dpf-image v${IMAGE_VERSION}"
  fi
}

if [ "$USER_MANAGED_WORKSPACE" = "true" ]; then
  echo "  -- Existing user-managed workspace detected at /workspace, skipping bootstrap"
elif [ -d "$WORKSPACE" ] && [ ! -f "$WORKSPACE/.dpf-version" ]; then
  # First-install ONLY: populate an empty /workspace volume so surfaces that
  # mount it (the contributor :3001 preview, sandbox tooling) have a source tree.
  # This is a one-time bootstrap of an EMPTY volume — it neither advances an
  # already-running install nor writes the `updatePending` sentinel, so it does
  # not participate in the retired Engine B source-advance (see the
  # `.dpf-version`-present branch below; BI-5B6C1C35). Left intact to keep
  # first-install working.
  echo "  Bootstrapping source volume from image version $IMAGE_VERSION..."

  sync_image_source_to_workspace
  install_workspace_dependencies

  # Initialise git — force-create branches to be idempotent on partial failure
  git init -b dpf-upstream
  ensure_workspace_safe_directory
  git config user.email "build-studio@dpf.local"
  git config user.name "DPF Build Studio"
  ensure_workspace_git_excludes
  git add -A .
  git reset -- .dpf-version 2>/dev/null || true
  git commit -m "chore: bootstrap from dpf-image v${IMAGE_VERSION}"
  # -B force-creates or resets the branch — safe on re-run after partial failure
  git checkout -B my-changes

  # Write version sentinel last — if anything above failed, this file is absent
  # and the entire block re-runs on next start (idempotent due to -B and git init)
  echo "$IMAGE_VERSION" > "$WORKSPACE/.dpf-version"
  echo "  OK Source volume bootstrapped (with dependencies)"
elif [ -f "$WORKSPACE/.dpf-version" ]; then
  # ── Engine B (the /workspace image-sync source-advance engine) — RETIRED ──
  #
  # DEPRECATION (BI-5B6C1C35; unified-delivery-surfaces spec §2 GAP 1 +
  # governed-platform-upgrade spec §5.0). DPF had TWO competing source-advance
  # engines. The canonical one (Engine A, §5.0) is the host-clone `dpf/install`
  # merge promoter (apps/web/lib/self-upgrade/*, scripts/promote.sh): it merges
  # upstream into a durable install branch, stamps the image with the bytes'
  # real HEAD, and is the ONLY sanctioned path to advance the running install.
  #
  # The block that USED to live here was Engine B: on an image-version vs.
  # `/workspace/.dpf-version` mismatch it (a) silently re-synced the running
  # container's source from the image (`sync_image_source_to_workspace`) and
  # (b) wrote `PlatformDevConfig.updatePending` via raw `psql`, arming the
  # `applyPlatformUpdate` `/workspace` `my-changes` merge. Two engines racing on
  # one install is the root cause of the stale-mislabeled-portal bug: the image
  # stamp, the `/workspace` bytes, and `origin/main` diverge with nothing
  # reconciling them.
  #
  # Per §5.0 ("the live install advances only via the self-upgrade pipeline")
  # this engine is neutralized: the entrypoint no longer mutates the running
  # source from the image, and no longer writes the `updatePending` sentinel.
  # The `.dpf-version` sentinel is still tracked for the user-managed contributor
  # preview, but it never drives a source-advance or an update prompt here.
  # Upgrades flow exclusively through Engine A (Ops → Self-Upgrade).
  #
  # TODO(BI-5B6C1C35): once Engine A's host-clone promoter is confirmed as the
  # sole advance path in production telemetry, remove the now-dead Engine B
  # helpers (sync_image_source_to_workspace, commit_workspace_snapshot,
  # workspace_has_user_changes, image_source_path_for_workspace_path,
  # workspace_path_matches_image_source) and the `applyPlatformUpdate`
  # /workspace merge in apps/web/lib/actions/platform-dev-config.ts.
  VOLUME_VERSION=$(cat "$WORKSPACE/.dpf-version" 2>/dev/null || echo "unknown")
  if [ "$IMAGE_VERSION" != "$VOLUME_VERSION" ]; then
    echo "  -- Image/source-volume version differ ($VOLUME_VERSION -> $IMAGE_VERSION);"
    echo "     Engine B source-advance is RETIRED (BI-5B6C1C35). The running"
    echo "     install advances only via the Self-Upgrade pipeline (Engine A,"
    echo "     governed-upgrade spec §5.0). Not mutating /workspace; not setting"
    echo "     an update-pending flag."
  else
    echo "  -- Source volume present ($VOLUME_VERSION); Engine B retired, no action"
  fi
else
  echo "  -- /workspace not mounted, skipping"
fi

# Configure provider capabilities.
# The only seed we keep is auto-activating codex when its credential exists —
# that reflects reality (credentials present = usable) and is cheap to reassert.
#
# REMOVED (were clobbering admin config on every restart):
#   * Hard pin of build-specialist to codex/gpt-5.4.
#     Obsolete since provider-tier preference (#107): routing now prefers
#     user_configured providers over bundled locals automatically, and the
#     fallback chain diversifies across providers. The pin turned every codex
#     hiccup (disabled, rate-limit, auth) into a full collapse to local
#     Gemma4 instead of a clean fallback.
#   * Post-init anthropic-sub capability rewrites.
#     Tool capability for anthropic-sub is now a seed/catalog contract
#     enforced in providers-registry.json, model-profiles.json,
#     KNOWN_PROVIDER_MODELS, and packages/db/src/seed.ts. Do not override
#     it here or we reintroduce drift between startup scripts and the catalog.
#
# If either seed needs to come back, add it to the Prisma seed (packages/db
# src/seed.ts) as initial state only, NOT as a post-init UPDATE that
# overrides what the admin set in the UI.
echo "[post-init] Configuring provider capabilities..."
psql "$DATABASE_URL" -c "
  -- codex: activate ONLY if a credential has been stored for it
  UPDATE \"ModelProvider\" SET status = 'active', \"supportsToolUse\" = true
    WHERE \"providerId\" = 'codex'
    AND EXISTS (SELECT 1 FROM \"CredentialEntry\" WHERE \"providerId\" = 'codex' AND status = 'active');
  -- codex without credentials: mark the tool-use bit so it's ready the
  -- moment an admin configures a credential. Does not change status.
  UPDATE \"ModelProvider\" SET \"supportsToolUse\" = true
    WHERE \"providerId\" = 'codex'
    AND NOT EXISTS (SELECT 1 FROM \"CredentialEntry\" WHERE \"providerId\" = 'codex' AND status = 'active');
" 2>/dev/null || echo "  WARN post-init SQL had warnings (non-fatal)"
echo "  OK Provider config set"

# ─── Provider-aware embedding model setup ────────────────────────────────
# Per the deployment doctrine (Contract 9: LLM and agent-provider routing),
# the entrypoint must NOT call provider-specific endpoints for the wrong
# provider. Three modes:
#   model-runner — Docker Desktop's built-in runner; pull via
#                   POST /models/create (Docker-Model-Runner-only endpoint)
#   ollama       — in-cluster Ollama; pull via POST /api/pull (Ollama-only)
#   external     — customer-managed endpoint; verify only, never pull
#
# DPF_LLM_PROVIDER selects the mode explicitly. If unset, we infer from
# LLM_BASE_URL: defaults to model-runner for backwards compatibility with
# the existing default URL; the Linux compose overlay sets
# LLM_BASE_URL=http://ollama:11434/v1 which auto-infers ollama.
#
# DPF_MODEL_PULL_MODE controls behavior:
#   auto        — verify the model exists; pull if missing (default)
#   verify-only — verify only; never pull
#   skip        — do nothing
echo "[post-init] Checking embedding model..."

EMB_BASE_URL="${LLM_BASE_URL:-http://model-runner.docker.internal/v1}"
PULL_MODE="${DPF_MODEL_PULL_MODE:-auto}"

# Auto-detect provider from LLM_BASE_URL when DPF_LLM_PROVIDER is unset.
PROVIDER="${DPF_LLM_PROVIDER:-}"
if [ -z "$PROVIDER" ]; then
  case "$EMB_BASE_URL" in
    *model-runner*)  PROVIDER="model-runner" ;;
    *:11434*)        PROVIDER="ollama" ;;
    *)               PROVIDER="external" ;;
  esac
fi

# Provider-aware default for the embedding model. Operators override
# EMBEDDING_MODEL explicitly when they want a different model.
EMB_MODEL="${EMBEDDING_MODEL:-}"
if [ -z "$EMB_MODEL" ]; then
  case "$PROVIDER" in
    model-runner)  EMB_MODEL="ai/nomic-embed-text-v1.5" ;;
    ollama)        EMB_MODEL="nomic-embed-text" ;;
    *)             EMB_MODEL="ai/nomic-embed-text-v1.5" ;;
  esac
fi

echo "  Provider: $PROVIDER  Pull mode: $PULL_MODE  Base URL: $EMB_BASE_URL"
echo "  Embedding model: $EMB_MODEL"

# Re-list the provider's models and confirm the embedding model is actually
# present. Returns 0 when present, non-zero otherwise. Used AFTER a pull so
# success is reported on the model EXISTING — not on the pull request's exit
# code, which returns 0 even when the download later fails or times out. That
# false-success is how an install booted "healthy" with no embedding model and
# the governance kernel silently ran on commandments only (BI-A95A4CB7 /
# BI-512FBD20). POSIX sh: no `local`; a failed wget emits nothing so grep
# returns non-zero, which is the correct "not present" answer.
verify_embedding_present() {
  # $1 = models listing URL, $2 = grep pattern
  wget -qO- --timeout=10 "$1" 2>/dev/null | grep -q "$2"
}

# Skip path: do nothing, log explicitly.
if [ "$PULL_MODE" = "skip" ]; then
  echo "  SKIP DPF_MODEL_PULL_MODE=skip; not verifying or pulling embedding model"
elif [ "$PULL_MODE" = "verify-only" ] || [ "$PROVIDER" = "external" ]; then
  # Verify path: GET /v1/models, log presence/absence, never pull.
  emb_listing=$(wget -qO- --timeout=5 "${EMB_BASE_URL}/models" 2>/dev/null || true)
  if [ -z "$emb_listing" ]; then
    echo "  WARN Could not reach ${EMB_BASE_URL}/models — platform will retry on first inference."
  elif echo "$emb_listing" | grep -q "nomic-embed"; then
    echo "  OK Embedding model verified at $EMB_BASE_URL"
  else
    echo "  WARN '$EMB_MODEL' not listed at $EMB_BASE_URL — operator must pull it manually."
  fi
else
  # auto + known provider: branch on provider type to use the right pull endpoint.
  case "$PROVIDER" in
    model-runner)
      # Docker Model Runner: POST /models/create with {"model":"..."}
      emb_listing=$(wget -qO- --timeout=5 "${EMB_BASE_URL}/models" 2>/dev/null || true)
      if echo "$emb_listing" | grep -q "nomic-embed-text"; then
        echo "  OK Embedding model already available (Docker Model Runner)"
      else
        echo "  Pulling ${EMB_MODEL} via Docker Model Runner (first run only)..."
        wget -qO- --timeout=120 --post-data "{\"model\":\"${EMB_MODEL}\"}" \
          --header="Content-Type: application/json" \
          "${EMB_BASE_URL%/v1}/models/create" 2>/dev/null || true
        # Verify the model is actually present now — the create request returns
        # 0 even when the pull later fails, so re-list before claiming success.
        if verify_embedding_present "${EMB_BASE_URL}/models" "nomic-embed-text"; then
          echo "  OK Embedding model pulled and verified present (Docker Model Runner)"
        else
          echo "  ERROR '${EMB_MODEL}' is STILL NOT present after the pull attempt."
          echo "        Semantic retrieval (wiki_query, principle_decide core/contextual) will be"
          echo "        DEGRADED until it is available; the platform surfaces this at query time"
          echo "        (BI-512FBD20). Fix: docker model pull ${EMB_MODEL}"
        fi
      fi
      ;;
    ollama)
      # Ollama: POST /api/pull with {"name":"..."}. Ollama exposes /api
      # at the same host (not /v1), so strip the /v1 suffix.
      OLLAMA_HOST="${EMB_BASE_URL%/v1}"
      emb_listing=$(wget -qO- --timeout=5 "${OLLAMA_HOST}/api/tags" 2>/dev/null || true)
      if echo "$emb_listing" | grep -q "$EMB_MODEL"; then
        echo "  OK Embedding model '$EMB_MODEL' already available (Ollama)"
      else
        echo "  Pulling '${EMB_MODEL}' via Ollama (first run; can take several minutes)..."
        wget -qO- --timeout=300 --post-data "{\"name\":\"${EMB_MODEL}\"}" \
          --header="Content-Type: application/json" \
          "${OLLAMA_HOST}/api/pull" 2>/dev/null || true
        # Verify presence via /api/tags — the pull stream can return 0 while the
        # model never finished landing, so confirm before claiming success.
        if verify_embedding_present "${OLLAMA_HOST}/api/tags" "$EMB_MODEL"; then
          echo "  OK Embedding model '${EMB_MODEL}' pulled and verified present (Ollama)"
        else
          echo "  ERROR '${EMB_MODEL}' is STILL NOT present after the pull attempt."
          echo "        Semantic retrieval (wiki_query, principle_decide core/contextual) will be"
          echo "        DEGRADED until it is available; the platform surfaces this at query time"
          echo "        (BI-512FBD20). Fix: ollama pull ${EMB_MODEL}"
        fi
      fi
      ;;
    *)
      echo "  WARN Unknown DPF_LLM_PROVIDER='$PROVIDER'; skipping embedding model setup"
      ;;
  esac
fi

echo "=== Init complete ==="
