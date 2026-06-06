#Requires -Version 5.1
# scripts/hooks/session-reaper.ps1
#
# SessionEnd sidecar reaper (Windows).
#
# Spec: docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-
#       alignment-design.md S4.2 ("Session = claimed capsule; session end =
#       reap"). Orphaned per-session MCP/node sidecars (Codex app-server,
#       node_repl, npx MCP children) accumulate across sessions and pin the
#       WindowsApps Store Codex package against upgrade. This hook terminates
#       THIS session's orphaned sidecars and releases any held lease/capsule
#       when a Claude Code session ends.
#
# Invoked by the .claude/settings.json SessionEnd hook via run-hook.mjs.
# Receives a JSON payload on stdin:
#   { "session_id": "<uuid>", "transcript_path": "...",
#     "cwd": "<worktree path>", "hook_event_name": "SessionEnd" }
#
# Exit 0 ALWAYS -- a reap failure must never block session teardown.
#
# Conservative by design: it only targets sidecar processes whose command line
# references THIS worktree path (so a concurrent session in another worktree is
# never touched), and it NEVER kills the operator's editor, browser, or the
# portal/docker stack. Plain ASCII only per AGENTS.md.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'  # never throw out of a hook

$rawPayload = [Console]::In.ReadToEnd()
if (-not $rawPayload) { exit 0 }

try {
    $payload = $rawPayload | ConvertFrom-Json
} catch {
    exit 0
}

$sessionId = $payload.session_id
$hookEvent = $payload.hook_event_name
# The worktree this session ran in. Prefer the harness-provided cwd; fall back
# to the install root derived from this script's location.
$installRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$worktreePath = if ($payload.cwd) { [string]$payload.cwd } else { $installRoot }

# Only act on actual session-end events. A misrouted PostToolUse must no-op.
if ($hookEvent -and $hookEvent -ne 'SessionEnd') { exit 0 }

# --- Audit log ---------------------------------------------------------------
$stateDir = Join-Path $env:USERPROFILE '.claude\hook-state'
$logFile  = Join-Path $stateDir 'session-reaper.log'
if (-not (Test-Path -LiteralPath $stateDir)) {
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
}

function Write-ReapLog {
    param([hashtable]$Record)
    try {
        $Record['timestamp']  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        $Record['session_id'] = $sessionId
        Add-Content -LiteralPath $logFile -Value (ConvertTo-Json -Compress -InputObject $Record) -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

# Normalize the worktree path for case-insensitive substring matching against
# process command lines (both forward- and back-slash forms appear).
$wtNorm = $worktreePath.TrimEnd('\','/')
$wtFwd  = $wtNorm -replace '\\','/'
$wtBack = $wtNorm -replace '/','\'

# --- 1. Release any held nonprod lease / work capsule via the DPF MCP --------
#
# Best-effort, governed: if a bearer token is present we ask the substrate to
# release this session's lease + capsule so the next session is not blocked.
# Uses the MCP HTTP endpoint directly (the same transport the clients use).
$reapedLease = $false
$token = $env:DPF_MCP_BEARER_TOKEN
$mcpEndpoint = if ($env:DPF_MCP_URL) { $env:DPF_MCP_URL } else { "http://127.0.0.1:3000/api/mcp/v1" }
if ($token) {
    foreach ($call in @(
        @{ name = "release_nonprod_environment_lease"; args = @{ environmentKey = "local-integration-ci" } },
        @{ name = "release_capsule_scope";             args = @{} }
    )) {
        try {
            $body = @{
                jsonrpc = "2.0"; id = 1; method = "tools/call"
                params  = @{ name = $call.name; arguments = $call.args }
            } | ConvertTo-Json -Depth 6 -Compress
            $headers = @{
                "Authorization" = "Bearer $token"
                "Accept"        = "application/json, text/event-stream"
            }
            Invoke-WebRequest -Uri $mcpEndpoint -Method Post -ContentType "application/json" `
                -Headers $headers -Body $body -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop | Out-Null
            $reapedLease = $true
        } catch {
            # Unreachable / no held lease / tool refused -> nothing to release.
        }
    }
}

# --- 2. Reap THIS session's orphaned MCP/node sidecars -----------------------
#
# Target only the per-session sidecar process images, AND only those whose
# command line references this worktree. We never touch the operator's primary
# Codex.exe/claude.exe GUI, the portal, docker, or an editor.
$sidecarNames = @('node_repl', 'node', 'npx')
$reapedPids = @()

try {
    # CIM gives us the command line for substring matching; fall back silently
    # if WMI is unavailable.
    $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -and ($sidecarNames -contains ($_.Name -replace '\.exe$',''))
        }
    foreach ($p in $procs) {
        $cmd = [string]$p.CommandLine
        if (-not $cmd) { continue }
        # Must reference THIS worktree (either slash form). This is what scopes
        # the reap to the ending session and spares concurrent sessions.
        $matchesWorktree = ($cmd -like "*$wtFwd*") -or ($cmd -like "*$wtBack*")
        if (-not $matchesWorktree) { continue }
        try {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
            $reapedPids += $p.ProcessId
        } catch {
            # Already exited or access denied -> skip.
        }
    }
} catch {}

Write-ReapLog @{
    hook_event   = $hookEvent
    worktree     = $worktreePath
    lease_released = $reapedLease
    reaped_pids  = $reapedPids
    reaped_count = $reapedPids.Count
}

exit 0
