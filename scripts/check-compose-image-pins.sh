#!/usr/bin/env bash
#
# check-compose-image-pins.sh — fail CI if a third-party container image in
# docker-compose.yml floats on a mutable tag (`:latest` or no tag).
#
# Why: `:latest` is both unpinned (no reproducibility / no review gate) AND
# invisible to Dependabot (no version anchor to bump from), so it silently
# drifts. BI-C8164664: `inngest/inngest:latest` drifted onto a broken 1.26.0
# release and rotted 9 days behind upstream, pinning the scheduler at ~55% CPU.
# Pinning every third-party image to an explicit version lets the existing
# Dependabot `docker` ecosystem propose reviewed, CI-gated bumps instead.
#
# First-party images are exempt: they use `${DPF_IMAGE_TAG:-latest}` (release
# pipeline controls the tag) and are matched by the `${` parameter syntax.
#
# ALLOWLIST holds images not yet pinned, tracked for burn-down in BI-C8164664.
# Add to it only with a tracking reference; the goal is an empty allowlist.

set -euo pipefail

COMPOSE_FILE="${1:-docker-compose.yml}"

# Images permitted to remain on :latest for now (burn-down tracked in BI-C8164664).
# Each entry is the image repository (no tag).
ALLOWLIST=(
  "grafana/loki"                  # observability profile — not exercised in CI; pin when validated
  "grafana/alloy"                 # observability profile — not exercised in CI; pin when validated
  "gcr.io/cadvisor/cadvisor"      # observability profile — not exercised in CI; pin when validated
  "prom/node-exporter"            # observability profile — not exercised in CI; pin when validated
  "inngest/inngest"               # pinned (v1.36.0 as of BI-915C40C6); never :latest (BI-C8164664)
)

is_allowlisted() {
  local repo="$1"
  local entry
  for entry in "${ALLOWLIST[@]}"; do
    [ "$repo" = "$entry" ] && return 0
  done
  return 1
}

violations=0
while IFS= read -r line; do
  # Extract the image reference from `    image: <ref>` lines.
  ref="$(printf '%s\n' "$line" | sed -E 's/^[[:space:]]*image:[[:space:]]*//')"

  # Skip first-party / parameterized images (release pipeline controls the tag).
  case "$ref" in
    *'${'*) continue ;;
  esac

  # Pinned by digest (name@sha256:...) is always acceptable.
  case "$ref" in
    *@sha256:*) continue ;;
  esac

  repo="${ref%%:*}"
  tag="${ref#*:}"
  [ "$repo" = "$ref" ] && tag="<none>"   # bare image, no tag

  if [ "$tag" = "latest" ] || [ "$tag" = "<none>" ]; then
    if is_allowlisted "$repo"; then
      printf 'ALLOWLISTED (tracked, BI-C8164664): %s\n' "$ref" >&2
    else
      printf '::error::Unpinned third-party image (use an explicit version, not :latest): %s\n' "$ref" >&2
      violations=$((violations + 1))
    fi
  fi
done < <(grep -E '^[[:space:]]*image:[[:space:]]' "$COMPOSE_FILE")

if [ "$violations" -gt 0 ]; then
  printf '\n%d unpinned third-party image(s) found in %s.\n' "$violations" "$COMPOSE_FILE" >&2
  printf 'Pin to an explicit version (e.g. prom/prometheus:v3.12.0) so Dependabot can track it.\n' >&2
  exit 1
fi

echo "All third-party images in $COMPOSE_FILE are pinned (or allowlisted)."
