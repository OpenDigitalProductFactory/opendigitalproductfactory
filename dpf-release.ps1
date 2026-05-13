param(
    [Parameter(Position=0)]
    [ValidateSet("major", "minor", "patch")]
    [string]$Bump = "minor"
)

# dpf-release.ps1 - Tag and push a production release
# Usage: .\dpf-release.ps1          (minor bump, e.g. v0.85.0 -> v0.86.0)
#        .\dpf-release.ps1 patch    (patch bump, e.g. v0.85.0 -> v0.85.1)
#        .\dpf-release.ps1 major    (major bump, e.g. v0.85.0 -> v1.0.0)
#
# Releases are tag-only. The tag is created on origin/main after a fetch so
# local branches, dirty files, and local-only main commits are not mutated.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-GitOrExit {
    param(
        [Parameter(Mandatory=$true)]
        [string[]]$Arguments,

        [Parameter(Mandatory=$true)]
        [string]$ErrorMessage
    )

    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: $ErrorMessage" -ForegroundColor Red
        exit 1
    }
}

function Get-GitOutputOrExit {
    param(
        [Parameter(Mandatory=$true)]
        [string[]]$Arguments,

        [Parameter(Mandatory=$true)]
        [string]$ErrorMessage
    )

    $output = & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: $ErrorMessage" -ForegroundColor Red
        exit 1
    }
    return $output
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptRoot
try {
    $insideWorkTree = (& git rev-parse --is-inside-work-tree 2>$null)
    if ($LASTEXITCODE -ne 0 -or $insideWorkTree -ne "true") {
        Write-Host "ERROR: dpf-release.ps1 must run inside a git working tree." -ForegroundColor Red
        exit 1
    }

    $currentBranch = (Get-GitOutputOrExit -Arguments @("rev-parse", "--abbrev-ref", "HEAD") -ErrorMessage "Could not read current branch.").Trim()

    Write-Host "Fetching origin/main and tags..." -ForegroundColor Cyan
    Invoke-GitOrExit -Arguments @("fetch", "--tags", "origin", "+refs/heads/main:refs/remotes/origin/main") -ErrorMessage "Could not fetch origin/main and tags."

    $releaseTarget = (Get-GitOutputOrExit -Arguments @("rev-parse", "--verify", "refs/remotes/origin/main") -ErrorMessage "Could not resolve origin/main.").Trim()
    $releaseTargetShort = $releaseTarget.Substring(0, [Math]::Min(8, $releaseTarget.Length))

    Write-Host "Current branch: $currentBranch" -ForegroundColor Gray
    Write-Host "Release target: origin/main ($releaseTargetShort)" -ForegroundColor Gray

    if ($currentBranch -eq "main") {
        $localMain = (Get-GitOutputOrExit -Arguments @("rev-parse", "--verify", "HEAD") -ErrorMessage "Could not resolve local HEAD.").Trim()
        if ($localMain -ne $releaseTarget) {
            Write-Host "Local main differs from origin/main; leaving local checkout unchanged." -ForegroundColor Yellow
        }
    }

    # Get latest semver tag and compute next version.
    $latestTag = Get-GitOutputOrExit -Arguments @("tag", "--sort=-v:refname", "--list", "v*") -ErrorMessage "Could not list release tags." |
        Where-Object { $_ -match '^v\d+\.\d+\.\d+$' } |
        Select-Object -First 1

    if (-not $latestTag) {
        Write-Host "No semver tags found. Starting from v0.0.0." -ForegroundColor Yellow
        $major = 0
        $minor = 0
        $patch = 0
    } elseif ($latestTag -match '^v(\d+)\.(\d+)\.(\d+)$') {
        $major = [int]$Matches[1]
        $minor = [int]$Matches[2]
        $patch = [int]$Matches[3]
    } else {
        Write-Host "ERROR: Could not parse latest tag: $latestTag" -ForegroundColor Red
        exit 1
    }

    switch ($Bump) {
        "major" { $major++; $minor = 0; $patch = 0 }
        "minor" { $minor++; $patch = 0 }
        "patch" { $patch++ }
    }

    $newTag = "v$major.$minor.$patch"

    $existingLocalTag = Get-GitOutputOrExit -Arguments @("tag", "--list", $newTag) -ErrorMessage "Could not check local tag state."
    if ($existingLocalTag) {
        Write-Host "ERROR: Tag $newTag already exists locally." -ForegroundColor Red
        exit 1
    }

    $existingRemoteTag = Get-GitOutputOrExit -Arguments @("ls-remote", "--tags", "--refs", "origin", $newTag) -ErrorMessage "Could not check remote tag state."
    if ($existingRemoteTag) {
        Write-Host "ERROR: Tag $newTag already exists on origin." -ForegroundColor Red
        exit 1
    }

    if ($latestTag) {
        $currentVersion = $latestTag
    } else {
        $currentVersion = "<none>"
    }

    Write-Host "Current version: $currentVersion" -ForegroundColor Gray
    Write-Host "New version:     $newTag ($Bump bump)" -ForegroundColor Green
    Write-Host ""

    # Confirm
    $confirm = Read-Host "Tag origin/main ($releaseTargetShort) as ${newTag} and push? [y/N]"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }

    # Tag and push only the tag.
    Invoke-GitOrExit -Arguments @("tag", $newTag, $releaseTarget) -ErrorMessage "Failed to create tag $newTag."

    & git push origin $newTag
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to push tag $newTag" -ForegroundColor Red
        Write-Host "The tag was created locally. Remove it with: git tag -d $newTag" -ForegroundColor Yellow
        exit 1
    }

    Write-Host ""
    Write-Host "Released $newTag" -ForegroundColor Green
}
finally {
    Pop-Location
}
