param(
    [string]$DPF_DIR = $PSScriptRoot,
    [switch]$NoBrowser
)

Set-Location $DPF_DIR
docker compose up -d
if (-not $NoBrowser) {
    Start-Sleep -Seconds 5
    Start-Process "http://localhost:3000"
    Write-Host "Digital Product Factory is starting at http://localhost:3000" -ForegroundColor Green
}