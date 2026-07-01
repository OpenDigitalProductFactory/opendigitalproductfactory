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

    # Decide ok|drift.
    $state = 'drift'
    if (Test-Path $installed) {
        try {
            $data = Get-Content -Raw $installed | ConvertFrom-Json
            $entries = $data.plugins.$pluginKey
            foreach ($e in $entries) {
                if ($e.projectPath -and
                    ([IO.Path]::GetFullPath($e.projectPath).TrimEnd('\') -ieq [IO.Path]::GetFullPath($repoRoot).TrimEnd('\'))) {
                    if ($e.version -ne $want) { $state = 'drift'; break }
                    if (-not $e.installPath -or -not (Test-Path $e.installPath)) { $state = 'drift'; break }
                    $state = 'ok'; break
                }
            }
        } catch { $state = 'drift' }
    }
    if ($state -ne 'drift') { exit 0 }

    Push-Location $repoRoot
    try {
        & $claude plugin marketplace add ./ --scope local *> $null
        & $claude plugin marketplace update $marketplace *> $null
        & $claude plugin install $pluginKey --scope project *> $null
    } finally { Pop-Location }

    Write-Output "DPF platform plugin synced to v$want. Restart Claude Code to load the updated skills/hooks."
} catch { }
exit 0
