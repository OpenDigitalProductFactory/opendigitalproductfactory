#Requires -Version 5.1
param([string]$InstallDir = "C:\\DPF")

$ErrorActionPreference = "Stop"

$DPF_DIR = [System.IO.Path]::GetFullPath($InstallDir)
$AUTOSTART_TASK_NAME = "DPF-AutoStart"

Write-Host ""
Write-Host "â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—" -ForegroundColor Red
Write-Host "â•‘  Digital Product Factory â€” Uninstall                 â•‘" -ForegroundColor Red
Write-Host "â•‘  This will remove the platform and all its data      â•‘" -ForegroundColor Red
Write-Host "â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•" -ForegroundColor Red
Write-Host ""
Write-Host "This will:" -ForegroundColor Yellow
Write-Host "  â€¢ Stop and remove all Docker containers"
Write-Host "  â€¢ Delete all platform data (database, AI models, messages)"
Write-Host "  â€¢ Remove the $DPF_DIR directory"
Write-Host "  • Remove the DPF AutoStart scheduled task"
Write-Host "  â€¢ Remove DPF from your PATH"
Write-Host ""
Write-Host "Docker Desktop will NOT be uninstalled (you may need it for other things)."
Write-Host ""

$confirm = Read-Host "Type 'yes' to confirm uninstall"
if ($confirm -ne "yes") {
    Write-Host "Uninstall cancelled." -ForegroundColor Green
    exit 0
}

Write-Host ""

# â”€â”€â”€ Step 1: Stop and remove containers + volumes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

Write-Host "Step 1: Stopping and removing containers..." -ForegroundColor Cyan
if (Test-Path "$DPF_DIR\docker-compose.yml") {
    try {
        Set-Location $DPF_DIR
        docker compose down -v --remove-orphans 2>$null
        Write-Host "  âœ“ Containers and volumes removed" -ForegroundColor Green
    } catch {
        Write-Host "  âš  Could not stop containers (Docker may not be running)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  â†’ No docker-compose.yml found, skipping" -ForegroundColor Yellow
}

# â”€â”€â”€ Step 2: Remove Docker images â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    Write-Host "  âœ“ Docker images cleaned" -ForegroundColor Green
} catch {
    Write-Host "  âš  Could not remove some images" -ForegroundColor Yellow
}

# â”€â”€â”€ Step 3: Remove DPF directory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

Write-Host "Step 3: Removing $DPF_DIR..." -ForegroundColor Cyan
Set-Location $env:USERPROFILE  # Move out of the directory first
if (Test-Path $DPF_DIR) {
    try {
        Remove-Item $DPF_DIR -Recurse -Force
        Write-Host "  âœ“ $DPF_DIR removed" -ForegroundColor Green
    } catch {
        Write-Host "  âš  Could not fully remove $DPF_DIR â€” some files may be locked" -ForegroundColor Yellow
        Write-Host "    Try closing any open files or terminals in that directory, then delete manually" -ForegroundColor Yellow
    }
} else {
    Write-Host "  â†’ $DPF_DIR not found, skipping" -ForegroundColor Yellow
}

# â”€â”€â”€ Step 4: Remove from PATH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

Write-Host "Step 4: Removing from PATH..." -ForegroundColor Cyan
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -like "*$DPF_DIR*") {
    $newPath = ($userPath -split ";" | Where-Object { $_ -ne $DPF_DIR -and $_ -ne "" }) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "  âœ“ Removed $DPF_DIR from PATH" -ForegroundColor Green
} else {
    Write-Host "  â†’ Not in PATH, skipping" -ForegroundColor Yellow
}

# â”€â”€â”€ Step 5: Clean up install progress â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

Write-Host "Step 5: Removing DPF auto-start task..." -ForegroundColor Cyan
try {
    if (Get-ScheduledTask -TaskName $AUTOSTART_TASK_NAME -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $AUTOSTART_TASK_NAME -Confirm:$false -ErrorAction Stop
Write-Host "  ✓ Removed DPF auto-start task" -ForegroundColor Green
    } else {
Write-Host "  → Auto-start task not found, skipping" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Could not remove auto-start task (continuing uninstall)" -ForegroundColor Yellow
}
Write-Host "Step 6: Cleaning up..." -ForegroundColor Cyan
# Remove any temp files from install
Remove-Item "$env:TEMP\dpf-*" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:TEMP\DockerDesktopInstaller.exe" -Force -ErrorAction SilentlyContinue
Write-Host "  âœ“ Temp files cleaned" -ForegroundColor Green

# â”€â”€â”€ Done â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

Write-Host ""
Write-Host "â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—" -ForegroundColor Green
Write-Host "â•‘  Uninstall complete!                                 â•‘" -ForegroundColor Green
Write-Host "â•‘                                                      â•‘" -ForegroundColor Green
Write-Host "â•‘  What was removed:                                   â•‘" -ForegroundColor Green
Write-Host "â•‘  â€¢ All DPF containers and data volumes               â•‘" -ForegroundColor Green
Write-Host "â•‘  â€¢ The $DPF_DIR directory                              â•‘" -ForegroundColor Green
Write-Host "â•‘  â€¢ DPF from your system PATH                         â•‘" -ForegroundColor Green
Write-Host "  • Remove the DPF auto-start task (if configured)"
Write-Host "â•‘                                                      â•‘" -ForegroundColor Green
Write-Host "â•‘  What was kept:                                      â•‘" -ForegroundColor Green
Write-Host "â•‘  â€¢ Docker Desktop (uninstall separately if needed)   â•‘" -ForegroundColor Green
Write-Host "â•‘  â€¢ WSL2 (Windows feature, safe to keep)              â•‘" -ForegroundColor Green
Write-Host "â•‘                                                      â•‘" -ForegroundColor Green
Write-Host "â•‘  To reinstall, run install-dpf.ps1 again.            â•‘" -ForegroundColor Green
Write-Host "â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•" -ForegroundColor Green



