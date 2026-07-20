# PowerShell 5.1-compatible organization PKI bootstrap for Windows.
[CmdletBinding()]
param(
    [ValidateSet("authority", "join")][string]$Mode = "authority",
    [Parameter(Mandatory)][string]$Hostname,
    [string[]]$San = @(),
    [string]$OutDir = (Join-Path $env:USERPROFILE ".dpf\pki"),
    [string]$BindAddress = "127.0.0.1",
    [string]$CaUrl,
    [string]$Fingerprint,
    [string]$TokenFile,
    [string]$OrganizationName = "DPF Organization CA",
    [switch]$NoStartTls
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$StepImage = "smallstep/step-ca:0.30.2@sha256:a2b17872915c193259b75a5474c398326f41bd199f0842093e52cf4182bc8270"
$RootCert = Join-Path $OutDir "root_ca.crt"
$FingerprintFile = Join-Path $OutDir "root_ca.fingerprint"
$PasswordFile = Join-Path $OutDir "secrets\step-ca-password"
$script:PasswordFileEffective = $PasswordFile
$AuthorityCert = Join-Path $OutDir "authority.crt"
$AuthorityKey = Join-Path $OutDir "authority.key"
$Caddyfile = Join-Path $OutDir "Caddyfile"

if ($Hostname -notmatch '^[A-Za-z0-9._:-]+$') { throw "Hostname contains unsupported characters" }
foreach ($name in $San) {
    if ($name -notmatch '^[A-Za-z0-9._:-]+$') { throw "SAN contains unsupported characters" }
}
$parsedBind = $null
if (-not [Net.IPAddress]::TryParse($BindAddress, [ref]$parsedBind) -or $parsedBind.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
    throw "BindAddress must be a private IPv4 address or loopback"
}
$octets = $BindAddress.Split('.') | ForEach-Object { [int]$_ }
$isPrivate = $octets[0] -eq 127 -or $octets[0] -eq 10 -or ($octets[0] -eq 192 -and $octets[1] -eq 168) -or ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31)
if (-not $isPrivate) { throw "BindAddress must be a private IPv4 address or loopback" }

function Invoke-DpfPkiCompose {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $old = @{
        DPF_PKI_PASSWORD_FILE = $env:DPF_PKI_PASSWORD_FILE
        DPF_PKI_TRUST_BUNDLE = $env:DPF_PKI_TRUST_BUNDLE
        DPF_PKI_BIND_ADDRESS = $env:DPF_PKI_BIND_ADDRESS
        DPF_PKI_DNS_NAMES = $env:DPF_PKI_DNS_NAMES
        DPF_PKI_NAME = $env:DPF_PKI_NAME
        DPF_TLS_DIR = $env:DPF_TLS_DIR
    }
    try {
        $env:DPF_PKI_PASSWORD_FILE = $script:PasswordFileEffective
        $env:DPF_PKI_TRUST_BUNDLE = $RootCert
        $env:DPF_PKI_BIND_ADDRESS = $BindAddress
        $env:DPF_PKI_DNS_NAMES = "$Hostname,$BindAddress,localhost,127.0.0.1"
        $env:DPF_PKI_NAME = $OrganizationName
        $env:DPF_TLS_DIR = $OutDir
        & docker compose --project-directory $RepoRoot -f (Join-Path $RepoRoot "docker-compose.yml") -f (Join-Path $RepoRoot "docker-compose.pki.yml") @Arguments
        if ($LASTEXITCODE -ne 0) { throw "organization_pki_compose_failed" }
    } finally {
        foreach ($key in $old.Keys) {
            if ($null -eq $old[$key]) {
                Remove-Item -Path "env:$key" -ErrorAction SilentlyContinue
            } else {
                Set-Item -Path "env:$key" -Value $old[$key]
            }
        }
    }
}

if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { throw "Docker is required" }
New-Item -ItemType Directory -Force -Path $OutDir, (Join-Path $OutDir "secrets") | Out-Null

if ($Mode -eq "authority") {
    if (-not (Test-Path -LiteralPath $PasswordFile)) {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $secret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
        [IO.File]::WriteAllText($PasswordFile, $secret, (New-Object Text.UTF8Encoding($false)))
        $secret = $null
    }
    & icacls $OutDir /inheritance:r /grant:r "$env:USERNAME`:(OI)(CI)F" 2>&1 | Out-Null

    # Existing CA state is always reused. There is deliberately no force or
    # reinitialize switch: silent replacement would invalidate every peer.
    Invoke-DpfPkiCompose -Arguments @("up", "-d", "step-ca")
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            Invoke-DpfPkiCompose -Arguments @("exec", "-T", "step-ca", "step", "ca", "health", "--ca-url", "https://127.0.0.1:9000", "--root", "/home/step/certs/root_ca.crt") 2>$null | Out-Null
            $ready = $true
            break
        } catch {
            # The authority normally rejects health checks while its first-run
            # initialization is still completing. Retry within the bounded loop.
        }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "Organization CA did not become healthy" }
    Invoke-DpfPkiCompose -Arguments @("cp", "step-ca:/home/step/certs/root_ca.crt", $RootCert)
    $Fingerprint = (Invoke-DpfPkiCompose -Arguments @("exec", "-T", "step-ca", "step", "certificate", "fingerprint", "/home/step/certs/root_ca.crt")).Trim()
    $sanArguments = @("--san", $Hostname)
    foreach ($name in $San) { $sanArguments += @("--san", $name) }
    $hasCert = $true
    try { Invoke-DpfPkiCompose -Arguments @("exec", "-T", "step-ca", "test", "-f", "/home/step/certs/dpf-portal.crt") | Out-Null } catch { $hasCert = $false }
    $hasKey = $true
    try { Invoke-DpfPkiCompose -Arguments @("exec", "-T", "step-ca", "test", "-f", "/home/step/secrets/dpf-portal.key") | Out-Null } catch { $hasKey = $false }
    if ($hasCert -and $hasKey) {
        Invoke-DpfPkiCompose -Arguments @("exec", "-T", "step-ca", "step", "ca", "renew", "/home/step/certs/dpf-portal.crt", "/home/step/secrets/dpf-portal.key", "--ca-url", "https://127.0.0.1:9000", "--root", "/home/step/certs/root_ca.crt", "--force") | Out-Null
    } else {
        $tokenArguments = @("exec", "-T", "step-ca", "step", "ca", "token", $Hostname) + $sanArguments + @("--provisioner", "dpf-installer", "--password-file", "/run/secrets/step-ca-password")
        $enrollmentToken = (Invoke-DpfPkiCompose -Arguments $tokenArguments).Trim()
        $certificateArguments = @("exec", "-T", "step-ca", "step", "ca", "certificate", $Hostname, "/home/step/certs/dpf-portal.crt", "/home/step/secrets/dpf-portal.key", "--token", $enrollmentToken, "--ca-url", "https://127.0.0.1:9000", "--root", "/home/step/certs/root_ca.crt", "--force")
        Invoke-DpfPkiCompose -Arguments $certificateArguments | Out-Null
        $enrollmentToken = $null
    }
    if ($LASTEXITCODE -ne 0) { throw "organization_pki_leaf_issue_failed" }
    Invoke-DpfPkiCompose -Arguments @("cp", "step-ca:/home/step/certs/dpf-portal.crt", $AuthorityCert)
    Invoke-DpfPkiCompose -Arguments @("cp", "step-ca:/home/step/secrets/dpf-portal.key", $AuthorityKey)
} else {
    if (-not $CaUrl -or -not $Fingerprint) { throw "join mode requires CaUrl and Fingerprint" }
    if (-not $CaUrl.StartsWith("https://", [StringComparison]::OrdinalIgnoreCase)) { throw "join mode requires an HTTPS CaUrl" }
    $hasLocalLeaf = (Test-Path -LiteralPath $AuthorityCert) -and (Test-Path -LiteralPath $AuthorityKey)
    if ($hasLocalLeaf) {
        $script:PasswordFileEffective = $AuthorityKey
    } else {
        if (-not $TokenFile -or -not (Test-Path -LiteralPath $TokenFile)) { throw "first join requires an existing TokenFile" }
        $tokenAcl = & icacls $TokenFile
        if ($tokenAcl -match "Everyone|BUILTIN\\Users") { throw "Enrollment token file must be private" }
        $script:PasswordFileEffective = $TokenFile
    }
    & docker run --rm --mount "type=bind,src=$OutDir,dst=/work" $StepImage step ca root /work/root_ca.crt --ca-url $CaUrl --fingerprint $Fingerprint --force | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "organization_pki_root_bootstrap_failed" }
    if ($hasLocalLeaf) {
        & docker run --rm --mount "type=bind,src=$OutDir,dst=/work" $StepImage step ca renew /work/authority.crt /work/authority.key --ca-url $CaUrl --root /work/root_ca.crt --force | Out-Null
    } else {
        & docker run --rm --mount "type=bind,src=$OutDir,dst=/work" --mount "type=bind,src=$TokenFile,dst=/run/secrets/enrollment-token,readonly" $StepImage sh -c 'step ca certificate "$1" /work/authority.crt /work/authority.key --token "$(cat /run/secrets/enrollment-token)" --ca-url "$2" --root /work/root_ca.crt --force' sh $Hostname $CaUrl | Out-Null
    }
    if ($LASTEXITCODE -ne 0) { throw "organization_pki_leaf_issue_failed" }
}

[IO.File]::WriteAllText($FingerprintFile, "$Fingerprint`n", (New-Object Text.UTF8Encoding($false)))
$hosts = ((@($Hostname) + $San) | ForEach-Object { "$_`:443" }) -join ", "
$caddy = @"
{
    auto_https off
}

$hosts {
    tls /etc/caddy/tls/authority.crt /etc/caddy/tls/authority.key
    reverse_proxy portal:3000
}
"@
[IO.File]::WriteAllText($Caddyfile, $caddy, (New-Object Text.UTF8Encoding($false)))

if (-not $NoStartTls) {
    Invoke-DpfPkiCompose -Arguments @("-f", (Join-Path $RepoRoot "docker-compose.tls.yml"), "up", "-d", "portal", "portal-tls")
    Invoke-DpfPkiCompose -Arguments @("-f", (Join-Path $RepoRoot "docker-compose.tls.yml"), "restart", "portal-tls") | Out-Null
}

Write-Host "Organization HTTPS is configured for $Hostname."
Write-Host "Public root fingerprint: $Fingerprint"
Write-Host "PKI recovery directory: $OutDir (protect and back up with host secrets)."
