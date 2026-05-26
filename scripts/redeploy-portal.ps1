#requires -Version 5.1
<#
.SYNOPSIS
  Build and recreate the local portal-init and portal services together.

.DESCRIPTION
  Stamps the current git HEAD into DPF_VERSION, builds portal-init and portal
  from the same checkout, recreates both containers without rebuilding again,
  and verifies the resulting containers carry the same DPF version marker.

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

function Get-ComposeContainerId {
  param([Parameter(Mandatory = $true)][string]$Service)

  $psArgs = $composeArgs + @("ps", "-a", "-q", $Service)
  $containerId = (& docker @psArgs | Select-Object -First 1)
  if ($null -eq $containerId) {
    $containerId = ""
  } else {
    $containerId = $containerId.Trim()
  }
  if (-not $containerId) {
    Write-Error "No container found for compose service '$Service'."
    exit 1
  }

  return $containerId
}

function Get-ComposeContainerVersion {
  param([Parameter(Mandatory = $true)][string]$Service)

  $containerId = Get-ComposeContainerId -Service $Service
  $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "dpf-redeploy-$([guid]::NewGuid().ToString('N'))"
  $versionPath = Join-Path $tempDir "$Service.dpf-image-version"

  New-Item -ItemType Directory -Path $tempDir | Out-Null
  try {
    & docker cp "$containerId`:/app/.dpf-image-version" $versionPath
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $version = (Get-Content -Raw -LiteralPath $versionPath).Trim()
  } finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  if (-not $version) {
    Write-Error "Could not read .dpf-image-version for compose service '$Service'."
    exit 1
  }

  return $version
}

$portalVersion = Get-ComposeContainerVersion -Service "portal"
$portalInitVersion = Get-ComposeContainerVersion -Service "portal-init"

if ($portalVersion -ne $sha) {
  Write-Error "portal image version differs from build SHA. portal=$portalVersion expected=$sha"
  exit 1
}

if ($portalInitVersion -ne $sha) {
  Write-Error "portal-init image version differs from build SHA. portal-init=$portalInitVersion expected=$sha"
  exit 1
}

Write-Host "[redeploy-portal] portal and portal-init image versions match DPF_VERSION=$sha"
