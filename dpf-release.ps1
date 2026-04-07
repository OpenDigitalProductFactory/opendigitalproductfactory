param(
    [Parameter(Position=0)]
    [ValidateSet("major", "minor", "patch")]
    [string]$Bump = "minor"
)

# dpf-release.ps1 - Tag and push a production release
# Usage: .\dpf-release.ps1          (minor bump, e.g. v0.85.0 -> v0.86.0)
#        .\dpf-release.ps1 patch    (patch bump, e.g. v0.85.0 -> v0.85.1)
#        .\dpf-release.ps1 major    (major bump, e.g. v0.85.0 -> v1.0.0)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Switch to main if not already there
$branch = git rev-parse --abbrev-ref HEAD
$stashed = $false
if ($branch -ne "main") {
    Write-Host "Switching from $branch to main..." -ForegroundColor Cyan
    # Use SilentlyContinue locally so git informational stderr (e.g. "Ignoring path ...")
    # does not trip PowerShell's error handling when ErrorActionPreference = Stop.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    git stash --include-untracked -q 2>$null
    $stashed = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $prev
    git checkout main -q
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Could not switch to main." -ForegroundColor Red
        if ($stashed) { git stash pop -q 2>$null }
        exit 1
    }
}

# Pull latest main from remote (this is what prevents the rejected push)
Write-Host "Pulling latest main from origin..." -ForegroundColor Cyan
git pull origin main --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Fast-forward pull failed. You may have local commits on main that diverge from origin." -ForegroundColor Red
    Write-Host "Run 'git log origin/main..main' to see divergent commits." -ForegroundColor Yellow
    if ($branch -ne "main") {
        git checkout $branch -q 2>$null
        if ($stashed) { git stash pop -q 2>$null }
    }
    exit 1
}

# Get latest tag and compute next version
$latestTag = git tag --sort=-v:refname | Select-Object -First 1
if (-not $latestTag -or $latestTag -notmatch '^v(\d+)\.(\d+)\.(\d+)$') {
    Write-Host "ERROR: Could not parse latest tag: $latestTag" -ForegroundColor Red
    if ($branch -ne "main") {
        git checkout $branch -q 2>$null
        if ($stashed) { git stash pop -q 2>$null }
    }
    exit 1
}

$major = [int]$Matches[1]
$minor = [int]$Matches[2]
$patch = [int]$Matches[3]

switch ($Bump) {
    "major" { $major++; $minor = 0; $patch = 0 }
    "minor" { $minor++; $patch = 0 }
    "patch" { $patch++ }
}

$newTag = "v$major.$minor.$patch"

Write-Host "Current version: $latestTag" -ForegroundColor Gray
Write-Host "New version:     $newTag ($Bump bump)" -ForegroundColor Green
Write-Host ""

# Confirm
$confirm = Read-Host "Tag and push ${newTag}? [y/N]"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "Aborted." -ForegroundColor Yellow
    if ($branch -ne "main") {
        git checkout $branch -q 2>$null
        if ($stashed) { git stash pop -q 2>$null }
    }
    exit 0
}

# Tag and push only the tag
git tag $newTag
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to create tag $newTag" -ForegroundColor Red
    if ($branch -ne "main") {
        git checkout $branch -q 2>$null
        if ($stashed) { git stash pop -q 2>$null }
    }
    exit 1
}

git push origin $newTag
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to push tag $newTag" -ForegroundColor Red
    Write-Host "The tag was created locally. Remove it with: git tag -d $newTag" -ForegroundColor Yellow
    if ($branch -ne "main") {
        git checkout $branch -q 2>$null
        if ($stashed) { git stash pop -q 2>$null }
    }
    exit 1
}

Write-Host ""
Write-Host "Released $newTag" -ForegroundColor Green

# Return to original branch if we switched away
if ($branch -ne "main") {
    git checkout $branch -q 2>$null
    if ($stashed) { git stash pop -q 2>$null }
    Write-Host "Returned to $branch" -ForegroundColor Gray
}
