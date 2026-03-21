#Requires -Version 5.1
param(
    [string]$InstallDir = "C:\DPF"
)
$ErrorActionPreference = "Stop"

$DPF_DIR = [System.IO.Path]::GetFullPath($InstallDir)
$PROGRESS_FILE = "$DPF_DIR\.install-progress"
$AUTOSTART_TASK_NAME = "DPF-AutoStart"

# --- Helpers ----------------------------------------------------------------

function Write-Step($step, $total, $msg) {
    Write-Host "`nStep $step of $total`: $msg" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "  [OK] $msg" -ForegroundColor Green
}

function Write-Action($msg) {
    Write-Host "  -> $msg" -ForegroundColor Yellow
}

function Write-Warn($msg) {
    Write-Host "  [!] $msg" -ForegroundColor Red
}

function Get-Progress {
    if (Test-Path $PROGRESS_FILE) {
        return Get-Content $PROGRESS_FILE | ConvertFrom-Json
    }
    return @{ completedSteps = @() }
}

function Save-Progress($step) {
    $progress = Get-Progress
    if ($progress.completedSteps -notcontains $step) {
        $progress.completedSteps += $step
    }
    $progress | ConvertTo-Json | Set-Content $PROGRESS_FILE
}

function Is-StepDone($step) {
    $progress = Get-Progress
    return $progress.completedSteps -contains $step
}

function Generate-RandomPassword($length = 32) {
    $bytes = New-Object byte[] $length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join "" | Select-Object -First 1
}

function Generate-RandomAlphanumeric($length = 16) {
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $bytes = New-Object byte[] $length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Ensure-DPFStartupTask {
    param([string]$taskName, [string]$startScriptPath)

    if (-not (Test-Path $startScriptPath)) {
        Write-Warn "Startup script not found at $startScriptPath. Skipping auto-start setup."
        return $false
    }

    try {
        $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NoLogo -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScriptPath`" -NoBrowser"
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType InteractiveToken
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Start DPF containers on user logon." -Force | Out-Null
        Write-OK "Auto-start task configured: $taskName"
        return $true
    } catch {
        Write-Warn "Could not configure auto-start task '$taskName': $($_.Exception.Message)"
        return $false
    }
}

# --- Banner -------------------------------------------------------------------

Write-Host ""
Write-Host "========================================================" -ForegroundColor Magenta
Write-Host "|  Digital Product Factory -- Installation              |" -ForegroundColor Magenta
Write-Host "|  This will set up everything you need automatically  |" -ForegroundColor Magenta
Write-Host "========================================================" -ForegroundColor Magenta

# Create install dir
if (-not (Test-Path $DPF_DIR)) {
    New-Item -ItemType Directory -Path $DPF_DIR -Force | Out-Null
}

# --- Step 1: Check Windows ----------------------------------------------------

Write-Step 1 9 "Checking Windows version..."
if (-not (Is-StepDone "windows_check")) {
    $os = Get-CimInstance Win32_OperatingSystem
    $build = [int]$os.BuildNumber
    if ($build -lt 19041) {
        Write-Warn "Your Windows version doesn't support WSL2."
        Write-Warn "You need Windows 10 version 2004 or later (build 19041+)."
        Write-Warn "Current build: $build"
        exit 1
    }
    Write-OK "$($os.Caption) (build $build)"
    Save-Progress "windows_check"
} else {
    Write-OK "Already checked"
}

# --- Step 2: WSL2 -------------------------------------------------------------

Write-Step 2 9 "Setting up WSL2..."
if (-not (Is-StepDone "wsl2")) {
    $vmpFeature = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
    $wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux

    $needsReboot = $false

    if ($vmpFeature.State -ne "Enabled") {
        Write-Action "Enabling Virtual Machine Platform (safe -- needed for Docker)..."
        Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart -WarningAction SilentlyContinue | Out-Null
        $needsReboot = $true
    }

    if ($wslFeature.State -ne "Enabled") {
        Write-Action "Enabling Windows Subsystem for Linux..."
        Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart -WarningAction SilentlyContinue | Out-Null
        $needsReboot = $true
    }

    if ($needsReboot) {
        # Save progress so we can resume after reboot
        Save-Progress "wsl2_partial"
        Write-Warn "Windows needs to restart to finish setting up."
        Write-Host ""
        Write-Host "  After your computer restarts:" -ForegroundColor White
        Write-Host "  1. Open the folder where you saved the installer"
        Write-Host "  2. Double-click install-dpf.bat (or run it from a terminal)"
        Write-Host "  3. The installer will pick up where it left off"
        Write-Host ""
        Write-Host "  Restarting in 15 seconds... (press Ctrl+C to cancel)" -ForegroundColor Yellow
        Start-Sleep -Seconds 15
        Restart-Computer -Force
        exit 0
    }

    # Set WSL default version
    wsl --set-default-version 2 2>$null

    Write-OK "WSL2 is ready"
    Save-Progress "wsl2"
} else {
    Write-OK "Already set up"
}

# Handle partial WSL2 (resume after reboot)
if ((Is-StepDone "wsl2_partial") -and -not (Is-StepDone "wsl2")) {
    wsl --set-default-version 2 2>$null
    Write-OK "WSL2 is ready (resumed after restart)"
    Save-Progress "wsl2"
}

# --- Step 3: Docker Desktop ---------------------------------------------------

Write-Step 3 9 "Installing Docker Desktop..."
if (-not (Is-StepDone "docker")) {
    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCmd) {
        Write-Action "Downloading Docker Desktop (this takes a minute)..."
        $installerUrl = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
        $installerPath = "$env:TEMP\DockerDesktopInstaller.exe"
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

        Write-Host ""
        Write-Host "  ========================================================" -ForegroundColor Yellow
        Write-Host "  |  ACTION NEEDED:                                   |" -ForegroundColor Yellow
        Write-Host "  |                                                   |" -ForegroundColor Yellow
        Write-Host "  |  The Docker Desktop installer will open.          |" -ForegroundColor Yellow
        Write-Host "  |  1. Click 'Accept' on the license agreement       |" -ForegroundColor Yellow
        Write-Host "  |  2. Leave all checkboxes at their defaults        |" -ForegroundColor Yellow
        Write-Host "  |  3. Click 'Install' and wait for it to finish     |" -ForegroundColor Yellow
        Write-Host "  |  4. Click 'Close' when done                       |" -ForegroundColor Yellow
        Write-Host "  |                                                   |" -ForegroundColor Yellow
        Write-Host "  |  Docker Desktop is free for businesses with       |" -ForegroundColor Yellow
        Write-Host "  |  fewer than 250 employees and under `$10M revenue. |" -ForegroundColor Yellow
        Write-Host "  |  See https://docker.com/pricing for details.      |" -ForegroundColor Yellow
        Write-Host "  ========================================================" -ForegroundColor Yellow
        Write-Host ""

        Start-Process -FilePath $installerPath -Wait
        Remove-Item $installerPath -ErrorAction SilentlyContinue

        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    }

    # Wait for Docker daemon
    Write-Action "Waiting for Docker to start (this may take a minute)..."
    $attempts = 0
    $maxAttempts = 36  # 3 minutes
    while ($attempts -lt $maxAttempts) {
        try {
            docker info 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { break }
        } catch {}
        Start-Sleep -Seconds 5
        $attempts++
    }

    if ($attempts -ge $maxAttempts) {
        Write-Warn "Docker Desktop didn't start after 3 minutes."
        Write-Warn "Try opening Docker Desktop from the Start menu, then run this script again."
        exit 1
    }

    Write-OK "Docker is running"
    Save-Progress "docker"
} else {
    Write-OK "Already installed"
}

# --- Step 4: Download DPF -----------------------------------------------------

Write-Step 4 9 "Setting up Digital Product Factory..."
if (-not (Is-StepDone "download")) {
    # Determine source: the directory where this script lives
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

    # If running from a different location than DPF_DIR, copy files over
    if ($scriptDir -ne $DPF_DIR) {
        # Check if this is already a full repo checkout (has docker-compose.yml)
        if (Test-Path "$scriptDir\docker-compose.yml") {
            Write-Action "Copying project files from $scriptDir..."
            # Preserve .env if it exists at the destination
            $envBackup = $null
            if (Test-Path "$DPF_DIR\.env") {
                $envBackup = Get-Content "$DPF_DIR\.env" -Raw
            }
            Copy-Item -Path "$scriptDir\*" -Destination $DPF_DIR -Recurse -Force
            if ($envBackup) {
                $envBackup | Set-Content "$DPF_DIR\.env"
            }
        } else {
            # Try downloading from GitHub
            Write-Action "Downloading latest release..."
            $repoUrl = "https://github.com/markdbodman/opendigitalproductfactory/archive/refs/heads/main.zip"
            $zipPath = "$env:TEMP\dpf-latest.zip"
            try {
                Invoke-WebRequest -Uri $repoUrl -OutFile $zipPath -UseBasicParsing
            } catch {
                Write-Warn "Could not download from GitHub: $($_.Exception.Message)"
                Write-Warn "Make sure you have the full project files in $scriptDir or $DPF_DIR"
                Write-Warn "Clone the repo: git clone https://github.com/markdbodman/opendigitalproductfactory.git"
                exit 1
            }

            Write-Action "Extracting..."
            Expand-Archive -Path $zipPath -DestinationPath "$env:TEMP\dpf-extract" -Force
            $extracted = Get-ChildItem "$env:TEMP\dpf-extract" | Select-Object -First 1
            Copy-Item -Path "$($extracted.FullName)\*" -Destination $DPF_DIR -Recurse -Force
            Remove-Item $zipPath -ErrorAction SilentlyContinue
            Remove-Item "$env:TEMP\dpf-extract" -Recurse -ErrorAction SilentlyContinue
        }
    } else {
        # Already running from DPF_DIR -- nothing to copy
        if (-not (Test-Path "$DPF_DIR\docker-compose.yml")) {
            Write-Warn "docker-compose.yml not found in $DPF_DIR"
            Write-Warn "Make sure you have the full project files. Clone the repo first:"
            Write-Warn "  git clone https://github.com/markdbodman/opendigitalproductfactory.git $DPF_DIR"
            exit 1
        }
        Write-OK "Project files already in place"
    }

    # Write version file
    "main" | Set-Content "$DPF_DIR\.version"

    # Copy convenience scripts to DPF root
    Copy-Item "$DPF_DIR\scripts\dpf-start.ps1" "$DPF_DIR\dpf-start.ps1" -ErrorAction SilentlyContinue
    Copy-Item "$DPF_DIR\scripts\dpf-stop.ps1" "$DPF_DIR\dpf-stop.ps1" -ErrorAction SilentlyContinue
    Copy-Item "$DPF_DIR\scripts\dpf-start.bat" "$DPF_DIR\dpf-start.bat" -ErrorAction SilentlyContinue
    Copy-Item "$DPF_DIR\scripts\dpf-stop.bat" "$DPF_DIR\dpf-stop.bat" -ErrorAction SilentlyContinue

    # Add install directory to user PATH if not already there
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$DPF_DIR*") {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$DPF_DIR", "User")
        $env:Path += ";$DPF_DIR"
    }

    Write-OK "Set up in $DPF_DIR"
    Save-Progress "download"
} else {
    Write-OK "Already set up"
}

# --- Step 5: Hardware Detection ------------------------------------------------

Write-Step 5 9 "Detecting your hardware..."
if (-not (Is-StepDone "hardware")) {
    $cpu = Get-CimInstance Win32_Processor
    $mem = Get-CimInstance Win32_ComputerSystem
    $gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match "NVIDIA" } | Select-Object -First 1
    $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"

    $totalRAM_GB = [math]::Round($mem.TotalPhysicalMemory / 1GB, 1)
    $gpuName = if ($gpu) { $gpu.Name } else { $null }

    # WMI AdapterRAM is a DWORD -- caps at 4GB. Use nvidia-smi for accurate VRAM.
    $gpuVRAM_GB = 0
    if ($gpuName) {
        try {
            $nvSmiOutput = & "nvidia-smi" "--query-gpu=memory.total" "--format=csv,noheader,nounits" 2>$null
            if ($LASTEXITCODE -eq 0 -and $nvSmiOutput) {
                $gpuVRAM_GB = [math]::Round([int]$nvSmiOutput.Trim() / 1024, 1)
            }
        } catch {}
        if ($gpuVRAM_GB -eq 0 -and $gpu.AdapterRAM) {
            $gpuVRAM_GB = [math]::Round($gpu.AdapterRAM / 1GB, 1)
        }
    }
    $diskFree_GB = [math]::Round($disk.FreeSpace / 1GB, 1)

    $hwSummary = "$totalRAM_GB GB RAM, $($cpu.NumberOfCores)-core CPU"
    if ($gpuName) { $hwSummary += ", $gpuName ($gpuVRAM_GB GB VRAM)" }
    Write-OK $hwSummary

    # Select a chat-optimized model that fits comfortably in VRAM.
    # Rule: model file size should be ~70% of VRAM or less to avoid CPU spill.
    # Use llama3.1 for chat (no thinking-mode issues, fast responses).
    # llama3.1:70b = 40GB, llama3.1:8b = 4.7GB, llama3.2:3b = 2GB, llama3.2:1b = 1.3GB
    if ($gpuVRAM_GB -ge 12) {
        $selectedModel = "llama3.1:8b"
        $modelReason = "fast, high-quality chat -- fits fully in your GPU memory"
    } elseif ($gpuVRAM_GB -ge 6) {
        $selectedModel = "llama3.1:8b"
        $modelReason = "good quality chat, GPU-accelerated"
    } elseif ($gpuVRAM_GB -ge 3) {
        $selectedModel = "llama3.2:3b"
        $modelReason = "balanced quality, GPU-accelerated"
    } elseif ($totalRAM_GB -ge 16) {
        $selectedModel = "llama3.1:8b"
        $modelReason = "good quality chat, fits your RAM (CPU mode)"
    } elseif ($totalRAM_GB -ge 8) {
        $selectedModel = "llama3.2:3b"
        $modelReason = "fast, works well on your hardware"
    } else {
        $selectedModel = "llama3.2:1b"
        $modelReason = "lightweight, optimized for your hardware"
    }
    Write-Action "Selected AI model: $selectedModel ($modelReason)"
    Write-Action "Note: The AI model takes about a minute to load on first use after startup."

    # Check disk space
    if ($diskFree_GB -lt 5) {
        Write-Warn "Not enough disk space. The platform needs about 5 GB free. You have $diskFree_GB GB."
        exit 1
    }

    # Build host profile JSON
    $hostProfile = @{
        cpuCores = $cpu.NumberOfCores
        cpuModel = $cpu.Name
        ramGB = $totalRAM_GB
        gpuName = $gpuName
        gpuVramGB = $gpuVRAM_GB
        diskFreeGB = $diskFree_GB
        selectedModel = $selectedModel
        detectedAt = (Get-Date -Format "o")
    } | ConvertTo-Json -Compress

    # Generate GPU override for Docker Compose if NVIDIA detected
    if ($gpuName) {
        @"
services:
  ollama:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
"@ | Set-Content "$DPF_DIR\docker-compose.override.yml"
        Write-Action "GPU passthrough configured for AI engine"
    }

    # Save for later steps
    $hostProfile | Set-Content "$DPF_DIR\.host-profile.json"
    $selectedModel | Set-Content "$DPF_DIR\.selected-model"

    Save-Progress "hardware"
} else {
    Write-OK "Already detected"
    $selectedModel = Get-Content "$DPF_DIR\.selected-model" -ErrorAction SilentlyContinue
    if (-not $selectedModel) { $selectedModel = "qwen3:1.7b" }
}

# --- Generate .env -------------------------------------------------------------

if (-not (Test-Path "$DPF_DIR\.env")) {
    $pgPass = Generate-RandomPassword 16
    $neoPass = Generate-RandomPassword 16
    $authSecret = Generate-RandomPassword 32
    $encKey = Generate-RandomPassword 32
    $adminPass = Generate-RandomAlphanumeric 16
    $hostProfileJson = if (Test-Path "$DPF_DIR\.host-profile.json") { Get-Content "$DPF_DIR\.host-profile.json" -Raw } else { "{}" }

    @"
# Generated by DPF installer -- do not edit manually
POSTGRES_USER=dpf
POSTGRES_PASSWORD=$pgPass
DATABASE_URL=postgresql://dpf:$pgPass@postgres:5432/dpf
NEO4J_AUTH=neo4j/$neoPass
AUTH_SECRET=$authSecret
CREDENTIAL_ENCRYPTION_KEY=$encKey
NEO4J_URI=bolt://neo4j:7687
ADMIN_PASSWORD=$adminPass
DPF_HOST_PROFILE=$hostProfileJson
SELECTED_MODEL=$selectedModel
"@ | Set-Content "$DPF_DIR\.env"
}

# --- Step 6: Start Platform ---------------------------------------------------

Write-Step 6 9 "Starting the platform..."
if (-not (Is-StepDone "started")) {
    Set-Location $DPF_DIR
    Write-Action "Building the portal (first time takes 3-5 minutes)..."
    docker compose build --quiet 2>$null
    if ($LASTEXITCODE -ne 0) {
        docker compose build
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Build failed. Check the output above for errors."
            exit 1
        }
    }

    Write-Action "Starting database, AI engine, and portal..."
    docker compose up -d

    # Wait for portal health
    Write-Action "Waiting for the portal to be ready..."
    $attempts = 0
    $maxAttempts = 60  # 5 minutes
    while ($attempts -lt $maxAttempts) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) { break }
        } catch {}
        Start-Sleep -Seconds 5
        $attempts++
    }

    if ($attempts -ge $maxAttempts) {
        Write-Warn "Portal didn't become healthy after 5 minutes."
        Write-Warn "Run 'docker compose logs portal' in $DPF_DIR to see what happened."
        exit 1
    }

    Write-OK "All services healthy"
    Save-Progress "started"
} else {
    Write-OK "Already running"
}

# --- Step 7: Wait for AI Model -------------------------------------------------

Write-Step 7 9 "Setting up your AI Coworker..."
if (-not (Is-StepDone "model")) {
    # The entrypoint script detects hardware and pulls the model automatically.
    # SELECTED_MODEL from .env is passed as OLLAMA_DEFAULT_MODEL to the container.
    Write-Action "AI engine is downloading $selectedModel in the background..."
    Write-Action "This may take several minutes depending on your internet speed."
    $attempts = 0
    $maxAttempts = 120  # 10 minutes
    while ($attempts -lt $maxAttempts) {
        try {
            $modelList = docker compose exec -T ollama ollama list 2>$null
            if ($modelList -match $selectedModel.Replace(":", "\:")) { break }
        } catch {}
        Start-Sleep -Seconds 5
        $attempts++
    }
    if ($attempts -ge $maxAttempts) {
        Write-Warn "Model still downloading. It will be ready when the download completes."
        Write-Warn "Check progress: docker compose logs ollama"
    } else {
        Write-OK "AI Coworker is ready ($selectedModel)"
    }
    Save-Progress "model"
} else {
    Write-OK "Already set up"
}

# --- Step 8: Open Browser -----------------------------------------------------

Write-Step 8 9 "Configuring auto-start on logon..."
if (-not (Is-StepDone "autostart")) {
    if (Ensure-DPFStartupTask -taskName $AUTOSTART_TASK_NAME -startScriptPath "$DPF_DIR\\dpf-start.ps1") {
        Save-Progress "autostart"
    }
} else {
    Write-OK "Already configured"
}

Write-Step 9 9 "Opening your portal!"

# Read admin password from .env
$adminPass = (Get-Content "$DPF_DIR\.env" | Where-Object { $_ -match "^ADMIN_PASSWORD=" }) -replace "^ADMIN_PASSWORD=", ""

Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "  ========================================================" -ForegroundColor Green
Write-Host "  |  Your Digital Product Factory is ready!              |" -ForegroundColor Green
Write-Host "  |                                                      |" -ForegroundColor Green
Write-Host "  |  URL:      http://localhost:3000                     |" -ForegroundColor Green
Write-Host "  |  Email:    admin@dpf.local                           |" -ForegroundColor Green
Write-Host "  |  Password: $($adminPass.PadRight(40))|" -ForegroundColor Green
Write-Host "  |                                                      |" -ForegroundColor Green
Write-Host "  |  Save this password -- it won't be shown again!      |" -ForegroundColor Green
Write-Host "  |                                                      |" -ForegroundColor Green
Write-Host "  |  To stop:  Open PowerShell, run: dpf-stop            |" -ForegroundColor Green
Write-Host "  |  To start: Open PowerShell, run: dpf-start           |" -ForegroundColor Green
Write-Host "  ========================================================" -ForegroundColor Green

# Save credentials file
@"
Digital Product Factory -- Admin Credentials
============================================
URL:      http://localhost:3000
Email:    admin@dpf.local
Password: $adminPass

Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Change this password after first login!
"@ | Set-Content "$DPF_DIR\.admin-credentials"

