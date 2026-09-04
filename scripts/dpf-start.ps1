param(
    [string]$DPF_DIR = $PSScriptRoot,
    [switch]$NoBrowser,
    [switch]$WithEdge,
    [switch]$NoEdge
)

Set-Location $DPF_DIR

# Edge Node deploy gate (opt-in; BI-72CFF89D / edge-topology design section 5).
# Include the local Edge Node overlay ONLY when this install enabled it.
# -WithEdge / -NoEdge override; otherwise resolve from install-state.json
# (.edge.enabled), with a grandfather for pre-flip installs that already
# have a bundled node (.env carries the bootstrap token). Default OFF.
# See docs/superpowers/specs/2026-06-19-edge-node-deployment-topology-and-remote-provisioning-design.md.
if ($WithEdge)   { $env:DPF_INCLUDE_EDGE = '1' }
elseif ($NoEdge) { $env:DPF_INCLUDE_EDGE = '0' }
$includeEdge = $false
$stateLib = Join-Path $DPF_DIR "scripts\installer\lib\state.ps1"
if (-not (Test-Path -LiteralPath $stateLib)) { $stateLib = Join-Path $DPF_DIR "installer\lib\state.ps1" }
if (Test-Path -LiteralPath $stateLib) {
    . $stateLib
    try {
        $includeEdge = Resolve-DpfEdgeEnabled -InstallDir $DPF_DIR
    } catch {
        $includeEdge = ($env:DPF_INCLUDE_EDGE -eq '1')
    }
} else {
    $includeEdge = ($env:DPF_INCLUDE_EDGE -eq '1')
}

$consumerReleaseTag = Resolve-DpfConsumerReleaseImageTag -InstallDir $DPF_DIR
if ($consumerReleaseTag) {
    Write-Host "Using recorded consumer release tag $consumerReleaseTag" -ForegroundColor Cyan
}

$capabilityProjection = Resolve-DpfCapabilityComposeProfiles -InstallDir $DPF_DIR
$env:COMPOSE_PROFILES = (@($capabilityProjection.composeProfiles) -join ',')

$composeChainModule = Join-Path $DPF_DIR "scripts\installer\lib\compose-chain.ps1"
if (-not (Test-Path -LiteralPath $composeChainModule)) { throw "compose_chain_helper_missing" }
. $composeChainModule
$composeArgs = Get-DPFComposeArgs -InstallDir $DPF_DIR -IncludeEdge:$includeEdge -IncludeRelease:(Test-Path (Join-Path $DPF_DIR "docker-compose.release.yml"))

docker compose @composeArgs up -d

# --- Wait for portal health ---------------------------------------------------
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
    # --- Auto-seed MCP token to worktrees (graceful skip if not installed) ------
    $seedScript = Join-Path $DPF_DIR "scripts\seed-worktree-mcp.ps1"
    if (Test-Path $seedScript) {
        if (Get-Command claude -ErrorAction SilentlyContinue) {
            Write-Host "Auto-seeding MCP token to worktrees..." -ForegroundColor Cyan
            try {
                & $seedScript
            } catch {
                Write-Host "[!] MCP seed failed (non-fatal): $_" -ForegroundColor Yellow
            }
        } else {
            Write-Host "[!] Claude Code CLI not found -- skipping MCP auto-seed." -ForegroundColor Yellow
            Write-Host "    Install Claude Code then run: .\scripts\seed-worktree-mcp.ps1" -ForegroundColor Yellow
        }
    }
}

if (-not $NoBrowser) {
    Start-Process "http://localhost:3000"
    Write-Host "Digital Product Factory is running at http://localhost:3000" -ForegroundColor Green
}
