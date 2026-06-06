param(
    [string]$SkillPackPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$McpUrl = $(if ($env:DPF_MCP_URL) { $env:DPF_MCP_URL } else { "http://127.0.0.1:3000/api/mcp/v1" }),
    [switch]$CodexOnly,
    [switch]$ClaudeOnly,
    [switch]$SkipClaudeCliInstall,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$python = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $python) {
    $python = Get-Command py -ErrorAction SilentlyContinue
}
if (-not $python) {
    Write-Error "Python 3 is required to update the standalone DPF agent toolchain."
}

$argsList = @(
    (Join-Path $PSScriptRoot "update_agent_toolchain.py"),
    "--skill-pack-path", $SkillPackPath,
    "--mcp-url", $McpUrl
)
if ($CodexOnly) { $argsList += "--codex-only" }
if ($ClaudeOnly) { $argsList += "--claude-only" }
if ($SkipClaudeCliInstall) { $argsList += "--skip-claude-cli-install" }
if ($DryRun) { $argsList += "--dry-run" }

& $python.Source @argsList
exit $LASTEXITCODE
