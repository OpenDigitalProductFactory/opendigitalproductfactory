#Requires -Version 5.1
# DELIBERATELY a *simple* param block: no [CmdletBinding()]. Adding it would turn
# this into an advanced script, which enables prefix matching against the common
# parameters -- the exact class of breakage that made every guarded command fail in
# scripts/safety/dpf-shell-guard.ps1. Keep it simple; -Help is a plain switch.
param(
    [string]$InstallDir,
    [string]$Version = "latest",
    [switch]$LibraryOnly,
    [switch]$WithEdge,
    [switch]$NoEdge,
    [switch]$Headless,
    [switch]$Consumer,
    [switch]$Contributor,
    # Declares what this installation IS, so agents and lifecycle tooling can tell a
    # production install from a disposable one. Recorded in installer state as the
    # canonical local host fact; an undeclared install is treated as production.
    [ValidateSet("production", "development", "test")][string]$EnvironmentClass,
    [ValidateNotNullOrEmpty()][string]$OrganizationJoinPackage,
    [switch]$Help
)
$ErrorActionPreference = "Stop"

function Show-DPFInstallerUsage {
    @'
Open Digital Product Factory - Installer

Usage:
  powershell -ExecutionPolicy Bypass -File install-dpf.ps1 [flags]

Flags:
  -InstallDir <path>
                Install location. Defaults to D:\DPF (or the drive with the
                most free space). The consumer install has no git checkout;
                everything it needs ships inside the release images.
  -Version <tag>
                Image tag to install. Defaults to "latest".
  -LibraryOnly  Dot-source the script's functions without running the install
                flow. Used by tests and by other scripts that reuse helpers.
  -WithEdge     Bundle a local Edge Node alongside the Authority Core (network
                discovery from this host). OPT-IN: not installed by default.
                A node added this way auto-approves at enrollment.
  -NoEdge       Force-skip the local Edge Node even if a prior install enabled
                it (Edge is already off by default).
  -Headless     Never prompt. Defaults to consumer mode and the recommended
                install directory; fails with actionable credential guidance.
  -Consumer     Install verified pre-built release assets (ready-to-go mode).
  -Contributor  Clone the source workspace for platform contribution work.
  -EnvironmentClass <production|development|test>
                Declare what this installation is. Shapes what connected AI
                agents may do -- teardown, credential handling, and writes to a
                paired installation. An undeclared install is treated as
                production.
  -OrganizationJoinPackage <file.dpfjoin>
                Join an existing organization trust domain during install. The
                private package is validated, consumed, and deleted on success;
                certificates and restart wiring are automatic.
  -Help         Show this help and exit without installing.

Uninstall:
  powershell -ExecutionPolicy Bypass -File uninstall-dpf.ps1

'@ | Write-Host
}

# Must run before ANY install work. Before this existed the script had no -Help
# parameter at all, so `install-dpf.ps1 -Help` bound nothing, fell through to
# $args, and ran a FULL UNATTENDED INSTALL -- while docs/install/windows.md told
# the operator that exact command "documents every flag" (IMP-026).
if ($Help) {
    Show-DPFInstallerUsage
    exit 0
}

# Reject unknown arguments rather than silently ignoring them, mirroring
# install-dpf.sh's `*) echo "Unknown flag" >&2; exit 2`. A simple param block
# collects undeclared tokens in $args, so a typo like -Helpp would otherwise
# install silently.
if ($args.Count -gt 0) {
    Write-Host "install-dpf.ps1: unrecognized argument(s): $($args -join ' ')" -ForegroundColor Red
    Write-Host "Run 'powershell -File install-dpf.ps1 -Help' for usage." -ForegroundColor Red
    exit 2
}
if ($Consumer -and $Contributor) {
    Write-Host "-Consumer and -Contributor are mutually exclusive." -ForegroundColor Red
    exit 2
}

function Read-DPFInstallerInput {
    param([Parameter(Mandatory)][string]$Prompt, [switch]$AsSecureString)
    if ($Headless) { throw "headless_installer_prompt_blocked:$Prompt" }
    return Read-Host $Prompt -AsSecureString:$AsSecureString
}

$OrganizationJoinPackagePath = if ($OrganizationJoinPackage) { [IO.Path]::GetFullPath($OrganizationJoinPackage) } else { $null }
if ($OrganizationJoinPackagePath -and -not (Test-Path -LiteralPath $OrganizationJoinPackagePath -PathType Leaf)) {
    throw "organization_join_package_not_found:$OrganizationJoinPackagePath"
}

function Resolve-DPFNativeEdgeModulePath {
    param([Parameter(Mandatory)][string]$InstallDir)

    $candidates = @(
        (Join-Path $InstallDir "scripts\installer\native-edge-host.ps1"),
        (Join-Path $PSScriptRoot "scripts\installer\native-edge-host.ps1")
    )
    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }
    throw "native_edge_host_module_missing"
}

# --- Helpers ----------------------------------------------------------------

function Write-Step($step, $total, $msg) {
    Write-Host "`nStep $step of $total`: $msg" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "  [OK] $msg" -ForegroundColor Green
}

function Write-Action($msg) {
    Write-Host "  -> $msg" -ForegroundColor Yellow
}

function Write-Warn($msg) {
    Write-Host "  [!] $msg" -ForegroundColor Red
}

function Write-DPFImageIdentity {
    param([Parameter(Mandatory)][string]$Image, [string]$Version = "latest")
    try {
        $inspection = (docker image inspect $Image 2>$null | ConvertFrom-Json | Select-Object -First 1)
        $repoDigest = @($inspection.RepoDigests) | Select-Object -First 1
        $createdAt = [DateTimeOffset]::Parse([string]$inspection.Created)
        Write-OK "Image digest: $(if ($repoDigest) { $repoDigest } else { 'unavailable' })"
        Write-OK "Image created at: $($createdAt.ToUniversalTime().ToString('u'))"
        if ($Version -eq "latest") {
            try {
                $headers = @{ "User-Agent" = "dpf-installer"; "Accept" = "application/vnd.github+json" }
                $main = Invoke-RestMethod -Uri "https://api.github.com/repos/OpenDigitalProductFactory/opendigitalproductfactory/commits/main" -Headers $headers -TimeoutSec 8
                $mainDate = [DateTimeOffset]::Parse([string]$main.commit.committer.date)
                if (($mainDate - $createdAt).TotalHours -gt 24) {
                    Write-Warn "The latest image is older than main by more than 24 hours. Installation can continue, but the published release may be stale."
                }
            } catch {
                Write-Warn "Could not compare latest image age with main; immutable digest and creation date are shown above."
            }
        }
    } catch {
        Write-Warn "Could not inspect the pulled image digest and creation date: $($_.Exception.Message)"
    }
}

# Returns the compose-chain module PATH for the caller to dot-source itself.
#
# It deliberately does NOT dot-source here. Dot-sourcing inside a function scopes
# every definition to that function, so the caller never sees them: the module
# defines three interdependent helpers (Test-DPFEnvFlag, Add-DPFComposeFile,
# Get-DPFComposeArgs) and all three vanish when this returns. Callers must write
#
#     . (Resolve-DPFComposeChainModule -InstallDir $Dir)
#
# which is the same script-scope pattern the already-working call sites use.
function Resolve-DPFComposeChainModule {
    param([Parameter(Mandatory)][string]$InstallDir)
    $candidates = @(
        (Join-Path $InstallDir "scripts\installer\lib\compose-chain.ps1"),
        (Join-Path $PSScriptRoot "scripts\installer\lib\compose-chain.ps1")
    )
    $module = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $module) { throw "compose_chain_helper_missing" }
    return $module
}

function Get-Progress {
    if (Test-Path $PROGRESS_FILE) {
        return Get-Content $PROGRESS_FILE | ConvertFrom-Json
    }
    return @{ completedSteps = @() }
}

function Save-Progress($step) {
    $progress = Get-Progress
    if ($progress.completedSteps -notcontains $step) {
        $progress.completedSteps += $step
    }
    $progress | ConvertTo-Json | Set-Content $PROGRESS_FILE
}

function Test-StepDone($step) {
    $progress = Get-Progress
    return $progress.completedSteps -contains $step
}

function New-RandomPassword($length = 32) {
    $bytes = New-Object byte[] $length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join "" | Select-Object -First 1
}

function New-RandomAlphanumeric($length = 16) {
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $bytes = New-Object byte[] $length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Register-DPFStartupTask {
    param([string]$taskName, [string]$startScriptPath)

    if (-not (Test-Path $startScriptPath)) {
        Write-Warn "Startup script not found at $startScriptPath. Skipping auto-start setup."
        return $false
    }

    try {
        $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NoLogo -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScriptPath`" -NoBrowser"
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Start DPF containers on user logon." -Force | Out-Null
        Write-OK "Auto-start task configured: $taskName"
        return $true
    } catch {
        Write-Warn "Could not configure auto-start task '$taskName': $($_.Exception.Message)"
        return $false
    }
}

function Format-DPFGigabytes {
    param([double]$Value)

    if ([math]::Abs($Value - [math]::Round($Value)) -lt 0.05) {
        return ([math]::Round($Value)).ToString("0")
    }
    return $Value.ToString("0.0")
}

function Get-DPFDriveDeviceIDFromPath {
    param([Parameter(Mandatory)][string]$Path)

    $root = [System.IO.Path]::GetPathRoot($Path)
    if ($root -match "^([A-Za-z]:)") {
        return $matches[1].ToUpperInvariant()
    }
    return $null
}

function Get-DPFDriveInventory {
    param([object[]]$LogicalDisks)

    if (-not $LogicalDisks) {
        try {
            $LogicalDisks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3")
        } catch {
            return @()
        }
    }

    $inventory = foreach ($disk in $LogicalDisks) {
        $driveType = if ($null -ne $disk.DriveType) { [int]$disk.DriveType } else { 3 }
        if ($driveType -ne 3) { continue }

        $deviceId = ([string]$disk.DeviceID).TrimEnd("\").ToUpperInvariant()
        if ($deviceId -notmatch "^[A-Z]:$") { continue }

        $freeGB = if ($disk.PSObject.Properties.Name -contains "FreeGB") {
            [double]$disk.FreeGB
        } elseif ($null -ne $disk.FreeSpace) {
            [math]::Round([double]$disk.FreeSpace / 1GB, 1)
        } else {
            0
        }

        $sizeGB = if ($disk.PSObject.Properties.Name -contains "SizeGB") {
            [double]$disk.SizeGB
        } elseif ($null -ne $disk.Size) {
            [math]::Round([double]$disk.Size / 1GB, 1)
        } else {
            0
        }

        [PSCustomObject]@{
            DeviceID   = $deviceId
            FreeGB     = $freeGB
            SizeGB     = $sizeGB
            VolumeName = $disk.VolumeName
        }
    }

    return @($inventory | Sort-Object DeviceID)
}

function Get-DPFDriveFromInventory {
    param(
        [object[]]$DriveInventory = @(),
        [Parameter(Mandatory)][string]$DeviceID
    )

    $normalized = $DeviceID.TrimEnd("\").ToUpperInvariant()
    return $DriveInventory | Where-Object { $_.DeviceID -eq $normalized } | Select-Object -First 1
}

function Join-DPFDrivePath {
    param(
        [Parameter(Mandatory)][string]$DeviceID,
        [Parameter(Mandatory)][string]$ChildPath
    )

    return "$($DeviceID.TrimEnd("\"))\$($ChildPath.TrimStart("\"))"
}

function Get-DPFInstallDriveRecommendation {
    param(
        [object[]]$DriveInventory = @(),
        [string]$DefaultInstallDir = "C:\DPF",
        [double]$RecommendedFreeGB = 50
    )

    $defaultDrive = Get-DPFDriveDeviceIDFromPath -Path $DefaultInstallDir
    $defaultDriveInfo = if ($defaultDrive) {
        Get-DPFDriveFromInventory -DriveInventory $DriveInventory -DeviceID $defaultDrive
    } else {
        $null
    }

    $result = [PSCustomObject]@{
        Recommended      = $false
        InstallDir       = $DefaultInstallDir
        RecommendedDrive = $defaultDrive
        Message          = $null
    }

    if ($defaultDrive -ne "C:" -or -not $defaultDriveInfo) {
        return $result
    }

    if ([double]$defaultDriveInfo.FreeGB -ge $RecommendedFreeGB) {
        return $result
    }

    $candidate = $DriveInventory |
        Where-Object { $_.DeviceID -ne "C:" -and [double]$_.FreeGB -ge $RecommendedFreeGB } |
        Sort-Object DeviceID |
        Select-Object -First 1

    if (-not $candidate) {
        return $result
    }

    $installDir = Join-DPFDrivePath -DeviceID $candidate.DeviceID -ChildPath "DPF"
    return [PSCustomObject]@{
        Recommended      = $true
        InstallDir       = $installDir
        RecommendedDrive = $candidate.DeviceID
        Message          = "C: has $(Format-DPFGigabytes $defaultDriveInfo.FreeGB) GB free; $($candidate.DeviceID) has $(Format-DPFGigabytes $candidate.FreeGB) GB free, so $installDir is the suggested install location."
    }
}

function Get-DPFInstallDriveFreeSpace {
    param(
        [Parameter(Mandatory)][string]$InstallDir,
        [object[]]$DriveInventory = @()
    )

    $installDrive = Get-DPFDriveDeviceIDFromPath -Path $InstallDir
    if (-not $installDrive) {
        return [PSCustomObject]@{
            DeviceID = $null
            FreeGB   = 0
            Missing  = $true
        }
    }

    $driveInfo = Get-DPFDriveFromInventory -DriveInventory $DriveInventory -DeviceID $installDrive
    if (-not $driveInfo) {
        return [PSCustomObject]@{
            DeviceID = $installDrive
            FreeGB   = 0
            Missing  = $true
        }
    }

    return [PSCustomObject]@{
        DeviceID = $driveInfo.DeviceID
        FreeGB   = [double]$driveInfo.FreeGB
        Missing  = $false
    }
}

function Get-DPFDockerDesktopDataPath {
    $candidate = Join-Path $env:LOCALAPPDATA "Docker\wsl\disk"
    if (Test-Path -LiteralPath $candidate) {
        return $candidate
    }
    return $null
}

function Get-DPFDockerStorageRecommendation {
    param(
        [object[]]$DriveInventory = @(),
        [string]$DockerDataPath,
        [double]$RecommendedFreeGB = 100
    )

    $result = [PSCustomObject]@{
        ShouldWarn  = $false
        CurrentPath = $DockerDataPath
        TargetPath  = $null
        Message     = $null
    }

    if ([string]::IsNullOrWhiteSpace($DockerDataPath)) {
        return $result
    }

    $currentDrive = Get-DPFDriveDeviceIDFromPath -Path $DockerDataPath
    if ($currentDrive -ne "C:") {
        return $result
    }

    $cDrive = Get-DPFDriveFromInventory -DriveInventory $DriveInventory -DeviceID "C:"
    if (-not $cDrive -or [double]$cDrive.FreeGB -ge $RecommendedFreeGB) {
        return $result
    }

    $candidate = $DriveInventory |
        Where-Object { $_.DeviceID -ne "C:" -and [double]$_.FreeGB -ge $RecommendedFreeGB } |
        Sort-Object DeviceID |
        Select-Object -First 1

    if (-not $candidate) {
        return $result
    }

    $targetPath = Join-DPFDrivePath -DeviceID $candidate.DeviceID -ChildPath "DockerDesktop\wsl\disk"
    return [PSCustomObject]@{
        ShouldWarn  = $true
        CurrentPath = $DockerDataPath
        TargetPath  = $targetPath
        Message     = "Docker Desktop stores Linux data on C: at $DockerDataPath. If Docker storage starts filling C:, use $targetPath as the relocation target. The installer will not move Docker storage automatically."
    }
}

function Test-DPFReleaseAssetManifest {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$ManifestPath,
        [switch]$RejectUnlisted
    )
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { throw "consumer_release_asset_manifest_missing" }
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $manifestFullPath = [IO.Path]::GetFullPath($ManifestPath)
    $verifiedFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($line in Get-Content -LiteralPath $manifestFullPath) {
        if ($line -notmatch '^([0-9a-fA-F]{64})\s+\*?(.+)$') { throw "consumer_release_asset_manifest_invalid" }
        $expected = $Matches[1].ToLowerInvariant()
        $relative = $Matches[2].Replace('/', [IO.Path]::DirectorySeparatorChar)
        $candidate = [IO.Path]::GetFullPath((Join-Path $Root $relative))
        if (-not $candidate.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) { throw "consumer_release_asset_path_invalid" }
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "consumer_release_asset_missing:$relative" }
        $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) { throw "consumer_release_asset_integrity_failed:$relative" }
        if (-not $verifiedFiles.Add($candidate)) { throw "consumer_release_asset_manifest_duplicate:$relative" }
    }
    if ($RejectUnlisted) {
        foreach ($file in Get-ChildItem -LiteralPath $Root -File -Recurse) {
            if ($file.FullName -ne $manifestFullPath -and -not $verifiedFiles.Contains($file.FullName)) {
                throw "consumer_release_asset_unverified:$($file.FullName.Substring($rootPath.Length))"
            }
        }
    }
}

function Export-DPFConsumerReleaseAssets {
    param(
        [Parameter(Mandatory)][string]$InstallDir,
        [Parameter(Mandatory)][string]$Version,
        [string]$Image = "ghcr.io/opendigitalproductfactory/dpf-portal:latest",
        [string]$AssetSource
    )

    if ($Version -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { throw "consumer_release_version_invalid" }

    $staging = Join-Path ([IO.Path]::GetTempPath()) ("dpf-release-assets-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    $containerId = $null
    try {
        if ($AssetSource) {
            Copy-Item -Path (Join-Path $AssetSource "*") -Destination $staging -Recurse -Force
        } else {
            docker pull $Image 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "consumer_release_asset_image_pull_failed" }
            $containerId = (docker create $Image).Trim()
            if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw "consumer_release_asset_container_failed" }
            docker cp "${containerId}:/dpf-release-assets/." $staging | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "consumer_release_asset_export_failed" }
        }

        $manifestPath = Join-Path $staging "SHA256SUMS"
        Test-DPFReleaseAssetManifest -Root $staging -ManifestPath $manifestPath -RejectUnlisted

        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Get-ChildItem -LiteralPath $staging -Force | Where-Object Name -ne "SHA256SUMS" |
            Copy-Item -Destination $InstallDir -Recurse -Force
        Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $InstallDir ".verified-release-assets.sha256") -Force
        [IO.File]::WriteAllText((Join-Path $InstallDir ".verified-release-assets-version"), $Version, [Text.Encoding]::ASCII)
    } finally {
        if ($containerId) { docker rm $containerId 2>&1 | Out-Null }
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Set-DPFReleaseEnvIdentityAtomic {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$Owner,
        [scriptblock]$BeforeReplace
    )
    $content = if (Test-Path -LiteralPath $Path) { [IO.File]::ReadAllText($Path) } else { "" }
    $newLine = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }
    foreach ($entry in @(@("DPF_IMAGE_TAG", $Version), @("GHCR_OWNER", $Owner))) {
        $key = $entry[0]
        $value = $entry[1]
        $pattern = "(?m)^$([Text.RegularExpressions.Regex]::Escape($key))=.*$"
        if ([Text.RegularExpressions.Regex]::IsMatch($content, $pattern)) {
            $content = [Text.RegularExpressions.Regex]::Replace($content, $pattern, "$key=$value")
        } else {
            if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) { $content += $newLine }
            $content += "$key=$value$newLine"
        }
    }

    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    $temporary = Join-Path $directory ("." + [IO.Path]::GetFileName($Path) + "." + [guid]::NewGuid().ToString("N") + ".tmp")
    $backup = Join-Path $directory ("." + [IO.Path]::GetFileName($Path) + "." + [guid]::NewGuid().ToString("N") + ".bak")
    try {
        $stream = [IO.FileStream]::new($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough)
        try {
            $writer = [IO.StreamWriter]::new($stream, (New-Object Text.UTF8Encoding($false)), 1024, $true)
            try { $writer.Write($content); $writer.Flush(); $stream.Flush($true) } finally { $writer.Dispose() }
        } finally { $stream.Dispose() }
        if ($BeforeReplace) { & $BeforeReplace }
        if (Test-Path -LiteralPath $Path) {
            [IO.File]::Replace($temporary, $Path, $backup, $true)
            Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
        } else {
            [IO.File]::Move($temporary, $Path)
        }
    } finally {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    }
}

function Set-DPFConsumerReleaseIdentity {
    param(
        [Parameter(Mandatory)][string]$InstallDir,
        [Parameter(Mandatory)][string]$Version,
        [scriptblock]$BeforeReplace
    )
    if ($Version -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { throw "consumer_release_version_invalid" }
    $marker = Join-Path $InstallDir ".verified-release-assets-version"
    if (-not (Test-Path -LiteralPath $marker)) { throw "consumer_release_assets_unverified" }
    if ((Get-Content -LiteralPath $marker -Raw).Trim() -cne $Version) { throw "consumer_release_assets_version_mismatch" }
    Test-DPFReleaseAssetManifest -Root $InstallDir -ManifestPath (Join-Path $InstallDir ".verified-release-assets.sha256")
    $envPath = Join-Path $InstallDir ".env"
    Set-DPFReleaseEnvIdentityAtomic -Path $envPath -Version $Version -Owner "opendigitalproductfactory" -BeforeReplace $BeforeReplace
}

function Get-DPFEdgeComposeContent {
    param([string]$Version = "latest")

    return @"
# Generated by DPF installer (consumer mode) -- do not edit manually
#
# Bundled single-host Edge Node. On Windows Docker Desktop this runs
# inside Docker's Linux VM, so it proves enrollment and Authority
# connectivity but does not have full host-LAN visibility. Native
# Windows service Mode 4 is the production path for real Windows LAN
# discovery once the signed Go service installer ships.

services:
  edge-node:
    image: ghcr.io/opendigitalproductfactory/dpf-edge-node:$Version
    pull_policy: missing
    restart: unless-stopped
    environment:
      DPF_AUTHORITY_URL: `${DPF_AUTHORITY_URL:-http://portal:3000}
      DPF_BOOTSTRAP_TOKEN: `${DPF_BOOTSTRAP_TOKEN:-}
      DPF_EDGE_NODE_NAME: `${DPF_EDGE_NODE_NAME:-edge-node-windows}
      DPF_INSTALL_MODE: `${DPF_INSTALL_MODE:-container-vm}
      DPF_EDGE_STATE_DIR: /var/lib/dpf-edge-node
    volumes:
      - edge_node_state:/var/lib/dpf-edge-node
    depends_on:
      portal:
        condition: service_healthy
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "process.exit(0)"
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  edge_node_state:
"@
}

function Get-DPFStartScriptContent {
    return @'
param(
    [string]$DPF_DIR = $PSScriptRoot,
    [switch]$NoBrowser,
    [switch]$WithEdge,
    [switch]$NoEdge
)

Set-Location $DPF_DIR

# The generated entrypoint consumes the same checked-in adapter and state
# helper as install/setup; it never snapshots service/profile logic.
if ($WithEdge) { $env:DPF_INCLUDE_EDGE = '1' }
elseif ($NoEdge) { $env:DPF_INCLUDE_EDGE = '0' }
$stateLib = Join-Path $DPF_DIR "scripts\installer\lib\state.ps1"
if (-not (Test-Path -LiteralPath $stateLib)) { $stateLib = Join-Path $DPF_DIR "installer\lib\state.ps1" }
if (-not (Test-Path -LiteralPath $stateLib)) { throw "capability_state_helper_missing" }
. $stateLib
$includeEdge = Resolve-DpfEdgeEnabled -InstallDir $DPF_DIR
$consumerReleaseTag = Resolve-DpfConsumerReleaseImageTag -InstallDir $DPF_DIR
if ($consumerReleaseTag) {
    Write-Host "Using recorded consumer release tag $consumerReleaseTag" -ForegroundColor Cyan
}
$capabilityProjection = Resolve-DpfCapabilityComposeProfiles -InstallDir $DPF_DIR
$env:COMPOSE_PROFILES = (@($capabilityProjection.composeProfiles) -join ',')

$composeChainModule = Join-Path $DPF_DIR "scripts\installer\lib\compose-chain.ps1"
if (-not (Test-Path -LiteralPath $composeChainModule)) { throw "compose_chain_helper_missing" }
. $composeChainModule
$composeArgs = Get-DPFComposeArgs -InstallDir $DPF_DIR -IncludeEdge:$includeEdge -IncludeRelease:$true
docker compose @composeArgs up -d

if ($includeEdge) {
    Start-ScheduledTask -TaskName "DPF-Native-Edge-Node" -ErrorAction SilentlyContinue
}

Write-Host "Waiting for portal to be ready..." -ForegroundColor Cyan
$attempts = 0
$maxAttempts = 60
$healthy = $false
while ($attempts -lt $maxAttempts) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:3000/api/health" `
                    -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($resp -and $resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
    Start-Sleep -Seconds 5
    $attempts++
}

if (-not $healthy) {
    Write-Host "[!] Portal did not become healthy after 5 minutes." -ForegroundColor Yellow
    Write-Host "    Run 'docker compose logs portal' in $DPF_DIR to diagnose." -ForegroundColor Yellow
} else {
    $seedScript = Join-Path $DPF_DIR "scripts\seed-worktree-mcp.ps1"
    if ((Test-Path $seedScript) -and (Get-Command claude -ErrorAction SilentlyContinue)) {
        Write-Host "Auto-seeding MCP token..." -ForegroundColor Cyan
        try { & $seedScript } catch { Write-Host "[!] MCP seed skipped: $_" -ForegroundColor Yellow }
    }
}

if (-not $NoBrowser) {
    Start-Process "http://localhost:3000"
    Write-Host "Digital Product Factory is running at http://localhost:3000" -ForegroundColor Green
}
'@
}

function Get-DPFStopScriptContent {
    return @'
param(
    [string]$DPF_DIR = $PSScriptRoot
)

Set-Location $DPF_DIR

$composeChainModule = Join-Path $DPF_DIR "scripts\installer\lib\compose-chain.ps1"
if (-not (Test-Path -LiteralPath $composeChainModule)) { throw "compose_chain_helper_missing" }
. $composeChainModule
$composeArgs = Get-DPFComposeArgs -InstallDir $DPF_DIR -Purpose Stop
docker compose @composeArgs down
Stop-ScheduledTask -TaskName "DPF-Native-Edge-Node" -ErrorAction SilentlyContinue
Write-Host "Digital Product Factory stopped." -ForegroundColor Yellow
'@
}

function Set-DPFEnvFileValue {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Key,
        [Parameter(Mandatory)][string]$Value
    )

    $envText = ""
    if (Test-Path $Path) {
        $envText = Get-Content -Path $Path -Raw -ErrorAction SilentlyContinue
        if ($null -eq $envText) { $envText = "" }
    }

    $line = "$Key=$Value"
    $pattern = "(?m)^$([System.Text.RegularExpressions.Regex]::Escape($Key))=.*$"
    if ($envText -match $pattern) {
        $envText = [System.Text.RegularExpressions.Regex]::Replace($envText, $pattern, $line)
    } else {
        if ($envText.Length -gt 0 -and -not $envText.EndsWith("`n")) {
            $envText += "`n"
        }
        $envText += "$line`n"
    }

    Set-Content -Path $Path -Value $envText -Encoding UTF8 -NoNewline
}

function Invoke-DPFEdgeNodeConvergence {
    param([Parameter(Mandatory)][string]$InstallDir)

    $edgeModule = Resolve-DPFNativeEdgeModulePath -InstallDir $InstallDir
    . $edgeModule
    . (Resolve-DPFComposeChainModule -InstallDir $InstallDir)
    $edgeComposeArgs = Get-DPFComposeArgs -InstallDir $InstallDir -IncludeEdge:$false

    Write-Action "Converging this installation's Edge Node..."
    $portalReady = $false
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($resp -and $resp.StatusCode -eq 200) { $portalReady = $true; break }
        } catch {}
        Start-Sleep -Seconds 5
    }
    if (-not $portalReady) {
        Write-Warn "Portal did not become healthy in time. Skipping Edge Node bootstrap."
        return $false
    }

    $portalContainer = (docker compose @edgeComposeArgs ps -q portal 2>$null) -split "`n" | Select-Object -First 1
    if (-not $portalContainer) {
        $portalContainer = "dpf-portal-1"
    }

    $stateRoot = if ($env:DPF_STATE_DIR) { $env:DPF_STATE_DIR } else { Join-Path $env:USERPROFILE ".dpf" }
    $existingEnrollment = Test-Path -LiteralPath (Join-Path $stateRoot "edge-node\state.json")
    $edgeToken = ""
    if (-not $existingEnrollment) {
        try {
            $tokenOutput = docker exec $portalContainer sh -c 'cd /app/apps/web-src && /app/node_modules/.pnpm/node_modules/.bin/tsx scripts/issue-edge-bootstrap-token.ts --ttl-minutes 30 --auto-approve' 2>$null
            if ($LASTEXITCODE -eq 0 -and $tokenOutput) {
                $lines = @($tokenOutput) | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ -ne "" }
                $candidate = if ($lines.Count -gt 0) { $lines[-1] } else { "" }
                if ($candidate -match "^dpfboot_") {
                    $edgeToken = $candidate
                }
            }
        } catch {
            $edgeToken = ""
        }

        if (-not $edgeToken) {
            Write-Warn "Bootstrap token issuance failed. Skipping Edge Node enrollment wiring."
            Write-Warn "Use the portal Edge Nodes page to issue a token if you need to enroll this node manually."
            return $false
        }
    }

    if ($edgeToken) {
        $envPath = Join-Path $InstallDir ".env"
        Set-DPFEnvFileValue -Path $envPath -Key "DPF_BOOTSTRAP_TOKEN" -Value $edgeToken
        Set-DPFEnvFileValue -Path $envPath -Key "DPF_EDGE_NODE_NAME" -Value ([System.Net.Dns]::GetHostName())
        Write-OK "Bootstrap token wired into .env (auto-approve)"
    } else {
        Write-OK "Existing Edge enrollment found; preserving its machine identity"
    }
    if (Install-DPFNativeEdgeNode -InstallDir $InstallDir -BootstrapToken $edgeToken -Version $Version) {
        . (Resolve-DPFComposeChainModule -InstallDir $InstallDir)
        $legacyComposeArgs = Get-DPFComposeArgs -InstallDir $InstallDir -IncludeEdge:$true
        docker compose @legacyComposeArgs stop edge-node 2>&1 | Out-Null
        return $true
    }
    return $false
}

if ($LibraryOnly -or $env:DPF_INSTALLER_LIBRARY_ONLY -eq "1") {
    return
}

# Determine a sensible default: if the script already sits in a project
# directory (has docker-compose.yml), default to that path. For one-file
# downloads, prefer the next fixed non-C drive when C is short on space.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$driveInventory = Get-DPFDriveInventory
if (-not $InstallDir) {
    $installDriveRecommendation = $null
    if (Test-Path "$scriptDir\docker-compose.yml") {
        $defaultDir = $scriptDir
    } else {
        $installDriveRecommendation = Get-DPFInstallDriveRecommendation `
            -DriveInventory $driveInventory `
            -DefaultInstallDir "C:\DPF"
        $defaultDir = $installDriveRecommendation.InstallDir
    }

    Write-Host ""
    Write-Host "Where would you like to install Digital Product Factory?" -ForegroundColor Cyan
    if ($installDriveRecommendation -and $installDriveRecommendation.Recommended) {
        Write-Host "  Suggestion: $($installDriveRecommendation.Message)" -ForegroundColor Yellow
    }

    $dockerStorageRecommendation = Get-DPFDockerStorageRecommendation `
        -DriveInventory $driveInventory `
        -DockerDataPath (Get-DPFDockerDesktopDataPath)
    if ($dockerStorageRecommendation.ShouldWarn) {
        Write-Host "  Docker storage note: $($dockerStorageRecommendation.Message)" -ForegroundColor Yellow
    }

    $answer = if ($Headless) { "" } else { Read-DPFInstallerInput "  Install directory [$defaultDir]" }
    if ([string]::IsNullOrWhiteSpace($answer)) {
        $InstallDir = $defaultDir
    } else {
        $InstallDir = $answer.Trim()
    }
}
$DPF_DIR = [System.IO.Path]::GetFullPath($InstallDir)
$PROGRESS_FILE = "$DPF_DIR\.install-progress"
$AUTOSTART_TASK_NAME = "DPF-AutoStart"

$GHCR_PORTAL = "ghcr.io/opendigitalproductfactory/dpf-portal"
$GHCR_SANDBOX = "ghcr.io/opendigitalproductfactory/dpf-sandbox"

$InstallMode = $null  # Set in Step 4: "consumer", "contributor", or "private"

# --- Banner -------------------------------------------------------------------

Write-Host ""
Write-Host "========================================================" -ForegroundColor Magenta
Write-Host "|  Digital Product Factory -- Installation              |" -ForegroundColor Magenta
Write-Host "|  This will set up everything you need automatically  |" -ForegroundColor Magenta
Write-Host "========================================================" -ForegroundColor Magenta

# Create install dir
if (-not (Test-Path $DPF_DIR)) {
    New-Item -ItemType Directory -Path $DPF_DIR -Force | Out-Null
}

# --- Step 1: Check Windows ----------------------------------------------------

Write-Step 1 10 "Checking Windows version..."
if (-not (Test-StepDone "windows_check")) {
    $os = Get-CimInstance Win32_OperatingSystem
    $build = [int]$os.BuildNumber
    if ($build -lt 19041) {
        Write-Warn "Your Windows version doesn't support WSL2."
        Write-Warn "You need Windows 10 version 2004 or later (build 19041+)."
        Write-Warn "Current build: $build"
        exit 1
    }
    Write-OK "$($os.Caption) (build $build)"
    Save-Progress "windows_check"
} else {
    Write-OK "Already checked"
}

# --- Step 2: WSL2 -------------------------------------------------------------

Write-Step 2 10 "Setting up WSL2..."
if (-not (Test-StepDone "wsl2")) {
    # Windows 11 24H2+ (build 26100+) ships WSL as an inbox component, not a DISM
    # optional feature. Detect this by checking if "wsl --version" succeeds.
    $wslInbox = $false
    try {
        wsl --version 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $wslInbox = $true }
    } catch { }

    if ($wslInbox) {
        Write-Action "WSL is built into this Windows version -- no feature enablement needed"
    } else {
        # Legacy path: Windows 10 / Windows 11 pre-24H2
        $vmpFeature = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
        $wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux

        $needsReboot = $false

        if ($vmpFeature.State -ne "Enabled") {
            Write-Action "Enabling Virtual Machine Platform (safe -- needed for Docker)..."
            Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart -WarningAction SilentlyContinue | Out-Null
            $needsReboot = $true
        }

        if ($wslFeature.State -ne "Enabled") {
            Write-Action "Enabling Windows Subsystem for Linux..."
            Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart -WarningAction SilentlyContinue | Out-Null
            $needsReboot = $true
        }

        if ($needsReboot) {
            # Save progress so we can resume after reboot
            Save-Progress "wsl2_partial"
            Write-Warn "Windows needs to restart to finish setting up."
            Write-Host ""
            Write-Host "  After your computer restarts:" -ForegroundColor White
            Write-Host "  1. Open the folder where you saved the installer"
            Write-Host "  2. Double-click install-dpf.bat (or run it from a terminal)"
            Write-Host "  3. The installer will pick up where it left off"
            Write-Host ""
            Write-Host "  Restarting in 15 seconds... (press Ctrl+C to cancel)" -ForegroundColor Yellow
            Start-Sleep -Seconds 15
            Restart-Computer -Force
            exit 0
        }
    }

    # Set WSL default version
    wsl --set-default-version 2 2>$null

    Write-OK "WSL2 is ready"
    Save-Progress "wsl2"
} else {
    Write-OK "Already set up"
}

# Handle partial WSL2 (resume after reboot)
if ((Test-StepDone "wsl2_partial") -and -not (Test-StepDone "wsl2")) {
    wsl --set-default-version 2 2>$null
    Write-OK "WSL2 is ready (resumed after restart)"
    Save-Progress "wsl2"
}

# Born-bounded WSL2 ceilings (BI-4F3AB6B3) + crash-dump retention.
# Microsoft Learn: "Advanced settings configuration in WSL" under [wsl2].
# Runs on every install/reinstall pass (not gated behind Test-StepDone) so it
# backfills existing installs, but never overwrites an operator's own explicit
# choice for any key. Sizing mirrors scripts/check-compose-resource-budgets.mjs
# sizeWslCeilings() / config/install-resource-budgets.json host.wsl policy.
$wslConfigPath = Join-Path $env:USERPROFILE ".wslconfig"
$crashDumpCap = 2
$wslMemoryShare = 0.5
$wslMinMemoryGb = 8
$wslMaxMemoryGb = 32
$wslLeaveOsHeadroomGb = 8
$wslProcessorShare = 0.75
$wslMinProcessors = 2
$wslAutoMemoryReclaim = "gradual"

$hostRamGb = [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$hostCpus = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
if (-not $hostRamGb -or $hostRamGb -le 0) { $hostRamGb = 16 }
if (-not $hostCpus -or $hostCpus -le 0) { $hostCpus = 4 }

$shareGb = [math]::Floor($hostRamGb * $wslMemoryShare)
$headroomCapped = [math]::Floor($hostRamGb - $wslLeaveOsHeadroomGb)
$wslMemoryGb = [math]::Min([math]::Min($shareGb, $headroomCapped), $wslMaxMemoryGb)
$wslMemoryGb = [math]::Max($wslMemoryGb, [math]::Min($wslMinMemoryGb, $headroomCapped))
if ($wslMemoryGb -lt 1) { $wslMemoryGb = 1 }
$wslProcessors = [math]::Floor($hostCpus * $wslProcessorShare)
$wslProcessors = [math]::Max($wslMinProcessors, $wslProcessors)
$wslProcessors = [math]::Min($hostCpus, $wslProcessors)

# Keys we may insert when absent. Operator-authored values are never replaced.
$wslDesiredKeys = [ordered]@{
    "maxCrashDumpCount" = "$crashDumpCap"
    "memory"            = "${wslMemoryGb}GB"
    "processors"        = "$wslProcessors"
    "autoMemoryReclaim" = $wslAutoMemoryReclaim
}

function Add-WslConfigKeysIfMissing {
    param(
        [string]$Path,
        [System.Collections.Specialized.OrderedDictionary]$Desired
    )
    $changed = $false
    $added = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $Path) {
        $lines = @(Get-Content -LiteralPath $Path)
    } else {
        $lines = @()
    }

    foreach ($key in $Desired.Keys) {
        # NOTE: "-notmatch" against an array filters elements; use Count on -match.
        if (@($lines -match ("^\s*" + [regex]::Escape($key) + "\s*=")).Count -gt 0) {
            continue
        }
        $entry = "$key=$($Desired[$key])"
        if (@($lines -match "^\s*\[wsl2\]\s*$").Count -gt 0) {
            $newLines = New-Object System.Collections.Generic.List[string]
            $inserted = $false
            foreach ($line in $lines) {
                $newLines.Add($line)
                if (-not $inserted -and $line -match "^\s*\[wsl2\]\s*$") {
                    $newLines.Add($entry)
                    $inserted = $true
                }
            }
            $lines = @($newLines)
        } elseif ($lines.Count -eq 0) {
            $lines = @("[wsl2]", $entry)
        } else {
            $lines = @($lines) + @("", "[wsl2]", $entry)
        }
        $added.Add($entry)
        $changed = $true
    }

    if ($changed) {
        Set-Content -LiteralPath $Path -Value $lines
    }
    return @{ Changed = $changed; Added = $added }
}

$wslResult = Add-WslConfigKeysIfMissing -Path $wslConfigPath -Desired $wslDesiredKeys
if ($wslResult.Changed) {
    Write-OK ("Born-bounded WSL ceilings written to .wslconfig (host {0}GB RAM / {1} CPUs): {2}" -f $hostRamGb, $hostCpus, ($wslResult.Added -join ", "))
    Write-Host "  Note: .wslconfig is inert until the next 'wsl --shutdown' (stops containers)." -ForegroundColor Yellow
    Write-Host "  Sweep in-flight pregate/local-CI work before cycling WSL (BI-4F3AB6B3)." -ForegroundColor Yellow
}

# --- Step 3: Docker Desktop ---------------------------------------------------

Write-Step 3 10 "Installing Docker Desktop..."
if (-not (Test-StepDone "docker")) {
    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCmd) {
        Write-Action "Downloading Docker Desktop (this takes a minute)..."
        $installerUrl = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
        $installerPath = "$env:TEMP\DockerDesktopInstaller.exe"
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

        Write-Host ""
        Write-Host "  ========================================================" -ForegroundColor Yellow
        Write-Host "  |  ACTION NEEDED:                                   |" -ForegroundColor Yellow
        Write-Host "  |                                                   |" -ForegroundColor Yellow
        Write-Host "  |  The Docker Desktop installer will open.          |" -ForegroundColor Yellow
        Write-Host "  |  1. Click 'Accept' on the license agreement       |" -ForegroundColor Yellow
        Write-Host "  |  2. Leave all checkboxes at their defaults        |" -ForegroundColor Yellow
        Write-Host "  |  3. Click 'Install' and wait for it to finish     |" -ForegroundColor Yellow
        Write-Host "  |  4. Click 'Close' when done                       |" -ForegroundColor Yellow
        Write-Host "  |                                                   |" -ForegroundColor Yellow
        Write-Host "  |  Docker Desktop is free for businesses with       |" -ForegroundColor Yellow
        Write-Host "  |  fewer than 250 employees and under `$10M revenue. |" -ForegroundColor Yellow
        Write-Host "  |  See https://docker.com/pricing for details.      |" -ForegroundColor Yellow
        Write-Host "  ========================================================" -ForegroundColor Yellow
        Write-Host ""

        Start-Process -FilePath $installerPath -Wait
        Remove-Item $installerPath -ErrorAction SilentlyContinue

        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    }

    # Wait for Docker daemon
    Write-Action "Waiting for Docker to start (this may take a minute)..."
    $attempts = 0
    $maxAttempts = 36  # 3 minutes
    while ($attempts -lt $maxAttempts) {
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        docker info 2>&1 | Out-Null
        $ErrorActionPreference = $oldEAP
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Seconds 5
        $attempts++
    }

    if ($attempts -ge $maxAttempts) {
        Write-Warn "Docker Desktop didn't start after 3 minutes."
        Write-Warn "Try opening Docker Desktop from the Start menu, then run this script again."
        exit 1
    }

    Write-OK "Docker is running"
    Save-Progress "docker"

    # Check Docker Desktop version for Model Runner support
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    docker model list 2>&1 | Out-Null
    $modelRunnerAvailable = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $oldEAP
    if (-not $modelRunnerAvailable) {
        Write-Warn "Docker Model Runner not available. Docker Desktop 4.40+ is required for AI features."
        Write-Warn "Please update Docker Desktop: https://docs.docker.com/desktop/release-notes/"
        Write-Warn "The platform will install but AI features (local models) won't work until you update."
    }
} else {
    Write-OK "Already installed"
}

# --- Step 4: Install Windows Exporter (host metrics for network discovery) ----

Write-Step 4 10 "Installing Windows metrics exporter..."
if (-not (Test-StepDone "windows_exporter")) {
    $weService = Get-Service -Name "windows_exporter" -ErrorAction SilentlyContinue
    if ($weService) {
        Write-OK "windows_exporter service already installed"
    } else {
        Write-Action "Installing windows_exporter for real host network discovery..."

        $weVersion = "0.30.5"
        $weUrl = "https://github.com/prometheus-community/windows_exporter/releases/download/v${weVersion}/windows_exporter-${weVersion}-amd64.msi"
        $weMsi = "$env:TEMP\windows_exporter.msi"

        try {
            Write-Action "Downloading windows_exporter v${weVersion}..."
            Invoke-WebRequest -Uri $weUrl -OutFile $weMsi -UseBasicParsing

            Write-Action "Installing silently (creates Windows service + firewall rule)..."
            $msiCmd = "/i `"$weMsi`" /quiet /norestart ENABLED_COLLECTORS=cpu,memory,net,logical_disk,os,system,thermalzone ADDLOCAL=FirewallException /L*v `"$env:TEMP\windows_exporter_install.log`""
            Start-Process -FilePath "msiexec.exe" -ArgumentList $msiCmd -Wait -NoNewWindow

            # Verify it installed
            Start-Sleep -Seconds 3
            $weCheck = Get-Service -Name "windows_exporter" -ErrorAction SilentlyContinue
            if ($weCheck -and $weCheck.Status -eq "Running") {
                Write-OK "windows_exporter installed and running on port 9182"
            } else {
                # Try to start it
                Start-Service -Name "windows_exporter" -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 2
                $weCheck = Get-Service -Name "windows_exporter" -ErrorAction SilentlyContinue
                if ($weCheck -and $weCheck.Status -eq "Running") {
                    Write-OK "windows_exporter started on port 9182"
                } else {
                    Write-Warn "windows_exporter installed but may not be running. Check: Get-Service windows_exporter"
                }
            }

            Remove-Item $weMsi -ErrorAction SilentlyContinue
        } catch {
            Write-Warn "Could not install windows_exporter: $_"
            Write-Warn "Network discovery will be limited to Docker-internal topology."
            Write-Warn "You can install it manually: choco install prometheus-windows-exporter.install"
        }
    }
    Save-Progress "windows_exporter"
} else {
    Write-OK "Already installed"
}

# --- Step 5: Choose install mode and set up files ----------------------------

Write-Step 5 10 "Setting up Digital Product Factory..."
if (-not (Test-StepDone "download")) {

    # If we already have a compose file, detect mode from prior install
    if (Test-Path "$DPF_DIR\docker-compose.yml") {
        if (Test-Path "$DPF_DIR\.git") {
            $InstallMode = "customizer"
            Write-Action "Updating project files..."
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            git -C "$DPF_DIR" pull --ff-only 2>&1 | Out-Null
            $ErrorActionPreference = $oldEAP
        } else {
            $InstallMode = "consumer"
        }
        Write-OK "Project files already in place ($InstallMode mode)"
        Save-Progress "download"
    } else {

        # --- Mode choice ---
        Write-Host ""
        Write-Host "  How do you want to use Digital Product Factory?" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "    [1] Ready to go   - Pre-built: Use Build Studio inside the portal to extend the platform." -ForegroundColor White
        Write-Host "    [2] Customizable  - Full source code: Build Studio + VS Code work from the same shared workspace." -ForegroundColor White
        Write-Host ""
        $modeChoice = if ($Contributor) {
            "2"
        } elseif ($Consumer -or $Headless) {
            "1"
        } else {
            Read-DPFInstallerInput "  Choose [1/2]"
        }

        if ($modeChoice -eq "2") {
            $InstallMode = "customizer"

            # Pre-flight: git required for customizer
            if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
                Write-Warn "Git is required for customizable mode."
                Write-Warn "Install from https://git-scm.com/download/win and re-run."
                exit 1
            }

            if (-not (Test-Path $DPF_DIR)) {
                New-Item -ItemType Directory -Path $DPF_DIR -Force | Out-Null
            }

            Write-Action "Cloning project source..."
            $stash = @{}
            foreach ($f in '.install-progress','.env') {
                if (Test-Path "$DPF_DIR\$f") {
                    $stash[$f] = Get-Content "$DPF_DIR\$f" -Raw
                    Remove-Item "$DPF_DIR\$f"
                }
            }
            if ((Test-Path $DPF_DIR) -and
                @(Get-ChildItem $DPF_DIR -Force -ErrorAction SilentlyContinue).Count -eq 0) {
                Remove-Item $DPF_DIR
            }

            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            git clone "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git" "$DPF_DIR" 2>&1 | ForEach-Object { "$_" }
            $ErrorActionPreference = $oldEAP
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "Clone failed. Check your internet connection."
                exit 1
            }
            foreach ($f in $stash.Keys) { $stash[$f] | Set-Content "$DPF_DIR\$f" }

            # Create one durable branch for this install's local customization work.
            # Generate a stable anonymous instance ID (8-char hex from GUID hash).
            # This replaces $env:COMPUTERNAME which would leak the machine name
            # to any public git repo this branch is pushed to.
            $instanceIdFile = "$DPF_DIR\.dpf-instance-id"
            if (Test-Path $instanceIdFile) {
                $instanceId = (Get-Content $instanceIdFile).Trim()
            } else {
                $guid = [System.Guid]::NewGuid().ToString()
                $sha = [System.Security.Cryptography.SHA256]::Create()
                $hashBytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($guid))
                $instanceId = ($hashBytes[0..3] | ForEach-Object { $_.ToString("x2") }) -join ""
                $instanceId | Set-Content $instanceIdFile
            }
            $branchName = "dpf/$instanceId"
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            git -C "$DPF_DIR" checkout -b $branchName 2>&1 | Out-Null
            $ErrorActionPreference = $oldEAP
            Write-OK "Cloned source on branch '$branchName'"
            Write-Action "This is the per-install branch. Build Studio and VS Code share this workspace."
            Write-Action "For feature work, create short-lived topic branches off 'main' (feat/*, fix/*, chore/*) and open PRs -- see CONTRIBUTING.md."

            # Convenience scripts for customizer mode
            Copy-Item "$DPF_DIR\scripts\dpf-start.ps1" "$DPF_DIR\dpf-start.ps1" -ErrorAction SilentlyContinue
            Copy-Item "$DPF_DIR\scripts\dpf-stop.ps1" "$DPF_DIR\dpf-stop.ps1" -ErrorAction SilentlyContinue
            Copy-Item "$DPF_DIR\scripts\dpf-start.bat" "$DPF_DIR\dpf-start.bat" -ErrorAction SilentlyContinue
            Copy-Item "$DPF_DIR\scripts\dpf-stop.bat" "$DPF_DIR\dpf-stop.bat" -ErrorAction SilentlyContinue

            # Enable in-repo git hooks (Prisma migration guard) for customizer installs.
            # Consumer installs have no git checkout so this does not apply to that branch.
            git -C $DPF_DIR config core.hooksPath .githooks 2>&1 | Out-Null

        } else {
            # --- Consumer path ---
            $InstallMode = "consumer"
            Write-Action "Setting up pre-built platform, this will take a few minutes..."

            # Authenticate with GitHub Container Registry (images are private during early access)
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            docker pull ghcr.io/opendigitalproductfactory/dpf-portal:latest 2>&1 | Out-Null
            $needsAuth = ($LASTEXITCODE -ne 0)
            $ErrorActionPreference = $oldEAP

            if ($needsAuth) {
                if ($Headless) {
                    Write-Warn "The release image requires GHCR authentication. Run 'docker login ghcr.io' before re-running -Headless."
                    exit 1
                }
                Write-Host ""
                Write-Host "  The platform images require a GitHub account (free) during early access." -ForegroundColor Cyan
                Write-Host "  You need a Personal Access Token with 'read:packages' scope." -ForegroundColor Cyan
                Write-Host "  Create one at: https://github.com/settings/tokens/new?scopes=read:packages" -ForegroundColor Cyan
                Write-Host ""
                $ghUser = Read-DPFInstallerInput "  GitHub username"
                $ghToken = Read-DPFInstallerInput "  Personal Access Token" -AsSecureString
                $ghTokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($ghToken))
                $ghTokenPlain | docker login ghcr.io -u $ghUser --password-stdin 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    Write-Warn "GitHub authentication failed. Check your username and token."
                    exit 1
                }
                Write-OK "Authenticated with GitHub Container Registry"
            }

            if (-not (Test-Path $DPF_DIR)) {
                New-Item -ItemType Directory -Path $DPF_DIR -Force | Out-Null
            }

            # Materialize the exact release topology and lifecycle adapter carried by
            # the pulled portal image, then verify every byte before installation.
            Export-DPFConsumerReleaseAssets -InstallDir $DPF_DIR -Version $Version -Image "ghcr.io/opendigitalproductfactory/dpf-portal:$Version"
            Write-DPFImageIdentity -Image "ghcr.io/opendigitalproductfactory/dpf-portal:$Version" -Version $Version
            Get-DPFEdgeComposeContent -Version $Version | Set-Content "$DPF_DIR\docker-compose.edge.yml" -Encoding UTF8
            Get-DPFStartScriptContent | Set-Content "$DPF_DIR\dpf-start.ps1" -Encoding ASCII
            Get-DPFStopScriptContent | Set-Content "$DPF_DIR\dpf-stop.ps1" -Encoding ASCII
            Write-OK "Canonical release assets installed to $DPF_DIR"
        }

        Write-Host ""
        Write-Host "  While setup continues..." -ForegroundColor Cyan
        Write-Host "  - This install can stay private or later contribute improvements back through the Hive Mind." -ForegroundColor White
        Write-Host "  - That choice will be configured in the portal during setup, so you do not need a GitHub token yet." -ForegroundColor White
        if ($InstallMode -eq "customizer") {
            Write-Host "  - In customizable mode, Build Studio and VS Code will work from the same shared workspace." -ForegroundColor White
        } else {
            Write-Host "  - In ready-to-go mode, Build Studio is your guided interface for extending the platform." -ForegroundColor White
        }
        Write-Host "  - For the strongest AI-assisted development experience, plan on connecting a frontier-capable model once the portal is running." -ForegroundColor White

        # Save install mode
        $InstallMode | Set-Content "$DPF_DIR\.install-mode"

        # Add install directory to user PATH if not already there
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($userPath -notlike "*$DPF_DIR*") {
            [Environment]::SetEnvironmentVariable("Path", "$userPath;$DPF_DIR", "User")
            $env:Path += ";$DPF_DIR"
        }

        Save-Progress "download"
    }
} else {
    # Resume: read saved mode
    if (Test-Path "$DPF_DIR\.install-mode") {
        $InstallMode = (Get-Content "$DPF_DIR\.install-mode").Trim()
    } elseif (Test-Path "$DPF_DIR\.git") {
        $InstallMode = "customizer"
    } else {
        $InstallMode = "consumer"
    }
    Write-OK "Already set up ($InstallMode mode)"
}

# --- Step 4.5: Developer environment setup (customizer mode only) -------------
# This runs as its own step so it executes even when "download" was already
# saved by a previous install run (e.g. with an older version of this script).

if ($InstallMode -eq "customizer" -and -not (Test-StepDone "dev_setup")) {
    Write-Host ""
    Write-Host "  Setting up developer environment..." -ForegroundColor Cyan

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Warn "Node.js v20+ is required for customizable mode."
        Write-Warn "Download from https://nodejs.org/ then re-run the installer."
        exit 1
    }
    $nodeVer = [int]((node -v).TrimStart('v').Split('.')[0])
    if ($nodeVer -lt 20) {
        Write-Warn "Node.js v20+ required. Current: $(node -v)"
        exit 1
    }
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Action "Installing pnpm..."
        npm install -g pnpm
    }

    # Hoisted layout avoids symlink permission issues on Windows (no Developer Mode needed)
    if (-not (Test-Path "$DPF_DIR\.npmrc")) {
        "node-linker=hoisted" | Set-Content -Path "$DPF_DIR\.npmrc" -Encoding UTF8
        Write-OK "Created .npmrc (node-linker=hoisted)"
    }

    Write-Action "Installing project dependencies (this may take a minute)..."
    Set-Location $DPF_DIR
    pnpm install
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "pnpm install failed. Check the output above."
        exit 1
    }
    Write-OK "Project dependencies installed"

    # App-level .env files for local Next.js and Prisma
    $envExamplePath = "$DPF_DIR\.env.example"
    if (Test-Path $envExamplePath) {
        $webEnvPath = "$DPF_DIR\apps\web\.env.local"
        if (-not (Test-Path $webEnvPath)) {
            $webContent = Get-Content $envExamplePath -Raw
            $webEncKey = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Maximum 256) })
            $webContent = $webContent -replace '<generate with: openssl rand -hex 32>', $webEncKey
            $webAuthBytes = New-Object byte[] 32
            [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($webAuthBytes)
            $webAuthSecret = [Convert]::ToBase64String($webAuthBytes)
            $webContent = $webContent -replace '<generate with: openssl rand -base64 32>', $webAuthSecret
            $webContent | Set-Content $webEnvPath
            Write-OK "Created apps/web/.env.local"
        }
    } else {
        Write-Warn ".env.example not found -- skipping app-level .env creation"
    }

    # docker-compose.override.yml: expose DB ports for local development
    # Note: bind-mounting non-C: drives into Docker Desktop WSL2 is unreliable.
    # Named volumes (managed by Docker) are used for data; ports are exposed for pnpm dev.
    $overridePath = "$DPF_DIR\docker-compose.override.yml"
    if (-not (Test-Path $overridePath)) {
@"
# Auto-generated by DPF installer (customizer mode)
# Exposes database ports to the host so you can run pnpm dev locally.
# Also binds the checked-out repo into /workspace so Build Studio and VS Code
# operate on the same source tree.
services:
  postgres:
    ports:
      - "5432:5432"
  portal-init:
    volumes:
      - .:/workspace
  portal:
    volumes:
      - .:/workspace
"@ | Set-Content -Path $overridePath -Encoding UTF8
        Write-OK "Created docker-compose.override.yml (DB ports + shared workspace bind mount)"
    }

    Save-Progress "dev_setup"
} elseif ($InstallMode -eq "customizer") {
    Write-OK "Developer environment already set up"
}

# --- Step 5: Hardware Detection ------------------------------------------------

Write-Step 6 10 "Detecting your hardware..."
if (-not (Test-StepDone "hardware")) {
    $cpu = Get-CimInstance Win32_Processor
    $mem = Get-CimInstance Win32_ComputerSystem
    $gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match "NVIDIA" } | Select-Object -First 1
    $disk = Get-DPFInstallDriveFreeSpace -InstallDir $DPF_DIR -DriveInventory (Get-DPFDriveInventory)

    $totalRAM_GB = [math]::Round($mem.TotalPhysicalMemory / 1GB, 1)
    $gpuName = if ($gpu) { $gpu.Name } else { $null }

    # WMI AdapterRAM is a DWORD -- caps at 4GB. Use nvidia-smi for accurate VRAM.
    $gpuVRAM_GB = 0
    if ($gpuName) {
        try {
            $nvSmiOutput = & "nvidia-smi" "--query-gpu=memory.total" "--format=csv,noheader,nounits" 2>$null
            if ($LASTEXITCODE -eq 0 -and $nvSmiOutput) {
                $gpuVRAM_GB = [math]::Round([int]$nvSmiOutput.Trim() / 1024, 1)
            }
        } catch {}
        if ($gpuVRAM_GB -eq 0 -and $gpu.AdapterRAM) {
            $gpuVRAM_GB = [math]::Round($gpu.AdapterRAM / 1GB, 1)
        }
    }
    $diskFree_GB = [double]$disk.FreeGB

    $hwSummary = "$totalRAM_GB GB RAM, $($cpu.NumberOfCores)-core CPU"
    if ($gpuName) { $hwSummary += ", $gpuName ($gpuVRAM_GB GB VRAM)" }
    Write-OK $hwSummary

    # Select from the same data-only policy used by the web runtime and the
    # cross-platform host detector. This removes the hand-maintained PowerShell
    # ladder that previously drifted from the runtime policy.
    $modelPolicyPath = Join-Path $DPF_DIR "scripts\installer\local-model-policy.json"
    if (-not (Test-Path -LiteralPath $modelPolicyPath)) {
        throw "Local model policy missing: $modelPolicyPath"
    }
    $modelPolicy = Get-Content -LiteralPath $modelPolicyPath -Raw | ConvertFrom-Json
    $modelHeadroomGB = [double]$modelPolicy.modelHeadroomGb
    $selectedTier = $modelPolicy.tiers |
        Where-Object { ([double]$_.weightsGb + $modelHeadroomGB) -le $gpuVRAM_GB } |
        Select-Object -First 1
    if (-not $selectedTier) {
        $selectedTier = $modelPolicy.tiers | Select-Object -Last 1
    }
    if (-not $selectedTier) {
        throw "Local model policy has no selection tiers: $modelPolicyPath"
    }
    $selectedModel = [string]$selectedTier.model
    if ($gpuVRAM_GB -gt 0) {
        $modelReason = "$($selectedTier.label) -- fits your $gpuVRAM_GB GB VRAM with $modelHeadroomGB GB headroom"
    } else {
        $modelReason = "$($selectedTier.label) -- lightweight fallback for CPU or undetected VRAM"
    }
    Write-Action "Selected AI model: $selectedModel ($modelReason)"
    Write-Action "Models are managed by Docker Model Runner (built into Docker Desktop)."

    # Check disk space
    if ($diskFree_GB -lt 5) {
        $diskLabel = if ($disk.DeviceID) { $disk.DeviceID } else { "the selected install drive" }
        Write-Warn "Not enough disk space on $diskLabel. The platform needs about 5 GB free. You have $diskFree_GB GB."
        exit 1
    }

    # Build host profile JSON
    $hostProfile = @{
        cpuCores = $cpu.NumberOfCores
        cpuModel = $cpu.Name
        ramGB = $totalRAM_GB
        gpuName = $gpuName
        gpuVramGB = $gpuVRAM_GB
        installDrive = $disk.DeviceID
        diskFreeGB = $diskFree_GB
        selectedModel = $selectedModel
        detectedAt = (Get-Date -Format "o")
    } | ConvertTo-Json -Compress

    # Docker Model Runner uses Docker Desktop's built-in GPU support -- no override needed.

    # Save for later steps
    $hostProfile | Set-Content "$DPF_DIR\.host-profile.json"
    $selectedModel | Set-Content "$DPF_DIR\.selected-model"

    Save-Progress "hardware"
} else {
    Write-OK "Already detected"
    $selectedModel = Get-Content "$DPF_DIR\.selected-model" -ErrorAction SilentlyContinue
    if (-not $selectedModel) { $selectedModel = "ai/gemma3" }
}

# --- Generate .env -------------------------------------------------------------

if (-not (Test-Path "$DPF_DIR\.env")) {
    $pgPass = New-RandomPassword 16
    $authSecret = New-RandomPassword 32
    $encKey = New-RandomPassword 32
    $adminPass = New-RandomAlphanumeric 16
    $hostProfileJson = if (Test-Path "$DPF_DIR\.host-profile.json") { Get-Content "$DPF_DIR\.host-profile.json" -Raw } else { "{}" }

    # Backups live OUTSIDE the install root by design so dpf-reinstall.ps1
    # / uninstall-dpf.ps1 rm-ing $DPF_DIR cannot destroy them. The compose
    # bind mount reads DPF_BACKUPS_HOST_PATH from .env.
    $backupsHostDir = "$DPF_DIR-backups"

    # Runtime state dir (/dpf-state mount). ABSOLUTE host path so the self-upgrade
    # promoter (runs as root, HOME=/root) does NOT fall back to /root/.dpf and fail
    # the migrate step with "mounts denied" (#3262). ~/.dpf is under the user profile,
    # which Docker Desktop shares by default.
    $stateHostDir = Join-Path $HOME ".dpf"
    $rawHostArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    $hostArch = switch ($rawHostArch) { "x64" { "amd64" }; "amd64" { "amd64" }; "arm64" { "arm64" }; default { throw "Unsupported host architecture: $rawHostArch" } }

    @"
# Generated by DPF installer -- do not edit manually
POSTGRES_USER=dpf
POSTGRES_PASSWORD=$pgPass
DATABASE_URL=postgresql://dpf:$pgPass@postgres:5432/dpf
AUTH_SECRET=$authSecret
CREDENTIAL_ENCRYPTION_KEY=$encKey
ADMIN_PASSWORD=$adminPass
DPF_HOST_PROFILE=$hostProfileJson
DPF_HOST_INSTALL_PATH=$DPF_DIR
DPF_BACKUPS_HOST_PATH=$backupsHostDir
DPF_STATE_DIR=$stateHostDir
DPF_HOST_PLATFORM=win32
DPF_HOST_ARCH=$hostArch
LLM_BASE_URL=http://model-runner.docker.internal/v1
GF_ADMIN_USER=admin
GF_ADMIN_PASSWORD=$adminPass
"@ | Set-Content "$DPF_DIR\.env"
}

# Refresh authoritative host identity on upgrades without touching operator
# secrets. This matches Initialize-DpfState's canonical Windows identity.
$rawHostArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
$hostArch = switch ($rawHostArch) { "x64" { "amd64" }; "amd64" { "amd64" }; "arm64" { "arm64" }; default { throw "Unsupported host architecture: $rawHostArch" } }
Set-DPFEnvFileValue -Path "$DPF_DIR\.env" -Key "DPF_HOST_PLATFORM" -Value "win32"
Set-DPFEnvFileValue -Path "$DPF_DIR\.env" -Key "DPF_HOST_ARCH" -Value $hostArch

if ($InstallMode -eq "consumer") {
    Set-DPFConsumerReleaseIdentity -InstallDir $DPF_DIR -Version $Version
}

# --- Ensure backups directory exists OUTSIDE the install root ----------------
#
# Backups live at $DPF_DIR-backups\ (sibling to $DPF_DIR) so that
# dpf-reinstall.ps1 / uninstall-dpf.ps1 deleting $DPF_DIR can never destroy
# operator backup history. The compose bind mount reads DPF_BACKUPS_HOST_PATH
# from .env (set above). Docker will refuse to start the service if the
# bind-mount source doesn't exist as a directory, so create it now.
#
# Also handles two upgrade paths:
#   1. Operators upgrading from PR #1040: the dpf-reinstall.ps1 / uninstall
#      preserve dance moved backups to $DPF_DIR-backups\ -- that location IS
#      the permanent home now, so leave them alone.
#   2. Operators upgrading from pre-#1040 (backups still in-tree at
#      $DPF_DIR\backups\): migrate them forward so the new bind mount sees
#      them. Idempotent: only moves entries that don't collide with anything
#      already at the destination.

$backupsHostDir = "$DPF_DIR-backups"
if (-not (Test-Path $backupsHostDir)) {
    New-Item -ItemType Directory -Path $backupsHostDir | Out-Null
    Write-Action "Created backups directory at $backupsHostDir (outside install root by design)"
}

$legacyBackupsDir = Join-Path $DPF_DIR "backups"
if (Test-Path $legacyBackupsDir) {
    try {
        $legacyEntries = Get-ChildItem -LiteralPath $legacyBackupsDir -Force -ErrorAction SilentlyContinue
    } catch {
        $legacyEntries = @()
    }
    if ($legacyEntries) {
        Write-Action "Migrating legacy in-tree backups from $legacyBackupsDir to $backupsHostDir"
        foreach ($entry in $legacyEntries) {
            $dest = Join-Path $backupsHostDir $entry.Name
            if (Test-Path $dest) {
                Write-Warn "  Skipped $($entry.Name): already exists in $backupsHostDir"
            } else {
                try {
                    Move-Item -LiteralPath $entry.FullName -Destination $dest -Force
                } catch {
                    Write-Warn "  Could not move $($entry.Name): $_"
                }
            }
        }
        $remaining = Get-ChildItem -LiteralPath $legacyBackupsDir -Force -ErrorAction SilentlyContinue
        if (-not $remaining) {
            Remove-Item -LiteralPath $legacyBackupsDir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Ok "Legacy in-tree backups migrated to $backupsHostDir"
        } else {
            Write-Warn "Some entries left in $legacyBackupsDir (collisions) -- review by hand."
        }
    }
}

# --- Kernel-commandment shell guard (BI-43F95F77) ----------------------------
#
# Probe for real-binary paths BEFORE adding safety-bin to PATH, then write
# .cmd shims that invoke the PowerShell guard. Idempotent: re-running the
# installer does not duplicate PATH entries or shim files.
#
# The guard intercepts `docker`, `git`, `prisma` calls and asks the kernel
# gate at /api/kernel/gate to decide. tier-1 commandments refuse autonomously
# / typed-confirm interactively. Static fallback patterns ship alongside so
# the guard fails closed for the most dangerous commands even when the portal
# is down.

$safetyBin = Join-Path $DPF_DIR "safety-bin"
if (-not (Test-Path $safetyBin)) {
    New-Item -ItemType Directory -Path $safetyBin | Out-Null
}

# Probe real-binary paths BEFORE we add safety-bin to PATH.
$realEnvLines = @("# Generated by install-dpf.ps1; do not edit. Dot-sourced by dpf-shell-guard.ps1.")
foreach ($tool in @("docker", "git", "prisma")) {
    $real = (Get-Command $tool -All -ErrorAction SilentlyContinue |
             Where-Object { $_.Source -notmatch [regex]::Escape($safetyBin) } |
             Select-Object -First 1 -ExpandProperty Source)
    if ($real) {
        $varName = "DPF_REAL_$($tool.ToUpper())"
        $realEnvLines += "`$env:$varName = '$real'"
    }
}
$realEnvLines -join "`r`n" | Set-Content -Path (Join-Path $safetyBin "real-binaries.ps1") -Encoding UTF8

# Copy the guard + static fallback patterns.
Copy-Item -Path (Join-Path $DPF_DIR "scripts\safety\dpf-shell-guard.ps1") -Destination $safetyBin -Force
Copy-Item -Path (Join-Path $DPF_DIR "scripts\safety\dpf-shell-guard-fallback-patterns.json") -Destination $safetyBin -Force

# Generate .cmd shims. Each shim invokes the PowerShell guard with the
# basename as -BinName. The shim's filename (docker.cmd) is what `where docker`
# resolves to; the guard receives the intended tool name explicitly so
# basename-based detection isn't fragile.
# NOTE: no `--` separator before %*. With `pwsh -File`, PowerShell parses `--` as a
# parameter prefix with an EMPTY name and aborts every guarded command with
# "Parameter cannot be processed because the parameter name '' is ambiguous" --
# which breaks git/docker/prisma for the whole user account, because safety-bin is
# prepended to the user PATH below. The guard collects %* from the automatic $args.
foreach ($tool in @("docker", "git", "prisma")) {
    $shimContent = "@echo off`r`npwsh -NoProfile -ExecutionPolicy Bypass -File `"%~dp0dpf-shell-guard.ps1`" -BinName $tool %*`r`n"
    Set-Content -Path (Join-Path $safetyBin "$tool.cmd") -Value $shimContent -Encoding ASCII -NoNewline
}

# Idempotently prepend safety-bin to the user PATH.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$safetyBin*") {
    $newPath = "$safetyBin;$userPath"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Ok "Prepended $safetyBin to user PATH (registry)"
} else {
    Write-Ok "User PATH already contains $safetyBin"
}

# Also update the current process so the running installer (and child
# docker-compose invocations) see the shim immediately.
if ($env:Path -notlike "*$safetyBin*") {
    $env:Path = "$safetyBin;$env:Path"
}

Write-Action "Open a new terminal for the PATH change to take effect in other windows."

# --- Step 6: Start Platform ---------------------------------------------------

if ($OrganizationJoinPackagePath) {
    Write-Host ""
    Write-Host "  Configuring organization trust..." -ForegroundColor Cyan
    $bootstrap = Join-Path $DPF_DIR "scripts\bootstrap-organization-pki.ps1"
    if (-not (Test-Path -LiteralPath $bootstrap)) { $bootstrap = Join-Path $PSScriptRoot "scripts\bootstrap-organization-pki.ps1" }
    if (-not (Test-Path -LiteralPath $bootstrap)) { throw "organization_pki_bootstrap_missing" }
    & $bootstrap -Mode join -JoinPackage $OrganizationJoinPackagePath -NoStartTls
    $env:DPF_ORGANIZATION_TRUST_ENABLED = "1"
    Write-OK "Organization HTTPS trust configured; the one-time package was consumed"
}

Write-Step 7 10 "Starting the platform..."
if (-not (Test-StepDone "started")) {
    Set-Location $DPF_DIR
    $stateLib = Join-Path $DPF_DIR "scripts\installer\lib\state.ps1"
    if (-not (Test-Path -LiteralPath $stateLib)) { throw "capability_state_helper_missing" }
    . $stateLib
    Initialize-DpfState -InstallerVersion $Version -InstallPath $DPF_DIR
    if ($WithEdge) { $env:DPF_INCLUDE_EDGE = '1' }
    elseif ($NoEdge) { $env:DPF_INCLUDE_EDGE = '0' }
    $resolvedEdgeEnabled = Resolve-DpfEdgeEnabled -InstallDir $DPF_DIR
    $env:DPF_INCLUDE_EDGE = if ($resolvedEdgeEnabled) { '1' } else { '0' }
    Set-DpfStateValues -Values @{
        installerVersion = $Version
        installPath = $DPF_DIR
        installMode = $InstallMode
        imageTag = $(if ($InstallMode -eq "consumer") { $Version } else { $null })
        edge = @{ enabled = $resolvedEdgeEnabled; mode = $(if ($resolvedEdgeEnabled) { "local" } else { $null }) }
    }
    # Record the environment class only when the operator declared one. Writing a
    # default here would let an unasserted install claim to be development and
    # unlock teardown it should never have.
    if ($EnvironmentClass) {
        Set-DpfStateValues -Values @{ environmentClass = $EnvironmentClass }
        Write-OK "Installation environment class: $EnvironmentClass"
    } else {
        Write-Host "  No environment class declared; this install is treated as production until one is set." -ForegroundColor Yellow
    }
    $capabilityProjection = Resolve-DpfCapabilityComposeProfiles -InstallDir $DPF_DIR
    $env:COMPOSE_PROFILES = (@($capabilityProjection.composeProfiles) -join ',')
    . (Resolve-DPFComposeChainModule -InstallDir $DPF_DIR)
    $coreComposeArgs = Get-DPFComposeArgs -InstallDir $DPF_DIR -IncludeEdge:$false -IncludeRelease:($InstallMode -eq "consumer")
    $recordedComposeFiles = @()
    for ($i = 0; $i -lt $coreComposeArgs.Count; $i++) {
        if ($coreComposeArgs[$i] -eq "-f" -and ($i + 1) -lt $coreComposeArgs.Count) {
            $recordedComposeFiles += [string]$coreComposeArgs[$i + 1]
            $i++
        }
    }
    Set-DpfStateValues -Values @{ composeFiles = $recordedComposeFiles }

    if ($InstallMode -eq "consumer") {
        Write-Action "Pulling pre-built images (this may take a few minutes, be patient)..."
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        docker compose @coreComposeArgs --progress plain pull 2>&1 | ForEach-Object { "$_" }
        $pullExit = $LASTEXITCODE
        $ErrorActionPreference = $oldEAP
        if ($pullExit -ne 0) {
            Write-Warn "Failed to pull images. Check your internet connection."
            Write-Warn "You can retry after fixing connectivity by running dpf-start."
            exit 1
        }
    } else {
        # --- Docker VM memory preflight (customizer source-build only) --------
        # The Next.js production build needs ~4 GB of Node.js heap
        # (NODE_OPTIONS=--max-old-space-size=4096); with parallel image builds
        # and OS overhead the Docker VM needs at least 6 GB. Docker Desktop on
        # Windows defaults to 2 GB -- catch this early rather than letting the
        # build OOM silently inside the container. Mirrors the bash preflight
        # scripts/installer/lib/preflight.sh (dpf_preflight_docker_memory).
        # Consumer (pull-image) installs do not build, so they skip this.
        $minMemMb  = if ($env:DPF_DOCKER_MIN_MEM_MB)  { [int]$env:DPF_DOCKER_MIN_MEM_MB }  else { 6144 }  # 6 GB hard floor
        $warnMemMb = if ($env:DPF_DOCKER_WARN_MEM_MB) { [int]$env:DPF_DOCKER_WARN_MEM_MB } else { 8192 }  # 8 GB soft target
        $memBytes = 0
        try { $memBytes = [int64](docker info --format '{{.MemTotal}}' 2>$null) } catch { $memBytes = 0 }
        $memMb = [int]($memBytes / 1MB)
        if ($memMb -gt 0 -and $memMb -lt $minMemMb) {
            if ($env:DPF_FORCE_UNSUPPORTED_HOST -eq "1") {
                Write-Warn "Docker VM memory is $memMb MB (minimum: $minMemMb MB), but DPF_FORCE_UNSUPPORTED_HOST=1 -- proceeding."
            } else {
                Write-Warn "Insufficient Docker memory: the VM has $memMb MB; the Next.js build needs at least $minMemMb MB."
                Write-Warn "Open Docker Desktop -> Settings -> Resources -> Memory, set it to 8 GB, then re-run."
                Write-Warn "Override (advanced): set `$env:DPF_FORCE_UNSUPPORTED_HOST = '1' before re-running."
                exit 1
            }
        } elseif ($memMb -ge $warnMemMb) {
            Write-OK "Docker VM memory: $memMb MB"
        } elseif ($memMb -gt 0) {
            Write-Warn "Docker VM memory is $memMb MB. 8 GB+ is recommended for parallel image builds (Settings -> Resources -> Memory)."
        }

        # --- Stamp the from-source build with real version identity -----------
        # Mirrors install-dpf.sh:677-686. Without these, the customizer image
        # falls back to the Dockerfile content-hash + the stale version.json
        # baseline, so /ops/self-upgrade reports the wrong build identity for
        # Windows source-builders. Consumer installs pull CI-stamped images and
        # do not need this.
        $gitSha = (git -C "$DPF_DIR" rev-parse HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and $gitSha) {
            $env:DPF_VERSION = $gitSha.Trim()
            Write-OK "Stamping local build with DPF_VERSION=$($env:DPF_VERSION)"
        }
        $gitDesc = (git -C "$DPF_DIR" describe --tags --always 2>$null)
        if ($LASTEXITCODE -eq 0 -and $gitDesc) {
            $env:DPF_PLATFORM_VERSION = ($gitDesc.Trim() -replace '^v','')
            Write-OK "Stamping local build with DPF_PLATFORM_VERSION=$($env:DPF_PLATFORM_VERSION)"
        }

        Write-Action "Building the portal (first time takes 3-5 minutes)..."
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        docker compose @coreComposeArgs build --quiet 2>&1 | Out-Null
        $buildExit = $LASTEXITCODE
        $ErrorActionPreference = $oldEAP
        if ($buildExit -ne 0) {
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            docker compose @coreComposeArgs build
            $buildExit = $LASTEXITCODE
            $ErrorActionPreference = $oldEAP
            if ($buildExit -ne 0) {
                Write-Warn "Build failed. Check the output above for errors."
                exit 1
            }
        }
    }

    # Promoter image is built just-in-time by the portal on first promotion.
    # The build files (Dockerfile.promoter, promote.sh, portal Dockerfile)
    # are baked into the portal image at /promoter/.

    Write-Action "Starting database and portal..."
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    # Non-critical sidecars (e.g. dpf-stt voice STT) pull from third-party
    # registries whose mutable tags get pruned upstream: hwdsl2/whisper-server
    # re-pushes :latest and prunes the prior index digest, so a pinned digest
    # eventually 404s ("manifest unknown"). A single such failure would otherwise
    # abort the WHOLE compose up, taking the portal/db/redis down with it (#1767).
    # Pre-pull them with failure tolerated and, if one is unavailable, scale it to
    # 0 so the core platform still comes up -- voice degrades, the install does
    # not. Nothing depends_on these sidecars, so scaling to 0 is safe.
    $scaleArgs = @()
    if (@($capabilityProjection.requiredServices) -contains "dpf-stt") {
        $svc = "dpf-stt"
        docker compose @coreComposeArgs pull $svc 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Optional sidecar '$svc' image is unavailable upstream; bringing up the platform without it."
            Write-Action "  Voice features needing '$svc' stay inactive until its image returns; re-run the installer to retry."
            $scaleArgs += @("--scale", "$svc=0")
        }
    }
    docker compose @coreComposeArgs up -d @scaleArgs
    $ErrorActionPreference = $oldEAP

    # Voice / TTS sidecar. Spoken output uses the bundled dpf-tts container, but
    # it's behind the `tts` compose profile (and carries an NVIDIA deploy
    # reservation), so a plain `up` never starts it -- leaving voice silent out
    # of the box. Start it here so a fresh install speaks, per
    # bundled-services-active-by-default. Only enabled when an NVIDIA GPU with
    # >=6 GB VRAM is detected (the deploy reservation would fail on a GPU-less
    # host; the CPU tier is ~10-30x slower). Non-fatal: a GPU-runtime hiccup
    # must not abort the install.
    $ttsVram = 0.0
    if (Test-Path "$DPF_DIR\.host-profile.json") {
        try { $ttsVram = [double]((Get-Content "$DPF_DIR\.host-profile.json" -Raw | ConvertFrom-Json).gpuVramGB) } catch { $ttsVram = 0.0 }
    }
    if ((@($capabilityProjection.requiredServices) -contains "dpf-tts") -and $ttsVram -ge 6) {
        Write-Action "Starting voice TTS sidecar (dpf-tts -- NVIDIA GPU detected)..."
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        docker compose @coreComposeArgs up -d dpf-tts 2>&1 | Out-Null
        $ttsExit = $LASTEXITCODE
        $ErrorActionPreference = $oldEAP
        if ($ttsExit -eq 0) {
            Write-Action "Voice TTS container started -- spoken output works out of the box."
        } else {
            Write-Warn "dpf-tts failed to start (NVIDIA container runtime / GPU issue?); voice output will stay silent."
        }
    } elseif (@($capabilityProjection.requiredServices) -contains "dpf-tts") {
        Write-Action "Voice TTS sidecar skipped (no NVIDIA GPU >=6 GB VRAM detected); STT still works. See docs/install/windows.md -> Voice to enable."
    } else {
        Write-Action "Voice TTS sidecar is inactive by capability selection."
    }

    # Sync postgres password -- if the volume was reused from a prior install,
    # the DB user still has the old password. Update it to match the new .env.
    Write-Action "Syncing database credentials..."
    $envPgPass = (Get-Content "$DPF_DIR\.env" | Select-String "^POSTGRES_PASSWORD=(.+)$").Matches.Groups[1].Value
    if ($envPgPass) {
        $syncAttempts = 0
        while ($syncAttempts -lt 15) {
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            docker exec dpf-postgres-1 psql -U dpf -d dpf -c "ALTER USER dpf PASSWORD '$envPgPass';" 2>&1 | Out-Null
            $ErrorActionPreference = $oldEAP
            if ($LASTEXITCODE -eq 0) { break }
            $syncAttempts++
            Start-Sleep -Seconds 2
        }
    }

    # Wait for portal health
    Write-Action "Waiting for the portal to be ready..."
    $attempts = 0
    $maxAttempts = 60  # 5 minutes
    while ($attempts -lt $maxAttempts) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) { break }
        } catch {}
        Start-Sleep -Seconds 5
        $attempts++
    }

    if ($attempts -ge $maxAttempts) {
        Write-Warn "Portal didn't become healthy after 5 minutes."
        Write-Warn "Run 'docker compose logs portal' in $DPF_DIR to see what happened."
        exit 1
    }

    Write-OK "All services healthy"
    Set-DpfStateValues -Values @{
        installerVersion = $Version
        lastSuccessfulInstallVersion = $Version
        installPath = $DPF_DIR
        installMode = $InstallMode
        composeFiles = $recordedComposeFiles
        imageTag = $(if ($InstallMode -eq "consumer") { $Version } else { $null })
    }

    # For customizer mode: generate Prisma client on the host so local `pnpm dev` works
    if ($InstallMode -eq "customizer") {
        Write-Action "Generating Prisma client for local development..."
        Set-Location $DPF_DIR
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        pnpm --filter @dpf/db exec prisma generate 2>&1 | Out-Null
        $ErrorActionPreference = $oldEAP
        if ($LASTEXITCODE -eq 0) {
            Write-OK "Prisma client generated"
        } else {
            Write-Warn "Prisma client generation failed -- run manually: pnpm --filter @dpf/db exec prisma generate"
        }
    }

    Save-Progress "started"

# --- Agent toolchain bootstrap (Claude Code + Codex CLI) ---------------------
# Per BI-4B17051B (Phase 3): replace command-copy remediation with the
# state-driven readiness banner. The bootstrap script handles missing CLIs,
# missing tokens, and stale plugin entries as explicit readiness states with
# one primary remediation action each. No `.\scripts\...` is suggested to
# the operator under any path.
if (-not (Test-StepDone "mcp_seed")) {
    # Seed per-worktree MCP config first (idempotent; needs the token already
    # generated at Admin > Platform Development > MCP).
    # Neither of the two scripts below ships in the release bundle, so on a
    # `consumer` install both Test-Path checks are false. That is expected --
    # install-dpf.sh gates the same convergence on contributor mode ("customer
    # installs don't need agent CLIs wired up") -- but it must not be SILENT.
    # Without an else branch, "the script isn't here" is indistinguishable from
    # "it ran and succeeded", and we then Save-Progress the step as done. A user
    # expecting MCP-connected agents after install gets no signal about why they
    # are absent. install-dpf.sh already warns in this case; match it.
    $seedScript = Join-Path $DPF_DIR "scripts\seed-worktree-mcp.ps1"
    if (Test-Path $seedScript) {
        Write-Action "Seeding MCP token to worktrees..."
        try {
            & $seedScript
        } catch {
            Write-Warn "MCP seed step encountered an issue (non-fatal): $_"
        }
    } else {
        Write-Warn "scripts\seed-worktree-mcp.ps1 not found; skipping MCP token seeding."
    }

    # Converge the agent toolchain (Claude + Codex + kernel memory + state).
    $bootstrapScript = Join-Path $DPF_DIR "scripts\dpf-bootstrap-agent-toolchain.ps1"
    if (Test-Path $bootstrapScript) {
        Write-Action "Converging DPF agent toolchain..."
        try {
            & $bootstrapScript -RepoRoot $DPF_DIR
        } catch {
            Write-Warn "Agent toolchain bootstrap encountered an issue (non-fatal): $_"
        }
    } else {
        Write-Warn "scripts\dpf-bootstrap-agent-toolchain.ps1 not found; skipping agent toolchain convergence."
        Write-Warn "Agent CLIs (Claude Code / Codex) will NOT be wired to this install's MCP endpoint."
        Write-Warn "To connect one later: Admin > Platform Development > MCP, issue a token, then add the"
        Write-Warn "'dpf' server to your agent client's config using that token."
    }
    Save-Progress "mcp_seed"
}
} else {
    Write-OK "Already running"
}

# Edge is an explicit, persistent capability choice. Once enabled, every
# governed install/repair converges the native service and verified binary;
# the progress marker is evidence of a past success, not a skip condition.
$edgeStateLib = Join-Path $DPF_DIR "scripts\installer\lib\state.ps1"
if (-not (Test-Path -LiteralPath $edgeStateLib)) { throw "capability_state_helper_missing" }
. $edgeStateLib
if ($WithEdge) { $env:DPF_INCLUDE_EDGE = '1' }
elseif ($NoEdge) { $env:DPF_INCLUDE_EDGE = '0' }
$dpfEdgeOptIn = Resolve-DpfEdgeEnabled -InstallDir $DPF_DIR
Set-DpfStateValue -Key "edge" -Value @{ enabled = $dpfEdgeOptIn; mode = $(if ($dpfEdgeOptIn) { "local" } else { $null }) }
if ($dpfEdgeOptIn) {
    if (Invoke-DPFEdgeNodeConvergence -InstallDir $DPF_DIR) {
        Save-Progress "edge_bootstrap"
    } else {
        Write-Warn "Bundled Edge Node convergence did not complete. The portal remains usable."
    }
} elseif (-not $dpfEdgeOptIn) {
    Write-OK "Edge Node not bundled (opt-in). Re-run with -WithEdge to add a local node, or add a node on another machine from Admin > Platform Development > Edge Nodes."
}

# --- Step 7: Wait for AI Model -------------------------------------------------

Write-Step 8 10 "Setting up your AI Coworker..."
if (-not (Test-StepDone "model")) {
    # Pull model via Docker Model Runner (built into Docker Desktop 4.40+).
    #
    # Docker Model Runner is DISABLED by default in fresh Docker Desktop
    # installs. Without explicitly enabling it first, `docker model pull`
    # fails with "Docker Model Runner is not running" -- but the exit code
    # behavior is inconsistent across versions, so the user ends up with
    # .selected-model set, no actual model on disk, and the portal's
    # AI Coworker silently broken ("AI provider is temporarily unavailable"
    # on first portal load). Enabling is idempotent -- no-op if already on.
    Write-Action "Enabling Docker Model Runner..."
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    docker desktop enable model-runner 2>&1 | Out-Null
    $enableExit = $LASTEXITCODE
    $ErrorActionPreference = $oldEAP

    if ($enableExit -ne 0) {
        Write-Warn "Could not enable Docker Model Runner automatically."
        Write-Warn "Requires Docker Desktop 4.40+. Enable manually: Settings -> AI -> Enable Docker Model Runner"
        Write-Warn "Then re-run this installer."
    } else {
        # Enable GPU-backed inference. Docker Desktop ships this OFF by default
        # Without it, llama-server processes run on CPU + system RAM instead
        # of VRAM, inference is 10-50x slower, and every downstream operation
        # (probes, coworker calls, model evals) silently degrades. The
        # `docker desktop enable model-runner --gpu enable` subcommand is
        # idempotent and a no-op on hosts without a compatible GPU.
        # See docs/superpowers/specs/2026-05-23-first-run-customer-experience-hardening-design.md.
        #
        # Read GPU detection from .host-profile.json (written in Step 6) so we
        # work correctly on installer re-runs where $gpuName is out of scope.
        $detectedGpu = $null
        $hostProfilePath = "$DPF_DIR\.host-profile.json"
        if (Test-Path $hostProfilePath) {
            try {
                $detectedGpu = (Get-Content $hostProfilePath -Raw | ConvertFrom-Json).gpuName
            } catch {}
        }
        if ($detectedGpu) {
            Write-Action "Enabling GPU-backed inference (detected $detectedGpu)..."
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            docker desktop enable model-runner --gpu enable 2>&1 | Out-Null
            $gpuEnableExit = $LASTEXITCODE
            $ErrorActionPreference = $oldEAP
            if ($gpuEnableExit -ne 0) {
                Write-Warn "Could not enable GPU-backed inference automatically."
                Write-Warn "Inference will fall back to CPU + system RAM (10-50x slower)."
                Write-Warn "Enable manually: Settings -> AI -> Enable GPU-backed inference"
            }
        } else {
            Write-Action "No compatible GPU detected; using CPU inference."
        }

        # Wait briefly for Model Runner to come up before pulling.
        $mrReady = $false
        for ($i = 0; $i -lt 15; $i++) {
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            docker model list 2>&1 | Out-Null
            $listExit = $LASTEXITCODE
            $ErrorActionPreference = $oldEAP
            if ($listExit -eq 0) { $mrReady = $true; break }
            Start-Sleep -Seconds 2
        }
    }

    # Only attempt the pull when Model Runner actually responded. When the
    # `docker model` CLI is absent (Docker Desktop too old) or not yet running,
    # attempting it would leak the raw `docker: 'model' is not a docker command`
    # error and a misleading "may have failed" (#1767); skip cleanly instead.
    if ($mrReady) {
    Write-Action "Pulling AI model $selectedModel via Docker Model Runner, these may be big..."
    Write-Action "This may take several minutes depending on your internet speed, and size of your video card."
    # Name accuracy: pull with ai/ form; Docker registers under short form (no ai/).
    # After pull, normalize $selectedModel + the .host-profile.json / .selected-model
    # files to the runtime name so that portal /v1/models discovery and inference
    # references match exactly what the model-runner serves (prevents "model not found"
    # in inference.model-manager even when pull was executed).
    #
    $pullName = $selectedModel
    $runtimeModel = $pullName -replace '^ai/',''
    # Expected size upfront (manifest only) so user with known bandwidth can estimate duration.
    $sizeMB = 0
    try {
        $mani = docker manifest inspect $pullName 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
        $total = 0
        if ($mani -and $mani.layers) { $mani.layers | ForEach-Object { if ($_.size) { $total += [int64]$_.size } } }
        if ($mani -and $mani.config -and $mani.config.size) { $total += [int64]$mani.config.size }
        if ($total -gt 0) { $sizeMB = [int]($total / 1MB) }
    } catch {}
    if ($sizeMB -gt 0) {
        Write-Action "  Expected download size: ~${sizeMB}MB. If you know your internet speed you can estimate how long the pull will take."
    }
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    docker model pull $pullName 2>&1
    $pullExit = $LASTEXITCODE
    $ErrorActionPreference = $oldEAP
    # Ground truth: re-check docker model list for the runtime name (more reliable
    # than exit code alone across Docker Desktop versions).
    $isPresent = $false
    try {
        $listed = docker model list 2>&1 | Select-Object -Skip 1 | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ -eq $runtimeModel }
        if ($listed) { $isPresent = $true }
    } catch {}
    if ($isPresent) {
        $selectedModel = $runtimeModel
        # Persist the accurate runtime name for compose env + portal-init host_profile
        $selectedModel | Set-Content "$DPF_DIR\.selected-model" -ErrorAction SilentlyContinue
        $hpPath = "$DPF_DIR\.host-profile.json"
        if (Test-Path $hpPath) {
            try {
                $hp = Get-Content $hpPath -Raw | ConvertFrom-Json
                $hp.selectedModel = $selectedModel
                $hp | ConvertTo-Json -Compress | Set-Content $hpPath
            } catch {}
        }
        Write-OK "AI Coworker is ready ($selectedModel)"
    } elseif ($pullExit -ne 0) {
        Write-Warn "Model pull may have failed. Check: docker model list"
        Write-Warn "You can pull manually later: docker model pull $pullName"
    } else {
        Write-Warn "Model pull reported success but $runtimeModel not listed; retry: docker model pull $pullName"
    }
    } else {
        # Model Runner never became ready. Distinguish "CLI absent" (Docker
        # Desktop too old) from "present but not started" so we give the right
        # guidance and never leak the raw `docker: 'model' is not a docker
        # command` error by attempting a pull that cannot succeed (#1767). The
        # portal still installs; AI features activate once a model is available.
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        docker model --help 2>&1 | Out-Null
        $hasModelCmd = ($LASTEXITCODE -eq 0)
        $ErrorActionPreference = $oldEAP
        if ($hasModelCmd) {
            Write-Warn "Docker Model Runner isn't running yet; skipping the AI model download."
            Write-Warn "Pull it later once Docker Desktop is ready: docker model pull $selectedModel"
        } else {
            Write-Warn "Docker Model Runner isn't available (requires Docker Desktop 4.40+); skipping the AI model download."
            Write-Warn "Update Docker Desktop, then re-run this installer. The portal still works without it."
        }
    }
    Save-Progress "model"
} else {
    Write-OK "Already set up"
}

# Validate the same canonical host state path exposed to the portal and promoter.
$stateValidator = Join-Path $DPF_DIR "scripts\installer\validate-install-state.mjs"
& node $stateValidator (Get-DpfStatePath)
if ($LASTEXITCODE -ne 0) { throw "Install state is not upgrade-ready" }

# --- Step 8: Open Browser -----------------------------------------------------

Write-Step 9 10 "Configuring auto-start on logon..."
if (-not (Test-StepDone "autostart")) {
    if (Register-DPFStartupTask -taskName $AUTOSTART_TASK_NAME -startScriptPath "$DPF_DIR\dpf-start.ps1") {
        Save-Progress "autostart"
    }
} else {
    Write-OK "Already configured"
}

Write-Step 10 10 "Opening your portal!"

# Read admin password from .env
$adminPass = (Get-Content "$DPF_DIR\.env" | Where-Object { $_ -match "^ADMIN_PASSWORD=" }) -replace "^ADMIN_PASSWORD=", ""

Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "  ========================================================" -ForegroundColor Green
Write-Host "  |  Your Digital Product Factory is ready!              |" -ForegroundColor Green
Write-Host "  |                                                      |" -ForegroundColor Green
Write-Host "  |  URL:      http://localhost:3000                     |" -ForegroundColor Green
Write-Host "  |  Email:    admin@dpf.local                           |" -ForegroundColor Green
Write-Host "  |  Password: $($adminPass.PadRight(40))|" -ForegroundColor Green
Write-Host "  |                                                      |" -ForegroundColor Green
Write-Host "  |  Save this password -- it won't be shown again!      |" -ForegroundColor Green
Write-Host "  |                                                      |" -ForegroundColor Green
Write-Host "  |  To stop:  Open PowerShell, run: dpf-stop            |" -ForegroundColor Green
Write-Host "  |  To start: Open PowerShell, run: dpf-start           |" -ForegroundColor Green
Write-Host "  |                                                      |" -ForegroundColor Green
Write-Host "  |  System Health: Operations > System Health tab        |" -ForegroundColor Green
if ($InstallMode -eq "customizer") {
    Write-Host "  |                                                      |" -ForegroundColor Green
    Write-Host "  |  Local dev: cd $($DPF_DIR.PadRight(38))|" -ForegroundColor Cyan
    Write-Host "  |             pnpm dev                                 |" -ForegroundColor Cyan
    Write-Host "  |  Database exposed: postgres :5432                    |" -ForegroundColor Cyan
}
Write-Host "  ========================================================" -ForegroundColor Green

# Save credentials file
@"
Digital Product Factory -- Admin Credentials
============================================
URL:      http://localhost:3000
Email:    admin@dpf.local
Password: $adminPass

Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Change this password after first login!
"@ | Set-Content "$DPF_DIR\.admin-credentials"

