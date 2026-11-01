param(
    [string]$DPF_DIR = $PSScriptRoot,
    [switch]$NoBrowser,
    [switch]$WithEdge,
    [switch]$NoEdge
)

Set-Location $DPF_DIR

# Host GPU snapshot for local-model admission. Non-fatal when the publisher
# is absent; a missing snapshot does not disable the local model.
$gpuPublisher = Join-Path $DPF_DIR "scripts\publish-host-gpu.ps1"
if (Test-Path -LiteralPath $gpuPublisher) {
    try {
        Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $gpuPublisher
        ) | Out-Null
    } catch {
        Write-Host "[!] Host GPU publisher did not start (non-fatal)." -ForegroundColor Yellow
    }
}

# The generated entrypoint consumes the same checked-in adapter and state
# helper as install/setup; it never snapshots service/profile logic.
if ($WithEdge) { $env:DPF_INCLUDE_EDGE = '1' }
elseif ($NoEdge) { $env:DPF_INCLUDE_EDGE = '0' }
$stateLib = Join-Path $DPF_DIR "scripts\installer\lib\state.ps1"
if (-not (Test-Path -LiteralPath $stateLib)) { $stateLib = Join-Path $DPF_DIR "installer\lib\state.ps1" }
if (-not (Test-Path -LiteralPath $stateLib)) { throw "capability_state_helper_missing" }
. $stateLib
$includeEdge = Resolve-DpfEdgeEnabled -InstallDir $DPF_DIR
$consumerReleaseTag = Resolve-DpfConsumerReleaseImageTag -InstallDir $DPF_DIR
if ($consumerReleaseTag) {
    Write-Host "Using recorded consumer release tag $consumerReleaseTag" -ForegroundColor Cyan
}
$capabilityProjection = Resolve-DpfCapabilityComposeProfiles -InstallDir $DPF_DIR
$env:COMPOSE_PROFILES = (@($capabilityProjection.composeProfiles) -join ',')

$composeChainModule = Join-Path $DPF_DIR "scripts\installer\lib\compose-chain.ps1"
if (-not (Test-Path -LiteralPath $composeChainModule)) { throw "compose_chain_helper_missing" }
. $composeChainModule
$composeArgs = Get-DPFComposeArgs -InstallDir $DPF_DIR -IncludeEdge:$includeEdge -IncludeRelease:$true
docker compose @composeArgs up -d

if ($includeEdge) {
    Start-ScheduledTask -TaskName "DPF-Native-Edge-Node" -ErrorAction SilentlyContinue
}

Write-Host "Waiting for portal to be ready..." -ForegroundColor Cyan
$attempts = 0
$maxAttempts = 60
$healthy = $false
while ($attempts -lt $maxAttempts) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:3000/api/health" `
                    -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($resp -and $resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
    Start-Sleep -Seconds 5
    $attempts++
}

if (-not $healthy) {
    Write-Host "[!] Portal did not become healthy after 5 minutes." -ForegroundColor Yellow
    Write-Host "    Run 'docker compose logs portal' in $DPF_DIR to diagnose." -ForegroundColor Yellow
} else {
    $seedScript = Join-Path $DPF_DIR "scripts\seed-worktree-mcp.ps1"
    if ((Test-Path $seedScript) -and (Get-Command claude -ErrorAction SilentlyContinue)) {
        Write-Host "Auto-seeding MCP token..." -ForegroundColor Cyan
        try { & $seedScript } catch { Write-Host "[!] MCP seed skipped: $_" -ForegroundColor Yellow }
    }
}

if (-not $NoBrowser) {
    Start-Process "http://localhost:3000"
    Write-Host "Digital Product Factory is running at http://localhost:3000" -ForegroundColor Green
}

# Host-side convergence (BI-084F85E5). This file ships as a verified release
# asset, so every self-upgrade replaces it and the next logon converges what a
# container cannot install: the native host-upkeep agent at this release's
# version. It needs the portal (for a one-time enrollment token), never fails
# startup, and never reboots the host.
$hostConvergenceModule = Join-Path $DPF_DIR "scripts\installer\lib\host-convergence.ps1"
if ($healthy -and (Test-Path -LiteralPath $hostConvergenceModule)) {
    . $hostConvergenceModule
    $hostUpkeepRole = if ($includeEdge) { "full" } else { "host-upkeep" }
    $hostConvergence = Invoke-DPFHostConvergence -InstallDir $DPF_DIR -Role $hostUpkeepRole
    Write-Host "Host convergence: $hostConvergence" -ForegroundColor Cyan
}
