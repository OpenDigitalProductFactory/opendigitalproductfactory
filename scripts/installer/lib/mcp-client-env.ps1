# MCP client environment for the install's own machine (BI-2D545A0C AC-2/AC-4,
# design section 12.4.3). Source this file; do not execute it directly.
# Plain ASCII for Windows PowerShell 5.1.
#
# The rule, in one place for the installer and the agent-toolchain bootstrap:
#   DPF_MCP_URL         = <PUBLIC_URL>/api/mcp/v1?tier=full when the install's
#                         .env names an https PUBLIC_URL; otherwise an explicit
#                         DPF_MCP_URL already in the environment; otherwise none
#                         (the client plugin's loopback default applies).
#   NODE_EXTRA_CA_CERTS = the organization root bundle, for an https endpoint
#                         only: DPF_PKI_TRUST_BUNDLE, then the install's .env,
#                         then ~/.dpf/pki/root_ca.crt.
# Persisted for the installing user in the User environment (the Windows analog
# of the POSIX env file + launchctl). Idempotent: a value already set is not
# written again.
#
# twin-contract: mcp-client-env-endpoint-from-public-url
# twin-contract: mcp-client-env-idempotent

if ($script:DPF_LIB_MCP_CLIENT_ENV_PS1_LOADED -eq $true) { return }
$script:DPF_LIB_MCP_CLIENT_ENV_PS1_LOADED = $true

function Get-DpfInstallEnvValue {
    param([Parameter(Mandatory)][string]$InstallDir, [Parameter(Mandatory)][string]$Name)
    $envPath = Join-Path $InstallDir ".env"
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { return "" }
    $line = Get-Content -LiteralPath $envPath | Where-Object { $_ -match "^$([Text.RegularExpressions.Regex]::Escape($Name))=" } | Select-Object -Last 1
    if (-not $line) { return "" }
    return ($line.Substring($Name.Length + 1)).Trim().Trim('"')
}

# Returns @{ McpUrl; CaBundle } (either may be empty).
function Resolve-DpfMcpClientEnv {
    param(
        [Parameter(Mandatory)][string]$InstallDir,
        [AllowEmptyString()][string]$ExplicitUrl = $env:DPF_MCP_URL,
        [AllowEmptyString()][string]$ExplicitBundle = $env:DPF_PKI_TRUST_BUNDLE,
        [string]$HomeDir = $HOME
    )
    $publicUrl = Get-DpfInstallEnvValue -InstallDir $InstallDir -Name "PUBLIC_URL"
    $mcpUrl = if ($publicUrl -like "https://*") { "$($publicUrl.TrimEnd('/'))/api/mcp/v1?tier=full" } elseif ($ExplicitUrl) { $ExplicitUrl } else { "" }
    $bundle = ""
    if ($mcpUrl -like "https://*") {
        $defaultRoot = Join-Path (Join-Path (Join-Path $HomeDir ".dpf") "pki") "root_ca.crt"
        $candidates = @($ExplicitBundle, (Get-DpfInstallEnvValue -InstallDir $InstallDir -Name "DPF_PKI_TRUST_BUNDLE"), $defaultRoot)
        foreach ($candidate in $candidates) {
            if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { $bundle = $candidate; break }
        }
    }
    return [pscustomobject]@{ McpUrl = $mcpUrl; CaBundle = $bundle }
}

# Returns "persisted", "unchanged" or "not-https". Also sets the values for the
# current process so later steps of the same run see them.
function Set-DpfMcpClientEnv {
    param(
        [Parameter(Mandatory)]$ClientEnv,
        [scriptblock]$GetUserEnv = { param($name) [System.Environment]::GetEnvironmentVariable($name, 'User') },
        [scriptblock]$SetUserEnv = { param($name, $value) [System.Environment]::SetEnvironmentVariable($name, $value, 'User') }
    )
    if ($ClientEnv.McpUrl -notlike "https://*") { return "not-https" }
    $wanted = [ordered]@{ DPF_MCP_URL = $ClientEnv.McpUrl }
    # An empty bundle (a publicly trusted certificate) leaves NODE_EXTRA_CA_CERTS
    # alone: the variable may carry the operator's own bundle.
    if ($ClientEnv.CaBundle) { $wanted["NODE_EXTRA_CA_CERTS"] = $ClientEnv.CaBundle }
    $changed = $false
    foreach ($name in $wanted.Keys) {
        $value = [string]$wanted[$name]
        if ([string](& $GetUserEnv $name) -ne $value) {
            & $SetUserEnv $name $value
            $changed = $true
        }
        Set-Item -Path "Env:$name" -Value $value
    }
    if ($changed) { return "persisted" }
    return "unchanged"
}
