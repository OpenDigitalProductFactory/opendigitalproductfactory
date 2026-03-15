#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# restore-full-db.sh — Restore full database state on a fresh install
#
# Usage:  ./scripts/restore-full-db.sh
#
# Prerequisites:
#   1. PostgreSQL running with dpf database created
#   2. pnpm install completed
#   3. .env with DATABASE_URL set
#
# This script runs in order:
#   1. Prisma migrations (creates all tables)
#   2. Prisma seed (roles, portfolios, agents, taxonomy, products, base epics)
#   3. DB export restore (epics, backlog items, epic-portfolio links, scheduled jobs)
#   4. DB export restore (model providers, platform config, feature builds, discovery runs)
#   5. Incremental SQL scripts (epic updates applied on top of seed)
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_DIR="$PROJECT_ROOT/packages/db"

echo "=== Step 1: Run Prisma migrations ==="
cd "$DB_DIR"
npx prisma migrate deploy

echo ""
echo "=== Step 2: Run Prisma seed ==="
npx prisma db seed

echo ""
echo "=== Step 3: Restore epics + backlog export ==="
npx prisma db execute --file "$SCRIPT_DIR/db-export-epics-backlog.sql" --schema prisma/schema.prisma

echo ""
echo "=== Step 4: Restore runtime state (providers, config, builds) ==="
npx prisma db execute --file "$SCRIPT_DIR/db-export-runtime-state.sql" --schema prisma/schema.prisma

echo ""
echo "=== Step 5: Apply incremental epic scripts ==="
# These are idempotent (upsert/ON CONFLICT patterns)
for sql_file in \
  "$SCRIPT_DIR/seed-vision-epics.sql" \
  "$SCRIPT_DIR/seed-hr-epic.sql" \
  "$SCRIPT_DIR/seed-crm-epic.sql" \
  "$SCRIPT_DIR/seed-sbom-epic.sql" \
  "$SCRIPT_DIR/seed-calendaring-epic.sql" \
  "$SCRIPT_DIR/update-finance-epic.sql" \
  "$SCRIPT_DIR/update-selfdev-epic-runtime-registration.sql" \
  "$SCRIPT_DIR/update-calendar-epic.sql" \
  "$SCRIPT_DIR/cleanup-orphaned-hr-items.sql" \
  "$SCRIPT_DIR/dedup-hr-epic.sql" \
  "$SCRIPT_DIR/mark-neo4j-stories-done.sql" \
  "$SCRIPT_DIR/mark-neo4j-stories-6-7-done.sql" \
; do
  if [ -f "$sql_file" ]; then
    echo "  Applying $(basename "$sql_file")..."
    npx prisma db execute --file "$sql_file" --schema prisma/schema.prisma || echo "  WARNING: $(basename "$sql_file") had errors (may be expected if already applied)"
  fi
done

echo ""
echo "=== Database restore complete ==="
echo "Epics, backlog items, providers, and runtime state restored."
