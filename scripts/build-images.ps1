#requires -Version 5.1
<#
.SYNOPSIS
  Build dpf-portal / dpf-portal-init / dpf-sandbox images with the current
  git HEAD stamped into /app/.dpf-image-version.

.DESCRIPTION
  Wraps `docker compose build` so DPF_VERSION is always set to the full git
  SHA of the working tree's HEAD. Without this wrapper, concurrent worktrees
  building from divergent checkouts can each tag :latest and silently
  overwrite each other; the resulting image's source identity is then
  unrecoverable. With this wrapper, /api/platform/image-version always
  reports a comparable SHA.

.PARAMETER NoCache
  Pass --no-cache to docker compose build. Slower but bypasses BuildKit
  cache (use when you suspect a cache-poisoning regression).

.PARAMETER Services
  Specific services to build. Defaults to: portal portal-init.

.EXAMPLE
  scripts\build-images.ps1
  scripts\build-images.ps1 -NoCache
  scripts\build-images.ps1 -Services portal,sandbox
#>
[CmdletBinding()]
param(
  [switch]$NoCache,
  [string[]]$Services = @("portal", "portal-init")
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
Write-Host "[build-images] Stamping images with DPF_VERSION=$sha"

$buildArgs = @("compose", "build")
if ($NoCache) { $buildArgs += "--no-cache" }
$buildArgs += $Services

& docker @buildArgs
exit $LASTEXITCODE
