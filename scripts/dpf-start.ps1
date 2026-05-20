param(
    [string]$DPF_DIR = $PSScriptRoot,
    [switch]$NoBrowser
)

Set-Location $DPF_DIR

# Always bring the Edge Node overlay up alongside the platform so the bundled
# single-host install includes network discovery. The overlay is harmless
# when no enrolled node exists yet (edge-node will retry enrollment until the
# operator wires DPF_BOOTSTRAP_TOKEN via .\scripts\fresh-install.ps1 or the
# Admin > Platform Development > Edge Nodes UI).
# See docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md.
$composeArgs = @("-f", "docker-compose.yml")
if (Test-Path (Join-Path $DPF_DIR "docker-compose.override.yml")) {
    $composeArgs += @("-f", "docker-compose.override.yml")
}
$composeArgs += @("-f", "docker-compose.edge.yml")

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
