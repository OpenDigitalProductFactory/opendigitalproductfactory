# scripts/safety/transcript-snapshot.Tests.ps1
#
# Pester 5 tests for the Claude Code transcript snapshot hook.
#
# Run: pwsh -NoProfile -Command "Invoke-Pester -Path scripts/safety/transcript-snapshot.Tests.ps1 -Output Detailed"
#
# Strategy: invoke the script as a child pwsh process (matches how Claude
# Code's hook runner spawns it) with stdin JSON payloads. Fixture install
# root + backups dir under TestDrive so the script's $PSScriptRoot-based
# install-root resolution finds the test fixture, not the real install.

#Requires -Modules @{ ModuleName='Pester'; ModuleVersion='5.0' }

BeforeAll {
    $script:HookScriptSource = Join-Path $PSScriptRoot 'transcript-snapshot.ps1'

    function New-TestFixture {
        [CmdletBinding()]
        param([Parameter(Mandatory)][string] $RootPath)
        $installRoot = Join-Path $RootPath 'install'
        $scriptsDir  = Join-Path $installRoot 'scripts\safety'
        $backupsDir  = Join-Path $RootPath 'backups'
        $transcript  = Join-Path $RootPath 'sample.jsonl'

        New-Item -ItemType Directory -Path $scriptsDir -Force | Out-Null
        New-Item -ItemType Directory -Path $backupsDir -Force | Out-Null
        Copy-Item -LiteralPath $script:HookScriptSource -Destination (Join-Path $scriptsDir 'transcript-snapshot.ps1')
        Set-Content -LiteralPath $transcript -Value '{"type":"user","content":"hello"}'

        return [PSCustomObject]@{
            InstallRoot = $installRoot
            HookScript  = Join-Path $scriptsDir 'transcript-snapshot.ps1'
            BackupsDir  = $backupsDir
            Transcript  = $transcript
        }
    }

    function Invoke-Hook {
        [CmdletBinding()]
        param(
            [Parameter(Mandatory)][string] $HookScript,
            [Parameter(Mandatory)][string] $BackupsDir,
            [Parameter(Mandatory)][hashtable] $Payload
        )
        $json = $Payload | ConvertTo-Json -Compress
        $env:DPF_BACKUPS_HOST_PATH = $BackupsDir
        $json | & pwsh -NoProfile -File $HookScript
        return $LASTEXITCODE
    }

    function Get-SnapshotCount {
        param([Parameter(Mandatory)][string] $BackupsDir)
        @(Get-ChildItem -Recurse -LiteralPath (Join-Path $BackupsDir 'session-transcripts') `
            -Filter '*.jsonl' -ErrorAction SilentlyContinue).Count
    }

    function Clear-HookState {
        param([Parameter(Mandatory)][string] $SessionId)
        $stateFile = Join-Path $env:USERPROFILE ".claude\hook-state\$SessionId.last-snapshot"
        Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
    }
}

Describe "transcript-snapshot.ps1 — happy paths" {
    BeforeEach {
        # Per-test subdir under TestDrive — TestDrive is per-Describe in Pester 5,
        # so without a unique suffix the backups dir accumulates across It blocks.
        $perTestRoot = Join-Path $TestDrive ("happy-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
        $script:Fixture = New-TestFixture -RootPath $perTestRoot
        $script:SessionId = "test-$([Guid]::NewGuid().ToString('N').Substring(0,12))"
        Clear-HookState -SessionId $script:SessionId
    }

    AfterEach {
        Clear-HookState -SessionId $script:SessionId
    }

    It "snapshots on first PostToolUse with a non-readonly tool" {
        $exit = Invoke-Hook -HookScript $script:Fixture.HookScript -BackupsDir $script:Fixture.BackupsDir -Payload @{
            session_id      = $script:SessionId
            transcript_path = $script:Fixture.Transcript
            tool_name       = 'Bash'
            hook_event_name = 'PostToolUse'
        }
        $exit | Should -Be 0
        (Get-SnapshotCount -BackupsDir $script:Fixture.BackupsDir) | Should -Be 1
    }

    It "snapshots on SessionEnd unconditionally" {
        $exit = Invoke-Hook -HookScript $script:Fixture.HookScript -BackupsDir $script:Fixture.BackupsDir -Payload @{
            session_id      = $script:SessionId
            transcript_path = $script:Fixture.Transcript
            hook_event_name = 'SessionEnd'
            reason          = 'clear'
        }
        $exit | Should -Be 0
        (Get-SnapshotCount -BackupsDir $script:Fixture.BackupsDir) | Should -Be 1
    }

    It "writes one JSON line per snapshot to the audit log" {
        Invoke-Hook -HookScript $script:Fixture.HookScript -BackupsDir $script:Fixture.BackupsDir -Payload @{
            session_id      = $script:SessionId
            transcript_path = $script:Fixture.Transcript
            tool_name       = 'Bash'
            hook_event_name = 'PostToolUse'
        } | Out-Null
        $log = Join-Path $script:Fixture.BackupsDir 'session-transcripts\.snapshot.log'
        Test-Path $log | Should -Be $true
        # Wrap in @(...) so .Count works even when Get-Content returns a scalar
        # for a single-line file (same PowerShell array-unwrap pattern as in
        # worktree-janitor-lib.psm1).
        $lines = @(Get-Content -LiteralPath $log)
        $lines.Count | Should -Be 1
        $entry = $lines[0] | ConvertFrom-Json
        $entry.session_id | Should -Be $script:SessionId
        $entry.hook_event | Should -Be 'PostToolUse'
        $entry.tool_name | Should -Be 'Bash'
    }
}

Describe "transcript-snapshot.ps1 — throttle" {
    BeforeEach {
        $perTestRoot = Join-Path $TestDrive ("throttle-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
        $script:Fixture = New-TestFixture -RootPath $perTestRoot
        $script:SessionId = "throttle-$([Guid]::NewGuid().ToString('N').Substring(0,12))"
        Clear-HookState -SessionId $script:SessionId
    }

    AfterEach {
        Clear-HookState -SessionId $script:SessionId
    }

    It "skips a second PostToolUse within the throttle window" {
        $payload = @{
            session_id      = $script:SessionId
            transcript_path = $script:Fixture.Transcript
            tool_name       = 'Bash'
            hook_event_name = 'PostToolUse'
        }
        Invoke-Hook -HookScript $script:Fixture.HookScript -BackupsDir $script:Fixture.BackupsDir -Payload $payload | Out-Null
        Invoke-Hook -HookScript $script:Fixture.HookScript -BackupsDir $script:Fixture.BackupsDir -Payload $payload | Out-Null
        # Should still be 1 snapshot, not 2; log should have only 1 line.
        (Get-SnapshotCount -BackupsDir $script:Fixture.BackupsDir) | Should -Be 1
        $log = Join-Path $script:Fixture.BackupsDir 'session-transcripts\.snapshot.log'
        @(Get-Content -LiteralPath $log).Count | Should -Be 1
    }

    It "SessionEnd ignores the throttle and still snapshots" {
        # Prime: PostToolUse sets the throttle state.
        Invoke-Hook -HookScript $script:Fixture.HookScript -BackupsDir $script:Fixture.BackupsDir -Payload @{
            session_id      = $script:SessionId
            transcript_path = $script:Fixture.Transcript
            tool_name       = 'Bash'
            hook_event_name = 'PostToolUse'
        } | Out-Null
        # Immediately follow with SessionEnd — should still log a 2nd entry.
        Invoke-Hook -HookScript $script:Fixture.HookScript -BackupsDir $script:Fixture.BackupsDir -Payload @{
            session_id      = $script:SessionId
            transcript_path = $script:Fixture.Transcript
            hook_event_name = 'SessionEnd'
            reason          = 'clear'
        } | Out-Null
        $log = Join-Path $script:Fixture.BackupsDir 'session-transcripts\.snapshot.log'
        $lines = @(Get-Content -LiteralPath $log)
        $lines.Count | Should -Be 2
        ($lines | ForEach-Object { ($_ | ConvertFrom-Json).hook_event }) | Should -Contain 'SessionEnd'
    }
}

Describe "transcript-snapshot.ps1 — read-only tool skip" {
    BeforeEach {
        $perTestRoot = Join-Path $TestDrive ("ro-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
        $script:Fixture = New-TestFixture -RootPath $perTestRoot
        $script:SessionId = "ro-$([Guid]::NewGuid().ToString('N').Substring(0,12))"
        Clear-HookState -SessionId $script:SessionId
    }

    AfterEach {
        Clear-HookState -SessionId $script:SessionId
    }

    It "skips PostToolUse for Read" {
        Invoke-Hook -HookScript $script:Fixture.HookScript -BackupsDir $script:Fixture.BackupsDir -Payload @{
            session_id      = $script:SessionId
            transcript_path = $script:Fixture.Transcript
            tool_name       = 'Read'
            hook_event_name = 'PostToolUse'
        } | Out-Null
        (Get-SnapshotCount -BackupsDir $script:Fixture.BackupsDir) | Should -Be 0
    }

    It "skips PostToolUse for Glob, Grep, WebFetch, WebSearch" {
        foreach ($tool in @('Glob', 'Grep', 'WebFetch', 'WebSearch')) {
            Invoke-Hook -HookScript $script:Fixture.HookScript -BackupsDir $script:Fixture.BackupsDir -Payload @{
                session_id      = $script:SessionId
                transcript_path = $script:Fixture.Transcript
                tool_name       = $tool
                hook_event_name = 'PostToolUse'
            } | Out-Null
        }
        (Get-SnapshotCount -BackupsDir $script:Fixture.BackupsDir) | Should -Be 0
    }
}

Describe "transcript-snapshot.ps1 — defensive paths" {
    BeforeEach {
        $perTestRoot = Join-Path $TestDrive ("defensive-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
        $script:Fixture = New-TestFixture -RootPath $perTestRoot
        $script:SessionId = "defensive-$([Guid]::NewGuid().ToString('N').Substring(0,12))"
        Clear-HookState -SessionId $script:SessionId
    }

    AfterEach {
        Clear-HookState -SessionId $script:SessionId
    }

    It "exits 0 silently on empty stdin (no payload)" {
        $env:DPF_BACKUPS_HOST_PATH = $script:Fixture.BackupsDir
        '' | & pwsh -NoProfile -File $script:Fixture.HookScript
        $LASTEXITCODE | Should -Be 0
    }

    It "exits 0 silently on malformed JSON" {
        $env:DPF_BACKUPS_HOST_PATH = $script:Fixture.BackupsDir
        '{not-json' | & pwsh -NoProfile -File $script:Fixture.HookScript
        $LASTEXITCODE | Should -Be 0
    }

    It "exits 0 silently when transcript_path does not exist" {
        $exit = Invoke-Hook -HookScript $script:Fixture.HookScript -BackupsDir $script:Fixture.BackupsDir -Payload @{
            session_id      = $script:SessionId
            transcript_path = (Join-Path $TestDrive 'does-not-exist.jsonl')
            tool_name       = 'Bash'
            hook_event_name = 'PostToolUse'
        }
        $exit | Should -Be 0
        (Get-SnapshotCount -BackupsDir $script:Fixture.BackupsDir) | Should -Be 0
    }

    It "exits 0 silently when session_id is missing" {
        $exit = Invoke-Hook -HookScript $script:Fixture.HookScript -BackupsDir $script:Fixture.BackupsDir -Payload @{
            transcript_path = $script:Fixture.Transcript
            tool_name       = 'Bash'
            hook_event_name = 'PostToolUse'
        }
        $exit | Should -Be 0
        (Get-SnapshotCount -BackupsDir $script:Fixture.BackupsDir) | Should -Be 0
    }
}
