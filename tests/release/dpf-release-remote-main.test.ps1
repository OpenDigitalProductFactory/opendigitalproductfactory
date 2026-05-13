Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-TestGit {
    & git.exe @args
    if ($LASTEXITCODE -ne 0) {
        throw "git $($args -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Get-PowerShellCommand {
    $command = Get-Command powershell -ErrorAction SilentlyContinue
    if (-not $command) {
        $command = Get-Command pwsh -ErrorAction Stop
    }
    return $command.Source
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$releaseScript = Join-Path $repoRoot "dpf-release.ps1"
if (-not (Test-Path -LiteralPath $releaseScript)) {
    throw "Missing release script at $releaseScript"
}

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("dpf-release-test-" + [Guid]::NewGuid().ToString("N"))
$tempRoot = [System.IO.Path]::GetTempPath()

try {
    $remote = Join-Path $testRoot "remote.git"
    $seed = Join-Path $testRoot "seed"
    $local = Join-Path $testRoot "local"

    New-Item -ItemType Directory -Path $testRoot | Out-Null

    Invoke-TestGit init --bare --initial-branch=main $remote

    Invoke-TestGit init --initial-branch=main $seed
    Invoke-TestGit "-C" $seed config user.email "release-test@example.invalid"
    Invoke-TestGit "-C" $seed config user.name "Release Test"
    Set-Content -Path (Join-Path $seed "release.txt") -Value "base" -Encoding ASCII
    Invoke-TestGit "-C" $seed add release.txt
    Invoke-TestGit "-C" $seed commit -m "base"
    Invoke-TestGit "-C" $seed tag v1.0.0
    Invoke-TestGit "-C" $seed remote add origin $remote
    Invoke-TestGit "-C" $seed push origin main --tags

    Invoke-TestGit clone $remote $local
    Invoke-TestGit "-C" $local config user.email "release-test@example.invalid"
    Invoke-TestGit "-C" $local config user.name "Release Test"
    Set-Content -Path (Join-Path $local "release.txt") -Value "local-only" -Encoding ASCII
    Invoke-TestGit "-C" $local commit -am "local-only"
    $localHead = (& git "-C" $local rev-parse HEAD).Trim()
    $scriptUnderTest = Join-Path $local "dpf-release.ps1"
    Copy-Item -LiteralPath $releaseScript -Destination $scriptUnderTest

    Set-Content -Path (Join-Path $seed "release.txt") -Value "remote-only" -Encoding ASCII
    Invoke-TestGit "-C" $seed commit -am "remote-only"
    Invoke-TestGit "-C" $seed push origin main

    $powerShell = Get-PowerShellCommand
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = $powerShell
    $processInfo.WorkingDirectory = $local
    $processInfo.UseShellExecute = $false
    $processInfo.RedirectStandardInput = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $processInfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptUnderTest`" minor"

    $process = [System.Diagnostics.Process]::Start($processInfo)
    $process.StandardInput.WriteLine("n")
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $output = "$stdout`n$stderr"

    if ($process.ExitCode -ne 0) {
        throw "Expected release script to abort cleanly after confirmation; got exit code $($process.ExitCode). Output: $output"
    }
    if ($output -match "Fast-forward pull failed") {
        throw "Release script still tried to fast-forward local main. Output: $output"
    }
    if ($output -notmatch "Release target:\s+origin/main") {
        throw "Release script did not report origin/main as the release target. Output: $output"
    }
    if ($output -notmatch "Aborted\.") {
        throw "Release script did not abort at operator confirmation. Output: $output"
    }

    $headAfter = (& git "-C" $local rev-parse HEAD).Trim()
    if ($headAfter -ne $localHead) {
        throw "Release script changed local HEAD. Before: $localHead After: $headAfter"
    }

    $createdTag = ((& git "-C" $local tag --list v1.1.0) | Out-String).Trim()
    if ($createdTag) {
        throw "Release script created v1.1.0 even though operator rejected confirmation."
    }

    Write-Host "PASS: dpf-release.ps1 uses origin/main without mutating divergent local main."
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
        if (-not $resolvedTestRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove test root outside temp directory: $resolvedTestRoot"
        }
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
