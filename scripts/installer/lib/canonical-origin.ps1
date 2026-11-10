# Canonical install origin resolver (BI-6DC1CD5B, design section 12.4.1).
# Source this file; do not execute it directly. Plain ASCII for Windows PowerShell 5.1.
#
# One https origin per install, chosen without operator input:
#   1. an explicit operator name (PUBLIC_URL already in .env, or -ExplicitHost);
#   2. the loopback name when the install serves this machine only
#      (DPF_HOST_BIND_ADDRESS is a loopback address);
#   3. the machine's DNS name when the network resolves it to one of this
#      machine's own non-loopback IPv4 addresses;
#   4. otherwise "localhost".
# The certificate names are the canonical host plus the loopback spellings, so
# a browser that types localhost or 127.0.0.1 gets a valid certificate and is
# then redirected to the canonical origin by the portal (PUBLIC_URL_ALIASES is
# deliberately left empty: an alias would be served, not redirected).
#
# twin-contract: canonical-origin-choice-order
# twin-contract: canonical-origin-https-only
# twin-contract: canonical-origin-certificate-sans

if ($script:DPF_LIB_CANONICAL_ORIGIN_PS1_LOADED -eq $true) { return }
$script:DPF_LIB_CANONICAL_ORIGIN_PS1_LOADED = $true

$script:DpfLoopbackNames = @("localhost", "127.0.0.1")

function Get-DpfEnvValue {
    param([Parameter(Mandatory)][string]$InstallDir, [Parameter(Mandatory)][string]$Name)
    $envPath = Join-Path $InstallDir ".env"
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { return $null }
    $line = Get-Content -LiteralPath $envPath | Where-Object { $_ -match "^$([Text.RegularExpressions.Regex]::Escape($Name))=" } | Select-Object -Last 1
    if (-not $line) { return $null }
    return ($line.Substring($Name.Length + 1)).Trim().Trim('"')
}

function Test-DpfLoopbackAddress {
    param([string]$Address)
    if (-not $Address) { return $true }
    return $Address -eq "127.0.0.1" -or $Address -eq "::1" -or $Address -eq "localhost" -or $Address.StartsWith("127.")
}

function Get-DpfLocalIPv4Addresses {
    try {
        return @([Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
            Where-Object { $_.OperationalStatus -eq [Net.NetworkInformation.OperationalStatus]::Up } |
            ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
            Where-Object { $_.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and -not [Net.IPAddress]::IsLoopback($_.Address) } |
            ForEach-Object { $_.Address.ToString() })
    } catch {
        return @()
    }
}

function Get-DpfMachineDnsName {
    param([scriptblock]$Resolve = { param($name) [Net.Dns]::GetHostEntry($name) })
    try {
        $entry = & $Resolve ([Net.Dns]::GetHostName())
        $name = "$($entry.HostName)".Trim().TrimEnd('.').ToLowerInvariant()
        # A bare NetBIOS name is not a DNS name other machines can resolve.
        if ($name -and $name.Contains('.') -and -not $name.EndsWith('.local')) { return $name }
    } catch { }
    return $null
}

function Test-DpfNameResolvesToThisMachine {
    param(
        [Parameter(Mandatory)][string]$Name,
        [string[]]$LocalAddresses = (Get-DpfLocalIPv4Addresses),
        [scriptblock]$Resolve = { param($n) [Net.Dns]::GetHostAddresses($n) }
    )
    try {
        $resolved = @(& $Resolve $Name | Where-Object { $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork } | ForEach-Object { $_.ToString() })
    } catch {
        return $false
    }
    foreach ($address in $resolved) {
        if ($LocalAddresses -contains $address) { return $true }
    }
    return $false
}

function Resolve-DpfCanonicalOrigin {
    param(
        [Parameter(Mandatory)][string]$InstallDir,
        [string]$ExplicitHost,
        [string]$BindAddress,
        [string]$MachineDnsName = (Get-DpfMachineDnsName),
        [scriptblock]$ResolvesHere = { param($n) Test-DpfNameResolvesToThisMachine -Name $n }
    )
    $source = $null
    $canonicalHost = $null

    if ($ExplicitHost) {
        $canonicalHost = $ExplicitHost.Trim().ToLowerInvariant(); $source = "explicit"
    } else {
        $existing = Get-DpfEnvValue -InstallDir $InstallDir -Name "PUBLIC_URL"
        $parsed = $null
        if ($existing -and [Uri]::TryCreate($existing, [UriKind]::Absolute, [ref]$parsed) -and $parsed.Scheme -eq "https") {
            $canonicalHost = $parsed.Host.ToLowerInvariant(); $source = "existing-public-url"
        }
    }
    if (-not $canonicalHost) {
        if (-not $BindAddress) { $BindAddress = Get-DpfEnvValue -InstallDir $InstallDir -Name "DPF_HOST_BIND_ADDRESS" }
        if (Test-DpfLoopbackAddress -Address $BindAddress) {
            $canonicalHost = "localhost"; $source = "loopback-bind"
        } elseif ($MachineDnsName -and (& $ResolvesHere $MachineDnsName)) {
            $canonicalHost = $MachineDnsName; $source = "machine-dns-name"
        } else {
            $canonicalHost = "localhost"; $source = "no-network-name"
        }
    }
    if ($canonicalHost -notmatch '^[a-z0-9.-]+$') { throw "canonical_host_invalid" }

    $certificateNames = @(@($canonicalHost) + $script:DpfLoopbackNames | Sort-Object -Unique)
    return [pscustomobject]@{
        Host             = $canonicalHost
        PublicUrl        = "https://$canonicalHost"
        McpUrl           = "https://$canonicalHost/api/mcp/v1?tier=full"
        CertificateSans  = @($certificateNames | Where-Object { $_ -ne $canonicalHost })
        Source           = $source
    }
}

function Set-DpfEnvValue {
    param([Parameter(Mandatory)][string]$InstallDir, [Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][AllowEmptyString()][string]$Value)
    $envPath = Join-Path $InstallDir ".env"
    if ($Value -match "[`r`n]") { throw "env_value_contains_newline" }
    $lines = @()
    if (Test-Path -LiteralPath $envPath -PathType Leaf) {
        $lines = @(Get-Content -LiteralPath $envPath | Where-Object { $_ -notmatch "^$([Text.RegularExpressions.Regex]::Escape($Name))=" })
    }
    $lines += "$Name=$Value"
    [IO.File]::WriteAllLines($envPath, $lines, (New-Object Text.UTF8Encoding($false)))
}
