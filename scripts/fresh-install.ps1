# fresh-install.ps1  Fresh install of Open Digital Product Factory (Windows)
#
# Usage (run from the cloned project root):
#   .\scripts\fresh-install.ps1                        # uses current directory
#   .\scripts\fresh-install.ps1 -SkipDocker            # skip Docker services
#
# What this does:
#   1. Installs pnpm dependencies
#   2. Creates .env files with generated secrets
#   3. Starts Docker services (Postgres, Neo4j, Qdrant)
#   4. Runs migrations + seed + full DB restore

param(
    [switch]$SkipDocker
)

$ErrorActionPreference = "Stop"

function Write-Step($msg)  { Write-Host "`n $msg" -ForegroundColor Yellow }
function Write-Ok($msg)    { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "   $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  Open Digital Product Factory  Fresh Install (Windows)" -ForegroundColor Cyan
Write-Host "  ======================================================" -ForegroundColor Cyan

Write-Host "========================================================"

# Detect project root from the script's own location (scripts/ is one level down)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$InstallRoot = Split-Path -Parent $scriptDir

# Verify we're in a valid project directory
if (-not (Test-Path (Join-Path $InstallRoot "docker-compose.yml"))) {
    Write-Fail "Could not find docker-compose.yml in $InstallRoot. Run this script from the cloned project directory."
}

$InstallDrive = (Split-Path -Qualifier $InstallRoot).TrimEnd(':')

Write-Host ""
Write-Host "  Project root: $InstallRoot" -ForegroundColor Cyan
Write-Host ""

Write-Host "========================================================" 

Write-Step "Checking prerequisites"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Fail "Git is not installed. Download from https://git-scm.com/download/win"
}
Write-Ok "Git found: $(git --version)"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Fail "Node.js is not installed. Download from https://nodejs.org/ (v20+)"
}
$nodeVersion = (node -v).TrimStart('v').Split('.')[0]
if ([int]$nodeVersion -lt 20) {
    Write-Fail "Node.js v20+ required. Current: $(node -v)"
}
Write-Ok "Node.js found: $(node -v)"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Warn "pnpm not found. Installing..."
    npm install -g pnpm
}
Write-Ok "pnpm found: $(pnpm -v)"

Write-Host "========================================================" 

Write-Step "Installing project dependencies"
Set-Location $InstallRoot
pnpm install
if ($LASTEXITCODE -ne 0) {
    Write-Fail "pnpm install failed. Check the output above for errors."
}
Write-Ok "Dependencies installed"

Write-Step "Configuring in-repo git hooks (.githooks/)"
git -C $InstallRoot config core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Could not set core.hooksPath. Run 'git config core.hooksPath .githooks' manually."
} else {
    Write-Ok "Git hooks path set to .githooks (Prisma migration guard enabled)"
}

Write-Host "========================================================"

Write-Step "Creating .env file for Docker Compose"

$envFile = Join-Path $InstallRoot ".env"
if (-not (Test-Path $envFile)) {
    # Generate real secrets for Docker Compose
    $encKey = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Maximum 256) })
    $authBytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($authBytes)
    $authSecret = [Convert]::ToBase64String($authBytes)

    @"
# Docker Compose defaults -- created by fresh-install.ps1
POSTGRES_USER=dpf
POSTGRES_PASSWORD=dpf_dev
DATABASE_URL=postgresql://dpf:dpf_dev@postgres:5432/dpf
NEO4J_AUTH=neo4j/dpf_dev_password
AUTH_SECRET=$authSecret
CREDENTIAL_ENCRYPTION_KEY=$encKey
ADMIN_PASSWORD=changeme123
DPF_HOST_INSTALL_PATH=$InstallRoot
"@ | Set-Content -Path $envFile -Encoding UTF8
    Write-Ok "Created .env with generated secrets"
} else {
    Write-Ok ".env already exists -- skipping"
}

Write-Host "========================================================" 

Write-Step "Creating app-level .env files (Next.js + Prisma)"

$envExamplePath = Join-Path $InstallRoot ".env.example"
$webEnvPath     = Join-Path $InstallRoot "apps\web\.env.local"
$dbEnvPath      = Join-Path $InstallRoot "packages\db\.env"

if (Test-Path $envExamplePath) {
    if (-not (Test-Path $webEnvPath)) {
        Copy-Item $envExamplePath $webEnvPath
        # Generate real secrets (replace placeholders in .env.example copy)
        $content = Get-Content $webEnvPath -Raw
        # CREDENTIAL_ENCRYPTION_KEY — 32 random bytes as hex
        $encKey = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Maximum 256) })
        $content = $content -replace '<generate with: openssl rand -hex 32>', $encKey
        # AUTH_SECRET — 32 random bytes as base64
        $authBytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($authBytes)
        $authSecret = [Convert]::ToBase64String($authBytes)
        $content = $content -replace '<generate with: openssl rand -base64 32>', $authSecret
        $content | Set-Content $webEnvPath
        Write-Ok "Created apps/web/.env.local with generated secrets"
    } else {
        Write-Ok "apps/web/.env.local already exists  skipping"
    }

    if (-not (Test-Path $dbEnvPath)) {
        Copy-Item $envExamplePath $dbEnvPath
        Write-Ok "Created packages/db/.env from .env.example"
    } else {
        Write-Ok "packages/db/.env already exists  skipping"
    }
} else {
    Write-Warn ".env.example not found  skipping app-level .env creation"
}

$dockerDataDir = "${InstallDrive}:\docker-data\dpf"

if (-not $SkipDocker) {
    Write-Step "Starting Docker services (PostgreSQL, Neo4j, Qdrant)"

    # Tear down any existing containers and volumes from a previous install
    # so the database starts clean (required for onboarding to trigger).
    Write-Host "  Cleaning previous Docker state..."
    docker compose down -v 2>$null

    # Wipe bind-mount data directories so re-installs get a fresh database
    foreach ($subdir in @("pgdata", "neo4jdata", "qdrant_data")) {
        $path = Join-Path $dockerDataDir $subdir
        if (Test-Path $path) {
            Remove-Item -Recurse -Force $path 2>$null
        }
    }

    # Configure Docker volume location on the project's drive
    foreach ($dir in @(
        $dockerDataDir,
        (Join-Path $dockerDataDir "pgdata"),
        (Join-Path $dockerDataDir "neo4jdata"),
        (Join-Path $dockerDataDir "qdrant_data")
    )) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
    }

    # Docker Compose on Windows is safer with quoted forward-slash host paths.
    $dockerDataDirForCompose = $dockerDataDir.Replace('\', '/')

    # Create override: volumes on the project drive + ports exposed for local dev
    # Docker Model Runner handles GPU passthrough via Docker Desktop — no override needed.
    $overrideContent = @"
# Auto-generated by fresh-install.ps1 (developer mode)
# Stores Docker volumes on ${InstallDrive}: drive and exposes ports to the host
# so you can run Next.js locally (pnpm dev) and connect from your IDE.
services:
  postgres:
    ports:
      - "5432:5432"
    volumes:
      - "${dockerDataDirForCompose}/pgdata:/var/lib/postgresql/data"
  neo4j:
    ports:
      - "7687:7687"
      - "7474:7474"
    volumes:
      - "${dockerDataDirForCompose}/neo4jdata:/data"
  qdrant:
    ports:
      - "6333:6333"
    volumes:
      - "${dockerDataDirForCompose}/qdrant_data:/qdrant/storage"
  portal:
    environment:
      INSTANCE_TYPE: dev
"@
    $overridePath = Join-Path $InstallRoot "docker-compose.override.yml"
    $overrideContent | Set-Content -Path $overridePath -Encoding UTF8
    Write-Ok "Created docker-compose.override.yml (volumes on ${InstallDrive}:, ports exposed)"

    docker compose up -d
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "docker compose up failed. Check: docker compose logs"
    }

    Write-Host "  Building promoter image (for autonomous deployments)..."
    docker compose --profile promote build promoter 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Promoter image built"
    } else {
        Write-Warn "Promoter image build failed (non-fatal -- can be built later)"
    }

    Write-Host "  Waiting for PostgreSQL container to start..."
    $retries = 30
    $postgresId = $null
    while ($retries -gt 0) {
        $postgresId = (docker compose ps -q postgres 2>$null | Select-Object -First 1)
        if ($postgresId) {
            $running = (docker inspect -f "{{.State.Running}}" $postgresId 2>$null)
            if ($LASTEXITCODE -eq 0 -and "$running".Trim().ToLower() -eq "true") { break }
        }
        Start-Sleep -Seconds 2
        $retries--
    }

    if (-not $postgresId) {
        Write-Host ""
        docker compose ps -a postgres
        Write-Fail "PostgreSQL container was not created. Check: docker compose logs postgres"
    }

    $running = (docker inspect -f "{{.State.Running}}" $postgresId 2>$null)
    if ("$running".Trim().ToLower() -ne "true") {
        Write-Host ""
        docker compose ps -a postgres
        docker compose logs --tail 80 postgres
        Write-Fail "PostgreSQL container exited before it became ready. See logs above."
    }

    Write-Host "  Waiting for PostgreSQL readiness..."
    $retries = 30
    while ($retries -gt 0) {
        try {
            docker compose exec -T postgres pg_isready -U dpf 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { break }
        } catch {}
        Start-Sleep -Seconds 2
        $retries--
    }
    if ($retries -eq 0) {
        Write-Host ""
        docker compose ps -a postgres
        docker compose logs --tail 80 postgres
        Write-Fail "PostgreSQL did not become ready. See logs above."
    }
    Write-Ok "PostgreSQL is ready"

    Write-Host "  Waiting for Qdrant (vector database for agent memory)..."
    $retries = 15
    while ($retries -gt 0) {
        try {
            $qdrantReady = Invoke-WebRequest -Uri "http://localhost:6333/readyz" -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($qdrantReady.StatusCode -eq 200) { break }
        } catch {}
        Start-Sleep -Seconds 2
        $retries--
    }
    if ($retries -eq 0) { Write-Warn "Qdrant not ready yet  agent memory will initialize on first use." }
    else { Write-Ok "Qdrant is ready" }
}

Write-Host "========================================================" 
# All commands run from the project root using pnpm workspace filters, which
# ensures the correct binaries (prisma, tsx) are resolved from node_modules.

Write-Step "Running database migrations"
pnpm --filter @dpf/db exec prisma generate
if ($LASTEXITCODE -ne 0) { Write-Fail "Prisma generate failed" }

pnpm --filter @dpf/db exec prisma migrate deploy
if ($LASTEXITCODE -ne 0) { Write-Fail "Database migrations failed" }
Write-Ok "Migrations complete"

Write-Step "Seeding database"
pnpm --filter @dpf/db seed
if ($LASTEXITCODE -ne 0) { Write-Fail "Database seed failed" }
Write-Ok "Base seed complete"

Write-Host "========================================================" 

Write-Host ""
Write-Host "   Fresh install complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Project location: $InstallRoot" -ForegroundColor Cyan
Write-Host "  Docker volumes:   $dockerDataDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Start the app:    cd $InstallRoot && pnpm --filter web dev"
Write-Host "  Open:             http://localhost:3000"
Write-Host ""
Write-Host "  Default login:"
Write-Host "    Email:    admin@dpf.local"
Write-Host "    Password: changeme123"
Write-Host ""
Write-Host "  Change the password before any non-local deployment." -ForegroundColor Yellow
Write-Host ""
