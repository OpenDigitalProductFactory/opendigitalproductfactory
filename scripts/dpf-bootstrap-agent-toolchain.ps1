# Open Digital Product Factory -- agent toolchain bootstrap (Windows)
#
# Converges the contributor's Claude Code + Codex CLI sessions to a known
# kernel-aware state on every install or worktree creation. Replaces the old
# scripts/ensure-dpf-skill-pack.ps1 (which now exists as a thin shim).
#
# Architecture (per docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md):
#   1. Detect Claude Code / Codex CLIs + DPF MCP token presence.
#   2. Call the @dpf/bootstrap planning library via Node (tsx) to compute an
#      AgentToolchainPlan (data-in / data-out, no side effects).
#   3. Apply the plan: claude plugin install, Codex config TOML upsert,
#      kernel-memory seed.
#   4. Run a read-only MCP tools/list probe (planned in Phase 5 - stub returns
#      `skipped` here so the state schema validates).
#   5. Run the kernel-principle smoke probe (planned in Phase 5 - stub returns
#      `skipped` here).
#   6. Materialize the agentToolchain state and persist via state.ps1.
#   7. Print a single readiness banner using the spec's readinessCopy() table.
#
# The banner contains NO substrate names (config.toml, installed_plugins.json,
# .codex, .claude/plugins, etc.) and NO command snippets. Substrate detail
# is available under -ShowSubstrate for debugging.
#
# Plain ASCII only per AGENTS.md.

param(
    [string]$RepoRoot = (Get-Location).Path,
    [switch]$Headless,
    [switch]$ReconcileStaleEntries,
    [switch]$ShowSubstrate,
    [switch]$DryRun,
    # Auto-mint an MCP token (in the portal container) and persist it durably
    # when none is present. On by default for the contributor bootstrap.
    [switch]$NoAutoMint,
    # Scope of the auto-minted token: read | write | admin. `write` gives an
    # external coding agent all side-effecting MCP tools without admin powers.
    [string]$MintScope = "write",
    # Opt-in: install Google Antigravity's `agy` CLI (runs the official vendor
    # installer) when absent, then wire the DPF MCP config. OFF by default — we
    # never run a vendor installer silently (kernel DI-B91843F8C157).
    [switch]$InstallAntigravity
)

$ErrorActionPreference = "Stop"

function Write-Ok    { param($msg) Write-Host "  [OK] $msg"     -ForegroundColor Green }
function Write-Info  { param($msg) Write-Host "  [..] $msg"     -ForegroundColor Cyan }
function Write-Skip  { param($msg) Write-Host "  [SKIP] $msg"   -ForegroundColor Yellow }
function Write-Warn2 { param($msg) Write-Host "  [WARN] $msg"   -ForegroundColor Yellow }
function Write-Fail2 { param($msg) Write-Host "  [FAIL] $msg"   -ForegroundColor Red }

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

# --- Resolve substrate paths --------------------------------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
. (Join-Path $ScriptDir "installer\lib\state.ps1")

$CodexConfigPath        = Join-Path $HOME ".codex\config.toml"
$ClaudePluginsPath      = Join-Path $HOME ".claude\plugins\installed_plugins.json"
$GrokConfigPath         = Join-Path $HOME ".grok\config.toml"  # platform-specific per README; macOS/Linux ~/.grok/config.toml , Windows %USERPROFILE%\.grok\config.toml or APPDATA\grok
$KernelPrinciplesDir    = Join-Path $RepoRoot "docs\founder-kernel\wiki\principles"
$ContributorMemoryDir   = Join-Path $HOME ".claude\projects"
$ProjectSlug            = ($RepoRoot -replace '[:\\\/]+', '-').TrimStart('-')
$McpEndpoint            = if ($env:DPF_MCP_URL) { $env:DPF_MCP_URL } else { "http://127.0.0.1:3000/api/mcp/v1" }
$SkillPackManifestPath  = Join-Path $RepoRoot "packages\dpf-skill-pack\.claude-plugin\plugin.json"

if (-not (Test-Path -LiteralPath $SkillPackManifestPath)) {
    Write-Fail2 "DPF skill pack plugin manifest missing at $SkillPackManifestPath; aborting bootstrap."
    exit 1
}
$expectedVersion = (Get-Content -LiteralPath $SkillPackManifestPath -Raw | ConvertFrom-Json).version

# --- Opt-in install of Google Antigravity (agy) -------------------------------
# Runs the OFFICIAL Windows installer only when the operator passed
# -InstallAntigravity and `agy` is absent. Never silent. agy is a standalone Go
# binary; the installer drops it under %LOCALAPPDATA%\Antigravity.
if ($InstallAntigravity -and ($null -eq (Get-Command agy -ErrorAction SilentlyContinue))) {
    if ($DryRun) {
        Write-Info "Antigravity CLI  : would run the official agy installer (-DryRun)"
    } else {
        Write-Info "Antigravity CLI  : not found; running the official installer (opt-in)"
        try { Invoke-RestMethod -Uri "https://antigravity.google/cli/install.ps1" | Invoke-Expression }
        catch { Write-Warn2 "agy install failed; install manually per docs/operations/antigravity-cli-onboarding.md" }
    }
}

# --- Detect CLIs + token ------------------------------------------------------
$ClaudePresent = $null -ne (Get-Command claude -ErrorAction SilentlyContinue)
$CodexPresent  = $null -ne (Get-Command codex  -ErrorAction SilentlyContinue)
$GrokPresent   = $null -ne (Get-Command grok   -ErrorAction SilentlyContinue)
$AgyPresent    = $null -ne (Get-Command agy    -ErrorAction SilentlyContinue)
$HasToken      = -not [string]::IsNullOrWhiteSpace($env:DPF_MCP_BEARER_TOKEN)

Write-Host ""
Write-Host "-> DPF agent toolchain bootstrap" -ForegroundColor Yellow
Write-Info "Repo root        : $RepoRoot"
Write-Info "Claude CLI       : $(if ($ClaudePresent) { 'present' } else { 'missing' })"
Write-Info "Codex CLI        : $(if ($CodexPresent)  { 'present' } else { 'missing' })"
Write-Info "Grok CLI         : $(if ($GrokPresent)   { 'present' } else { 'missing' })"
Write-Info "Antigravity CLI  : $(if ($AgyPresent)    { 'present' } else { 'missing' })"
Write-Info "DPF MCP token    : $(if ($HasToken)      { 'present' } else { 'missing' })"
Write-Info "Skill pack ver.  : $expectedVersion"

# --- Auto-mint + persist MCP token --------------------------------------------
# The env-backed client config references $env:DPF_MCP_BEARER_TOKEN; without a
# persisted token the clients cannot call /api/mcp/v1. We mint inside the portal
# container (it reaches the DB over the compose network and always matches the
# migrated schema; the host may lack DB access). Mirrors the Edge Node bootstrap
# pattern in fresh-install.ps1. The plaintext is never logged; only persisted.
$AutoMint = -not $NoAutoMint.IsPresent

function Resolve-PortalContainer {
    $c = (& docker compose -f (Join-Path $RepoRoot "docker-compose.yml") ps -q portal 2>$null | Select-Object -First 1)
    if ($c) { return $c }
    $c = (& docker ps --filter "name=portal" --filter "status=running" --format "{{.Names}}" 2>$null | Where-Object { $_ -match "portal" } | Select-Object -First 1)
    if ($c) { return $c }
    return "dpf-portal-1"
}

# Reconcile an under-provisioned token (BI-A3DE9A31). "token present" !=
# "token sufficient": a token minted before the write->development-template fix
# lacks `registry_read`, so registry-gated tools (principle_decide / WWMD)
# refuse. Probe a registry_read-gated, read-only, no-arg tool; on an
# unambiguous scope failure naming registry_read, force a re-mint by clearing
# $HasToken. Fail safe: leave the token untouched on unreachable/ambiguous
# responses. Markers mirror interpretScopeCoverageProbe in @dpf/bootstrap (SSOT).
if ($HasToken -and $AutoMint -and -not $DryRun.IsPresent) {
    try {
        $body = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_my_coworker_profile","arguments":{}}}'
        $headers = @{ "Authorization" = "Bearer $($env:DPF_MCP_BEARER_TOKEN)"; "Accept" = "application/json, text/event-stream" }
        $resp = Invoke-WebRequest -Uri $McpEndpoint -Method Post -ContentType "application/json" -Headers $headers -Body $body -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        $probe = $resp.Content
        if ($probe -match 'lacks the required scope' -and $probe -match 'registry_read') {
            Write-Warn2 "Present MCP token is under-provisioned (missing registry_read); re-minting with the full development template."
            $HasToken = $false
        }
    } catch {
        # Unreachable / ambiguous - fail safe, leave the present token untouched.
    }
}

if (-not $HasToken -and $AutoMint) {
    if ($DryRun.IsPresent) {
        Write-Info "DRY-RUN: would mint a '$MintScope'-scoped MCP token (in portal container) and persist it (User env)."
    } elseif ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Warn2 "docker not found; cannot mint an MCP token. Continuing without one."
    } else {
        $portal = Resolve-PortalContainer
        Write-Info "No MCP token found; minting a '$MintScope'-scoped token via portal container ($portal)."
        try {
            $mintOut = & docker exec $portal sh -c "cd /app/apps/web-src && /app/node_modules/.pnpm/node_modules/.bin/tsx scripts/issue-mcp-token.ts --scope '$MintScope' --format raw" 2>$null
            $mintToken = ($mintOut | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ -match '^dpfmcp_' } | Select-Object -Last 1)
            if ($mintToken) {
                # Durable persistence for new processes (Windows analog of the
                # POSIX zshenv + launchctl path). Single source of truth for the
                # exact line: buildSetupSnippets().envPowerShell.
                [System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', $mintToken, 'User')
                $env:DPF_MCP_BEARER_TOKEN = $mintToken
                $HasToken = $true
                $prefix = ($mintToken -split '_')[0]
                Write-Ok "MCP token issued and persisted (${prefix}_... , scope=$MintScope)."
            } else {
                Write-Warn2 "Token issuance produced no token; continuing without one."
            }
        } catch {
            Write-Warn2 "Token issuance failed (is the portal container running?); continuing without a token."
        }
    }
}

# --- Compute plan via Node bridge --------------------------------------------
$BootstrapCli = Join-Path $RepoRoot "packages\dpf-bootstrap\src\agent-toolchain\cli\compute-plan.ts"
if (-not (Test-Path -LiteralPath $BootstrapCli)) {
    Write-Fail2 "Bootstrap CLI not found at $BootstrapCli (is @dpf/bootstrap installed?)"
    exit 1
}

# tsx is a devDependency of @dpf/bootstrap; pnpm exec finds it.
$nodeArgs = @(
    "--filter", "@dpf/bootstrap", "exec",
    "tsx", $BootstrapCli,
    "--repo-root", $RepoRoot,
    "--codex-config", $CodexConfigPath,
    "--claude-plugins", $ClaudePluginsPath,
    "--grok-config", $GrokConfigPath,
    "--kernel-principles", $KernelPrinciplesDir,
    "--contributor-memory", $ContributorMemoryDir,
    "--project-slug", $ProjectSlug,
    "--mcp-endpoint", $McpEndpoint,
    "--expected-dpf-platform-version", $expectedVersion
)
if ($ClaudePresent)        { $nodeArgs += "--claude-cli-present" }
if ($CodexPresent)         { $nodeArgs += "--codex-cli-present" }
if ($GrokPresent)          { $nodeArgs += "--grok-cli-present" }
if ($AgyPresent)           { $nodeArgs += "--antigravity-cli-present" }
if ($HasToken)             { $nodeArgs += "--has-token" }
if ($ReconcileStaleEntries.IsPresent) { $nodeArgs += "--reconcile-stale-entries" }

$planJson = & pnpm @nodeArgs 2>$null
if ($LASTEXITCODE -ne 0 -or -not $planJson) {
    Write-Warn2 "compute-plan failed; using standalone skill-pack updater fallback."
    $fallback = Join-Path $RepoRoot "packages\dpf-skill-pack\scripts\update-agent-toolchain.ps1"
    if (Test-Path -LiteralPath $fallback) {
        & $fallback -SkillPackPath (Join-Path $RepoRoot "packages\dpf-skill-pack") -McpUrl $McpEndpoint -DryRun:$DryRun
        exit $LASTEXITCODE
    }
    Write-Fail2 "Standalone updater missing at $fallback; cannot proceed."
    exit 1
}

$plan = $planJson | ConvertFrom-Json
Write-Info "Plan preview: $($plan.preview.readinessState)"

# --- Apply plan ---------------------------------------------------------------
$claudeWired = $false
$codexWired  = $false
$grokWired   = $false
$agyWired    = $false
$memorySeededAt = $null

# 1. Claude Code: run `claude plugin install` if a write is planned.
if ($plan.claude -and $plan.claude.mode -ne 'noop') {
    if ($DryRun.IsPresent) {
        Write-Info "DRY-RUN claude plugin install dpf-platform@dpf-platform-local --scope project"
    } else {
        Push-Location -LiteralPath $RepoRoot
        try {
            & claude plugin marketplace add ./ --scope local 2>$null | Out-Null
            & claude plugin install dpf-platform@dpf-platform-local --scope project 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Ok "Claude Code plugin wired ($($plan.claude.mode))."
                $claudeWired = $true
            } else {
                Write-Warn2 "claude plugin install exited $LASTEXITCODE; toolchain remains partial."
            }
        } finally {
            Pop-Location
        }
    }
} elseif ($plan.claude -and $plan.claude.mode -eq 'noop') {
    $claudeWired = $true
    Write-Ok "Claude Code plugin already converged."
} else {
    Write-Skip "Claude CLI not installed; skipping plugin wire."
}

if ($plan.claude -and $plan.claude.staleEntriesToReconcile.Count -gt 0 -and -not $ReconcileStaleEntries.IsPresent) {
    Write-Warn2 "$($plan.claude.staleEntriesToReconcile.Count) stale Claude plugin entries detected. Re-run with -ReconcileStaleEntries to clean."
}

# 2. Codex CLI: apply TOML write (only if a write is planned).
if ($plan.codex -and $plan.codex.writes.Count -gt 0) {
    foreach ($write in $plan.codex.writes) {
        if ($DryRun.IsPresent) {
            Write-Info "DRY-RUN write Codex config -> $($write.path)"
        } else {
            $dir = Split-Path -Parent $write.path
            if (-not (Test-Path -LiteralPath $dir)) {
                New-Item -ItemType Directory -Path $dir -Force | Out-Null
            }
            [System.IO.File]::WriteAllText($write.path, $write.content, [System.Text.Encoding]::UTF8)
        }
    }
    Write-Ok "Codex plugin wired."
    $codexWired = $true
    # Report DPF-scoping convergence (generic-client disable + worktree trust)
    # so drift is surfaced, not silently tolerated (spec S4.5).
    if ($plan.codex.convergence -and @($plan.codex.convergence).Count -gt 0) {
        foreach ($chg in $plan.codex.convergence) {
            switch ($chg.kind) {
                "plugin-disabled"     { Write-Info "Codex: disabled generic plugin '$($chg.key)' (DPF-scoped profile)." }
                "mcp-server-disabled" { Write-Info "Codex: disabled generic MCP server '$($chg.key)' (orphaned-sidecar source)." }
                "project-trusted"     { Write-Info "Codex: trusted worktree path '$($chg.key)'." }
            }
        }
    }
} elseif ($plan.codex) {
    if ($plan.codex.preservedUserIntent) {
        Write-Skip "Codex plugin manually disabled by user; preserving user intent."
        $codexWired = $false
    } else {
        Write-Ok "Codex plugin already converged."
        $codexWired = $true
    }
} else {
    Write-Skip "Codex CLI not installed; skipping plugin wire."
}

# 2c. Grok CLI: dedicated config.toml wiring (like Codex) from grok config plan.
# Writes the mcp_servers.dpf section (from grok.mcp.json) into the Grok TOML.
# Generic MCP client config (above) covers .mcp.json side; this is the native Grok config.
if ($plan.grok -and $plan.grok.config -and $plan.grok.config.writes.Count -gt 0) {
    foreach ($write in $plan.grok.config.writes) {
        if ($DryRun.IsPresent) {
            Write-Info "DRY-RUN write Grok config -> $($write.path)"
        } else {
            $dir = Split-Path -Parent $write.path
            if (-not (Test-Path -LiteralPath $dir)) {
                New-Item -ItemType Directory -Path $dir -Force | Out-Null
            }
            [System.IO.File]::WriteAllText($write.path, $write.content, [System.Text.Encoding]::UTF8)
        }
    }
    Write-Ok "Grok config wired."
    $grokWired = $true
} elseif ($GrokPresent) {
    $grokWired = $true
    Write-Ok "Grok CLI detected (config already converged)."
} else {
    Write-Skip "Grok CLI not installed; skipping (will appear when `grok` is on PATH)."
}

# 2d. Antigravity (agy) recognition. Additive/optional -- never gates readiness.
# The DPF MCP config write is delegated to update_agent_toolchain.py /
# `issue-mcp-token --format antigravity` (see docs/operations/antigravity-cli-onboarding.md):
# agy's exact MCP-config path is pending confirmation on a live install
# (BI-ECAE3494), so we do not write to an unverified path from here.
if ($AgyPresent) {
    $agyWired = $true
    Write-Ok "Antigravity CLI (agy) detected; wire MCP config per the onboarding runbook."
} else {
    Write-Skip "Antigravity CLI not installed; skipping (pass -InstallAntigravity to opt in)."
}

# 2b. MCP client config (.mcp.json + .vscode/mcp.json) -- env-backed, no secret.
if ($plan.mcpClientConfig -and $plan.mcpClientConfig.writes.Count -gt 0) {
    foreach ($write in $plan.mcpClientConfig.writes) {
        if ($DryRun.IsPresent) {
            Write-Info "DRY-RUN write MCP client config -> $($write.path)"
        } else {
            $dir = Split-Path -Parent $write.path
            if (-not (Test-Path -LiteralPath $dir)) {
                New-Item -ItemType Directory -Path $dir -Force | Out-Null
            }
            [System.IO.File]::WriteAllText($write.path, $write.content, [System.Text.Encoding]::UTF8)
        }
    }
    Write-Ok "MCP client config written ($($plan.mcpClientConfig.writes.Count) file(s): .mcp.json / .vscode/mcp.json)."
} else {
    Write-Ok "MCP client config already converged."
}

# 3. Kernel memory seed.
if ($plan.memory.writes.Count -gt 0) {
    foreach ($write in $plan.memory.writes) {
        if ($write.mode -eq 'preserve-user-edit') { continue }
        if ($DryRun.IsPresent) {
            Write-Info "DRY-RUN seed memory -> $($write.path)"
        } else {
            $dir = Split-Path -Parent $write.path
            if (-not (Test-Path -LiteralPath $dir)) {
                New-Item -ItemType Directory -Path $dir -Force | Out-Null
            }
            [System.IO.File]::WriteAllText($write.path, $write.content, [System.Text.Encoding]::UTF8)
        }
    }
    if ($plan.memory.indexEntry) {
        if (-not $DryRun.IsPresent) {
            $idxDir = Split-Path -Parent $plan.memory.indexEntry.path
            if (-not (Test-Path -LiteralPath $idxDir)) {
                New-Item -ItemType Directory -Path $idxDir -Force | Out-Null
            }
            [System.IO.File]::WriteAllText($plan.memory.indexEntry.path, $plan.memory.indexEntry.content, [System.Text.Encoding]::UTF8)
        }
    }
    Write-Ok "Kernel-tier memory seeded ($($plan.memory.writes.Count) principle(s))."
    $memorySeededAt = (Get-Date).ToUniversalTime().ToString("o")
} else {
    Write-Ok "Kernel-tier memory already converged."
}

# 4 + 5. Live probes (Phase 5). Bridge subprocess runs MCP tools/list probe
# and kernel-principle smoke probe; results are bearer-redacted by the probe
# runners themselves before being persisted.
$mcpReadiness = $null
$smokeResult  = $null

if (-not $DryRun.IsPresent) {
    $probesCli = Join-Path $RepoRoot "packages\dpf-bootstrap\src\agent-toolchain\cli\run-probes.ts"
    if (Test-Path -LiteralPath $probesCli) {
        $probeArgs = @(
            "--filter", "@dpf/bootstrap", "exec",
            "tsx", $probesCli,
            "--mcp-endpoint", $McpEndpoint
        )
        if ($HasToken) {
            $probeArgs += @("--token", $env:DPF_MCP_BEARER_TOKEN)
        }
        try {
            $probeJson = & pnpm @probeArgs 2>$null
            if ($LASTEXITCODE -eq 0 -and $probeJson) {
                $probeResult = $probeJson | ConvertFrom-Json
                # ConvertFrom-Json returns PSCustomObject - re-serialize as
                # nested hashtables so Set-DpfStateValue round-trips cleanly.
                $mcpReadiness = $probeResult.mcpReadiness | ConvertTo-Json -Depth 6 -Compress | ConvertFrom-Json -AsHashtable
                $smokeResult  = $probeResult.smokeTest    | ConvertTo-Json -Depth 6 -Compress | ConvertFrom-Json -AsHashtable
            } else {
                Write-Warn2 "run-probes exited $LASTEXITCODE; recording probes as skipped."
            }
        } catch {
            Write-Warn2 "run-probes invocation failed: $_"
        }
    } else {
        Write-Warn2 "Probes CLI not found at $probesCli; recording probes as skipped."
    }
}

# Fall through to skip stubs if probes didn't run (dry-run, missing CLI, or
# probe-runner failure). Skipping is honest and surfaces in the state.
if ($null -eq $mcpReadiness) {
    $mcpReadiness = if ($HasToken) {
        @{ ok = $false; reason = "endpoint_unreachable"; httpStatus = $null }
    } else {
        @{ ok = $false; reason = "no_token"; httpStatus = $null }
    }
}
if ($null -eq $smokeResult) {
    $smokeResult = if (-not ($ClaudePresent -or $CodexPresent)) {
        @{ result = "skipped"; reason = "claude_not_on_path" }
    } else {
        @{ result = "skipped"; reason = "no_token" }
    }
}

# 6. Materialize state and write to install-state.json.
$state = [ordered]@{
    appliedAt           = (Get-Date).ToUniversalTime().ToString("o")
    dpfPlatformVersion  = $expectedVersion
    superpowersVersion  = $null
    claudeCodeWired     = $claudeWired
    codexWired          = $codexWired
    grokWired           = $grokWired
    antigravityWired    = $agyWired
    memorySeededAt      = $memorySeededAt
    mcpReadiness        = $mcpReadiness
    smokeTest           = $smokeResult
    readinessState      = if ($plan.preview.readinessState -eq 'ready' -and (-not $claudeWired -or -not $codexWired)) { 'partial' } else { $plan.preview.readinessState }
}

# Recompute readinessState from the applied facts + probe outcomes. Mirrors
# computeReadinessState() in @dpf/bootstrap/readiness-state.ts: order-of-checks
# is most-fundamental-first so the primary remediation is unambiguous.
if (-not $claudeWired -and -not $codexWired -and -not $grokWired -and -not $agyWired) {
    $state.readinessState = "missing_cli"
} elseif (-not $mcpReadiness.ok) {
    if ($mcpReadiness.reason -in @("no_token", "scope_insufficient")) {
        $state.readinessState = "missing_token"
    } elseif ($mcpReadiness.reason -in @("endpoint_unreachable", "unexpected_shape")) {
        $state.readinessState = "needs_refresh"
    } else {
        $state.readinessState = "needs_refresh"
    }
} elseif ($smokeResult.result -eq "failed") {
    $state.readinessState = "failed_smoke"
} elseif (-not $claudeWired -or -not $codexWired -or -not $grokWired) {
    $state.readinessState = "partial"
} else {
    $state.readinessState = "ready"
}

if (-not $DryRun.IsPresent) {
    Initialize-DpfState -InstallerVersion "agent-toolchain-bootstrap-phase-3" -InstallPath $RepoRoot
    Set-DpfStateValue -Key "agentToolchain" -Value $state
}

# --- Readiness banner ---------------------------------------------------------
$copyTable = @{
    "ready"          = @{ message = "Claude Code and Codex are ready for DPF work.";                                     primaryAction = "Open readiness" }
    "partial"        = @{ message = "One contributor client is ready; the other needs setup.";                           primaryAction = "Repair toolchain" }
    "missing_cli"    = @{ message = "Install the selected agent client to enable contributor sessions.";                 primaryAction = "Open setup guide" }
    "missing_token"  = @{ message = "DPF MCP needs a development token before agents can use governed tools.";           primaryAction = "Issue development token" }
    "needs_refresh"  = @{ message = "A token exists, but the running client has not picked it up yet.";                  primaryAction = "Refresh client binding" }
    "failed_smoke"   = @{ message = "The agent is installed but did not apply a DPF kernel principle.";                  primaryAction = "View evidence" }
}
$copy = $copyTable[$state.readinessState]

$upstreamAdvisory = $null
if ($plan.upstreamDrift -and $plan.upstreamDrift.advisory) {
    $upstreamAdvisory = [string]$plan.upstreamDrift.advisory
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  DPF agent toolchain: $($state.readinessState.ToUpper())" -ForegroundColor Cyan
Write-Host "  $($copy.message)" -ForegroundColor White
Write-Host "  Next: $($copy.primaryAction)" -ForegroundColor Yellow
if (-not [string]::IsNullOrWhiteSpace($upstreamAdvisory)) {
    Write-Host "  $upstreamAdvisory" -ForegroundColor DarkYellow
}
Write-Host "================================================================" -ForegroundColor Cyan

if ($ShowSubstrate.IsPresent) {
    Write-Host ""
    Write-Host "  Substrate detail (for debugging):" -ForegroundColor DarkGray
    Write-Host "    Claude plugin     : $($state.claudeCodeWired)" -ForegroundColor DarkGray
    Write-Host "    Codex plugin      : $($state.codexWired)" -ForegroundColor DarkGray
    Write-Host "    Grok plugin       : $($state.grokWired)" -ForegroundColor DarkGray
    Write-Host "    Antigravity (agy) : $($state.antigravityWired)" -ForegroundColor DarkGray
    Write-Host "    Memory seeded at  : $($state.memorySeededAt)" -ForegroundColor DarkGray
    Write-Host "    DPF platform ver  : $($state.dpfPlatformVersion)" -ForegroundColor DarkGray
    Write-Host "    State file        : $(Get-DpfStatePath)" -ForegroundColor DarkGray
}

Write-Host ""
