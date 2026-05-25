Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$workflowPath = Join-Path $repoRoot ".github\workflows\publish-image.yml"
if (-not (Test-Path -LiteralPath $workflowPath)) {
    throw "Missing publish-image workflow at $workflowPath"
}

$workflow = Get-Content -Raw -LiteralPath $workflowPath

if ($workflow -notmatch 'tags:\s*\["v\*"\]') {
    throw "publish-image.yml must run on v* tag pushes."
}

foreach ($image in @(
    "dpf-portal",
    "dpf-sandbox",
    "dpf-promoter",
    "dpf-browser-use",
    "dpf-adp",
    "dpf-edge-node"
)) {
    if ($workflow -notmatch [regex]::Escape("- name: $image") -and $workflow -notmatch [regex]::Escape("- $image")) {
        throw "publish-image.yml is missing image matrix coverage for $image."
    }
}

foreach ($needle in @(
    "--tag `"`${IMAGE}:`${TAG}`"",
    "--tag `"`${IMAGE}:latest`"",
    '"architecture": "amd64"',
    '"architecture": "arm64"',
    "Run install-dpf.sh (release mode, --no-autostart for CI)",
    "bash install-dpf.sh --headless --release --no-autostart"
)) {
    if ($workflow -notmatch [regex]::Escape($needle)) {
        throw "publish-image.yml is missing release-image guard: $needle"
    }
}

Write-Host "PASS: publish-image.yml covers v* tag pushes, release images, multi-arch manifests, and release-mode install verification."
