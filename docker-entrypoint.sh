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
  mkdir -p "$WORKSPACE/apps/web" "$WORKSPACE/packages"
  cp -r /app/apps/web-src/. "$WORKSPACE/apps/web/"
  cp -r /app/packages-src/. "$WORKSPACE/packages/"
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

echo "=== Init complete ==="
