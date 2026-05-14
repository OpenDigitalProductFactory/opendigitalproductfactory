# scratch-install-rehearsal.ps1  Non-destructive scratch install rehearsal
#
# Usage from a normal DPF worktree:
#   .\scripts\scratch-install-rehearsal.ps1
#   .\scripts\scratch-install-rehearsal.ps1 -Execute
#   .\scripts\scratch-install-rehearsal.ps1 -Execute -PortBase 4100 -KeepRunning
#
# The script creates an isolated git worktree and Docker Compose project so a
# first-run install can be exercised without resetting the real local DPF stack.

param(
    [switch]$Execute,
    [switch]$KeepRunning,
    [switch]$KeepWorktree,
    [switch]$KeepImages,
    [string]$ScratchRoot = "",
    [string]$SourceRef = "HEAD",
    [string]$ProjectName = "",
    [int]$PortBase = 3900,
    [switch]$NoAutoPortSearch,
    [int]$ComposeParallelLimit = 1,
    [int]$HealthTimeoutSeconds = 300,
    [switch]$RunFirstRunWalkthrough,
    [string]$WalkthroughOrgName = "Digital Product Factory Scratch",
    [string]$WalkthroughEmail = "",
    [string]$WalkthroughPassword = "ScratchPassw0rd!",
    [switch]$HeadedWalkthrough
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) { Write-Host ""; Write-Host $Message -ForegroundColor Yellow }
function Write-Ok($Message) { Write-Host "  OK  $Message" -ForegroundColor Green }
function Write-Warn($Message) { Write-Host "  WARN  $Message" -ForegroundColor Yellow }
function Write-Fail($Message) { Write-Host "  FAIL  $Message" -ForegroundColor Red; exit 1 }

function Require-Command($Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        Write-Fail "$Name is required but was not found on PATH."
    }
    return $command
}

function New-HexSecret([int]$LengthBytes) {
    $bytes = New-Object byte[] $LengthBytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

function New-Base64Secret([int]$LengthBytes) {
    $bytes = New-Object byte[] $LengthBytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

function Test-PortAvailable([int]$Port) {
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) {
            $listener.Stop()
        }
    }
}

function Assert-PortAvailable([int]$Port, [string]$Label) {
    if (-not (Test-PortAvailable $Port)) {
        Write-Fail "$Label port $Port is already in use. Re-run with a different -PortBase."
    }
}

function New-PortSet([int]$Base) {
    return [ordered]@{
        Portal = $Base
        CodexCallback = $Base + 55
        Sandbox = $Base + 35
        BrowserUse = $Base + 500
        Adp = $Base + 600
        Redis = $Base + 379
        Inngest = $Base + 388
        InngestApi = $Base + 389
    }
}

function Get-PortConflicts($Ports) {
    $conflicts = @()
    foreach ($entry in $Ports.GetEnumerator()) {
        if (-not (Test-PortAvailable ([int]$entry.Value))) {
            $conflicts += "$($entry.Key)=$($entry.Value)"
        }
    }
    return $conflicts
}

function Find-PortSet([int]$Base, [switch]$Exact) {
    $candidate = $Base
    while ($candidate -le 64000) {
        $ports = New-PortSet $candidate
        $conflicts = Get-PortConflicts $ports
        if ($conflicts.Count -eq 0) {
            if ($candidate -ne $Base) {
                Write-Warn "PortBase $Base had conflicts; using $candidate instead."
            }
            return $ports
        }
        if ($Exact) {
            Write-Fail "PortBase $Base has conflicts: $($conflicts -join ', '). Re-run with a different -PortBase."
        }
        $candidate += 100
    }
    Write-Fail "Could not find an available scratch port set starting at $Base."
}

function Get-RepoRoot {
    $root = (git rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $root) {
        Write-Fail "Run this script from inside a git worktree."
    }
    return (Resolve-Path $root).Path
}

function Convert-ToForwardSlash([string]$Path) {
    return $Path.Replace("\", "/")
}

function New-OverrideContent($Ports) {
@"
services:
  portal:
    ports: !override
      - "$($Ports.Portal):3000"
      - "$($Ports.CodexCallback):3000"
    environment:
      PUBLIC_URL: http://localhost:$($Ports.Portal)
      APP_URL: http://localhost:$($Ports.Portal)
      INSTANCE_TYPE: scratch
      DPF_ENVIRONMENT: scratch
  sandbox:
    ports: !override
      - "$($Ports.Sandbox):3000"
    environment:
      APP_URL: http://localhost:$($Ports.Sandbox)
      DPF_ENVIRONMENT: sandbox
  browser-use:
    ports: !override
      - "$($Ports.BrowserUse):8500"
  adp:
    ports: !override
      - "$($Ports.Adp):8600"
  redis:
    ports: !override
      - "$($Ports.Redis):6379"
  inngest:
    ports: !override
      - "$($Ports.Inngest):8288"
      - "$($Ports.InngestApi):8289"
"@
}

function Write-EnvFile([string]$Path, [string]$InstallPath, $Ports) {
    $installPathForEnv = Convert-ToForwardSlash $InstallPath
    $authSecret = New-Base64Secret 32
    $credentialKey = New-HexSecret 32
    $content = @"
# Generated by scripts/scratch-install-rehearsal.ps1
# This file intentionally does not copy secrets from the source install.
POSTGRES_USER=dpf
POSTGRES_PASSWORD=dpf_dev
DATABASE_URL=postgresql://dpf:dpf_dev@postgres:5432/dpf
NEO4J_AUTH=neo4j/dpf_dev_password
AUTH_SECRET=$authSecret
CREDENTIAL_ENCRYPTION_KEY=$credentialKey
ADMIN_PASSWORD=changeme123
DPF_HOST_INSTALL_PATH=$installPathForEnv
PUBLIC_URL=http://localhost:$($Ports.Portal)
APP_URL=http://localhost:$($Ports.Portal)
MCP_INSECURE_INTERNAL_HOSTS=portal,host.docker.internal,sandbox
INNGEST_EVENT_KEY=deadbeefcafebabe
INNGEST_SIGNING_KEY=abcdef0123456789
"@
    Set-Content -Path $Path -Value $content -Encoding ASCII
}

function Wait-ForHealth([string]$Url, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing
            if ($response.StatusCode -eq 200) {
                return $true
            }
        } catch {
            Start-Sleep -Seconds 5
        }
    }
    return $false
}

function Get-CommandRecord([string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return @{
            available = $true
            path = $command.Source
        }
    }
    return @{
        available = $false
        path = $null
    }
}

Write-Host ""
Write-Host "DPF Scratch Install Rehearsal" -ForegroundColor Cyan
Write-Host "============================="

Require-Command git | Out-Null
Require-Command docker | Out-Null
if ($RunFirstRunWalkthrough) {
    Require-Command pnpm | Out-Null
}

$repoRoot = Get-RepoRoot
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $ScratchRoot) {
    $ScratchRoot = Join-Path $env:TEMP "dpf-scratch-$timestamp"
}
$ScratchRoot = [System.IO.Path]::GetFullPath($ScratchRoot)
$worktreePath = Join-Path $ScratchRoot "source"
$evidencePath = Join-Path $ScratchRoot "evidence"
if (-not $ProjectName) {
    $ProjectName = "dpf-scratch-$timestamp"
}
if (-not $WalkthroughEmail) {
    $WalkthroughEmail = "scratch-admin+$timestamp@dpf.local"
}

$ports = Find-PortSet $PortBase -Exact:$NoAutoPortSearch

$headSha = (git -C $repoRoot rev-parse $SourceRef)
if ($LASTEXITCODE -ne 0 -or -not $headSha) {
    Write-Fail "Could not resolve SourceRef '$SourceRef'."
}

$dirty = (git -C $repoRoot status --short)
$plan = [ordered]@{
    mode = if ($Execute) { "execute" } else { "plan-only" }
    sourceRoot = $repoRoot
    sourceRef = $SourceRef
    sourceSha = $headSha.Trim()
    sourceHasUncommittedChanges = [bool]$dirty
    scratchRoot = $ScratchRoot
    worktreePath = $worktreePath
    evidencePath = $evidencePath
    composeProject = $ProjectName
    portalUrl = "http://localhost:$($ports.Portal)"
    sandboxUrl = "http://localhost:$($ports.Sandbox)"
    codexCallbackUrl = "http://localhost:$($ports.CodexCallback)"
    generatedSecrets = "scratch-only"
    copiedSourceSecrets = $false
    keepWorktree = [bool]$KeepWorktree
    keepImages = [bool]$KeepImages
    composeParallelLimit = $ComposeParallelLimit
    firstRunWalkthrough = [ordered]@{
        enabled = [bool]$RunFirstRunWalkthrough
        orgName = $WalkthroughOrgName
        email = $WalkthroughEmail
        passwordRecorded = $false
        headed = [bool]$HeadedWalkthrough
    }
    codexCli = Get-CommandRecord "codex"
    claudeCli = Get-CommandRecord "claude"
}

Write-Step "Rehearsal plan"
$plan | ConvertTo-Json -Depth 5

if (-not $Execute) {
    Write-Host ""
    Write-Warn "Plan only. Re-run with -Execute to create the scratch worktree and Compose project."
    exit 0
}

Write-Step "Checking scratch ports"
$conflicts = Get-PortConflicts $ports
if ($conflicts.Count -gt 0) {
    Write-Fail "Selected scratch ports became unavailable: $($conflicts -join ', ')."
}
Write-Ok "Scratch ports are available"

if (Test-Path $ScratchRoot) {
    Write-Fail "ScratchRoot already exists: $ScratchRoot"
}

Write-Step "Creating scratch worktree"
New-Item -ItemType Directory -Path $ScratchRoot -Force | Out-Null
New-Item -ItemType Directory -Path $evidencePath -Force | Out-Null
git -C $repoRoot worktree add --detach $worktreePath $headSha.Trim()
if ($LASTEXITCODE -ne 0) {
    Write-Fail "git worktree add failed."
}
Write-Ok "Created worktree at $worktreePath"

Write-Step "Writing scratch environment"
$overridePath = Join-Path $worktreePath "docker-compose.scratch-rehearsal.override.yml"
New-OverrideContent $ports | Set-Content -Path $overridePath -Encoding ASCII
Write-EnvFile (Join-Path $worktreePath ".env") $worktreePath $ports
$plan.manifestPath = Join-Path $evidencePath "scratch-rehearsal-manifest.json"
$plan.overridePath = $overridePath
$plan | ConvertTo-Json -Depth 5 | Set-Content -Path $plan.manifestPath -Encoding ASCII
Write-Ok "Wrote scratch .env, Compose override, and manifest"

Write-Step "Validating Compose model"
docker compose -p $ProjectName -f (Join-Path $worktreePath "docker-compose.yml") -f $overridePath --env-file (Join-Path $worktreePath ".env") config portal | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Fail "docker compose config failed."
}
Write-Ok "Compose model renders"

Write-Step "Starting scratch portal and sandbox"
Push-Location $worktreePath
$previousParallelLimit = $env:COMPOSE_PARALLEL_LIMIT
try {
    $env:COMPOSE_PARALLEL_LIMIT = "$ComposeParallelLimit"
    docker compose -p $ProjectName -f docker-compose.yml -f docker-compose.scratch-rehearsal.override.yml up -d --build portal sandbox
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "docker compose up failed. Check scratch logs in $worktreePath."
    }
} finally {
    if ($null -eq $previousParallelLimit) {
        Remove-Item Env:\COMPOSE_PARALLEL_LIMIT -ErrorAction SilentlyContinue
    } else {
        $env:COMPOSE_PARALLEL_LIMIT = $previousParallelLimit
    }
    Pop-Location
}

$healthUrl = "http://localhost:$($ports.Portal)/api/health"
Write-Step "Waiting for portal health at $healthUrl"
if (-not (Wait-ForHealth $healthUrl $HealthTimeoutSeconds)) {
    Push-Location $worktreePath
    try {
        docker compose -p $ProjectName -f docker-compose.yml -f docker-compose.scratch-rehearsal.override.yml ps | Tee-Object -FilePath (Join-Path $evidencePath "compose-ps.txt")
        docker compose -p $ProjectName -f docker-compose.yml -f docker-compose.scratch-rehearsal.override.yml logs --tail 120 portal portal-init | Tee-Object -FilePath (Join-Path $evidencePath "portal-logs.txt")
    } finally {
        Pop-Location
    }
    Write-Fail "Scratch portal did not become healthy within $HealthTimeoutSeconds seconds."
}
Write-Ok "Scratch portal health passed"

$walkthroughResultPath = $null
if ($RunFirstRunWalkthrough) {
    Write-Step "Running first-run walkthrough"
    $walkthroughArgs = @(
        "exec",
        "node",
        "scripts/scratch-first-run-walkthrough.mjs",
        "--portal-url",
        $plan.portalUrl,
        "--evidence-path",
        $evidencePath,
        "--org-name",
        $WalkthroughOrgName,
        "--email",
        $WalkthroughEmail,
        "--password",
        $WalkthroughPassword
    )
    if ($HeadedWalkthrough) {
        $walkthroughArgs += "--headed"
    }
    Push-Location $repoRoot
    try {
        & pnpm @walkthroughArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "First-run walkthrough failed. Evidence remains at $evidencePath."
        }
    } finally {
        Pop-Location
    }
    $walkthroughResultPath = Join-Path $evidencePath "first-run-walkthrough-result.json"
    Write-Ok "First-run walkthrough passed"
}

$result = [ordered]@{
    completedAt = (Get-Date).ToString("o")
    portalHealthUrl = $healthUrl
    portalUrl = $plan.portalUrl
    sandboxUrl = $plan.sandboxUrl
    composeProject = $ProjectName
    worktreePath = $worktreePath
    evidencePath = $evidencePath
    keepRunning = [bool]$KeepRunning
    firstRunWalkthrough = if ($RunFirstRunWalkthrough) {
        [ordered]@{
            resultPath = $walkthroughResultPath
            email = $WalkthroughEmail
            passwordRecorded = $false
        }
    } else {
        $null
    }
}
$result | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $evidencePath "scratch-rehearsal-result.json") -Encoding ASCII

Write-Host ""
Write-Ok "Scratch rehearsal reached portal health"
Write-Host "  Portal:  $($plan.portalUrl)"
Write-Host "  Sandbox: $($plan.sandboxUrl)"
Write-Host "  Evidence: $evidencePath"

if (-not $KeepRunning) {
    Write-Step "Stopping scratch Compose project"
    Push-Location $worktreePath
    try {
        if ($KeepImages) {
            docker compose -p $ProjectName -f docker-compose.yml -f docker-compose.scratch-rehearsal.override.yml down -v
        } else {
            docker compose -p $ProjectName -f docker-compose.yml -f docker-compose.scratch-rehearsal.override.yml down -v --rmi local
        }
    } finally {
        Pop-Location
    }
    Write-Ok "Stopped $ProjectName and removed scratch volumes"

    if (-not $KeepWorktree) {
        Write-Step "Removing scratch worktree"
        git -C $repoRoot worktree remove --force $worktreePath
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Could not remove scratch worktree automatically: $worktreePath"
        } else {
            Write-Ok "Removed scratch worktree; evidence remains at $evidencePath"
        }
    }
} else {
    Write-Warn "Scratch stack left running. Stop with:"
    Write-Host "  cd $worktreePath"
    Write-Host "  docker compose -p $ProjectName -f docker-compose.yml -f docker-compose.scratch-rehearsal.override.yml down -v --rmi local"
    Write-Host "  git -C $repoRoot worktree remove --force $worktreePath"
}
