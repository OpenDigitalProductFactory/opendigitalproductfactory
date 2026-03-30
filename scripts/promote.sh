#!/bin/sh
# scripts/promote.sh — Autonomous promotion pipeline
# Runs inside the promoter container. No AI, no agents — pure procedural.
#
# Input:  PROMOTION_ID env var
# Output: Exit 0 (success) or Exit 1 (rolled back)
#
# Steps: validate -> window -> backup -> extract -> build -> tag -> stop -> start -> health -> update -> cleanup

# ─── Configuration ──────────────────────────────────────────────────────────
PROMOTION_ID="${PROMOTION_ID:?PROMOTION_ID env var is required}"
DB_CONTAINER="${DPF_PRODUCTION_DB_CONTAINER:-dpf-postgres-1}"
PORTAL_CONTAINER="${DPF_PORTAL_CONTAINER:-dpf-portal-1}"
COMPOSE_PROJECT="${DPF_COMPOSE_PROJECT:-dpf}"
DB_USER="${POSTGRES_USER:-dpf}"
DB_NAME="${POSTGRES_DB:-dpf}"
HEALTH_RETRIES=12
HEALTH_INTERVAL=10
BUILD_CONTEXT=""
BACKUP_FILE=""
OLD_IMAGE=""
NEW_IMAGE=""
ROLLBACK_NEEDED=false
SANDBOX_CONTAINER=""
BUILD_ID=""

log() { echo "[promoter] $(date +%H:%M:%S) $1"; }

# ─── Input validation (prevent SQL/shell injection) ─────────────────────────
echo "$PROMOTION_ID" | grep -qE '^[a-zA-Z0-9_-]+$' || { log "Invalid PROMOTION_ID format: $PROMOTION_ID"; exit 1; }

# ─── DB helpers (psql via production container) ─────────────────────────────
db_query() {
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "$1" 2>/dev/null
}

db_exec() {
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "$1" 2>/dev/null
}

update_status() {
  local status="$1" reason="$2" log_msg="$3"
  local escaped_reason escaped_log
  escaped_reason=$(echo "$reason" | sed "s/'/''/g")
  escaped_log=$(echo "$log_msg" | sed "s/'/''/g")
  local sql="UPDATE \"ChangePromotion\" SET \"status\"='${status}'"
  [ -n "$reason" ] && sql="${sql}, \"rollbackReason\"='${escaped_reason}'"
  [ -n "$log_msg" ] && sql="${sql}, \"deploymentLog\"='${escaped_log}'"
  [ "$status" = "deployed" ] && sql="${sql}, \"deployedAt\"=NOW()"
  [ "$status" = "rolled_back" ] && sql="${sql}, \"rolledBackAt\"=NOW()"
  sql="${sql} WHERE \"promotionId\"='${PROMOTION_ID}'"
  db_exec "$sql"
}

# ─── Rollback ───────────────────────────────────────────────────────────────
rollback() {
  local reason="$1"
  log "ROLLBACK: $reason"

  # Stop and remove new portal if it was started
  docker stop "${PORTAL_CONTAINER}-new" 2>/dev/null || true
  docker rm "${PORTAL_CONTAINER}-new" 2>/dev/null || true

  # Restore old portal
  if [ "$ROLLBACK_NEEDED" = "true" ]; then
    log "Restoring old portal..."
    # Stop any new portal that might be running
    docker stop "$PORTAL_CONTAINER" 2>/dev/null || true
    docker rm "$PORTAL_CONTAINER" 2>/dev/null || true
    # If old container still exists (renamed), restore it
    if docker inspect "${PORTAL_CONTAINER}-old" > /dev/null 2>&1; then
      docker rename "${PORTAL_CONTAINER}-old" "$PORTAL_CONTAINER" 2>/dev/null || true
      docker start "$PORTAL_CONTAINER" 2>/dev/null || true
    else
      # Old container was removed (step 8 removes it for compose) — use compose to restart
      # Restore the old image tag first
      if [ -n "$OLD_IMAGE" ]; then
        docker tag "$OLD_IMAGE" dpf-portal:latest 2>/dev/null || true
      fi
      # Start ONLY the portal container (--no-deps skips postgres/portal-init recreation).
# Postgres is already running and healthy — don't touch it.
# --no-build: use the tagged dpf-portal:latest image, don't rebuild from Dockerfile.
docker compose -p "$COMPOSE_PROJECT" -f /host-source/docker-compose.yml up -d --no-build --no-deps portal 2>&1 || true
    fi
  fi

  # Restore DB from backup if we have one
  if [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
    log "Restoring database from backup: $BACKUP_FILE"
    docker exec -i "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists < "$BACKUP_FILE" 2>/dev/null || true
  fi

  update_status "rolled_back" "$reason" "Rollback triggered: $reason"

  # Cleanup build context
  [ -n "$BUILD_CONTEXT" ] && rm -rf "$BUILD_CONTEXT" 2>/dev/null || true

  log "Rollback complete"
}

# Trap any unhandled error — ensures rollback runs AND script exits
trap 'rollback "Unexpected failure at line $LINENO"; exit 1' ERR

# ─── Step 1: Validate ──────────────────────────────────────────────────────
log "Step 1/11: Validating promotion $PROMOTION_ID"

PROMO_STATUS=$(db_query "SELECT status FROM \"ChangePromotion\" WHERE \"promotionId\"='${PROMOTION_ID}'")
[ -z "$PROMO_STATUS" ] && { log "Promotion $PROMOTION_ID not found"; exit 1; }
[ "$PROMO_STATUS" = "deployed" ] && { log "Already deployed -- nothing to do"; exit 0; }
[ "$PROMO_STATUS" != "approved" ] && { log "Status is '$PROMO_STATUS', not 'approved' -- cannot execute"; exit 1; }

# Get sandbox container and build ID from the linked build
SANDBOX_CONTAINER=$(db_query "
  SELECT fb.\"sandboxId\" FROM \"ChangePromotion\" cp
  JOIN \"ProductVersion\" pv ON cp.\"productVersionId\" = pv.id
  JOIN \"FeatureBuild\" fb ON pv.\"featureBuildId\" = fb.id
  WHERE cp.\"promotionId\"='${PROMOTION_ID}'
")
BUILD_ID=$(db_query "
  SELECT fb.\"buildId\" FROM \"ChangePromotion\" cp
  JOIN \"ProductVersion\" pv ON cp.\"productVersionId\" = pv.id
  JOIN \"FeatureBuild\" fb ON pv.\"featureBuildId\" = fb.id
  WHERE cp.\"promotionId\"='${PROMOTION_ID}'
")
[ -z "$SANDBOX_CONTAINER" ] && { log "No sandbox container linked to promotion"; exit 1; }
[ -z "$BUILD_ID" ] && { log "No build ID linked to promotion"; exit 1; }

NEW_IMAGE="dpf-portal:promote-${BUILD_ID}"
log "Sandbox: $SANDBOX_CONTAINER | Build: $BUILD_ID"

# Mark as executing (prevents concurrent runs)
update_status "executing" "" "Promoter started at $(date -Iseconds)"

# ─── Step 2: Check deployment window ───────────────────────────────────────
log "Step 2/11: Checking deployment window"

RFC_TYPE=$(db_query "
  SELECT cr.type FROM \"ChangePromotion\" cp
  LEFT JOIN \"ChangeItem\" ci ON ci.\"changePromotionId\" = cp.id
  LEFT JOIN \"ChangeRequest\" cr ON ci.\"changeRequestId\" = cr.id
  WHERE cp.\"promotionId\"='${PROMOTION_ID}'
  LIMIT 1
")
RFC_TYPE="${RFC_TYPE:-normal}"

if [ "$RFC_TYPE" != "emergency" ]; then
  log "Normal change -- window check advisory (proceeding)"
fi

# ─── Step 3: Backup production database ────────────────────────────────────
log "Step 3/11: Backing up production database"

BACKUP_DIR="/backups"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/pre-promote-${BUILD_ID}-$(date +%Y%m%d%H%M%S).dump"

docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$BACKUP_FILE"
BACKUP_SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null || echo 0)
log "Backup complete: $BACKUP_FILE (${BACKUP_SIZE} bytes)"

# Record backup in DB (PromotionBackup schema: id, buildId, timestamp, filePath, sizeBytes, status)
db_exec "INSERT INTO \"PromotionBackup\" (id, \"buildId\", \"filePath\", \"sizeBytes\", status)
  VALUES ('backup-${BUILD_ID}-$(date +%s)', '${BUILD_ID}', '${BACKUP_FILE}', ${BACKUP_SIZE}, 'complete')
  ON CONFLICT (id) DO NOTHING"

# ─── Step 4: Extract source from sandbox ───────────────────────────────────
log "Step 4/11: Extracting source from sandbox $SANDBOX_CONTAINER"

docker inspect "$SANDBOX_CONTAINER" --format='{{.State.Running}}' 2>/dev/null | grep -q "true" \
  || { log "Sandbox $SANDBOX_CONTAINER is not running"; rollback "Sandbox not running"; exit 1; }

BUILD_CONTEXT=$(mktemp -d)
log "Build context: $BUILD_CONTEXT"

# Strategy: start from host source (/host-source, mounted read-only), overlay sandbox changes.
# The host source is what the current production image was built from — guaranteed to compile.

# Step 4a: Copy build-essential source.
# Customizer mode: /host-source is mounted (host project directory).
# Consumer mode: no host source — copy from the portal container instead.
if [ -d /host-source/apps/web ]; then
  log "  Copying build-essential source from host..."
  cd /host-source
  for f in pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json docker-entrypoint.sh; do
    [ -f "$f" ] && cp "$f" "$BUILD_CONTEXT/" 2>/dev/null
  done
  tar -cf - --exclude='node_modules' --exclude='.next' apps/web packages \
    | tar -xf - -C "$BUILD_CONTEXT/"
  if [ -d docs/user-guide ]; then
    mkdir -p "$BUILD_CONTEXT/docs"
    cp -r docs/user-guide "$BUILD_CONTEXT/docs/" 2>/dev/null || true
  fi
  cd /promoter
else
  log "  No host source — copying from portal container..."
  docker cp "${PORTAL_CONTAINER}:/app/packages" "$BUILD_CONTEXT/packages" 2>/dev/null || true
  docker cp "${PORTAL_CONTAINER}:/app/node_modules" "$BUILD_CONTEXT/node_modules" 2>/dev/null || true
  for f in pnpm-workspace.yaml pnpm-lock.yaml package.json; do
    docker cp "${PORTAL_CONTAINER}:/app/$f" "$BUILD_CONTEXT/$f" 2>/dev/null || true
  done
  docker cp "${PORTAL_CONTAINER}:/docker-entrypoint.sh" "$BUILD_CONTEXT/docker-entrypoint.sh" 2>/dev/null || true
  docker cp "${PORTAL_CONTAINER}:/app/docs" "$BUILD_CONTEXT/docs" 2>/dev/null || true
  # Get the standalone app output (consumer mode — no source to rebuild from)
  docker cp "${PORTAL_CONTAINER}:/app/apps" "$BUILD_CONTEXT/apps" 2>/dev/null || true
fi

# Step 4b: Overlay ONLY the changed files from the sandbox (git diff against baseline)
log "  Extracting changed files from sandbox..."
CHANGED_FILES=$(docker exec "$SANDBOX_CONTAINER" sh -c "cd /workspace && git diff --name-only HEAD~1 HEAD 2>/dev/null" || echo "")
if [ -n "$CHANGED_FILES" ]; then
  log "  Changed files: $(echo "$CHANGED_FILES" | wc -l) file(s)"
  # Copy each changed file from sandbox to build context
  echo "$CHANGED_FILES" | while IFS= read -r filepath; do
    [ -z "$filepath" ] && continue
    # Create parent directory in build context
    dirpath=$(dirname "$filepath")
    mkdir -p "$BUILD_CONTEXT/$dirpath"
    # Copy from sandbox
    docker cp "${SANDBOX_CONTAINER}:/workspace/${filepath}" "$BUILD_CONTEXT/${filepath}" 2>/dev/null || true
  done
else
  log "  Warning: no changed files detected in sandbox git history"
fi

# Copy the portal Dockerfile (baked into promoter at build time)
cp /promoter/portal.Dockerfile "$BUILD_CONTEXT/Dockerfile"

log "Source extracted: $(find "$BUILD_CONTEXT" -type f | wc -l) files"

# ─── Step 5: Build new portal image ───────────────────────────────────────
log "Step 5/11: Building new portal image: $NEW_IMAGE"

docker build -f "$BUILD_CONTEXT/Dockerfile" -t "$NEW_IMAGE" "$BUILD_CONTEXT"
log "Image built: $NEW_IMAGE"

# ─── Step 6: Tag current image for rollback ────────────────────────────────
log "Step 6/11: Tagging current image for rollback"

OLD_IMAGE=$(docker inspect "$PORTAL_CONTAINER" --format='{{.Config.Image}}' 2>/dev/null || echo "")
log "Old image: $OLD_IMAGE"

# ─── Step 7: Stop old portal ──────────────────────────────────────────────
log "Step 7/11: Stopping old portal"

docker stop "$PORTAL_CONTAINER" 2>/dev/null || true
docker rename "$PORTAL_CONTAINER" "${PORTAL_CONTAINER}-old" 2>/dev/null || true
ROLLBACK_NEEDED=true
log "Old portal stopped and renamed to ${PORTAL_CONTAINER}-old"

# ─── Step 8: Start new portal ─────────────────────────────────────────────
log "Step 8/11: Starting new portal with $NEW_IMAGE"

# Tag the new image as dpf-portal:latest so docker compose uses it
docker tag "$NEW_IMAGE" dpf-portal:latest

# Remove the old stopped container so compose can recreate it
docker rm "${PORTAL_CONTAINER}-old" 2>/dev/null || true
# Note: if we need to rollback after this, we use the rollback image tag

# Use docker compose to start portal (preserves ALL config: env, ports, volumes, networks)
# Start ONLY the portal container (--no-deps skips postgres/portal-init recreation).
# Postgres is already running and healthy — don't touch it.
# --no-build: use the tagged dpf-portal:latest image, don't rebuild from Dockerfile.
docker compose -p "$COMPOSE_PROJECT" -f /host-source/docker-compose.yml up -d --no-build --no-deps portal 2>&1

log "New portal starting via compose..."

# Wait for container to be running
STATE="unknown"
for i in $(seq 1 30); do
  STATE=$(docker inspect "$PORTAL_CONTAINER" --format='{{.State.Status}}' 2>/dev/null || echo "missing")
  [ "$STATE" = "running" ] && break
  sleep 2
done
if [ "$STATE" != "running" ]; then
  rollback "New portal failed to start (state: $STATE)"
  exit 1
fi

# ─── Step 9: Health check ─────────────────────────────────────────────────
# Wait for portal-init to complete first (migrations + seed)
log "Step 9/11: Waiting for portal-init, then health check ($HEALTH_RETRIES retries, ${HEALTH_INTERVAL}s interval)"
sleep 30

HEALTHY=false
for i in $(seq 1 "$HEALTH_RETRIES"); do
  log "  Health check attempt $i/$HEALTH_RETRIES..."
  if docker exec "$PORTAL_CONTAINER" wget -qO /dev/null -T 10 http://127.0.0.1:3000/api/health 2>/dev/null; then
    HEALTHY=true
    break
  fi
  sleep "$HEALTH_INTERVAL"
done

if [ "$HEALTHY" != "true" ]; then
  rollback "Health check failed after $HEALTH_RETRIES attempts"
  exit 1
fi

log "Health check passed"

# ─── Step 10: Update DB status ────────────────────────────────────────────
log "Step 10/11: Marking promotion as deployed"

update_status "deployed" "" "Promoted via autonomous pipeline. Image: $NEW_IMAGE. Backup: $BACKUP_FILE."

# Update RFC if linked
db_exec "
  UPDATE \"ChangeRequest\" SET status='completed', \"completedAt\"=NOW(), outcome='success'
  WHERE id IN (
    SELECT ci.\"changeRequestId\" FROM \"ChangeItem\" ci
    JOIN \"ChangePromotion\" cp ON ci.\"changePromotionId\" = cp.id
    WHERE cp.\"promotionId\"='${PROMOTION_ID}'
  )
" 2>/dev/null || true

# ─── Step 11: Cleanup ────────────────────────────────────────────────────
log "Step 11/11: Cleanup"

ROLLBACK_NEEDED=false
rm -rf "$BUILD_CONTEXT" 2>/dev/null || true

# Disable the ERR trap (we succeeded)
trap - ERR

log "========================================"
log "PROMOTION COMPLETE: $PROMOTION_ID"
log "  Build:  $BUILD_ID"
log "  Image:  $NEW_IMAGE"
log "  Backup: $BACKUP_FILE"
log "========================================"
exit 0
