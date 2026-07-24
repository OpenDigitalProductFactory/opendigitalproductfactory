#!/usr/bin/env bash
# scripts/sync-mcp-worktrees.sh
#
# POSIX counterpart of sync-mcp-worktrees.ps1 -- propagate the gitignored DPF
# MCP client config (.mcp.json + .vscode/mcp.json) from the root clone into
# every LINKED git worktree, give each linked worktree a unique
# COMPOSE_PROJECT_NAME, and stamp its compile-ready/source-only readiness.
#
# Invoked automatically by the Claude Code WorktreeCreate hook through
# scripts/hooks/run-hook.mjs (see .claude/settings.json), and runnable by hand
# after `git worktree add`.
#
# Scope vs scripts/seed-worktree-mcp.sh: seed-worktree-mcp.sh is full one-time
# per-worktree setup (incl. the DPF skill-pack / agent-toolchain bootstrap).
# This script stays deliberately lean -- MCP config + compose name + readiness
# marker -- so it is cheap and safe to fire on EVERY worktree creation. Reach
# for seed-worktree-mcp.sh when you also want the skill pack in a worktree.
#
# Differences vs the .ps1: copies the files (no hardlinks -- portable across
# filesystems and works for worktrees anywhere, not just one drive) and
# re-registers nothing (the .mcp.json uses ${DPF_MCP_BEARER_TOKEN} env-var
# notation, so there is no per-token rewrite to do).
#
# Exit 0 ALWAYS -- a sync failure must never block worktree creation or use.
#
# Run under `sh` by the hook launcher; written to POSIX-portable, BSD/GNU-safe
# shell (no `sed -i`, no GNU-only flags) per docs/install/platform-support-watchlist.md.

set -u

command -v git >/dev/null 2>&1 || exit 0

# ---- Resolve the main worktree (root clone), where the source files live ----
# git-common-dir is the shared .git directory; its parent is the root clone.
# Works whether this script runs from the root clone or from a linked worktree.
SCRIPT_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || exit 0
GIT_COMMON_DIR="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 0
[ -n "$GIT_COMMON_DIR" ] || exit 0
MAIN_ROOT="$(cd "$(dirname "$GIT_COMMON_DIR")" 2>/dev/null && pwd -P)" || exit 0

SRC_MCP="$MAIN_ROOT/.mcp.json"
SRC_VSCODE="$MAIN_ROOT/.vscode/mcp.json"

# Nothing to propagate yet (platform not installed / no MCP token minted).
[ -f "$SRC_MCP" ] || exit 0

# ---- Helpers (mirror scripts/seed-worktree-mcp.sh behaviour) ----------------

compose_project_name_for() {
    base="$(basename "$1")"
    slug="$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
    if [ -z "$slug" ] || [ "$slug" = "dpf" ]; then
        slug="worktree"
    fi
    case "$slug" in
        dpf-*) printf '%s\n' "$slug" ;;
        *) printf 'dpf-%s\n' "$slug" ;;
    esac
}

set_compose_project_env() {
    env_file="$1"
    project_name="$2"
    desired="COMPOSE_PROJECT_NAME=$project_name"

    if [ ! -f "$env_file" ]; then
        {
            printf '# Worktree-scoped Docker Compose project.\n'
            printf '# Prevents linked worktree containers and volumes from joining the root dpf project.\n'
            printf '%s\n' "$desired"
        } > "$env_file" 2>/dev/null || true
        return 0
    fi

    if grep -Eq '^[[:space:]]*COMPOSE_PROJECT_NAME[[:space:]]*=' "$env_file"; then
        current="$(sed -nE 's/^[[:space:]]*COMPOSE_PROJECT_NAME[[:space:]]*=[[:space:]]*(.*)$/\1/p' "$env_file" 2>/dev/null | tail -n 1)"
        # Only fill a blank or root-default value; never clobber a custom one.
        if [ -z "$current" ] || [ "$current" = "dpf" ]; then
            tmp="${env_file}.tmp.$$"
            if awk -v d="$desired" '
                /^[[:space:]]*COMPOSE_PROJECT_NAME[[:space:]]*=/ { if (!seen) { print d; seen = 1 } next }
                { print }
            ' "$env_file" > "$tmp" 2>/dev/null; then
                mv "$tmp" "$env_file" 2>/dev/null || rm -f "$tmp" 2>/dev/null
            else
                rm -f "$tmp" 2>/dev/null
            fi
        fi
        return 0
    fi

    { printf '\n%s\n' "$desired"; } >> "$env_file" 2>/dev/null || true
}

copy_into() {
    src="$1"
    dst="$2"
    [ -f "$src" ] || return 0
    mkdir -p "$(dirname "$dst")" 2>/dev/null || return 0
    cp -f "$src" "$dst" 2>/dev/null || true
}

write_readiness_marker() {
    wt="$1"
    pnpm_on_path=false
    corepack_on_path=false
    node_modules_present=false
    readiness_state="source-only"
    readiness_reason="dependencies_missing"
    probed_via_helper=false

    command -v pnpm >/dev/null 2>&1 && pnpm_on_path=true
    command -v corepack >/dev/null 2>&1 && corepack_on_path=true
    [ -d "$wt/node_modules" ] && node_modules_present=true

    # BI-3047C122 (Wave 3): a cheap real probe (dependency resolution + @dpf/*
    # workspace-link locality) beats structural node_modules presence — the
    # latter marked a node_modules JUNCTIONED TO A STALE SIBLING WORKTREE
    # "compile-ready" on 2026-07-24, silently typechecking against the wrong
    # source. Sync runs are exactly where re-classifying an EXISTING worktree
    # would have caught that. Cheap (no install); falls back to the structural
    # guess only when node or the helper is unavailable.
    readiness_helper="$wt/scripts/lib/bootstrap-worktree-deps.mjs"
    if [ -f "$readiness_helper" ] && command -v node >/dev/null 2>&1; then
        classify_json="$(node "$readiness_helper" "$wt" --classify-only 2>/dev/null || true)"
        if [ -n "$classify_json" ]; then
            probed_state="$(node -e 'try{const r=JSON.parse(process.argv[1]);process.stdout.write(String(r.status||""))}catch{}' "$classify_json" 2>/dev/null || true)"
            probed_reason="$(node -e 'try{const r=JSON.parse(process.argv[1]);process.stdout.write(String(r.reason||""))}catch{}' "$classify_json" 2>/dev/null || true)"
            if [ -n "$probed_state" ] && [ -n "$probed_reason" ]; then
                readiness_state="$probed_state"
                readiness_reason="$probed_reason"
                probed_via_helper=true
            fi
        fi
    fi

    if [ "$probed_via_helper" != true ]; then
        if [ "$node_modules_present" = true ] && { [ "$pnpm_on_path" = true ] || [ "$corepack_on_path" = true ]; }; then
            readiness_state="compile-ready"
            readiness_reason="package_manager_and_dependencies_present"
        elif [ "$node_modules_present" != true ]; then
            readiness_reason="node_modules_missing"
        elif [ "$pnpm_on_path" != true ] && [ "$corepack_on_path" != true ]; then
            readiness_reason="pnpm_corepack_missing"
        fi
    fi

    {
        cat <<EOF
{
  "schemaVersion": 1,
  "state": "$readiness_state",
  "reason": "$readiness_reason",
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "checks": {
    "pnpmOnPath": $pnpm_on_path,
    "corepackOnPath": $corepack_on_path,
    "nodeModulesPresent": $node_modules_present,
    "probedViaBootstrapHelper": $probed_via_helper
  }
}
EOF
    } > "$wt/.dpf-worktree-readiness.json" 2>/dev/null || true
}

# ---- Sync every linked worktree (skip the root clone itself) ----------------

synced=0
WORKTREES="$(git -C "$MAIN_ROOT" worktree list --porcelain 2>/dev/null)"
while IFS= read -r line; do
    case "$line" in
        "worktree "*)
            wt="${line#worktree }"
            [ -d "$wt" ] || continue
            wt_abs="$(cd "$wt" 2>/dev/null && pwd -P)" || continue
            [ "$wt_abs" = "$MAIN_ROOT" ] && continue
            copy_into "$SRC_MCP" "$wt_abs/.mcp.json"
            copy_into "$SRC_VSCODE" "$wt_abs/.vscode/mcp.json"
            set_compose_project_env "$wt_abs/.env" "$(compose_project_name_for "$wt_abs")"
            write_readiness_marker "$wt_abs"
            synced=$((synced + 1))
            ;;
    esac
done <<EOF
$WORKTREES
EOF

printf 'sync-mcp-worktrees: synced %s linked worktree(s) from %s; readiness markers updated\n' "$synced" "$MAIN_ROOT"
exit 0
