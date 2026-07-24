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
# For linked worktrees, this also writes a worktree-scoped COMPOSE_PROJECT_NAME
# into the target .env file. docker-compose.yml defaults to the root project
# name "dpf"; linked worktrees must override it so their containers and volumes
# cannot contaminate the live install project.
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

function Get-WorktreeComposeProjectName {
    param([string]$Path)

    $leaf = Split-Path -Leaf $Path
    $slug = $leaf.ToLowerInvariant() -replace '[^a-z0-9]+', '-'
    $slug = $slug.Trim('-')

    if ([string]::IsNullOrWhiteSpace($slug) -or $slug -ieq "dpf") {
        $slug = "worktree"
    }

    if ($slug.StartsWith("dpf-")) {
        return $slug
    }

    return "dpf-$slug"
}

function Set-WorktreeComposeProjectEnv {
    param(
        [string]$EnvPath,
        [string]$ProjectName,
        [bool]$ForceProjectName
    )

    $desired = "COMPOSE_PROJECT_NAME=$ProjectName"

    if (-not (Test-Path -LiteralPath $EnvPath)) {
        Set-Content -LiteralPath $EnvPath -Value @(
            "# Worktree-scoped Docker Compose project.",
            "# Prevents linked worktree containers and volumes from joining the root dpf project.",
            $desired
        ) -Encoding ascii
        return "Set $desired in $EnvPath"
    }

    $lines = @(Get-Content -LiteralPath $EnvPath)
    $found = $false
    $changed = $false
    $preserved = $false
    $out = New-Object System.Collections.Generic.List[string]

    foreach ($line in $lines) {
        if ($line -match '^\s*COMPOSE_PROJECT_NAME\s*=(.*)$') {
            $found = $true
            $current = $Matches[1].Trim()
            if ($ForceProjectName -or [string]::IsNullOrWhiteSpace($current) -or $current -ieq "dpf") {
                $out.Add($desired)
                $changed = $true
            } else {
                $out.Add($line)
                $preserved = $true
            }
        } else {
            $out.Add($line)
        }
    }

    if (-not $found) {
        $out.Add($desired)
        $changed = $true
    }

    if ($changed) {
        Set-Content -LiteralPath $EnvPath -Value $out -Encoding ascii
        return "Set $desired in $EnvPath"
    }

    if ($preserved) {
        return "Existing COMPOSE_PROJECT_NAME in $EnvPath is already custom."
    }

    return "No Compose project change needed for $EnvPath"
}

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

Write-Step "Configuring worktree Compose project"
$composeProjectName = Get-WorktreeComposeProjectName -Path $Target
$composeResult = Set-WorktreeComposeProjectEnv `
    -EnvPath (Join-Path $Target ".env") `
    -ProjectName $composeProjectName `
    -ForceProjectName:$Force.IsPresent

if ($composeResult -like "Existing*") {
    Write-Skip $composeResult
} else {
    Write-Ok $composeResult
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

# BI-3047C122 (Wave 2): optional managed dependency bootstrap. Born compile-ready
# instead of source-only when requested (no junction dance). OFF by default so it
# never slows routine creation; enable with $env:DPF_WORKTREE_BOOTSTRAP = "1".
# Fail-safe: a failed bootstrap leaves the worktree source-only, never breaks creation.
if ($env:DPF_WORKTREE_BOOTSTRAP -eq "1") {
    $bootstrapHelper = Join-Path $Target "scripts/lib/bootstrap-worktree-deps.mjs"
    if ((Test-Path $bootstrapHelper) -and (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Step "Bootstrapping worktree dependencies (managed; DPF_WORKTREE_BOOTSTRAP=1)"
        try {
            & node $bootstrapHelper $Target *> $null
            Write-Ok "Dependency bootstrap attempted (fail-safe; readiness recorded below)"
        } catch {
            Write-Host "  [WARN] Dependency bootstrap failed; worktree stays source-only." -ForegroundColor Yellow
        }
    }
}

Write-Step "Classifying worktree verification readiness"
$pnpmOnPath = $null -ne (Get-Command pnpm -ErrorAction SilentlyContinue)
$corepackOnPath = $null -ne (Get-Command corepack -ErrorAction SilentlyContinue)
$nodeModulesPresent = Test-Path -LiteralPath (Join-Path $Target "node_modules")
$readinessState = "source-only"
$readinessReason = "dependencies_missing"
$probedViaHelper = $false

# BI-3047C122 (Wave 3): a cheap real probe (dependency resolution + @dpf/*
# workspace-link locality) beats structural node_modules presence — the latter
# marked a node_modules JUNCTIONED TO A STALE SIBLING WORKTREE "compile-ready"
# on 2026-07-24, silently typechecking against the wrong source. Runs
# unconditionally (no install; cheap) via --classify-only; falls back to the
# structural guess only when node or the helper is unavailable.
$readinessHelper = Join-Path $Target "scripts/lib/bootstrap-worktree-deps.mjs"
if ((Test-Path $readinessHelper) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    try {
        $classifyJson = & node $readinessHelper $Target --classify-only 2>$null
        if ($LASTEXITCODE -eq 0 -and $classifyJson) {
            $parsed = $classifyJson | ConvertFrom-Json
            if ($parsed.status -and $parsed.reason) {
                $readinessState = $parsed.status
                $readinessReason = $parsed.reason
                $probedViaHelper = $true
            }
        }
    } catch {
        # Fall through to the structural guess below.
    }
}

if (-not $probedViaHelper) {
    if ($nodeModulesPresent -and ($pnpmOnPath -or $corepackOnPath)) {
        $readinessState = "compile-ready"
        $readinessReason = "package_manager_and_dependencies_present"
    } elseif (-not $nodeModulesPresent) {
        $readinessReason = "node_modules_missing"
    } elseif (-not $pnpmOnPath -and -not $corepackOnPath) {
        $readinessReason = "pnpm_corepack_missing"
    }
}

$readiness = [ordered]@{
    schemaVersion = 1
    state = $readinessState
    reason = $readinessReason
    checkedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    checks = [ordered]@{
        pnpmOnPath = $pnpmOnPath
        corepackOnPath = $corepackOnPath
        nodeModulesPresent = $nodeModulesPresent
        probedViaBootstrapHelper = $probedViaHelper
    }
}
$readinessPath = Join-Path $Target ".dpf-worktree-readiness.json"
$readiness | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $readinessPath -Encoding ascii
Write-Ok "Recorded $readinessState readiness in $readinessPath ($readinessReason)"

Write-Step "Ensuring DPF skill pack"
$skillPackScript = Join-Path $Target "scripts\ensure-dpf-skill-pack.ps1"
if (Test-Path -LiteralPath $skillPackScript) {
    & $skillPackScript -RepoRoot $Target
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [WARN] DPF skill pack bootstrap failed; MCP config, Compose isolation, and readiness marker were still written." -ForegroundColor Yellow
    }
} else {
    Write-Skip "No DPF skill pack installer found at $skillPackScript"
}

Write-Host ""
Write-Host "Done. Restart Claude Code, Codex, or VS Code in the worktree to pick up the dpf connector and skill pack." -ForegroundColor Green
Write-Host ""
