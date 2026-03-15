param(
    [string]$DPF_DIR = $PSScriptRoot
)

Set-Location $DPF_DIR
docker compose down
Write-Host "Digital Product Factory stopped." -ForegroundColor Yellow