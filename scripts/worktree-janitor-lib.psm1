# scripts/worktree-janitor-lib.psm1
#
# DPF Worktree Hygiene — janitor library (Phase 1).
#
# Spec: docs/superpowers/specs/2026-05-16-worktree-hygiene-design.md
# Plan: docs/superpowers/plans/2026-05-16-worktree-hygiene-plan.md
# BI:   BI-E5002629 (EP-DR-HARDENING-2026-05-23)
#
# Pure predicates + registry. NO removal behavior — this module is purely
# a "would you remove this?" question-answerer. Phase 5 of the plan flips
# the dispatcher's DryRun default to false; until then nothing here ever
# mutates state. All functions are side-effect-free except Write-JanitorLog
# (which only appends to a log file the operator can rotate).
#
# Cross-platform note: this module is Windows-first per spec §9.3.
# Bash / launchd / systemd siblings are tracked as follow-up under spec §10.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ─── Registry (spec §3 + §9.1) ───────────────────────────────────────────────
#
# ManagedRoots: directories the janitor OWNS — it may remove entries here.
# InventoryOnlyRoots: directories the janitor INVENTORIES — never removes,
# only reports. These are operator-owned (sibling dirs like D:\DPF-<topic>
# the operator may create manually, plus other agents' worktree trees).

$script:ManagedRoots = @(
    'D:\DPF\.claude\worktrees',
    'D:\DPF\.worktrees'
)

$script:InventoryOnlyRoots = @(
    'D:\DPF-*',
    (Join-Path $env:USERPROFILE '.codex\worktrees')
)

# Per spec §4.3 invariant 4 — best-effort editor-open detection. Process
# names from Get-Process; we filter by .Path matching any worktree we'd
# remove. List drawn from spec §4.3.4 + observed Windows editor binaries.
$script:EditorProcessNames = @(
    'Code', 'Cursor', 'windsurf',
    'idea64', 'rider64', 'goland64', 'pycharm64',
    'clion64', 'webstorm64', 'phpstorm64', 'rubymine64', 'datagrip64',
    'pwsh', 'powershell'
)

# Age threshold for sweep-mode abandonment (spec §4.3 invariant 1 +
# memory feedback_idle_is_not_abandoned.md — 7 days absorbs Mark's travel
# + weekly rate-limit resets).
$script:DefaultAbandonAgeDays = 7

# Branch-prefix allowlist for sweep-mode auto-delete (spec §4.4). Branches
# matching these prefixes AND merged to origin/main AND with no worktree
# may be auto-deleted. Anything else gets flagged for operator review.
$script:AutoDeleteBranchPrefixRegex = '^(feat|fix|doc|spec|plan|chore)/'

# ─── Exported accessors for the registry (tests + dispatcher consume these) ──

function Get-ManagedRoots {
    return ,@($script:ManagedRoots)
}

function Get-InventoryOnlyRoots {
    return ,@($script:InventoryOnlyRoots)
}

function Get-EditorProcessNames {
    return ,@($script:EditorProcessNames)
}

# ─── Test-PathUnderManagedRoot ───────────────────────────────────────────────
#
# Returns $true when the given path lives under a managed root (the janitor
# is allowed to remove it). Wildcard-aware so InventoryOnlyRoots like
# 'D:\DPF-*' Just Work — but those are NOT managed roots; only entries in
# $script:ManagedRoots qualify. Path matching is case-insensitive on
# Windows; we normalize via [IO.Path]::GetFullPath when the path exists,
# falling back to string compare for non-existent paths (test fixtures).

function Test-PathUnderManagedRoot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string] $Path,
        [string[]] $ManagedRoots = $script:ManagedRoots
    )

    $normalized = if (Test-Path -LiteralPath $Path) {
        [IO.Path]::GetFullPath($Path)
    } else {
        # Strip trailing slashes for a fair compare with non-existent fixture paths.
        $Path.TrimEnd('\', '/')
    }

    foreach ($root in $ManagedRoots) {
        $rootNorm = if (Test-Path -LiteralPath $root) {
            [IO.Path]::GetFullPath($root)
        } else {
            $root.TrimEnd('\', '/')
        }
        $rootWithSep = $rootNorm.TrimEnd('\', '/') + '\'
        if ($normalized.StartsWith($rootWithSep, [StringComparison]::OrdinalIgnoreCase) -or
            [string]::Equals($normalized, $rootNorm, [StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

# ─── Test-WorktreeIsClean ────────────────────────────────────────────────────
#
# Returns $true when `git status --porcelain` is empty for the given
# worktree. Returns $false on any non-clean state or on git error
# (fail-closed — never report "clean" when we can't actually tell).
# A worktree that's not a real git checkout returns $false.

function Test-WorktreeIsClean {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string] $Path
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return $false
    }
    try {
        $status = & git -C $Path status --porcelain 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        return [string]::IsNullOrWhiteSpace(($status -join "`n"))
    } catch {
        return $false
    }
}

# ─── Test-WorktreeBranchMergedToOriginMain ───────────────────────────────────
#
# Returns $true when the worktree's HEAD branch is reachable from
# origin/main (i.e., all its commits have been merged). False on any
# non-merged or error state.
#
# Note: we deliberately compare against origin/main not local main per
# memory feedback_worktree_base_origin_main.md.

function Test-WorktreeBranchMergedToOriginMain {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string] $Path
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return $false
    }
    try {
        # `git branch --merged origin/main` lists branches reachable from origin/main.
        # We check whether the worktree's current branch appears.
        $branch = (& git -C $Path branch --show-current 2>$null).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
            return $false
        }
        # Detached HEAD: no branch to evaluate. Treat as not-merged so the
        # operator decides.
        if ($branch -eq '') { return $false }

        $merged = & git -C $Path branch --merged origin/main --format='%(refname:short)' 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        return ($merged -split "`n" | ForEach-Object { $_.Trim() }) -contains $branch
    } catch {
        return $false
    }
}

# ─── Test-EditorOpenAt ───────────────────────────────────────────────────────
#
# Best-effort: scan running processes whose name is in $EditorProcessNames
# and whose .Path begins with the given worktree path. A positive hit
# means "an editor has this dir open" — the janitor must NOT touch it
# (file locks on Windows; spec §4.3.4).
#
# Note: process .Path is the EXE location, not the open document. This
# catches the common case where the operator launched the editor from
# inside the worktree (`code .` etc.); it does NOT catch a centrally-
# launched editor that happens to have the worktree open. The dispatcher
# layer handles the false-negative via the file-lock check during the
# actual `git worktree remove`.

function Test-EditorOpenAt {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string] $Path,
        [string[]] $EditorProcessNames = $script:EditorProcessNames
    )
    $normalized = if (Test-Path -LiteralPath $Path) {
        [IO.Path]::GetFullPath($Path)
    } else {
        $Path.TrimEnd('\', '/')
    }
    $prefix = $normalized.TrimEnd('\', '/') + '\'
    try {
        $procs = Get-Process -ErrorAction SilentlyContinue | Where-Object {
            $EditorProcessNames -contains $_.Name -and $_.Path
        }
        foreach ($p in $procs) {
            if ($p.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
                return $true
            }
        }
        return $false
    } catch {
        # Fail-closed: if we can't tell, say "open" so the janitor skips.
        return $true
    }
}

# ─── Test-WorktreeSafeToRemove ───────────────────────────────────────────────
#
# Applies spec §4.3 invariants 1–7 in two modes:
#   - 'exiting': hot path from SessionEnd hook. Skip age check (the session
#                JUST ended; age would be 0 minutes).
#   - 'sweep':   daily scheduled run. Apply age check (default 7 days).
#
# Returns a [PSCustomObject] @{ Safe = bool; Reason = string }.
# Reason is human-readable + included in the JSON log line so the operator
# can audit why something was or wasn't removed.

function Test-WorktreeSafeToRemove {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string] $Path,
        [Parameter(Mandatory)][ValidateSet('exiting', 'sweep')][string] $Mode,
        [int] $AbandonAgeDays = $script:DefaultAbandonAgeDays
    )

    # Invariant 1 (sweep only): must be older than the abandonment threshold.
    if ($Mode -eq 'sweep') {
        if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
            return [PSCustomObject]@{ Safe = $false; Reason = "Path does not exist: $Path" }
        }
        $lastWrite = (Get-Item -LiteralPath $Path).LastWriteTimeUtc
        $ageDays = ((Get-Date).ToUniversalTime() - $lastWrite).TotalDays
        if ($ageDays -lt $AbandonAgeDays) {
            return [PSCustomObject]@{
                Safe   = $false
                Reason = "Worktree last touched $([math]::Round($ageDays, 1))d ago (< $AbandonAgeDays-day abandon threshold)"
            }
        }
    }

    # Invariant 2: must live under a managed root.
    if (-not (Test-PathUnderManagedRoot -Path $Path)) {
        return [PSCustomObject]@{
            Safe   = $false
            Reason = "Path is not under a managed root (inventory-only or operator-owned dir)"
        }
    }

    # Invariant 3: working tree must be clean.
    if (-not (Test-WorktreeIsClean -Path $Path)) {
        return [PSCustomObject]@{
            Safe   = $false
            Reason = "Working tree has uncommitted changes (refusing per never-lose-work invariant)"
        }
    }

    # Invariant 4: no editor process must have the path open.
    if (Test-EditorOpenAt -Path $Path) {
        return [PSCustomObject]@{
            Safe   = $false
            Reason = "An editor process (Get-Process) has this path open"
        }
    }

    # Invariant 5: branch must be merged to origin/main.
    if (-not (Test-WorktreeBranchMergedToOriginMain -Path $Path)) {
        return [PSCustomObject]@{
            Safe   = $false
            Reason = "Worktree's branch is not reachable from origin/main (unmerged work)"
        }
    }

    # Invariants 6 + 7 are dispatcher-layer (file-lock during actual remove;
    # post-remove verification). Library-layer says safe.
    return [PSCustomObject]@{ Safe = $true; Reason = "All invariants satisfied" }
}

# ─── Test-BranchSafeToDelete ─────────────────────────────────────────────────
#
# Sweep-mode predicate for orphan branches (branches without a worktree).
# Implements spec §4.4 predicates 1–4. Returns @{ Safe = bool; Reason = string }.
# Refuses on branches whose names don't match the auto-delete prefix
# allowlist — operator must delete those by hand.

function Test-BranchSafeToDelete {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string] $Branch,
        [Parameter(Mandatory)][ValidateSet('sweep')][string] $Mode,
        [Parameter(Mandatory)][string] $RepoPath
    )

    # Predicate 1: prefix must be on the allowlist.
    if ($Branch -notmatch $script:AutoDeleteBranchPrefixRegex) {
        return [PSCustomObject]@{
            Safe   = $false
            Reason = "Branch '$Branch' has a non-allowlisted prefix (auto-delete is gated to feat|fix|doc|spec|plan|chore)"
        }
    }

    # Predicate 2: the branch must not be checked out by any current worktree.
    try {
        $worktreeBranches = & git -C $RepoPath worktree list --porcelain 2>$null |
            Where-Object { $_ -match '^branch ' } |
            ForEach-Object { ($_ -replace '^branch ', '').Trim() -replace '^refs/heads/', '' }
        if ($LASTEXITCODE -ne 0) {
            return [PSCustomObject]@{ Safe = $false; Reason = "git worktree list failed" }
        }
        if ($worktreeBranches -contains $Branch) {
            return [PSCustomObject]@{
                Safe   = $false
                Reason = "Branch '$Branch' is currently checked out by a worktree"
            }
        }
    } catch {
        return [PSCustomObject]@{ Safe = $false; Reason = "git worktree list errored: $_" }
    }

    # Predicate 3: branch must be merged to origin/main.
    try {
        $merged = & git -C $RepoPath branch --merged origin/main --format='%(refname:short)' 2>$null
        if ($LASTEXITCODE -ne 0) {
            return [PSCustomObject]@{ Safe = $false; Reason = "git branch --merged origin/main failed" }
        }
        if (-not (($merged -split "`n" | ForEach-Object { $_.Trim() }) -contains $Branch)) {
            return [PSCustomObject]@{
                Safe   = $false
                Reason = "Branch '$Branch' not reachable from origin/main (unmerged commits)"
            }
        }
    } catch {
        return [PSCustomObject]@{ Safe = $false; Reason = "merge check errored: $_" }
    }

    # Predicate 4: branch must not be the current HEAD of $RepoPath.
    try {
        $currentBranch = (& git -C $RepoPath branch --show-current 2>$null).Trim()
        if ($LASTEXITCODE -ne 0) {
            return [PSCustomObject]@{ Safe = $false; Reason = "git branch --show-current failed" }
        }
        if ($currentBranch -eq $Branch) {
            return [PSCustomObject]@{
                Safe   = $false
                Reason = "Branch '$Branch' is currently HEAD of $RepoPath"
            }
        }
    } catch {
        return [PSCustomObject]@{ Safe = $false; Reason = "HEAD check errored: $_" }
    }

    return [PSCustomObject]@{ Safe = $true; Reason = "All predicates satisfied" }
}

# ─── Get-OrphanDirectoryAction ───────────────────────────────────────────────
#
# Implements spec §4.5: a filesystem directory under a managed root that
# git no longer tracks as a worktree.
#   - 'remove' when the directory is empty or contains only a stale .git
#     reference (worktree was removed properly, dir left behind).
#   - 'flag'   when the directory has user data (operator must review).
#   - 'skip'   when not under a managed root in the first place.

function Get-OrphanDirectoryAction {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string] $Path
    )

    if (-not (Test-PathUnderManagedRoot -Path $Path)) {
        return [PSCustomObject]@{ Action = 'skip'; Reason = "Path not under a managed root" }
    }

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return [PSCustomObject]@{ Action = 'skip'; Reason = "Path does not exist" }
    }

    try {
        # Force-array via @(...) so .Count works even when Get-ChildItem
        # returns a single scalar (PowerShell unwraps one-element arrays).
        $entries = @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop)
    } catch {
        return [PSCustomObject]@{ Action = 'flag'; Reason = "Could not enumerate: $_" }
    }

    # Empty dir → safe to remove.
    if ($entries.Count -eq 0) {
        return [PSCustomObject]@{ Action = 'remove'; Reason = "Directory is empty" }
    }

    # Only-a-.git-file dir (a worktree whose registration is gone but the
    # .git pointer file remained) → safe to remove. We check for the typical
    # worktree shape: a single .git FILE (not directory) pointing at the
    # main repo's worktrees/ entry.
    if ($entries.Count -eq 1 -and $entries[0].Name -eq '.git' -and -not $entries[0].PSIsContainer) {
        return [PSCustomObject]@{ Action = 'remove'; Reason = "Directory contains only a stale .git pointer file" }
    }

    # Anything else → operator must look.
    return [PSCustomObject]@{
        Action = 'flag'
        Reason = "Directory has $($entries.Count) entries (operator review required)"
    }
}

# ─── Write-JanitorLog ────────────────────────────────────────────────────────
#
# Append a JSON-line entry to the janitor's audit log. Per spec §4.7:
#   - One JSON object per line for trivial grep + jq parsing.
#   - Each entry stamped with timestamp + mode + action + path + reason.
#   - Log file rotated when it crosses 5 MB; up to 30 days of history kept.
#
# The rotation rule is implemented here so every caller automatically
# inherits it; the dispatcher does not have to remember to rotate.

function Write-JanitorLog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][hashtable] $Action,
        [Parameter(Mandatory)][string] $LogPath,
        [int] $MaxSizeBytes = 5MB,
        [int] $RetentionDays = 30
    )

    # Stamp the entry with a UTC timestamp if the caller didn't.
    if (-not $Action.ContainsKey('timestamp')) {
        $Action['timestamp'] = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    }

    # Ensure the log dir exists.
    $logDir = Split-Path -Parent $LogPath
    if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    # Rotate if oversized. Move existing log to .<yyyy-MM-dd>.log; trim
    # rotated files older than RetentionDays.
    if (Test-Path -LiteralPath $LogPath) {
        $size = (Get-Item -LiteralPath $LogPath).Length
        if ($size -ge $MaxSizeBytes) {
            $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd-HHmmss')
            $rotated = "$LogPath.$stamp.log"
            Move-Item -LiteralPath $LogPath -Destination $rotated -Force
        }
    }

    # Trim old rotated files.
    if ($logDir -and (Test-Path -LiteralPath $logDir)) {
        $cutoff = (Get-Date).AddDays(-$RetentionDays)
        Get-ChildItem -LiteralPath $logDir -Filter "$(Split-Path -Leaf $LogPath).*.log" -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt $cutoff } |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
    }

    # Append the JSON line.
    $json = $Action | ConvertTo-Json -Compress -Depth 5
    Add-Content -LiteralPath $LogPath -Value $json -Encoding UTF8
}

Export-ModuleMember -Function `
    Get-ManagedRoots, `
    Get-InventoryOnlyRoots, `
    Get-EditorProcessNames, `
    Test-PathUnderManagedRoot, `
    Test-WorktreeIsClean, `
    Test-WorktreeBranchMergedToOriginMain, `
    Test-EditorOpenAt, `
    Test-WorktreeSafeToRemove, `
    Test-BranchSafeToDelete, `
    Get-OrphanDirectoryAction, `
    Write-JanitorLog
