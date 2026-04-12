# manage-local-models.ps1
# Helper script for managing local AI models via Docker Model Runner.
# The platform auto-discovers pulled models daily (4 AM) or when you
# click "Sync Models & Profiles" in Admin > External Services.
#
# Usage:
#   .\scripts\manage-local-models.ps1 list
#   .\scripts\manage-local-models.ps1 pull ai/gemma4
#   .\scripts\manage-local-models.ps1 rm ai/llama3.1
#   .\scripts\manage-local-models.ps1 search gemma

param(
    [Parameter(Position = 0, Mandatory = $true)]
    [ValidateSet("list", "pull", "rm", "search")]
    [string]$Action,

    [Parameter(Position = 1)]
    [string]$ModelName
)

$ErrorActionPreference = "Stop"

function Test-DockerModelRunner {
    try {
        $null = docker model list 2>&1
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

if (-not (Test-DockerModelRunner)) {
    Write-Host "ERROR: Docker Model Runner is not available." -ForegroundColor Red
    Write-Host "Make sure Docker Desktop 4.40+ is running with Model Runner enabled."
    exit 1
}

switch ($Action) {
    "list" {
        Write-Host "Local models:" -ForegroundColor Cyan
        docker model list
    }
    "pull" {
        if (-not $ModelName) {
            Write-Host "ERROR: Specify a model name. Example: .\scripts\manage-local-models.ps1 pull ai/gemma4" -ForegroundColor Red
            exit 1
        }
        Write-Host "Pulling $ModelName..." -ForegroundColor Cyan
        docker model pull $ModelName
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Done. The platform will discover this model at the next daily sync (4 AM)" -ForegroundColor Green
            Write-Host "or click 'Sync Models & Profiles' in Admin > External Services." -ForegroundColor Green
        }
    }
    "rm" {
        if (-not $ModelName) {
            Write-Host "ERROR: Specify a model name. Example: .\scripts\manage-local-models.ps1 rm ai/llama3.1" -ForegroundColor Red
            exit 1
        }
        Write-Host "Removing $ModelName..." -ForegroundColor Cyan
        docker model rm $ModelName
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Done. The model will be retired at the next discovery sync." -ForegroundColor Green
        }
    }
    "search" {
        if (-not $ModelName) {
            Write-Host "ERROR: Specify a search term. Example: .\scripts\manage-local-models.ps1 search gemma" -ForegroundColor Red
            exit 1
        }
        Write-Host "Searching for '$ModelName'..." -ForegroundColor Cyan
        docker model search $ModelName
    }
}
