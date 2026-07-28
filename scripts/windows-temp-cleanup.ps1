#Requires -Version 5.1
# scripts/windows-temp-cleanup.ps1
#
# Clears WSL crash dumps and orphaned WSL2 swap.vhdx files from
# %LOCALAPPDATA%\Temp. WSL2 writes a crash dump per crashed process (postgres,
# node, prisma-engine, etc. have all been observed) to a `wsl-crashes` folder
# that nothing else prunes, and leaves a `swap.vhdx` behind under a
# session-scoped GUID folder for every WSL session that ends abnormally.
# Both accumulate unbounded -- one observed case reached 60GB+ combined and
# took Windows' system drive from 96% to critically full.
#
# SAFETY: swap.vhdx files are only ever deleted after confirming the file is
# NOT currently open (a live WSL/Docker-Desktop session's swap file is always
# locked while that session runs). A locked file is left alone and reported,
# never force-closed. wsl-crashes contents are static once written (a crash
# dump is not reopened after the crash), so no lock check is needed there.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-temp-cleanup.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows-temp-cleanup.ps1 -WhatIf
#
# No-op (prints a note and exits 0) on non-Windows or when %LOCALAPPDATA% is
# unset, so it is safe to invoke unconditionally from cross-platform tooling.

[CmdletBinding()]
param(
    [switch]$WhatIf
)

$ErrorActionPreference = 'Continue'

if (-not $env:LOCALAPPDATA) {
    Write-Output "windows-temp-cleanup: LOCALAPPDATA not set (not Windows?) -- nothing to do."
    exit 0
}

$tempRoot = Join-Path $env:LOCALAPPDATA 'Temp'
if (-not (Test-Path -LiteralPath $tempRoot)) {
    Write-Output "windows-temp-cleanup: $tempRoot not found -- nothing to do."
    exit 0
}

function Get-DirSizeGB {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    $bytes = (Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    if (-not $bytes) { return 0 }
    return [math]::Round($bytes / 1GB, 2)
}

function Test-FileLocked {
    param([string]$Path)
    try {
        $stream = [System.IO.File]::Open($Path, 'Open', 'ReadWrite', 'None')
        $stream.Close()
        return $false
    } catch {
        return $true
    }
}

$reclaimedGB = 0.0

# 1. wsl-crashes -- static dump files, no lock check needed.
$crashDir = Join-Path $tempRoot 'wsl-crashes'
if (Test-Path -LiteralPath $crashDir) {
    $size = Get-DirSizeGB $crashDir
    if ($WhatIf) {
        Write-Output ("would remove wsl-crashes ({0:N2} GB)" -f $size)
    } else {
        Remove-Item -LiteralPath $crashDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Output ("removed wsl-crashes ({0:N2} GB)" -f $size)
        $reclaimedGB += $size
    }
} else {
    Write-Output "wsl-crashes: none present"
}

# 2. Orphaned swap.vhdx files -- only under GUID-shaped temp folders, only if unlocked.
$guidPattern = '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
$candidates = Get-ChildItem -LiteralPath $tempRoot -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match $guidPattern } |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'swap.vhdx') }

$skippedLocked = 0
foreach ($dir in $candidates) {
    $swapFile = Join-Path $dir.FullName 'swap.vhdx'
    if (Test-FileLocked -Path $swapFile) {
        $skippedLocked++
        continue
    }
    $size = Get-DirSizeGB $dir.FullName
    if ($WhatIf) {
        Write-Output ("would remove orphaned swap.vhdx dir {0} ({1:N2} GB)" -f $dir.Name, $size)
    } else {
        Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue
        Write-Output ("removed orphaned swap.vhdx dir {0} ({1:N2} GB)" -f $dir.Name, $size)
        $reclaimedGB += $size
    }
}
if ($skippedLocked -gt 0) {
    Write-Output "skipped $skippedLocked swap.vhdx folder(s) still in use by a live WSL/Docker session (left alone, as expected)"
}

if (-not $WhatIf) {
    Write-Output ("windows-temp-cleanup: reclaimed {0:N2} GB total" -f $reclaimedGB)
}

exit 0
