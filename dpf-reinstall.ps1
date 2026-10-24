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
#   3. Dumps the live PostgreSQL database to $DPF_DIR-backups\pre-destructive\
#      (Workrooms, decisions and backlog rows survive the reinstall as a
#      restorable pg_dump; BI-F9939341). Refuses to continue if the dump fails
#      unless -SkipPreDestructiveDump is passed.
#   4. Stops all DPF Docker containers and removes all DPF Docker volumes
#      (including PostgreSQL)
#   5. Removes DPF Docker images
#   6. Removes bind-mount data directories
#   7. Migrates any legacy in-tree backups under $DPF_DIR\backups\ to the
#      sibling $DPF_DIR-backups\ (operator backup history survives the
#      reinstall). New installs already write backups to $DPF_DIR-backups\
#      directly via DPF_BACKUPS_HOST_PATH so this step is usually a no-op.
#   8. Deletes the project directory
#
# After this completes, follow the README to install fresh as a new user.
#
# The script copies itself to %TEMP% and re-launches from there so it can
# delete the project directory even if VS Code or other tools hold a lock.

param(
    [string]$InstallDir,
    [switch]$SkipPreDestructiveDump,  # accept losing every unmirrored DB row
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
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tempScript -InstallDir $DPF_DIR -FromTemp -SkipPreDestructiveDump:$SkipPreDestructiveDump
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
Write-Host "    - PostgreSQL database"
Write-Host "    - Redis cache"
Write-Host "    - Sandbox workspace"
Write-Host "    - All Docker images and volumes"
Write-Host "    - The entire $DPF_DIR directory"
Write-Host ""
Write-Host "  Operator backups live at $DPF_DIR-backups\ (OUTSIDE this" -ForegroundColor Cyan
Write-Host "  install) and are NOT touched by the rm. Any pre-relocation"
Write-Host "  in-tree backups at $DPF_DIR\backups\ are migrated out first."
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

# --- Pre-destructive Postgres dump -----------------------------------------
# `docker compose down -v` below destroys the database, and with it every
# Workroom, decision and backlog row that is not already mirrored elsewhere
# (BI-F9939341). The nightly backup is hours old and the backlog bundle does
# not run from a consumer install, so the only honest move is to dump the live
# database right here, right before the volume goes. The dump lands under the
# operator backup root (outside the install directory) so the rm cannot touch
# it, and restores with the same pg_restore the DR runbook documents.
function Invoke-PreDestructivePostgresDump {
    param(
        [Parameter(Mandatory = $true)][string]$InstallDir,
        [Parameter(Mandatory = $true)][string]$Trigger,
        [switch]$Skip
    )
    if ($Skip) {
        Write-Warn "Pre-destructive Postgres dump SKIPPED by -SkipPreDestructiveDump. Every row not already mirrored is gone after this step."
        return $null
    }
    $pgUser = "dpf"; $pgDb = "dpf"; $container = "dpf-postgres-1"; $backupsRoot = $null
    $envPath = Join-Path $InstallDir ".env"
    if (Test-Path $envPath) {
        foreach ($line in Get-Content $envPath) {
            if ($line -match '^DPF_BACKUPS_HOST_PATH=(.+)$') { $backupsRoot = $Matches[1].Trim().Trim('"').Trim("'") }
            elseif ($line -match '^POSTGRES_USER=(.+)$') { $pgUser = $Matches[1].Trim().Trim('"').Trim("'") }
            elseif ($line -match '^POSTGRES_DB=(.+)$') { $pgDb = $Matches[1].Trim().Trim('"').Trim("'") }
            elseif ($line -match '^DPF_PRODUCTION_DB_CONTAINER=(.+)$') { $container = $Matches[1].Trim().Trim('"').Trim("'") }
        }
    }
    if (-not $backupsRoot) { $backupsRoot = "$InstallDir-backups" }

    $running = docker ps --filter "name=^$container$" --format "{{.Names}}" 2>$null
    if (-not $running) {
        Write-Ok "No running Postgres container ($container); nothing to dump before teardown."
        return $null
    }

    $now = (Get-Date).ToUniversalTime()
    $target = Join-Path $backupsRoot ("pre-destructive\" + $now.ToString("yyyy-MM-dd") + "\" + $Trigger + "-" + $now.ToString("yyyy-MM-ddTHH-mm-ssZ"))
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    $dump = Join-Path $target "dpf.dump"
    Write-Host "  Dumping $pgDb from $container to $dump ..."
    # cmd.exe redirection keeps the custom-format dump byte-exact; PowerShell
    # redirection would re-encode it as text and corrupt it.
    & cmd.exe /c "docker exec $container pg_dump -U $pgUser -Fc $pgDb > `"$dump`""
    $exit = $LASTEXITCODE
    $size = if (Test-Path $dump) { (Get-Item $dump).Length } else { 0 }
    if ($exit -ne 0 -or $size -eq 0) {
        if (Test-Path $dump) { Remove-Item $dump -Force }
        Write-Fail "Pre-destructive Postgres dump FAILED (pg_dump exit=$exit, bytes=$size). Refusing to destroy the database. Fix the dump (is $container healthy? is $backupsRoot writable?) and re-run; pass -SkipPreDestructiveDump only if losing every unmirrored Workroom, decision and backlog row is acceptable."
    }
    $sha = (Get-FileHash -Path $dump -Algorithm SHA256).Hash.ToLower()
    # LF-terminated so `sha256sum -c dpf.dump.sha256` works on any host (Set-Content would write CRLF).
    [System.IO.File]::WriteAllText((Join-Path $target "dpf.dump.sha256"), "$sha  dpf.dump`n")
    $manifest = [ordered]@{
        schemaVersion = 1
        trigger       = $Trigger
        capturedAt    = $now.ToString("yyyy-MM-ddTHH:mm:ssZ")
        container     = $container
        database      = $pgDb
        dumpFormat    = "pg_dump -Fc"
        sizeBytes     = $size
        sha256        = $sha
        restore       = "docker exec -i <postgres> pg_restore --clean --if-exists -U $pgUser -d $pgDb < dpf.dump  (or /admin/backups -> Restore)"
    }
    ($manifest | ConvertTo-Json) | Set-Content -Path (Join-Path $target "manifest.json") -Encoding UTF8
    Write-Ok ("Pre-destructive dump saved: {0} ({1:N1} MB, sha256 {2}...)" -f $dump, ($size / 1MB), $sha.Substring(0, 12))
    return $target
}

# --- Step 2c: Dump the live database before anything destroys it ------------

Write-Step "Preserving the live database (pre-destructive dump)"
if (Test-Path "$DPF_DIR\docker-compose.yml") {
    $preDestructiveDump = Invoke-PreDestructivePostgresDump -InstallDir $DPF_DIR -Trigger "dpf-reinstall" -Skip:$SkipPreDestructiveDump
} else {
    Write-Ok "No docker-compose.yml in $DPF_DIR; no database to preserve."
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

# --- Step 5b: Migrate any legacy in-tree backups out of the install dir ----
#
# Post-relocation (DPF_BACKUPS_HOST_PATH in .env), backups live at
# $DPF_DIR-backups\ -- OUTSIDE the install root -- so Step 6's rm cannot
# destroy them. This step is a one-way safety net for the upgrade case
# where an operator still has backups under the legacy in-tree
# $DPF_DIR\backups\ location: move them to the sibling dir before the rm.
# On a fully-relocated install $DPF_DIR\backups\ does not exist and this
# step is a no-op.

Write-Step "Migrating any legacy in-tree backups out of the install dir"

$backupsSrc = Join-Path $DPF_DIR "backups"
if (Test-Path $backupsSrc) {
    $hasContent = $false
    try {
        $first = Get-ChildItem -LiteralPath $backupsSrc -Force -ErrorAction SilentlyContinue | Select-Object -First 1
        $hasContent = [bool]$first
    } catch {
        $hasContent = $false
    }
    if ($hasContent) {
        $preserveDir = "$DPF_DIR-backups"
        Write-Host "   Moving $backupsSrc -> $preserveDir (legacy in-tree layout)" -ForegroundColor Cyan
        try {
            if (-not (Test-Path $preserveDir)) {
                New-Item -ItemType Directory -Path $preserveDir | Out-Null
            }
            # Move each top-level entry so we merge with anything already
            # at the sibling dir (the permanent home for relocated installs)
            # rather than failing on collision.
            Get-ChildItem -LiteralPath $backupsSrc -Force | ForEach-Object {
                $dest = Join-Path $preserveDir $_.Name
                if (Test-Path $dest) {
                    Write-Warn "Skipped $($_.Name): already present in $preserveDir"
                } else {
                    Move-Item -LiteralPath $_.FullName -Destination $dest -Force
                }
            }
            Write-Ok "Backups migrated to $preserveDir (permanent home for relocated installs)"
        } catch {
            Write-Warn "Could not migrate backups: $_"
            Write-Fail "Refusing to delete $DPF_DIR while in-tree backups are present. Move $backupsSrc somewhere safe by hand, then re-run."
        }
    } else {
        Write-Ok "No in-tree backup files to migrate (normal for relocated installs)"
    }
} else {
    Write-Ok "No in-tree backups directory found (normal for relocated installs)"
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
