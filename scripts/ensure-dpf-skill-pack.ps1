# Open Digital Product Factory -- contributor plugin installer (Windows)
#
# DEPRECATED SHIM (since 2026-05-27, BI-4B17051B Phase 3).
#
# This script is preserved as a backward-compatibility shim for callers that
# invoke `scripts/ensure-dpf-skill-pack.ps1` (worktree seed scripts, custom
# operator workflows). The canonical entry point is now:
#
#     scripts/dpf-bootstrap-agent-toolchain.ps1
#
# which covers Claude Code AND Codex CLI AND kernel-memory seeding AND a
# functional readiness probe, with idempotent state persistence in
# ~/.dpf/install-state.json.
#
# This shim execs the new script and forwards $RepoRoot. It will be removed
# one release cycle after Phase 3 lands.

param(
    [string]$RepoRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$newScript = Join-Path $scriptDir "dpf-bootstrap-agent-toolchain.ps1"

if (-not (Test-Path -LiteralPath $newScript)) {
    Write-Host "  [FAIL] dpf-bootstrap-agent-toolchain.ps1 missing at $newScript" -ForegroundColor Red
    exit 1
}

& $newScript -RepoRoot $RepoRoot
exit $LASTEXITCODE
