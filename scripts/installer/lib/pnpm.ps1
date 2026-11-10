# Repository-pinned pnpm prerequisite for the Windows customizable install.
function Initialize-DpfPnpm {
    param([Parameter(Mandatory)][string]$InstallDir)
    $packageManager = (Get-Content -LiteralPath (Join-Path $InstallDir 'package.json') -Raw | ConvertFrom-Json).packageManager
    if ($packageManager -notmatch '^pnpm@([0-9]+\.[0-9]+\.[0-9]+)(?:\+.*)?$') {
        throw 'Invalid pnpm packageManager pin.'
    }
    $version = $Matches[1]
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Host "Installing pnpm $version from the repository pin."
        & npm install -g "pnpm@$version"
        if ($LASTEXITCODE -ne 0) { throw 'Pinned pnpm installation failed.' }
    }
    $installed = & pnpm --version
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify pnpm version.' }
    if ([string]$installed -ne $version) {
        throw "pnpm $version is required; found $installed. Select the pinned version and retry."
    }
}
