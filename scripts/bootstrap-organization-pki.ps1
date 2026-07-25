# PowerShell 5.1-compatible organization PKI bootstrap for Windows.
[CmdletBinding()]
param(
    [ValidateSet("authority", "issue-join", "join")][string]$Mode = "authority",
    [string]$Hostname,
    [string[]]$San = @(),
    [string]$OutDir = (Join-Path $env:USERPROFILE ".dpf\pki"),
    [string]$BindAddress = "127.0.0.1",
    [string]$CaUrl,
    [string]$Fingerprint,
    [string]$TokenFile,
    [string]$JoinPackage,
    [string]$PackageOutput,
    [ValidateRange(300, 900)][int]$PackageTtlSeconds = 900,
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
$EdgeClientCert = Join-Path $OutDir "edge-client.crt"
$EdgeClientKey = Join-Path $OutDir "edge-client.key"
$ActionSigningPublic = Join-Path $OutDir "edge-action-signing-public.pem"
$ActionSigningPrivate = Join-Path $OutDir "secrets\edge-action-signing-private.pem"
$ActionSigningPassword = Join-Path $OutDir "secrets\edge-action-signing-password"
$MtlsProxySecret = Join-Path $OutDir "secrets\edge-mtls-proxy-secret"
$PackageId = $null
$PackageToken = $null
$PackageEdgeToken = $null
$EdgeTokenFile = $null
$EdgeActionConfigured = $false

if ($Mode -eq "join" -and $JoinPackage) {
    if (-not (Test-Path -LiteralPath $JoinPackage -PathType Leaf)) { throw "Join package was not found" }
    $tokenAcl = & icacls $JoinPackage
    if ($tokenAcl -match "Everyone|BUILTIN\\Users") { throw "Join package must be private" }
    $lines = [IO.File]::ReadAllLines($JoinPackage)
    if ($lines.Count -lt 2 -or $lines[0].TrimEnd("`r") -notin @("DPF_ORGANIZATION_JOIN_V1", "DPF_ORGANIZATION_JOIN_V2")) { throw "Join package version is not supported" }
    $packageVersion = $lines[0].TrimEnd("`r")
    $fields = @{}
    foreach ($line in $lines[1..($lines.Count - 1)]) {
        $clean = $line.TrimEnd("`r")
        if (-not $clean) { continue }
        $separator = $clean.IndexOf('=')
        if ($separator -lt 1) { throw "Join package contains a malformed field" }
        $key = $clean.Substring(0, $separator)
        $value = $clean.Substring($separator + 1)
        if ($fields.ContainsKey($key)) { throw "Join package contains duplicate fields" }
        if ($key -notin @("package_id", "ca_url", "root_fingerprint", "intended_hostname", "intended_sans", "expires_at", "enrollment_token", "edge_client_enrollment_token")) {
            throw "Join package contains an unknown field"
        }
        $fields[$key] = $value
    }
    foreach ($required in @("package_id", "ca_url", "root_fingerprint", "intended_hostname", "expires_at", "enrollment_token")) {
        if (-not $fields.ContainsKey($required) -or -not $fields[$required]) { throw "Join package is incomplete" }
    }
    if ($fields.package_id -notmatch '^[a-f0-9]{32}$') { throw "Join package id is invalid" }
    if ($fields.root_fingerprint -notmatch '^[A-Fa-f0-9]{64}$') { throw "Join package root fingerprint is invalid" }
    if ($fields.intended_hostname -notmatch '^[A-Za-z0-9._:-]+$') { throw "Join package intended peer is invalid" }
    if ($fields.expires_at -notmatch '^[0-9]{1,12}$') { throw "Join package expiry is invalid" }
    if ($fields.enrollment_token -notmatch '^[A-Za-z0-9._-]+$') { throw "Join package enrollment authority is invalid" }
    if ($packageVersion -eq "DPF_ORGANIZATION_JOIN_V2" -and $fields.edge_client_enrollment_token -notmatch '^[A-Za-z0-9._-]+$') { throw "Join package Edge client enrollment authority is invalid" }
    $nowEpoch = [int64]([DateTime]::UtcNow - [DateTime]'1970-01-01').TotalSeconds
    if ([int64]$fields.expires_at -le $nowEpoch) { throw "Join package has expired" }
    if ($Hostname -and $Hostname -ne $fields.intended_hostname) { throw "Join package is intended for another installation" }
    $Hostname = $fields.intended_hostname
    $San = if ($fields.intended_sans) { @($fields.intended_sans.Split(',') | Where-Object { $_ }) } else { @() }
    $CaUrl = $fields.ca_url
    $Fingerprint = $fields.root_fingerprint
    $PackageId = $fields.package_id
    $PackageToken = $fields.enrollment_token
    $PackageEdgeToken = $fields.edge_client_enrollment_token
}

if (-not $Hostname) { throw "Hostname is required" }
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

$parsedCaUrl = $null
if ($CaUrl) {
    if (-not [Uri]::TryCreate($CaUrl, [UriKind]::Absolute, [ref]$parsedCaUrl) -or
        $parsedCaUrl.Scheme -ne "https" -or $parsedCaUrl.UserInfo -or
        $parsedCaUrl.AbsolutePath -ne "/" -or $parsedCaUrl.Query -or $parsedCaUrl.Fragment) {
        throw "CaUrl must be an origin-only HTTPS URL"
    }
    $privateCaHost = $false
    $caAddress = $null
    if ([Net.IPAddress]::TryParse($parsedCaUrl.Host, [ref]$caAddress) -and $caAddress.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork) {
        $caOctets = $caAddress.GetAddressBytes()
        $privateCaHost = $caOctets[0] -eq 127 -or $caOctets[0] -eq 10 -or
            ($caOctets[0] -eq 192 -and $caOctets[1] -eq 168) -or
            ($caOctets[0] -eq 172 -and $caOctets[1] -ge 16 -and $caOctets[1] -le 31)
    } else {
        $caHost = $parsedCaUrl.Host.ToLowerInvariant()
        $privateCaHost = $caHost -eq "localhost" -or $caHost -eq "host.docker.internal" -or
            $caHost.EndsWith(".local") -or $caHost.EndsWith(".internal")
    }
    if (-not $privateCaHost) { throw "CaUrl must name a private or local HTTPS authority" }
}
if ($Mode -eq "issue-join" -and (-not $CaUrl -or -not $PackageOutput)) {
    throw "issue-join mode requires CaUrl and PackageOutput"
}
if ($Mode -eq "issue-join" -and (Test-Path -LiteralPath $PackageOutput)) {
    throw "Refusing to overwrite an existing join package"
}

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
        $env:DPF_PKI_DNS_NAMES = ((@($Hostname) + $San + @($BindAddress, "localhost", "127.0.0.1")) | Where-Object { $_ }) -join ","
        $env:DPF_PKI_NAME = $OrganizationName
        $env:DPF_TLS_DIR = $OutDir
        $composeFiles = @("-f", (Join-Path $RepoRoot "docker-compose.yml"), "-f", (Join-Path $RepoRoot "docker-compose.organization-trust.yml"))
        if ($Mode -in @("authority", "issue-join")) {
            $composeFiles += @("-f", (Join-Path $RepoRoot "docker-compose.pki.yml"))
        }
        & docker compose --project-directory $RepoRoot @composeFiles @Arguments
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

function Set-DpfOrganizationTrustEnvironment {
    $envPath = Join-Path $RepoRoot ".env"
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { return }
    foreach ($value in @($RootCert, $OutDir)) {
        if ($value -match "[`r`n]") { throw "PKI paths must not contain newlines" }
    }
    $content = [IO.File]::ReadAllLines($envPath) | Where-Object {
        $_ -notmatch '^DPF_ORGANIZATION_TRUST_ENABLED=' -and
        $_ -notmatch '^DPF_PKI_TRUST_BUNDLE=' -and
        $_ -notmatch '^DPF_TLS_DIR=' -and
        $_ -notmatch '^DPF_INSTALL_ROOT=' -and
        $_ -notmatch '^DPF_ORGANIZATION_TRUST_ROLE=' -and
        $_ -notmatch '^DPF_PKI_DIR=' -and
        $_ -notmatch '^DPF_ORGANIZATION_CA_URL=' -and
        $_ -notmatch '^DPF_EDGE_ACTION_DISPATCH_CONFIGURED=' -and
        $_ -notmatch '^DPF_EDGE_ACTION_URL=' -and
        $_ -notmatch '^DPF_EDGE_ACTION_CA_FILE=' -and
        $_ -notmatch '^DPF_EDGE_ACTION_CERT_FILE=' -and
        $_ -notmatch '^DPF_EDGE_ACTION_KEY_FILE=' -and
        $_ -notmatch '^DPF_EDGE_ACTION_SIGNING_PUBLIC_KEY_FILE=' -and
        $_ -notmatch '^DPF_EDGE_ACTION_SIGNING_PRIVATE_KEY_FILE=' -and
        $_ -notmatch '^DPF_EDGE_ACTION_SIGNING_PASSWORD_FILE=' -and
        $_ -notmatch '^DPF_EDGE_ACTION_SIGNING_KEY_ID=' -and
        $_ -notmatch '^DPF_EDGE_MTLS_PROXY_SECRET_FILE='
    }
    $organizationTrustRole = if ($Mode -in @("authority", "issue-join")) { "authority" } else { "member" }
    $organizationCaUrl = if ($CaUrl) { $CaUrl } else { "https://$Hostname`:9000" }
    $content += @(
        "DPF_ORGANIZATION_TRUST_ENABLED=1",
        "DPF_PKI_TRUST_BUNDLE=$RootCert",
        "DPF_TLS_DIR=$OutDir",
        "DPF_INSTALL_ROOT=$RepoRoot",
        "DPF_ORGANIZATION_TRUST_ROLE=$organizationTrustRole",
        "DPF_PKI_DIR=$OutDir",
        "DPF_ORGANIZATION_CA_URL=$organizationCaUrl"
    )
    if ($EdgeActionConfigured) {
        $content += @(
            "DPF_EDGE_ACTION_DISPATCH_CONFIGURED=1",
            "DPF_EDGE_ACTION_URL=https://$Hostname`:8443",
            "DPF_EDGE_ACTION_CA_FILE=$RootCert",
            "DPF_EDGE_ACTION_CERT_FILE=$EdgeClientCert",
            "DPF_EDGE_ACTION_KEY_FILE=$EdgeClientKey",
            "DPF_EDGE_ACTION_SIGNING_PUBLIC_KEY_FILE=$ActionSigningPublic",
            "DPF_EDGE_ACTION_SIGNING_PRIVATE_KEY_FILE=$ActionSigningPrivate",
            "DPF_EDGE_ACTION_SIGNING_PASSWORD_FILE=$ActionSigningPassword",
            "DPF_EDGE_ACTION_SIGNING_KEY_ID=edge-action-signing-v1",
            "DPF_EDGE_MTLS_PROXY_SECRET_FILE=$MtlsProxySecret"
        )
    }
    $suffix = [guid]::NewGuid().ToString('N')
    $temporary = "$envPath.organization-trust.$suffix.tmp"
    $backup = "$envPath.organization-trust.$suffix.bak"
    try {
        [IO.File]::WriteAllLines($temporary, $content, (New-Object Text.UTF8Encoding($false)))
        [IO.File]::Replace($temporary, $envPath, $backup, $true)
    } finally {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    }
}

function Wait-DpfStepCa {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            Invoke-DpfPkiCompose -Arguments @("exec", "-T", "step-ca", "step", "ca", "health", "--ca-url", "https://127.0.0.1:9000", "--root", "/home/step/certs/root_ca.crt") 2>$null | Out-Null
            return
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    throw "Organization CA did not become healthy"
}

function Invoke-DpfLocalStepClient {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $containerId = (Invoke-DpfPkiCompose -Arguments @("ps", "-q", "step-ca")).Trim()
    if (-not $containerId) { throw "organization_pki_container_unavailable" }
    & docker run --rm --network "container:$containerId" --mount "type=bind,src=$OutDir,dst=/work" $StepImage step @Arguments
    if ($LASTEXITCODE -ne 0) { throw "organization_pki_local_client_failed" }
}

function Enable-DpfEdgeClientProvisioner {
    $provisioners = (Invoke-DpfPkiCompose -Arguments @("exec", "-T", "step-ca", "step", "ca", "provisioner", "list", "--ca-url", "https://127.0.0.1:9000", "--root", "/home/step/certs/root_ca.crt")) -join "`n"
    if ($provisioners -match '"name"\s*:\s*"dpf-edge-client"') { return }
    Invoke-DpfPkiCompose -Arguments @(
        "exec", "-T", "step-ca", "step", "ca", "provisioner", "add", "dpf-edge-client",
        "--type", "JWK", "--create", "--ssh=false",
        "--password-file", "/run/secrets/step-ca-password",
        "--x509-template", "/etc/dpf/pki/edge-client.tpl",
        "--x509-min-dur", "5m", "--x509-default-dur", "720h", "--x509-max-dur", "720h",
        "--ca-config", "/home/step/config/ca.json"
    ) | Out-Null
    Invoke-DpfPkiCompose -Arguments @("restart", "step-ca") | Out-Null
    Wait-DpfStepCa
}

function New-DpfEdgeActionMaterial {
    if (-not (Test-Path -LiteralPath $ActionSigningPassword)) {
        $password = (& docker run --rm $StepImage step crypto rand --format hex 64).Trim()
        if ($LASTEXITCODE -ne 0 -or $password.Length -lt 32) { throw "edge_action_signing_password_generation_failed" }
        [IO.File]::WriteAllText($ActionSigningPassword, "$password`n", (New-Object Text.UTF8Encoding($false)))
        $password = $null
    }
    if (-not (Test-Path -LiteralPath $ActionSigningPublic) -or -not (Test-Path -LiteralPath $ActionSigningPrivate)) {
        Remove-Item -LiteralPath $ActionSigningPublic, $ActionSigningPrivate -Force -ErrorAction SilentlyContinue
        & docker run --rm --mount "type=bind,src=$OutDir,dst=/work" $StepImage step crypto keypair /work/edge-action-signing-public.pem /work/secrets/edge-action-signing-private.pem --kty OKP --curve Ed25519 --password-file /work/secrets/edge-action-signing-password | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "edge_action_signing_key_generation_failed" }
    }
    if (-not (Test-Path -LiteralPath $MtlsProxySecret)) {
        $secret = (& docker run --rm $StepImage step crypto rand --format hex 64).Trim()
        if ($LASTEXITCODE -ne 0 -or $secret.Length -lt 32) { throw "edge_mtls_proxy_secret_generation_failed" }
        [IO.File]::WriteAllText($MtlsProxySecret, "$secret`n", (New-Object Text.UTF8Encoding($false)))
        $secret = $null
    }
    & icacls $ActionSigningPrivate /inheritance:r /grant:r "$env:USERNAME`:F" 2>&1 | Out-Null
    & icacls $ActionSigningPassword /inheritance:r /grant:r "$env:USERNAME`:F" 2>&1 | Out-Null
    & icacls $MtlsProxySecret /inheritance:r /grant:r "$env:USERNAME`:F" 2>&1 | Out-Null
}

if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { throw "Docker is required" }
New-Item -ItemType Directory -Force -Path $OutDir, (Join-Path $OutDir "secrets") | Out-Null

if ($Mode -eq "join" -and $JoinPackage) {
    $TokenFile = Join-Path $OutDir "secrets\.join-token-$PackageId"
    [IO.File]::WriteAllText($TokenFile, "$PackageToken`n", (New-Object Text.UTF8Encoding($false)))
    $PackageToken = $null
    & icacls $TokenFile /inheritance:r /grant:r "$env:USERNAME`:F" 2>&1 | Out-Null
    if ($PackageEdgeToken) {
        $EdgeTokenFile = Join-Path $OutDir "secrets\.join-edge-token-$PackageId"
        [IO.File]::WriteAllText($EdgeTokenFile, "$PackageEdgeToken`n", (New-Object Text.UTF8Encoding($false)))
        $PackageEdgeToken = $null
        & icacls $EdgeTokenFile /inheritance:r /grant:r "$env:USERNAME`:F" 2>&1 | Out-Null
    }
}

$JoinSucceeded = $false
try {
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
    Wait-DpfStepCa
    Enable-DpfEdgeClientProvisioner
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
    $edgeSubject = "dpf-edge-" + $Hostname.Replace(':', '-')
    if ((Test-Path -LiteralPath $EdgeClientCert) -and (Test-Path -LiteralPath $EdgeClientKey)) {
        Invoke-DpfLocalStepClient -Arguments @("ca", "renew", "/work/edge-client.crt", "/work/edge-client.key", "--ca-url", "https://127.0.0.1:9000", "--root", "/work/root_ca.crt", "--force") | Out-Null
    } else {
        $edgeToken = (Invoke-DpfPkiCompose -Arguments @("exec", "-T", "step-ca", "step", "ca", "token", $edgeSubject, "--not-after", "15m", "--cert-not-after", "720h", "--provisioner", "dpf-edge-client", "--password-file", "/run/secrets/step-ca-password")).Trim()
        Invoke-DpfLocalStepClient -Arguments @("ca", "certificate", $edgeSubject, "/work/edge-client.crt", "/work/edge-client.key", "--token", $edgeToken, "--ca-url", "https://127.0.0.1:9000", "--root", "/work/root_ca.crt", "--force") | Out-Null
        $edgeToken = $null
    }
    $EdgeActionConfigured = $true
} elseif ($Mode -eq "issue-join") {
    if (-not (Test-Path -LiteralPath $PasswordFile)) { throw "Organization CA is not initialized on this installation" }
    Invoke-DpfPkiCompose -Arguments @("up", "-d", "step-ca")
    Wait-DpfStepCa
    Enable-DpfEdgeClientProvisioner
    $Fingerprint = (Invoke-DpfPkiCompose -Arguments @("exec", "-T", "step-ca", "step", "certificate", "fingerprint", "/home/step/certs/root_ca.crt")).Trim()
    $sanArguments = @("--san", $Hostname)
    foreach ($name in $San) { $sanArguments += @("--san", $name) }
    $tokenArguments = @("exec", "-T", "step-ca", "step", "ca", "token", $Hostname) + $sanArguments + @("--not-after", "$($PackageTtlSeconds)s", "--provisioner", "dpf-installer", "--password-file", "/run/secrets/step-ca-password")
    $enrollmentToken = (Invoke-DpfPkiCompose -Arguments $tokenArguments).Trim()
    $edgeSubject = "dpf-edge-" + $Hostname.Replace(':', '-')
    $edgeEnrollmentToken = (Invoke-DpfPkiCompose -Arguments @("exec", "-T", "step-ca", "step", "ca", "token", $edgeSubject, "--not-after", "$($PackageTtlSeconds)s", "--cert-not-after", "720h", "--provisioner", "dpf-edge-client", "--password-file", "/run/secrets/step-ca-password")).Trim()
    $bytes = New-Object byte[] 16
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $package_id = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    $expires_at = [int64]([DateTime]::UtcNow - [DateTime]'1970-01-01').TotalSeconds + $PackageTtlSeconds
    $intendedSans = $San -join ','
    $package = @(
        "DPF_ORGANIZATION_JOIN_V2",
        "package_id=$package_id",
        "ca_url=$CaUrl",
        "root_fingerprint=$Fingerprint",
        "intended_hostname=$Hostname",
        "intended_sans=$intendedSans",
        "expires_at=$expires_at",
        "enrollment_token=$enrollmentToken",
        "edge_client_enrollment_token=$edgeEnrollmentToken"
    ) -join "`n"
    [IO.File]::WriteAllText($PackageOutput, "$package`n", (New-Object Text.UTF8Encoding($false)))
    & icacls $PackageOutput /inheritance:r /grant:r "$env:USERNAME`:F" 2>&1 | Out-Null
    $enrollmentToken = $null
    $edgeEnrollmentToken = $null
    Write-Host "Organization join package created at $PackageOutput."
    Write-Host "It expires in $PackageTtlSeconds seconds and is intended only for $Hostname."
    exit 0
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
    if ($EdgeTokenFile) {
        $edgeSubject = "dpf-edge-" + $Hostname.Replace(':', '-')
        if ((Test-Path -LiteralPath $EdgeClientCert) -and (Test-Path -LiteralPath $EdgeClientKey)) {
            & docker run --rm --mount "type=bind,src=$OutDir,dst=/work" $StepImage step ca renew /work/edge-client.crt /work/edge-client.key --ca-url $CaUrl --root /work/root_ca.crt --force | Out-Null
        } else {
            & docker run --rm --mount "type=bind,src=$OutDir,dst=/work" --mount "type=bind,src=$EdgeTokenFile,dst=/run/secrets/edge-enrollment-token,readonly" $StepImage sh -c 'step ca certificate "$1" /work/edge-client.crt /work/edge-client.key --token "$(cat /run/secrets/edge-enrollment-token)" --ca-url "$2" --root /work/root_ca.crt --force' sh $edgeSubject $CaUrl | Out-Null
        }
        if ($LASTEXITCODE -ne 0) { throw "edge_client_certificate_issue_failed" }
        $EdgeActionConfigured = $true
    }
}

if ($EdgeActionConfigured) { New-DpfEdgeActionMaterial }

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
if ($EdgeActionConfigured) {
    $proxySecret = [IO.File]::ReadAllText($MtlsProxySecret).Trim()
    $caddy += @"

:8443 {
    tls /etc/caddy/tls/authority.crt /etc/caddy/tls/authority.key {
        client_auth {
            mode require_and_verify
            trust_pool file /etc/caddy/tls/root_ca.crt
        }
    }
    @edge_actions path /api/v1/edge/actions/*
    handle @edge_actions {
        reverse_proxy portal:3000 {
            header_up -X-DPF-Edge-Cert-*
            header_up -X-DPF-MTLS-Proxy-Secret
            header_up X-DPF-MTLS-Proxy-Secret "$proxySecret"
            header_up X-DPF-Edge-Cert-Fingerprint {tls_client_fingerprint}
            header_up X-DPF-Edge-Cert-Serial {tls_client_serial}
            header_up X-DPF-Edge-Cert-Subject {tls_client_subject}
            header_up X-DPF-Edge-Cert-Issuer {tls_client_issuer}
            header_up X-DPF-Edge-Cert-DER {tls_client_certificate_der_base64}
        }
    }
    respond 404
}
"@
    $proxySecret = $null
}
[IO.File]::WriteAllText($Caddyfile, $caddy, (New-Object Text.UTF8Encoding($false)))

Set-DpfOrganizationTrustEnvironment

if (-not $NoStartTls) {
    $tlsArguments = @("-f", (Join-Path $RepoRoot "docker-compose.tls.yml"))
    if ($EdgeActionConfigured) { $tlsArguments += @("-f", (Join-Path $RepoRoot "docker-compose.edge-actions.yml")) }
    Invoke-DpfPkiCompose -Arguments ($tlsArguments + @("up", "-d", "portal", "portal-tls"))
    Invoke-DpfPkiCompose -Arguments ($tlsArguments + @("restart", "portal", "portal-tls")) | Out-Null
}
$JoinSucceeded = $Mode -eq "join"

Write-Host "Organization HTTPS is configured for $Hostname."
Write-Host "Public root fingerprint: $Fingerprint"
Write-Host "PKI recovery directory: $OutDir (protect and back up with host secrets)."
} finally {
    if ($TokenFile -and $JoinPackage -and (Test-Path -LiteralPath $TokenFile)) {
        Remove-Item -LiteralPath $TokenFile -Force -ErrorAction SilentlyContinue
    }
    if ($EdgeTokenFile -and (Test-Path -LiteralPath $EdgeTokenFile)) {
        Remove-Item -LiteralPath $EdgeTokenFile -Force -ErrorAction SilentlyContinue
    }
    if ($JoinSucceeded -and $JoinPackage -and (Test-Path -LiteralPath $JoinPackage)) {
        Remove-Item -LiteralPath $JoinPackage -Force -ErrorAction SilentlyContinue
    }
}
