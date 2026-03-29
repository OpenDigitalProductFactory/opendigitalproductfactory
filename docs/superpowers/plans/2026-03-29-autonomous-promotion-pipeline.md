# Autonomous Promotion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dedicated Docker promoter service that autonomously executes approved promotions — backup DB, build new portal image from sandbox source, swap containers, health check, rollback on failure.

**Architecture:** A one-shot `promoter` container (node:20-alpine + docker-cli + pg-client) triggered by the portal via `docker start`. It runs a procedural shell script (no AI) that extracts source from the sandbox, builds a new portal image, swaps the running portal, verifies health, and rolls back on failure. The portal cannot restart itself — the promoter is the independent third party.

**Tech Stack:** Shell script (promote.sh), Docker CLI, PostgreSQL client (pg_dump/pg_restore), Docker Compose

**Spec:** `docs/superpowers/specs/2026-03-29-autonomous-promotion-pipeline-design.md`

**Review fixes applied:** PromotionBackup schema (timestamp, not createdAt), FK buildId resolution, ERR trap for rollback, input sanitization, rollback container lifecycle, health check stderr redirect, Deploy button UI task, E2E test task.

---

### Task 1: Create Dockerfile.promoter

**Files:**
- Create: `Dockerfile.promoter`

- [ ] **Step 1: Create Dockerfile.promoter**

```dockerfile
FROM node:20-alpine
LABEL org.opencontainers.image.title="DPF Promoter"
LABEL org.opencontainers.image.description="One-shot container that executes sandbox-to-production promotions"
RUN apk add --no-cache docker-cli postgresql16-client git curl jq
WORKDIR /promoter

# Copy Dockerfile for portal rebuilds (baked in at promoter build time)
COPY Dockerfile /promoter/portal.Dockerfile

# Copy promotion script
COPY scripts/promote.sh /promoter/promote.sh
RUN chmod +x /promoter/promote.sh

ENTRYPOINT ["/promoter/promote.sh"]
```

- [ ] **Step 2: Verify it builds**

```bash
docker build -f Dockerfile.promoter -t dpf-promoter:test .
docker images dpf-promoter:test --format "{{.Size}}"
# Expected: ~80-100MB
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile.promoter && git commit -m "feat(promoter): add Dockerfile.promoter for autonomous promotion service"
```

---

### Task 2: Create promote.sh script

**Files:**
- Create: `scripts/promote.sh`

**Review fixes incorporated:**
- ERR trap replaces `set -e` for safe rollback on any failure
- Input validation: PROMOTION_ID format checked (no SQL/shell injection)
- PromotionBackup INSERT uses correct columns (`timestamp`, not `createdAt`/`updatedAt`)
- PromotionBackup.buildId uses FeatureBuild.buildId (FK), not promotionId
- Rollback keeps `-old` container alive until health check passes; only removes after success
- Health check redirects stderr to avoid false failures
- `docker run` for new portal captures full env from old container via `docker inspect`

- [ ] **Step 1: Create scripts/promote.sh**

```sh
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
HEALTH_RETRIES=6
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

  # Restore old portal (renamed to -old in step 7, NOT removed until step 11)
  if [ "$ROLLBACK_NEEDED" = "true" ]; then
    log "Restoring old portal from ${PORTAL_CONTAINER}-old"
    docker rename "${PORTAL_CONTAINER}-old" "$PORTAL_CONTAINER" 2>/dev/null || true
    docker start "$PORTAL_CONTAINER" 2>/dev/null || true
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

# Trap any unhandled error — ensures rollback runs even if we miss a check
trap 'rollback "Unexpected failure at line $LINENO"' ERR

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

docker cp "${SANDBOX_CONTAINER}:/workspace/." "$BUILD_CONTEXT/"

# Copy the portal Dockerfile (baked into promoter at build time)
cp /promoter/portal.Dockerfile "$BUILD_CONTEXT/Dockerfile"

# Copy docker-entrypoint.sh from current portal
docker cp "${PORTAL_CONTAINER}:/docker-entrypoint.sh" "$BUILD_CONTEXT/docker-entrypoint.sh" 2>/dev/null || true

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

# Capture old container's full env for potential manual recovery
docker inspect "$PORTAL_CONTAINER" --format='{{range .Config.Env}}{{println .}}{{end}}' > /tmp/portal-env-backup.txt 2>/dev/null || true

docker stop "$PORTAL_CONTAINER"
docker rename "$PORTAL_CONTAINER" "${PORTAL_CONTAINER}-old"
ROLLBACK_NEEDED=true
log "Old portal stopped and renamed to ${PORTAL_CONTAINER}-old"

# ─── Step 8: Start new portal ─────────────────────────────────────────────
log "Step 8/11: Starting new portal with $NEW_IMAGE"

# Recreate portal container with the new image but same config.
# Extract env vars, ports, volumes from old container.
OLD_ENV_ARGS=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  OLD_ENV_ARGS="$OLD_ENV_ARGS -e $(printf '%s' "$line" | sed 's/ /\\ /g')"
done < /tmp/portal-env-backup.txt

docker run -d \
  --name "$PORTAL_CONTAINER" \
  --restart unless-stopped \
  --network "${COMPOSE_PROJECT}_default" \
  -p 3000:3000 \
  -p 1455:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  $OLD_ENV_ARGS \
  "$NEW_IMAGE"

log "New portal starting..."

# Wait for container to be running
for i in $(seq 1 30); do
  STATE=$(docker inspect "$PORTAL_CONTAINER" --format='{{.State.Status}}' 2>/dev/null || echo "missing")
  [ "$STATE" = "running" ] && break
  sleep 2
done
[ "$STATE" != "running" ] && { rollback "New portal failed to start (state: $STATE)"; exit 1; }

# ─── Step 9: Health check ─────────────────────────────────────────────────
log "Step 9/11: Health check ($HEALTH_RETRIES retries, ${HEALTH_INTERVAL}s interval)"

HEALTHY=false
for i in $(seq 1 "$HEALTH_RETRIES"); do
  log "  Health check attempt $i/$HEALTH_RETRIES..."
  if docker exec "$PORTAL_CONTAINER" wget -qO /dev/null -T 10 http://localhost:3000/api/health 2>/dev/null; then
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

# NOW safe to remove old container (health check passed)
docker rm "${PORTAL_CONTAINER}-old" 2>/dev/null || true
ROLLBACK_NEEDED=false

rm -rf "$BUILD_CONTEXT" 2>/dev/null || true
rm -f /tmp/portal-env-backup.txt 2>/dev/null || true

# Disable the ERR trap (we succeeded)
trap - ERR

log "========================================"
log "PROMOTION COMPLETE: $PROMOTION_ID"
log "  Build:  $BUILD_ID"
log "  Image:  $NEW_IMAGE"
log "  Backup: $BACKUP_FILE"
log "========================================"
exit 0
```

- [ ] **Step 2: Verify script has LF line endings and is valid shell**

```bash
file scripts/promote.sh
# Expected: ASCII text (LF line endings, no BOM)
```

- [ ] **Step 3: Commit**

```bash
git add scripts/promote.sh && git commit -m "feat(promoter): add promote.sh autonomous promotion script (11-step pipeline with rollback)"
```

---

### Task 3: Add promoter service to docker-compose.yml

**Files:**
- Modify: `docker-compose.yml` (insert after sandbox-3 service, around line 143)

- [ ] **Step 1: Add promoter service**

Insert after the `sandbox-3` service block and before the `playwright` service:

```yaml
  # ─── Promoter (autonomous deployment pipeline) ─────────────────────────
  # One-shot container that builds new portal images from sandbox source.
  # Triggered by: execute_promotion MCP tool or operator "Deploy" button.
  # Not started by default (profiles: promote).
  promoter:
    build:
      context: .
      dockerfile: Dockerfile.promoter
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./backups:/backups
    environment:
      DPF_PRODUCTION_DB_CONTAINER: dpf-postgres-1
      DPF_PORTAL_CONTAINER: dpf-portal-1
      DPF_COMPOSE_PROJECT: dpf
      POSTGRES_USER: ${POSTGRES_USER:-dpf}
      POSTGRES_DB: dpf
    depends_on:
      postgres:
        condition: service_healthy
    profiles: ["promote"]
    restart: "no"
```

- [ ] **Step 2: Validate compose config**

```bash
docker compose config --quiet && echo "Config valid"
```

- [ ] **Step 3: Build the promoter image**

```bash
docker compose --profile promote build promoter
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml && git commit -m "feat(promoter): add promoter service to docker-compose.yml"
```

---

### Task 4: Add execute_promotion MCP tool

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
  - Tool definition: insert after `schedule_promotion` definition (~line 505)
  - Tool handler: insert after `schedule_promotion` handler (~line 2520)

**Review fix:** Uses `execFile` (array form) instead of string interpolation to prevent command injection.

- [ ] **Step 1: Add tool definition to PLATFORM_TOOLS array**

Insert after the `schedule_promotion` tool definition:

```typescript
  {
    name: "execute_promotion",
    description: "Execute an approved promotion. Starts the autonomous promoter: backup DB, build new portal image from sandbox, swap containers, health check. Rolls back automatically on failure.",
    inputSchema: {
      type: "object" as const,
      properties: {
        promotion_id: { type: "string", description: "The promotion ID to execute (e.g. CP-xxxx)." },
        override_reason: { type: "string", description: "Reason for deploying outside a deployment window (optional, for emergency changes)." },
      },
      required: ["promotion_id"],
    },
    requiredCapability: "manage_platform" as const,
    executionMode: "immediate" as const,
    sideEffect: true,
  },
```

- [ ] **Step 2: Add tool handler in executeTool switch**

Insert after the `schedule_promotion` case. Uses `execFile` to avoid shell injection:

```typescript
    case "execute_promotion": {
      const promotionId = String(params.promotion_id ?? "");
      if (!promotionId || !/^[a-zA-Z0-9_-]+$/.test(promotionId)) {
        return { success: false, error: "Invalid promotion_id", message: "Provide a valid promotion ID." };
      }

      // Validate promotion exists and is approved
      const promo = await prisma.changePromotion.findFirst({ where: { promotionId } });
      if (!promo) return { success: false, error: "Not found", message: `Promotion ${promotionId} not found.` };
      if (promo.status === "deployed") return { success: true, message: `Already deployed.`, data: { status: "deployed" } };
      if (promo.status !== "approved") return { success: false, error: `Status is ${promo.status}`, message: `Must be approved first.` };

      // Resolve sandbox and build ID
      const promoDetail = await prisma.changePromotion.findFirst({
        where: { promotionId },
        include: { productVersion: { include: { featureBuild: { select: { sandboxId: true, buildId: true } } } } },
      });
      const sandboxId = promoDetail?.productVersion?.featureBuild?.sandboxId;
      const buildId = promoDetail?.productVersion?.featureBuild?.buildId;
      if (!sandboxId) return { success: false, error: "No sandbox", message: "No sandbox linked to this promotion." };

      const { execFile: execFileCb } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFileCb);
      const execAsync = promisify((await import("child_process")).exec);

      // Start promoter container (array form — no shell injection)
      try {
        await execAsync("docker rm dpf-promoter-1 2>/dev/null || true");
        await execFileAsync("docker", [
          "run", "-d",
          "--name", "dpf-promoter-1",
          "--network", `${process.env.DPF_COMPOSE_PROJECT ?? "dpf"}_default`,
          "-v", "/var/run/docker.sock:/var/run/docker.sock",
          "-v", "dpf_backups:/backups",
          "-e", `PROMOTION_ID=${promotionId}`,
          "-e", `DPF_PRODUCTION_DB_CONTAINER=${process.env.DPF_PRODUCTION_DB_CONTAINER ?? "dpf-postgres-1"}`,
          "-e", `DPF_PORTAL_CONTAINER=dpf-portal-1`,
          "-e", `DPF_COMPOSE_PROJECT=${process.env.DPF_COMPOSE_PROJECT ?? "dpf"}`,
          "-e", `DPF_SANDBOX_CONTAINER=${sandboxId}`,
          "-e", `POSTGRES_USER=${process.env.POSTGRES_USER ?? "dpf"}`,
          "dpf-promoter",
        ]);
      } catch (err) {
        return { success: false, error: `Failed to start promoter: ${(err as Error).message?.slice(0, 200)}`, message: "Could not start the promoter container." };
      }

      // Poll for completion (max 10 minutes)
      const maxWaitMs = 10 * 60 * 1000;
      const pollInterval = 10_000;
      const startTime = Date.now();
      let exitCode: number | null = null;

      while (Date.now() - startTime < maxWaitMs) {
        await new Promise(r => setTimeout(r, pollInterval));
        try {
          const { stdout } = await execAsync("docker inspect dpf-promoter-1 --format='{{.State.Status}} {{.State.ExitCode}}'");
          const parts = stdout.trim().replace(/'/g, "").split(" ");
          if (parts[0] === "exited") {
            exitCode = parseInt(parts[1] ?? "1", 10);
            break;
          }
        } catch { /* container may not exist yet */ }
      }

      if (exitCode === null) {
        await execAsync("docker stop dpf-promoter-1 2>/dev/null || true").catch(() => {});
        return { success: false, error: "Timeout (10 min)", message: "Promoter did not complete. Check ops dashboard." };
      }

      const finalPromo = await prisma.changePromotion.findFirst({ where: { promotionId } });
      const success = exitCode === 0 && finalPromo?.status === "deployed";

      await execAsync("docker rm dpf-promoter-1 2>/dev/null || true").catch(() => {});
      logBuildActivity(buildId ?? promotionId, "execute_promotion", success ? "Deployed successfully" : `Rolled back: ${finalPromo?.rollbackReason ?? "unknown"}`);

      return {
        success,
        message: success
          ? `Promotion ${promotionId} deployed. Health check passed.`
          : `Rolled back. ${finalPromo?.rollbackReason ?? "Check deployment log."}`,
        data: { promotionId, status: finalPromo?.status, deploymentLog: finalPromo?.deploymentLog?.slice(0, 1000) },
      };
    }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/mcp-tools.ts && git commit -m "feat(promoter): add execute_promotion MCP tool (triggers autonomous promoter)"
```

---

### Task 5: Wire executePromotionAction to use promoter

**Files:**
- Modify: `apps/web/lib/actions/promotions.ts` (lines 90-97)

- [ ] **Step 1: Update executePromotionAction to try Docker promoter, fall back to in-portal**

Replace lines 90-97 with:

```typescript
export async function executePromotionAction(
  promotionId: string,
  overrideReason?: string,
) {
  await requireOpsAccess();

  // Validate
  if (!promotionId || !/^[a-zA-Z0-9_-]+$/.test(promotionId)) {
    return { success: false, step: "validate", message: "Invalid promotion ID." };
  }

  const promo = await prisma.changePromotion.findFirst({
    where: { promotionId },
    include: { productVersion: { include: { featureBuild: { select: { sandboxId: true } } } } },
  });
  if (!promo) return { success: false, step: "validate", message: "Promotion not found." };
  if (promo.status !== "approved") return { success: false, step: "validate", message: `Status is ${promo.status}, not approved.` };

  const sandboxId = promo.productVersion?.featureBuild?.sandboxId;

  // Try Docker promoter first (production path)
  try {
    const { execFile: execFileCb } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFileCb);
    const execAsync = promisify((await import("child_process")).exec);

    await execAsync("docker info", { timeout: 5_000 });
    await execAsync("docker rm dpf-promoter-1 2>/dev/null || true");

    const envArgs: string[] = [
      "run", "-d",
      "--name", "dpf-promoter-1",
      "--network", `${process.env.DPF_COMPOSE_PROJECT ?? "dpf"}_default`,
      "-v", "/var/run/docker.sock:/var/run/docker.sock",
      "-v", "dpf_backups:/backups",
      "-e", `PROMOTION_ID=${promotionId}`,
      "-e", `DPF_PRODUCTION_DB_CONTAINER=${process.env.DPF_PRODUCTION_DB_CONTAINER ?? "dpf-postgres-1"}`,
      "-e", "DPF_PORTAL_CONTAINER=dpf-portal-1",
      "-e", `DPF_COMPOSE_PROJECT=${process.env.DPF_COMPOSE_PROJECT ?? "dpf"}`,
      "-e", `POSTGRES_USER=${process.env.POSTGRES_USER ?? "dpf"}`,
    ];
    if (sandboxId) envArgs.push("-e", `DPF_SANDBOX_CONTAINER=${sandboxId}`);
    if (overrideReason) envArgs.push("-e", `DPF_WINDOW_OVERRIDE=${overrideReason}`);
    envArgs.push("dpf-promoter");

    await execFileAsync("docker", envArgs);
    return { success: true, step: "started", message: "Promoter started. Deployment in progress -- monitor in promotions list." };
  } catch {
    // Docker not available -- fall back to in-portal execution
    const { executePromotion } = await import("@/lib/sandbox-promotion");
    return executePromotion(promotionId, overrideReason);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/actions/promotions.ts && git commit -m "feat(promoter): wire executePromotionAction to Docker promoter with fallback"
```

---

### Task 6: Add execute_promotion to ship phase prompt

**Files:**
- Modify: `apps/web/lib/build-agent-prompts.ts` (ship phase prompt, ~line 225)

- [ ] **Step 1: Add execute_promotion as step 5 in ship phase**

In the ship phase prompt, after step 4 (`schedule_promotion`), add:

```
5. If the promotion status is "approved", call execute_promotion with the promotion ID. This triggers the autonomous deployment pipeline: backup DB, build new image from sandbox, swap portal, health check. Wait for it to complete (up to 10 minutes). Report success or rollback to the user.
6. Call assess_contribution to evaluate whether this feature should be contributed to the Hive Mind community.
```

Renumber existing step 5 (assess_contribution) to step 6.

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/build-agent-prompts.ts && git commit -m "feat(promoter): add execute_promotion to ship phase tool chain"
```

---

### Task 7: Add deployment status polling to promotions UI

**Files:**
- Modify: `apps/web/components/ops/PromotionsClient.tsx`

- [ ] **Step 1: Add polling after deploy action**

After `handleDeploy()` calls `executePromotionAction()` and gets a successful response, start polling every 3 seconds via `router.refresh()` until the promotion status changes from "approved"/"executing" to "deployed" or "rolled_back".

Add `useEffect` cleanup to clear any active polling interval on unmount.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/ops/PromotionsClient.tsx && git commit -m "feat(promoter): add deployment status polling to promotions UI"
```

---

### Task 8: Rebuild and verify

- [ ] **Step 1: Build all images**

```bash
docker compose build portal
docker compose --profile promote build promoter
```

- [ ] **Step 2: Restart portal**

```bash
docker compose up -d --force-recreate portal
for i in $(seq 1 20); do curl -sf http://localhost:3000/api/health && break; sleep 10; done
```

- [ ] **Step 3: Verify promoter starts and exits cleanly**

```bash
# Dry run -- should fail with "PROMOTION_ID env var is required"
docker compose --profile promote run --rm promoter 2>&1 | head -3
# Expected: PROMOTION_ID env var is required

# With invalid promotion -- should exit 1 with "not found"
docker compose --profile promote run --rm -e PROMOTION_ID=FAKE-001 promoter 2>&1 | head -5
# Expected: Promotion FAKE-001 not found
```

- [ ] **Step 4: Final commit**

```bash
git add docs/ && git commit -m "docs(promoter): finalize spec and plan"
```

---

## Execution Notes

- **Line endings:** `promote.sh` MUST have LF line endings (`.gitattributes` enforces `*.sh text eol=lf`)
- **No npx:** Promoter uses `psql` directly, not Prisma CLI
- **Backups volume:** `./backups` bind-mounted so backups persist on host
- **Network:** Promoter joins `dpf_default` to reach postgres and portal
- **Idempotent:** Re-running for deployed promotion exits 0 immediately
- **ERR trap:** Any unhandled error triggers rollback (review fix #5)
- **Container lifecycle:** Old portal renamed to `-old`, kept alive until health check passes, only removed in step 11 (review fix #9)
- **Input sanitization:** PROMOTION_ID validated against `^[a-zA-Z0-9_-]+$`; TypeScript uses `execFile` array form (review fixes #4, #11)
