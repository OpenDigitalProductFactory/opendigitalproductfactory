param(
    [string]$DPF_DIR = $PSScriptRoot
)

Set-Location $DPF_DIR

$composeChainModule = Join-Path $DPF_DIR "scripts\installer\lib\compose-chain.ps1"
if (-not (Test-Path -LiteralPath $composeChainModule)) { throw "compose_chain_helper_missing" }
. $composeChainModule
$composeArgs = Get-DPFComposeArgs -InstallDir $DPF_DIR -Purpose Stop

docker compose @composeArgs down
Write-Host "Digital Product Factory stopped." -ForegroundColor Yellow
