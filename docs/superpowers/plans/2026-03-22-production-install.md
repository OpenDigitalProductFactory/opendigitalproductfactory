# Production Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split install-dpf.ps1 into consumer (pre-built images) and customizer (source) modes, unify the Docker image, and publish to GHCR.

**Architecture:** The installer presents a mode choice after Docker setup. Consumer mode writes an embedded docker-compose.yml pointing to GHCR images. Customizer mode clones source (from fork or upstream) and builds locally. A unified Docker image serves both portal-init and portal roles. GitHub Actions publishes images on git tags.

**Tech Stack:** PowerShell 5.1+, Docker Compose, GitHub Actions, GHCR, Docker Model Runner

**Spec:** `docs/superpowers/specs/2026-03-22-production-install-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `Dockerfile` | Merge init+runner into unified stage |
| Modify | `docker-compose.yml` | Update portal-init to use command override (not separate target) |
| Modify | `install-dpf.ps1` | Add mode choice, consumer path, customizer sub-paths |
| Create | `.github/workflows/publish-image.yml` | Build + push images on git tags |
| — | `scripts/dpf-start.ps1` | No changes needed (consumer gets an inline copy) |
| — | `scripts/dpf-stop.ps1` | No changes needed (already generic) |

---

### Task 1: Unify the Dockerfile (merge init + runner stages)

**Files:**
- Modify: `Dockerfile`

The init stage currently builds a separate image. We merge its dependencies into the runner stage so one image can serve both roles.

- [ ] **Step 1: Read the current Dockerfile to confirm stage structure**

Verify stages: base → deps → build → init → runner. The runner stage currently uses `FROM node:20-alpine` (no pnpm).

- [ ] **Step 2: Replace the runner stage**

Replace everything from `# ─── Stage 5: runner` to end of file with:

```dockerfile
# ─── Stage 5: runner (unified — serves app AND runs init) ─────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Copy standalone Next.js output
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

# Copy init dependencies: pnpm workspace, migrations, seed, Prisma client, tsx
COPY --from=init /app/packages/db ./packages/db
COPY --from=init /app/node_modules ./node_modules
COPY --from=init /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

Key change: `FROM base AS runner` (not `FROM node:20-alpine`) — gives us pnpm for the entrypoint.

- [ ] **Step 3: Remove the ENTRYPOINT from the init stage**

The init stage (`Stage 4`) currently has `ENTRYPOINT ["/docker-entrypoint.sh"]`. Remove just the ENTRYPOINT and the COPY/chmod for docker-entrypoint.sh from the init stage — it's now only used as a build source for the runner stage. Leave everything else (the pnpm install, prisma generate) because the runner COPYs from it.

Replace the init stage with:

```dockerfile
# ─── Stage 4: init (build source for migrations, seed, Prisma client) ─────────
FROM deps AS init
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dpf/db exec prisma generate
```

- [ ] **Step 4: Update docker-compose.yml portal-init to use command override**

Change portal-init from `build: { target: init }` to `build: { target: runner }` and add `command`:

```yaml
  portal-init:
    build:
      context: .
      target: runner
    command: ["/docker-entrypoint.sh"]
    environment:
      DATABASE_URL: ${DATABASE_URL:-postgresql://dpf:dpf_dev@postgres:5432/dpf}
      DPF_HOST_PROFILE: ${DPF_HOST_PROFILE:-}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-changeme123}
    depends_on:
      postgres:
        condition: service_healthy
```

And update the portal service build target to runner. **Only change the `target:` line** — preserve all existing config (volumes, environment, healthcheck, depends_on):

```yaml
  portal:
    build:
      context: .
      target: runner   # was: no explicit target (defaulted to last stage)
```

- [ ] **Step 5: Test the unified image locally**

```powershell
docker compose down -v
docker compose build --no-cache
docker compose up -d
# Wait for portal-init to complete, then check portal health
docker compose logs portal-init
docker compose ps
```

Verify: portal-init runs migrations + seed and exits 0. Portal starts and serves on :3000.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat(docker): unify init+runner into single image stage

Merged init dependencies (pnpm, Prisma, tsx, migrations, seed) into
the runner stage. Runner uses FROM base (has pnpm) instead of bare
node:20-alpine. Compose runs the unified image with command override
for portal-init. One image serves both roles."
```

---

### Task 2: Create GitHub Actions workflow for image publishing

**Files:**
- Create: `.github/workflows/publish-image.yml`

- [ ] **Step 1: Create the workflows directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Write the workflow file**

Create `.github/workflows/publish-image.yml`:

```yaml
name: Publish Docker Images

on:
  push:
    tags: ["v*"]
  workflow_dispatch:
    inputs:
      tag:
        description: "Image tag (e.g. v0.1.0). Defaults to latest."
        required: false
        default: "latest"

env:
  REGISTRY: ghcr.io
  PORTAL_IMAGE: ghcr.io/${{ github.repository_owner }}/dpf-portal
  SANDBOX_IMAGE: ghcr.io/${{ github.repository_owner }}/dpf-sandbox

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install pnpm
        run: corepack enable && corepack prepare pnpm@latest --activate

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Generate Prisma client
        run: pnpm --filter @dpf/db exec prisma generate

      - name: Typecheck
        run: pnpm typecheck

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Determine tag
        id: tag
        run: |
          if [[ "${{ github.event_name }}" == "push" ]]; then
            TAG="${GITHUB_REF#refs/tags/}"
          else
            TAG="${{ github.event.inputs.tag }}"
          fi
          echo "version=$TAG" >> "$GITHUB_OUTPUT"

      - name: Build and push portal image
        uses: docker/build-push-action@v5
        with:
          context: .
          target: runner
          push: true
          tags: |
            ${{ env.PORTAL_IMAGE }}:${{ steps.tag.outputs.version }}
            ${{ env.PORTAL_IMAGE }}:latest

      - name: Build and push sandbox image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: Dockerfile.sandbox
          push: true
          tags: |
            ${{ env.SANDBOX_IMAGE }}:${{ steps.tag.outputs.version }}
            ${{ env.SANDBOX_IMAGE }}:latest
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish-image.yml
git commit -m "ci: add GitHub Actions workflow to publish Docker images to GHCR

Triggered on git tags (v*) and manual dispatch. Runs typecheck gate
before building. Publishes dpf-portal and dpf-sandbox images."
```

---

### Task 3: Add mode choice to install-dpf.ps1 (Step 4 rewrite)

**Files:**
- Modify: `install-dpf.ps1`

This is the core change. Step 4 currently always clones source. We replace it with a mode choice that branches into consumer or customizer paths.

- [ ] **Step 1: Add `--Version` parameter and `$InstallMode` variable**

At the top of the script, update the param block:

```powershell
param(
    [string]$InstallDir,
    [string]$Version = "latest"
)
```

After the helpers section (around line 102), add:

```powershell
$GHCR_PORTAL = "ghcr.io/OpenDigitalProductFactory/dpf-portal"
$GHCR_SANDBOX = "ghcr.io/OpenDigitalProductFactory/dpf-sandbox"
$InstallMode = $null  # Set in Step 4: "consumer", "contributor", or "private"
```

- [ ] **Step 2: Add Docker Desktop version check to Step 3**

After the existing Docker daemon wait loop (around line 249, after `Write-OK "Docker is running"`), add:

```powershell
    # Check Docker Desktop version for Model Runner support.
    # Note: `docker version` returns the Engine version (e.g., 27.5.1), NOT the Desktop version.
    # `docker model` is the Model Runner command — if it exists, Desktop 4.40+ is present.
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    docker model list 2>&1 | Out-Null
    $modelRunnerAvailable = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $oldEAP
    if (-not $modelRunnerAvailable) {
        Write-Warn "Docker Model Runner not available. Docker Desktop 4.40+ is required for AI features."
        Write-Warn "Please update Docker Desktop: https://docs.docker.com/desktop/release-notes/"
        Write-Warn "The platform will install but AI features (local models) won't work until you update."
    }
```

- [ ] **Step 3: Replace Step 4 with mode choice + branching logic**

Replace the entire `# --- Step 4:` block (lines ~255-345) with:

```powershell
# --- Step 4: Choose install mode and set up files ----------------------------

Write-Step 4 9 "Setting up Digital Product Factory..."
if (-not (Is-StepDone "download")) {

    # If we already have a compose file, detect mode from prior install
    if (Test-Path "$DPF_DIR\docker-compose.yml") {
        if (Test-Path "$DPF_DIR\.git") {
            $InstallMode = "customizer"
            Write-Action "Updating project files..."
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            git -C "$DPF_DIR" pull --ff-only 2>&1 | Out-Null
            $ErrorActionPreference = $oldEAP
        } else {
            $InstallMode = "consumer"
        }
        Write-OK "Project files already in place ($InstallMode mode)"
        Save-Progress "download"
    } else {

        # --- Mode choice ---
        Write-Host ""
        Write-Host "  How do you want to use Digital Product Factory?" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "    [1] Ready to go   - Pre-built, runs in minutes. No source code needed." -ForegroundColor White
        Write-Host "    [2] Customizable  - Full source code. Build and modify to fit your business." -ForegroundColor White
        Write-Host ""
        $modeChoice = Read-Host "  Choose [1/2]"

        if ($modeChoice -eq "2") {
            # --- Customizer sub-choice ---
            Write-Host ""
            Write-Host "  Would you like to contribute improvements back to the project?" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "    [a] Yes - I'll fork on GitHub and submit pull requests" -ForegroundColor White
            Write-Host "    [b] No  - My changes stay private" -ForegroundColor White
            Write-Host ""
            $subChoice = Read-Host "  Choose [a/b]"

            # Pre-flight: git required for customizer
            if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
                Write-Warn "Git is required for customizable mode."
                Write-Warn "Install from https://git-scm.com/download/win and re-run."
                exit 1
            }

            if (-not (Test-Path $DPF_DIR)) {
                New-Item -ItemType Directory -Path $DPF_DIR -Force | Out-Null
            }

            if ($subChoice -eq "a") {
                $InstallMode = "contributor"
                $ghUser = Read-Host "  Your GitHub username"

                # Check if fork exists
                Write-Action "Checking for your fork..."
                $forkUrl = "https://api.github.com/repos/$ghUser/opendigitalproductfactory"
                try {
                    $forkCheck = Invoke-WebRequest -Uri $forkUrl -UseBasicParsing -TimeoutSec 10 -ErrorAction SilentlyContinue
                } catch { $forkCheck = $null }

                if (-not $forkCheck -or $forkCheck.StatusCode -ne 200) {
                    Write-Action "No fork found. Opening GitHub to create one..."
                    Start-Process "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/fork"
                    Write-Host "  Press Enter after you've created the fork..." -ForegroundColor Yellow
                    Read-Host | Out-Null
                }

                Write-Action "Cloning your fork..."
                # Stash progress files
                $stash = @{}
                foreach ($f in '.install-progress','.env') {
                    if (Test-Path "$DPF_DIR\$f") {
                        $stash[$f] = Get-Content "$DPF_DIR\$f" -Raw
                        Remove-Item "$DPF_DIR\$f"
                    }
                }
                if ((Test-Path $DPF_DIR) -and
                    @(Get-ChildItem $DPF_DIR -Force -ErrorAction SilentlyContinue).Count -eq 0) {
                    Remove-Item $DPF_DIR
                }

                $oldEAP = $ErrorActionPreference
                $ErrorActionPreference = "Continue"
                git clone "https://github.com/$ghUser/opendigitalproductfactory.git" "$DPF_DIR" 2>&1
                $ErrorActionPreference = $oldEAP
                if ($LASTEXITCODE -ne 0) {
                    Write-Warn "Clone failed. Check your username and try again."
                    exit 1
                }
                git -C "$DPF_DIR" remote add upstream "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git" 2>$null

                foreach ($f in $stash.Keys) { $stash[$f] | Set-Content "$DPF_DIR\$f" }
                Write-OK "Cloned fork with upstream remote configured"

            } else {
                $InstallMode = "private"
                Write-Action "Cloning project source..."
                $stash = @{}
                foreach ($f in '.install-progress','.env') {
                    if (Test-Path "$DPF_DIR\$f") {
                        $stash[$f] = Get-Content "$DPF_DIR\$f" -Raw
                        Remove-Item "$DPF_DIR\$f"
                    }
                }
                if ((Test-Path $DPF_DIR) -and
                    @(Get-ChildItem $DPF_DIR -Force -ErrorAction SilentlyContinue).Count -eq 0) {
                    Remove-Item $DPF_DIR
                }

                $oldEAP = $ErrorActionPreference
                $ErrorActionPreference = "Continue"
                git clone "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git" "$DPF_DIR" 2>&1
                $ErrorActionPreference = $oldEAP
                if ($LASTEXITCODE -ne 0) {
                    Write-Warn "Clone failed. Check your internet connection."
                    exit 1
                }
                git -C "$DPF_DIR" remote rename origin upstream 2>$null
                foreach ($f in $stash.Keys) { $stash[$f] | Set-Content "$DPF_DIR\$f" }
                Write-OK "Cloned source (upstream remote is read-only reference)"
            }

            # Convenience scripts for customizer mode
            Copy-Item "$DPF_DIR\scripts\dpf-start.ps1" "$DPF_DIR\dpf-start.ps1" -ErrorAction SilentlyContinue
            Copy-Item "$DPF_DIR\scripts\dpf-stop.ps1" "$DPF_DIR\dpf-stop.ps1" -ErrorAction SilentlyContinue
            Copy-Item "$DPF_DIR\scripts\dpf-start.bat" "$DPF_DIR\dpf-start.bat" -ErrorAction SilentlyContinue
            Copy-Item "$DPF_DIR\scripts\dpf-stop.bat" "$DPF_DIR\dpf-stop.bat" -ErrorAction SilentlyContinue

        } else {
            # --- Consumer path ---
            $InstallMode = "consumer"
            Write-Action "Setting up pre-built platform..."

            if (-not (Test-Path $DPF_DIR)) {
                New-Item -ItemType Directory -Path $DPF_DIR -Force | Out-Null
            }

            # Write embedded docker-compose.yml
            @"
# Generated by DPF installer (consumer mode) -- do not edit manually
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: `${POSTGRES_USER:-dpf}
      POSTGRES_PASSWORD: `${POSTGRES_PASSWORD}
      POSTGRES_DB: dpf
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U `${POSTGRES_USER:-dpf}"]
      interval: 5s
      timeout: 5s
      retries: 5

  neo4j:
    image: neo4j:5-community
    restart: unless-stopped
    environment:
      NEO4J_AUTH: `${NEO4J_AUTH}
      NEO4J_PLUGINS: '["apoc"]'
    volumes:
      - neo4jdata:/data
    healthcheck:
      test: ["CMD-SHELL", "wget -qO /dev/null http://localhost:7474 || exit 1"]
      interval: 10s
      timeout: 10s
      retries: 5
      start_period: 30s

  qdrant:
    image: qdrant/qdrant:latest
    restart: unless-stopped
    volumes:
      - qdrant_data:/qdrant/storage
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/readyz"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s

  portal-init:
    image: $($GHCR_PORTAL):$Version
    command: ["/docker-entrypoint.sh"]
    environment:
      DATABASE_URL: postgresql://`${POSTGRES_USER:-dpf}:`${POSTGRES_PASSWORD}@postgres:5432/dpf
      DPF_HOST_PROFILE: `${DPF_HOST_PROFILE:-}
      ADMIN_PASSWORD: `${ADMIN_PASSWORD}
    depends_on:
      postgres:
        condition: service_healthy

  portal:
    image: $($GHCR_PORTAL):$Version
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://`${POSTGRES_USER:-dpf}:`${POSTGRES_PASSWORD}@postgres:5432/dpf
      AUTH_SECRET: `${AUTH_SECRET}
      CREDENTIAL_ENCRYPTION_KEY: `${CREDENTIAL_ENCRYPTION_KEY}
      NEO4J_URI: bolt://neo4j:7687
      NEO4J_USER: neo4j
      NEO4J_PASSWORD: `${NEO4J_PASSWORD}
      QDRANT_INTERNAL_URL: http://qdrant:6333
      LLM_BASE_URL: `${LLM_BASE_URL:-http://model-runner.docker.internal/v1}
    depends_on:
      portal-init:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  sandbox-image:
    image: $($GHCR_SANDBOX):$Version
    container_name: dpf-sandbox-dev
    profiles: ["build-images"]
    command: ["echo", "Image ready"]

  playwright:
    image: mcr.microsoft.com/playwright:v1.52.0-noble
    volumes:
      - playwright_scripts:/scripts
      - playwright_results:/results
    network_mode: host
    profiles: ["build-images"]
    command: ["sleep", "infinity"]

volumes:
  pgdata:
  neo4jdata:
  qdrant_data:
  playwright_scripts:
  playwright_results:
"@ | Set-Content "$DPF_DIR\docker-compose.yml" -Encoding UTF8

            # Write dpf-start.ps1 for consumer (no .git dependency)
            @'
param([switch]$NoBrowser)
Set-Location $PSScriptRoot
docker compose up -d
if (-not $NoBrowser) {
    Start-Sleep -Seconds 5
    Start-Process "http://localhost:3000"
    Write-Host "Digital Product Factory is starting at http://localhost:3000" -ForegroundColor Green
}
'@ | Set-Content "$DPF_DIR\dpf-start.ps1" -Encoding UTF8

            @'
Set-Location $PSScriptRoot
docker compose down
Write-Host "Digital Product Factory stopped." -ForegroundColor Yellow
'@ | Set-Content "$DPF_DIR\dpf-stop.ps1" -Encoding UTF8

            Write-OK "Platform files written to $DPF_DIR"
        }

        # Save install mode
        $InstallMode | Set-Content "$DPF_DIR\.install-mode"

        # Add install directory to user PATH if not already there
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($userPath -notlike "*$DPF_DIR*") {
            [Environment]::SetEnvironmentVariable("Path", "$userPath;$DPF_DIR", "User")
            $env:Path += ";$DPF_DIR"
        }

        Save-Progress "download"
    }
} else {
    # Resume: read saved mode
    if (Test-Path "$DPF_DIR\.install-mode") {
        $InstallMode = (Get-Content "$DPF_DIR\.install-mode").Trim()
    } elseif (Test-Path "$DPF_DIR\.git") {
        $InstallMode = "customizer"
    } else {
        $InstallMode = "consumer"
    }
    Write-OK "Already set up ($InstallMode mode)"
}
```

- [ ] **Step 4: Update Step 5 (.env generation) to include NEO4J_PASSWORD**

In the `.env` generation block, update the heredoc to include `NEO4J_PASSWORD`:

```powershell
    $neoPass = Generate-RandomPassword 16

    @"
# Generated by DPF installer -- do not edit manually
POSTGRES_USER=dpf
POSTGRES_PASSWORD=$pgPass
DATABASE_URL=postgresql://dpf:$pgPass@postgres:5432/dpf
NEO4J_AUTH=neo4j/$neoPass
NEO4J_PASSWORD=$neoPass
AUTH_SECRET=$authSecret
CREDENTIAL_ENCRYPTION_KEY=$encKey
NEO4J_URI=bolt://neo4j:7687
ADMIN_PASSWORD=$adminPass
DPF_HOST_PROFILE=$hostProfileJson
LLM_BASE_URL=http://model-runner.docker.internal/v1
"@ | Set-Content "$DPF_DIR\.env"
```

- [ ] **Step 5: Update Step 6 to branch on install mode**

Replace the build + start block:

```powershell
Write-Step 6 9 "Starting the platform..."
if (-not (Is-StepDone "started")) {
    Set-Location $DPF_DIR

    if ($InstallMode -eq "consumer") {
        Write-Action "Pulling pre-built images (this may take a few minutes)..."
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        docker compose pull 2>&1
        $pullExit = $LASTEXITCODE
        $ErrorActionPreference = $oldEAP
        if ($pullExit -ne 0) {
            Write-Warn "Failed to pull images. Check your internet connection."
            Write-Warn "You can retry with: docker compose pull"
            exit 1
        }
    } else {
        Write-Action "Building the portal (first time takes 3-5 minutes)..."
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        docker compose build --quiet 2>&1 | Out-Null
        $buildExit = $LASTEXITCODE
        $ErrorActionPreference = $oldEAP
        if ($buildExit -ne 0) {
            $ErrorActionPreference = "Continue"
            docker compose build
            $buildExit = $LASTEXITCODE
            $ErrorActionPreference = "Stop"
            if ($buildExit -ne 0) {
                Write-Warn "Build failed. Check the output above for errors."
                exit 1
            }
        }
    }

    Write-Action "Starting database and portal..."
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    docker compose up -d
    $ErrorActionPreference = $oldEAP

    # Wait for portal health
    Write-Action "Waiting for the portal to be ready..."
    $attempts = 0
    $maxAttempts = 60  # 5 minutes
    while ($attempts -lt $maxAttempts) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) { break }
        } catch {}
        Start-Sleep -Seconds 5
        $attempts++
    }

    if ($attempts -ge $maxAttempts) {
        Write-Warn "Portal didn't become healthy after 5 minutes."
        Write-Warn "Run 'docker compose logs portal' in $DPF_DIR to see what happened."
        exit 1
    }

    Write-OK "All services healthy"
    Save-Progress "started"
} else {
    Write-OK "Already running"
}
```

- [ ] **Step 6: Remove git pre-flight check from top of script**

The pre-flight git check (around lines 117-122) should only run for customizer mode. Since we don't know the mode yet at that point, remove it from the top and handle it inside Step 4's customizer branch (already included in Step 3 above).

- [ ] **Step 7: Test consumer mode end-to-end**

This requires the images to be published to GHCR first (Task 2). For local testing before publishing, temporarily tag the local build:

```powershell
docker tag opendigitalproductfactory-portal:latest ghcr.io/OpenDigitalProductFactory/dpf-portal:latest
docker tag dpf-sandbox:latest ghcr.io/OpenDigitalProductFactory/dpf-sandbox:latest
```

Then run the installer in a clean temp directory:

```powershell
$testDir = "$env:TEMP\dpf-test-consumer"
Remove-Item $testDir -Recurse -ErrorAction SilentlyContinue
.\install-dpf.ps1 -InstallDir $testDir
# Choose option [1] when prompted
```

Verify: no git clone, compose file written, images pulled, portal healthy on :3000.

- [ ] **Step 8: Commit**

```bash
git add install-dpf.ps1
git commit -m "feat(install): add consumer/customizer mode choice

Consumer mode writes embedded docker-compose.yml pointing to GHCR
images. No git, no source, no build. Customizer mode clones source
(from fork for contributors, upstream for private). Docker Desktop
version check warns if < 4.40 (Model Runner requirement).
NEO4J_PASSWORD added to .env for portal credential sync."
```

---

### Task 4: Log the future epic for mode switching

**Files:**
- None (database operation)

- [ ] **Step 1: Insert the epic via psql**

```sql
INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'EP-INSTALL-SWITCH-001',
  'Allow switching between Consumer and Customizer install modes',
  'Post-install mode switching: consumer→customizer (clone source, rebuild, preserve DB volumes) and customizer→consumer (switch to pre-built images, preserve DB). Compose project name must stay the same to preserve volume associations. Requires docker compose down + up (brief downtime).',
  'open', NOW(), NOW())
ON CONFLICT ("epicId") DO NOTHING;
```

- [ ] **Step 2: Update EP-PROD-BUILD-001 backlog items to done**

```sql
UPDATE "BacklogItem" SET status = 'done', "completedAt" = NOW()
WHERE "itemId" IN ('BI-PROD-BUILD-003', 'BI-PROD-BUILD-004', 'BI-PROD-BUILD-005');
```

- [ ] **Step 3: Commit the plan document**

```bash
git add docs/superpowers/plans/2026-03-22-production-install.md
git commit -m "docs: implementation plan for production install modes"
```

---

## Execution Order

Tasks 1-3 can be done sequentially. Task 1 (Dockerfile) must complete before Task 2 (CI workflow) can be fully tested. Task 3 (install script) can proceed in parallel with Task 2 but needs images in GHCR for end-to-end consumer testing. Task 4 is a cleanup step done last.

**Critical path:** Task 1 → Task 3 → local test → Task 2 → tag + push → end-to-end test → Task 4.
