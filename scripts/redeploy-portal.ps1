#requires -Version 5.1
<#
.SYNOPSIS
  Build and recreate the local portal-init and portal services together.

.DESCRIPTION
  Stamps the current git HEAD into DPF_VERSION, builds portal-init and portal
  from the same checkout, recreates both containers without rebuilding again,
  and verifies the resulting containers reference the same image ID.

.PARAMETER NoCache
  Pass --no-cache to docker compose build.

.EXAMPLE
  scripts\redeploy-portal.ps1
  scripts\redeploy-portal.ps1 -NoCache
#>
[CmdletBinding()]
param(
  [switch]$NoCache
)

$ErrorActionPreference = "Stop"

$repoRoot = git rev-parse --show-toplevel
if (-not $repoRoot) {
  Write-Error "Not inside a git working tree."
  exit 1
}
Set-Location $repoRoot

$sha = git rev-parse HEAD
if (-not $sha) {
  Write-Error "Failed to resolve git HEAD."
  exit 1
}

$env:DPF_VERSION = $sha
Write-Host "[redeploy-portal] Building portal and portal-init with DPF_VERSION=$sha"

$buildArgs = @("compose", "build")
if ($NoCache) { $buildArgs += "--no-cache" }
$buildArgs += @("portal", "portal-init")

& docker @buildArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[redeploy-portal] Recreating portal-init and portal from the built images"
$upArgs = @("compose", "up", "-d", "--no-build", "--force-recreate", "portal-init", "portal")
& docker @upArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

function Get-ComposeContainerImage {
  param([Parameter(Mandatory = $true)][string]$Service)

  $containerId = (& docker compose ps -q $Service).Trim()
  if (-not $containerId) {
    Write-Error "No container found for compose service '$Service'."
    exit 1
  }

  $imageId = (& docker inspect -f '{{.Image}}' $containerId).Trim()
  if (-not $imageId) {
    Write-Error "Could not inspect image ID for compose service '$Service'."
    exit 1
  }

  return $imageId
}

$portalImage = Get-ComposeContainerImage -Service "portal"
$portalInitImage = Get-ComposeContainerImage -Service "portal-init"

if ($portalImage -ne $portalInitImage) {
  Write-Error "portal and portal-init image IDs differ. portal=$portalImage portal-init=$portalInitImage"
  exit 1
}

Write-Host "[redeploy-portal] portal and portal-init image IDs match: $portalImage"
