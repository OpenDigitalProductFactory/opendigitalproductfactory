#Requires -Version 5.1
# scripts/hooks/plugin-copy-freshness.ps1
#
# SessionStart advisory (Windows): name an installed dpf-platform copy that has
# drifted from the root clone's pack. Counterpart of plugin-copy-freshness.sh.
#
# Why (BI-16EAAB62): the other SessionStart checks read the repository -- the
# descriptor it intends, the hook wiring on origin/main -- never the copy a
# client loaded. On 2026-10-01 the shared managed copy stayed on 0.2.5 with
# the old plain-http bearer descriptor and the desktop app refused sign-in with
# nothing at session start to say why. BI-F4BE47B5 was the same class in the
# Claude plugin cache. The comparison, and the one list of copy locations it
# walks, live in packages/dpf-skill-pack/scripts (installed_copy_freshness.py
# over update_agent_toolchain.py); this file only finds an interpreter.
#
# Invoked by the .claude/settings.json SessionStart hook via run-hook.mjs.
# Advisory only. Exit 0 ALWAYS; never writes. Silent without Python.
# Set DPF_SKIP_PLUGIN_COPY_CHECK=1 to silence. Plain ASCII per AGENTS.md.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'  # never throw out of a hook

try {
    if ($env:DPF_SKIP_PLUGIN_COPY_CHECK -eq '1') { exit 0 }

    # Drain stdin (payload unused) so the launcher's pipe never blocks.
    [void][Console]::In.ReadToEnd()

    $root = $env:CLAUDE_PROJECT_DIR
    if ([string]::IsNullOrWhiteSpace($root)) {
        $root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    }
    $checker = Join-Path $root 'packages\dpf-skill-pack\scripts\installed_copy_freshness.py'
    if (-not (Test-Path -LiteralPath $checker)) { exit 0 }

    # Same interpreter lookup as update-agent-toolchain.ps1: python, then py -3.
    $python = Get-Command python -ErrorAction SilentlyContinue
    $prefix = @()
    if (-not $python) {
        $python = Get-Command py -ErrorAction SilentlyContinue
        $prefix = @('-3')
    }
    if (-not $python) { exit 0 }

    & $python.Source @prefix $checker --project-dir $root 2>$null
} catch {
    # Advisory only: swallow everything.
}
exit 0
