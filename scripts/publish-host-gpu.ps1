# Publish nvidia-smi into the DPF state dir so the portal can defer local
# completion while another program owns the GPU. The portal container on
# Windows Docker Desktop cannot run nvidia-smi. A second start exits while
# this publisher is still alive. A missing nvidia-smi leaves no snapshot,
# and a missing snapshot does not itself defer the local model.

$ErrorActionPreference = "SilentlyContinue"

if ($env:DPF_STATE_DIR -and $env:DPF_STATE_DIR.Trim().Length -gt 0) {
    $stateDir = $env:DPF_STATE_DIR.Trim()
} else {
    $stateDir = Join-Path $env:USERPROFILE ".dpf"
}
if (-not (Test-Path -LiteralPath $stateDir)) {
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
}

$pidFile = Join-Path $stateDir "host-gpu-publisher.pid"
$outFile = Join-Path $stateDir "host-gpu.json"

if (Test-Path -LiteralPath $pidFile) {
    $existingText = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existingText -match '^\d+$') {
        $existing = Get-Process -Id ([int]$existingText) -ErrorAction SilentlyContinue
        if ($existing -and -not $existing.HasExited -and $existing.ProcessName -match 'powershell|pwsh') {
            exit 0
        }
    }
}
Set-Content -LiteralPath $pidFile -Value $PID -Encoding ascii

function Write-HostGpuSnapshot {
    $raw = & nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits 2>$null | Select-Object -First 1
    if (-not $raw) { return }
    $parts = @($raw.ToString().Split(","))
    if ($parts.Length -lt 3) { return }
    $used = 0
    $total = 0
    $util = 0
    if (-not [int]::TryParse($parts[0].Trim(), [ref]$used)) { return }
    if (-not [int]::TryParse($parts[1].Trim(), [ref]$total)) { return }
    if (-not [int]::TryParse($parts[2].Trim(), [ref]$util)) { return }
    if ($total -le 0) { return }
    $observedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $json = '{"observedAt":"' + $observedAt + '","memoryUsedMiB":' + $used + ',"memoryTotalMiB":' + $total + ',"utilizationPercent":' + $util + '}'
    $tmp = $outFile + ".tmp"
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($tmp, $json, $utf8)
    if (Test-Path -LiteralPath $outFile) {
        Remove-Item -LiteralPath $outFile -Force
    }
    Move-Item -LiteralPath $tmp -Destination $outFile -Force
}

while ($true) {
    try { Write-HostGpuSnapshot } catch {}
    Start-Sleep -Seconds 5
}
