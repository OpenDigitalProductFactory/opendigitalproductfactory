#!/usr/bin/env bash
# Open Digital Product Factory -- worktree MCP config seeder (POSIX shell)
#
# Copies .mcp.json and .vscode/mcp.json from the main worktree (root clone)
# into a target git worktree so Claude Code's /mcp connector list and the
# VS Code MCP client can find the dpf server.
#
# Predicated on platform installation: scripts/setup.sh must have completed
# AND an admin must have generated an MCP token at Admin > Platform Development
# (which writes the source files at the root clone). The two source files are
# gitignored on purpose -- they carry a local bearer token -- so they do not
# travel with `git worktree add`.
#
# For linked worktrees, this also writes a worktree-scoped COMPOSE_PROJECT_NAME
# into the target .env file. docker-compose.yml defaults to the root project
# name "dpf"; linked worktrees must override it so their containers and volumes
# cannot contaminate the live install project.
#
# Usage:
#   ./scripts/seed-worktree-mcp.sh                  # seed current directory
#   ./scripts/seed-worktree-mcp.sh <path>           # seed a specific worktree
#   ./scripts/seed-worktree-mcp.sh --force          # overwrite existing files
#   ./scripts/seed-worktree-mcp.sh <path> --force
#   ./scripts/seed-worktree-mcp.sh <path> --core-only

set -euo pipefail

target=""
force=0
core_only=0
for arg in "$@"; do
    case "$arg" in
        --force) force=1 ;;
        --core-only) core_only=1 ;;
        *)
            if [ -z "$target" ]; then
                target="$arg"
            else
                printf '  [FAIL] Unexpected argument: %s\n' "$arg" >&2
                exit 1
            fi
            ;;
    esac
done
target="${target:-$PWD}"

step() { printf '\n-> %s\n' "$1"; }
ok()   { printf '  [OK] %s\n' "$1"; }
skip() { printf '  [SKIP] %s\n' "$1"; }
warn() { printf '  [WARN] %s\n' "$1" >&2; }

compose_project_name_for() {
    local base slug
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
    local env_file="$1" project_name="$2" desired current tmp
    desired="COMPOSE_PROJECT_NAME=$project_name"

    if [ ! -f "$env_file" ]; then
        {
            printf '# Worktree-scoped Docker Compose project.\n'
            printf '# Prevents linked worktree containers and volumes from joining the root dpf project.\n'
            printf '%s\n' "$desired"
        } > "$env_file"
        ok "Set $desired in $env_file"
        return 0
    fi

    if grep -Eq '^[[:space:]]*COMPOSE_PROJECT_NAME[[:space:]]*=' "$env_file"; then
        current="$(sed -nE 's/^[[:space:]]*COMPOSE_PROJECT_NAME[[:space:]]*=[[:space:]]*(.*)$/\1/p' "$env_file" | tail -n 1)"
        if [ "$force" -eq 1 ] || [ -z "$current" ] || [ "$current" = "dpf" ]; then
            tmp="${env_file}.tmp.$$"
            awk -v desired="$desired" '
                /^[[:space:]]*COMPOSE_PROJECT_NAME[[:space:]]*=/ {
                    if (!done) {
                        print desired
                        done = 1
                    }
                    next
                }
                { print }
            ' "$env_file" > "$tmp"
            mv "$tmp" "$env_file"
            ok "Set $desired in $env_file"
        else
            skip "Existing COMPOSE_PROJECT_NAME in $env_file is already custom."
        fi
        return 0
    fi

    {
        printf '\n'
        printf '%s\n' "$desired"
    } >> "$env_file"
    ok "Set $desired in $env_file"
}

if [ ! -d "$target" ]; then
    printf '  [FAIL] Target is not a directory: %s\n' "$target" >&2
    exit 1
fi

cd "$target"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf '  [FAIL] Not inside a git working tree: %s\n' "$target" >&2
    exit 1
fi

target_abs="$(pwd -P)"
main_git_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
main_abs="$(cd "$(dirname "$main_git_dir")" && pwd -P)"

step "Locating main worktree"
ok "Main worktree:   $main_abs"
ok "Target worktree: $target_abs"

if [ "$main_abs" = "$target_abs" ]; then
    ok "Target IS the main worktree -- nothing to seed."
    exit 0
fi

step "Configuring worktree Compose project"
set_compose_project_env "$target_abs/.env" "$(compose_project_name_for "$target_abs")"

step "Copying MCP config"

copy_one() {
    local src="$1" dst="$2"
    if [ ! -f "$src" ]; then
        printf '\n  [FAIL] Missing source: %s\n\n' "$src" >&2
        cat >&2 <<EOF
  The platform must be installed and an MCP token generated before seeding worktrees.
  Steps:
    1. From the main worktree at $main_abs, run scripts/setup.sh if you have not already.
    2. Start the platform (pnpm dev or docker compose up) and log in at http://localhost:3000 as admin@dpf.local.
    3. Open Admin > Platform Development and generate an MCP token (writes .mcp.json + .vscode/mcp.json at the root).
    4. Re-run this script.
EOF
        exit 1
    fi

    mkdir -p "$(dirname "$dst")"
    if [ -f "$dst" ] && [ "$force" -ne 1 ]; then
        skip "$dst already exists. Re-run with --force to overwrite."
        return 0
    fi
    cp "$src" "$dst"
    ok "Wrote $dst"
}

copy_one "$main_abs/.mcp.json"        "$target_abs/.mcp.json"
copy_one "$main_abs/.vscode/mcp.json" "$target_abs/.vscode/mcp.json"

# BI-3047C122 (Wave 2): optional managed dependency bootstrap. Born compile-ready
# instead of source-only when requested — kills the "junction a sibling's
# node_modules" dance. OFF by default (a multi-minute install must not slow every
# creation); enable per session with DPF_WORKTREE_BOOTSTRAP=1. Fail-safe: a failed
# bootstrap leaves the worktree source-only and NEVER breaks creation.
if [ "${DPF_WORKTREE_BOOTSTRAP:-0}" = "1" ]; then
    bootstrap_helper="$target_abs/scripts/lib/bootstrap-worktree-deps.mjs"
    if [ -f "$bootstrap_helper" ] && command -v node >/dev/null 2>&1; then
        step "Bootstrapping worktree dependencies (managed; DPF_WORKTREE_BOOTSTRAP=1)"
        if node "$bootstrap_helper" "$target_abs" >/dev/null 2>&1; then
            ok "Dependency bootstrap attempted (fail-safe; readiness recorded below)"
        else
            warn "Dependency bootstrap failed; worktree stays source-only."
        fi
    fi
fi

step "Classifying worktree verification readiness"
pnpm_on_path=false
corepack_on_path=false
node_modules_present=false
readiness_state="source-only"
readiness_reason="dependencies_missing"
probed_via_helper=false

if command -v pnpm >/dev/null 2>&1; then
    pnpm_on_path=true
fi
if command -v corepack >/dev/null 2>&1; then
    corepack_on_path=true
fi
if [ -d "$target_abs/node_modules" ]; then
    node_modules_present=true
fi

# BI-3047C122 (Wave 3): a cheap real probe (dependency resolution + @dpf/*
# workspace-link locality) beats structural node_modules presence — the latter
# marked a node_modules JUNCTIONED TO A STALE SIBLING WORKTREE "compile-ready"
# on 2026-07-24, silently typechecking against the wrong source. Runs
# unconditionally (no install; cheap) via --classify-only; falls back to the
# structural guess only when node or the helper is unavailable.
readiness_helper="$target_abs/scripts/lib/bootstrap-worktree-deps.mjs"
if [ -f "$readiness_helper" ] && command -v node >/dev/null 2>&1; then
    classify_json="$(node "$readiness_helper" "$target_abs" --classify-only 2>/dev/null || true)"
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

process_spine_version="unknown"
version_file="$target_abs/packages/dpf-skill-pack/process-spine-version.mjs"
if [ -f "$version_file" ]; then
  process_spine_version="$(sed -n 's/^export const PROCESS_SPINE_VERSION = "\(.*\)".*/\1/p' "$version_file" | head -n 1)"
  [ -z "$process_spine_version" ] && process_spine_version="unknown"
fi

cat > "$target_abs/.dpf-worktree-readiness.json" <<EOF
{
  "schemaVersion": 1,
  "state": "$readiness_state",
  "reason": "$readiness_reason",
  "processSpineVersion": "$process_spine_version",
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "checks": {
    "pnpmOnPath": $pnpm_on_path,
    "corepackOnPath": $corepack_on_path,
    "nodeModulesPresent": $node_modules_present,
    "probedViaBootstrapHelper": $probed_via_helper
  }
}
EOF
ok "Recorded $readiness_state readiness in $target_abs/.dpf-worktree-readiness.json ($readiness_reason)"

if [ "$core_only" -eq 1 ]; then
    skip "Core-only mode requested; skipping DPF skill pack bootstrap."
else
    step "Ensuring DPF skill pack"
    skill_pack_script="$target_abs/scripts/ensure-dpf-skill-pack.sh"
    if [ -f "$skill_pack_script" ]; then
        if ! bash "$skill_pack_script" "$target_abs"; then
            warn "DPF skill pack bootstrap failed; MCP config, Compose isolation, and readiness marker were still written."
        fi
    else
        skip "No DPF skill pack installer found at $skill_pack_script"
    fi
fi

printf '\nDone. Restart Claude Code, Codex, or VS Code in the worktree to pick up the dpf connector and skill pack.\n\n'
