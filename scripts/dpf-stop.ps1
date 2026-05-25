param(
    [string]$DPF_DIR = $PSScriptRoot
)

Set-Location $DPF_DIR

$composeArgs = @("-f", "docker-compose.yml")
if (Test-Path (Join-Path $DPF_DIR "docker-compose.override.yml")) {
    $composeArgs += @("-f", "docker-compose.override.yml")
}
if (Test-Path (Join-Path $DPF_DIR "docker-compose.edge.yml")) {
    $composeArgs += @("-f", "docker-compose.edge.yml")
}

docker compose @composeArgs down
Write-Host "Digital Product Factory stopped." -ForegroundColor Yellow
