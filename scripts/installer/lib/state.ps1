# Install-state file management for the DPF Windows installer.
# Source this file (`. <path>`); do not execute directly.
#
# Reads, writes, and migrates %USERPROFILE%\.dpf\install-state.json. Schema
# lives at scripts/installer/install-state.schema.json. PowerShell sibling
# of scripts/installer/lib/state.sh.
#
# Per the deployment doctrine (Contract 2: runtime configuration; Contract 3:
# lifecycle). Plain ASCII only per AGENTS.md.

if ($script:DPF_LIB_STATE_PS1_LOADED -eq $true) {
    return
}
$script:DPF_LIB_STATE_PS1_LOADED = $true

# Current schema version this installer expects. Keep in sync with state.sh.
$script:DPF_STATE_SCHEMA_VERSION = 1

function Get-DpfStateDir {
    if ($env:DPF_STATE_DIR) { return $env:DPF_STATE_DIR }
    if ($env:XDG_STATE_HOME) { return (Join-Path $env:XDG_STATE_HOME "dpf") }
    $profileRoot = if ($HOME) { $HOME } else { $env:USERPROFILE }
    return (Join-Path $profileRoot ".dpf")
}

function Get-DpfStatePath {
    return (Join-Path (Get-DpfStateDir) "install-state.json")
}

function Get-DpfStateValidatorPath {
    return (Join-Path (Split-Path -Parent $PSScriptRoot) "validate-install-state.mjs")
}

function Test-DpfStateFileValid {
    param([Parameter(Mandatory)][string]$Path)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(2)
    do {
        & node (Get-DpfStateValidatorPath) $Path *> $null
        if ($LASTEXITCODE -eq 0) { return $true }
        Start-Sleep -Milliseconds 20
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    return $false
}

function Flush-DpfStateFile {
    param([Parameter(Mandatory)][string]$Path)
    $stream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try { $stream.Flush($true) } finally { $stream.Dispose() }
}

function Get-DpfStateSha256 {
    param([Parameter(Mandatory)][string]$Path)
    $sha = [Security.Cryptography.SHA256]::Create(); $stream = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() } finally { $stream.Dispose(); $sha.Dispose() }
}

function Get-DpfActiveReclaimFirst {
    param([Parameter(Mandatory)][string]$LockPath)
    $active = @(); foreach ($ticket in Get-ChildItem -Path "$LockPath.reclaim-*" -File -ErrorAction SilentlyContinue) { try { $owner = ConvertFrom-Json ([IO.File]::ReadAllText($ticket.FullName)); $live = $false; if ($owner.hostname -eq [Environment]::MachineName) { try { Get-Process -Id ([int]$owner.pid) -ErrorAction Stop | Out-Null; $live = $true } catch {} }; if ([long]$owner.expiresAtEpoch -gt [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -or $live) { $active += $ticket.FullName } else { Remove-Item $ticket.FullName -Force } } catch {} }
    return ($active | Sort-Object | Select-Object -First 1)
}

function Get-DpfStringSha256 {
    param([string]$Value)
    $sha = [Security.Cryptography.SHA256]::Create(); try { $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($Value); return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant() } finally { $sha.Dispose() }
}

function Remove-DpfStateTempLeftovers {
    param([string]$Path)
    $directory = Split-Path -Parent $Path; $leaf = Split-Path -Leaf $Path
    Get-ChildItem -Path (Join-Path $directory ".$leaf.tmp-*") -File -ErrorAction SilentlyContinue | Remove-Item -Force
}

function Replace-DpfStateFileAtomic {
    param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Destination)
    $method = [IO.File].GetMethod("Replace", [type[]]@([string], [string], [string]))
    [object[]]$arguments = @($Source, $Destination, $null)
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(2)
    while ($true) {
        try { $method.Invoke($null, $arguments) | Out-Null; return }
        catch {
            if ([DateTimeOffset]::UtcNow -ge $deadline) { throw "install_state_atomic_replace_failed: $($_.Exception.InnerException.Message)" }
            Start-Sleep -Milliseconds 20
        }
    }
}

function Enter-DpfStateLock {
    param([Parameter(Mandatory)][string]$Path)
    $lockPath = "$Path.lock"; $ownerId = [guid]::NewGuid().ToString(); $runId = if ($env:DPF_RUN_ID) { $env:DPF_RUN_ID } else { [guid]::NewGuid().ToString() }
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
    while ($true) {
        if (Get-DpfActiveReclaimFirst $lockPath) { if ([DateTimeOffset]::UtcNow -ge $deadline) { throw "install_state_lock_timeout" }; Start-Sleep -Milliseconds 20; continue }
        try {
            $now = [DateTimeOffset]::UtcNow
            $owner = [ordered]@{ protocolVersion = 1; ownerId = $ownerId; runId = $runId; pid = $PID; hostname = [Environment]::MachineName; acquiredAt = $now.ToString("o"); expiresAt = $now.AddSeconds(30).ToString("o"); expiresAtEpoch = $now.AddSeconds(30).ToUnixTimeSeconds() }
            $ownerPath = $lockPath; $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($owner | ConvertTo-Json -Compress))
            $claim = New-Object IO.FileStream($ownerPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $claim.Write($bytes, 0, $bytes.Length); $claim.Flush($true) } finally { $claim.Dispose() }
            if (Get-DpfActiveReclaimFirst $lockPath) { Remove-Item -LiteralPath $lockPath -Force; Start-Sleep -Milliseconds 20; continue }
            $script:DPF_STATE_LOCK_OWNER_ID = $ownerId
            return
        } catch {
            $ownerPath = $lockPath; $stale = $false
            if (Test-Path -LiteralPath $ownerPath) {
                try {
                    $owner = ConvertFrom-Json ([IO.File]::ReadAllText($ownerPath)); $nowEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                    $live = $false
                    if ($owner.hostname -eq [Environment]::MachineName) { try { Get-Process -Id ([int]$owner.pid) -ErrorAction Stop | Out-Null; $live = $true } catch {} }
                    $stale = ([long]$owner.expiresAtEpoch -le $nowEpoch -and -not $live)
                } catch {}
            }
            if ($stale) {
                $createdReclaim = $false
                try {
                    $staleOwnerId = [string]$owner.ownerId; $generation = (Get-DpfStringSha256 $staleOwnerId).Substring(0,24); $reclaimPath = "$lockPath.reclaim-$generation"
                    $reclaim = New-Object IO.FileStream($reclaimPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                    $createdReclaim = $true; $reclaimOwner = [ordered]@{ protocolVersion = 1; ownerId = $ownerId; runId = $runId; targetOwnerId = $staleOwnerId; pid = $PID; hostname = [Environment]::MachineName; acquiredAt = [DateTimeOffset]::UtcNow.ToString("o"); expiresAt = [DateTimeOffset]::UtcNow.AddSeconds(5).ToString("o"); expiresAtEpoch = [DateTimeOffset]::UtcNow.AddSeconds(5).ToUnixTimeSeconds() }
                    $reclaimBytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($reclaimOwner | ConvertTo-Json -Compress)); try { $reclaim.Write($reclaimBytes,0,$reclaimBytes.Length); $reclaim.Flush($true) } finally { $reclaim.Dispose() }
                    $current = ConvertFrom-Json ([IO.File]::ReadAllText($lockPath)); if ($current.ownerId -eq $staleOwnerId -and [long]$current.expiresAtEpoch -le [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) { Move-Item -LiteralPath $lockPath -Destination "$lockPath.stale-$ownerId" -ErrorAction Stop; Remove-Item -LiteralPath "$lockPath.stale-$ownerId" -Force -ErrorAction Stop }
                    Remove-Item -LiteralPath $reclaimPath -Force -ErrorAction Stop; continue
                } catch { if ($createdReclaim -and $reclaimPath -and (Test-Path -LiteralPath $reclaimPath)) { Remove-Item $reclaimPath -Force -ErrorAction SilentlyContinue } }
            }
            if ([DateTimeOffset]::UtcNow -ge $deadline) { throw "install_state_lock_timeout" }
            Start-Sleep -Milliseconds 20
        }
    }
}

function Exit-DpfStateLock {
    param([Parameter(Mandatory)][string]$Path)
    $lockPath = "$Path.lock"; $ownerPath = $lockPath
    try { $owner = ConvertFrom-Json ([IO.File]::ReadAllText($ownerPath)); if ($owner.ownerId -eq $script:DPF_STATE_LOCK_OWNER_ID) { Remove-Item -LiteralPath $ownerPath -Force } } catch {}
}

function Write-DpfStateCandidate {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Json, [string]$SourceSha256)
    Remove-DpfStateTempLeftovers $Path
    $temp = Join-Path (Split-Path -Parent $Path) ("." + (Split-Path -Leaf $Path) + ".tmp-" + $script:DPF_STATE_LOCK_OWNER_ID); $encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($temp, $Json, $encoding); Flush-DpfStateFile $temp
    if (-not (Test-DpfStateFileValid $temp)) { Remove-Item -LiteralPath $temp -Force; throw "install_state_schema_validation_failed" }
    if ($SourceSha256) {
        $owner = ConvertFrom-Json ([IO.File]::ReadAllText("$Path.lock"))
        if ($owner.ownerId -ne $script:DPF_STATE_LOCK_OWNER_ID) { Remove-Item -LiteralPath $temp -Force; throw "install_state_lock_ownership_lost expected=$script:DPF_STATE_LOCK_OWNER_ID observed=$($owner.ownerId) pid=$($owner.pid) expires=$($owner.expiresAtEpoch)" }
        $observedSha256 = Get-DpfStateSha256 $Path
        if ($observedSha256 -ne $SourceSha256) { Remove-Item -LiteralPath $temp -Force; throw "install_state_cas_mismatch expected=$SourceSha256 observed=$observedSha256 owner=$($owner.ownerId)" }
    }
    if (Test-Path -LiteralPath $Path) { Replace-DpfStateFileAtomic $temp $Path } else { [IO.File]::Move($temp, $Path) }
    if (-not (Test-DpfStateFileValid $Path)) { throw "install_state_post_write_schema_validation_failed" }
}

# Initialize a fresh state file at the canonical path. Idempotent.
# Args: $InstallerVersion, $InstallPath
function Initialize-DpfState {
    param(
        [string]$InstallerVersion = "unknown",
        [string]$InstallPath = (Get-Location).Path
    )

    $stateDir = Get-DpfStateDir
    $path = Get-DpfStatePath

    if (-not (Test-Path -LiteralPath $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }

    Enter-DpfStateLock $path
    try {
    if (Test-Path -LiteralPath $path) { return }
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()

    $initial = [ordered]@{
        schemaVersion                = $script:DPF_STATE_SCHEMA_VERSION
        installerVersion             = $InstallerVersion
        lastSuccessfulInstallVersion = $null
        lastSuccessfulComposeHash    = $null
        composeProjectName           = "dpf"
        enabledRuntimeCapabilities   = @()
        capabilityCatalogHash        = $null
        capabilityStateVersion       = $null
        platform                     = "win32"
        arch                         = $arch
        dockerContext                = $null
        dockerEndpoint               = $null
        installPath                  = $InstallPath
        stateDir                     = $stateDir
        composeFiles                 = @()
        edge                         = @{ enabled = $false; mode = $null }
        imageTag                     = $null
        llmProvider                  = $null
        resourceLabels               = @{ dpf = "true" }
        autostart                    = @{ enabled = $false; kind = "none" }
        lastHealthCheck              = $null
        lastBackupAt                 = $null
        lastDoctorBundlePath         = $null
    }

    $json = $initial | ConvertTo-Json -Depth 10
    Write-DpfStateCandidate -Path $path -Json $json
    } finally { Exit-DpfStateLock $path }
}

# Read the full state object. Returns $null if the file is absent.
function Read-DpfState {
    $path = Get-DpfStatePath
    if (-not (Test-Path -LiteralPath $path)) {
        return $null
    }
    $text = [System.IO.File]::ReadAllText($path)
    return ConvertFrom-Json $text
}

# Read a top-level key from the state file. Returns $null for missing keys
# or missing file.
function Get-DpfStateValue {
    param([Parameter(Mandatory)][string]$Key)

    $state = Read-DpfState
    if ($null -eq $state) { return $null }
    if ($state.PSObject.Properties.Name -notcontains $Key) { return $null }
    return $state.$Key
}

# Write a top-level key to the state file. Creates the file if missing.
# `$Value` is serialized with ConvertTo-Json so objects/arrays/booleans round-trip.
function Set-DpfStateValue {
    param(
        [Parameter(Mandatory)][string]$Key,
        [Parameter(Mandatory, ValueFromPipeline = $true)]$Value
    )

    $path = Get-DpfStatePath
    if (-not (Test-Path -LiteralPath $path)) { Initialize-DpfState }
    Enter-DpfStateLock $path
    try {
        $sourceSha256 = Get-DpfStateSha256 $path
        $state = Read-DpfState; $hashtable = @{}; foreach ($prop in $state.PSObject.Properties) { $hashtable[$prop.Name] = $prop.Value }; $hashtable[$Key] = $Value
        Write-DpfStateCandidate -Path $path -Json ($hashtable | ConvertTo-Json -Depth 20) -SourceSha256 $sourceSha256
    } finally { Exit-DpfStateLock $path }
}

# Resolve and, for a previous-release state, atomically persist the canonical
# capability snapshot. The Node adapter is the sole owner of capability-to-
# profile/service resolution; PowerShell only transports its JSON result.
function Resolve-DpfCapabilityComposeProfiles {
    param(
        [string]$InstallDir = (Get-Location).Path,
        [string[]]$Overlay = @(),
        [string[]]$Alias = @()
    )
    $adapter = Join-Path $InstallDir "scripts\lib\resolve-capability-compose-profiles.mjs"
    if (-not (Test-Path -LiteralPath $adapter)) { throw "capability_profile_adapter_missing" }
    Initialize-DpfState -InstallPath $InstallDir
    $arguments = @($adapter, "--state", (Get-DpfStatePath), "--host", "windows", "--migrate", "--write")
    foreach ($item in $Overlay) { $arguments += @("--overlay", $item) }
    foreach ($item in $Alias) { $arguments += @("--alias", $item) }
    $json = & node @arguments
    if ($LASTEXITCODE -ne 0) { throw "capability_profile_resolution_failed" }
    return ($json | ConvertFrom-Json)
}

function Get-DpfCapabilityProfileArgs {
    param([Parameter(Mandatory)]$Projection)
    $result = @()
    foreach ($profile in $Projection.composeProfiles) { $result += @("--profile", [string]$profile) }
    return $result
}

# Validate the state file's schema version.
# Returns:
#   0 - matches the installer's expected version
#   1 - state file is from a newer installer (refuse)
#   2 - no state file (fresh install)
#   3 - older schema; caller should run migration
function Test-DpfStateSchema {
    $path = Get-DpfStatePath
    if (-not (Test-Path -LiteralPath $path)) {
        return 2
    }
    $fileVer = Get-DpfStateValue -Key "schemaVersion"
    if ($null -eq $fileVer) {
        Write-Warning "state.ps1: state file at $path has no schemaVersion; treating as fresh."
        return 2
    }
    if ($fileVer -gt $script:DPF_STATE_SCHEMA_VERSION) {
        Write-Warning "state.ps1: state file is from a newer installer (schema $fileVer > $($script:DPF_STATE_SCHEMA_VERSION)). Update install-dpf.ps1 and re-run."
        return 1
    }
    if ($fileVer -lt $script:DPF_STATE_SCHEMA_VERSION) {
        return 3
    }
    return 0
}

# Resolve whether the bundled local Edge Node overlay should be active for THIS
# install (the deploy gate, BI-72CFF89D / edge-topology design section 5). Edge
# deployment is OPT-IN: default OFF unless explicitly chosen or grandfathered.
# PowerShell sibling of dpf_resolve_edge_enabled in state.sh. Precedence:
#   1. explicit $env:DPF_INCLUDE_EDGE=0|1 (callers/flags set this)
#   2. recorded choice in install-state.json (.edge.enabled)
#   3. grandfather: no recorded choice but .env carries a bundled-node
#      bootstrap token (a pre-flip install) -> keep it ON (design section 5.3)
#   4. default OFF
# Returns [bool]. $InstallDir is the install root (for .env grandfather check).
function Resolve-DpfEdgeEnabled {
    param([string]$InstallDir = (Get-Location).Path)

    if ($env:DPF_INCLUDE_EDGE -eq '1') { return $true }
    if ($env:DPF_INCLUDE_EDGE -eq '0') { return $false }

    $edge = Get-DpfStateValue -Key 'edge'
    if ($null -ne $edge -and $null -ne $edge.enabled) { return [bool]$edge.enabled }

    $envPath = Join-Path $InstallDir ".env"
    if (Test-Path -LiteralPath $envPath) {
        if (Select-String -Path $envPath -Pattern '^DPF_BOOTSTRAP_TOKEN=dpf' -Quiet) {
            return $true
        }
    }
    return $false
}
