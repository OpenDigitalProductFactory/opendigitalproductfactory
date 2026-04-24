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

function Test-StepDone($step) {
    $progress = Get-Progress
    return $progress.completedSteps -contains $step
}

function New-RandomPassword($length = 32) {
    $bytes = New-Object byte[] $length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join "" | Select-Object -First 1
}

function New-RandomAlphanumeric($length = 16) {
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    $bytes = New-Object byte[] $length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Register-DPFStartupTask {
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

Write-Step 1 10 "Checking Windows version..."
if (-not (Test-StepDone "windows_check")) {
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

Write-Step 2 10 "Setting up WSL2..."
if (-not (Test-StepDone "wsl2")) {
    # Windows 11 24H2+ (build 26100+) ships WSL as an inbox component, not a DISM
    # optional feature. Detect this by checking if "wsl --version" succeeds.
    $wslInbox = $false
    try {
        wsl --version 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $wslInbox = $true }
    } catch { }

    if ($wslInbox) {
        Write-Action "WSL is built into this Windows version -- no feature enablement needed"
    } else {
        # Legacy path: Windows 10 / Windows 11 pre-24H2
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
    }

    # Set WSL default version
    wsl --set-default-version 2 2>$null

    Write-OK "WSL2 is ready"
    Save-Progress "wsl2"
} else {
    Write-OK "Already set up"
}

# Handle partial WSL2 (resume after reboot)
if ((Test-StepDone "wsl2_partial") -and -not (Test-StepDone "wsl2")) {
    wsl --set-default-version 2 2>$null
    Write-OK "WSL2 is ready (resumed after restart)"
    Save-Progress "wsl2"
}

# --- Step 3: Docker Desktop ---------------------------------------------------

Write-Step 3 10 "Installing Docker Desktop..."
if (-not (Test-StepDone "docker")) {
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

# --- Step 4: Install Windows Exporter (host metrics for network discovery) ----

Write-Step 4 10 "Installing Windows metrics exporter..."
if (-not (Test-StepDone "windows_exporter")) {
    $weService = Get-Service -Name "windows_exporter" -ErrorAction SilentlyContinue
    if ($weService) {
        Write-OK "windows_exporter service already installed"
    } else {
        Write-Action "Installing windows_exporter for real host network discovery..."

        $weVersion = "0.30.5"
        $weUrl = "https://github.com/prometheus-community/windows_exporter/releases/download/v${weVersion}/windows_exporter-${weVersion}-amd64.msi"
        $weMsi = "$env:TEMP\windows_exporter.msi"

        try {
            Write-Action "Downloading windows_exporter v${weVersion}..."
            Invoke-WebRequest -Uri $weUrl -OutFile $weMsi -UseBasicParsing

            Write-Action "Installing silently (creates Windows service + firewall rule)..."
            $msiCmd = "/i `"$weMsi`" /quiet /norestart ENABLED_COLLECTORS=cpu,memory,net,logical_disk,os,system,thermalzone ADDLOCAL=FirewallException /L*v `"$env:TEMP\windows_exporter_install.log`""
            Start-Process -FilePath "msiexec.exe" -ArgumentList $msiCmd -Wait -NoNewWindow

            # Verify it installed
            Start-Sleep -Seconds 3
            $weCheck = Get-Service -Name "windows_exporter" -ErrorAction SilentlyContinue
            if ($weCheck -and $weCheck.Status -eq "Running") {
                Write-OK "windows_exporter installed and running on port 9182"
            } else {
                # Try to start it
                Start-Service -Name "windows_exporter" -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 2
                $weCheck = Get-Service -Name "windows_exporter" -ErrorAction SilentlyContinue
                if ($weCheck -and $weCheck.Status -eq "Running") {
                    Write-OK "windows_exporter started on port 9182"
                } else {
                    Write-Warn "windows_exporter installed but may not be running. Check: Get-Service windows_exporter"
                }
            }

            Remove-Item $weMsi -ErrorAction SilentlyContinue
        } catch {
            Write-Warn "Could not install windows_exporter: $_"
            Write-Warn "Network discovery will be limited to Docker-internal topology."
            Write-Warn "You can install it manually: choco install prometheus-windows-exporter.install"
        }
    }
    Save-Progress "windows_exporter"
} else {
    Write-OK "Already installed"
}

# --- Step 5: Choose install mode and set up files ----------------------------

Write-Step 5 10 "Setting up Digital Product Factory..."
if (-not (Test-StepDone "download")) {

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
        Write-Host "    [1] Ready to go   - Pre-built: Use Build Studio inside the portal to extend the platform." -ForegroundColor White
        Write-Host "    [2] Customizable  - Full source code: Build Studio + VS Code work from the same shared workspace." -ForegroundColor White
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
            git clone "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git" "$DPF_DIR" 2>&1 | ForEach-Object { "$_" }
            $ErrorActionPreference = $oldEAP
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "Clone failed. Check your internet connection."
                exit 1
            }
            foreach ($f in $stash.Keys) { $stash[$f] | Set-Content "$DPF_DIR\$f" }

            # Create one durable branch for this install's local customization work.
            # Generate a stable anonymous instance ID (8-char hex from GUID hash).
            # This replaces $env:COMPUTERNAME which would leak the machine name
            # to any public git repo this branch is pushed to.
            $instanceIdFile = "$DPF_DIR\.dpf-instance-id"
            if (Test-Path $instanceIdFile) {
                $instanceId = (Get-Content $instanceIdFile).Trim()
            } else {
                $guid = [System.Guid]::NewGuid().ToString()
                $sha = [System.Security.Cryptography.SHA256]::Create()
                $hashBytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($guid))
                $instanceId = ($hashBytes[0..3] | ForEach-Object { $_.ToString("x2") }) -join ""
                $instanceId | Set-Content $instanceIdFile
            }
            $branchName = "dpf/$instanceId"
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            git -C "$DPF_DIR" checkout -b $branchName 2>&1 | Out-Null
            $ErrorActionPreference = $oldEAP
            Write-OK "Cloned source on branch '$branchName'"
            Write-Action "This is the per-install branch. Build Studio and VS Code share this workspace."
            Write-Action "For feature work, create short-lived topic branches off 'main' (feat/*, fix/*, chore/*) and open PRs -- see CONTRIBUTING.md."

            # Convenience scripts for customizer mode
            Copy-Item "$DPF_DIR\scripts\dpf-start.ps1" "$DPF_DIR\dpf-start.ps1" -ErrorAction SilentlyContinue
            Copy-Item "$DPF_DIR\scripts\dpf-stop.ps1" "$DPF_DIR\dpf-stop.ps1" -ErrorAction SilentlyContinue
            Copy-Item "$DPF_DIR\scripts\dpf-start.bat" "$DPF_DIR\dpf-start.bat" -ErrorAction SilentlyContinue
            Copy-Item "$DPF_DIR\scripts\dpf-stop.bat" "$DPF_DIR\dpf-stop.bat" -ErrorAction SilentlyContinue

            # Enable in-repo git hooks (Prisma migration guard) for customizer installs.
            # Consumer installs have no git checkout so this does not apply to that branch.
            git -C $DPF_DIR config core.hooksPath .githooks 2>&1 | Out-Null

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
      start_period: 10s

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
      test: ["CMD-SHELL", "bash -c 'echo > /dev/tcp/localhost/6333 || exit 1'"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s

  portal-init:
    image: $($GHCR_PORTAL):$Version
    command: ["/docker-entrypoint.sh"]
    volumes:
      - dpf-source-code:/workspace
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
      - dpf-source-code:/workspace
      - sandbox_workspace:/sandbox-workspace
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
      DPF_HOST_INSTALL_PATH: `${DPF_HOST_INSTALL_PATH:-}
      PROJECT_ROOT: /workspace
      SANDBOX_PREVIEW_URL: http://sandbox:3000
    depends_on:
      portal-init:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  # ─── Sandbox Database (isolated from production) ────────────────────
  sandbox-postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: dpf
      POSTGRES_PASSWORD: dpf_sandbox
      POSTGRES_DB: dpf
    volumes:
      - sandbox_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dpf"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 10s

  # ─── Sandbox Init (migrations on sandbox DB) ──────────────────────
  sandbox-init:
    image: $($GHCR_PORTAL):$Version
    command: ["/docker-entrypoint.sh"]
    environment:
      DATABASE_URL: postgresql://dpf:dpf_sandbox@sandbox-postgres:5432/dpf
      ADMIN_PASSWORD: `${ADMIN_PASSWORD}
    volumes:
      - sandbox_workspace:/workspace
    depends_on:
      sandbox-postgres:
        condition: service_healthy

  # ─── Sandbox (isolated build environment for Build Studio) ──────────
  sandbox:
    image: $($GHCR_SANDBOX):$Version
    restart: unless-stopped
    ports:
      - "3035:3000"
    volumes:
      - sandbox_workspace:/workspace
    environment:
      DATABASE_URL: postgresql://dpf:dpf_sandbox@sandbox-postgres:5432/dpf
      AUTH_SECRET: `${AUTH_SECRET}
      AUTH_TRUST_HOST: "true"
      APP_URL: http://localhost:3035
      NEO4J_URI: bolt://neo4j:7687
      NEO4J_USER: neo4j
      NEO4J_PASSWORD: `${NEO4J_PASSWORD}
      QDRANT_INTERNAL_URL: http://qdrant:6333
      NODE_ENV: development
    depends_on:
      sandbox-init:
        condition: service_completed_successfully

  # ─── Promoter (autonomous deployment pipeline) ─────────────────────
  # One-shot container — triggered by Build Studio ship phase or ops UI.
  promoter:
    image: dpf-promoter:latest
    entrypoint: ["/promoter/promote.sh"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - backups:/backups
      - ./docker-compose.yml:/host-source/docker-compose.yml:ro
      - ./.env:/host-source/.env:ro
    environment:
      DPF_PRODUCTION_DB_CONTAINER: dpf-postgres-1
      DPF_PORTAL_CONTAINER: dpf-portal-1
      DPF_COMPOSE_PROJECT: dpf
      POSTGRES_USER: `${POSTGRES_USER:-dpf}
      POSTGRES_DB: dpf
    depends_on:
      postgres:
        condition: service_healthy
    profiles: ["promote"]
    restart: "no"

  # --- Monitoring Stack ---------------------------------------------------
  # Prometheus + Grafana + exporters for infrastructure discovery and health.
  # node-exporter runs on the HOST network so it sees real interfaces.

  prometheus:
    image: prom/prometheus:latest
    restart: unless-stopped
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./monitoring/prometheus/alerts.yml:/etc/prometheus/alerts.yml:ro
      - prometheus_data:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.retention.time=15d"
      - "--web.enable-lifecycle"
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://localhost:9090/-/healthy"]
      interval: 10s
      timeout: 5s
      retries: 3

  grafana:
    image: grafana/grafana-oss:latest
    restart: unless-stopped
    ports:
      - "3002:3000"
    volumes:
      - ./monitoring/grafana/provisioning:/etc/grafana/provisioning:ro
      - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards:ro
      - grafana_data:/var/lib/grafana
    environment:
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD: dpf_monitor
      GF_USERS_ALLOW_SIGN_UP: "false"
      GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH: /var/lib/grafana/dashboards/dpf-overview.json
    depends_on:
      prometheus:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://localhost:3000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /sys:/sys:ro
      - /var/lib/docker:/var/lib/docker:ro
    privileged: true

  node-exporter:
    image: prom/node-exporter:latest
    restart: unless-stopped
    ports:
      - "9100:9100"
    pid: host
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - "--path.procfs=/host/proc"
      - "--path.sysfs=/host/sys"
      - "--path.rootfs=/rootfs"
      - "--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)"

  postgres-exporter:
    image: prometheuscommunity/postgres-exporter:latest
    restart: unless-stopped
    ports:
      - "9187:9187"
    environment:
      DATA_SOURCE_NAME: postgresql://`${POSTGRES_USER:-dpf}:`${POSTGRES_PASSWORD}@postgres:5432/dpf?sslmode=disable
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  dpf-source-code:
  pgdata:
  neo4jdata:
  qdrant_data:
  sandbox_pgdata:
  sandbox_workspace:
  backups:
  prometheus_data:
  grafana_data:
"@ | Set-Content "$DPF_DIR\docker-compose.yml" -Encoding UTF8

            # Write monitoring configuration files (Prometheus + Grafana)
            $monDir = "$DPF_DIR\monitoring"
            New-Item -ItemType Directory -Path "$monDir\prometheus" -Force | Out-Null
            New-Item -ItemType Directory -Path "$monDir\grafana\provisioning\datasources" -Force | Out-Null
            New-Item -ItemType Directory -Path "$monDir\grafana\provisioning\dashboards" -Force | Out-Null
            New-Item -ItemType Directory -Path "$monDir\grafana\dashboards" -Force | Out-Null

            # Prometheus config
            @"
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "alerts.yml"

scrape_configs:
  - job_name: "cadvisor"
    scrape_interval: 10s
    static_configs:
      - targets: ["cadvisor:8080"]

  - job_name: "node-exporter"
    scrape_interval: 10s
    static_configs:
      - targets: ["node-exporter:9100"]

  - job_name: "postgres"
    static_configs:
      - targets: ["postgres-exporter:9187"]

  - job_name: "qdrant"
    scrape_interval: 30s
    static_configs:
      - targets: ["qdrant:6333"]
    metrics_path: /metrics

  - job_name: "portal"
    static_configs:
      - targets: ["portal:3000"]
    metrics_path: /api/metrics

  - job_name: "sandbox"
    static_configs:
      - targets: ["sandbox:3000"]
    metrics_path: /api/metrics

  - job_name: "model-runner"
    scrape_interval: 30s
    static_configs:
      - targets: ["model-runner.docker.internal:80"]
    metrics_path: /metrics

  - job_name: "windows-host"
    scrape_interval: 15s
    static_configs:
      - targets: ["host.docker.internal:9182"]
        labels:
          instance: "windows-host"

  - job_name: "prometheus"
    scrape_interval: 30s
    static_configs:
      - targets: ["localhost:9090"]
"@ | Set-Content "$monDir\prometheus\prometheus.yml" -Encoding UTF8

            # Prometheus alerts
            @"
groups:
  - name: dpf_infrastructure
    rules:
      - alert: ContainerDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Service {{ `$labels.job }} is down"

      - alert: HostHighCPU
        expr: 100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 85
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Host CPU usage above 85% for 10 minutes"

      - alert: HostHighMemory
        expr: (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Host memory usage above 85%"

      - alert: HostNetworkInterfaceDown
        expr: node_network_up{device!~"lo|veth.*|br-.*|docker.*"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Network interface {{ `$labels.device }} is down"

  - name: dpf_databases
    rules:
      - alert: PostgresDown
        expr: pg_up == 0
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL is unreachable"

      - alert: QdrantDown
        expr: up{job="qdrant"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Qdrant vector DB is unreachable"
"@ | Set-Content "$monDir\prometheus\alerts.yml" -Encoding UTF8

            # Grafana datasource
            @"
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
"@ | Set-Content "$monDir\grafana\provisioning\datasources\prometheus.yml" -Encoding UTF8

            # Grafana dashboard provisioner
            @"
apiVersion: 1
providers:
  - name: DPF
    orgId: 1
    folder: DPF Platform
    type: file
    disableDeletion: true
    editable: false
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: false
"@ | Set-Content "$monDir\grafana\provisioning\dashboards\dashboards.yml" -Encoding UTF8

            # Grafana overview dashboard (minimal)
            @"
{"editable":false,"panels":[{"title":"Platform Services","type":"stat","gridPos":{"h":4,"w":24,"x":0,"y":0},"targets":[{"expr":"up","legendFormat":"{{ job }}","refId":"A"}],"fieldConfig":{"defaults":{"mappings":[{"type":"value","options":{"0":{"text":"DOWN","color":"red"},"1":{"text":"UP","color":"green"}}}],"thresholds":{"mode":"absolute","steps":[{"color":"red","value":null},{"color":"green","value":1}]}},"overrides":[]},"options":{"colorMode":"background","graphMode":"none","justifyMode":"auto","textMode":"auto","reduceOptions":{"calcs":["lastNotNull"],"fields":"","values":false}}}],"schemaVersion":39,"tags":["dpf","overview"],"templating":{"list":[]},"time":{"from":"now-1h","to":"now"},"timepicker":{},"timezone":"browser","title":"DPF Platform Overview","uid":"dpf-overview","version":1}
"@ | Set-Content "$monDir\grafana\dashboards\dpf-overview.json" -Encoding UTF8

            Write-OK "Created monitoring configuration (Prometheus + Grafana)"

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

        Write-Host ""
        Write-Host "  While setup continues..." -ForegroundColor Cyan
        Write-Host "  - This install can stay private or later contribute improvements back through the Hive Mind." -ForegroundColor White
        Write-Host "  - That choice will be configured in the portal during setup, so you do not need a GitHub token yet." -ForegroundColor White
        if ($InstallMode -eq "customizer") {
            Write-Host "  - In customizable mode, Build Studio and VS Code will work from the same shared workspace." -ForegroundColor White
        } else {
            Write-Host "  - In ready-to-go mode, Build Studio is your guided interface for extending the platform." -ForegroundColor White
        }
        Write-Host "  - For the strongest AI-assisted development experience, plan on connecting a frontier-capable model once the portal is running." -ForegroundColor White

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

# --- Step 4.5: Developer environment setup (customizer mode only) -------------
# This runs as its own step so it executes even when "download" was already
# saved by a previous install run (e.g. with an older version of this script).

if ($InstallMode -eq "customizer" -and -not (Test-StepDone "dev_setup")) {
    Write-Host ""
    Write-Host "  Setting up developer environment..." -ForegroundColor Cyan

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Warn "Node.js v20+ is required for customizable mode."
        Write-Warn "Download from https://nodejs.org/ then re-run the installer."
        exit 1
    }
    $nodeVer = [int]((node -v).TrimStart('v').Split('.')[0])
    if ($nodeVer -lt 20) {
        Write-Warn "Node.js v20+ required. Current: $(node -v)"
        exit 1
    }
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Action "Installing pnpm..."
        npm install -g pnpm
    }

    # Hoisted layout avoids symlink permission issues on Windows (no Developer Mode needed)
    if (-not (Test-Path "$DPF_DIR\.npmrc")) {
        "node-linker=hoisted" | Set-Content -Path "$DPF_DIR\.npmrc" -Encoding UTF8
        Write-OK "Created .npmrc (node-linker=hoisted)"
    }

    Write-Action "Installing project dependencies (this may take a minute)..."
    Set-Location $DPF_DIR
    pnpm install
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "pnpm install failed. Check the output above."
        exit 1
    }
    Write-OK "Project dependencies installed"

    # App-level .env files for local Next.js and Prisma
    $envExamplePath = "$DPF_DIR\.env.example"
    if (Test-Path $envExamplePath) {
        $webEnvPath = "$DPF_DIR\apps\web\.env.local"
        if (-not (Test-Path $webEnvPath)) {
            $webContent = Get-Content $envExamplePath -Raw
            $webEncKey = -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Maximum 256) })
            $webContent = $webContent -replace '<generate with: openssl rand -hex 32>', $webEncKey
            $webAuthBytes = New-Object byte[] 32
            [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($webAuthBytes)
            $webAuthSecret = [Convert]::ToBase64String($webAuthBytes)
            $webContent = $webContent -replace '<generate with: openssl rand -base64 32>', $webAuthSecret
            $webContent | Set-Content $webEnvPath
            Write-OK "Created apps/web/.env.local"
        }
    } else {
        Write-Warn ".env.example not found -- skipping app-level .env creation"
    }

    # docker-compose.override.yml: expose DB ports for local development
    # Note: bind-mounting non-C: drives into Docker Desktop WSL2 is unreliable.
    # Named volumes (managed by Docker) are used for data; ports are exposed for pnpm dev.
    $overridePath = "$DPF_DIR\docker-compose.override.yml"
    if (-not (Test-Path $overridePath)) {
@"
# Auto-generated by DPF installer (customizer mode)
# Exposes database ports to the host so you can run pnpm dev locally.
# Also binds the checked-out repo into /workspace so Build Studio and VS Code
# operate on the same source tree.
services:
  postgres:
    ports:
      - "5432:5432"
  neo4j:
    ports:
      - "7687:7687"
      - "7474:7474"
  qdrant:
    ports:
      - "6333:6333"
  portal-init:
    volumes:
      - .:/workspace
  portal:
    volumes:
      - .:/workspace
"@ | Set-Content -Path $overridePath -Encoding UTF8
        Write-OK "Created docker-compose.override.yml (DB ports + shared workspace bind mount)"
    }

    Save-Progress "dev_setup"
} elseif ($InstallMode -eq "customizer") {
    Write-OK "Developer environment already set up"
}

# --- Step 5: Hardware Detection ------------------------------------------------

Write-Step 6 10 "Detecting your hardware..."
if (-not (Test-StepDone "hardware")) {
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

    # Select the largest Gemma 4 model that fits available VRAM.
    # Docker Model Runner uses Docker Desktop's built-in GPU passthrough.
    # Model IDs use the ai/ namespace -- Docker Model Runner picks quantization.
    if ($gpuVRAM_GB -ge 20) {
        $selectedModel = "ai/gemma4"
        $modelReason = "Gemma 4 31B -- best quality, fits your $gpuVRAM_GB GB VRAM"
    } elseif ($gpuVRAM_GB -ge 8) {
        $selectedModel = "ai/gemma3"
        $modelReason = "Gemma 3 12B -- strong quality, GPU-accelerated"
    } elseif ($gpuVRAM_GB -ge 4) {
        $selectedModel = "ai/gemma3"
        $modelReason = "Gemma 3 4B -- balanced quality, GPU-accelerated"
    } elseif ($totalRAM_GB -ge 16) {
        $selectedModel = "ai/gemma3"
        $modelReason = "Gemma 3 -- fits your RAM (CPU mode)"
    } else {
        $selectedModel = "ai/gemma3"
        $modelReason = "Gemma 3 -- lightweight, runs on your hardware"
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
    if (-not $selectedModel) { $selectedModel = "ai/gemma3" }
}

# --- Generate .env -------------------------------------------------------------

if (-not (Test-Path "$DPF_DIR\.env")) {
    $pgPass = New-RandomPassword 16
    $neoPass = New-RandomPassword 16
    $authSecret = New-RandomPassword 32
    $encKey = New-RandomPassword 32
    $adminPass = New-RandomAlphanumeric 16
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
DPF_HOST_INSTALL_PATH=$DPF_DIR
LLM_BASE_URL=http://model-runner.docker.internal/v1
GF_ADMIN_USER=admin
GF_ADMIN_PASSWORD=$adminPass
"@ | Set-Content "$DPF_DIR\.env"
}

# --- Step 6: Start Platform ---------------------------------------------------

Write-Step 7 10 "Starting the platform..."
if (-not (Test-StepDone "started")) {
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

    # Promoter image is built just-in-time by the portal on first promotion.
    # The build files (Dockerfile.promoter, promote.sh, portal Dockerfile)
    # are baked into the portal image at /promoter/.

    Write-Action "Starting database and portal..."
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    docker compose up -d
    $ErrorActionPreference = $oldEAP

    # Sync postgres password — if the volume was reused from a prior install,
    # the DB user still has the old password. Update it to match the new .env.
    Write-Action "Syncing database credentials..."
    $envPgPass = (Get-Content "$DPF_DIR\.env" | Select-String "^POSTGRES_PASSWORD=(.+)$").Matches.Groups[1].Value
    if ($envPgPass) {
        $syncAttempts = 0
        while ($syncAttempts -lt 15) {
            $oldEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            docker exec dpf-postgres-1 psql -U dpf -d dpf -c "ALTER USER dpf PASSWORD '$envPgPass';" 2>&1 | Out-Null
            $ErrorActionPreference = $oldEAP
            if ($LASTEXITCODE -eq 0) { break }
            $syncAttempts++
            Start-Sleep -Seconds 2
        }
    }

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

    # For customizer mode: generate Prisma client on the host so local `pnpm dev` works
    if ($InstallMode -eq "customizer") {
        Write-Action "Generating Prisma client for local development..."
        Set-Location $DPF_DIR
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        pnpm --filter @dpf/db exec prisma generate 2>&1 | Out-Null
        $ErrorActionPreference = $oldEAP
        if ($LASTEXITCODE -eq 0) {
            Write-OK "Prisma client generated"
        } else {
            Write-Warn "Prisma client generation failed -- run manually: pnpm --filter @dpf/db exec prisma generate"
        }
    }

    Save-Progress "started"
} else {
    Write-OK "Already running"
}

# --- Step 7: Wait for AI Model -------------------------------------------------

Write-Step 8 10 "Setting up your AI Coworker..."
if (-not (Test-StepDone "model")) {
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

Write-Step 9 10 "Configuring auto-start on logon..."
if (-not (Test-StepDone "autostart")) {
    if (Register-DPFStartupTask -taskName $AUTOSTART_TASK_NAME -startScriptPath "$DPF_DIR\dpf-start.ps1") {
        Save-Progress "autostart"
    }
} else {
    Write-OK "Already configured"
}

Write-Step 10 10 "Opening your portal!"

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
Write-Host "  |                                                      |" -ForegroundColor Green
Write-Host "  |  System Health: Operations > System Health tab        |" -ForegroundColor Green
if ($InstallMode -eq "customizer") {
    Write-Host "  |                                                      |" -ForegroundColor Green
    Write-Host "  |  Local dev: cd $($DPF_DIR.PadRight(38))|" -ForegroundColor Cyan
    Write-Host "  |             pnpm dev                                 |" -ForegroundColor Cyan
    Write-Host "  |  Databases exposed: postgres :5432, neo4j :7687      |" -ForegroundColor Cyan
}
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

