# sync-mcp-worktrees.ps1
#
# Full token rotation script for the DPF MCP server in Claude Code.
# Run this whenever you generate a new token in Admin > Platform Development.
#
# Usage:
#   .\scripts\sync-mcp-worktrees.ps1 -Token dpfmcp_XXXX
#
# Also run after creating a new worktree (omit -Token to reuse current token):
#   .\scripts\sync-mcp-worktrees.ps1
#
# What it does:
#   1. Updates D:\DPF\.mcp.json with the new token (in-place, preserving hardlinks)
#   2. Creates/refreshes hardlinks in every D-drive worktree (.mcp.json is gitignored
#      so worktrees don't get it from git; Claude Code reads the git-root-level file only)
#   3. Re-registers the user-scope entry in ~/.claude.json via claude mcp add
#      NOTE: ${ENV_VAR} expansion in HTTP headers is a known open bug in Claude Code
#      (issue #51581) — the literal string is sent, not the value. Token must be hardcoded.
#   4. Reminds you to restart Claude Code (no live session reload exists)
#
# Token rotation workflow:
#   1. Admin > Platform Development > generate new token
#   2. .\scripts\sync-mcp-worktrees.ps1 -Token <new-token>
#   3. Restart Claude Code

param(
    [string]$Token = "",
    [string]$RepoRoot = "D:\DPF"
)

$mcpJsonPath = Join-Path $RepoRoot ".mcp.json"
$mcpUrl = "http://localhost:3000/api/mcp/v1"

# ── Step 1: Resolve token ─────────────────────────────────────────────────────

if (-not $Token) {
    if (Test-Path $mcpJsonPath) {
        $content = Get-Content $mcpJsonPath -Raw
        if ($content -match '"Bearer (dpfmcp_[A-Z0-9]+)"') {
            $Token = $matches[1]
            Write-Host "Using existing token from .mcp.json: $($Token.Substring(0,16))..."
        }
    }
    if (-not $Token) {
        Write-Error "No token found. Supply one: .\sync-mcp-worktrees.ps1 -Token dpfmcp_XXXX"
        exit 1
    }
}

# ── Step 2: Update .mcp.json in-place ────────────────────────────────────────

Write-Host "Updating $mcpJsonPath..."
$newContent = "{`n  `"mcpServers`": {`n    `"dpf`": {`n      `"url`": `"$mcpUrl`",`n      `"headers`": {`n        `"Authorization`": `"Bearer $Token`"`n      }`n    }`n  }`n}`n"
[System.IO.File]::WriteAllText($mcpJsonPath, $newContent)
Write-Host "  [ok] .mcp.json updated"

# ── Step 3: Hardlink worktrees ────────────────────────────────────────────────

Write-Host ""
Write-Host "Syncing hardlinks to all D-drive worktrees..."
$lines = git -C $RepoRoot worktree list --porcelain
$worktrees = @()
foreach ($line in $lines) {
    if ($line -match "^worktree (.+)$") {
        $path = $matches[1].Replace("/", "\")
        if ($path -match "^D:\\" -and $path -ne $RepoRoot) {
            $worktrees += $path
        }
    }
}

$created = 0; $failed = 0
foreach ($wt in $worktrees) {
    $link = Join-Path $wt ".mcp.json"
    if (Test-Path $link) { Remove-Item $link -Force }
    & fsutil hardlink create $link $mcpJsonPath | Out-Null
    if ($LASTEXITCODE -eq 0) { $created++ } else { $failed++; Write-Host "  [!!] FAILED: $wt" }
}
Write-Host "  [ok] $created worktrees linked ($failed failed)"

# ── Step 4: Re-register user-scope MCP ───────────────────────────────────────

Write-Host ""
Write-Host "Re-registering user-scope MCP (Claude Code bug #51581: env vars broken in HTTP headers)..."
& claude mcp remove dpf -s user 2>$null | Out-Null
& claude mcp add --scope user dpf --transport http $mcpUrl --header "Authorization: Bearer $Token" | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [ok] ~/.claude.json updated"
} else {
    Write-Host "  [!!] Failed — run manually:"
    Write-Host "       claude mcp remove dpf -s user"
    Write-Host "       claude mcp add --scope user dpf --transport http `"$mcpUrl`" --header `"Authorization: Bearer $Token`""
}

# ── Done ──────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Done. Restart open Claude Code sessions to pick up the new token." -ForegroundColor Green
