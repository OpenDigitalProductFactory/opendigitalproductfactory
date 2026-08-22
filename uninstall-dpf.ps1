#Requires -Version 5.1
param(
    [string]$InstallDir = $PSScriptRoot,
    [switch]$Purge,
    [switch]$KeepEnv,
    [switch]$KeepState,
    [switch]$Headless,
    [switch]$Yes,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$DPF_DIR = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$AUTOSTART_TASK_NAME = "DPF-AutoStart"
$NATIVE_EDGE_TASK_NAME = "DPF-Native-Edge-Node"

function Invoke-DPFUninstallCommand {
    param([Parameter(Mandatory)][scriptblock]$Action, [Parameter(Mandatory)][string]$Description)
    if ($DryRun) { Write-Host "  would: $Description"; return }
    & $Action
}

function Assert-DPFPurgeTarget {
    param([Parameter(Mandatory)][string]$Path)
    $resolved = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $driveRoot = [IO.Path]::GetPathRoot($resolved).TrimEnd('\')
    $profileRoot = if ($env:USERPROFILE) { [IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\') } else { "" }
    if (-not $resolved -or $resolved -eq $driveRoot -or $resolved -eq $profileRoot) {
        throw "unsafe_uninstall_target:$resolved"
    }
    return $resolved
}

if (($KeepEnv -or $KeepState) -and -not $Purge) {
    throw "-KeepEnv and -KeepState only apply with -Purge"
}
if ($Headless -and $Purge -and -not $Yes) {
    throw "-Headless -Purge requires -Yes to confirm destructive intent"
}

Write-Host ""
Write-Host "Open Digital Product Factory - Uninstaller" -ForegroundColor Cyan
Write-Host "  Install: $DPF_DIR"
Write-Host "  Tier:    $(if ($Purge) { 'PURGE (destructive)' } else { 'soft (data preserved)' })$(if ($DryRun) { ' [dry-run]' })"
Write-Host ""

if ($Purge -and -not $Yes) {
    Write-Host "Purge permanently deletes DPF volumes, install files, and local state." -ForegroundColor Red
    $confirmation = Read-Host "Type 'purge' to continue"
    if ($confirmation -cne "purge") {
        Write-Host "Uninstall cancelled." -ForegroundColor Yellow
        exit 0
    }
}

if (Test-Path -LiteralPath (Join-Path $DPF_DIR "docker-compose.yml")) {
    $composeChainModule = Join-Path $DPF_DIR "scripts\installer\lib\compose-chain.ps1"
    if (-not (Test-Path -LiteralPath $composeChainModule)) {
        $composeChainModule = Join-Path $PSScriptRoot "scripts\installer\lib\compose-chain.ps1"
    }
    if (-not (Test-Path -LiteralPath $composeChainModule)) { throw "compose_chain_helper_missing" }
    . $composeChainModule
    $composeArgs = Get-DPFComposeArgs -InstallDir $DPF_DIR -Purpose Stop
    Set-Location $DPF_DIR
    $downArgs = @("compose") + @($composeArgs) + @("down", "--remove-orphans")
    if ($Purge) { $downArgs += @("--volumes", "--rmi", "local") }
    Invoke-DPFUninstallCommand -Description "stop the complete compose stack$(if ($Purge) { ' and remove volumes' })" -Action {
        & docker @downArgs
        if ($LASTEXITCODE -ne 0) { throw "compose_down_failed:$LASTEXITCODE" }
    }
} else {
    Write-Host "  No docker-compose.yml found; compose shutdown skipped." -ForegroundColor Yellow
}

foreach ($taskName in @($AUTOSTART_TASK_NAME, $NATIVE_EDGE_TASK_NAME)) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Invoke-DPFUninstallCommand -Description "remove scheduled task $taskName" -Action {
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        }
    }
}

if ($Purge) {
    $safeTarget = Assert-DPFPurgeTarget -Path $DPF_DIR
    $preservedEnv = "$safeTarget.env.preserved"
    if ($KeepEnv -and (Test-Path -LiteralPath (Join-Path $safeTarget ".env"))) {
        Invoke-DPFUninstallCommand -Description "preserve .env at $preservedEnv" -Action {
            Copy-Item -LiteralPath (Join-Path $safeTarget ".env") -Destination $preservedEnv -Force
        }
    }

    $safeWorkingDirectory = if ($env:USERPROFILE) { $env:USERPROFILE } else { [IO.Path]::GetPathRoot($safeTarget) }
    Set-Location $safeWorkingDirectory
    if (Test-Path -LiteralPath $safeTarget) {
        Invoke-DPFUninstallCommand -Description "remove verified install directory $safeTarget" -Action {
            Remove-Item -LiteralPath $safeTarget -Recurse -Force
        }
    }

    if (-not $KeepState) {
        $stateDir = if ($env:DPF_STATE_DIR) { $env:DPF_STATE_DIR } else { Join-Path $env:USERPROFILE ".dpf" }
        if ($stateDir -and (Test-Path -LiteralPath $stateDir)) {
            $safeState = Assert-DPFPurgeTarget -Path $stateDir
            Invoke-DPFUninstallCommand -Description "remove verified state directory $safeState" -Action {
                Remove-Item -LiteralPath $safeState -Recurse -Force
            }
        }
    }
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -like "*$DPF_DIR*") {
    Invoke-DPFUninstallCommand -Description "remove DPF from the user PATH" -Action {
        $newPath = ($userPath -split ";" | Where-Object { $_ -and $_ -ne $DPF_DIR }) -join ";"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    }
}

Write-Host ""
if ($DryRun) {
    Write-Host "Dry-run complete; no changes made." -ForegroundColor Green
} elseif ($Purge) {
    Write-Host "Purge complete. DPF data and install files were removed." -ForegroundColor Green
    if ($KeepEnv) { Write-Host "Preserved environment: $DPF_DIR.env.preserved" }
} else {
    Write-Host "Soft uninstall complete. Containers stopped; volumes, .env, install files, and state were preserved." -ForegroundColor Green
    Write-Host "Re-run install-dpf.ps1 to resume, or use -Purge for permanent removal."
}
