#!/bin/sh
set -e

echo "=== DPF Portal Init ==="

echo "[1/5] Running database migrations..."
cd /app
pnpm --filter @dpf/db exec prisma migrate deploy
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

if [ -d "$WORKSPACE" ] && [ ! -f "$WORKSPACE/.dpf-version" ]; then
  echo "  Bootstrapping source volume from image version $IMAGE_VERSION..."

  # Copy source from image to volume
  mkdir -p "$WORKSPACE/apps/web" "$WORKSPACE/packages"
  cp -r /app/apps/web-src/. "$WORKSPACE/apps/web/"
  cp -r /app/packages-src/. "$WORKSPACE/packages/"
  cp /app/pnpm-workspace.yaml "$WORKSPACE/" 2>/dev/null || true
  cp /app/package.json "$WORKSPACE/" 2>/dev/null || true

  # Initialise git — force-create branches to be idempotent on partial failure
  cd "$WORKSPACE"
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
  echo "  OK Source volume bootstrapped"
elif [ -f "$WORKSPACE/.dpf-version" ]; then
  VOLUME_VERSION=$(cat "$WORKSPACE/.dpf-version" 2>/dev/null || echo "unknown")
  if [ "$IMAGE_VERSION" != "$VOLUME_VERSION" ]; then
    echo "  Platform update detected: $VOLUME_VERSION -> $IMAGE_VERSION"
    cd /app
    pnpm --filter @dpf/db exec tsx -e "
      const { PrismaClient } = require('./generated/client');
      const p = new PrismaClient();
      p.platformDevConfig.upsert({
        where: { id: 'singleton' },
        update: { updatePending: true, pendingVersion: '$IMAGE_VERSION' },
        create: { id: 'singleton', updatePending: true, pendingVersion: '$IMAGE_VERSION' }
      }).then(() => p.\$disconnect());
    " || echo "  WARN Update detection had warnings (non-fatal)"
    echo "  OK Update pending flag set"
  else
    echo "  -- Source volume already bootstrapped ($VOLUME_VERSION)"
  fi
else
  echo "  -- /workspace not mounted, skipping"
fi

echo "=== Init complete ==="
