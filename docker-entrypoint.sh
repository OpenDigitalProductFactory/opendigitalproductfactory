#!/bin/sh
set -e

echo "=== DPF Portal Init ==="

echo "[1/3] Running database migrations..."
cd /app
pnpm --filter @dpf/db exec prisma migrate deploy
echo "  ✓ Migrations complete"

echo "[2/3] Seeding reference data..."
cd /app
pnpm --filter @dpf/db exec tsx src/seed.ts || echo "  ⚠ Seed had warnings (non-fatal)"
echo "  ✓ Seed complete"

echo "[3/3] Detecting hardware..."
if [ -n "$DPF_HOST_PROFILE" ]; then
  cd /app
  pnpm --filter @dpf/db exec tsx scripts/detect-hardware.ts || echo "  ⚠ Hardware detection had warnings (non-fatal)"
  echo "  ✓ Hardware profile saved"
else
  echo "  → No host profile provided, skipping"
fi

echo "=== Init complete ==="
