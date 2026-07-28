#Requires -Version 5.1
# scripts/hooks/janitor-throttle.ps1
#
# SessionStart janitor-throttle advisory (Windows). Counterpart of janitor-throttle.sh.
#
# Why: scripts/worktree-janitor.sh (merged/stale worktree + branch cleanup) and
# scripts/windows-temp-cleanup.ps1 (WSL crash dump / orphaned swap.vhdx cleanup)
# are both correct and safe, but nothing ran them automatically -- so worktrees,
# branches, and orphaned WSL crash dumps accumulated for days between manual
# sweeps (378 worktrees / 1928 branches / 60GB of crash dumps in one observed
# case). A blind host-level Scheduled Task was explicitly rejected in favor of
# throttled-by-interaction: advise at most once per DPF_JANITOR_THROTTLE_HOURS
# (default 24), and only as a side effect of an agent session actually
# starting -- never on a machine nobody is using, never on every thread.
#
# ADVISORY ONLY, matching worktree-freshness.ps1's contract: this hook never
# runs the cleanup itself (SessionStart hooks are not the place for a
# multi-minute destructive sweep across hundreds of worktrees) -- it tells the
# AGENT to run it, at the top of the session, before user work begins. The
# debounce marker is written optimistically when the advisory fires, not when
# the agent actually complies -- if a session ignores the advisory, the worst
# case is one more day of normal sprawl before the next session is asked again.
#
# Marker lives under the shared --git-common-dir so every worktree of this
# clone (regardless of which one happens to start a session next) agrees on
# the same "last advised" timestamp.
#
# Invoked by the .claude/settings.json SessionStart hook via run-hook.mjs.
# Exit 0 ALWAYS -- must never block a session from starting.
# Set DPF_SKIP_JANITOR_THROTTLE=1 to silence permanently on this machine.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'  # never throw out of a hook

try {
    if ($env:DPF_SKIP_JANITOR_THROTTLE -eq '1') { exit 0 }

    # Drain stdin (payload unused) so the launcher's pipe never blocks.
    [void][Console]::In.ReadToEnd()

    function Git {
        param([string[]]$GitArgs)
        $out = & git @GitArgs 2>$null
        if ($null -eq $out) { return '' }
        return (($out -join "`n").Trim())
    }

    if ((Git @('rev-parse','--is-inside-work-tree')) -ne 'true') { exit 0 }

    $commondir = (Git @('rev-parse','--git-common-dir'))
    if ([string]::IsNullOrWhiteSpace($commondir)) { exit 0 }

    $marker = Join-Path $commondir 'dpf-janitor-last-advised'
    $throttleHours = 24
    if ($env:DPF_JANITOR_THROTTLE_HOURS) {
        $parsed = 0
        if ([int]::TryParse($env:DPF_JANITOR_THROTTLE_HOURS, [ref]$parsed) -and $parsed -gt 0) { $throttleHours = $parsed }
    }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

    if (Test-Path -LiteralPath $marker) {
        $lastRaw = Get-Content -LiteralPath $marker -ErrorAction SilentlyContinue | Select-Object -First 1
        $last = 0
        [void][long]::TryParse($lastRaw, [ref]$last)
        $elapsed = $now - $last
        if ($elapsed -lt ($throttleHours * 3600)) { exit 0 }
    }

    # Fire the advisory, then mark it optimistically (see header).
    Set-Content -LiteralPath $marker -Value $now -ErrorAction SilentlyContinue

    Write-Output "DPF HOUSEKEEPING DUE: it has been ${throttleHours}h+ since the last janitor sweep (or none is recorded)."
    Write-Output "Before starting the user's request, run these two safe, idempotent cleanups from the repo root:"
    Write-Output '  1. bash scripts/worktree-janitor.sh --live'
    Write-Output '     (prunes merged/stale worktrees + branches; protects dirty trees, open PRs, and active leases automatically)'
    Write-Output '  2. powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-temp-cleanup.ps1'
    Write-Output '     (clears WSL crash dumps + orphaned/unlocked swap.vhdx files; never touches a locked/in-use file)'
    Write-Output 'Both are safe to run unattended -- report a one-line summary of what was reclaimed, then continue with the user''s actual request.'
    Write-Output 'See AGENTS.md -> Housekeeping. Silence permanently: DPF_SKIP_JANITOR_THROTTLE=1. Adjust cadence: DPF_JANITOR_THROTTLE_HOURS=<n>.'
}
catch {
    # never fail a session start
}
exit 0
