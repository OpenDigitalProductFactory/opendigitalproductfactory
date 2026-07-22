# Host-native Edge Node installation for Windows. Docker Desktop does not
# expose the Windows host multicast interfaces to Linux containers.

function Get-DPFNativeEdgeReleaseUri {
    param([string]$Version, [Parameter(Mandatory)][string]$Asset)
    if ($Version -and $Version -ne "latest") {
        return "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/releases/download/$Version/$Asset"
    }
    return "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/releases/latest/download/$Asset"
}

function Install-DPFNativeEdgeNode {
    param(
        [Parameter(Mandatory)][string]$InstallDir,
        [Parameter(Mandatory)][string]$BootstrapToken,
        [string]$AuthorityUrl = $env:DPF_LAN_AUTHORITY_URL,
        [string]$Version = "latest"
    )

    if (-not $AuthorityUrl) {
        $lanAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.PrefixOrigin -ne 'WellKnown' } |
            Select-Object -ExpandProperty IPAddress -First 1
        if ($lanAddress) {
            $AuthorityUrl = "http://$lanAddress`:3000"
        } else {
            $AuthorityUrl = "http://127.0.0.1:3000"
            Write-Warn "No active private IPv4 address was detected; nearby peers cannot reach this installation until DPF_LAN_AUTHORITY_URL is set."
        }
    }
    if (-not $AuthorityUrl.StartsWith("https://", [StringComparison]::OrdinalIgnoreCase)) {
        Write-Warn "Nearby discovery will work at $AuthorityUrl, but automatic pairing remains blocked until DPF_LAN_AUTHORITY_URL is certificate-valid HTTPS."
    }

    $stateRoot = Join-Path $env:USERPROFILE ".dpf"
    $binDir = Join-Path $stateRoot "bin"
    $stateDir = Join-Path $stateRoot "edge-node"
    $logDir = Join-Path $stateRoot "logs"
    $binary = Join-Path $binDir "dpf-edge-node.exe"
    $runner = Join-Path $stateRoot "run-edge-node.ps1"
    $asset = "dpf-edge-node-windows-amd64.exe"
    $checksumsAsset = "dpf-edge-node-checksums.sha256"
    $sourceBinary = Join-Path $InstallDir "services\edge-node-go\bin\$asset"
    New-Item -ItemType Directory -Force -Path $binDir, $stateDir, $logDir | Out-Null

    if (Test-Path -LiteralPath $sourceBinary) {
        Copy-Item -LiteralPath $sourceBinary -Destination $binary -Force
    } elseif ((Get-Command go.exe -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $InstallDir "services\edge-node-go\go.mod"))) {
        $oldGoos = $env:GOOS
        $oldGoarch = $env:GOARCH
        $oldCgo = $env:CGO_ENABLED
        try {
            $env:GOOS = "windows"
            $env:GOARCH = "amd64"
            $env:CGO_ENABLED = "0"
            Push-Location (Join-Path $InstallDir "services\edge-node-go")
            go build -trimpath -ldflags "-s -w -X main.Version=$Version" -o $binary ./cmd/dpf-edge-node
            if ($LASTEXITCODE -ne 0) { throw "native_edge_build_failed" }
        } finally {
            Pop-Location
            $env:GOOS = $oldGoos
            $env:GOARCH = $oldGoarch
            $env:CGO_ENABLED = $oldCgo
        }
    } else {
        $temporary = Join-Path ([IO.Path]::GetTempPath()) ("dpf-native-edge-" + [Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $temporary | Out-Null
        try {
            $downloadedBinary = Join-Path $temporary $asset
            $downloadedChecksums = Join-Path $temporary $checksumsAsset
            Invoke-WebRequest -UseBasicParsing -Uri (Get-DPFNativeEdgeReleaseUri -Version $Version -Asset $asset) -OutFile $downloadedBinary
            Invoke-WebRequest -UseBasicParsing -Uri (Get-DPFNativeEdgeReleaseUri -Version $Version -Asset $checksumsAsset) -OutFile $downloadedChecksums
            $checksumLine = Get-Content -LiteralPath $downloadedChecksums | Where-Object { $_ -match "  $([Regex]::Escape($asset))$" } | Select-Object -First 1
            if (-not $checksumLine) { throw "native_edge_checksum_missing" }
            $expected = ($checksumLine -split '\s+')[0].ToLowerInvariant()
            $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $downloadedBinary).Hash.ToLowerInvariant()
            if ($actual -cne $expected) { throw "native_edge_checksum_mismatch" }
            Copy-Item -LiteralPath $downloadedBinary -Destination $binary -Force
        } finally {
            Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    $nodeName = [System.Net.Dns]::GetHostName()
    $escapedBinary = $binary.Replace("'", "''")
    $escapedAuthority = $AuthorityUrl.Replace("'", "''")
    $escapedToken = $BootstrapToken.Replace("'", "''")
    $escapedNodeName = $nodeName.Replace("'", "''")
    $escapedState = $stateDir.Replace("'", "''")
    $actionEnvironment = ""
    $platformEnv = Join-Path $InstallDir ".env"
    $actionValues = @{}
    if (Test-Path -LiteralPath $platformEnv -PathType Leaf) {
        foreach ($line in [IO.File]::ReadAllLines($platformEnv)) {
            $separator = $line.IndexOf('=')
            if ($separator -gt 0) { $actionValues[$line.Substring(0, $separator)] = $line.Substring($separator + 1) }
        }
        $requiredActionKeys = @("DPF_EDGE_ACTION_URL", "DPF_EDGE_ACTION_CA_FILE", "DPF_EDGE_ACTION_CERT_FILE", "DPF_EDGE_ACTION_KEY_FILE", "DPF_EDGE_ACTION_SIGNING_PUBLIC_KEY_FILE")
        $completeActionTrust = $true
        foreach ($key in $requiredActionKeys) {
            if (-not $actionValues[$key]) { $completeActionTrust = $false }
        }
        if ($completeActionTrust -and (Test-Path -LiteralPath $actionValues.DPF_EDGE_ACTION_CA_FILE) -and
            (Test-Path -LiteralPath $actionValues.DPF_EDGE_ACTION_CERT_FILE) -and
            (Test-Path -LiteralPath $actionValues.DPF_EDGE_ACTION_KEY_FILE) -and
            (Test-Path -LiteralPath $actionValues.DPF_EDGE_ACTION_SIGNING_PUBLIC_KEY_FILE)) {
            foreach ($key in $requiredActionKeys) {
                $escapedValue = $actionValues[$key].Replace("'", "''")
                $actionEnvironment += "`$env:$key = '$escapedValue'`r`n"
            }
        }
    }
    $organizationRole = if ($actionValues.DPF_ORGANIZATION_TRUST_ROLE) { $actionValues.DPF_ORGANIZATION_TRUST_ROLE } else { "member" }
    $organizationPkiDir = if ($actionValues.DPF_PKI_DIR) { $actionValues.DPF_PKI_DIR } else { (Join-Path $stateRoot "pki") }
    $escapedInstallRoot = $InstallDir.Replace("'", "''")
    $escapedOrganizationRole = $organizationRole.Replace("'", "''")
    $escapedOrganizationPkiDir = $organizationPkiDir.Replace("'", "''")
    $organizationEnvironment = "`$env:DPF_INSTALL_ROOT = '$escapedInstallRoot'`r`n`$env:DPF_ORGANIZATION_TRUST_ROLE = '$escapedOrganizationRole'`r`n`$env:DPF_PKI_DIR = '$escapedOrganizationPkiDir'`r`n"
    if ($actionValues.DPF_ORGANIZATION_CA_URL) {
        $escapedOrganizationCaUrl = $actionValues.DPF_ORGANIZATION_CA_URL.Replace("'", "''")
        $organizationEnvironment += "`$env:DPF_ORGANIZATION_CA_URL = '$escapedOrganizationCaUrl'`r`n"
    }
    @"
`$env:DPF_AUTHORITY_URL = '$escapedAuthority'
`$env:DPF_BOOTSTRAP_TOKEN = '$escapedToken'
`$env:DPF_EDGE_NODE_NAME = '$escapedNodeName'
`$env:DPF_INSTALL_MODE = 'native'
`$env:DPF_EDGE_STATE_DIR = '$escapedState'
$organizationEnvironment
$actionEnvironment& '$escapedBinary' *>> '$($logDir.Replace("'", "''"))\edge-node.log'
"@ | Set-Content -LiteralPath $runner -Encoding ASCII

    icacls $stateRoot /inheritance:r /grant:r "$env:USERNAME`:(OI)(CI)F" 2>&1 | Out-Null
    $firewallName = "DPF Native Edge Node mDNS"
    if (-not (Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Action Allow -Protocol UDP -LocalPort 5353 -Program $binary -Profile Private | Out-Null
    } else {
        Set-NetFirewallRule -DisplayName $firewallName -Enabled True -Action Allow | Out-Null
    }
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NoLogo -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName "DPF-Native-Edge-Node" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Run the DPF native Edge Node on host network interfaces." -Force | Out-Null
    Start-ScheduledTask -TaskName "DPF-Native-Edge-Node"
    Write-OK "Native Edge Node installed and supervised by Windows Task Scheduler"
    return $true
}
