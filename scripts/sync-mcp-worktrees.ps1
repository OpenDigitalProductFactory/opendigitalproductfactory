# sync-mcp-worktrees.ps1
#
# Creates a hardlink to D:\DPF\.mcp.json in every D-drive git worktree so
# that all Claude Code sessions share a single token source.
#
# Run this after:
#   - Rotating the DPF MCP token (Admin > Platform Development > New token)
#   - Creating a new worktree
#
# Usage:
#   .\scripts\sync-mcp-worktrees.ps1
#
# How it works:
#   A Windows hard link makes every .mcp.json point at the same file data
#   as D:\DPF\.mcp.json. Editing the source file (changing the token) is
#   immediately visible to every worktree — no re-registration required.
#   This mirrors how Codex works: update .mcp.json = done.
#
# Note: C-drive Codex worktrees are skipped (cross-volume hard links are
# not supported on Windows). Codex manages its own worktrees independently.

param(
    [string]$RepoRoot = "D:\DPF"
)

$source = Join-Path $RepoRoot ".mcp.json"

if (-not (Test-Path $source)) {
    Write-Error ".mcp.json not found at $source — generate a token in Admin > Platform Development first."
    exit 1
}

Write-Host "Source: $source"
Write-Host ""

$lines = git -C $RepoRoot worktree list --porcelain
$worktrees = @()
foreach ($line in $lines) {
    if ($line -match "^worktree (.+)$") {
        $path = $matches[1].Replace("/", "\")
        # Skip main repo (has the real file) and C-drive worktrees (cross-volume)
        if ($path -match "^D:\\" -and $path -ne $RepoRoot) {
            $worktrees += $path
        }
    }
}

Write-Host "Found $($worktrees.Count) worktrees to sync"
Write-Host ""

$created = 0; $failed = 0
foreach ($wt in $worktrees) {
    $link = Join-Path $wt ".mcp.json"
    if (Test-Path $link) { Remove-Item $link -Force }
    & fsutil hardlink create $link $source | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $created++
        Write-Host "  [ok] $wt"
    } else {
        $failed++
        Write-Host "  [!!] FAILED: $wt"
    }
}

Write-Host ""
if ($failed -eq 0) {
    Write-Host "Done — $created worktrees synced. Restart any open Claude Code sessions to pick up the new token." -ForegroundColor Green
} else {
    Write-Host "Done — $created synced, $failed failed. Check the worktree paths above." -ForegroundColor Yellow
}
