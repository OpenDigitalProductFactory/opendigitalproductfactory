#Requires -Version 5.1
# scripts/hooks/mcp-health.ps1
#
# SessionStart dpf-MCP reachability advisory (Windows). Counterpart of mcp-health.sh.
#
# Why: the `dpf` MCP server is a remote HTTP transport. When its backing portal
# container restarts mid-session (a self-upgrade does exactly this), Claude Code
# retries the dropped HTTP connection a few times with backoff and then marks the
# server FAILED. From that point every mcp__dpf__* tool silently vanishes from the
# session for the rest of its life, and the model cannot reconnect it -- reconnect
# is a user/harness operation (`/mcp` -> dpf -> reconnect, or restart the client).
# The failure is easy to misread as "server down" when the endpoint is in fact
# healthy. This hook probes the real endpoint at session start and turns a SILENT
# strand into a LOUD, correctly-triaged advisory, so the reader knows whether the
# problem is the server, the token, or a client-side reconnect.
#
# NOTE ON SCOPE: this hook probes the ENDPOINT (server reachability); it cannot see
# Claude Code's own MCP client state, so it cannot itself confirm that mcp__dpf__*
# tools are attached this turn. Its job is disambiguation + the reconnect recipe.
#
# Invoked by the .claude/settings.json SessionStart hook via run-hook.mjs.
# Advisory only. Exit 0 ALWAYS -- a health probe must never block startup. Advisory
# text is written to stdout, which Claude Code adds to session context. Bounded 4s
# probe so it can never hang startup. Never prints the token. Plain ASCII per
# AGENTS.md. Set DPF_SKIP_MCP_HEALTH=1 to silence.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'  # never throw out of a hook

try {
    if ($env:DPF_SKIP_MCP_HEALTH -eq '1') { exit 0 }

    # Drain stdin (payload unused) so the launcher's pipe never blocks.
    [void][Console]::In.ReadToEnd()

    $runbook = 'docs/architecture/mcp-tool-authorization-runbook.md'

    # Repo root: prefer Claude Code's per-invocation env var; fall back to this
    # file's location (scripts/hooks/mcp-health.ps1 -> repo root is two dirs up).
    $root = $env:CLAUDE_PROJECT_DIR
    if ([string]::IsNullOrWhiteSpace($root)) {
        $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    }

    # Probe URL: read the dpf server url from .mcp.json when present so the probe
    # tracks the real client config; otherwise use the known local bind.
    $url = 'http://127.0.0.1:3000/api/mcp/v1'
    $cfg = Join-Path $root '.mcp.json'
    if (Test-Path -LiteralPath $cfg) {
        try {
            $u = (Get-Content -Raw -LiteralPath $cfg | ConvertFrom-Json).mcpServers.dpf.url
            if (-not [string]::IsNullOrWhiteSpace($u)) { $url = $u }
        }
        catch { }  # malformed/partial config -> fall back to the default bind
    }

    # A "localhost" url is a latent failure on hosts where localhost resolves to
    # ::1 and IPv6 is not answering; 127.0.0.1 is the safe literal.
    if ($url -match 'localhost') {
        Write-Output "NOTE: DPF MCP -- .mcp.json points dpf at '$url'. If localhost resolves to ::1 and IPv6 is not answering, the client cannot connect; use the 127.0.0.1 literal instead."
    }

    if ([string]::IsNullOrWhiteSpace($env:DPF_MCP_BEARER_TOKEN)) {
        Write-Output "NOTE: DPF MCP -- DPF_MCP_BEARER_TOKEN is not set in this environment; the dpf server cannot authenticate. Set the user env var, then restart the client. Runbook: $runbook (Token rotation). Silence: DPF_SKIP_MCP_HEALTH=1."
        exit 0
    }

    # Probe the real MCP contract: POST tools/list with the bearer. Capture the
    # HTTP status without throwing -- PS 5.1 Invoke-WebRequest raises on non-2xx,
    # so read the code back off the WebException Response; a connect failure has
    # no Response and is reported as 000.
    $code = 0
    try {
        $resp = Invoke-WebRequest -Uri $url -Method Post -UseBasicParsing -TimeoutSec 4 `
            -Headers @{ Authorization = "Bearer $($env:DPF_MCP_BEARER_TOKEN)" } `
            -ContentType 'application/json' `
            -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
        $code = [int]$resp.StatusCode
    }
    catch {
        $resp = $_.Exception.Response
        if ($resp -and ($resp.PSObject.Properties.Name -contains 'StatusCode')) {
            try { $code = [int]$resp.StatusCode.value__ } catch { $code = 0 }
        }
        else { $code = 0 }
    }

    switch ($code) {
        200 {
            Write-Output "OK: dpf MCP endpoint reachable and authenticating (HTTP 200) at $url."
            Write-Output "  If mcp__dpf__* tools are ABSENT this session, the server is healthy -- this is a CLIENT-side dropped connection (common trigger: the portal self-upgraded and restarted). The model cannot reconnect it; in an interactive client run '/mcp' -> select dpf -> reconnect (or '/mcp reconnect dpf'), else restart the client. Runbook: $runbook. Silence: DPF_SKIP_MCP_HEALTH=1."
        }
        { $_ -eq 401 -or $_ -eq 403 } {
            Write-Output "WARNING: dpf MCP endpoint at $url returned HTTP $code (auth rejected). The bearer token is absent/invalid/expired -- rotate or reseed it (never print it). Runbook: $runbook (Token rotation)."
        }
        0 {
            Write-Output "WARNING: dpf MCP endpoint at $url is UNREACHABLE (no HTTP response within 4s). The portal/runtime is down or mid-restart (a self-upgrade restarts the container). Check runtime health; once it answers, reconnect with '/mcp' or restart the client. Runbook: $runbook (Diagnosis order)."
        }
        default {
            Write-Output "WARNING: dpf MCP endpoint at $url returned HTTP $code (unexpected). Check runtime health. Runbook: $runbook (Diagnosis order)."
        }
    }
}
catch {
    # never fail a session start
}
exit 0
