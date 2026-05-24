# scripts/safety/pre-destructive-snapshot.Tests.ps1
#
# Pester 5 tests for the pre-destructive snapshot dispatcher (BI-611C25F3).
#
# Coverage: routing table (which command shape picks which strategy),
# audit-log shape, retention pruning. The strategy handlers interact with
# external tools (docker, git) that aren't all available in the test
# environment; we accept exit 0 OR 1 (success OR strategy-internal failure)
# and assert on the LOGGED strategy name to prove routing fired correctly.
#
# Run: pwsh -NoProfile -Command "Invoke-Pester -Path scripts/safety/pre-destructive-snapshot.Tests.ps1 -Output Detailed"

#Requires -Modules @{ ModuleName='Pester'; ModuleVersion='5.0' }

BeforeAll {
    $script:DispatcherSource = Join-Path $PSScriptRoot 'pre-destructive-snapshot.ps1'

    function New-DispatcherFixture {
        param([Parameter(Mandatory)][string] $RootPath)
        $installRoot = Join-Path $RootPath 'install'
        $scriptsDir  = Join-Path $installRoot 'scripts\safety'
        $backupsDir  = Join-Path $RootPath 'backups'
        New-Item -ItemType Directory -Path $scriptsDir -Force | Out-Null
        New-Item -ItemType Directory -Path $backupsDir -Force | Out-Null
        Copy-Item -LiteralPath $script:DispatcherSource -Destination (Join-Path $scriptsDir 'pre-destructive-snapshot.ps1')
        return [PSCustomObject]@{
            InstallRoot     = $installRoot
            Dispatcher      = Join-Path $scriptsDir 'pre-destructive-snapshot.ps1'
            BackupsDir      = $backupsDir
            SnapshotRoot    = Join-Path $backupsDir 'pre-destructive'
            LogFile         = Join-Path $backupsDir 'pre-destructive\.snapshot.log'
        }
    }

    function Invoke-Dispatcher {
        param(
            [Parameter(Mandatory)][string] $Dispatcher,
            [Parameter(Mandatory)][string] $BackupsDir,
            [Parameter(Mandatory)][string] $BinName,
            [string[]] $DispatcherArgs = @()
        )
        $env:DPF_BACKUPS_HOST_PATH = $BackupsDir
        & pwsh -NoProfile -File $Dispatcher $BinName @DispatcherArgs 2>&1 | Out-Null
        return $LASTEXITCODE
    }

    function Get-LatestLogEntry {
        param([Parameter(Mandatory)][string] $LogFile)
        if (-not (Test-Path -LiteralPath $LogFile)) { return $null }
        $lines = @(Get-Content -LiteralPath $LogFile)
        if ($lines.Count -eq 0) { return $null }
        $json = $lines[-1] -replace '^\[pre-destructive-snapshot-trace\]\s*', ''
        return $json | ConvertFrom-Json
    }
}

Describe "pre-destructive-snapshot.ps1 — routing table" {
    BeforeEach {
        # Per-test subdir under TestDrive — TestDrive is per-Describe in Pester 5
        # so without a unique suffix the backups dir accumulates across It blocks.
        $perTestRoot = Join-Path $TestDrive ("route-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
        $script:Fixture = New-DispatcherFixture -RootPath $perTestRoot
    }

    It "routes 'docker volume rm dpf_pgdata' to pg_dump strategy" {
        $exit = Invoke-Dispatcher -Dispatcher $script:Fixture.Dispatcher -BackupsDir $script:Fixture.BackupsDir `
            -BinName 'docker' -DispatcherArgs @('volume','rm','dpf_pgdata')
        $exit | Should -BeIn @(0, 1)
        $entry = Get-LatestLogEntry -LogFile $script:Fixture.LogFile
        $entry.strategy | Should -Be 'pg_dump'
    }

    It "routes 'docker volume rm dpf_neo4jdata' to neo4j strategy" {
        $exit = Invoke-Dispatcher -Dispatcher $script:Fixture.Dispatcher -BackupsDir $script:Fixture.BackupsDir `
            -BinName 'docker' -DispatcherArgs @('volume','rm','dpf_neo4jdata')
        $exit | Should -BeIn @(0, 1)
        $entry = Get-LatestLogEntry -LogFile $script:Fixture.LogFile
        $entry.strategy | Should -Be 'neo4j'
    }

    It "routes 'docker volume rm <other>' to pg_dump strategy (best-effort)" {
        $exit = Invoke-Dispatcher -Dispatcher $script:Fixture.Dispatcher -BackupsDir $script:Fixture.BackupsDir `
            -BinName 'docker' -DispatcherArgs @('volume','rm','dpf_unknownvolume')
        $exit | Should -BeIn @(0, 1)
        $entry = Get-LatestLogEntry -LogFile $script:Fixture.LogFile
        $entry.strategy | Should -Be 'pg_dump'
    }

    It "routes 'docker compose down --volumes' to both pg_dump + neo4j strategies" {
        $exit = Invoke-Dispatcher -Dispatcher $script:Fixture.Dispatcher -BackupsDir $script:Fixture.BackupsDir `
            -BinName 'docker' -DispatcherArgs @('compose','down','--volumes')
        $exit | Should -BeIn @(0, 1)
        $lines = @(Get-Content -LiteralPath $script:Fixture.LogFile)
        $strategies = $lines | ForEach-Object {
            $j = $_ -replace '^\[pre-destructive-snapshot-trace\]\s*', ''
            ($j | ConvertFrom-Json).strategy
        }
        $strategies | Should -Contain 'pg_dump'
        $strategies | Should -Contain 'neo4j'
    }

    It "routes 'prisma migrate reset' to pg_dump strategy" {
        $exit = Invoke-Dispatcher -Dispatcher $script:Fixture.Dispatcher -BackupsDir $script:Fixture.BackupsDir `
            -BinName 'prisma' -DispatcherArgs @('migrate','reset')
        $exit | Should -BeIn @(0, 1)
        $entry = Get-LatestLogEntry -LogFile $script:Fixture.LogFile
        $entry.strategy | Should -Be 'pg_dump'
    }

    It "routes 'git reset --hard' to git-stash strategy" {
        $exit = Invoke-Dispatcher -Dispatcher $script:Fixture.Dispatcher -BackupsDir $script:Fixture.BackupsDir `
            -BinName 'git' -DispatcherArgs @('reset','--hard','HEAD~1')
        $exit | Should -BeIn @(0, 1)
        $entry = Get-LatestLogEntry -LogFile $script:Fixture.LogFile
        $entry.strategy | Should -Be 'git-stash'
    }

    It "routes 'Remove-Item -Recurse' to fs-essentials strategy" {
        $exit = Invoke-Dispatcher -Dispatcher $script:Fixture.Dispatcher -BackupsDir $script:Fixture.BackupsDir `
            -BinName 'Remove-Item' -DispatcherArgs @('-Recurse','-Force','D:\DPF')
        $exit | Should -BeIn @(0, 1)
        $entry = Get-LatestLogEntry -LogFile $script:Fixture.LogFile
        $entry.strategy | Should -Be 'fs-essentials'
    }

    It "exits 2 with NO_STRATEGY audit for unrecognized commands" {
        $exit = Invoke-Dispatcher -Dispatcher $script:Fixture.Dispatcher -BackupsDir $script:Fixture.BackupsDir `
            -BinName 'truncate' -DispatcherArgs @('--size=0','/some/file')
        $exit | Should -Be 2
        $entry = Get-LatestLogEntry -LogFile $script:Fixture.LogFile
        $entry.outcome | Should -Be 'NO_STRATEGY'
    }
}

Describe "pre-destructive-snapshot.ps1 — audit log shape" {
    BeforeEach {
        $perTestRoot = Join-Path $TestDrive ("audit-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
        $script:Fixture = New-DispatcherFixture -RootPath $perTestRoot
    }

    It "writes one [pre-destructive-snapshot-trace] line per strategy invocation" {
        Invoke-Dispatcher -Dispatcher $script:Fixture.Dispatcher -BackupsDir $script:Fixture.BackupsDir `
            -BinName 'prisma' -DispatcherArgs @('migrate','reset') | Out-Null
        $lines = @(Get-Content -LiteralPath $script:Fixture.LogFile)
        $lines.Count | Should -Be 1
        $lines[0] | Should -Match '^\[pre-destructive-snapshot-trace\] \{'
    }

    It "audit entry captures cmd, install_root, timestamp, event=pre-destructive-snapshot" {
        Invoke-Dispatcher -Dispatcher $script:Fixture.Dispatcher -BackupsDir $script:Fixture.BackupsDir `
            -BinName 'docker' -DispatcherArgs @('volume','rm','dpf_pgdata') | Out-Null
        $entry = Get-LatestLogEntry -LogFile $script:Fixture.LogFile
        $entry.event | Should -Be 'pre-destructive-snapshot'
        $entry.cmd | Should -Be 'docker volume rm dpf_pgdata'
        $entry.install_root | Should -Be $script:Fixture.InstallRoot
        # ConvertFrom-Json normalizes ISO strings to DateTime; assert raw line instead.
        $rawLine = @(Get-Content -LiteralPath $script:Fixture.LogFile)[-1]
        $rawLine | Should -Match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    }
}

Describe "pre-destructive-snapshot.ps1 — retention" {
    BeforeEach {
        $perTestRoot = Join-Path $TestDrive ("retention-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
        $script:Fixture = New-DispatcherFixture -RootPath $perTestRoot
    }

    It "prunes day-dirs older than 90 days from the snapshot root" {
        $oldDir = Join-Path $script:Fixture.SnapshotRoot '2024-01-01'
        $newDir = Join-Path $script:Fixture.SnapshotRoot (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
        New-Item -ItemType Directory -Path $oldDir -Force | Out-Null
        New-Item -ItemType Directory -Path $newDir -Force | Out-Null
        (Get-Item -LiteralPath $oldDir).LastWriteTime = (Get-Date).AddDays(-100)
        Invoke-Dispatcher -Dispatcher $script:Fixture.Dispatcher -BackupsDir $script:Fixture.BackupsDir `
            -BinName 'prisma' -DispatcherArgs @('migrate','reset') | Out-Null
        Test-Path -LiteralPath $oldDir | Should -Be $false
        Test-Path -LiteralPath $newDir | Should -Be $true
    }

    It "does NOT prune day-dirs younger than 90 days" {
        $recentDir = Join-Path $script:Fixture.SnapshotRoot '2026-04-01'
        New-Item -ItemType Directory -Path $recentDir -Force | Out-Null
        (Get-Item -LiteralPath $recentDir).LastWriteTime = (Get-Date).AddDays(-53)
        Invoke-Dispatcher -Dispatcher $script:Fixture.Dispatcher -BackupsDir $script:Fixture.BackupsDir `
            -BinName 'prisma' -DispatcherArgs @('migrate','reset') | Out-Null
        Test-Path -LiteralPath $recentDir | Should -Be $true
    }
}
