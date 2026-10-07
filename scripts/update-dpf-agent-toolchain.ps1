param(
    [string]$SkillPackPath = (Resolve-Path (Join-Path $PSScriptRoot "..\packages\dpf-skill-pack")).Path,
    # Empty means "not named here"; the pack updater owns the default endpoint.
    [string]$McpUrl = "",
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
