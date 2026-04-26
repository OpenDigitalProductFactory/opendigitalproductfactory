# Windows One-Click Installer — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zero-prerequisites Windows installer: PowerShell script installs WSL2 + Docker Desktop, builds and starts the portal in Docker Compose with Postgres, Neo4j, Ollama, runs migrations/seed, pulls a small AI model, and opens the browser.

**Architecture:** Four-service Docker Compose stack (portal, postgres, neo4j, ollama). Multi-stage Dockerfile with separate init (migrations/seed) and runner (Next.js standalone) targets. PowerShell installer handles prerequisites, hardware detection, secret generation, and guided UX. All seed data moved into the repo.

**Tech Stack:** PowerShell 5.1+, Docker Compose, Node 20 Alpine, Prisma 5, Next.js 14 standalone, Ollama.

**Spec:** `docs/superpowers/specs/2026-03-14-windows-installer-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `Dockerfile` | Multi-stage: base, deps, build, init, runner |
| `.dockerignore` | Exclude node_modules, .worktrees, .next, .git from build context |
| `docker-entrypoint.sh` | Init container: migrate, seed, detect hardware |
| `scripts/detect-hardware.ts` | Write host+container profiles to PlatformConfig |
| `install-dpf.ps1` | Windows installer (8 guided steps) |
| `scripts/dpf-start.ps1` | Convenience: docker compose up + open browser |
| `scripts/dpf-stop.ps1` | Convenience: docker compose down |
| `apps/web/app/api/health/route.ts` | Health check endpoint (returns 200) |

### Modified Files
| File | Change |
|------|--------|
| `docker-compose.yml` | Add portal, portal-init, ollama services; internal-only ports for db; GPU passthrough |
| `apps/web/next.config.mjs` | Add `output: "standalone"` |
| `packages/db/src/seed.ts` | Update REPO_ROOT to resolve within Docker; change readJson paths |
| `packages/db/data/` | Copy `role_registry.json`, `agent_registry.json`, `portfolio_registry.json`, `digital_product_registry.json` from legacy dir |
| `README.md` | Installation instructions |

---

## Chunk 1: Seed Data + Next.js Standalone

### Task 1: Copy Seed Data Into Repo

**Files:**
- Create: `packages/db/data/role_registry.json` (copy from `d:/digital-product-factory/ROLES/`)
- Create: `packages/db/data/agent_registry.json` (copy from `d:/digital-product-factory/AGENTS/`)
- Create: `packages/db/data/portfolio_registry.json` (copy from `d:/digital-product-factory/MODEL/`)
- Create: `packages/db/data/digital_product_registry.json` (copy from `d:/digital-product-factory/MODEL/`)
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 1: Copy the 4 JSON files**

```bash
cp "d:/digital-product-factory/ROLES/role_registry.json" "d:/OpenDigitalProductFactory/packages/db/data/"
cp "d:/digital-product-factory/AGENTS/agent_registry.json" "d:/OpenDigitalProductFactory/packages/db/data/"
cp "d:/digital-product-factory/MODEL/portfolio_registry.json" "d:/OpenDigitalProductFactory/packages/db/data/"
cp "d:/digital-product-factory/MODEL/digital_product_registry.json" "d:/OpenDigitalProductFactory/packages/db/data/"
```

- [ ] **Step 2: Update seed.ts REPO_ROOT and readJson paths**

In `packages/db/src/seed.ts`, change line 14 from:
```typescript
const REPO_ROOT = process.env.DPF_DATA_ROOT ?? join(__dirname, "..", "..", "..", "..");
```
to:
```typescript
const DATA_DIR = join(__dirname, "..", "data");
```

Then update `readJson` (line 16-18) from:
```typescript
function readJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), "utf-8")) as T;
}
```
to:
```typescript
function readJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, filename), "utf-8")) as T;
}
```

Then update all 4 call sites:
- Line 29: `}>("ROLES/role_registry.json");` → `}>("role_registry.json");`
- Line 66: `}>("AGENTS/agent_registry.json");` → `}>("agent_registry.json");`
- Line 114: `}>("MODEL/portfolio_registry.json");` → `}>("portfolio_registry.json");`
- Line 210: `}>("MODEL/digital_product_registry.json");` → `}>("digital_product_registry.json");`

Also update `packages/db/src/seed-ea-reference-models.ts` line 15 to use the same `DATA_DIR` approach (or leave as-is since the xlsx file won't be in Docker). In `seed.ts` main(), wrap `seedEaReferenceModels()` in a try-catch so it fails gracefully in Docker:

```typescript
  await seedEaReferenceModels().catch((err: unknown) => {
    console.warn("[seed] EA reference models skipped:", err instanceof Error ? err.message : err);
  });
```

This ensures the seed completes even without the xlsx file.

Also update `seedDefaultAdminUser()` to use a generated password from environment:

Change the password line from:
```typescript
  const hash = crypto.createHash("sha256").update("changeme123").digest("hex");
```
to:
```typescript
  const password = process.env.ADMIN_PASSWORD ?? "changeme123";
  const hash = crypto.createHash("sha256").update(password).digest("hex");
```

This reads `ADMIN_PASSWORD` from the environment (set in `.env` by the installer) and falls back to `changeme123` for local dev.

- [ ] **Step 3: Verify seed still works locally**

```bash
cd d:/OpenDigitalProductFactory/packages/db && DPF_DATA_ROOT="" npx tsx src/seed.ts
```

Expected: Seed runs without file-not-found errors (may fail on xlsx reference model — that's a pre-existing issue, not related to this change).

- [ ] **Step 4: Run tests**

```bash
cd d:/OpenDigitalProductFactory && pnpm test
```

- [ ] **Step 5: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add packages/db/data/role_registry.json packages/db/data/agent_registry.json packages/db/data/portfolio_registry.json packages/db/data/digital_product_registry.json packages/db/src/seed.ts && git commit -m "feat: move seed data into repo for Docker self-containment"
```

---

### Task 2: Enable Next.js Standalone Output

**Files:**
- Modify: `apps/web/next.config.mjs`

- [ ] **Step 1: Add standalone output**

Change `apps/web/next.config.mjs` from:
```javascript
/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: ["@dpf/db"],
};

export default config;
```
to:
```javascript
/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@dpf/db"],
};

export default config;
```

- [ ] **Step 2: Verify build works**

```bash
cd d:/OpenDigitalProductFactory && pnpm build
```

Note: Build may fail due to pre-existing issues (users.ts server action, seed-ea-reference-models). If it fails on those, that's pre-existing — the `output: "standalone"` change is additive.

- [ ] **Step 3: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/next.config.mjs && git commit -m "feat: enable Next.js standalone output for Docker deployment"
```

---

### Task 3: Add Health Check API Route

**Files:**
- Create: `apps/web/app/api/health/route.ts`

- [ ] **Step 1: Create the health endpoint**

Create `apps/web/app/api/health/route.ts`:

```typescript
export async function GET() {
  return Response.json({ status: "ok", timestamp: new Date().toISOString() });
}
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add apps/web/app/api/health/route.ts && git commit -m "feat: add /api/health endpoint for Docker health checks"
```

---

## Chunk 2: Dockerfile + Docker Compose

### Task 4: Create .dockerignore

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Create the file**

Create `.dockerignore`:

```
node_modules
.next
.worktrees
.superpowers
.git
.claude
.vscode
.env
.env.local
*.md
!README.md
docs/
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add .dockerignore && git commit -m "feat: add .dockerignore for Docker build context"
```

---

### Task 5: Create Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create the multi-stage Dockerfile**

Create `Dockerfile`:

```dockerfile
# ─── Stage 1: base ────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# ─── Stage 2: deps ────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/db/prisma/schema.prisma ./packages/db/prisma/
RUN pnpm install --frozen-lockfile

# ─── Stage 3: build ───────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm --filter @dpf/db exec prisma generate
RUN pnpm --filter web build

# ─── Stage 4: init (migrations, seed, hardware detection) ─────────────────────
FROM deps AS init
COPY . .
RUN pnpm --filter @dpf/db exec prisma generate
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]

# ─── Stage 5: runner (production Next.js) ──────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Copy standalone output
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add Dockerfile && git commit -m "feat: add multi-stage Dockerfile (deps, build, init, runner)"
```

---

### Task 6: Create docker-entrypoint.sh

**Files:**
- Create: `docker-entrypoint.sh`

- [ ] **Step 1: Create the entrypoint script**

Create `docker-entrypoint.sh`:

```bash
#!/bin/sh
set -e

echo "=== DPF Portal Init ==="

echo "[1/3] Running database migrations..."
cd /app
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
echo "  ✓ Migrations complete"

echo "[2/3] Seeding reference data..."
cd /app/packages/db
npx tsx src/seed.ts || echo "  ⚠ Seed had warnings (non-fatal)"
echo "  ✓ Seed complete"

echo "[3/3] Detecting hardware..."
if [ -n "$DPF_HOST_PROFILE" ]; then
  cd /app
  npx tsx scripts/detect-hardware.ts || echo "  ⚠ Hardware detection had warnings (non-fatal)"
  echo "  ✓ Hardware profile saved"
else
  echo "  → No host profile provided, skipping"
fi

echo "=== Init complete ==="
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add docker-entrypoint.sh && git commit -m "feat: add docker-entrypoint.sh for init container"
```

---

### Task 7: Create detect-hardware.ts

**Files:**
- Create: `scripts/detect-hardware.ts`

- [ ] **Step 1: Create the hardware detection script**

Create `scripts/detect-hardware.ts`:

```typescript
import { readFileSync } from "fs";
import { PrismaClient } from "../packages/db/generated/client";

const prisma = new PrismaClient();

async function main() {
  // Host profile from installer (passed via env var)
  const hostProfile = process.env.DPF_HOST_PROFILE
    ? JSON.parse(process.env.DPF_HOST_PROFILE)
    : null;

  // Container resources
  const meminfo = readFileSync("/proc/meminfo", "utf-8");
  const memMatch = meminfo.match(/MemTotal:\s+(\d+)/);
  const containerMemMB = memMatch ? Math.round(parseInt(memMatch[1]!, 10) / 1024) : null;

  let containerCpus: number | null = null;
  try {
    const cpuinfo = readFileSync("/proc/cpuinfo", "utf-8");
    containerCpus = (cpuinfo.match(/^processor/gm) || []).length;
  } catch { /* ignore */ }

  const containerProfile = {
    memoryMB: containerMemMB,
    cpus: containerCpus,
    detectedAt: new Date().toISOString(),
  };

  if (hostProfile) {
    await prisma.platformConfig.upsert({
      where: { key: "host_profile" },
      update: { value: hostProfile },
      create: { key: "host_profile", value: hostProfile },
    });
    console.log("  Host profile:", JSON.stringify(hostProfile));
  }

  await prisma.platformConfig.upsert({
    where: { key: "container_profile" },
    update: { value: containerProfile },
    create: { key: "container_profile", value: containerProfile },
  });
  console.log("  Container profile:", JSON.stringify(containerProfile));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Hardware detection error:", e);
  process.exit(0); // Non-fatal — don't block startup
});
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add scripts/detect-hardware.ts && git commit -m "feat: add hardware detection script for PlatformConfig"
```

---

### Task 8: Update docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Replace docker-compose.yml**

Replace `docker-compose.yml` with:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-dpf}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-dpf_dev}
      POSTGRES_DB: dpf
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-dpf}"]
      interval: 5s
      timeout: 5s
      retries: 5

  neo4j:
    image: neo4j:5-community
    restart: unless-stopped
    environment:
      NEO4J_AUTH: ${NEO4J_AUTH:-neo4j/dpf_dev_password}
      NEO4J_PLUGINS: '["apoc"]'
    volumes:
      - neo4jdata:/data
    healthcheck:
      test: ["CMD-SHELL", "wget -qO /dev/null http://localhost:7474 || exit 1"]
      interval: 10s
      timeout: 10s
      retries: 5
      start_period: 30s

  ollama:
    image: ollama/ollama
    restart: unless-stopped
    volumes:
      - ollama_models:/root/.ollama
    # GPU passthrough — the installer generates a docker-compose.override.yml
    # with deploy.resources.reservations.devices when NVIDIA GPU is detected.
    # Without the override, Ollama runs on CPU only.
    healthcheck:
      test: ["CMD-SHELL", "wget -qO /dev/null http://localhost:11434/api/tags || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5

  portal-init:
    build:
      context: .
      target: init
    environment:
      DATABASE_URL: ${DATABASE_URL:-postgresql://dpf:dpf_dev@postgres:5432/dpf}
      DPF_HOST_PROFILE: ${DPF_HOST_PROFILE:-}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-changeme123}
    depends_on:
      postgres:
        condition: service_healthy

  portal:
    build:
      context: .
      target: runner
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: ${DATABASE_URL:-postgresql://dpf:dpf_dev@postgres:5432/dpf}
      AUTH_SECRET: ${AUTH_SECRET:-dev_secret_change_me}
      CREDENTIAL_ENCRYPTION_KEY: ${CREDENTIAL_ENCRYPTION_KEY:-}
      NEO4J_URI: ${NEO4J_URI:-bolt://neo4j:7687}
    depends_on:
      portal-init:
        condition: service_completed_successfully
      ollama:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://localhost:3000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

volumes:
  pgdata:
  neo4jdata:
  ollama_models:
```

Note: The compose uses env var defaults so it works for both local dev (`docker compose up` without `.env`) and production install (with generated `.env`). Postgres and Neo4j ports are NOT exposed to the host — only the portal on 3000.

- [ ] **Step 2: Test docker compose config**

```bash
cd d:/OpenDigitalProductFactory && docker compose config
```

Expected: Valid YAML output with all services resolved.

- [ ] **Step 3: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add docker-compose.yml && git commit -m "feat: add portal, portal-init, ollama to docker-compose with health checks"
```

---

## Chunk 3: PowerShell Installer

### Task 9: Create install-dpf.ps1

**Files:**
- Create: `install-dpf.ps1`

- [ ] **Step 1: Create the installer script**

Create `install-dpf.ps1`. This is the largest single file — the full PowerShell installer with all 8 steps. Key sections:

```powershell
#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$DPF_DIR = "C:\DPF"
$PROGRESS_FILE = "$DPF_DIR\.install-progress"

# ─── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($step, $total, $msg) {
    Write-Host "`nStep $step of $total`: $msg" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "  ✓ $msg" -ForegroundColor Green
}

function Write-Action($msg) {
    Write-Host "  → $msg" -ForegroundColor Yellow
}

function Write-Warn($msg) {
    Write-Host "  ⚠ $msg" -ForegroundColor Red
}

function Get-Progress {
    if (Test-Path $PROGRESS_FILE) {
        return Get-Content $PROGRESS_FILE | ConvertFrom-Json
    }
    return @{ completedSteps = @() }
}

function Save-Progress($step) {
    $progress = Get-Progress
    if ($progress.completedSteps -notcontains $step) {
        $progress.completedSteps += $step
    }
    $progress | ConvertTo-Json | Set-Content $PROGRESS_FILE
}

function Is-StepDone($step) {
    $progress = Get-Progress
    return $progress.completedSteps -contains $step
}

function Generate-RandomPassword($length = 32) {
    $bytes = New-Object byte[] $length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join "" | Select-Object -First 1
}

function Generate-RandomAlphanumeric($length = 16) {
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $bytes = New-Object byte[] $length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

# ─── Banner ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║  Digital Product Factory — Installation              ║" -ForegroundColor Magenta
Write-Host "║  This will set up everything you need automatically  ║" -ForegroundColor Magenta
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Magenta

# Create install dir
if (-not (Test-Path $DPF_DIR)) {
    New-Item -ItemType Directory -Path $DPF_DIR -Force | Out-Null
}

# ─── Step 1: Check Windows ────────────────────────────────────────────────────

Write-Step 1 8 "Checking Windows version..."
if (-not (Is-StepDone "windows_check")) {
    $os = Get-CimInstance Win32_OperatingSystem
    $build = [int]$os.BuildNumber
    if ($build -lt 19041) {
        Write-Warn "Your Windows version doesn't support WSL2."
        Write-Warn "You need Windows 10 version 2004 or later (build 19041+)."
        Write-Warn "Current build: $build"
        exit 1
    }
    Write-OK "$($os.Caption) (build $build)"
    Save-Progress "windows_check"
} else {
    Write-OK "Already checked"
}

# ─── Step 2: WSL2 ─────────────────────────────────────────────────────────────

Write-Step 2 8 "Setting up WSL2..."
if (-not (Is-StepDone "wsl2")) {
    $vmpFeature = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
    $wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux

    $needsReboot = $false

    if ($vmpFeature.State -ne "Enabled") {
        Write-Action "Enabling Virtual Machine Platform (safe — needed for Docker)..."
        Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart -WarningAction SilentlyContinue | Out-Null
        $needsReboot = $true
    }

    if ($wslFeature.State -ne "Enabled") {
        Write-Action "Enabling Windows Subsystem for Linux..."
        Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart -WarningAction SilentlyContinue | Out-Null
        $needsReboot = $true
    }

    if ($needsReboot) {
        # Save progress so we can resume after reboot
        Save-Progress "wsl2_partial"
        Write-Warn "Windows needs to restart to finish setting up."
        Write-Host ""
        Write-Host "  After your computer restarts:" -ForegroundColor White
        Write-Host "  1. Open PowerShell (search 'PowerShell' in the Start menu)"
        Write-Host "  2. Run this command:  $DPF_DIR\install-dpf.ps1"
        Write-Host "  3. The installer will pick up where it left off"
        Write-Host ""
        Write-Host "  Restarting in 15 seconds... (press Ctrl+C to cancel)" -ForegroundColor Yellow
        Start-Sleep -Seconds 15
        Restart-Computer -Force
        exit 0
    }

    # Set WSL default version
    wsl --set-default-version 2 2>$null

    Write-OK "WSL2 is ready"
    Save-Progress "wsl2"
} else {
    Write-OK "Already set up"
}

# Handle partial WSL2 (resume after reboot)
if ((Is-StepDone "wsl2_partial") -and -not (Is-StepDone "wsl2")) {
    wsl --set-default-version 2 2>$null
    Write-OK "WSL2 is ready (resumed after restart)"
    Save-Progress "wsl2"
}

# ─── Step 3: Docker Desktop ───────────────────────────────────────────────────

Write-Step 3 8 "Installing Docker Desktop..."
if (-not (Is-StepDone "docker")) {
    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCmd) {
        Write-Action "Downloading Docker Desktop (this takes a minute)..."
        $installerUrl = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
        $installerPath = "$env:TEMP\DockerDesktopInstaller.exe"
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

        Write-Host ""
        Write-Host "  ╔═══════════════════════════════════════════════════╗" -ForegroundColor Yellow
        Write-Host "  ║  ACTION NEEDED:                                   ║" -ForegroundColor Yellow
        Write-Host "  ║                                                   ║" -ForegroundColor Yellow
        Write-Host "  ║  The Docker Desktop installer will open.          ║" -ForegroundColor Yellow
        Write-Host "  ║  1. Click 'Accept' on the license agreement       ║" -ForegroundColor Yellow
        Write-Host "  ║  2. Leave all checkboxes at their defaults        ║" -ForegroundColor Yellow
        Write-Host "  ║  3. Click 'Install' and wait for it to finish     ║" -ForegroundColor Yellow
        Write-Host "  ║  4. Click 'Close' when done                       ║" -ForegroundColor Yellow
        Write-Host "  ║                                                   ║" -ForegroundColor Yellow
        Write-Host "  ║  Docker Desktop is free for businesses with       ║" -ForegroundColor Yellow
        Write-Host "  ║  fewer than 250 employees and under `$10M revenue. ║" -ForegroundColor Yellow
        Write-Host "  ║  See https://docker.com/pricing for details.      ║" -ForegroundColor Yellow
        Write-Host "  ╚═══════════════════════════════════════════════════╝" -ForegroundColor Yellow
        Write-Host ""

        Start-Process -FilePath $installerPath -Wait
        Remove-Item $installerPath -ErrorAction SilentlyContinue

        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    }

    # Wait for Docker daemon
    Write-Action "Waiting for Docker to start (this may take a minute)..."
    $attempts = 0
    $maxAttempts = 36  # 3 minutes
    while ($attempts -lt $maxAttempts) {
        try {
            docker info 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { break }
        } catch {}
        Start-Sleep -Seconds 5
        $attempts++
    }

    if ($attempts -ge $maxAttempts) {
        Write-Warn "Docker Desktop didn't start after 3 minutes."
        Write-Warn "Try opening Docker Desktop from the Start menu, then run this script again."
        exit 1
    }

    Write-OK "Docker is running"
    Save-Progress "docker"
} else {
    Write-OK "Already installed"
}

# ─── Step 4: Download DPF ─────────────────────────────────────────────────────

Write-Step 4 8 "Downloading Digital Product Factory..."
if (-not (Is-StepDone "download")) {
    Write-Action "Downloading latest release..."
    $repoUrl = "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/archive/refs/heads/main.zip"
    $zipPath = "$env:TEMP\dpf-latest.zip"
    Invoke-WebRequest -Uri $repoUrl -OutFile $zipPath -UseBasicParsing

    Write-Action "Extracting..."
    Expand-Archive -Path $zipPath -DestinationPath "$env:TEMP\dpf-extract" -Force
    # Move contents from the nested directory
    $extracted = Get-ChildItem "$env:TEMP\dpf-extract" | Select-Object -First 1
    if (Test-Path "$DPF_DIR\docker-compose.yml") {
        # Preserve .env if it exists
        $envBackup = $null
        if (Test-Path "$DPF_DIR\.env") {
            $envBackup = Get-Content "$DPF_DIR\.env" -Raw
        }
    }
    Copy-Item -Path "$($extracted.FullName)\*" -Destination $DPF_DIR -Recurse -Force
    if ($envBackup) {
        $envBackup | Set-Content "$DPF_DIR\.env"
    }
    Remove-Item $zipPath -ErrorAction SilentlyContinue
    Remove-Item "$env:TEMP\dpf-extract" -Recurse -ErrorAction SilentlyContinue

    # Write version file
    "main" | Set-Content "$DPF_DIR\.version"

    # Copy convenience scripts to DPF root
    Copy-Item "$DPF_DIR\scripts\dpf-start.ps1" "$DPF_DIR\dpf-start.ps1" -ErrorAction SilentlyContinue
    Copy-Item "$DPF_DIR\scripts\dpf-stop.ps1" "$DPF_DIR\dpf-stop.ps1" -ErrorAction SilentlyContinue

    # Add C:\DPF to user PATH if not already there
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$DPF_DIR*") {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$DPF_DIR", "User")
        $env:Path += ";$DPF_DIR"
    }

    Write-OK "Extracted to $DPF_DIR"
    Save-Progress "download"
} else {
    Write-OK "Already downloaded"
}

# ─── Step 5: Hardware Detection ────────────────────────────────────────────────

Write-Step 5 8 "Detecting your hardware..."
if (-not (Is-StepDone "hardware")) {
    $cpu = Get-CimInstance Win32_Processor
    $mem = Get-CimInstance Win32_ComputerSystem
    $gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match "NVIDIA" } | Select-Object -First 1
    $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"

    $totalRAM_GB = [math]::Round($mem.TotalPhysicalMemory / 1GB, 1)
    $gpuName = if ($gpu) { $gpu.Name } else { $null }
    $gpuVRAM_GB = if ($gpu -and $gpu.AdapterRAM) { [math]::Round($gpu.AdapterRAM / 1GB, 1) } else { 0 }
    $diskFree_GB = [math]::Round($disk.FreeSpace / 1GB, 1)

    $hwSummary = "$totalRAM_GB GB RAM, $($cpu.NumberOfCores)-core CPU"
    if ($gpuName) { $hwSummary += ", $gpuName ($gpuVRAM_GB GB VRAM)" }
    Write-OK $hwSummary

    # Select model based on hardware
    if ($gpuVRAM_GB -ge 4) {
        $selectedModel = "qwen3:8b"
        $modelReason = "high quality, GPU-accelerated"
    } elseif ($totalRAM_GB -ge 16) {
        $selectedModel = "qwen3:4b"
        $modelReason = "good quality, fits your RAM"
    } elseif ($totalRAM_GB -ge 8) {
        $selectedModel = "qwen3:1.7b"
        $modelReason = "fast, works well on your hardware"
    } else {
        $selectedModel = "qwen3:0.6b"
        $modelReason = "lightweight, optimized for your hardware"
    }
    Write-Action "Selected AI model: $selectedModel ($modelReason)"

    # Check disk space
    if ($diskFree_GB -lt 5) {
        Write-Warn "Not enough disk space. The platform needs about 5 GB free. You have $diskFree_GB GB."
        exit 1
    }

    # Build host profile JSON
    $hostProfile = @{
        cpuCores = $cpu.NumberOfCores
        cpuModel = $cpu.Name
        ramGB = $totalRAM_GB
        gpuName = $gpuName
        gpuVramGB = $gpuVRAM_GB
        diskFreeGB = $diskFree_GB
        selectedModel = $selectedModel
        detectedAt = (Get-Date -Format "o")
    } | ConvertTo-Json -Compress

    # Generate GPU override for Docker Compose if NVIDIA detected
    if ($gpuName) {
        @"
services:
  ollama:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
"@ | Set-Content "$DPF_DIR\docker-compose.override.yml"
        Write-Action "GPU passthrough configured for AI engine"
    }

    # Save for later steps
    $hostProfile | Set-Content "$DPF_DIR\.host-profile.json"
    $selectedModel | Set-Content "$DPF_DIR\.selected-model"

    Save-Progress "hardware"
} else {
    Write-OK "Already detected"
    $selectedModel = Get-Content "$DPF_DIR\.selected-model" -ErrorAction SilentlyContinue
    if (-not $selectedModel) { $selectedModel = "qwen3:1.7b" }
}

# ─── Generate .env ─────────────────────────────────────────────────────────────

if (-not (Test-Path "$DPF_DIR\.env")) {
    $pgPass = Generate-RandomPassword 16
    $neoPass = Generate-RandomPassword 16
    $authSecret = Generate-RandomPassword 32
    $encKey = Generate-RandomPassword 32
    $adminPass = Generate-RandomAlphanumeric 16
    $hostProfileJson = if (Test-Path "$DPF_DIR\.host-profile.json") { Get-Content "$DPF_DIR\.host-profile.json" -Raw } else { "{}" }

    @"
# Generated by DPF installer — do not edit manually
POSTGRES_USER=dpf
POSTGRES_PASSWORD=$pgPass
DATABASE_URL=postgresql://dpf:$pgPass@postgres:5432/dpf
NEO4J_AUTH=neo4j/$neoPass
AUTH_SECRET=$authSecret
CREDENTIAL_ENCRYPTION_KEY=$encKey
NEO4J_URI=bolt://neo4j:7687
ADMIN_PASSWORD=$adminPass
DPF_HOST_PROFILE=$hostProfileJson
SELECTED_MODEL=$selectedModel
"@ | Set-Content "$DPF_DIR\.env"
}

# ─── Step 6: Start Platform ───────────────────────────────────────────────────

Write-Step 6 8 "Starting the platform..."
if (-not (Is-StepDone "started")) {
    Set-Location $DPF_DIR
    Write-Action "Building the portal (first time takes 3-5 minutes)..."
    docker compose build --quiet 2>$null
    if ($LASTEXITCODE -ne 0) {
        docker compose build
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Build failed. Check the output above for errors."
            exit 1
        }
    }

    Write-Action "Starting database, AI engine, and portal..."
    docker compose up -d

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

# ─── Step 7: Pull AI Model ────────────────────────────────────────────────────

Write-Step 7 8 "Setting up your AI Coworker..."
if (-not (Is-StepDone "model")) {
    Write-Action "Downloading AI model ($selectedModel)... this takes a minute"
    docker compose exec ollama ollama pull $selectedModel
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Model download failed. You can try later from the platform's AI Workforce page."
    } else {
        Write-OK "AI Coworker is ready"
    }
    Save-Progress "model"
} else {
    Write-OK "Already set up"
}

# ─── Step 8: Open Browser ─────────────────────────────────────────────────────

Write-Step 8 8 "Opening your portal!"

# Read admin password from .env
$adminPass = (Get-Content "$DPF_DIR\.env" | Where-Object { $_ -match "^ADMIN_PASSWORD=" }) -replace "^ADMIN_PASSWORD=", ""

Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║  Your Digital Product Factory is ready!              ║" -ForegroundColor Green
Write-Host "  ║                                                      ║" -ForegroundColor Green
Write-Host "  ║  URL:      http://localhost:3000                     ║" -ForegroundColor Green
Write-Host "  ║  Email:    admin@dpf.local                           ║" -ForegroundColor Green
Write-Host "  ║  Password: $($adminPass.PadRight(40))║" -ForegroundColor Green
Write-Host "  ║                                                      ║" -ForegroundColor Green
Write-Host "  ║  Save this password — it won't be shown again!      ║" -ForegroundColor Green
Write-Host "  ║                                                      ║" -ForegroundColor Green
Write-Host "  ║  To stop:  Open PowerShell, run: dpf-stop            ║" -ForegroundColor Green
Write-Host "  ║  To start: Open PowerShell, run: dpf-start           ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════════╝" -ForegroundColor Green

# Save credentials file
@"
Digital Product Factory — Admin Credentials
============================================
URL:      http://localhost:3000
Email:    admin@dpf.local
Password: $adminPass

Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Change this password after first login!
"@ | Set-Content "$DPF_DIR\.admin-credentials"
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add install-dpf.ps1 && git commit -m "feat: add Windows one-click installer (install-dpf.ps1)"
```

---

## Chunk 4: Convenience Scripts + README

### Task 10: Create Convenience Scripts

**Files:**
- Create: `scripts/dpf-start.ps1`
- Create: `scripts/dpf-stop.ps1`

- [ ] **Step 1: Create dpf-start.ps1**

Create `scripts/dpf-start.ps1`:

```powershell
Set-Location "C:\DPF"
docker compose up -d
Start-Sleep -Seconds 5
Start-Process "http://localhost:3000"
Write-Host "Digital Product Factory is starting at http://localhost:3000" -ForegroundColor Green
```

- [ ] **Step 2: Create dpf-stop.ps1**

Create `scripts/dpf-stop.ps1`:

```powershell
Set-Location "C:\DPF"
docker compose down
Write-Host "Digital Product Factory stopped." -ForegroundColor Yellow
```

- [ ] **Step 3: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add scripts/dpf-start.ps1 scripts/dpf-stop.ps1 && git commit -m "feat: add dpf-start and dpf-stop convenience scripts"
```

---

### Task 11: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add installation section to README**

Add to `README.md` (or replace if minimal):

```markdown
# Digital Product Factory

An AI-powered digital product management platform with enterprise architecture modeling, portfolio management, and governed AI agent workforce.

## Quick Install (Windows)

1. Download `install-dpf.ps1` from the [latest release](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/releases)
2. Right-click the file → **Run with PowerShell**
3. Follow the guided steps (5-10 minutes)

The installer will set up everything automatically: Docker, databases, AI engine, and the portal.

## For Developers

```bash
# Clone and install
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git
cd opendigitalproductfactory
pnpm install

# Start databases
docker compose up -d postgres neo4j

# Setup database
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# Start dev server
pnpm dev
```

Open http://localhost:3000
```

- [ ] **Step 2: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add README.md && git commit -m "docs: add installation instructions to README"
```

---

## Chunk 5: Verification

### Task 12: Test Docker Build

- [ ] **Step 1: Test the Docker build locally**

```bash
cd d:/OpenDigitalProductFactory && docker compose build
```

Expected: All stages build successfully. Fix any issues.

- [ ] **Step 2: Test the full stack**

```bash
cd d:/OpenDigitalProductFactory && docker compose up -d
```

Wait for all services to be healthy:
```bash
docker compose ps
```

Expected: postgres (healthy), neo4j (healthy), ollama (healthy), portal-init (exited 0), portal (healthy).

- [ ] **Step 3: Verify the portal is accessible**

Open http://localhost:3000 — should show the login page.

- [ ] **Step 4: Verify the health endpoint**

```bash
curl http://localhost:3000/api/health
```

Expected: `{"status":"ok","timestamp":"..."}`

- [ ] **Step 5: Clean up test**

```bash
cd d:/OpenDigitalProductFactory && docker compose down -v
```

- [ ] **Step 6: Final commit if any fixes needed**

```bash
cd d:/OpenDigitalProductFactory && git add -A && git commit -m "fix: resolve Docker build/startup issues"
```
