#Requires -Version 5.1
param(
    [string]$InstallDir,
    [string]$Version = "latest"
)
$ErrorActionPreference = "Stop"

# Determine a sensible default: if the script already sits in a project
# directory (has docker-compose.yml), default to that path.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $InstallDir) {
    if (Test-Path "$scriptDir\docker-compose.yml") {
        $defaultDir = $scriptDir
    } else {
        $defaultDir = "C:\DPF"
    }

    Write-Host ""
    Write-Host "Where would you like to install Digital Product Factory?" -ForegroundColor Cyan
    $answer = Read-Host "  Install directory [$defaultDir]"
    if ([string]::IsNullOrWhiteSpace($answer)) {
        $InstallDir = $defaultDir
    } else {
        $InstallDir = $answer.Trim()
    }
}
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
        $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Start DPF containers on user logon." -Force | Out-Null
        Write-OK "Auto-start task configured: $taskName"
        return $true
    } catch {
        Write-Warn "Could not configure auto-start task '$taskName': $($_.Exception.Message)"
        return $false
    }
}

$GHCR_PORTAL = "ghcr.io/markdbodman/dpf-portal"
$GHCR_SANDBOX = "ghcr.io/markdbodman/dpf-sandbox"
$InstallMode = $null  # Set in Step 4: "consumer", "contributor", or "private"

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
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        docker info 2>&1 | Out-Null
        $ErrorActionPreference = $oldEAP
        if ($LASTEXITCODE -eq 0) { break }
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

    # Check Docker Desktop version for Model Runner support
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    docker model list 2>&1 | Out-Null
    $modelRunnerAvailable = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $oldEAP
    if (-not $modelRunnerAvailable) {
        Write-Warn "Docker Model Runner not available. Docker Desktop 4.40+ is required for AI features."
        Write-Warn "Please update Docker Desktop: https://docs.docker.com/desktop/release-notes/"
        Write-Warn "The platform will install but AI features (local models) won't work until you update."
    }
} else {
    Write-OK "Already installed"
}

# --- Step 4: Choose install mode and set up files ----------------------------

Write-Step 4 9 "Setting up Digital Product Factory..."
if (-not (Is-StepDone "download")) {

    # If we already have a compose file, detect mode from prior install
    if (Test-Path "$DPF_DIR\docker-compose.yml") {
        if (Test-Path "$DPF_DIR\.git") {
            $InstallMode = "customizer"
            Write-Action "Updating project files..."
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            git -C "$DPF_DIR" pull --ff-only 2>&1 | Out-Null
            $ErrorActionPreference = $oldEAP
        } else {
            $InstallMode = "consumer"
        }
        Write-OK "Project files already in place ($InstallMode mode)"
        Save-Progress "download"
    } else {

        # --- Mode choice ---
        Write-Host ""
        Write-Host "  How do you want to use Digital Product Factory?" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "    [1] Ready to go   - Pre-built: Runs in minutes, no source code, develop simply using your AI Co-Worker." -ForegroundColor White
        Write-Host "    [2] Customizable  - Full source code: For power developers wanting to use VS code on your machine." -ForegroundColor White
        Write-Host ""
        $modeChoice = Read-Host "  Choose [1/2]"

        if ($modeChoice -eq "2") {
            $InstallMode = "customizer"

            # Pre-flight: git required for customizer
            if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
                Write-Warn "Git is required for customizable mode."
                Write-Warn "Install from https://git-scm.com/download/win and re-run."
                exit 1
            }

            if (-not (Test-Path $DPF_DIR)) {
                New-Item -ItemType Directory -Path $DPF_DIR -Force | Out-Null
            }

            Write-Action "Cloning project source..."
            $stash = @{}
            foreach ($f in '.install-progress','.env') {
                if (Test-Path "$DPF_DIR\$f") {
                    $stash[$f] = Get-Content "$DPF_DIR\$f" -Raw
                    Remove-Item "$DPF_DIR\$f"
                }
            }
            if ((Test-Path $DPF_DIR) -and
                @(Get-ChildItem $DPF_DIR -Force -ErrorAction SilentlyContinue).Count -eq 0) {
                Remove-Item $DPF_DIR
            }

            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            git clone "https://github.com/markdbodman/opendigitalproductfactory.git" "$DPF_DIR" 2>&1
            $ErrorActionPreference = $oldEAP
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "Clone failed. Check your internet connection."
                exit 1
            }
            foreach ($f in $stash.Keys) { $stash[$f] | Set-Content "$DPF_DIR\$f" }

            # Create a user branch for customizations (main stays clean for upstream pulls)
            $branchName = "custom/$env:COMPUTERNAME"
            git -C "$DPF_DIR" checkout -b $branchName 2>$null
            Write-OK "Cloned source on branch '$branchName'"
            Write-Action "Your customizations go on this branch. Pull upstream updates with: git pull origin main"

            # Convenience scripts for customizer mode
            Copy-Item "$DPF_DIR\scripts\dpf-start.ps1" "$DPF_DIR\dpf-start.ps1" -ErrorAction SilentlyContinue
            Copy-Item "$DPF_DIR\scripts\dpf-stop.ps1" "$DPF_DIR\dpf-stop.ps1" -ErrorAction SilentlyContinue
            Copy-Item "$DPF_DIR\scripts\dpf-start.bat" "$DPF_DIR\dpf-start.bat" -ErrorAction SilentlyContinue
            Copy-Item "$DPF_DIR\scripts\dpf-stop.bat" "$DPF_DIR\dpf-stop.bat" -ErrorAction SilentlyContinue

        } else {
            # --- Consumer path ---
            $InstallMode = "consumer"
            Write-Action "Setting up pre-built platform, this will take a few minutes..."

            # Authenticate with GitHub Container Registry (images are private during early access)
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            docker pull ghcr.io/markdbodman/dpf-portal:latest 2>&1 | Out-Null
            $needsAuth = ($LASTEXITCODE -ne 0)
            $ErrorActionPreference = $oldEAP

            if ($needsAuth) {
                Write-Host ""
                Write-Host "  The platform images require a GitHub account (free) during early access." -ForegroundColor Cyan
                Write-Host "  You need a Personal Access Token with 'read:packages' scope." -ForegroundColor Cyan
                Write-Host "  Create one at: https://github.com/settings/tokens/new?scopes=read:packages" -ForegroundColor Cyan
                Write-Host ""
                $ghUser = Read-Host "  GitHub username"
                $ghToken = Read-Host "  Personal Access Token" -AsSecureString
                $ghTokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($ghToken))
                $ghTokenPlain | docker login ghcr.io -u $ghUser --password-stdin 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    Write-Warn "GitHub authentication failed. Check your username and token."
                    exit 1
                }
                Write-OK "Authenticated with GitHub Container Registry"
            }

            if (-not (Test-Path $DPF_DIR)) {
                New-Item -ItemType Directory -Path $DPF_DIR -Force | Out-Null
            }

            # Write embedded docker-compose.yml
            @"
# Generated by DPF installer (consumer mode) -- do not edit manually
name: dpf

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: `${POSTGRES_USER:-dpf}
      POSTGRES_PASSWORD: `${POSTGRES_PASSWORD}
      POSTGRES_DB: dpf
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U `${POSTGRES_USER:-dpf}"]
      interval: 5s
      timeout: 5s
      retries: 5

  neo4j:
    image: neo4j:5-community
    restart: unless-stopped
    environment:
      NEO4J_AUTH: `${NEO4J_AUTH}
      NEO4J_PLUGINS: '["apoc"]'
    volumes:
      - neo4jdata:/data
    healthcheck:
      test: ["CMD-SHELL", "wget -qO /dev/null http://localhost:7474 || exit 1"]
      interval: 10s
      timeout: 10s
      retries: 5
      start_period: 30s

  qdrant:
    image: qdrant/qdrant:latest
    restart: unless-stopped
    volumes:
      - qdrant_data:/qdrant/storage
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/readyz"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s

  portal-init:
    image: $($GHCR_PORTAL):$Version
    command: ["/docker-entrypoint.sh"]
    environment:
      DATABASE_URL: postgresql://`${POSTGRES_USER:-dpf}:`${POSTGRES_PASSWORD}@postgres:5432/dpf
      DPF_HOST_PROFILE: `${DPF_HOST_PROFILE:-}
      ADMIN_PASSWORD: `${ADMIN_PASSWORD}
    depends_on:
      postgres:
        condition: service_healthy

  portal:
    image: $($GHCR_PORTAL):$Version
    restart: unless-stopped
    ports:
      - "3000:3000"
      - "1455:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      DATABASE_URL: postgresql://`${POSTGRES_USER:-dpf}:`${POSTGRES_PASSWORD}@postgres:5432/dpf
      AUTH_SECRET: `${AUTH_SECRET}
      AUTH_TRUST_HOST: "true"
      APP_URL: http://localhost:3000
      CREDENTIAL_ENCRYPTION_KEY: `${CREDENTIAL_ENCRYPTION_KEY}
      NEO4J_URI: bolt://neo4j:7687
      NEO4J_USER: neo4j
      NEO4J_PASSWORD: `${NEO4J_PASSWORD}
      QDRANT_INTERNAL_URL: http://qdrant:6333
      LLM_BASE_URL: `${LLM_BASE_URL:-http://model-runner.docker.internal/v1}
      DPF_ENVIRONMENT: production
    depends_on:
      portal-init:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  sandbox-image:
    image: $($GHCR_SANDBOX):$Version
    container_name: dpf-sandbox-dev
    profiles: ["build-images"]
    command: ["echo", "Image ready"]

  playwright:
    image: mcr.microsoft.com/playwright:v1.52.0-noble
    volumes:
      - playwright_scripts:/scripts
      - playwright_results:/results
    network_mode: host
    profiles: ["build-images"]
    command: ["sleep", "infinity"]

volumes:
  pgdata:
  neo4jdata:
  qdrant_data:
  playwright_scripts:
  playwright_results:
"@ | Set-Content "$DPF_DIR\docker-compose.yml" -Encoding UTF8

            # Write dpf-start.ps1 for consumer (no .git dependency)
            @'
param([switch]$NoBrowser)
Set-Location $PSScriptRoot
docker compose up -d
if (-not $NoBrowser) {
    Start-Sleep -Seconds 5
    Start-Process "http://localhost:3000"
    Write-Host "Digital Product Factory is starting at http://localhost:3000" -ForegroundColor Green
}
'@ | Set-Content "$DPF_DIR\dpf-start.ps1" -Encoding UTF8

            @'
Set-Location $PSScriptRoot
docker compose down
Write-Host "Digital Product Factory stopped." -ForegroundColor Yellow
'@ | Set-Content "$DPF_DIR\dpf-stop.ps1" -Encoding UTF8

            Write-OK "Platform files written to $DPF_DIR"
        }

        # Save install mode
        $InstallMode | Set-Content "$DPF_DIR\.install-mode"

        # Add install directory to user PATH if not already there
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($userPath -notlike "*$DPF_DIR*") {
            [Environment]::SetEnvironmentVariable("Path", "$userPath;$DPF_DIR", "User")
            $env:Path += ";$DPF_DIR"
        }

        Save-Progress "download"
    }
} else {
    # Resume: read saved mode
    if (Test-Path "$DPF_DIR\.install-mode") {
        $InstallMode = (Get-Content "$DPF_DIR\.install-mode").Trim()
    } elseif (Test-Path "$DPF_DIR\.git") {
        $InstallMode = "customizer"
    } else {
        $InstallMode = "consumer"
    }
    Write-OK "Already set up ($InstallMode mode)"
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

    # Select a Docker Model Runner model that fits comfortably in VRAM.
    # Docker Model Runner uses Docker Desktop's built-in GPU passthrough.
    # Model IDs use the ai/ namespace WITHOUT Ollama-style quantization tags.
    # Docker Model Runner selects the best quantization internally.
    if ($gpuVRAM_GB -ge 6) {
        $selectedModel = "ai/llama3.1"
        $modelReason = "high-quality chat -- fits in your GPU memory"
    } elseif ($gpuVRAM_GB -ge 3) {
        $selectedModel = "ai/llama3.2"
        $modelReason = "balanced quality, GPU-accelerated"
    } elseif ($totalRAM_GB -ge 16) {
        $selectedModel = "ai/llama3.1"
        $modelReason = "high-quality chat, fits your RAM (CPU mode)"
    } elseif ($totalRAM_GB -ge 8) {
        $selectedModel = "ai/llama3.2"
        $modelReason = "fast, works well on your hardware"
    } else {
        $selectedModel = "ai/llama3.2"
        $modelReason = "lightweight, optimized for your hardware"
    }
    Write-Action "Selected AI model: $selectedModel ($modelReason)"
    Write-Action "Models are managed by Docker Model Runner (built into Docker Desktop)."

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

    # Docker Model Runner uses Docker Desktop's built-in GPU support — no override needed.

    # Save for later steps
    $hostProfile | Set-Content "$DPF_DIR\.host-profile.json"
    $selectedModel | Set-Content "$DPF_DIR\.selected-model"

    Save-Progress "hardware"
} else {
    Write-OK "Already detected"
    $selectedModel = Get-Content "$DPF_DIR\.selected-model" -ErrorAction SilentlyContinue
    if (-not $selectedModel) { $selectedModel = "ai/llama3.2" }
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
NEO4J_PASSWORD=$neoPass
AUTH_SECRET=$authSecret
CREDENTIAL_ENCRYPTION_KEY=$encKey
NEO4J_URI=bolt://neo4j:7687
ADMIN_PASSWORD=$adminPass
DPF_HOST_PROFILE=$hostProfileJson
LLM_BASE_URL=http://model-runner.docker.internal/v1
"@ | Set-Content "$DPF_DIR\.env"
}

# --- Step 6: Start Platform ---------------------------------------------------

Write-Step 6 9 "Starting the platform..."
if (-not (Is-StepDone "started")) {
    Set-Location $DPF_DIR

    if ($InstallMode -eq "consumer") {
        Write-Action "Pulling pre-built images (this may take a few minutes, be patient)..."
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        docker compose --progress plain pull 2>&1 | ForEach-Object { "$_" }
        $pullExit = $LASTEXITCODE
        $ErrorActionPreference = $oldEAP
        if ($pullExit -ne 0) {
            Write-Warn "Failed to pull images. Check your internet connection."
            Write-Warn "You can retry with: docker compose pull"
            exit 1
        }
    } else {
        Write-Action "Building the portal (first time takes 3-5 minutes)..."
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        docker compose build --quiet 2>&1 | Out-Null
        $buildExit = $LASTEXITCODE
        $ErrorActionPreference = $oldEAP
        if ($buildExit -ne 0) {
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            docker compose build
            $buildExit = $LASTEXITCODE
            $ErrorActionPreference = $oldEAP
            if ($buildExit -ne 0) {
                Write-Warn "Build failed. Check the output above for errors."
                exit 1
            }
        }
    }

    Write-Action "Starting database and portal..."
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    docker compose up -d
    $ErrorActionPreference = $oldEAP

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
    # Pull model via Docker Model Runner (built into Docker Desktop 4.40+)
    Write-Action "Pulling AI model $selectedModel via Docker Model Runner, these may be big..."
    Write-Action "This may take several minutes depending on your internet speed, and size of your video card."
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    docker model pull $selectedModel 2>&1
    $pullExit = $LASTEXITCODE
    $ErrorActionPreference = $oldEAP
    if ($pullExit -ne 0) {
        Write-Warn "Model pull may have failed. Check: docker model list"
        Write-Warn "You can pull manually later: docker model pull $selectedModel"
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
    if (Ensure-DPFStartupTask -taskName $AUTOSTART_TASK_NAME -startScriptPath "$DPF_DIR\dpf-start.ps1") {
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

