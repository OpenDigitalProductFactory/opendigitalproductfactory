# Host-side convergence for an existing install (BI-084F85E5).
#
# A self-upgrade replaces containers and the verified release assets in the
# install directory; it cannot install a host service. The consumer start
# script (a release asset, run by the logon task) calls Invoke-DPFHostConvergence
# once the portal is healthy, so the native host-upkeep agent (BI-28EFE18A)
# reaches every install and follows each release with no human step. The
# installer uses the same token issuance, so there is one implementation.
#
# Every function here is idempotent and returns a status instead of throwing:
# a convergence failure is logged and never stops the platform from starting.
# Nothing here reboots or shuts down the host.

if (-not (Get-Command Write-Warn -ErrorAction SilentlyContinue)) {
    function Write-Warn { param([string]$Message) Write-Host "[!] $Message" -ForegroundColor Yellow }
}
if (-not (Get-Command Write-OK -ErrorAction SilentlyContinue)) {
    function Write-OK { param([string]$Message) Write-Host "[ok] $Message" -ForegroundColor Green }
}

function Get-DPFHostStateRoot {
    if ($env:DPF_STATE_DIR) { return $env:DPF_STATE_DIR }
    return (Join-Path $env:USERPROFILE ".dpf")
}

function Write-DPFHostConvergenceLog {
    param([Parameter(Mandatory)][string]$Message)
    try {
        $logDir = Join-Path (Get-DPFHostStateRoot) "logs"
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
        $line = "{0} {1}" -f ([DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")), $Message
        Add-Content -LiteralPath (Join-Path $logDir "host-convergence.log") -Value $line -Encoding ASCII
    } catch {}
}

# The release this install runs, as recorded by the verified asset install.
# Customizer (source) installs carry no record and follow "latest".
function Get-DPFInstalledReleaseVersion {
    param([Parameter(Mandatory)][string]$InstallDir)
    $path = Join-Path $InstallDir ".verified-release-assets-version"
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $value = ([IO.File]::ReadAllText($path)).Trim()
        if ($value -match '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { return $value }
    }
    return "latest"
}

function Get-DPFNativeEdgeMarkerPath {
    return (Join-Path (Get-DPFHostStateRoot) "edge-node\installed-version")
}

# Current means the agent's scheduled task exists and was installed for this
# release and role. Anything else (no task, an older release, another role)
# is converged again.
function Test-DPFNativeEdgeCurrent {
    param([Parameter(Mandatory)][string]$Version, [Parameter(Mandatory)][string]$Role)
    if (-not (Get-ScheduledTask -TaskName "DPF-Native-Edge-Node" -ErrorAction SilentlyContinue)) { return $false }
    $marker = Get-DPFNativeEdgeMarkerPath
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { return $false }
    return (([IO.File]::ReadAllText($marker)).Trim() -ceq "$Version|$Role")
}

# Mint a single-use auto-approve enrollment token inside the portal container.
# Returns the token, or "" when issuance failed.
function New-DPFEdgeBootstrapToken {
    param([string]$PortalContainer = "dpf-portal-1")
    try {
        $output = docker exec $PortalContainer sh -c 'cd /app/apps/web-src && /app/node_modules/.pnpm/node_modules/.bin/tsx scripts/issue-edge-bootstrap-token.ts --ttl-minutes 30 --auto-approve' 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $output) { return "" }
        # @() around the pipeline: one output line must stay an array, or
        # $lines[-1] would index the string's last character.
        $lines = @(@($output) | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ -ne "" })
        $candidate = if ($lines.Count -gt 0) { $lines[-1] } else { "" }
        if ($candidate -match "^dpfboot_") { return $candidate }
    } catch {}
    return ""
}

function Resolve-DPFPortalContainer {
    param([string[]]$ComposeArgs = @())
    try {
        if ($ComposeArgs.Count -gt 0) {
            $id = (docker compose @ComposeArgs ps -q portal 2>$null) -split "`n" | Select-Object -First 1
            if ($id) { return $id.Trim() }
        }
    } catch {}
    return "dpf-portal-1"
}

# Returns one of: current, converged, token-failed, module-missing, failed.
function Invoke-DPFHostConvergence {
    param(
        [Parameter(Mandatory)][string]$InstallDir,
        [ValidateSet("full", "host-upkeep")][string]$Role = "host-upkeep",
        [string]$Version
    )
    try {
        if (-not $Version) { $Version = Get-DPFInstalledReleaseVersion -InstallDir $InstallDir }
        if (Test-DPFNativeEdgeCurrent -Version $Version -Role $Role) {
            Write-DPFHostConvergenceLog "current version=$Version role=$Role"
            return "current"
        }
        $edgeModule = Join-Path $InstallDir "scripts\installer\native-edge-host.ps1"
        if (-not (Test-Path -LiteralPath $edgeModule -PathType Leaf)) {
            Write-DPFHostConvergenceLog "module-missing path=$edgeModule"
            return "module-missing"
        }
        . $edgeModule

        $token = ""
        $enrolled = Test-Path -LiteralPath (Join-Path (Get-DPFHostStateRoot) "edge-node\state.json")
        if (-not $enrolled) {
            $composeArgs = @()
            if (Get-Command Get-DPFComposeArgs -ErrorAction SilentlyContinue) {
                $composeArgs = Get-DPFComposeArgs -InstallDir $InstallDir -IncludeEdge:$false
            }
            $token = New-DPFEdgeBootstrapToken -PortalContainer (Resolve-DPFPortalContainer -ComposeArgs $composeArgs)
            if (-not $token) {
                Write-DPFHostConvergenceLog "token-failed version=$Version role=$Role"
                return "token-failed"
            }
        }

        if (Install-DPFNativeEdgeNode -InstallDir $InstallDir -BootstrapToken $token -Version $Version -Role $Role) {
            $marker = Get-DPFNativeEdgeMarkerPath
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $marker) | Out-Null
            [IO.File]::WriteAllText($marker, "$Version|$Role", [Text.Encoding]::ASCII)
            Write-DPFHostConvergenceLog "converged version=$Version role=$Role"
            return "converged"
        }
        Write-DPFHostConvergenceLog "failed version=$Version role=$Role reason=install-returned-false"
        return "failed"
    } catch {
        Write-DPFHostConvergenceLog "failed version=$Version role=$Role reason=$($_.Exception.Message)"
        return "failed"
    }
}
