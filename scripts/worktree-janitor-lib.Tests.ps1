# scripts/worktree-janitor-lib.Tests.ps1
#
# Pester 5 tests for the worktree-janitor library (Phase 1).
#
# Run: pwsh -NoProfile -Command "Invoke-Pester -Path scripts/worktree-janitor-lib.Tests.ps1 -Output Detailed"
#
# Strategy:
#   - Predicate functions are tested with TestDrive: fixture paths so we
#     never touch the host's real worktrees.
#   - Git-aware predicates (Test-WorktreeIsClean,
#     Test-WorktreeBranchMergedToOriginMain, Test-BranchSafeToDelete) get
#     a real git repo set up under TestDrive: — fast (<1s per test) and
#     more reliable than mocking the git CLI surface.
#   - Test-EditorOpenAt is exercised via Pester's Mock against Get-Process.

#Requires -Modules @{ ModuleName='Pester'; ModuleVersion='5.0' }

BeforeAll {
    $script:LibPath = Join-Path $PSScriptRoot 'worktree-janitor-lib.psm1'
    Import-Module $script:LibPath -Force

    # Helper: create a real git repo at the given path with one initial commit
    # on a branch named after $BranchName. Sets origin to a bare repo so
    # `branch --merged origin/main` works.
    function New-TestRepo {
        param(
            [Parameter(Mandatory)][string] $Path,
            [string] $BranchName = 'main'
        )
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
        & git -C $Path init --initial-branch=$BranchName --quiet 2>&1 | Out-Null
        & git -C $Path config user.email 'test@example.com' 2>&1 | Out-Null
        & git -C $Path config user.name 'test' 2>&1 | Out-Null
        & git -C $Path config commit.gpgsign false 2>&1 | Out-Null
        Set-Content -LiteralPath (Join-Path $Path 'README.md') -Value '# test' -NoNewline
        & git -C $Path add README.md 2>&1 | Out-Null
        & git -C $Path commit -m 'initial' --quiet 2>&1 | Out-Null
    }

    # Helper: create a bare-repo "origin" + add the working repo to it,
    # push so origin/main exists. Returns the bare-repo path.
    function Add-TestOrigin {
        param([Parameter(Mandatory)][string] $WorkingRepoPath)
        $origin = Join-Path (Split-Path -Parent $WorkingRepoPath) 'origin.git'
        & git init --bare $origin --quiet 2>&1 | Out-Null
        & git -C $WorkingRepoPath remote add origin $origin 2>&1 | Out-Null
        & git -C $WorkingRepoPath push -u origin main --quiet 2>&1 | Out-Null
        & git -C $WorkingRepoPath fetch origin --quiet 2>&1 | Out-Null
        return $origin
    }
}

Describe "Registry accessors" {
    It "Get-ManagedRoots returns a non-empty array containing the .claude/worktrees path" {
        $roots = Get-ManagedRoots
        $roots | Should -Not -BeNullOrEmpty
        ($roots -join '|') | Should -Match '\.claude.\\?worktrees'
    }

    It "Get-InventoryOnlyRoots returns a non-empty array containing the D:\DPF-* glob" {
        $roots = Get-InventoryOnlyRoots
        $roots | Should -Not -BeNullOrEmpty
        ($roots -join '|') | Should -Match 'DPF-\*'
    }

    It "Get-EditorProcessNames includes Code (VS Code) and pwsh" {
        $names = Get-EditorProcessNames
        $names | Should -Contain 'Code'
        $names | Should -Contain 'pwsh'
    }
}

Describe "Test-PathUnderManagedRoot" {
    It "returns true for a direct child of a managed root" {
        Test-PathUnderManagedRoot `
            -Path 'D:\DPF\.claude\worktrees\foo' `
            -ManagedRoots @('D:\DPF\.claude\worktrees') |
            Should -Be $true
    }

    It "returns true for a nested grandchild of a managed root" {
        Test-PathUnderManagedRoot `
            -Path 'D:\DPF\.claude\worktrees\foo\nested\dir' `
            -ManagedRoots @('D:\DPF\.claude\worktrees') |
            Should -Be $true
    }

    It "returns true for the managed root path itself" {
        Test-PathUnderManagedRoot `
            -Path 'D:\DPF\.claude\worktrees' `
            -ManagedRoots @('D:\DPF\.claude\worktrees') |
            Should -Be $true
    }

    It "returns false for a sibling of the managed root" {
        Test-PathUnderManagedRoot `
            -Path 'D:\DPF\.claude\other-dir\foo' `
            -ManagedRoots @('D:\DPF\.claude\worktrees') |
            Should -Be $false
    }

    It "returns false for an inventory-only root like D:\DPF-archive" {
        Test-PathUnderManagedRoot `
            -Path 'D:\DPF-archive\branch' `
            -ManagedRoots @('D:\DPF\.claude\worktrees') |
            Should -Be $false
    }

    It "is case-insensitive on Windows" {
        Test-PathUnderManagedRoot `
            -Path 'd:\dpf\.CLAUDE\WORKTREES\foo' `
            -ManagedRoots @('D:\DPF\.claude\worktrees') |
            Should -Be $true
    }

    It "does not produce false-positive when target is prefix of a sibling" {
        Test-PathUnderManagedRoot `
            -Path 'D:\DPF\.claude\worktrees-other\foo' `
            -ManagedRoots @('D:\DPF\.claude\worktrees') |
            Should -Be $false
    }
}

Describe "Test-WorktreeIsClean" {
    It "returns true for a freshly-committed repo" {
        $repo = Join-Path $TestDrive 'clean-repo'
        New-TestRepo -Path $repo
        Test-WorktreeIsClean -Path $repo | Should -Be $true
    }

    It "returns false when an untracked file is present" {
        $repo = Join-Path $TestDrive 'dirty-untracked-repo'
        New-TestRepo -Path $repo
        Set-Content -LiteralPath (Join-Path $repo 'untracked.txt') -Value 'x'
        Test-WorktreeIsClean -Path $repo | Should -Be $false
    }

    It "returns false when a tracked file is modified" {
        $repo = Join-Path $TestDrive 'dirty-modified-repo'
        New-TestRepo -Path $repo
        Set-Content -LiteralPath (Join-Path $repo 'README.md') -Value '# modified'
        Test-WorktreeIsClean -Path $repo | Should -Be $false
    }

    It "returns false for a non-existent path (fail-closed)" {
        Test-WorktreeIsClean -Path (Join-Path $TestDrive 'nonexistent') | Should -Be $false
    }

    It "returns false for an existing dir that is not a git repo (fail-closed)" {
        $dir = Join-Path $TestDrive 'not-a-repo'
        New-Item -ItemType Directory -Path $dir | Out-Null
        Test-WorktreeIsClean -Path $dir | Should -Be $false
    }
}

Describe "Test-WorktreeBranchMergedToOriginMain" {
    It "returns true when the worktree's branch is reachable from origin/main" {
        $repo = Join-Path $TestDrive 'merged-repo'
        New-TestRepo -Path $repo
        Add-TestOrigin -WorkingRepoPath $repo | Out-Null
        Test-WorktreeBranchMergedToOriginMain -Path $repo | Should -Be $true
    }

    It "returns false when the worktree's branch has commits ahead of origin/main" {
        $repo = Join-Path $TestDrive 'ahead-repo'
        New-TestRepo -Path $repo
        Add-TestOrigin -WorkingRepoPath $repo | Out-Null
        # Move HEAD onto a new branch with an extra commit not on origin/main.
        & git -C $repo checkout -b feature --quiet 2>&1 | Out-Null
        Set-Content -LiteralPath (Join-Path $repo 'feature.txt') -Value 'x'
        & git -C $repo add feature.txt 2>&1 | Out-Null
        & git -C $repo commit -m 'feature' --quiet 2>&1 | Out-Null
        Test-WorktreeBranchMergedToOriginMain -Path $repo | Should -Be $false
    }

    It "returns false when no origin/main exists (no upstream)" {
        $repo = Join-Path $TestDrive 'no-origin-repo'
        New-TestRepo -Path $repo
        Test-WorktreeBranchMergedToOriginMain -Path $repo | Should -Be $false
    }

    It "returns false for a non-existent path (fail-closed)" {
        Test-WorktreeBranchMergedToOriginMain `
            -Path (Join-Path $TestDrive 'nonexistent-merged') |
            Should -Be $false
    }
}

Describe "Test-EditorOpenAt" {
    It "returns true when a mocked editor process has the path as a prefix" {
        Mock -ModuleName worktree-janitor-lib Get-Process {
            @([PSCustomObject]@{
                Name = 'Code'
                Path = 'C:\fake\path\worktree\bin\Code.exe'
            })
        }
        Test-EditorOpenAt `
            -Path 'C:\fake\path\worktree' `
            -EditorProcessNames @('Code') |
            Should -Be $true
    }

    It "returns false when no process matches the path prefix" {
        Mock -ModuleName worktree-janitor-lib Get-Process {
            @([PSCustomObject]@{
                Name = 'Code'
                Path = 'C:\some\other\location\Code.exe'
            })
        }
        Test-EditorOpenAt `
            -Path 'C:\fake\path\worktree' `
            -EditorProcessNames @('Code') |
            Should -Be $false
    }

    It "returns false when no editor processes are running at all" {
        Mock -ModuleName worktree-janitor-lib Get-Process { @() }
        Test-EditorOpenAt `
            -Path 'C:\fake\path\worktree' `
            -EditorProcessNames @('Code') |
            Should -Be $false
    }

    It "ignores processes whose Name is not in the allowlist" {
        Mock -ModuleName worktree-janitor-lib Get-Process {
            @([PSCustomObject]@{
                Name = 'notepad'
                Path = 'C:\fake\path\worktree\notepad.exe'
            })
        }
        Test-EditorOpenAt `
            -Path 'C:\fake\path\worktree' `
            -EditorProcessNames @('Code') |
            Should -Be $false
    }
}

Describe "Test-WorktreeSafeToRemove (exiting mode)" {
    It "returns Safe=true for a clean, merged repo under a managed root with no editor open" {
        $rootDir = Join-Path $TestDrive 'managed-root'
        New-Item -ItemType Directory -Path $rootDir -Force | Out-Null
        $repo = Join-Path $rootDir 'wt'
        New-TestRepo -Path $repo
        Add-TestOrigin -WorkingRepoPath $repo | Out-Null
        Mock -ModuleName worktree-janitor-lib Get-Process { @() }
        $verdict = Test-WorktreeSafeToRemove -Path $repo -Mode 'exiting'
        # Override the managed roots via the dispatcher pattern — Phase 2
        # surface — for now we monkey-patch the script:ManagedRoots so the
        # path-under-managed-root invariant passes for this fixture.
        InModuleScope worktree-janitor-lib -ArgumentList @($rootDir, $repo) {
            param($root, $path)
            $script:ManagedRoots = @($root)
            Test-WorktreeSafeToRemove -Path $path -Mode 'exiting'
        } | ForEach-Object {
            $_.Safe | Should -Be $true
        }
    }

    It "returns Safe=false when the working tree is dirty" {
        $rootDir = Join-Path $TestDrive 'managed-root-dirty'
        New-Item -ItemType Directory -Path $rootDir -Force | Out-Null
        $repo = Join-Path $rootDir 'wt'
        New-TestRepo -Path $repo
        Add-TestOrigin -WorkingRepoPath $repo | Out-Null
        Set-Content -LiteralPath (Join-Path $repo 'untracked.txt') -Value 'x'
        $verdict = InModuleScope worktree-janitor-lib -ArgumentList @($rootDir, $repo) {
            param($root, $path)
            $script:ManagedRoots = @($root)
            Test-WorktreeSafeToRemove -Path $path -Mode 'exiting'
        }
        $verdict.Safe | Should -Be $false
        $verdict.Reason | Should -Match 'uncommitted'
    }

    It "returns Safe=false when the path is not under a managed root" {
        $repo = Join-Path $TestDrive 'outside-root-repo'
        New-TestRepo -Path $repo
        Add-TestOrigin -WorkingRepoPath $repo | Out-Null
        # Use the default ManagedRoots (D:\DPF\.claude\worktrees etc.) — TestDrive is not under any of them.
        $verdict = Test-WorktreeSafeToRemove -Path $repo -Mode 'exiting'
        $verdict.Safe | Should -Be $false
        $verdict.Reason | Should -Match 'not under a managed root'
    }

    It "returns Safe=false when an editor has the path open" {
        $rootDir = Join-Path $TestDrive 'managed-root-editor'
        New-Item -ItemType Directory -Path $rootDir -Force | Out-Null
        $repo = Join-Path $rootDir 'wt'
        New-TestRepo -Path $repo
        Add-TestOrigin -WorkingRepoPath $repo | Out-Null
        Mock -ModuleName worktree-janitor-lib Get-Process {
            @([PSCustomObject]@{ Name = 'Code'; Path = (Join-Path $using:repo 'bin\Code.exe') })
        }
        $verdict = InModuleScope worktree-janitor-lib -ArgumentList @($rootDir, $repo) {
            param($root, $path)
            $script:ManagedRoots = @($root)
            Test-WorktreeSafeToRemove -Path $path -Mode 'exiting'
        }
        $verdict.Safe | Should -Be $false
        $verdict.Reason | Should -Match 'editor'
    }

    It "returns Safe=false when the branch is not merged to origin/main" {
        $rootDir = Join-Path $TestDrive 'managed-root-unmerged'
        New-Item -ItemType Directory -Path $rootDir -Force | Out-Null
        $repo = Join-Path $rootDir 'wt'
        New-TestRepo -Path $repo
        Add-TestOrigin -WorkingRepoPath $repo | Out-Null
        & git -C $repo checkout -b feature --quiet 2>&1 | Out-Null
        Set-Content -LiteralPath (Join-Path $repo 'feature.txt') -Value 'x'
        & git -C $repo add feature.txt 2>&1 | Out-Null
        & git -C $repo commit -m 'feature' --quiet 2>&1 | Out-Null
        Mock -ModuleName worktree-janitor-lib Get-Process { @() }
        $verdict = InModuleScope worktree-janitor-lib -ArgumentList @($rootDir, $repo) {
            param($root, $path)
            $script:ManagedRoots = @($root)
            Test-WorktreeSafeToRemove -Path $path -Mode 'exiting'
        }
        $verdict.Safe | Should -Be $false
        $verdict.Reason | Should -Match 'origin/main'
    }
}

Describe "Test-WorktreeSafeToRemove (sweep mode age check)" {
    It "returns Safe=false when sweep mode sees a freshly-touched worktree" {
        $rootDir = Join-Path $TestDrive 'managed-root-fresh'
        New-Item -ItemType Directory -Path $rootDir -Force | Out-Null
        $repo = Join-Path $rootDir 'wt'
        New-TestRepo -Path $repo
        Add-TestOrigin -WorkingRepoPath $repo | Out-Null
        $verdict = InModuleScope worktree-janitor-lib -ArgumentList @($rootDir, $repo) {
            param($root, $path)
            $script:ManagedRoots = @($root)
            # Default AbandonAgeDays = 7; the repo was just created, so age is ~0.
            Test-WorktreeSafeToRemove -Path $path -Mode 'sweep'
        }
        $verdict.Safe | Should -Be $false
        $verdict.Reason | Should -Match 'abandon threshold'
    }

    It "returns Safe=true in sweep mode when the path is older than the threshold (threshold=0)" {
        $rootDir = Join-Path $TestDrive 'managed-root-old'
        New-Item -ItemType Directory -Path $rootDir -Force | Out-Null
        $repo = Join-Path $rootDir 'wt'
        New-TestRepo -Path $repo
        Add-TestOrigin -WorkingRepoPath $repo | Out-Null
        Mock -ModuleName worktree-janitor-lib Get-Process { @() }
        $verdict = InModuleScope worktree-janitor-lib -ArgumentList @($rootDir, $repo) {
            param($root, $path)
            $script:ManagedRoots = @($root)
            Test-WorktreeSafeToRemove -Path $path -Mode 'sweep' -AbandonAgeDays 0
        }
        $verdict.Safe | Should -Be $true
    }
}

Describe "Test-BranchSafeToDelete" {
    It "returns Safe=true for a merged feat/* branch with no worktree" {
        $repo = Join-Path $TestDrive 'branch-delete-ok'
        New-TestRepo -Path $repo
        Add-TestOrigin -WorkingRepoPath $repo | Out-Null
        & git -C $repo checkout -b feat/something --quiet 2>&1 | Out-Null
        & git -C $repo checkout main --quiet 2>&1 | Out-Null  # so feat/something has no worktree
        # `feat/something` is reachable from origin/main because we never advanced it past main.
        $verdict = Test-BranchSafeToDelete -Branch 'feat/something' -Mode 'sweep' -RepoPath $repo
        $verdict.Safe | Should -Be $true
    }

    It "returns Safe=false for a non-allowlisted prefix like wip/*" {
        $repo = Join-Path $TestDrive 'branch-delete-prefix'
        New-TestRepo -Path $repo
        Add-TestOrigin -WorkingRepoPath $repo | Out-Null
        & git -C $repo checkout -b wip/foo --quiet 2>&1 | Out-Null
        & git -C $repo checkout main --quiet 2>&1 | Out-Null
        $verdict = Test-BranchSafeToDelete -Branch 'wip/foo' -Mode 'sweep' -RepoPath $repo
        $verdict.Safe | Should -Be $false
        $verdict.Reason | Should -Match 'allowlisted'
    }

    It "returns Safe=false when the branch is not merged to origin/main" {
        $repo = Join-Path $TestDrive 'branch-delete-unmerged'
        New-TestRepo -Path $repo
        Add-TestOrigin -WorkingRepoPath $repo | Out-Null
        & git -C $repo checkout -b feat/unmerged --quiet 2>&1 | Out-Null
        Set-Content -LiteralPath (Join-Path $repo 'x.txt') -Value 'x'
        & git -C $repo add x.txt 2>&1 | Out-Null
        & git -C $repo commit -m 'extra' --quiet 2>&1 | Out-Null
        & git -C $repo checkout main --quiet 2>&1 | Out-Null
        $verdict = Test-BranchSafeToDelete -Branch 'feat/unmerged' -Mode 'sweep' -RepoPath $repo
        $verdict.Safe | Should -Be $false
        $verdict.Reason | Should -Match 'not reachable from origin/main'
    }

    It "returns Safe=false when the branch is the current HEAD of the repo" {
        $repo = Join-Path $TestDrive 'branch-delete-current'
        New-TestRepo -Path $repo
        Add-TestOrigin -WorkingRepoPath $repo | Out-Null
        & git -C $repo checkout -b feat/current --quiet 2>&1 | Out-Null
        # `git worktree list` ALWAYS includes the main repo, so a branch
        # that's HEAD of the main repo trips the worktree-checkout check
        # first (which is correct — HEAD of the main repo IS the same
        # invariant). The downstream HEAD check is defense-in-depth.
        $verdict = Test-BranchSafeToDelete -Branch 'feat/current' -Mode 'sweep' -RepoPath $repo
        $verdict.Safe | Should -Be $false
        $verdict.Reason | Should -Match 'checked out by a worktree'
    }
}

Describe "Get-OrphanDirectoryAction" {
    It "returns Action=remove for an empty directory under a managed root" {
        $root = Join-Path $TestDrive 'orphan-managed-root'
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $emptyDir = Join-Path $root 'empty'
        New-Item -ItemType Directory -Path $emptyDir | Out-Null
        $action = InModuleScope worktree-janitor-lib -ArgumentList @($root, $emptyDir) {
            param($root, $path)
            $script:ManagedRoots = @($root)
            Get-OrphanDirectoryAction -Path $path
        }
        $action.Action | Should -Be 'remove'
        $action.Reason | Should -Match 'empty'
    }

    It "returns Action=remove for a dir containing only a .git pointer file" {
        $root = Join-Path $TestDrive 'orphan-stale-git'
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $stalePath = Join-Path $root 'stale'
        New-Item -ItemType Directory -Path $stalePath | Out-Null
        Set-Content -LiteralPath (Join-Path $stalePath '.git') -Value 'gitdir: ../../some-removed-worktree'
        $action = InModuleScope worktree-janitor-lib -ArgumentList @($root, $stalePath) {
            param($root, $path)
            $script:ManagedRoots = @($root)
            Get-OrphanDirectoryAction -Path $path
        }
        $action.Action | Should -Be 'remove'
        $action.Reason | Should -Match 'stale .git pointer'
    }

    It "returns Action=flag for a dir with user data (operator review)" {
        $root = Join-Path $TestDrive 'orphan-with-data'
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $dataPath = Join-Path $root 'has-data'
        New-Item -ItemType Directory -Path $dataPath | Out-Null
        Set-Content -LiteralPath (Join-Path $dataPath 'something.txt') -Value 'important'
        Set-Content -LiteralPath (Join-Path $dataPath 'other.txt') -Value 'also important'
        $action = InModuleScope worktree-janitor-lib -ArgumentList @($root, $dataPath) {
            param($root, $path)
            $script:ManagedRoots = @($root)
            Get-OrphanDirectoryAction -Path $path
        }
        $action.Action | Should -Be 'flag'
        $action.Reason | Should -Match 'entries'
    }

    It "returns Action=skip for a path not under a managed root" {
        $outside = Join-Path $TestDrive 'outside-of-managed'
        New-Item -ItemType Directory -Path $outside | Out-Null
        # Default ManagedRoots excludes TestDrive, so this is outside.
        $action = Get-OrphanDirectoryAction -Path $outside
        $action.Action | Should -Be 'skip'
        $action.Reason | Should -Match 'not under a managed root'
    }

    It "returns Action=skip for a non-existent path under a managed root" {
        $root = Join-Path $TestDrive 'orphan-nonexistent'
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $missing = Join-Path $root 'gone'
        $action = InModuleScope worktree-janitor-lib -ArgumentList @($root, $missing) {
            param($root, $path)
            $script:ManagedRoots = @($root)
            Get-OrphanDirectoryAction -Path $path
        }
        $action.Action | Should -Be 'skip'
        $action.Reason | Should -Match 'does not exist'
    }
}

Describe "Write-JanitorLog" {
    It "appends a JSON line per call and creates the parent dir" {
        $logPath = Join-Path $TestDrive 'janitor-logs\janitor.log'
        Write-JanitorLog -Action @{ mode = 'sweep'; path = 'X'; action = 'remove'; reason = 'r1' } -LogPath $logPath
        Write-JanitorLog -Action @{ mode = 'sweep'; path = 'Y'; action = 'flag';   reason = 'r2' } -LogPath $logPath
        Test-Path -LiteralPath $logPath | Should -Be $true
        $lines = Get-Content -LiteralPath $logPath
        $lines.Count | Should -Be 2
        ($lines[0] | ConvertFrom-Json).path | Should -Be 'X'
        ($lines[1] | ConvertFrom-Json).path | Should -Be 'Y'
    }

    It "stamps a timestamp when the caller omits one" {
        $logPath = Join-Path $TestDrive 'janitor-logs-ts\janitor.log'
        Write-JanitorLog -Action @{ path = 'Z' } -LogPath $logPath
        # PowerShell's ConvertFrom-Json deserializes ISO strings into DateTime
        # objects, losing the source format. Test the raw line instead so we
        # assert on what's actually on disk.
        $rawLine = (Get-Content -LiteralPath $logPath -Raw).TrimEnd("`r`n")
        $rawLine | Should -Match '"timestamp":"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"'
    }

    It "preserves a caller-supplied timestamp" {
        $logPath = Join-Path $TestDrive 'janitor-logs-supplied-ts\janitor.log'
        Write-JanitorLog -Action @{ path = 'W'; timestamp = '2020-01-01T00:00:00Z' } -LogPath $logPath
        # Assert against the raw line — ConvertFrom-Json would normalize the
        # DateTime and we'd lose visibility into what was written.
        $rawLine = (Get-Content -LiteralPath $logPath -Raw).TrimEnd("`r`n")
        $rawLine | Should -Match '"timestamp":"2020-01-01T00:00:00Z"'
    }

    It "rotates the log when it crosses the size cap" {
        $logDir = Join-Path $TestDrive 'janitor-rotation'
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        $logPath = Join-Path $logDir 'janitor.log'
        # Pre-populate the log file with bytes above the rotation threshold.
        Set-Content -LiteralPath $logPath -Value ('x' * 200) -NoNewline
        Write-JanitorLog -Action @{ path = 'rotation-trigger' } -LogPath $logPath -MaxSizeBytes 100
        # Original log should have been rotated; new log starts with our one entry.
        $rotated = Get-ChildItem -LiteralPath $logDir -Filter 'janitor.log.*.log'
        $rotated.Count | Should -BeGreaterOrEqual 1
        (Get-Content -LiteralPath $logPath).Count | Should -Be 1
    }
}
