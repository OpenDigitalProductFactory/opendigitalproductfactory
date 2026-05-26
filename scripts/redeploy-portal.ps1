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

.PARAMETER ComposeEnvFile
  Optional Docker Compose env file. Defaults to $env:DPF_COMPOSE_ENV_FILE,
  then this checkout's .env, then D:\DPF\.env when present.

.EXAMPLE
  scripts\redeploy-portal.ps1
  scripts\redeploy-portal.ps1 -NoCache
  scripts\redeploy-portal.ps1 -ComposeEnvFile D:\DPF\.env
#>
[CmdletBinding()]
param(
  [switch]$NoCache,
  [string]$ComposeEnvFile = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = git rev-parse --show-toplevel
if (-not $repoRoot) {
  Write-Error "Not inside a git working tree."
  exit 1
}
Set-Location $repoRoot

function Resolve-ComposeEnvFile {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [string]$RequestedPath
  )

  if ($RequestedPath) {
    if (-not (Test-Path -LiteralPath $RequestedPath)) {
      Write-Error "Compose env file not found: $RequestedPath"
      exit 1
    }
    return (Resolve-Path -LiteralPath $RequestedPath).Path
  }

  if ($env:DPF_COMPOSE_ENV_FILE) {
    if (-not (Test-Path -LiteralPath $env:DPF_COMPOSE_ENV_FILE)) {
      Write-Error "DPF_COMPOSE_ENV_FILE points to a missing file: $env:DPF_COMPOSE_ENV_FILE"
      exit 1
    }
    return (Resolve-Path -LiteralPath $env:DPF_COMPOSE_ENV_FILE).Path
  }

  $repoEnv = Join-Path $Root ".env"
  if (Test-Path -LiteralPath $repoEnv) {
    return (Resolve-Path -LiteralPath $repoEnv).Path
  }

  $defaultWindowsInstallEnv = "D:\DPF\.env"
  if (Test-Path -LiteralPath $defaultWindowsInstallEnv) {
    return (Resolve-Path -LiteralPath $defaultWindowsInstallEnv).Path
  }

  return $null
}

$composeEnvFile = Resolve-ComposeEnvFile -Root $repoRoot -RequestedPath $ComposeEnvFile
$composeArgs = @("compose")
if ($composeEnvFile) {
  Write-Host "[redeploy-portal] Using Compose env file: $composeEnvFile"
  $composeArgs += @("--env-file", $composeEnvFile)
}

$sha = git rev-parse HEAD
if (-not $sha) {
  Write-Error "Failed to resolve git HEAD."
  exit 1
}

$env:DPF_VERSION = $sha
Write-Host "[redeploy-portal] Building portal and portal-init with DPF_VERSION=$sha"

$buildArgs = $composeArgs + @("build")
if ($NoCache) { $buildArgs += "--no-cache" }
$buildArgs += @("portal", "portal-init")

& docker @buildArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[redeploy-portal] Recreating portal-init and portal from the built images"
$upArgs = $composeArgs + @("up", "-d", "--no-build", "--force-recreate", "portal-init", "portal")
& docker @upArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

function Get-ComposeContainerImage {
  param([Parameter(Mandatory = $true)][string]$Service)

  $psArgs = $composeArgs + @("ps", "-q", $Service)
  $containerId = (& docker @psArgs).Trim()
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
