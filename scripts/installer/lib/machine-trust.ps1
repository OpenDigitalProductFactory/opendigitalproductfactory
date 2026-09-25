# Machine trust for the install's own CA (BI-2D545A0C AC-1, design section 12.4.3).
# Source this file; do not execute it directly. Plain ASCII for Windows PowerShell 5.1.
#
# The installer does not run elevated, so the root goes into the installing
# user's Trusted Root store. Windows shows one security confirmation for that;
# it is the operating system's own floor and cannot be bypassed without admin.
# Idempotent: a root already present (same thumbprint) is not added again.
#
# twin-contract: machine-trust-idempotent
# twin-contract: machine-trust-one-os-prompt

if ($script:DPF_LIB_MACHINE_TRUST_PS1_LOADED -eq $true) { return }
$script:DPF_LIB_MACHINE_TRUST_PS1_LOADED = $true

function Get-DpfCertificateThumbprint {
    param([Parameter(Mandatory)][string]$Path)
    $certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList $Path
    return $certificate.Thumbprint.ToUpperInvariant()
}

function Test-DpfRootTrusted {
    param(
        [Parameter(Mandatory)][string]$Thumbprint,
        [string]$StorePath = "Cert:\CurrentUser\Root"
    )
    return [bool](Get-ChildItem -Path $StorePath -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $Thumbprint })
}

# Returns "already-trusted", "trusted" or "declined". Never throws for a
# declined prompt: an untrusted root leaves the install working over https
# with a browser warning, which setup reports instead of failing.
function Install-DpfRootTrust {
    param(
        [Parameter(Mandatory)][string]$RootCertificatePath,
        [scriptblock]$IsTrusted = { param($thumbprint) Test-DpfRootTrusted -Thumbprint $thumbprint },
        [scriptblock]$AddToStore = { param($path) & certutil.exe -user -addstore -f Root $path | Out-Null; $LASTEXITCODE }
    )
    if (-not (Test-Path -LiteralPath $RootCertificatePath -PathType Leaf)) { throw "root_certificate_missing" }
    $thumbprint = Get-DpfCertificateThumbprint -Path $RootCertificatePath
    if (& $IsTrusted $thumbprint) { return "already-trusted" }
    $exitCode = & $AddToStore $RootCertificatePath
    if ($exitCode -eq 0 -and (& $IsTrusted $thumbprint)) { return "trusted" }
    return "declined"
}
