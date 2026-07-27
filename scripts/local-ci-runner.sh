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
#   resolve the locally available accepted-base ref → checkout -B
#   local-integration/<slug> → merge candidate → sandbox-freshness converge
#   (pnpm install if drifted) → vitest → typecheck → production build.
#
# This is a merge workspace, not a second DPF runtime: no portal, no compose
# stack, no dev server (worktree-is-source-control-not-runtime). Runtime/UX
# verification stays on the canonical install or the leased :3010 sandbox.
#
# Usage:
#   scripts/local-ci-runner.sh [--candidate BRANCH] [--base-ref REF] [--fetch-base] [--workspace PATH] [--dry-run]

set -eu

CANDIDATE=""
BASE_REF="${DPF_LOCAL_CI_BASE_REF:-origin/main}"
FETCH_BASE="${DPF_LOCAL_CI_FETCH_BASE:-0}"
WORKSPACE="${DPF_LOCAL_CI_WORKSPACE:-}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: scripts/local-ci-runner.sh [options]

Options:
  --candidate BRANCH   Branch to gate (default: current branch)
  --base-ref REF       Locally available accepted-base ref (default: origin/main)
  --fetch-base         Fetch origin/main before checkout (explicit network mode)
  --workspace PATH     Scratch merge workspace (default: <root>-worktrees/.local-ci-runner)
  --dry-run            Print the resolved workspace + plan; run nothing
  --help               Show this help

Environment:
  DPF_LOCAL_CI_BASE_REF    Overrides the accepted-base ref (default: origin/main).
  DPF_LOCAL_CI_FETCH_BASE  Set to 1 to fetch origin/main before integration.
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
    --base-ref) BASE_REF="${2:-}"; shift 2 ;;
    --fetch-base) FETCH_BASE=1; shift ;;
    --workspace) WORKSPACE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ -n "$CANDIDATE" ] || CANDIDATE="$(git rev-parse --abbrev-ref HEAD)"
[ "$CANDIDATE" != "HEAD" ] || die "cannot gate a detached HEAD — pass --candidate BRANCH"
[ "$CANDIDATE" != "main" ] || die "gate topic branches, not main"
[ -n "$BASE_REF" ] || die "--base-ref cannot be empty"

# Resolve the TRUE root clone (first worktree entry is always the main
# worktree), regardless of whether we run from the root or a linked worktree.
repo_top="$(git rev-parse --show-toplevel)"
root="$(git -C "$repo_top" worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
[ -n "$root" ] || die "could not resolve the root clone"

if [ -z "$WORKSPACE" ]; then
  WORKSPACE="$(dirname "$root")/$(basename "$root")-worktrees/.local-ci-runner"
fi

# Shared-object-store self-repair (BI-AA2201B0): the scratch workspace below
# is a linked worktree of $root, so it shares $root's .git/shallow. If that
# shallow boundary is a disjoint graft for the candidate branch or base ref
# (e.g. a prior per-ref depth-limited fetch), the merge step a few lines down
# fails hard with "fatal: refusing to merge unrelated histories" even though
# the branches share real ancestry on the remote — the local object store
# just can't see it (verified mechanism, BI-AA2201B0). Deepen $root once
# up front so the merge can find the true common ancestor; a no-op on every
# call after the first, since the check gates on still-being-shallow.
if [ "$DRY_RUN" != "1" ] && [ "$(git -C "$root" rev-parse --is-shallow-repository 2>/dev/null || printf 'false')" = "true" ]; then
  printf 'local-ci-runner: root clone is shallow — fetching full history so the scratch merge has a common ancestor (BI-AA2201B0)\n'
  git -C "$root" fetch --unshallow origin || die "failed to unshallow root clone at $root"
fi

candidate_sha="$(git -C "$repo_top" rev-parse --verify "$CANDIDATE" 2>/dev/null || true)"
base_sha="$(git -C "$repo_top" rev-parse --verify "$BASE_REF" 2>/dev/null || true)"
base_commit_date=""
[ -n "$base_sha" ] && base_commit_date="$(git -C "$repo_top" show -s --format=%cI "$base_sha" 2>/dev/null || true)"
metadata_file="${DPF_LOCAL_CI_METADATA_FILE:-$(git -C "$repo_top" rev-parse --git-path dpf-local-ci-metadata.json)}"

if [ "$DRY_RUN" = "1" ]; then
  printf 'local-ci-runner dry-run\n'
  printf 'candidate=%s\ncandidateSha=%s\nbaseRef=%s\nbaseSha=%s\nbaseCommitDate=%s\nfetchBase=%s\nroot=%s\nworkspace=%s\nmetadataFile=%s\n' "$CANDIDATE" "${candidate_sha:-unresolved}" "$BASE_REF" "${base_sha:-unresolved}" "$base_commit_date" "$FETCH_BASE" "$root" "$WORKSPACE" "$metadata_file"
  printf 'plan=node scripts/local-integration-ci.mjs --candidate %s --base-ref %s --candidate-sha %s --base-sha %s --metadata-out %s%s (in workspace)\n' "$CANDIDATE" "$BASE_REF" "$candidate_sha" "$base_sha" "$metadata_file" "$([ "$FETCH_BASE" = "1" ] && printf ' --fetch-base' || true)"
  exit 0
fi

[ -n "$candidate_sha" ] || die "candidate ref not found locally: $CANDIDATE"
[ -n "$base_sha" ] || die "accepted base ref not found locally: $BASE_REF (fetch or set DPF_LOCAL_CI_BASE_REF to a local ref)"

printf 'local-ci-runner: candidate %s @ %s\n' "$CANDIDATE" "$candidate_sha"
printf 'local-ci-runner: accepted base %s @ %s' "$BASE_REF" "$base_sha"
if [ -n "$base_commit_date" ]; then
  printf ' (commit date %s)' "$base_commit_date"
fi
printf '\n'
if [ "$FETCH_BASE" != "1" ]; then
  printf 'local-ci-runner: using locally available base ref without fetch (BI-76551B2D)\n'
fi

# Ensure the scratch worktree exists. Linked worktrees share refs with the
# root clone, so the candidate branch and accepted-base ref are visible without
# any cross-clone fetch plumbing.
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
    # BET-5 (BI-032B49EB): the provisioned Postgres MUST ship pgvector — migrations run
    # `CREATE EXTENSION vector`, which plain postgres:16-alpine lacks (every branch pregate
    # then fails at that migration). A pre-BET-5 sandbox container is on the alpine image, so
    # recreate it onto pgvector. Image-based check (no readiness race); the sandbox DB is
    # ephemeral (no volume) so recreating loses nothing — migrations re-run each pregate.
    if docker inspect dpf-local-ci-postgres >/dev/null 2>&1; then
      case "$(docker inspect dpf-local-ci-postgres --format '{{.Config.Image}}' 2>/dev/null || true)" in
        *pgvector*) : ;;
        *) docker rm -f dpf-local-ci-postgres >/dev/null 2>&1 || true ;;
      esac
    fi
    if ! docker inspect dpf-local-ci-postgres >/dev/null 2>&1; then
      docker run -d --name dpf-local-ci-postgres -p 54329:5432 \
        -e POSTGRES_USER=dpf -e POSTGRES_PASSWORD=dpf_dev -e POSTGRES_DB=dpf \
        pgvector/pgvector:pg16 >/dev/null 2>&1 || return 0
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
# plan itself. The plan's own first steps checkout the accepted local base and
# merge the candidate branch, so every command after that runs against merged
# bytes.
cd "$WORKSPACE"
# shellcheck disable=SC2086 — MIGRATE_FLAG is a single optional token
FETCH_FLAG=""
[ "$FETCH_BASE" = "1" ] && FETCH_FLAG="--fetch-base"
# shellcheck disable=SC2086 — MIGRATE_FLAG and FETCH_FLAG are single optional tokens
set +e
node "$repo_top/scripts/local-integration-ci.mjs" --candidate "$CANDIDATE" --base-ref "$BASE_REF" --candidate-sha "$candidate_sha" --base-sha "$base_sha" --metadata-out "$metadata_file" $FETCH_FLAG $MIGRATE_FLAG
status=$?
set -e

# The freshness preflight runs inside the scratch integration worktree, while
# gate-worktree.sh reads git-private evidence from the caller worktree. Copy the
# scratch report back even when the expensive command fails so classification
# uses the report that applied to this run rather than stale caller state.
scratch_freshness_file="$(git -C "$WORKSPACE" rev-parse --git-path dpf-sandbox-freshness.json 2>/dev/null || true)"
caller_freshness_file="$(dirname "$metadata_file")/dpf-sandbox-freshness.json"
if [ -n "$scratch_freshness_file" ] && [ -f "$scratch_freshness_file" ]; then
  mkdir -p "$(dirname "$caller_freshness_file")"
  cp "$scratch_freshness_file" "$caller_freshness_file"
fi

exit "$status"
