# DPF -- Claude Code plugin reconcile (SessionStart hook, Windows)
#
# PowerShell sibling of scripts/hooks/reconcile-claude-plugin.sh. Same contract:
# self-heal the dpf-platform plugin install for THIS repo so the plugin panel
# and hook loading converge to the committed version, and exit 0 ALWAYS.
#
# See the .sh header for the full rationale.

$ErrorActionPreference = 'SilentlyContinue'

try {
    $repoRoot = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
    $manifest = Join-Path $repoRoot 'packages/dpf-skill-pack/.claude-plugin/plugin.json'
    $installed = Join-Path $env:USERPROFILE '.claude/plugins/installed_plugins.json'
    $pluginKey = 'dpf-platform@dpf-platform-local'
    $marketplace = 'dpf-platform-local'

    if (-not (Test-Path $manifest)) { exit 0 }

    # Resolve claude (PATH first, then common install locations).
    $claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
    if (-not $claude) {
        foreach ($c in @(
            (Join-Path $env:USERPROFILE '.claude/local/claude.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs/claude/claude.exe'))) {
            if (Test-Path $c) { $claude = $c; break }
        }
    }
    if (-not $claude) { exit 0 }

    $want = (Get-Content -Raw $manifest | ConvertFrom-Json).version
    if (-not $want) { exit 0 }

    # Decide ok|drift for THIS repo. Used both before reconcile and again after,
    # to verify convergence rather than trust the install call.
    function Get-DriftState {
        if (-not (Test-Path $installed)) { return 'drift' }
        try {
            $data = Get-Content -Raw $installed | ConvertFrom-Json
            foreach ($e in @($data.plugins.$pluginKey)) {
                if ($e.projectPath -and
                    ([IO.Path]::GetFullPath($e.projectPath).TrimEnd('\') -ieq [IO.Path]::GetFullPath($repoRoot).TrimEnd('\'))) {
                    if ($e.version -ne $want) { return 'drift' }
                    if (-not $e.installPath -or -not (Test-Path $e.installPath)) { return 'drift' }
                    return 'ok'
                }
            }
        } catch { return 'drift' }
        return 'drift'
    }

    if ((Get-DriftState) -ne 'drift') { exit 0 }

    # Prune every install record for THIS repo before reinstalling. `claude
    # plugin install` no-ops when ANY project record for this key exists (it
    # checks presence, not version) and never removes stale-version records, so
    # a naive reinstall neither converges to a new committed version nor cleans
    # up -- accumulating a fresh duplicate on every version bump. Pruning first
    # gives install a clean slate. Records for OTHER repos are left untouched.
    function Remove-RepoRecords {
        if (-not (Test-Path $installed)) { return }
        try {
            $data = Get-Content -Raw $installed | ConvertFrom-Json
            if (-not $data.plugins.$pluginKey) { return }
            $kept = @($data.plugins.$pluginKey | Where-Object {
                -not ($_.projectPath -and
                    ([IO.Path]::GetFullPath($_.projectPath).TrimEnd('\') -ieq [IO.Path]::GetFullPath($repoRoot).TrimEnd('\')))
            })
            if ($kept.Count -eq @($data.plugins.$pluginKey).Count) { return }  # nothing for this repo
            if ($kept.Count -gt 0) { $data.plugins.$pluginKey = $kept }
            else { $data.plugins.PSObject.Properties.Remove($pluginKey) }
            # Atomic replace so a racing SessionStart hook never reads a half file.
            $tmp = "$installed.tmp$PID"
            ($data | ConvertTo-Json -Depth 100) | Set-Content -Path $tmp -Encoding UTF8
            Move-Item -Force -Path $tmp -Destination $installed
        } catch { }
    }

    Push-Location $repoRoot
    try {
        & $claude plugin marketplace add ./ --scope local *> $null
        & $claude plugin marketplace update $marketplace *> $null
        Remove-RepoRecords
        & $claude plugin install $pluginKey --scope project *> $null
    } finally { Pop-Location }

    # Verify convergence before announcing it -- a reported install is not a
    # converged version (the false-success this hook exists to prevent).
    if ((Get-DriftState) -eq 'ok') {
        Write-Output "DPF platform plugin synced to v$want. Restart Claude Code to load the updated skills/hooks."
    } else {
        Write-Output "DPF platform plugin reconcile could NOT converge to v$want (still drifted). Run: $claude plugin install $pluginKey --scope project"
    }
} catch { }
exit 0
