#Requires -Version 5.1
# dpf-reinstall.ps1 -- Clean reinstall of Digital Product Factory from Git
#
# Usage:
#   .\dpf-reinstall.ps1                   # reinstall in current location
#   .\dpf-reinstall.ps1 -InstallDir D:\DPF
#
# What this does:
#   1. Checks for uncommitted changes (warns you before destroying anything)
#   2. Closes VS Code if it has the directory locked
#   3. Stops all DPF Docker containers
#   4. Removes ALL DPF Docker volumes (including neo4j, qdrant, postgres)
#   5. Removes DPF Docker images
#   6. Removes bind-mount data directories
#   7. Deletes the project directory
#
# After this completes, follow the README to install fresh as a new user.
#
# The script copies itself to %TEMP% and re-launches from there so it can
# delete the project directory even if VS Code or other tools hold a lock.

param(
    [string]$InstallDir,
    [switch]$FromTemp  # internal flag -- do not use directly
)

$ErrorActionPreference = "Stop"

# --- Determine install directory -------------------------------------------

if (-not $InstallDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    if (Test-Path "$scriptDir\docker-compose.yml") {
        $InstallDir = $scriptDir
    } else {
        $InstallDir = "D:\DPF"
    }
}
$DPF_DIR = [System.IO.Path]::GetFullPath($InstallDir)

# --- Re-launch from %TEMP% if we are still inside the project directory ----

if (-not $FromTemp) {
    $tempScript = Join-Path $env:TEMP "dpf-reinstall-temp.ps1"
    Copy-Item $MyInvocation.MyCommand.Definition $tempScript -Force
    Write-Host ""
    Write-Host "Re-launching from $tempScript so the project directory can be deleted..." -ForegroundColor Cyan
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tempScript -InstallDir $DPF_DIR -FromTemp
    exit $LASTEXITCODE
}

# --- Helpers ---------------------------------------------------------------

function Write-Step($msg)  { Write-Host "`n>> $msg" -ForegroundColor Yellow }
function Write-Ok($msg)    { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "   $msg" -ForegroundColor Red; exit 1 }

# --- Banner ----------------------------------------------------------------

Write-Host ""
Write-Host "========================================================" -ForegroundColor Red
Write-Host "  Digital Product Factory -- Clean Reinstall            " -ForegroundColor Red
Write-Host "========================================================" -ForegroundColor Red
Write-Host ""
Write-Host "  Install directory: $DPF_DIR" -ForegroundColor Cyan
Write-Host ""
Write-Host "  This will DESTROY all local data:" -ForegroundColor Yellow
Write-Host "    - Database (postgres, neo4j, qdrant)"
Write-Host "    - Redis cache"
Write-Host "    - Sandbox workspace"
Write-Host "    - All Docker images and volumes"
Write-Host "    - The entire $DPF_DIR directory"
Write-Host ""

# --- Step 1: Check for uncommitted changes ---------------------------------

Write-Step "Checking for uncommitted changes"

if (Test-Path "$DPF_DIR\.git") {
    Set-Location $DPF_DIR
    $status = git status --porcelain 2>$null
    if ($status) {
        Write-Host ""
        Write-Host "  WARNING: You have uncommitted changes:" -ForegroundColor Red
        Write-Host ""
        git status --short
        Write-Host ""
        $confirm = Read-Host "  These changes will be LOST. Type 'yes' to continue, anything else to abort"
        if ($confirm -ne "yes") {
            Write-Host "  Aborted. Commit or stash your changes first." -ForegroundColor Green
            exit 0
        }
    } else {
        Write-Ok "Working tree is clean"
    }
    # Move out of the directory so we can delete it
    Set-Location $env:USERPROFILE
} else {
    Write-Ok "No git repository found at $DPF_DIR (nothing to check)"
}

# --- Step 2: Close VS Code if it has the directory open --------------------

Write-Step "Checking for VS Code locks"

$vscodeLocked = $false
$vscodeProcs = Get-Process -Name "Code" -ErrorAction SilentlyContinue
if ($vscodeProcs) {
    # Check if any VS Code window has the DPF directory open
    $lockFiles = Get-ChildItem "$DPF_DIR\.vscode" -ErrorAction SilentlyContinue
    if ($lockFiles -or (Test-Path "$DPF_DIR\.git\index.lock")) {
        $vscodeLocked = $true
    }
    # Also check if any VS Code process has a handle on the directory
    # (simplified check -- if Code.exe is running and dir exists, warn)
    if (Test-Path $DPF_DIR) {
        $vscodeLocked = $true
    }
}

if ($vscodeLocked) {
    Write-Host ""
    Write-Host "  VS Code appears to be open and may lock files in $DPF_DIR" -ForegroundColor Yellow
    $closeVscode = Read-Host "  Close ALL VS Code windows? (yes/no)"
    if ($closeVscode -eq "yes") {
        Write-Host "  Closing VS Code..."
        Stop-Process -Name "Code" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
        Write-Ok "VS Code closed"
    } else {
        Write-Warn "Continuing without closing VS Code -- directory removal may fail"
    }
} else {
    Write-Ok "No VS Code lock detected"
}

# --- Step 3: Stop Docker containers and remove volumes ---------------------

Write-Step "Stopping DPF Docker containers"

# Try compose down first (handles named volumes declared in compose file)
if (Test-Path "$DPF_DIR\docker-compose.yml") {
    Set-Location $DPF_DIR
    docker compose down -v --remove-orphans 2>$null
    Set-Location $env:USERPROFILE
    Write-Ok "Containers stopped, compose volumes removed"
} else {
    Write-Warn "No docker-compose.yml found -- removing volumes by name"
}

# Belt-and-suspenders: remove DPF volumes by name pattern in case compose
# didn't catch them (e.g. running from a different directory than the original)
Write-Step "Removing DPF Docker volumes"

$dpfVolumes = docker volume ls --filter "name=dpf" --format "{{.Name}}" 2>$null
if ($dpfVolumes) {
    foreach ($vol in $dpfVolumes) {
        docker volume rm $vol -f 2>$null
        Write-Host "   Removed volume: $vol"
    }
    Write-Ok "All DPF volumes removed"
} else {
    Write-Ok "No DPF volumes found"
}

# --- Step 4: Remove DPF Docker images -------------------------------------

Write-Step "Removing DPF Docker images"

$dpfImages = docker images --filter "reference=*dpf*" -q 2>$null
$composeImages = docker images --filter "reference=*opendigitalproductfactory*" -q 2>$null
$allImages = @()
if ($dpfImages) { $allImages += $dpfImages }
if ($composeImages) { $allImages += $composeImages }

if ($allImages.Count -gt 0) {
    docker rmi ($allImages | Select-Object -Unique) -f 2>$null
    Write-Ok "DPF images removed"
} else {
    Write-Ok "No DPF images found"
}

# --- Step 5: Remove bind-mount data directories ----------------------------

Write-Step "Removing bind-mount data directories"

$installDrive = (Split-Path -Qualifier $DPF_DIR).TrimEnd(':')
$dockerDataDir = "${installDrive}:\docker-data\dpf"
if (Test-Path $dockerDataDir) {
    Remove-Item -Recurse -Force $dockerDataDir -ErrorAction SilentlyContinue
    Write-Ok "Removed $dockerDataDir"
} else {
    Write-Ok "No bind-mount data directory found"
}

# --- Step 6: Remove project directory --------------------------------------

Write-Step "Removing project directory"

if (Test-Path $DPF_DIR) {
    try {
        Remove-Item $DPF_DIR -Recurse -Force
        Write-Ok "Removed $DPF_DIR"
    } catch {
        Write-Host ""
        Write-Host "  Could not fully remove $DPF_DIR" -ForegroundColor Red
        Write-Host "  Some files may still be locked." -ForegroundColor Red
        Write-Host ""
        Write-Host "  Try:" -ForegroundColor Yellow
        Write-Host "    1. Close any terminals or editors with files open in $DPF_DIR"
        Write-Host "    2. Run: Remove-Item '$DPF_DIR' -Recurse -Force"
        Write-Host "    3. Then re-run this script"
        Write-Host ""
        Write-Fail "Directory removal failed"
    }
} else {
    Write-Ok "Directory already gone"
}

# --- Done ------------------------------------------------------------------

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  Clean wipe complete!                                  " -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Everything has been removed. To reinstall, follow the" -ForegroundColor Cyan
Write-Host "  README instructions to install as a new user."         -ForegroundColor Cyan
Write-Host ""

# Clean up temp copy
Remove-Item "$env:TEMP\dpf-reinstall-temp.ps1" -Force -ErrorAction SilentlyContinue
