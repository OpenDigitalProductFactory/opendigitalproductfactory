# sync-mcp-worktrees.ps1
#
# Creates a hardlink to D:\DPF\.mcp.json in every D-drive git worktree so
# that all Claude Code sessions share a single token source.
#
# Run this after creating a new worktree. You do NOT need to run this after
# token rotation — token rotation only requires updating the env var (see below).
#
# Usage:
#   .\scripts\sync-mcp-worktrees.ps1
#
# Token rotation workflow (applies to both Claude Code and Codex):
#   1. Admin > Platform Development > generate new token
#   2. [System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', '<new-token>', 'User')
#   3. Restart open Claude Code sessions
#   That's it. No file edits. No re-registration.
#
# How it works:
#   D:\DPF\.mcp.json references ${DPF_MCP_BEARER_TOKEN} (env var) instead of
#   a hardcoded token. Claude Code expands it at session start. Codex does the
#   same via bearer_token_env_var = "DPF_MCP_BEARER_TOKEN" in ~/.codex/config.toml.
#
#   Since .mcp.json is gitignored, each worktree needs its own copy. A hard link
#   makes every worktree point at the same file as D:\DPF\.mcp.json — one file,
#   many paths, zero token duplication.
#
#   C-drive Codex worktrees are skipped (cross-volume hard links are not supported).

param(
    [string]$RepoRoot = "D:\DPF"
)

$source = Join-Path $RepoRoot ".mcp.json"

if (-not (Test-Path $source)) {
    Write-Error ".mcp.json not found at $source"
    exit 1
}

# Verify env var is set
$token = [System.Environment]::GetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', 'User')
if (-not $token) {
    Write-Warning "DPF_MCP_BEARER_TOKEN is not set. Claude Code sessions will fail to authenticate."
    Write-Warning "Set it with: [System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', '<token>', 'User')"
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
    Write-Host "Done — $created worktrees synced. Restart any open Claude Code sessions." -ForegroundColor Green
} else {
    Write-Host "Done — $created synced, $failed failed. Check the worktree paths above." -ForegroundColor Yellow
}
