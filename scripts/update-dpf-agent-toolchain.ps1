param(
    [string]$SkillPackPath = (Resolve-Path (Join-Path $PSScriptRoot "..\packages\dpf-skill-pack")).Path,
    [string]$McpUrl = $(if ($env:DPF_MCP_URL) { $env:DPF_MCP_URL } else { "http://127.0.0.1:3000/api/mcp/v1" }),
    [switch]$CodexOnly,
    [switch]$ClaudeOnly,
    [switch]$SkipClaudeCliInstall,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$script = Join-Path $SkillPackPath "scripts\update-agent-toolchain.ps1"
if (-not (Test-Path -LiteralPath $script)) {
    Write-Error "Standalone DPF agent toolchain updater missing at $script"
}

& $script `
    -SkillPackPath $SkillPackPath `
    -McpUrl $McpUrl `
    -CodexOnly:$CodexOnly `
    -ClaudeOnly:$ClaudeOnly `
    -SkipClaudeCliInstall:$SkipClaudeCliInstall `
    -DryRun:$DryRun
exit $LASTEXITCODE
