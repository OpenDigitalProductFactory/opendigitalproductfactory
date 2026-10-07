param(
    [string]$SkillPackPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    # Empty means "not named here": update_agent_toolchain.py owns the default
    # (DPF_MCP_URL, else its canonical https origin) and the OAuth auth mode.
    [string]$McpUrl = "",
    [switch]$CodexOnly,
    [switch]$CodexPluginOnly,
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
    "--skill-pack-path", $SkillPackPath
)
if ($McpUrl) { $argsList += @("--mcp-url", $McpUrl) }
if ($CodexOnly) { $argsList += "--codex-only" }
if ($CodexPluginOnly) { $argsList += "--codex-plugin-only" }
if ($ClaudeOnly) { $argsList += "--claude-only" }
if ($SkipClaudeCliInstall) { $argsList += "--skip-claude-cli-install" }
if ($DryRun) { $argsList += "--dry-run" }

& $python.Source @argsList
exit $LASTEXITCODE
