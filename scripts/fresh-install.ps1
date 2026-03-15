# ────────────────────────────────────────────────────────────────────────────
# fresh-install.ps1 — Fresh install of Open Digital Product Factory (Windows)
#
# Usage:
#   .\scripts\fresh-install.ps1                        # defaults to current drive
#   .\scripts\fresh-install.ps1 -InstallDrive H        # install to H: drive
#   .\scripts\fresh-install.ps1 -InstallDrive H -SkipDocker  # skip Docker/Ollama
#
# What this does:
#   1. Clones the repo to <drive>:\OpenDigitalProductFactory
#   2. Installs pnpm dependencies
#   3. Creates .env files
#   4. Starts Docker services (Postgres, Neo4j, Ollama)
#   5. Runs migrations + seed + full DB restore
# ────────────────────────────────────────────────────────────────────────────

param(
    [string]$InstallDrive = "",
    [switch]$SkipDocker,
    [string]$RepoUrl = "https://github.com/markdbodman/opendigitalproductfactory.git"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg)  { Write-Host "`n→ $msg" -ForegroundColor Yellow }
function Write-Ok($msg)    { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  Open Digital Product Factory — Fresh Install (Windows)" -ForegroundColor Cyan
Write-Host "  ======================================================" -ForegroundColor Cyan

# ── Drive selection ──────────────────────────────────────────────────────────

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

# ── Prerequisites ────────────────────────────────────────────────────────────

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

if (-not $SkipDocker) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Fail "Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
    }
    Write-Ok "Docker found: $(docker --version)"
}

# ── Clone or update repo ────────────────────────────────────────────────────

Write-Step "Setting up repository"

if (Test-Path "$InstallRoot\.git") {
    Write-Ok "Repository already exists at $InstallRoot — pulling latest"
    Push-Location $InstallRoot
    git pull origin main
    Pop-Location
} elseif (Test-Path $InstallRoot) {
    Write-Warn "$InstallRoot exists but is not a git repo. Skipping clone."
} else {
    Write-Host "  Cloning to $InstallRoot..."
    git clone $RepoUrl $InstallRoot
    Write-Ok "Repository cloned"
}

Push-Location $InstallRoot

# ── Dependencies ─────────────────────────────────────────────────────────────

Write-Step "Installing dependencies"
pnpm install
Write-Ok "Dependencies installed"

# ── Environment ──────────────────────────────────────────────────────────────

Write-Step "Setting up environment files"

if (-not (Test-Path "apps\web\.env.local")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" "apps\web\.env.local"
        $secret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
        (Get-Content "apps\web\.env.local") -replace '<generate with: openssl rand -base64 32>', $secret |
            Set-Content "apps\web\.env.local"
        Add-Content "apps\web\.env.local" "OLLAMA_INTERNAL_URL=http://ollama:11434"
        Write-Ok "Created apps\web\.env.local"
    } else {
        Write-Warn ".env.example not found — create apps\web\.env.local manually"
    }
} else {
    Write-Ok "apps\web\.env.local already exists"
}

if (-not (Test-Path "packages\db\.env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" "packages\db\.env"
        Write-Ok "Created packages\db\.env"
    } else {
        # Create minimal .env for Prisma
        'DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf"' | Set-Content "packages\db\.env"
        Write-Ok "Created packages\db\.env with default DATABASE_URL"
    }
} else {
    Write-Ok "packages\db\.env already exists"
}

# ── Docker services ──────────────────────────────────────────────────────────

if (-not $SkipDocker) {
    Write-Step "Starting Docker services (PostgreSQL, Neo4j, Ollama)"

    # Configure Docker volume location on the chosen drive
    $dockerDataDir = "${InstallDrive}:\docker-data\dpf"
    if (-not (Test-Path $dockerDataDir)) {
        New-Item -ItemType Directory -Path $dockerDataDir -Force | Out-Null
    }

    # Create override to store volumes on the selected drive
    $overrideContent = @"
# Auto-generated by fresh-install.ps1 — stores Docker volumes on ${InstallDrive}: drive
services:
  postgres:
    volumes:
      - ${dockerDataDir}\pgdata:/var/lib/postgresql/data
  neo4j:
    volumes:
      - ${dockerDataDir}\neo4jdata:/data
  ollama:
    volumes:
      - ${dockerDataDir}\ollama_models:/root/.ollama
"@

    $overridePath = Join-Path $InstallRoot "docker-compose.override.yml"
    $overrideContent | Set-Content $overridePath -Encoding UTF8
    Write-Ok "Created docker-compose.override.yml (volumes on ${InstallDrive}:)"

    docker compose up -d
    Write-Host "  Waiting for PostgreSQL..."
    $retries = 30
    while ($retries -gt 0) {
        $ready = docker compose exec -T postgres pg_isready -U dpf 2>$null
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Seconds 2
        $retries--
    }
    if ($retries -eq 0) { Write-Fail "PostgreSQL did not start. Check: docker compose logs postgres" }
    Write-Ok "PostgreSQL is ready"

    Write-Host "  Waiting for Ollama (first run downloads model — may take several minutes)..."
    $retries = 90
    while ($retries -gt 0) {
        try {
            docker compose exec -T ollama wget -qO /dev/null http://localhost:11434/api/tags 2>$null
            if ($LASTEXITCODE -eq 0) { break }
        } catch {}
        Start-Sleep -Seconds 2
        $retries--
    }
    if ($retries -eq 0) { Write-Warn "Ollama not ready yet — it may still be downloading. Continue anyway." }
    else { Write-Ok "Ollama is ready" }
}

# ── Database setup ───────────────────────────────────────────────────────────

Write-Step "Running database migrations"
Push-Location "packages\db"
npx prisma migrate deploy
Write-Ok "Migrations complete"

Write-Step "Seeding database"
npx prisma db seed
Write-Ok "Base seed complete"

Write-Step "Restoring full database state (epics, backlog, providers)"

$sqlScripts = @(
    "..\..\scripts\db-export-epics-backlog.sql",
    "..\..\scripts\db-export-runtime-state.sql",
    "..\..\scripts\seed-vision-epics.sql",
    "..\..\scripts\seed-hr-epic.sql",
    "..\..\scripts\seed-crm-epic.sql",
    "..\..\scripts\seed-sbom-epic.sql",
    "..\..\scripts\seed-calendaring-epic.sql",
    "..\..\scripts\update-finance-epic.sql",
    "..\..\scripts\update-selfdev-epic-runtime-registration.sql",
    "..\..\scripts\update-calendar-epic.sql",
    "..\..\scripts\cleanup-orphaned-hr-items.sql",
    "..\..\scripts\dedup-hr-epic.sql",
    "..\..\scripts\mark-neo4j-stories-done.sql",
    "..\..\scripts\mark-neo4j-stories-6-7-done.sql"
)

foreach ($sql in $sqlScripts) {
    $fullPath = Join-Path (Get-Location) $sql
    if (Test-Path $fullPath) {
        $name = Split-Path $sql -Leaf
        Write-Host "  Applying $name..."
        try {
            npx prisma db execute --file $sql --schema prisma/schema.prisma 2>$null
        } catch {
            Write-Warn "$name had errors (may be expected if already applied)"
        }
    }
}

Pop-Location
Write-Ok "Database fully restored"

# ── Done ─────────────────────────────────────────────────────────────────────

Pop-Location

Write-Host ""
Write-Host "  ✓ Fresh install complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Project location: $InstallRoot" -ForegroundColor Cyan
Write-Host "  Docker volumes:   ${InstallDrive}:\docker-data\dpf" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Start the app:    cd $InstallRoot && pnpm dev"
Write-Host "  Open:             http://localhost:3000"
Write-Host ""
Write-Host "  Default login:"
Write-Host "    Email:    admin@dpf.local"
Write-Host "    Password: changeme123"
Write-Host ""
Write-Host "  Change the password before any non-local deployment." -ForegroundColor Yellow
Write-Host ""
