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

set -euo pipefail

target=""
force=0
for arg in "$@"; do
    case "$arg" in
        --force) force=1 ;;
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

printf '\nDone. Restart Claude Code (or VS Code) in the worktree to pick up the dpf connector.\n\n'
