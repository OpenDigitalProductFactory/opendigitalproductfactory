# Open Digital Product Factory -- worktree MCP config seeder (Windows PowerShell)
#
# Copies .mcp.json and .vscode/mcp.json from the main worktree (root clone)
# into a target git worktree so Claude Code's /mcp connector list and the
# VS Code MCP client can find the dpf server.
#
# Predicated on platform installation: scripts/setup.ps1 must have completed
# AND an admin must have generated an MCP token at Admin > Platform Development
# (which writes the source files at the root clone). The two source files are
# gitignored on purpose -- they carry a local bearer token -- so they do not
# travel with `git worktree add`.
#
# Usage:
#   .\scripts\seed-worktree-mcp.ps1                    # seed current directory
#   .\scripts\seed-worktree-mcp.ps1 -Target <path>     # seed a specific worktree
#   .\scripts\seed-worktree-mcp.ps1 -Force             # overwrite existing files

param(
    [string]$Target = (Get-Location).Path,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Write-Step { param($msg) Write-Host "`n-> $msg" -ForegroundColor Yellow }
function Write-Ok   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Skip { param($msg) Write-Host "  [SKIP] $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "  [FAIL] $msg" -ForegroundColor Red; exit 1 }

$Target = (Resolve-Path -LiteralPath $Target).Path

Write-Step "Locating main worktree"

Push-Location -LiteralPath $Target
try {
    $null = git rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Fail "Not inside a git working tree: $Target" }
    $mainGitDir = (git rev-parse --path-format=absolute --git-common-dir).Trim()
} finally {
    Pop-Location
}

if (-not $mainGitDir -or -not (Test-Path -LiteralPath $mainGitDir)) {
    Write-Fail "Could not resolve main git directory from $Target."
}

$mainAbs = (Resolve-Path -LiteralPath ([System.IO.Path]::GetDirectoryName($mainGitDir))).Path
Write-Ok "Main worktree:   $mainAbs"
Write-Ok "Target worktree: $Target"

if ($mainAbs -ieq $Target) {
    Write-Ok "Target IS the main worktree -- nothing to seed."
    exit 0
}

$pairs = @(
    @{ Src = (Join-Path $mainAbs ".mcp.json");        Dst = (Join-Path $Target ".mcp.json") },
    @{ Src = (Join-Path $mainAbs ".vscode\mcp.json"); Dst = (Join-Path $Target ".vscode\mcp.json") }
)

Write-Step "Copying MCP config"
foreach ($pair in $pairs) {
    if (-not (Test-Path -LiteralPath $pair.Src)) {
        Write-Host ""
        Write-Host "  [FAIL] Missing source: $($pair.Src)" -ForegroundColor Red
        Write-Host ""
        Write-Host "  The platform must be installed and an MCP token generated before seeding worktrees." -ForegroundColor Yellow
        Write-Host "  Steps:" -ForegroundColor Yellow
        Write-Host "    1. From the main worktree at $mainAbs, run scripts\setup.ps1 if you have not already." -ForegroundColor Yellow
        Write-Host "    2. Start the platform (pnpm dev or docker compose up) and log in at http://localhost:3000 as admin@dpf.local." -ForegroundColor Yellow
        Write-Host "    3. Open Admin > Platform Development and generate an MCP token (writes .mcp.json + .vscode\mcp.json at the root)." -ForegroundColor Yellow
        Write-Host "    4. Re-run this script." -ForegroundColor Yellow
        exit 1
    }

    $dstDir = [System.IO.Path]::GetDirectoryName($pair.Dst)
    if (-not (Test-Path -LiteralPath $dstDir)) {
        New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    }

    if ((Test-Path -LiteralPath $pair.Dst) -and -not $Force) {
        Write-Skip "$($pair.Dst) already exists. Re-run with -Force to overwrite."
        continue
    }

    Copy-Item -LiteralPath $pair.Src -Destination $pair.Dst -Force
    Write-Ok "Wrote $($pair.Dst)"
}

Write-Host ""
Write-Host "Done. Restart Claude Code (or VS Code) in the worktree to pick up the dpf connector." -ForegroundColor Green
Write-Host ""
