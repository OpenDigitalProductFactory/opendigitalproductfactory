#Requires -Version 5.1
# scripts/safety/pre-destructive-snapshot.ps1
#
# Windows counterpart of pre-destructive-snapshot.sh.
#
# Invoked by dpf-shell-guard.ps1 AFTER the operator typed-confirms a
# destructive command, BEFORE the real binary is exec'd. Routes by command
# shape to the matching snapshot strategy.
#
# BI:   BI-611C25F3 (EP-DR-HARDENING-2026-05-23)
# Spec: docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md
#
# Exit codes:
#   0 = snapshot succeeded
#   1 = snapshot failed
#   2 = no snapshot strategy registered for this command shape

[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)][string] $BinName,
    [Parameter(ValueFromRemainingArguments = $true)] $RemainingArgs
)

$ErrorActionPreference = 'Continue'

$argsArray = @()
if ($null -ne $RemainingArgs) {
    $argsArray = @($RemainingArgs | ForEach-Object { [string]$_ })
}
$cmdLine = ($BinName + ' ' + ($argsArray -join ' ')).Trim()

$installRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path

$backupsHostPath = $null
if ($env:DPF_BACKUPS_HOST_PATH) {
    $backupsHostPath = $env:DPF_BACKUPS_HOST_PATH
} elseif (Test-Path -LiteralPath (Join-Path $installRoot '.env')) {
    $envLine = Select-String -LiteralPath (Join-Path $installRoot '.env') `
        -Pattern '^DPF_BACKUPS_HOST_PATH=(.+)$' -ErrorAction SilentlyContinue
    if ($envLine) {
        $backupsHostPath = $envLine.Matches[0].Groups[1].Value.Trim()
    }
}
if (-not $backupsHostPath) { $backupsHostPath = "$installRoot-backups" }

$postgresContainer = if ($env:DPF_PRODUCTION_DB_CONTAINER) { $env:DPF_PRODUCTION_DB_CONTAINER } else { 'dpf-postgres-1' }
$postgresUser      = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'dpf' }
$postgresDb        = if ($env:POSTGRES_DB)   { $env:POSTGRES_DB }   else { 'dpf' }

$ts             = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$dateDir        = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$snapshotRoot   = Join-Path $backupsHostPath 'pre-destructive'
$snapshotDay    = Join-Path $snapshotRoot $dateDir
$logFile        = Join-Path $snapshotRoot '.snapshot.log'

if (-not (Test-Path -LiteralPath $snapshotDay)) {
    New-Item -ItemType Directory -Path $snapshotDay -Force | Out-Null
}

function Write-Audit {
    param(
        [Parameter(Mandatory)][ValidateSet('OK','FAILED','DEFERRED','NO_STRATEGY')][string] $Outcome,
        [Parameter(Mandatory)][string] $Strategy,
        [string] $SnapshotPath = '',
        [string] $Reason = ''
    )
    $entry = @{
        timestamp      = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        event          = 'pre-destructive-snapshot'
        outcome        = $Outcome
        strategy       = $Strategy
        snapshot_path  = $SnapshotPath
        reason         = $Reason
        cmd            = $cmdLine
        install_root   = $installRoot
    }
    try {
        $line = '[pre-destructive-snapshot-trace] ' + ($entry | ConvertTo-Json -Compress -Depth 4)
        Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

function Write-Trace { param([string] $Msg)
    [Console]::Error.WriteLine("[pre-destructive-snapshot-trace] $Msg")
}

function Invoke-PgDumpStrategy {
    param([Parameter(Mandatory)][string] $Fingerprint)
    $snapshotPath = Join-Path $snapshotDay "$Fingerprint-$ts.dump"
    Write-Trace "strategy=pg_dump container=$postgresContainer db=$postgresDb target=$snapshotPath"
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Audit -Outcome 'FAILED' -Strategy 'pg_dump' -SnapshotPath $snapshotPath -Reason 'docker CLI not available'
        return 1
    }
    try {
        & docker exec $postgresContainer pg_dump -U $postgresUser -Fc $postgresDb |
            Set-Content -LiteralPath $snapshotPath -Encoding Byte -ErrorAction Stop
        $size = (Get-Item -LiteralPath $snapshotPath).Length
        if ($size -lt 100) {
            Write-Audit -Outcome 'FAILED' -Strategy 'pg_dump' -SnapshotPath $snapshotPath `
                -Reason "dump file too small ($size bytes) — likely truncated"
            return 1
        }
        Write-Audit -Outcome 'OK' -Strategy 'pg_dump' -SnapshotPath $snapshotPath -Reason "size=$size"
        return 0
    } catch {
        Write-Audit -Outcome 'FAILED' -Strategy 'pg_dump' -SnapshotPath $snapshotPath `
            -Reason "pg_dump errored: $($_.Exception.Message)"
        return 1
    }
}

function Invoke-Neo4jStrategy {
    param([Parameter(Mandatory)][string] $Fingerprint)
    $snapshotPath = Join-Path $snapshotDay "$Fingerprint-$ts.neo4j.dump"
    Write-Trace "strategy=neo4j (deferred to nightly) target=$snapshotPath"
    $neo4jDir = Join-Path $backupsHostPath 'neo4j'
    if (Test-Path -LiteralPath $neo4jDir) {
        $latest = Get-ChildItem -LiteralPath $neo4jDir -Directory -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($latest) {
            Write-Audit -Outcome 'DEFERRED' -Strategy 'neo4j' -SnapshotPath $latest.FullName `
                -Reason 'deferred to nightly Neo4j backup (online dump would require stopping the DB)'
            return 0
        }
    }
    Write-Audit -Outcome 'FAILED' -Strategy 'neo4j' -SnapshotPath $snapshotPath `
        -Reason 'no nightly Neo4j backup found to defer to'
    return 1
}

function Invoke-GitStashStrategy {
    param([Parameter(Mandatory)][string] $Fingerprint)
    $repo = if ($env:PWD) { $env:PWD } else { $installRoot }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Audit -Outcome 'FAILED' -Strategy 'git-stash' -SnapshotPath $repo -Reason 'git CLI not available'
        return 1
    }
    $status = & git -C $repo status --porcelain 2>$null
    if ([string]::IsNullOrWhiteSpace(($status -join "`n"))) {
        Write-Audit -Outcome 'OK' -Strategy 'git-stash' -SnapshotPath $repo -Reason 'tree already clean; nothing to stash'
        return 0
    }
    $stashMsg = "pre-destructive-snapshot $ts $Fingerprint"
    try {
        & git -C $repo stash push -u -m $stashMsg | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "git stash push exit $LASTEXITCODE" }
        $stashRef = (& git -C $repo stash list 2>$null | Select-Object -First 1) -split ':' | Select-Object -First 1
        Write-Audit -Outcome 'OK' -Strategy 'git-stash' -SnapshotPath $repo `
            -Reason "stashed as $stashRef ($stashMsg)"
        return 0
    } catch {
        Write-Audit -Outcome 'FAILED' -Strategy 'git-stash' -SnapshotPath $repo `
            -Reason "git stash push failed: $($_.Exception.Message)"
        return 1
    }
}

function Invoke-FsEssentialsStrategy {
    param([Parameter(Mandatory)][string] $Fingerprint)
    $snapshotPath = Join-Path $snapshotDay "$Fingerprint-$ts.essentials.zip"
    Write-Trace "strategy=fs-essentials target=$snapshotPath"
    $candidates = @('.env', '.claude\settings.local.json', '.selected-model', '.host-profile.json')
    $existing = $candidates | Where-Object { Test-Path -LiteralPath (Join-Path $installRoot $_) }
    if (-not $existing -or $existing.Count -eq 0) {
        Write-Audit -Outcome 'OK' -Strategy 'fs-essentials' -SnapshotPath $snapshotPath `
            -Reason 'no operator-private artifacts to capture'
        return 0
    }
    try {
        $fullPaths = $existing | ForEach-Object { Join-Path $installRoot $_ }
        Compress-Archive -Path $fullPaths -DestinationPath $snapshotPath -Force -ErrorAction Stop
        $size = (Get-Item -LiteralPath $snapshotPath).Length
        Write-Audit -Outcome 'OK' -Strategy 'fs-essentials' -SnapshotPath $snapshotPath `
            -Reason "size=$size paths=$($existing -join ',')"
        return 0
    } catch {
        Write-Audit -Outcome 'FAILED' -Strategy 'fs-essentials' -SnapshotPath $snapshotPath `
            -Reason "Compress-Archive errored: $($_.Exception.Message)"
        return 1
    }
}

function Get-StrategyExitCode {
    if ($cmdLine -match '^docker\s+volume\s+rm\s+.*dpf_pgdata') {
        return (Invoke-PgDumpStrategy -Fingerprint 'docker-volume-rm-pgdata')
    }
    if ($cmdLine -match '^docker\s+volume\s+rm\s+.*dpf_neo4jdata') {
        return (Invoke-Neo4jStrategy -Fingerprint 'docker-volume-rm-neo4jdata')
    }
    if ($cmdLine -match '^docker\s+volume\s+rm\s+') {
        return (Invoke-PgDumpStrategy -Fingerprint 'docker-volume-rm-other')
    }
    if ($cmdLine -match '^docker\s+compose\s+down\s.*-v') {
        $pgRc = Invoke-PgDumpStrategy -Fingerprint 'docker-compose-down-v'
        $neoRc = Invoke-Neo4jStrategy -Fingerprint 'docker-compose-down-v'
        if ($pgRc -ne 0 -and $neoRc -ne 0) { return 1 }
        return 0
    }
    if ($cmdLine -match '^(pnpm\s+.*\s+)?prisma\s+migrate\s+reset') {
        return (Invoke-PgDumpStrategy -Fingerprint 'prisma-migrate-reset')
    }
    if ($cmdLine -match '^git\s+reset\s+--hard') {
        return (Invoke-GitStashStrategy -Fingerprint 'git-reset-hard')
    }
    if ($cmdLine -match '^Remove-Item\s+.*-Recurse' -or $cmdLine -match '^rm\s+.*-rf') {
        return (Invoke-FsEssentialsStrategy -Fingerprint 'remove-item-recurse')
    }
    Write-Audit -Outcome 'NO_STRATEGY' -Strategy '(none)' -Reason 'no snapshot strategy registered for command shape'
    return 2
}

$retentionDays = 90
try {
    if (Test-Path -LiteralPath $snapshotRoot) {
        $cutoff = (Get-Date).AddDays(-$retentionDays)
        Get-ChildItem -LiteralPath $snapshotRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' -and $_.LastWriteTime -lt $cutoff } |
            ForEach-Object {
                Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            }
    }
} catch {}

$exitCode = Get-StrategyExitCode
Write-Trace "exit=$exitCode"
exit $exitCode
