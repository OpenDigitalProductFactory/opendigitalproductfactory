# sync-mcp-worktrees.ps1
#
# Sync the DPF MCP config into every worktree, and optionally rotate the token.
#
# Usage — sync after creating a new worktree (no arguments):
#   .\scripts\sync-mcp-worktrees.ps1
#   Reads DPF_MCP_BEARER_TOKEN from the Windows user environment.
#
# Usage — full token rotation (new token from Admin > Platform Development):
#   .\scripts\sync-mcp-worktrees.ps1 -Token dpfmcp_XXXX
#   Updates .mcp.json, hardlinks to all worktrees, and re-registers user-scope MCP.
#
# What it does:
#   1. Resolves the token (env var preferred; -Token overrides for rotation).
#   2. When rotating (-Token supplied): rewrites D:\DPF\.mcp.json with the new token.
#      When syncing only: leaves .mcp.json content unchanged.
#   3. Hardlinks .mcp.json from the repo root into every D-drive worktree.
#      (.mcp.json is gitignored; worktrees don't get it via git.)
#   4. Re-registers the user-scope entry in ~/.claude.json via claude mcp add.
#   5. Reminds you to restart Claude Code sessions.

param(
    [string]$Token = "",
    [string]$RepoRoot = "D:\DPF"
)

$mcpJsonPath = Join-Path $RepoRoot ".mcp.json"
$mcpUrl = "http://localhost:3000/api/mcp/v1"
$rotating = $PSBoundParameters.ContainsKey("Token")

# -- Step 1: Resolve token ----------------------------------------------------
# Priority: explicit -Token > DPF_MCP_BEARER_TOKEN env var > literal in .mcp.json

if (-not $Token) {
    if ($env:DPF_MCP_BEARER_TOKEN -match "^dpfmcp_") {
        $Token = $env:DPF_MCP_BEARER_TOKEN
        Write-Host "Token: using DPF_MCP_BEARER_TOKEN env var ($($Token.Substring(0,16))...)"
    } elseif (Test-Path $mcpJsonPath) {
        $content = Get-Content $mcpJsonPath -Raw
        if ($content -match '"Bearer (dpfmcp_[A-Za-z0-9_]+)"') {
            $Token = $matches[1]
            Write-Host "Token: extracted from .mcp.json ($($Token.Substring(0,16))...)"
        }
    }
}

if (-not $Token) {
    Write-Error @"
No token found. Either:
  (a) Set the DPF_MCP_BEARER_TOKEN Windows user env var (one-time setup):
        [System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', 'dpfmcp_XXXX', 'User')
      Then re-open this terminal and re-run without arguments.
  (b) Pass -Token directly (use for rotation):
        .\scripts\sync-mcp-worktrees.ps1 -Token dpfmcp_XXXX
"@
    exit 1
}

# -- Step 2: Update .mcp.json (rotation only) ---------------------------------

if ($rotating) {
    Write-Host ""
    Write-Host "Rotating token in $mcpJsonPath ..."
    $newContent = @"
{
  "mcpServers": {
    "dpf": {
      "url": "$mcpUrl",
      "headers": {
        "Authorization": "Bearer $Token"
      }
    }
  }
}
"@
    [System.IO.File]::WriteAllText($mcpJsonPath, $newContent)
    Write-Host "  [ok] .mcp.json updated with new token"
} else {
    if (-not (Test-Path $mcpJsonPath)) {
        # First-time setup: write env-var-based file (preferred; no token in file)
        $newContent = @"
{
  "mcpServers": {
    "dpf": {
      "url": "$mcpUrl",
      "headers": {
        "Authorization": "Bearer `${DPF_MCP_BEARER_TOKEN}"
      }
    }
  }
}
"@
        [System.IO.File]::WriteAllText($mcpJsonPath, $newContent)
        Write-Host "  [ok] .mcp.json created (env-var notation)"
    } else {
        Write-Host "  [ok] .mcp.json unchanged (sync only)"
    }
}

# -- Step 3: Hardlink into every D-drive worktree -----------------------------

Write-Host ""
Write-Host "Hardlinking .mcp.json into all D-drive worktrees..."
$lines = git -C $RepoRoot worktree list --porcelain
$worktrees = @()
foreach ($line in $lines) {
    if ($line -match "^worktree (.+)$") {
        $path = $matches[1].Replace("/", "\")
        if ($path.StartsWith("D:\") -and $path -ne $RepoRoot) {
            $worktrees += $path
        }
    }
}

if ($worktrees.Count -eq 0) {
    Write-Host "  (no worktrees found on D: drive)"
} else {
    $ok = 0; $fail = 0
    foreach ($wt in $worktrees) {
        $link = Join-Path $wt ".mcp.json"
        if (Test-Path $link) { Remove-Item $link -Force }
        & fsutil hardlink create $link $mcpJsonPath | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [ok] $wt"
            $ok++
        } else {
            Write-Host "  [!!] FAILED: $wt"
            $fail++
        }
    }
    Write-Host "  $ok linked, $fail failed"
}

# -- Step 4: Re-register user-scope MCP in ~/.claude.json ---------------------

Write-Host ""
Write-Host "Re-registering user-scope MCP (claude mcp add)..."
& claude mcp remove dpf -s user 2>$null | Out-Null
& claude mcp add --scope user dpf --transport http $mcpUrl --header "Authorization: Bearer $Token" 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [ok] ~/.claude.json updated"
} else {
    Write-Host "  [!!] claude mcp add failed -- run manually if needed:"
    Write-Host "       claude mcp remove dpf -s user"
    Write-Host "       claude mcp add --scope user dpf --transport http `"$mcpUrl`" --header `"Authorization: Bearer $Token`""
}

# -- Done ---------------------------------------------------------------------

Write-Host ""
if ($rotating) {
    Write-Host "Token rotation complete. Restart all open Claude Code sessions." -ForegroundColor Green
} else {
    Write-Host "Sync complete. Restart any Claude Code sessions running in the newly linked worktrees." -ForegroundColor Green
}
