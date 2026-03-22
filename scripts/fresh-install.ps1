Write-Host "========================================================" 
# fresh-install.ps1  Fresh install of Open Digital Product Factory (Windows)
#
# Usage:
#   .\scripts\fresh-install.ps1                        # defaults to current drive
#   .\scripts\fresh-install.ps1 -InstallDrive H        # install to H: drive
#   .\scripts\fresh-install.ps1 -InstallDrive H -SkipDocker  # skip Docker services
#
# What this does:
#   1. Clones the repo to <drive>:\OpenDigitalProductFactory
#   2. Installs pnpm dependencies
#   3. Creates .env files
#   4. Starts Docker services (Postgres, Neo4j, Qdrant)
#   5. Runs migrations + seed + full DB restore
Write-Host "========================================================" 

param(
    [string]$InstallDrive = "",
    [switch]$SkipDocker,
    [string]$RepoUrl = "https://github.com/markdbodman/opendigitalproductfactory.git"
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

if (-not $InstallDrive) {
    $drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 10GB } | Sort-Object Free -Descending
    Write-Host ""
    Write-Host "  Available drives (>10GB free):" -ForegroundColor Cyan
    foreach ($d in $drives) {
        $freeGB = [math]::Round($d.Free / 1GB, 1)
        $totalGB = [math]::Round(($d.Used + $d.Free) / 1GB, 1)
        Write-Host "    $($d.Name):  $freeGB GB free / $totalGB GB total"
    }
    Write-Host ""
    $InstallDrive = Read-Host "  Choose drive letter (e.g., H)"
}

$InstallDrive = $InstallDrive.TrimEnd(':').ToUpper()
$InstallRoot = "${InstallDrive}:\OpenDigitalProductFactory"

if (-not (Test-Path "${InstallDrive}:\")) {
    Write-Fail "Drive ${InstallDrive}: does not exist"
}

Write-Host ""
Write-Host "  Installing to: $InstallRoot" -ForegroundColor Cyan
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
Push-Location $InstallRoot
pnpm install
if ($LASTEXITCODE -ne 0) {
    Write-Fail "pnpm install failed. Check the output above for errors."
}
Pop-Location
Write-Ok "Dependencies installed"

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

if (-not $SkipDocker) {
    Write-Step "Starting Docker services (PostgreSQL, Neo4j, Qdrant)"

    # Configure Docker volume location on the chosen drive
    $dockerDataDir = "${InstallDrive}:\docker-data\dpf"
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

    # Create override: volumes on the selected drive + ports exposed for local dev
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
"@

    $overridePath = Join-Path $InstallRoot "docker-compose.override.yml"
    $overrideContent | Set-Content -Path $overridePath -Encoding UTF8
    Write-Ok "Created docker-compose.override.yml (volumes on ${InstallDrive}:)"

    docker compose up -d
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "docker compose up failed. Check: docker compose logs"
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

Write-Step "Restoring full database state (epics, backlog, providers)"

$sqlScripts = @(
    "scripts\db-export-epics-backlog.sql",
    "scripts\db-export-runtime-state.sql",
    "scripts\seed-vision-epics.sql",
    "scripts\seed-hr-epic.sql",
    "scripts\seed-crm-epic.sql",
    "scripts\seed-crm-sales-pipeline-epic.sql",
    "scripts\seed-sbom-epic.sql",
    "scripts\seed-calendaring-epic.sql",
    "scripts\seed-usability-standards-epic.sql",
    "scripts\update-finance-epic.sql",
    "scripts\update-selfdev-epic-runtime-registration.sql",
    "scripts\update-calendar-epic.sql",
    "scripts\cleanup-orphaned-hr-items.sql",
    "scripts\dedup-hr-epic.sql",
    "scripts\mark-neo4j-stories-done.sql",
    "scripts\mark-neo4j-stories-6-7-done.sql"
)

foreach ($sql in $sqlScripts) {
    $fullPath = Join-Path $InstallRoot $sql
    if (Test-Path $fullPath) {
        $name = Split-Path $sql -Leaf
        Write-Host "  Applying $name..."
        try {
            pnpm --filter @dpf/db exec prisma db execute --file "../../$sql" 2>$null
        } catch {
            Write-Warn "$name had errors (may be expected if already applied)"
        }
    }
}

Write-Ok "Database fully restored"

Write-Host "========================================================" 

Write-Host ""
Write-Host "   Fresh install complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Project location: $InstallRoot" -ForegroundColor Cyan
Write-Host "  Docker volumes:   ${InstallDrive}:\docker-data\dpf" -ForegroundColor Cyan
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
