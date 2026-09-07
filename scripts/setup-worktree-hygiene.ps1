# scripts/setup-worktree-hygiene.ps1
#
# BI-5F4F0146 - Worktree hygiene for every Windows DPF install surface
# (fresh-install.ps1, setup.ps1, install-dpf.ps1). Single source of truth so the
# surfaces do not each carry their own copy. Idempotent and best-effort: a hygiene
# step must never fail an install.
#
#   1. Register the worktree janitor as a daily scheduled task so merged+clean
#      worktrees are reaped automatically. Unreaped, they accumulate into the
#      hundreds; each carries a real node_modules tree, and Windows Search + Defender
#      real-time scanning then thrash the host.
#   2. Exclude the worktree base from Defender real-time scanning (the big
#      node_modules perf killer). Needs admin; best-effort with a printed fallback.
#
# Usage: & scripts\setup-worktree-hygiene.ps1 -RepoRoot <path>
param([string]$RepoRoot = (Split-Path $PSScriptRoot -Parent))

$wtBase = Join-Path (Split-Path $RepoRoot -Parent) 'dpf-worktrees'
try { New-Item -ItemType Directory -Force -Path $wtBase | Out-Null } catch {}

# -- 1) Janitor scheduled task (idempotent via -Force) ---------------------------
try {
    $node = (Get-Command node -ErrorAction Stop).Source
    $janitor = Join-Path $RepoRoot 'scripts\worktree-janitor.mjs'
    $arg = "`"$janitor`" --root `"$RepoRoot`" --grace-days 14 --live --tier-a-only"
    $action = New-ScheduledTaskAction -Execute $node -Argument $arg
    $trigger = New-ScheduledTaskTrigger -Daily -At '3:00AM'
    Register-ScheduledTask -TaskName 'DPF Worktree Janitor' -Action $action -Trigger $trigger -Force -ErrorAction Stop | Out-Null
    Write-Host "  worktree janitor scheduled (daily, merged+clean only)"
} catch {
    Write-Host "  worktree janitor task not registered (non-fatal): $_"
}

# -- 2) Defender exclusion for the worktree base (needs admin) --------------------
try {
    Add-MpPreference -ExclusionPath $wtBase -ErrorAction Stop
    Write-Host "  excluded the worktree base from Defender real-time scanning"
} catch {
    Write-Host "  Defender exclusion needs admin (non-fatal) - run elevated: Add-MpPreference -ExclusionPath '$wtBase'"
}
