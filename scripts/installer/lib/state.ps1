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
    return (Join-Path $HOME ".dpf")
}

function Get-DpfStatePath {
    return (Join-Path (Get-DpfStateDir) "install-state.json")
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

    if (Test-Path -LiteralPath $path) {
        return
    }

    if (-not (Test-Path -LiteralPath $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }

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
    [System.IO.File]::WriteAllText($path, $json, [System.Text.Encoding]::UTF8)
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
    if (-not (Test-Path -LiteralPath $path)) {
        Initialize-DpfState
    }

    $state = Read-DpfState
    if ($null -eq $state) {
        throw "Set-DpfStateValue: state file missing after init at $path"
    }

    # Re-emit the entire state with the new key value to keep round-trip clean.
    $hashtable = @{}
    foreach ($prop in $state.PSObject.Properties) {
        $hashtable[$prop.Name] = $prop.Value
    }
    $hashtable[$Key] = $Value

    $json = $hashtable | ConvertTo-Json -Depth 20
    [System.IO.File]::WriteAllText($path, $json, [System.Text.Encoding]::UTF8)
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
# install (the deploy gate, BI-72CFF89D / edge-topology design §5). Edge
# deployment is OPT-IN: default OFF unless explicitly chosen or grandfathered.
# PowerShell sibling of dpf_resolve_edge_enabled in state.sh. Precedence:
#   1. explicit $env:DPF_INCLUDE_EDGE=0|1 (callers/flags set this)
#   2. recorded choice in install-state.json (.edge.enabled)
#   3. grandfather: no recorded choice but .env carries a bundled-node
#      bootstrap token (a pre-flip install) -> keep it ON (design §5.3)
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
