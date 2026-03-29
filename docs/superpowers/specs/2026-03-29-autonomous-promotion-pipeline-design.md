# EP-PROMOTE-001: Autonomous Promotion Pipeline (Docker Promoter Service)

**Date:** 2026-03-29
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Epic ID:** EP-PROMOTE-001
**IT4IT Alignment:** SS5.4 Deploy Value Stream — SS5.4.3 Execute Deployment

**Predecessor specs:**

- `2026-03-25-promotion-pipeline-change-window-design.md` — promotion architecture, gaps identified
- `2026-03-29-sandbox-preview-ship-phase-fixes.md` — ship phase tools verified working
- `2026-03-19-sandbox-execution-db-isolation-design.md` — sandbox pool, workspace init

---

## Problem Statement

The promotion pipeline has all the pieces but no autonomous execution path:

1. **`applyPromotionPatch()` doesn't work in Docker** — runs `git apply` on the portal's compiled filesystem. The portal image contains standalone Next.js output, not source code. Patching source files has no effect on the running app.

2. **Portal can't restart itself** — the portal container cannot rebuild its own Docker image and restart. That's architecturally impossible (like a surgeon operating on their own brain).

3. **No trigger after approval** — when an operator approves a promotion in `/ops`, the status changes to "approved" but nothing executes. The `executePromotion()` function is orphaned.

4. **Manual intervention required** — today's promotion requires a human to: copy files from sandbox, rebuild the Docker image, restart the portal. This defeats the platform's self-development value proposition.

### What Already Exists

| Component | Location | Status |
|-----------|----------|--------|
| `executePromotion()` | `sandbox-promotion.ts` | Built — 9-step pipeline (validate, window, backup, diff, scan, apply, health, deploy, rollback) |
| `backupProductionDb()` | `sandbox-promotion.ts` | Built — pg_dump to `/backups` |
| `extractAndCategorizeDiff()` | `sandbox-promotion.ts` | Built — git diff from sandbox |
| `scanForDestructiveOps()` | `sandbox-promotion.ts` | Built — regex scan for DROP/ALTER/TRUNCATE |
| `verifyProductionHealth()` | `sandbox-promotion.ts` | Built — hits `/api/health` with retries |
| `deploy_feature` tool | `mcp-tools.ts` | Built — extracts diff, checks windows |
| `schedule_promotion` tool | `mcp-tools.ts` | Built — creates promotion record |
| Ship phase prompt | `build-agent-prompts.ts` | Built — 5-step tool chain |
| ChangePromotion model | Prisma schema | Built — status lifecycle |

---

## Design

### Architecture: Dedicated Promoter Service

A new Docker Compose service `promoter` runs as a one-shot container (same pattern as `portal-init`). The portal triggers it via `docker start`; the promoter executes the full pipeline independently.

```
Portal (running)                    Promoter (one-shot)
    |
    |  approve_promotion tool
    |  or operator clicks "Deploy"
    |
    +---> docker start promoter ------>  1. Read promotionId from env
    |                                    2. Validate status = approved
    |                                    3. Check deployment window
    |                                    4. pg_dump production backup
    |                                    5. Extract source from sandbox
    |                                    6. docker build new portal image
    |                                    7. docker stop old portal
    |        portal goes down            8. docker start new portal
    |                                    9. Health check /api/health
    |   new portal comes up              10. Update DB: deployed
    |                                    11. Exit (or rollback on failure)
    v   back online
```

**Key principle:** The promoter is pure procedural code. No AI agent, no LLM calls, no agentic loop. It's a script that runs steps in order with error handling and rollback.

### Section 1: Promoter Container

**New service in `docker-compose.yml`:**

```yaml
promoter:
  build:
    context: .
    dockerfile: Dockerfile.promoter
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
  environment:
    DATABASE_URL: ${DATABASE_URL:-postgresql://dpf:dpf_dev@postgres:5432/dpf}
    DPF_PRODUCTION_DB_CONTAINER: dpf-postgres-1
    DPF_PORTAL_SERVICE: portal
    DPF_PORTAL_CONTAINER: dpf-portal-1
    DPF_COMPOSE_PROJECT: dpf
  depends_on:
    postgres:
      condition: service_healthy
  profiles: ["promote"]  # Not started by default
  restart: "no"          # One-shot — don't restart on exit
```

**`Dockerfile.promoter`** — minimal image:

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache docker-cli postgresql16-client git
WORKDIR /promoter
COPY packages/db/prisma ./prisma
COPY packages/db/src ./db-src
COPY scripts/promote.sh ./promote.sh
RUN chmod +x promote.sh
# Prisma client for DB updates
RUN npm install @prisma/client prisma
RUN npx prisma generate
ENTRYPOINT ["./promote.sh"]
```

The image is ~100MB (node:20-alpine + docker-cli + pg-client). It contains:
- Docker CLI (to build images, start/stop containers)
- PostgreSQL client (for pg_dump backup)
- Git (for diff extraction)
- Prisma client (for updating promotion status in DB)
- The promotion shell script

### Section 2: Promotion Script (`scripts/promote.sh`)

Pure procedural shell script. No AI. Each step logs clearly, fails fast, rolls back on error.

**Input:** `PROMOTION_ID` environment variable (set by the portal before starting the container).

**Steps:**

```
1. READ    — Query DB for promotion record, validate status = "approved"
2. WINDOW  — Check deployment window (skip if emergency type)
3. BACKUP  — pg_dump production DB to /backups/pre-promote-{id}-{timestamp}.dump
4. SOURCE  — docker cp from sandbox container to temp build context
5. BUILD   — docker build -f Dockerfile -t dpf-portal:promote-{id} .
6. TAG     — docker tag dpf-portal:promote-{id} dpf-portal:rollback (save current)
7. STOP    — docker stop dpf-portal-1
8. START   — docker run with new image (same env, ports, volumes as original)
9. HEALTH  — curl /api/health with 30s timeout, 3 retries
10. UPDATE — Update DB: status=deployed, deployedAt=now
11. CLEANUP — Remove temp build context
```

**Rollback (on step 8 or 9 failure):**

```
R1. docker stop new portal (if running)
R2. docker start old portal with rollback tag
R3. pg_restore from backup (if migrations were applied)
R4. Update DB: status=rolled_back, rollbackReason="{step}: {error}"
R5. Exit with code 1
```

**Timeout:** The entire script has a 10-minute wall clock limit (`timeout 600 ./promote.sh`). If exceeded, rollback triggers automatically. This prevents hung promotions.

### Section 3: Portal Trigger

The portal triggers the promoter by setting the `PROMOTION_ID` env var and starting the container. Two trigger paths:

**Path A: MCP Tool — `execute_promotion`**

New tool in `mcp-tools.ts` called by the AI coworker during the ship phase:

```typescript
name: "execute_promotion"
description: "Execute an approved promotion — backup, build, deploy, verify."
inputSchema: { promotionId: string, overrideReason?: string }
requiredCapability: "manage_platform"
sideEffect: true
```

Handler:
1. Validate the promotion exists and is approved
2. Set env var on the promoter container: `docker exec` or recreate with env
3. `docker start dpf-promoter-1`
4. Poll promoter container status until it exits (max 10 min)
5. Read exit code: 0 = success, 1 = rolled back
6. Return result to the coworker

**Path B: Operator UI — "Deploy" button in `/ops/promotions`**

Server Action `executePromotionAction(promotionId)`:
1. Same validation
2. Same Docker start
3. Returns immediately with "Deployment started" (doesn't block the UI)
4. UI polls promotion status for updates

### Section 4: Source Extraction from Sandbox

The sandbox container has the complete workspace at `/workspace` with all changes applied. The promoter extracts it as a build context:

```sh
# Create temp build context
CONTEXT_DIR=$(mktemp -d)

# Copy full project from sandbox to build context
docker cp ${SANDBOX_CONTAINER}:/workspace/. ${CONTEXT_DIR}/

# Copy the Dockerfile from the current portal image
docker cp ${PORTAL_CONTAINER}:/app/Dockerfile ${CONTEXT_DIR}/ 2>/dev/null \
  || docker cp ${PORTAL_CONTAINER}:/Dockerfile ${CONTEXT_DIR}/ 2>/dev/null

# Build new image
docker build -f ${CONTEXT_DIR}/Dockerfile -t dpf-portal:promote-${PROMOTION_ID} ${CONTEXT_DIR}
```

**Important:** The Dockerfile must be available. Options:
1. Copy from current portal container
2. Bake it into the promoter image
3. Mount from a shared volume

Simplest: bake the Dockerfile into the promoter image at build time.

### Section 5: Safety Guarantees

| Guarantee | Implementation |
|-----------|---------------|
| **No data loss** | pg_dump backup before any change. Backup record in DB with file path. |
| **Automatic rollback** | On build failure, start failure, or health check failure — old image restored, DB restored. |
| **Time-bounded** | 10-minute wall clock limit. Hung promotion auto-rolls back. |
| **Window enforcement** | Normal changes blocked outside deployment windows. Emergency changes log override reason. |
| **Destructive op scanning** | Migrations scanned for DROP/ALTER/TRUNCATE before execution. |
| **Audit trail** | Every step logged. Promotion record updated with deploymentLog, backupId, timestamps. |
| **Idempotent** | Re-running the promoter for an already-deployed promotion is a no-op. |

### Section 6: Adapter Boundary

All Docker-specific operations are isolated in the promote script. The orchestration logic (validate, check window, update DB) uses Prisma directly. Future cloud adapters (EP-CLOUD-DEPLOY-001 / BI-CLOUD-001) replace the shell script with cloud-native equivalents:

| Docker (current) | AWS equivalent | K8s equivalent |
|-------------------|---------------|----------------|
| `docker cp` | S3 artifact | PVC or ConfigMap |
| `docker build` | CodeBuild | Kaniko or BuildKit |
| `docker stop/start` | ECS service update | Deployment rollout |
| `pg_dump` | RDS snapshot | pg_dump via Job |
| `curl /api/health` | ALB health check | Readiness probe |

---

## New Backlog Items

| ID | Title | Type | Priority |
|----|-------|------|----------|
| EP-PROMOTE-001-001 | Create Dockerfile.promoter and promote.sh script | portfolio | 1 |
| EP-PROMOTE-001-002 | Add promoter service to docker-compose.yml | portfolio | 2 |
| EP-PROMOTE-001-003 | Add execute_promotion MCP tool (portal trigger) | portfolio | 3 |
| EP-PROMOTE-001-004 | Add "Deploy" button to /ops/promotions UI | portfolio | 4 |
| EP-PROMOTE-001-005 | E2E test: full promotion with backup, build, deploy, verify | portfolio | 5 |

---

## Out of Scope

- Cloud deployment adapters (tracked in EP-CLOUD-DEPLOY-001)
- Blue-green deployment (requires load balancer)
- Canary releases (requires traffic splitting)
- Multi-node deployment (single Docker host only)
- Rollback UI (manual rollback via restore instructions)
