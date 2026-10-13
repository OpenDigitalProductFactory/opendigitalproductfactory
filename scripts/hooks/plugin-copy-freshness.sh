#!/bin/sh
# scripts/hooks/plugin-copy-freshness.sh
#
# SessionStart advisory (POSIX): name an installed dpf-platform copy that has
# drifted from the root clone's pack. Counterpart of plugin-copy-freshness.ps1.
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
# Advisory only. Exit 0 ALWAYS; never writes. Silent without python3.
# Set DPF_SKIP_PLUGIN_COPY_CHECK=1 to silence. Plain ASCII.

set -u

[ "${DPF_SKIP_PLUGIN_COPY_CHECK:-0}" = "1" ] && exit 0
command -v python3 >/dev/null 2>&1 || exit 0

# Repo root: Claude Code's per-invocation env var, else two dirs above this file.
root="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$root" ]; then
  root="$(CDPATH= cd -- "${0%/*}/../.." 2>/dev/null && pwd)"
fi
checker="${root:-.}/packages/dpf-skill-pack/scripts/installed_copy_freshness.py"
[ -f "$checker" ] || exit 0

python3 "$checker" --project-dir "${root:-.}" 2>/dev/null
exit 0
