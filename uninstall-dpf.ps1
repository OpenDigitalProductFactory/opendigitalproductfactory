#Requires -Version 5.1
param([string]$InstallDir = "C:\\DPF")

$ErrorActionPreference = "Stop"

$DPF_DIR = [System.IO.Path]::GetFullPath($InstallDir)
$AUTOSTART_TASK_NAME = "DPF-AutoStart"

Write-Host ""
Write-Host "========================================================" -ForegroundColor Red
Write-Host "  Digital Product Factory  Uninstall                 " -ForegroundColor Red
Write-Host "  This will remove the platform and all its data      " -ForegroundColor Red
Write-Host "========================================================" -ForegroundColor Red
Write-Host ""
Write-Host "This will:" -ForegroundColor Yellow
Write-Host "   Stop and remove all Docker containers"
Write-Host "   Delete all platform data (database, AI models, messages)"
Write-Host "   Remove the $DPF_DIR directory"
Write-Host "   Remove the DPF AutoStart scheduled task"
Write-Host "   Remove DPF from your PATH"
Write-Host ""
Write-Host "Docker Desktop will NOT be uninstalled (you may need it for other things)."
Write-Host ""

$confirm = Read-Host "Type 'yes' to confirm uninstall"
if ($confirm -ne "yes") {
    Write-Host "Uninstall cancelled." -ForegroundColor Green
    exit 0
}

Write-Host ""

Write-Host "========================================================" 

Write-Host "Step 1: Stopping and removing containers..." -ForegroundColor Cyan
if (Test-Path "$DPF_DIR\docker-compose.yml") {
    try {
        Set-Location $DPF_DIR
        docker compose down -v --remove-orphans 2>$null
        Write-Host "   Containers and volumes removed" -ForegroundColor Green
    } catch {
        Write-Host "   Could not stop containers (Docker may not be running)" -ForegroundColor Yellow
    }
} else {
    Write-Host "   No docker-compose.yml found, skipping" -ForegroundColor Yellow
}

Write-Host "========================================================" 

Write-Host "Step 2: Removing Docker images..." -ForegroundColor Cyan
try {
    $images = docker images --filter "reference=*dpf*" --filter "reference=*opendigitalproductfactory*" -q 2>$null
    if ($images) {
        docker rmi $images -f 2>$null
    }
    # Also remove the built portal images
    $composeImages = docker images --filter "reference=*feature-windows-installer*" --filter "reference=*c-dpf*" -q 2>$null
    if ($composeImages) {
        docker rmi $composeImages -f 2>$null
    }
    Write-Host "   Docker images cleaned" -ForegroundColor Green
} catch {
    Write-Host "   Could not remove some images" -ForegroundColor Yellow
}

Write-Host "========================================================" 

Write-Host "Step 3: Removing $DPF_DIR..." -ForegroundColor Cyan
Set-Location $env:USERPROFILE  # Move out of the directory first
if (Test-Path $DPF_DIR) {
    try {
        Remove-Item $DPF_DIR -Recurse -Force
        Write-Host "   $DPF_DIR removed" -ForegroundColor Green
    } catch {
        Write-Host "   Could not fully remove $DPF_DIR  some files may be locked" -ForegroundColor Yellow
        Write-Host "    Try closing any open files or terminals in that directory, then delete manually" -ForegroundColor Yellow
    }
} else {
    Write-Host "   $DPF_DIR not found, skipping" -ForegroundColor Yellow
}

Write-Host "========================================================" 

Write-Host "Step 4: Removing from PATH..." -ForegroundColor Cyan
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -like "*$DPF_DIR*") {
    $newPath = ($userPath -split ";" | Where-Object { $_ -ne $DPF_DIR -and $_ -ne "" }) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "   Removed $DPF_DIR from PATH" -ForegroundColor Green
} else {
    Write-Host "   Not in PATH, skipping" -ForegroundColor Yellow
}

Write-Host "========================================================" 

Write-Host "Step 5: Removing DPF auto-start task..." -ForegroundColor Cyan
try {
    if (Get-ScheduledTask -TaskName $AUTOSTART_TASK_NAME -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $AUTOSTART_TASK_NAME -Confirm:$false -ErrorAction Stop
Write-Host "   Removed DPF auto-start task" -ForegroundColor Green
    } else {
Write-Host "   Auto-start task not found, skipping" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Could not remove auto-start task (continuing uninstall)" -ForegroundColor Yellow
}
Write-Host "Step 6: Cleaning up..." -ForegroundColor Cyan
# Remove any temp files from install
Remove-Item "$env:TEMP\dpf-*" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:TEMP\DockerDesktopInstaller.exe" -Force -ErrorAction SilentlyContinue
Write-Host "   Temp files cleaned" -ForegroundColor Green

Write-Host "========================================================" 

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  Uninstall complete!                                 " -ForegroundColor Green
Write-Host "                                                      " -ForegroundColor Green
Write-Host "  What was removed:                                   " -ForegroundColor Green
Write-Host "   All DPF containers and data volumes               " -ForegroundColor Green
Write-Host "   The $DPF_DIR directory                              " -ForegroundColor Green
Write-Host "   DPF from your system PATH                         " -ForegroundColor Green
Write-Host "   Remove the DPF auto-start task (if configured)"
Write-Host "                                                      " -ForegroundColor Green
Write-Host "  What was kept:                                      " -ForegroundColor Green
Write-Host "   Docker Desktop (uninstall separately if needed)   " -ForegroundColor Green
Write-Host "   WSL2 (Windows feature, safe to keep)              " -ForegroundColor Green
Write-Host "                                                      " -ForegroundColor Green
Write-Host "  To reinstall, run install-dpf.ps1 again.            " -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green



