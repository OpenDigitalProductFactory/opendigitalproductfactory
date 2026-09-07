# fresh-install.ps1  Fresh install of Open Digital Product Factory (Windows)
#
# Usage (run from the cloned project root):
#   .\scripts\fresh-install.ps1                        # uses current directory
#   .\scripts\fresh-install.ps1 -SkipDocker            # skip Docker services
#
# What this does:
#   1. Installs pnpm dependencies
#   2. Creates .env files with generated secrets
#   3. Starts Docker services (Postgres -- vectors + graph live in Postgres since BET-5)
#   4. Runs migrations + seed + full DB restore

param(
    [switch]$SkipDocker,
    [switch]$SkipPreDestructiveDump,  # accept losing every unmirrored DB row
    [switch]$WithEdge
)

$ErrorActionPreference = "Stop"

function Write-Step($msg)  { Write-Host "`n $msg" -ForegroundColor Yellow }
function Write-Ok($msg)    { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "   $msg" -ForegroundColor Red; exit 1 }

# --- Pre-destructive Postgres dump -----------------------------------------
# `docker compose down -v` below destroys the database, and with it every
# Workroom, decision and backlog row that is not already mirrored elsewhere
# (BI-F9939341). The nightly backup is hours old and the backlog bundle does
# not run from a consumer install, so the only honest move is to dump the live
# database right here, right before the volume goes. The dump lands under the
# operator backup root (outside the install directory) so the rm cannot touch
# it, and restores with the same pg_restore the DR runbook documents.
function Invoke-PreDestructivePostgresDump {
    param(
        [Parameter(Mandatory = $true)][string]$InstallDir,
        [Parameter(Mandatory = $true)][string]$Trigger,
        [switch]$Skip
    )
    if ($Skip) {
        Write-Warn "Pre-destructive Postgres dump SKIPPED by -SkipPreDestructiveDump. Every row not already mirrored is gone after this step."
        return $null
    }
    $pgUser = "dpf"; $pgDb = "dpf"; $container = "dpf-postgres-1"; $backupsRoot = $null
    $envPath = Join-Path $InstallDir ".env"
    if (Test-Path $envPath) {
        foreach ($line in Get-Content $envPath) {
            if ($line -match '^DPF_BACKUPS_HOST_PATH=(.+)$') { $backupsRoot = $Matches[1].Trim().Trim('"').Trim("'") }
            elseif ($line -match '^POSTGRES_USER=(.+)$') { $pgUser = $Matches[1].Trim().Trim('"').Trim("'") }
            elseif ($line -match '^POSTGRES_DB=(.+)$') { $pgDb = $Matches[1].Trim().Trim('"').Trim("'") }
            elseif ($line -match '^DPF_PRODUCTION_DB_CONTAINER=(.+)$') { $container = $Matches[1].Trim().Trim('"').Trim("'") }
        }
    }
    if (-not $backupsRoot) { $backupsRoot = "$InstallDir-backups" }

    $running = docker ps --filter "name=^$container$" --format "{{.Names}}" 2>$null
    if (-not $running) {
        Write-Ok "No running Postgres container ($container); nothing to dump before teardown."
        return $null
    }

    $now = (Get-Date).ToUniversalTime()
    $target = Join-Path $backupsRoot ("pre-destructive\" + $now.ToString("yyyy-MM-dd") + "\" + $Trigger + "-" + $now.ToString("yyyy-MM-ddTHH-mm-ssZ"))
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    $dump = Join-Path $target "dpf.dump"
    Write-Host "  Dumping $pgDb from $container to $dump ..."
    # cmd.exe redirection keeps the custom-format dump byte-exact; PowerShell
    # redirection would re-encode it as text and corrupt it.
    & cmd.exe /c "docker exec $container pg_dump -U $pgUser -Fc $pgDb > `"$dump`""
    $exit = $LASTEXITCODE
    $size = if (Test-Path $dump) { (Get-Item $dump).Length } else { 0 }
    if ($exit -ne 0 -or $size -eq 0) {
        if (Test-Path $dump) { Remove-Item $dump -Force }
        Write-Fail "Pre-destructive Postgres dump FAILED (pg_dump exit=$exit, bytes=$size). Refusing to destroy the database. Fix the dump (is $container healthy? is $backupsRoot writable?) and re-run; pass -SkipPreDestructiveDump only if losing every unmirrored Workroom, decision and backlog row is acceptable."
    }
    $sha = (Get-FileHash -Path $dump -Algorithm SHA256).Hash.ToLower()
    # LF-terminated so `sha256sum -c dpf.dump.sha256` works on any host (Set-Content would write CRLF).
    [System.IO.File]::WriteAllText((Join-Path $target "dpf.dump.sha256"), "$sha  dpf.dump`n")
    $manifest = [ordered]@{
        schemaVersion = 1
        trigger       = $Trigger
        capturedAt    = $now.ToString("yyyy-MM-ddTHH:mm:ssZ")
        container     = $container
        database      = $pgDb
        dumpFormat    = "pg_dump -Fc"
        sizeBytes     = $size
        sha256        = $sha
        restore       = "docker exec -i <postgres> pg_restore --clean --if-exists -U $pgUser -d $pgDb < dpf.dump  (or /admin/backups -> Restore)"
    }
    ($manifest | ConvertTo-Json) | Set-Content -Path (Join-Path $target "manifest.json") -Encoding UTF8
    Write-Ok ("Pre-destructive dump saved: {0} ({1:N1} MB, sha256 {2}...)" -f $dump, ($size / 1MB), $sha.Substring(0, 12))
    return $target
}

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
AUTH_SECRET=$authSecret
CREDENTIAL_ENCRYPTION_KEY=$encKey
ADMIN_PASSWORD=changeme123
DPF_HOST_INSTALL_PATH=$InstallRoot
DPF_BACKUPS_HOST_PATH=$InstallRoot-backups
"@ | Set-Content -Path $envFile -Encoding UTF8
    Write-Ok "Created .env with generated secrets"
} else {
    Write-Ok ".env already exists -- skipping"
}

Write-Host "========================================================" 

Write-Step "Creating app-level .env files"

$envExamplePath = Join-Path $InstallRoot ".env.example"
$webEnvPath     = Join-Path $InstallRoot "apps\web\.env.local"
if (Test-Path $envExamplePath) {
    if (-not (Test-Path $webEnvPath)) {
        Copy-Item $envExamplePath $webEnvPath
        # Generate real secrets (replace placeholders in .env.example copy)
        $content = Get-Content $webEnvPath -Raw
        # CREDENTIAL_ENCRYPTION_KEY -- 32 random bytes as hex
        $encKey = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Maximum 256) })
        $content = $content -replace '<generate with: openssl rand -hex 32>', $encKey
        # AUTH_SECRET -- 32 random bytes as base64
        $authBytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($authBytes)
        $authSecret = [Convert]::ToBase64String($authBytes)
        $content = $content -replace '<generate with: openssl rand -base64 32>', $authSecret
        $content | Set-Content $webEnvPath
        Write-Ok "Created apps/web/.env.local with generated secrets"
    } else {
        Write-Ok "apps/web/.env.local already exists  skipping"
    }
} else {
    Write-Warn ".env.example not found  skipping app-level .env creation"
}

# Persist the canonical capability snapshot after Node is available and before
# any Compose invocation. The adapter owns profile/service selection.
. (Join-Path $InstallRoot "scripts\installer\lib\state.ps1")
$capabilityProjection = Resolve-DpfCapabilityComposeProfiles -InstallDir $InstallRoot
$env:COMPOSE_PROFILES = (@($capabilityProjection.composeProfiles) -join ',')

$dockerDataDir = "${InstallDrive}:\docker-data\dpf"

if (-not $SkipDocker) {
    # PostgreSQL owns relational, vector, and graph persistence.
    Write-Step "Starting Docker services (PostgreSQL)"

    # Tear down any existing containers and volumes from a previous install
    # so the database starts clean (required for onboarding to trigger), but
    # dump the live database first so nothing unmirrored is lost (BI-F9939341).
    Write-Step "Preserving the live database (pre-destructive dump)"
    $null = Invoke-PreDestructivePostgresDump -InstallDir $InstallRoot -Trigger "fresh-install" -Skip:$SkipPreDestructiveDump
    Write-Host "  Cleaning previous Docker state..."
    docker compose down -v 2>$null

    # Wipe bind-mount data directories so re-installs get a fresh database
    foreach ($subdir in @("pgdata")) {
        $path = Join-Path $dockerDataDir $subdir
        if (Test-Path $path) {
            Remove-Item -Recurse -Force $path 2>$null
        }
    }

    # Configure Docker volume location on the project's drive
    foreach ($dir in @(
        $dockerDataDir,
        (Join-Path $dockerDataDir "pgdata")
    )) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
    }

    # Docker Compose on Windows is safer with quoted forward-slash host paths.
    $dockerDataDirForCompose = $dockerDataDir.Replace('\', '/')

    # Create override: volumes on the project drive + ports exposed for local dev
    # Docker Model Runner handles GPU passthrough via Docker Desktop -- no override needed.
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
    # Vectors live in PostgreSQL through pgvector.
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

# Edge Node bootstrap. Mirror install-dpf.sh's auto-approve flow on Windows
# so a fresh install brings up an enrolled Edge Node alongside the portal.
# Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
#   section Approval policy ("Auto-approve when the bootstrap token is issued by
#   the local installer for the DPF host's own Edge Node")
Write-Step "Edge Node bootstrap"

# Edge Node deploy gate (opt-in; BI-72CFF89D / edge-topology design section 5).
# A fresh install no longer bundles a local Edge Node by default; pass
# -WithEdge to bundle + auto-enroll one (the choice is the consent).
if (-not $WithEdge) {
    Write-Ok "Skipped -- Edge Node is opt-in. Re-run with -WithEdge to bundle a local node, or add a node on another machine from Admin > Platform Development > Edge Nodes."
} else {
$edgeComposeArgs = @(
    "-f", "docker-compose.yml",
    "-f", "docker-compose.override.yml",
    "-f", "docker-compose.edge.yml"
)

# Wait for portal /api/health so the token mint can talk to Prisma /
# Authority. Up to 5 minutes -- matches dpf-start.ps1.
Write-Host "  Waiting for portal /api/health..."
$portalReady = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:3000/api/health" `
                    -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($resp -and $resp.StatusCode -eq 200) { $portalReady = $true; break }
    } catch {}
    Start-Sleep -Seconds 5
}
if (-not $portalReady) {
    Write-Warn "Portal did not become healthy in time -- skipping Edge Node bootstrap."
    Write-Warn "Re-run scripts/fresh-install.ps1 or issue a token from Admin > Platform Development > Edge Nodes."
} else {
    # Mint a single-use auto-approve bootstrap token. We run the script
    # INSIDE the portal container instead of via host pnpm so we get a
    # Prisma client that matches the just-migrated DB schema regardless of
    # whether the host's `pnpm install` produced one. This also lets the
    # consumer install path (no host Node/pnpm) reach the same code path.
    # Plaintext token is the LAST stdout line; diagnostic output is on stderr.
    $portalContainer = (docker compose -f "$InstallRoot\docker-compose.yml" `
                              -f "$InstallRoot\docker-compose.edge.yml" `
                              ps -q portal 2>$null) -split "`n" | Select-Object -First 1
    if (-not $portalContainer) { $portalContainer = "dpf-portal-1" }

    $edgeToken = $null
    try {
        $tokenOutput = docker exec $portalContainer sh -c `
            'cd /app/apps/web-src && /app/node_modules/.pnpm/node_modules/.bin/tsx scripts/issue-edge-bootstrap-token.ts --ttl-minutes 30 --auto-approve' 2>$null
        if ($LASTEXITCODE -eq 0 -and $tokenOutput) {
            $lines = @($tokenOutput) | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ -ne "" }
            $candidate = if ($lines.Count -gt 0) { $lines[-1] } else { "" }
            if ($candidate -match "^dpfboot_") {
                $edgeToken = $candidate
            }
        }
    } catch {
        # Captured below by the null check.
    }

    if (-not $edgeToken) {
        Write-Warn "Bootstrap token issuance failed -- skipping enrollment wiring."
        Write-Warn "You can re-issue manually via Admin > Platform Development > Edge Nodes."
    } else {
        # Append (or replace) DPF_BOOTSTRAP_TOKEN + DPF_EDGE_NODE_NAME in .env.
        # Idempotent: re-running the installer overwrites the prior token.
        $envPath = Join-Path $InstallRoot ".env"
        $envText = Get-Content $envPath -Raw -ErrorAction SilentlyContinue
        if ($null -eq $envText) { $envText = "" }

        if ($envText -match "(?m)^DPF_BOOTSTRAP_TOKEN=.*$") {
            $envText = [System.Text.RegularExpressions.Regex]::Replace(
                $envText, "(?m)^DPF_BOOTSTRAP_TOKEN=.*$", "DPF_BOOTSTRAP_TOKEN=$edgeToken")
        } else {
            if ($envText.Length -gt 0 -and -not $envText.EndsWith("`n")) { $envText += "`n" }
            $envText += "`n# Edge Node bootstrap token -- installer-issued, auto-approve.`n"
            $envText += "DPF_BOOTSTRAP_TOKEN=$edgeToken`n"
        }

        if ($envText -notmatch "(?m)^DPF_EDGE_NODE_NAME=") {
            $envText += "DPF_EDGE_NODE_NAME=$([System.Net.Dns]::GetHostName())`n"
        }

        Set-Content -Path $envPath -Value $envText -Encoding UTF8 -NoNewline
        Write-Ok "Bootstrap token wired into .env (auto-approve)"

        # Force-recreate the edge-node service so it picks up the new env.
        # --no-deps avoids touching the portal.
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        docker compose @edgeComposeArgs up -d --no-deps --force-recreate edge-node 2>&1 | Out-Null
        $edgeUpExit = $LASTEXITCODE
        $ErrorActionPreference = $oldEAP

        if ($edgeUpExit -eq 0) {
            Write-Ok "Edge Node container started -- enrolls within ~10s"
        } else {
            Write-Warn "edge-node container restart failed; node may not have enrolled."
            Write-Warn "  Inspect: docker compose -f docker-compose.yml -f docker-compose.edge.yml logs edge-node --tail 50"
        }
    }
}
}

Write-Host "========================================================"

# -- Agent toolchain bootstrap (BI-4B17051B) ------------------------------------
# Converges Claude Code + Codex CLI sessions to a kernel-aware state, seeds
# kernel-tier memory, and persists agentToolchain readiness state. Designed
# to never leak substrate paths or command snippets to the operator.
Write-Step "Converging DPF agent toolchain"
$bootstrapScript = Join-Path $InstallRoot "scripts\dpf-bootstrap-agent-toolchain.ps1"
if (Test-Path $bootstrapScript) {
    try {
        & $bootstrapScript -RepoRoot $InstallRoot
    } catch {
        Write-Warn "Agent toolchain bootstrap encountered an issue (non-fatal): $_"
    }
} else {
    Write-Warn "Agent toolchain bootstrap script missing at $bootstrapScript"
}

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
