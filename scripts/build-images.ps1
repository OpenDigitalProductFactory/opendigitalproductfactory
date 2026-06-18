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

# Real platform version from the repo's git release tags (e.g. "5.6.0" or
# "5.6.0-35-gbcaa30a8"). This is the authoritative version shown in the portal.
# BI-145214F0 - refresh tags first so a stale local tag cache doesn't silently
# bake the wrong release-line label into the image (the DPF_VERSION SHA stamp
# is unaffected by this; only the human-readable describe). Best-effort: a
# fetch failure (offline, auth) must not abort the build. Mirrors build-images.sh.
# try/catch is the PS equivalent of the bash "|| true": under PS 7.4+ a failed
# native command throws when ErrorActionPreference=Stop, so swallow it here.
try { git fetch --tags --force origin 2>$null } catch { }
$platformVersion = (git describe --tags --always 2>$null) -replace '^v',''
if ($platformVersion) {
  $env:DPF_PLATFORM_VERSION = $platformVersion
  Write-Host "[build-images] Stamping images with DPF_PLATFORM_VERSION=$platformVersion"
}

$buildArgs = @("compose", "build")
if ($NoCache) { $buildArgs += "--no-cache" }
$buildArgs += $Services

& docker @buildArgs
exit $LASTEXITCODE
