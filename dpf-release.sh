#!/usr/bin/env bash
# Open Digital Product Factory — tag and push a production release.
#
# Bash port of dpf-release.ps1 (Windows GA). Pure git operations:
#
#   1. If on a non-main branch, stash + check out main.
#   2. Fast-forward pull origin/main (refuses if main has diverged).
#   3. Parse latest semver tag (vMAJOR.MINOR.PATCH); compute next per
#      --bump (major/minor/patch; default minor).
#   4. Confirm interactively (--yes skips, required under --headless).
#   5. Tag + push the tag only.
#   6. Return to the original branch and pop the stash.
#
# This script does NOT push commits to main. Releases are tag-only:
# the GHCR multi-arch image build + publish is triggered by the tag
# push, per .github/workflows/publish-image.yml.
#
# Bash 3.2 baseline.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
LIB_DIR="$REPO_ROOT/scripts/installer/lib"

# shellcheck source=scripts/installer/lib/logging.sh
. "$LIB_DIR/logging.sh"
# shellcheck source=scripts/installer/lib/prompts.sh
. "$LIB_DIR/prompts.sh"

usage() {
  cat <<EOF
Open Digital Product Factory — Release

Usage:
  bash dpf-release.sh [--bump major|minor|patch] [flags]

Flags:
  --bump LEVEL    Version bump level (default: minor).
                    major: v1.2.3 -> v2.0.0
                    minor: v1.2.3 -> v1.3.0
                    patch: v1.2.3 -> v1.2.4
  --yes           Skip the interactive confirmation prompt.
  --headless      Non-interactive (requires --yes).
  --dry-run       Print what would happen; don't tag or push.
  -h, --help      Show this help.

Tag-only release: pushes a vX.Y.Z tag to origin. The publish-image
workflow (Phase 1) builds and pushes multi-arch images on tag push.
EOF
}

DPF_BUMP="minor"
DPF_YES=0
DPF_DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --bump)
      shift
      [ $# -gt 0 ] || { echo "dpf-release.sh: --bump requires an argument" >&2; exit 64; }
      DPF_BUMP="$1"
      ;;
    --yes)        DPF_YES=1 ;;
    --headless)   DPF_HEADLESS=1; export DPF_HEADLESS ;;
    --dry-run)    DPF_DRY_RUN=1 ;;
    -h|--help)    usage; exit 0 ;;
    *)
      echo "dpf-release.sh: unknown argument: $1" >&2
      echo "Run 'bash dpf-release.sh --help' for usage." >&2
      exit 64
      ;;
  esac
  shift
done

case "$DPF_BUMP" in
  major|minor|patch) : ;;
  *) fail "--bump must be one of: major, minor, patch (got: $DPF_BUMP)" ;;
esac

cd "$REPO_ROOT"

if [ ! -d .git ]; then
  fail "dpf-release.sh must run inside a git working tree (no .git/ here)."
fi

# ── 1. Switch to main if needed (with stash for safety) ─────────────────
ORIG_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
STASHED=0

_restore() {
  # Idempotent restoration on success or interrupted exit. We never run
  # this until after we've left the git working tree in a known state.
  if [ "$ORIG_BRANCH" != "main" ]; then
    git checkout "$ORIG_BRANCH" -q 2>/dev/null || true
    if [ "$STASHED" = "1" ]; then
      git stash pop -q 2>/dev/null || warn "Could not pop stash; check 'git stash list'."
    fi
  fi
}

if [ "$ORIG_BRANCH" != "main" ]; then
  step "Switching from $ORIG_BRANCH to main"
  if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
    if git stash push --include-untracked -q -m "dpf-release auto-stash" 2>/dev/null; then
      STASHED=1
    fi
  fi
  if ! git checkout main -q; then
    _restore
    fail "Could not switch to main."
  fi
fi

# ── 2. Fast-forward pull ─────────────────────────────────────────────────
step "Pulling latest main from origin"
if ! git pull origin main --ff-only; then
  warn "Fast-forward pull failed. main may have local commits that diverge from origin."
  info "Inspect: git log origin/main..main"
  _restore
  exit 1
fi

# ── 3. Compute next version ──────────────────────────────────────────────
step "Computing next version"
LATEST_TAG="$(git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)"
if [ -z "$LATEST_TAG" ]; then
  warn "No semver tags found on this repo. Starting from v0.0.0."
  MAJOR=0; MINOR=0; PATCH=0
else
  # Strip the leading 'v' and split on '.' into three parts.
  TAG_NUM="${LATEST_TAG#v}"
  MAJOR="${TAG_NUM%%.*}"
  REST="${TAG_NUM#*.}"
  MINOR="${REST%%.*}"
  PATCH="${REST#*.}"
fi

case "$DPF_BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_TAG="v${MAJOR}.${MINOR}.${PATCH}"

echo ""
info "Current version: ${LATEST_TAG:-<none>}"
ok   "New version:     $NEW_TAG ($DPF_BUMP bump)"
echo ""

# ── 4. Confirm ──────────────────────────────────────────────────────────
if [ "$DPF_YES" != "1" ]; then
  if [ "${DPF_HEADLESS:-0}" = "1" ]; then
    _restore
    fail "--headless release requires --yes."
  fi
  dpf_yes_no "Tag and push ${NEW_TAG}?" "no"
  if [ "$DPF_REPLY" != "yes" ]; then
    info "Aborted by operator."
    _restore
    exit 0
  fi
fi

# ── 5. Tag + push ───────────────────────────────────────────────────────
if [ "$DPF_DRY_RUN" = "1" ]; then
  info "[dry-run] would run: git tag $NEW_TAG && git push origin $NEW_TAG"
  ok "Dry-run complete; no tag created."
  _restore
  exit 0
fi

step "Tagging $NEW_TAG"
if ! git tag "$NEW_TAG"; then
  _restore
  fail "Failed to create tag $NEW_TAG (already exists?)."
fi

step "Pushing $NEW_TAG to origin"
if ! git push origin "$NEW_TAG"; then
  warn "Push failed. The tag was created locally."
  warn "Remove with: git tag -d $NEW_TAG"
  _restore
  exit 1
fi

echo ""
ok "Released $NEW_TAG"
echo ""
info "GHCR images for $NEW_TAG will be built and pushed by the publish-image workflow."

# ── 6. Restore original branch ──────────────────────────────────────────
_restore
if [ "$ORIG_BRANCH" != "main" ]; then
  info "Returned to $ORIG_BRANCH"
fi
