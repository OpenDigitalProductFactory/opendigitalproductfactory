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
pnpm --filter @dpf/db exec tsx scripts/sync-provider-registry.ts || echo "  WARN Provider sync had warnings (non-fatal)"
echo "  OK Provider registry synced"

echo "[3/5] Seeding reference data..."
cd /app
pnpm --filter @dpf/db exec tsx src/seed.ts || echo "  WARN Seed had warnings (non-fatal)"
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

if [ -d "$WORKSPACE/.git" ] && [ -f "$WORKSPACE/package.json" ]; then
  USER_MANAGED_WORKSPACE=true
fi

if [ "$USER_MANAGED_WORKSPACE" = "true" ]; then
  echo "  -- Existing user-managed workspace detected at /workspace, skipping bootstrap"
elif [ -d "$WORKSPACE" ] && [ ! -f "$WORKSPACE/.dpf-version" ]; then
  echo "  Bootstrapping source volume from image version $IMAGE_VERSION..."

  # Copy source from image to volume
  mkdir -p "$WORKSPACE/apps/web" "$WORKSPACE/packages" "$WORKSPACE/scripts"
  cp -r /app/apps/web-src/. "$WORKSPACE/apps/web/"
  cp -r /app/packages-src/. "$WORKSPACE/packages/"
  cp -r /app/scripts/. "$WORKSPACE/scripts/"
  cp /app/pnpm-workspace.yaml "$WORKSPACE/" 2>/dev/null || true
  cp /app/pnpm-lock.yaml "$WORKSPACE/" 2>/dev/null || true
  cp /app/package.json "$WORKSPACE/" 2>/dev/null || true
  cp /app/tsconfig.base.json "$WORKSPACE/" 2>/dev/null || true

  # Install dependencies so the sandbox is ready immediately
  echo "  Installing dependencies (this takes 1-2 minutes on first run)..."
  cd "$WORKSPACE"
  pnpm install --frozen-lockfile 2>&1 || pnpm install 2>&1
  echo "  Dependencies installed"

  # Generate Prisma client
  pnpm --filter @dpf/db exec prisma generate 2>&1 || echo "  WARN prisma generate failed (non-fatal)"

  # Initialise git — force-create branches to be idempotent on partial failure
  git init -b dpf-upstream
  git config user.email "build-studio@dpf.local"
  git config user.name "DPF Build Studio"
  git add -A
  git commit -m "chore: bootstrap from dpf-image v${IMAGE_VERSION}"
  # -B force-creates or resets the branch — safe on re-run after partial failure
  git checkout -B my-changes

  # Write version sentinel last — if anything above failed, this file is absent
  # and the entire block re-runs on next start (idempotent due to -B and git init)
  echo "$IMAGE_VERSION" > "$WORKSPACE/.dpf-version"
  echo "  OK Source volume bootstrapped (with dependencies)"
elif [ -f "$WORKSPACE/.dpf-version" ]; then
  VOLUME_VERSION=$(cat "$WORKSPACE/.dpf-version" 2>/dev/null || echo "unknown")
  if [ "$IMAGE_VERSION" != "$VOLUME_VERSION" ]; then
    echo "  Platform update detected: $VOLUME_VERSION -> $IMAGE_VERSION"
    # Use psql to upsert — available via postgresql16-client in the image
    psql "$DATABASE_URL" -c "
      INSERT INTO \"PlatformDevConfig\" (id, \"updatePending\", \"pendingVersion\", \"configuredAt\")
      VALUES ('singleton', true, '$IMAGE_VERSION', NOW())
      ON CONFLICT (id) DO UPDATE SET \"updatePending\" = true, \"pendingVersion\" = '$IMAGE_VERSION';
    " || echo "  WARN Update detection had warnings (non-fatal)"
    echo "  OK Update pending flag set"
  else
    echo "  -- Source volume already bootstrapped ($VOLUME_VERSION)"
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
#     Gemma4 instead of a clean fallback to anthropic-sub.
#   * Forcing anthropic-sub.supportsToolUse = false.
#     Obsolete since #112 and #118: the codex-cli and claude-cli adapters
#     now both rescue tool_use blocks out of assistant text. Claude CLI can
#     execute MCP tools — the override was wrong once those shipped.
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

# ─── Pull embedding model into Docker Model Runner if available ──────────
echo "[post-init] Checking embedding model..."
# Docker Model Runner exposes an OpenAI-compatible API on the host.
# The portal talks to it via LLM_BASE_URL. Try to pull the embedding model
# so preflight check 10 passes on fresh install. This is best-effort —
# Model Runner may not be available (e.g. CI or non-Docker hosts).
EMB_BASE_URL="${LLM_BASE_URL:-http://model-runner.docker.internal/v1}"
EMB_MODEL="ai/nomic-embed-text-v1.5"
emb_already=$(wget -qO- --timeout=5 "${EMB_BASE_URL}/models" 2>/dev/null || true)
if echo "$emb_already" | grep -q "nomic-embed-text"; then
  echo "  OK Embedding model already available"
else
  echo "  Pulling ${EMB_MODEL} via Model Runner (first run only)..."
  # Model Runner accepts POST /models/create with {"model":"..."} to pull
  wget -qO- --timeout=120 --post-data "{\"model\":\"${EMB_MODEL}\"}" \
    --header="Content-Type: application/json" \
    "${EMB_BASE_URL%/v1}/models/create" 2>/dev/null \
    && echo "  OK Embedding model pulled" \
    || echo "  WARN Could not auto-pull embedding model. Run: docker model pull ${EMB_MODEL}"
fi

echo "=== Init complete ==="
