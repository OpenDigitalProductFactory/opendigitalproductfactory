#Requires -Version 5.1
# scripts/hooks/worktree-freshness.ps1
#
# SessionStart freshness advisory (Windows). Counterpart of worktree-freshness.sh.
#
# Why: a topic worktree whose base is a stale `main` is the root cause of the
# worst git accidents in this repo. When `main` has moved far past the worktree's
# base AND the checkout is a shallow clone, a bare `git rebase origin/main`
# cannot find the merge-base and replays thousands of phantom commits, unwinding
# the working tree; a stale base also carries obsolete files (e.g. a since-migrated
# baseline) that surface as modify/delete conflicts at PR time. This hook warns
# the agent at session start, BEFORE any implementation, so the base is refreshed
# first -- and prints the shallow-safe `git rebase --onto` incantation.
#
# Invoked by the .claude/settings.json SessionStart hook via run-hook.mjs.
# Advisory only. Exit 0 ALWAYS -- a freshness check must never block startup.
# Advisory text is written to stdout, which Claude Code adds to session context.
# Set DPF_SKIP_WORKTREE_FRESHNESS=1 to silence. Plain ASCII per AGENTS.md.
#
# Uses only refs already present locally (no network / no fetch), so it is fast
# and can never hang startup; it judges against the LAST-known origin/main and
# tells the reader to `git fetch` to refresh.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'  # never throw out of a hook

try {
    if ($env:DPF_SKIP_WORKTREE_FRESHNESS -eq '1') { exit 0 }

    # Drain stdin (payload unused) so the launcher's pipe never blocks.
    [void][Console]::In.ReadToEnd()

    # Capture git stdout as a trimmed string, ignoring stderr. Two Windows-
    # PowerShell footguns are deliberately avoided here:
    #   1. Body: assign `$out = & git @GitArgs 2>$null` -- do NOT write
    #      `return (& git ... 2>$null)`; the redirect inside a parenthesized
    #      call operator silently swallows stdout inside a function.
    #   2. Calls: pass args as an ARRAY LITERAL @('rev-parse','--flag'); a bare
    #      `Git rev-parse --flag` lets PowerShell try to bind `--flag` as a
    #      parameter of the function. (git contention can also make a call return
    #      empty; an empty result simply makes the hook exit quietly -- safe.)
    function Git {
        param([string[]]$GitArgs)
        $out = & git @GitArgs 2>$null
        if ($null -eq $out) { return '' }
        return (($out -join "`n").Trim())
    }

    if ((Git @('rev-parse','--is-inside-work-tree')) -ne 'true') { exit 0 }

    $branch = (Git @('rev-parse','--abbrev-ref','HEAD'))
    if ($branch -eq 'main' -or $branch -eq 'HEAD') { exit 0 }

    # Only advise inside a *linked* worktree: --git-dir differs from --git-common-dir.
    $gitdir    = (Git @('rev-parse','--git-dir'))
    $commondir = (Git @('rev-parse','--git-common-dir'))
    if ($gitdir -and $gitdir -eq $commondir) { exit 0 }

    # Need a local origin/main ref to judge against (empty = absent).
    if ([string]::IsNullOrWhiteSpace((Git @('rev-parse','--verify','origin/main')))) { exit 0 }

    $shallow   = (Git @('rev-parse','--is-shallow-repository'))
    $mergebase = (Git @('merge-base','HEAD','origin/main'))
    $behindRaw = (Git @('rev-list','--count','HEAD..origin/main'))

    $BehindThreshold = 40
    $stale  = $false
    $reason = ''
    if ([string]::IsNullOrWhiteSpace($mergebase)) {
        $stale  = $true
        $reason = 'no common ancestor with origin/main (base is stale or beyond this shallow clone''s history horizon)'
    }
    else {
        $behind = 0
        if ([int]::TryParse(("$behindRaw").Trim(), [ref]$behind) -and $behind -gt $BehindThreshold) {
            $stale  = $true
            $reason = "the base trails origin/main by ~$behind commits"
        }
    }

    if (-not $stale) { exit 0 }

    Write-Output "WARNING: DPF WORKTREE FRESHNESS -- this worktree ($branch) looks stale:"
    Write-Output "    $reason."
    Write-Output 'Refresh the base BEFORE implementing or opening a PR:'
    Write-Output '    git fetch origin main'
    if ($shallow -eq 'true') {
        Write-Output "This is a SHALLOW clone -- do NOT run a bare 'git rebase origin/main'."
        Write-Output 'With no visible merge-base it replays thousands of phantom commits and'
        Write-Output 'unwinds your tree. Rebase only your own commits onto current main:'
        Write-Output '    git rebase --onto origin/main <the-commit-you-branched-from>'
        Write-Output "(abort with 'git rebase --abort' if a rebase ever balloons past your commit count.)"
    }
    else {
        Write-Output 'Rebase your commits onto current main:  git rebase origin/main'
    }
    Write-Output 'See AGENTS.md section 4 (Branching) -> worktree freshness. Silence: DPF_SKIP_WORKTREE_FRESHNESS=1.'
}
catch {
    # never fail a session start
}
exit 0
