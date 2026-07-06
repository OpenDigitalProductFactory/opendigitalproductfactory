#!/bin/sh
# local-ci-runner.sh — the checked-in default local-CI gate command
# (BI-157DC9B2). This is what scripts/gate-worktree.sh runs while holding the
# shared local-integration-ci lease when DPF_LOCAL_CI_COMMAND is not set, so
# agents no longer depend on an invisible environment variable.
#
# It is NON-MUTATING for the caller: the merged-code gate runs in a dedicated
# scratch worktree (default <root>-worktrees/.local-ci-runner, e.g.
# ~/dpf-worktrees/.local-ci-runner), never in the topic worktree and never in
# the root clone's working tree. Inside the scratch workspace it runs the
# canonical plan from scripts/lib/local-integration-ci.mjs:
#   fetch origin/main → checkout -B local-integration/<slug> → merge candidate
#   → sandbox-freshness converge (pnpm install if drifted) → vitest → typecheck
#   → production build.
#
# This is a merge workspace, not a second DPF runtime: no portal, no compose
# stack, no dev server (worktree-is-source-control-not-runtime). Runtime/UX
# verification stays on the canonical install or the leased :3010 sandbox.
#
# Usage:
#   scripts/local-ci-runner.sh [--candidate BRANCH] [--workspace PATH] [--dry-run]

set -eu

CANDIDATE=""
WORKSPACE="${DPF_LOCAL_CI_WORKSPACE:-}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: scripts/local-ci-runner.sh [options]

Options:
  --candidate BRANCH   Branch to gate (default: current branch)
  --workspace PATH     Scratch merge workspace (default: <root>-worktrees/.local-ci-runner)
  --dry-run            Print the resolved workspace + plan; run nothing
  --help               Show this help

Environment:
  DPF_LOCAL_CI_WORKSPACE   Overrides the scratch workspace location.
EOF
}

die() {
  printf '%s\n' "local-ci-runner: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --candidate) CANDIDATE="${2:-}"; shift 2 ;;
    --workspace) WORKSPACE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ -n "$CANDIDATE" ] || CANDIDATE="$(git rev-parse --abbrev-ref HEAD)"
[ "$CANDIDATE" != "HEAD" ] || die "cannot gate a detached HEAD — pass --candidate BRANCH"
[ "$CANDIDATE" != "main" ] || die "gate topic branches, not main"

# Resolve the TRUE root clone (first worktree entry is always the main
# worktree), regardless of whether we run from the root or a linked worktree.
repo_top="$(git rev-parse --show-toplevel)"
root="$(git -C "$repo_top" worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
[ -n "$root" ] || die "could not resolve the root clone"

if [ -z "$WORKSPACE" ]; then
  WORKSPACE="$(dirname "$root")/$(basename "$root")-worktrees/.local-ci-runner"
fi

if [ "$DRY_RUN" = "1" ]; then
  printf 'local-ci-runner dry-run\n'
  printf 'candidate=%s\nroot=%s\nworkspace=%s\n' "$CANDIDATE" "$root" "$WORKSPACE"
  printf 'plan=node scripts/local-integration-ci.mjs --candidate %s (in workspace)\n' "$CANDIDATE"
  exit 0
fi

# Ensure the scratch worktree exists. Linked worktrees share refs with the
# root clone, so the candidate branch and origin/main are visible without any
# cross-clone fetch plumbing.
if [ ! -e "$WORKSPACE/.git" ]; then
  mkdir -p "$(dirname "$WORKSPACE")"
  git -C "$root" worktree add --detach "$WORKSPACE" >/dev/null 2>&1 \
    || git -C "$root" worktree add --force --detach "$WORKSPACE" >/dev/null
fi

# Scratch hygiene: this workspace exists ONLY for merge gating — abandon any
# half-finished merge from a previous failed run. Never do this to a topic
# worktree; here the workspace is disposable by contract.
git -C "$WORKSPACE" merge --abort >/dev/null 2>&1 || true
git -C "$WORKSPACE" reset --hard --quiet
# Junction/symlink-safe clean: keep node_modules (the freshness preflight owns
# its convergence); drop everything else untracked.
git -C "$WORKSPACE" clean -fd --quiet -e node_modules -e .env || true

# CI parity: the Unit Tests job provisions Postgres and applies migrations
# before the suite (a handful of web tests exercise real Prisma reads).
# Resolution order: explicit env → dev data plane on :5433 → a self-provisioned
# sandbox container on :54329. No DB at all → run without the migrate step and
# say so; DB-touching tests will then fail loud rather than silently vanish.
resolve_database_url() {
  if [ -n "${DATABASE_URL:-}" ]; then printf '%s' "$DATABASE_URL"; return; fi
  if [ -n "${DPF_LOCAL_CI_TEST_DATABASE_URL:-}" ]; then printf '%s' "$DPF_LOCAL_CI_TEST_DATABASE_URL"; return; fi
  if nc -z 127.0.0.1 5433 >/dev/null 2>&1; then
    printf '%s' "postgresql://dpf:dpf_dev@127.0.0.1:5433/dpf"
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    if ! docker inspect dpf-local-ci-postgres >/dev/null 2>&1; then
      docker run -d --name dpf-local-ci-postgres -p 54329:5432 \
        -e POSTGRES_USER=dpf -e POSTGRES_PASSWORD=dpf_dev -e POSTGRES_DB=dpf \
        postgres:16-alpine >/dev/null 2>&1 || return 0
    else
      docker start dpf-local-ci-postgres >/dev/null 2>&1 || true
    fi
    tries=0
    while [ "$tries" -lt 30 ]; do
      if docker exec dpf-local-ci-postgres pg_isready -U dpf >/dev/null 2>&1; then
        printf '%s' "postgresql://dpf:dpf_dev@127.0.0.1:54329/dpf"
        return
      fi
      tries=$((tries + 1))
      sleep 1
    done
  fi
}

TEST_DATABASE_URL="$(resolve_database_url || true)"
MIGRATE_FLAG=""
if [ -n "$TEST_DATABASE_URL" ]; then
  MIGRATE_FLAG="--migrate-deploy"
  export DATABASE_URL="$TEST_DATABASE_URL"
  printf 'local-ci-runner: test database %s\n' "$(printf '%s' "$TEST_DATABASE_URL" | sed 's#//.*@#//***@#')"
else
  printf 'local-ci-runner: WARNING no test database resolved — running without migrate deploy; Prisma-touching tests will fail loud\n' >&2
fi

# Run the CALLER's copy of the plan entrypoint (the version under review) with
# the scratch workspace as cwd — a stale scratch checkout must never supply the
# plan itself. The plan's own first steps fetch origin/main and re-checkout the
# integration branch, so every command after that runs against merged bytes.
cd "$WORKSPACE"
# shellcheck disable=SC2086 — MIGRATE_FLAG is a single optional token
exec node "$repo_top/scripts/local-integration-ci.mjs" --candidate "$CANDIDATE" $MIGRATE_FLAG
