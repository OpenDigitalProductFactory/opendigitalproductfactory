# scripts/installer/windows-install-drive.Tests.ps1
#
# Pester 5 tests for the Windows installer drive recommendation helpers.
#
# Run: pwsh -NoProfile -Command "Invoke-Pester -Path scripts/installer/windows-install-drive.Tests.ps1 -Output Detailed"

#Requires -Modules @{ ModuleName='Pester'; ModuleVersion='5.0' }

BeforeAll {
    $script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $script:InstallerPath = Join-Path $script:RepoRoot 'install-dpf.ps1'
    . $script:InstallerPath -LibraryOnly

    function New-TestLogicalDisk {
        param(
            [Parameter(Mandatory)][string] $DeviceID,
            [Parameter(Mandatory)][double] $FreeGB,
            [double] $SizeGB = 500,
            [int] $DriveType = 3,
            [string] $VolumeName = ''
        )

        [PSCustomObject]@{
            DeviceID   = $DeviceID
            FreeSpace  = [int64]($FreeGB * 1GB)
            Size       = [int64]($SizeGB * 1GB)
            DriveType  = $DriveType
            VolumeName = $VolumeName
        }
    }
}

Describe "Windows installer drive recommendation" {
    It "loads installer helper functions without running the installer flow" {
        Get-Command Get-DPFDriveInventory -ErrorAction Stop | Should -Not -BeNullOrEmpty
        Get-Command Get-DPFInstallDriveRecommendation -ErrorAction Stop | Should -Not -BeNullOrEmpty
        Get-Command Get-DPFInstallDriveFreeSpace -ErrorAction Stop | Should -Not -BeNullOrEmpty
        Get-Command Get-DPFDockerStorageRecommendation -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It "recommends D:\DPF when C is below the recommended free-space threshold and D has room" {
        $drives = Get-DPFDriveInventory -LogicalDisks @(
            New-TestLogicalDisk -DeviceID 'C:' -FreeGB 20
            New-TestLogicalDisk -DeviceID 'D:' -FreeGB 250
        )

        $recommendation = Get-DPFInstallDriveRecommendation `
            -DriveInventory $drives `
            -DefaultInstallDir 'C:\DPF' `
            -RecommendedFreeGB 50

        $recommendation.Recommended | Should -Be $true
        $recommendation.InstallDir | Should -Be 'D:\DPF'
        $recommendation.RecommendedDrive | Should -Be 'D:'
        $recommendation.Message | Should -Match 'C: has 20 GB free'
        $recommendation.Message | Should -Match 'D: has 250 GB free'
    }

    It "uses the next drive letter with room rather than the largest drive" {
        $drives = Get-DPFDriveInventory -LogicalDisks @(
            New-TestLogicalDisk -DeviceID 'C:' -FreeGB 12
            New-TestLogicalDisk -DeviceID 'D:' -FreeGB 75
            New-TestLogicalDisk -DeviceID 'E:' -FreeGB 900
        )

        $recommendation = Get-DPFInstallDriveRecommendation `
            -DriveInventory $drives `
            -DefaultInstallDir 'C:\DPF' `
            -RecommendedFreeGB 50

        $recommendation.InstallDir | Should -Be 'D:\DPF'
        $recommendation.RecommendedDrive | Should -Be 'D:'
    }

    It "skips too-small non-C drives and recommends the next letter that has room" {
        $drives = Get-DPFDriveInventory -LogicalDisks @(
            New-TestLogicalDisk -DeviceID 'C:' -FreeGB 12
            New-TestLogicalDisk -DeviceID 'D:' -FreeGB 40
            New-TestLogicalDisk -DeviceID 'E:' -FreeGB 125
        )

        $recommendation = Get-DPFInstallDriveRecommendation `
            -DriveInventory $drives `
            -DefaultInstallDir 'C:\DPF' `
            -RecommendedFreeGB 50

        $recommendation.InstallDir | Should -Be 'E:\DPF'
        $recommendation.RecommendedDrive | Should -Be 'E:'
    }

    It "keeps C:\DPF when C already has enough room" {
        $drives = Get-DPFDriveInventory -LogicalDisks @(
            New-TestLogicalDisk -DeviceID 'C:' -FreeGB 120
            New-TestLogicalDisk -DeviceID 'D:' -FreeGB 250
        )

        $recommendation = Get-DPFInstallDriveRecommendation `
            -DriveInventory $drives `
            -DefaultInstallDir 'C:\DPF' `
            -RecommendedFreeGB 50

        $recommendation.Recommended | Should -Be $false
        $recommendation.InstallDir | Should -Be 'C:\DPF'
    }

    It "keeps the default install path when no drive inventory is available" {
        $recommendation = Get-DPFInstallDriveRecommendation `
            -DriveInventory @() `
            -DefaultInstallDir 'C:\DPF' `
            -RecommendedFreeGB 50

        $recommendation.Recommended | Should -Be $false
        $recommendation.InstallDir | Should -Be 'C:\DPF'
    }

    It "reports free space for the selected install drive instead of hardcoding C" {
        $drives = Get-DPFDriveInventory -LogicalDisks @(
            New-TestLogicalDisk -DeviceID 'C:' -FreeGB 3
            New-TestLogicalDisk -DeviceID 'D:' -FreeGB 250
        )

        $installDrive = Get-DPFInstallDriveFreeSpace -InstallDir 'D:\DPF' -DriveInventory $drives

        $installDrive.DeviceID | Should -Be 'D:'
        $installDrive.FreeGB | Should -Be 250
    }
}

Describe "Docker Desktop storage warning" {
    It "suggests a non-C Docker storage target when Docker data is on a crowded C drive" {
        $drives = Get-DPFDriveInventory -LogicalDisks @(
            New-TestLogicalDisk -DeviceID 'C:' -FreeGB 30
            New-TestLogicalDisk -DeviceID 'D:' -FreeGB 500
        )

        $recommendation = Get-DPFDockerStorageRecommendation `
            -DriveInventory $drives `
            -DockerDataPath 'C:\Users\owner\AppData\Local\Docker\wsl\disk' `
            -RecommendedFreeGB 100

        $recommendation.ShouldWarn | Should -Be $true
        $recommendation.CurrentPath | Should -Be 'C:\Users\owner\AppData\Local\Docker\wsl\disk'
        $recommendation.TargetPath | Should -Be 'D:\DockerDesktop\wsl\disk'
        $recommendation.Message | Should -Match 'Docker Desktop stores Linux data on C:'
        $recommendation.Message | Should -Match 'D:\\DockerDesktop\\wsl\\disk'
    }

    It "does not warn when Docker data is already off C" {
        $drives = Get-DPFDriveInventory -LogicalDisks @(
            New-TestLogicalDisk -DeviceID 'C:' -FreeGB 30
            New-TestLogicalDisk -DeviceID 'D:' -FreeGB 500
        )

        $recommendation = Get-DPFDockerStorageRecommendation `
            -DriveInventory $drives `
            -DockerDataPath 'D:\DockerDesktop\wsl\disk' `
            -RecommendedFreeGB 100

        $recommendation.ShouldWarn | Should -Be $false
    }
}
