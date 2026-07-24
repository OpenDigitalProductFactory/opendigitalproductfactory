# sync-mcp-worktrees.ps1
#
# Sync the DPF MCP config into every linked worktree, optionally rotate the
# token, set per-worktree COMPOSE_PROJECT_NAME, and stamp each worktree with
# compile-ready/source-only verification readiness.
#
# Usage - sync after creating a new worktree:
#   .\scripts\sync-mcp-worktrees.ps1
#   Reads DPF_MCP_BEARER_TOKEN from the Windows user environment when needed.
#
# Usage - full token rotation:
#   .\scripts\sync-mcp-worktrees.ps1 -Token dpfmcp_XXXX
#   Updates the root .mcp.json, copies local MCP files to all worktrees, and
#   re-registers user-scope MCP.

param(
    [string]$Token = "",
    [string]$RepoRoot = "D:\DPF"
)

$ErrorActionPreference = "Stop"

$mcpUrl = "http://127.0.0.1:3000/api/mcp/v1"
$rotating = $PSBoundParameters.ContainsKey("Token")

function Write-Ok {
    param([string]$Message)
    Write-Host "  [ok] $Message"
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  [!!] $Message"
}

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
        [string]$ProjectName
    )

    $desired = "COMPOSE_PROJECT_NAME=$ProjectName"

    if (-not (Test-Path -LiteralPath $EnvPath)) {
        Set-Content -LiteralPath $EnvPath -Value @(
            "# Worktree-scoped Docker Compose project.",
            "# Prevents linked worktree containers and volumes from joining the root dpf project.",
            $desired
        ) -Encoding ascii
        return "Set $desired"
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
            if ([string]::IsNullOrWhiteSpace($current) -or $current -ieq "dpf") {
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
        return "Set $desired"
    }

    if ($preserved) {
        return "Existing COMPOSE_PROJECT_NAME already custom"
    }

    return "No Compose project change needed"
}

function Copy-WorktreeFile {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        return $false
    }

    $destinationDir = [System.IO.Path]::GetDirectoryName($Destination)
    if (-not (Test-Path -LiteralPath $destinationDir)) {
        New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
    }

    Copy-Item -LiteralPath $Source -Destination $Destination -Force
    return $true
}

function Write-WorktreeReadinessMarker {
    param([string]$Path)

    $pnpmOnPath = $null -ne (Get-Command pnpm -ErrorAction SilentlyContinue)
    $corepackOnPath = $null -ne (Get-Command corepack -ErrorAction SilentlyContinue)
    $nodeModulesPresent = Test-Path -LiteralPath (Join-Path $Path "node_modules")
    $readinessState = "source-only"
    $readinessReason = "dependencies_missing"
    $probedViaHelper = $false

    # BI-3047C122 (Wave 3): a cheap real probe (dependency resolution + @dpf/*
    # workspace-link locality) beats structural node_modules presence — the
    # latter marked a node_modules JUNCTIONED TO A STALE SIBLING WORKTREE
    # "compile-ready" on 2026-07-24, silently typechecking against the wrong
    # source. Sync runs are exactly where re-classifying an EXISTING worktree
    # would have caught that. Cheap (no install); falls back to the structural
    # guess only when node or the helper is unavailable.
    $readinessHelper = Join-Path $Path "scripts/lib/bootstrap-worktree-deps.mjs"
    if ((Test-Path $readinessHelper) -and (Get-Command node -ErrorAction SilentlyContinue)) {
        try {
            $classifyJson = & node $readinessHelper $Path --classify-only 2>$null
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

    $readinessPath = Join-Path $Path ".dpf-worktree-readiness.json"
    $readiness | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $readinessPath -Encoding ascii
    return "$readinessState ($readinessReason)"
}

if (-not (Test-Path -LiteralPath $RepoRoot)) {
    Write-Error "RepoRoot does not exist: $RepoRoot"
    exit 1
}

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$mcpJsonPath = Join-Path $RepoRoot ".mcp.json"
$vscodeMcpPath = Join-Path $RepoRoot ".vscode\mcp.json"

# -- Step 1: Resolve token ----------------------------------------------------
# Priority: explicit -Token > DPF_MCP_BEARER_TOKEN env var > literal in .mcp.json

if (-not $Token) {
    if ($env:DPF_MCP_BEARER_TOKEN -match "^dpfmcp_") {
        $Token = $env:DPF_MCP_BEARER_TOKEN
        Write-Host "Token: using DPF_MCP_BEARER_TOKEN env var ($($Token.Substring(0,16))...)"
    } elseif (Test-Path -LiteralPath $mcpJsonPath) {
        $content = Get-Content -LiteralPath $mcpJsonPath -Raw
        if ($content -match '"Bearer (dpfmcp_[A-Za-z0-9_]+)"') {
            $Token = $matches[1]
            Write-Host "Token: extracted from .mcp.json ($($Token.Substring(0,16))...)"
        }
    }
}

if (-not $Token) {
    Write-Error @"
No token found. Either:
  (a) Set the DPF_MCP_BEARER_TOKEN Windows user env var one time:
        [System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', 'dpfmcp_XXXX', 'User')
      Then re-open this terminal and re-run without arguments.
  (b) Pass -Token directly for rotation:
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
    Set-Content -LiteralPath $mcpJsonPath -Value $newContent -Encoding ascii
    Write-Ok ".mcp.json updated with new token"
} else {
    if (-not (Test-Path -LiteralPath $mcpJsonPath)) {
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
        Set-Content -LiteralPath $mcpJsonPath -Value $newContent -Encoding ascii
        Write-Ok ".mcp.json created with env-var notation"
    } else {
        Write-Ok ".mcp.json unchanged (sync only)"
    }
}

# -- Step 3: Sync every linked worktree ---------------------------------------

Write-Host ""
Write-Host "Syncing MCP config, Compose project, and readiness into linked worktrees..."
$lines = git -C $RepoRoot worktree list --porcelain
if ($LASTEXITCODE -ne 0) {
    Write-Error "git worktree list failed for $RepoRoot"
    exit 1
}

$worktrees = @()
foreach ($line in $lines) {
    if ($line -match "^worktree (.+)$") {
        $path = $matches[1]
        if (-not (Test-Path -LiteralPath $path)) {
            continue
        }
        $resolved = (Resolve-Path -LiteralPath $path).Path
        if ($resolved -ieq $RepoRoot) {
            continue
        }
        $worktrees += $resolved
    }
}

if ($worktrees.Count -eq 0) {
    Write-Host "  (no linked worktrees found)"
} else {
    $ok = 0
    $fail = 0
    foreach ($wt in $worktrees) {
        try {
            $mcpCopied = Copy-WorktreeFile -Source $mcpJsonPath -Destination (Join-Path $wt ".mcp.json")
            $vscodeCopied = Copy-WorktreeFile -Source $vscodeMcpPath -Destination (Join-Path $wt ".vscode\mcp.json")
            $composeResult = Set-WorktreeComposeProjectEnv `
                -EnvPath (Join-Path $wt ".env") `
                -ProjectName (Get-WorktreeComposeProjectName -Path $wt)
            $readiness = Write-WorktreeReadinessMarker -Path $wt

            if ($mcpCopied) {
                Write-Ok "$wt - .mcp.json copied; $composeResult; readiness $readiness"
            } else {
                Write-Warn "$wt - root .mcp.json missing; $composeResult; readiness $readiness"
            }
            if (-not $vscodeCopied) {
                Write-Warn "$wt - root .vscode\mcp.json missing; skipped VS Code MCP copy"
            }
            $ok++
        } catch {
            Write-Warn "FAILED: $wt - $($_.Exception.Message)"
            $fail++
        }
    }
    Write-Host "  $ok synced, $fail failed"
}

# -- Step 4: Re-register user-scope MCP in ~/.claude.json ---------------------

Write-Host ""
Write-Host "Re-registering user-scope MCP (claude mcp add)..."
if ($null -eq (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Warn "claude CLI not found; skipped user-scope MCP re-registration"
} else {
    & claude mcp remove dpf -s user 2>$null | Out-Null
    & claude mcp add --scope user dpf --transport http $mcpUrl --header "Authorization: Bearer $Token" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "~/.claude.json updated"
    } else {
        Write-Warn "claude mcp add failed -- run manually if needed:"
        Write-Host "       claude mcp remove dpf -s user"
        Write-Host "       claude mcp add --scope user dpf --transport http `"$mcpUrl`" --header `"Authorization: Bearer $Token`""
    }
}

# -- Done ---------------------------------------------------------------------

Write-Host ""
if ($rotating) {
    Write-Host "Token rotation complete. Restart all open Claude Code sessions." -ForegroundColor Green
} else {
    Write-Host "Sync complete. Restart any Claude Code sessions running in newly synced worktrees." -ForegroundColor Green
}
