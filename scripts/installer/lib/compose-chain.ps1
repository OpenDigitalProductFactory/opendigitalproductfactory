# Canonical PowerShell compose-chain resolver for install/start/stop/uninstall.
# Source this file; do not execute it directly. Plain ASCII for Windows PowerShell 5.1.

if ($script:DPF_LIB_COMPOSE_CHAIN_PS1_LOADED -eq $true) { return }
$script:DPF_LIB_COMPOSE_CHAIN_PS1_LOADED = $true

function Test-DPFEnvFlag {
    param([Parameter(Mandatory)][string]$InstallDir, [Parameter(Mandatory)][string]$Name)
    $environmentValue = [Environment]::GetEnvironmentVariable($Name)
    if ($environmentValue -eq "1") { return $true }
    $envPath = Join-Path $InstallDir ".env"
    return (Test-Path -LiteralPath $envPath) -and
        [bool](Select-String -LiteralPath $envPath -Pattern "^$([Text.RegularExpressions.Regex]::Escape($Name))=1$" -Quiet)
}

function Add-DPFComposeFile {
    param([object[]]$ComposeArgs, [string]$InstallDir, [string]$Name)
    if (Test-Path -LiteralPath (Join-Path $InstallDir $Name)) {
        return @($ComposeArgs) + @("-f", $Name)
    }
    return @($ComposeArgs)
}

function Get-DPFComposeArgs {
    param(
        [Parameter(Mandatory)][string]$InstallDir,
        [ValidateSet("Start", "Stop")][string]$Purpose = "Start",
        [bool]$IncludeEdge = $false,
        [bool]$IncludeOverride = $true,
        [bool]$IncludeRelease = $false,
        [bool]$IncludePki = $false
    )

    $chain = @("-f", "docker-compose.yml")
    if ($Purpose -eq "Stop") {
        # Down must name every overlay that may have created resources. Docker
        # Compose safely ignores services that were never started.
        foreach ($overlay in @(
            "docker-compose.release.yml",
            "docker-compose.override.yml",
            "docker-compose.edge.yml",
            "docker-compose.edge-actions.yml",
            "docker-compose.organization-trust.yml",
            "docker-compose.pki.yml",
            "docker-compose.tls.yml"
        )) { $chain = Add-DPFComposeFile -ComposeArgs $chain -InstallDir $InstallDir -Name $overlay }
        return $chain
    }

    if ($IncludeRelease) { $chain = Add-DPFComposeFile -ComposeArgs $chain -InstallDir $InstallDir -Name "docker-compose.release.yml" }
    if ($IncludeOverride) { $chain = Add-DPFComposeFile -ComposeArgs $chain -InstallDir $InstallDir -Name "docker-compose.override.yml" }
    if ($IncludeEdge) { $chain = Add-DPFComposeFile -ComposeArgs $chain -InstallDir $InstallDir -Name "docker-compose.edge.yml" }
    if (Test-DPFEnvFlag -InstallDir $InstallDir -Name "DPF_EDGE_ACTION_DISPATCH_CONFIGURED") {
        $chain = Add-DPFComposeFile -ComposeArgs $chain -InstallDir $InstallDir -Name "docker-compose.edge-actions.yml"
    }
    if (Test-DPFEnvFlag -InstallDir $InstallDir -Name "DPF_ORGANIZATION_TRUST_ENABLED") {
        $chain = Add-DPFComposeFile -ComposeArgs $chain -InstallDir $InstallDir -Name "docker-compose.organization-trust.yml"
        $chain = Add-DPFComposeFile -ComposeArgs $chain -InstallDir $InstallDir -Name "docker-compose.tls.yml"
    }
    if ($IncludePki) { $chain = Add-DPFComposeFile -ComposeArgs $chain -InstallDir $InstallDir -Name "docker-compose.pki.yml" }
    return $chain
}
