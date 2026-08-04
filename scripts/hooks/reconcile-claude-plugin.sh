#!/usr/bin/env sh
# DPF -- Claude Code plugin reconcile (SessionStart hook, POSIX)
#
# Self-heals the `dpf-platform@dpf-platform-local` plugin install for THIS repo
# so every Claude client on every machine converges to the plugin version
# committed in the repo -- without a manual re-bootstrap. Fires on SessionStart
# via scripts/hooks/run-hook.mjs.
#
# Why this exists: the plugin's SKILL files load live from the directory-source
# marketplace, but ~/.claude/plugins/{installed_plugins.json,cache/} are a
# per-machine materialization. When the committed plugin version bumps (git
# pull) -- or the cache is wiped by a self-upgrade / git clean -- that
# materialization drifts: the plugin panel shows a stale version, and a
# dangling installPath makes the plugin "fail to load" (no skills, then it
# vanishes). Nothing re-synced it. This hook is that missing trigger.
#
# Fast no-op path: when the installed version already matches the committed
# manifest AND its cache dir is present, this does nothing and prints nothing.
# On drift it refreshes the marketplace, reinstalls at project scope, and
# prints a one-line alert. The new version applies on the NEXT session (plugin
# loading happens before this hook runs).
#
# Contract: exit 0 ALWAYS; never block session start.

set -u

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
MANIFEST="$REPO_ROOT/packages/dpf-skill-pack/.claude-plugin/plugin.json"
INSTALLED="$HOME/.claude/plugins/installed_plugins.json"
PLUGIN_KEY="dpf-platform@dpf-platform-local"
MARKETPLACE="dpf-platform-local"

# Preconditions: committed manifest present + python3 for safe JSON.
[ -f "$MANIFEST" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

# Resolve the claude binary (not PATH-only: GUI / ~/.claude/local installs are
# common and absent from a non-interactive hook PATH).
CLAUDE_BIN=""
if command -v claude >/dev/null 2>&1; then
  CLAUDE_BIN="$(command -v claude)"
else
  for c in \
    "$HOME/.claude/local/claude" \
    "/opt/homebrew/bin/claude" \
    "/usr/local/bin/claude" \
    "$HOME/.local/bin/claude"; do
    [ -x "$c" ] && { CLAUDE_BIN="$c"; break; }
  done
fi
[ -n "$CLAUDE_BIN" ] || exit 0

WANT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$MANIFEST" 2>/dev/null)" || exit 0
[ -n "$WANT" ] || exit 0

# Decide ok|drift for THIS repo. Drift = no entry for this repo, version
# mismatch, or a missing installPath (wiped cache -- the "failed to load"
# failure). Used both before reconcile and again after, to verify convergence.
drift_state() {
  python3 - "$INSTALLED" "$REPO_ROOT" "$WANT" <<'PY' 2>/dev/null
import json, os, sys
installed, repo, want = sys.argv[1], sys.argv[2], sys.argv[3]
def norm(p): return os.path.normcase(os.path.normpath(p))
try:
    data = json.load(open(installed))
except Exception:
    print("drift"); sys.exit(0)
entries = (data.get("plugins") or {}).get("dpf-platform@dpf-platform-local") or []
for e in entries:
    pp = e.get("projectPath")
    if pp and norm(pp) == norm(repo):
        if e.get("version") != want:
            print("drift"); sys.exit(0)
        ip = e.get("installPath") or ""
        if not ip or not os.path.isdir(ip):
            print("drift"); sys.exit(0)
        print("ok"); sys.exit(0)
print("drift")
PY
}

[ "$(drift_state)" = "drift" ] || exit 0

# Prune every install record for THIS repo before reinstalling. This is the
# load-bearing fix: `claude plugin install` no-ops when ANY project record for
# this key already exists (it checks presence, not version) and never removes
# stale-version records -- so a naive reinstall neither converges to a new
# committed version nor cleans up after itself. Left unchecked that appended a
# fresh record on every version bump, accumulating hundreds of duplicates.
# Pruning first gives install a clean slate to materialize exactly one record
# at the committed version. Records for OTHER repos are left untouched.
prune_repo_records() {
  python3 - "$INSTALLED" "$REPO_ROOT" <<'PY' 2>/dev/null || true
import json, os, sys, tempfile
installed, repo = sys.argv[1], sys.argv[2]
def norm(p): return os.path.normcase(os.path.normpath(p))
try:
    data = json.load(open(installed))
except Exception:
    sys.exit(0)
plugins = data.get("plugins")
if not isinstance(plugins, dict):
    sys.exit(0)
key = "dpf-platform@dpf-platform-local"
entries = plugins.get(key)
if not isinstance(entries, list):
    sys.exit(0)
kept = [e for e in entries
        if not (isinstance(e, dict) and e.get("projectPath")
                and norm(e["projectPath"]) == norm(repo))]
if len(kept) == len(entries):
    sys.exit(0)  # nothing for this repo to prune
if kept:
    plugins[key] = kept
else:
    plugins.pop(key, None)
# Atomic replace so a racing SessionStart hook never reads a half-written file.
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(installed))
with os.fdopen(fd, "w") as f:
    json.dump(data, f, indent=2)
os.replace(tmp, installed)
PY
}

# Reconcile. The directory-source marketplace validates live, so add/update +
# install re-materialize the cache at the committed version. `add` is for the
# first-run case where the marketplace isn't yet known on this machine.
(
  cd "$REPO_ROOT" 2>/dev/null || exit 0
  "$CLAUDE_BIN" plugin marketplace add ./ --scope local >/dev/null 2>&1 || true
  "$CLAUDE_BIN" plugin marketplace update "$MARKETPLACE" >/dev/null 2>&1 || true
  prune_repo_records
  "$CLAUDE_BIN" plugin install "$PLUGIN_KEY" --scope project >/dev/null 2>&1 || true
)

# Verify convergence before announcing it: a reported install is not a
# converged version (the exact false-success this hook exists to prevent).
# SessionStart stdout is added to session context so the assistant can relay it.
if [ "$(drift_state)" = "ok" ]; then
  printf 'DPF platform plugin synced to v%s. Restart Claude Code to load the updated skills/hooks.\n' "$WANT"
else
  printf 'DPF platform plugin reconcile could NOT converge to v%s (still drifted). Run: %s plugin install %s --scope project\n' "$WANT" "$CLAUDE_BIN" "$PLUGIN_KEY"
fi
exit 0
