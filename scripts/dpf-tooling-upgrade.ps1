#Requires -Version 5.1
# scripts/dpf-tooling-upgrade.ps1
#
# Operator-triggered "quiesce-for-tooling-upgrade" routine (Windows).
#
# Spec: docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-
#       alignment-design.md S4.2 ("Upgrade windows") + decision #2
#       ("Tooling-upgrade authority -> operator-triggered"). The WindowsApps
#       Store Codex package CANNOT update while running, and three generations
#       of per-session app-server / node_repl / npx MCP sidecars are never
#       reaped -- so they pin the package against upgrade. This routine drains
#       active surface sessions, reaps the orphaned sidecars, then prints the
#       next steps so the operator can update Claude Code / Codex and resume.
#
# OPERATOR-TRIGGERED ONLY. There is NO scheduling. The operator runs this
# explicitly when they intend to upgrade the host tools, per decision #2
# (never-ask-the-user + destructive-actions-require-explicit-go). Because it
# terminates the operator's interactive CLI sessions, it requires an explicit
# -Confirm (or -Force) and a clear pre-flight summary.
#
# It does NOT touch docker, the portal, or any database -- only the host CLI
# tool processes and their sidecars. Plain ASCII only per AGENTS.md.

param(
    # Skip the interactive confirmation. Use in an unattended operator runbook
    # only; the routine still prints what it terminates.
    [switch]$Force,
    # Plan-only: list the processes that WOULD be terminated and exit.
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'

function Write-Step { param($msg) Write-Host "  [..] $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  [WARN] $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "-> DPF tooling-upgrade quiesce (operator-triggered)" -ForegroundColor Yellow
Write-Host "   Drains host agent sessions + reaps orphaned sidecars so the" -ForegroundColor DarkGray
Write-Host "   Codex (Store) package and Claude Code can update." -ForegroundColor DarkGray
Write-Host ""

# --- 1. Discover the host agent surface processes + sidecars -----------------
#
# Surface processes (interactive CLIs the operator is running) and their
# per-session sidecars. The WindowsApps Store Codex package is what we are
# freeing for upgrade, so app-server / node_repl / npx MCP children are
# explicitly in scope.
$surfaceNames = @('Codex', 'claude')
$sidecarNames = @('app-server', 'node_repl')

# node/npx are reaped only when their command line references a DPF path, to
# avoid killing unrelated node processes on the operator's machine.
$dpfPathHints = @('\DPF', '/DPF', 'dpf-platform', '.codex', '\.claude')

$targets = @()

try {
    $all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    foreach ($p in $all) {
        $base = ($p.Name -replace '\.exe$','')
        $cmd  = [string]$p.CommandLine
        $isSurface = $surfaceNames -contains $base
        $isSidecar = $sidecarNames -contains $base
        $isNodeish = @('node','npx') -contains $base
        $refsDpf = $false
        if ($cmd) {
            foreach ($h in $dpfPathHints) { if ($cmd -like "*$h*") { $refsDpf = $true; break } }
        }
        if ($isSurface -or $isSidecar -or ($isNodeish -and $refsDpf)) {
            $targets += [pscustomobject]@{
                Pid  = $p.ProcessId
                Name = $p.Name
                Kind = if ($isSurface) { 'surface' } elseif ($isSidecar) { 'sidecar' } else { 'node-sidecar' }
            }
        }
    }
} catch {
    Write-Warn "Could not enumerate processes (WMI unavailable); nothing to reap."
}

if ($targets.Count -eq 0) {
    Write-Ok "No active host agent sessions or orphaned sidecars found."
    Write-Host ""
    Write-Host "  Tools are already quiesced. You may update Claude Code / Codex now." -ForegroundColor White
    Write-Host ""
    exit 0
}

Write-Step "Found $($targets.Count) process(es) to drain/reap:"
$targets | Sort-Object Kind, Name | ForEach-Object {
    Write-Host ("    {0,-13} {1,-14} pid {2}" -f $_.Kind, $_.Name, $_.Pid) -ForegroundColor DarkGray
}
Write-Host ""

if ($DryRun) {
    Write-Ok "DRY-RUN: no processes terminated."
    exit 0
}

# --- 2. Confirm (operator-triggered, explicit go) ----------------------------
if (-not $Force) {
    Write-Warn "This terminates your interactive Claude Code / Codex sessions."
    $answer = Read-Host "  Proceed with quiesce-for-upgrade? (y/N)"
    if ($answer -notmatch '^[Yy]') {
        Write-Host "  Aborted; no processes terminated." -ForegroundColor Yellow
        exit 0
    }
}

# --- 3. Reap (sidecars first, then surfaces) ---------------------------------
$reaped = 0
foreach ($t in ($targets | Sort-Object @{ Expression = { if ($_.Kind -eq 'surface') { 1 } else { 0 } } })) {
    try {
        Stop-Process -Id $t.Pid -Force -ErrorAction Stop
        $reaped++
    } catch {
        Write-Warn "Could not terminate $($t.Name) (pid $($t.Pid)): $($_.Exception.Message)"
    }
}
Write-Ok "Reaped $reaped of $($targets.Count) process(es)."

# --- 4. Next steps -----------------------------------------------------------
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Tooling quiesced -- safe to upgrade." -ForegroundColor White
Write-Host "  Next steps:" -ForegroundColor Yellow
Write-Host "    1. Update Codex via the Microsoft Store (it can update now that" -ForegroundColor White
Write-Host "       its app-server/node_repl sidecars are gone)." -ForegroundColor White
Write-Host "    2. Update Claude Code (e.g. its installer/updater)." -ForegroundColor White
Write-Host "    3. Resume: open a session in your worktree and run" -ForegroundColor White
Write-Host "       scripts/dpf-bootstrap-agent-toolchain.ps1 to re-converge the" -ForegroundColor White
Write-Host "       DPF-scoped client profile + reconnect the DPF MCP." -ForegroundColor White
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

exit 0
