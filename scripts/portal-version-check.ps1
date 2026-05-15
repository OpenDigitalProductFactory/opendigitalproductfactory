#requires -Version 5.1
<#
.SYNOPSIS
  Compare the running portal's stamped image version to the local
  origin/main HEAD, and report whether the served image is current.

.DESCRIPTION
  Calls GET /api/platform/image-version on the running portal (default:
  http://localhost:3000) to learn what source identity the image carries.
  Compares to `git rev-parse origin/main` from the local checkout and prints
  a drift report.

  Three outcomes:
    - match               served image == origin/main; exit 0
    - drift               served image != origin/main (stale or ahead); exit 1
    - incomparable        image was built without DPF_VERSION (content-hash
                          fallback); exit 2
    - unreachable         portal not serving / no version file; exit 3

  Use this after a deploy/rebuild to confirm the running container is
  actually serving the code you just merged. The fast way to catch the
  multi-worktree :latest-clobber bug.

.PARAMETER PortalUrl
  Base URL of the portal. Defaults to http://localhost:3000.

.EXAMPLE
  scripts\portal-version-check.ps1
  scripts\portal-version-check.ps1 -PortalUrl http://192.168.0.200:3000
#>
[CmdletBinding()]
param(
  [string]$PortalUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

$endpoint = "$($PortalUrl.TrimEnd('/'))/api/platform/image-version"
try {
  $response = Invoke-RestMethod -Uri $endpoint -TimeoutSec 5 -ErrorAction Stop
} catch {
  Write-Host "[version-check] Portal unreachable at $endpoint - $($_.Exception.Message)"
  exit 3
}

if (-not $response.present) {
  Write-Host "[version-check] Portal reports no .dpf-image-version file (not a built image)."
  exit 3
}

$expected = git rev-parse origin/main 2>$null
if (-not $expected) {
  Write-Host "[version-check] Unable to resolve origin/main locally; cannot compare."
  Write-Host "[version-check] Portal reports: $($response.version) (source=$($response.source))"
  exit 2
}

$expected = $expected.Trim()
Write-Host "[version-check] Portal image source : $($response.source)"
Write-Host "[version-check] Portal image version: $($response.version)"
Write-Host "[version-check] Local origin/main   : $expected"

if ($response.source -ne "git-sha") {
  Write-Host "[version-check] Image was built without DPF_VERSION (content-hash fallback) - cannot compare to a SHA. Rebuild with scripts/build-images.ps1 to stamp a git SHA."
  exit 2
}

if ($response.version.ToLower() -eq $expected.ToLower()) {
  Write-Host "[version-check] MATCH - portal is serving origin/main."
  exit 0
}

Write-Host "[version-check] DRIFT - portal is NOT serving origin/main."
Write-Host "[version-check] Rebuild with: scripts\build-images.ps1 (then docker compose up -d portal portal-init)"
exit 1
