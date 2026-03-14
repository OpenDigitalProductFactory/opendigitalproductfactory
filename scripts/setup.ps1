# Open Digital Product Factory — first-time setup script (Windows PowerShell)
# Run from the project root: .\scripts\setup.ps1

$ErrorActionPreference = "Stop"

function Write-Step  { param($msg) Write-Host "`n-> $msg" -ForegroundColor Yellow }
function Write-Ok    { param($msg) Write-Host "  v $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "  X $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  Open Digital Product Factory -- Setup" -ForegroundColor Cyan
Write-Host "  ======================================" -ForegroundColor Cyan

# -- Prerequisites ---------------------------------------------------------------

Write-Step "Checking prerequisites"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Fail "Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
}
Write-Ok "Docker found: $(docker --version)"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Fail "Node.js is not installed. Download v20+ from: https://nodejs.org/"
}
$nodeVersion = [int]((node -v).TrimStart('v').Split('.')[0])
if ($nodeVersion -lt 20) {
    Write-Fail "Node.js v20+ required. Current: $(node -v). Download from: https://nodejs.org/"
}
Write-Ok "Node.js found: $(node -v)"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Warn "pnpm not found. Installing..."
    npm install -g pnpm
}
Write-Ok "pnpm found: $(pnpm -v)"

# -- Dependencies ----------------------------------------------------------------

Write-Step "Installing dependencies"
pnpm install
Write-Ok "Dependencies installed"

# -- Environment -----------------------------------------------------------------

Write-Step "Setting up environment"

if (-not (Test-Path "apps\web\.env.local")) {
    Copy-Item ".env.example" "apps\web\.env.local"
    # Generate AUTH_SECRET using Python (usually available on Windows)
    $secret = ""
    if (Get-Command python -ErrorAction SilentlyContinue) {
        $secret = python -c "import secrets; print(secrets.token_hex(32))"
    } elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
        $secret = python3 -c "import secrets; print(secrets.token_hex(32))"
    } else {
        $secret = [System.Web.Security.Membership]::GeneratePassword(64, 8)
    }
    if ($secret) {
        (Get-Content "apps\web\.env.local") -replace '<generate with: openssl rand -base64 32>', $secret |
            Set-Content "apps\web\.env.local"
        Write-Ok "Created apps\web\.env.local with generated AUTH_SECRET"
    } else {
        Write-Warn "Created apps\web\.env.local — please set AUTH_SECRET manually"
    }
    # Enable Docker internal URL for Ollama
    Add-Content -Path "apps\web\.env.local" -Value "OLLAMA_INTERNAL_URL=http://ollama:11434"
} else {
    Write-Ok "apps\web\.env.local already exists — skipping"
}

if (-not (Test-Path "packages\db\.env")) {
    Copy-Item ".env.example" "packages\db\.env"
    Write-Ok "Created packages\db\.env"
}

# -- Databases -------------------------------------------------------------------

Write-Step "Starting services (PostgreSQL + Neo4j + Ollama)"
docker compose up -d

Write-Host "  Waiting for PostgreSQL to be ready..."
$retries = 30
do {
    $ready = docker compose exec -T postgres pg_isready -U dpf -q 2>$null
    if ($LASTEXITCODE -eq 0) { break }
    $retries--
    if ($retries -eq 0) { Write-Fail "PostgreSQL did not start. Check: docker compose logs postgres" }
    Start-Sleep -Seconds 2
} while ($true)
Write-Ok "PostgreSQL is ready"

Write-Host "  Waiting for Ollama... (first run may take a few minutes to download default model)" -ForegroundColor Yellow
$retries = 90
do {
    $null = docker compose exec -T ollama curl -sf http://localhost:11434/api/tags 2>$null
    if ($LASTEXITCODE -eq 0) { break }
    $retries--
    if ($retries -eq 0) {
        Write-Host "  [FAIL] Ollama did not start in time. Check: docker compose logs ollama" -ForegroundColor Red
        exit 1
    }
    Start-Sleep -Seconds 2
} while ($true)
Write-Host "  [OK] Ollama is ready" -ForegroundColor Green

# -- Database Setup --------------------------------------------------------------

Write-Step "Running database migrations"
pnpm db:migrate
Write-Ok "Migrations complete"

Write-Step "Seeding database"
pnpm db:seed
Write-Ok "Database seeded with roles, agents, and default admin user"

# -- Done ------------------------------------------------------------------------

Write-Host ""
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Start the app:  pnpm dev"
Write-Host "  Open:           http://localhost:3000"
Write-Host ""
Write-Host "  Default login:"
Write-Host "    Email:    admin@dpf.local"
Write-Host "    Password: changeme123"
Write-Host ""
Write-Host "  Change the password before any non-local deployment."
Write-Host ""
