#!/usr/bin/env bash
# Size budget for the dpf-doctools image (BI-15D69168, OBJ-ODC-FOOTPRINT).
#
#   tools/doctools/size-budget.sh <image-ref> [budget-MiB]
#
# Measures the compressed size (docker save | gzip -1), which approximates what
# an install pulls, and fails when it exceeds the budget. The BI's ceiling is
# 700 MB compressed; the budget sits well below it so growth is noticed early.
# Measured 2026-09-24 on linux/amd64 (LibreOffice 25.2.3, trixie-slim):
# 217,598,894 bytes compressed (~208 MiB), 807,708,304 bytes unpacked.
# Raise the budget only deliberately, with the new measurement in the PR.
set -euo pipefail

IMAGE="${1:?usage: size-budget.sh <image-ref> [budget-MiB]}"
BUDGET_MIB="${2:-${DPF_DOCTOOLS_SIZE_BUDGET_MIB:-300}}"

compressed="$(docker save "$IMAGE" | gzip -1 | wc -c | tr -d ' ')"
unpacked="$(docker image inspect "$IMAGE" --format '{{.Size}}')"
budget=$((BUDGET_MIB * 1024 * 1024))

printf 'dpf-doctools size: compressed=%s bytes (%s MiB), unpacked=%s bytes, budget=%s MiB\n' \
  "$compressed" "$((compressed / 1024 / 1024))" "$unpacked" "$BUDGET_MIB"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '| dpf-doctools | %s MiB compressed | %s MiB unpacked | budget %s MiB |\n' \
    "$((compressed / 1024 / 1024))" "$((unpacked / 1024 / 1024))" "$BUDGET_MIB" >> "$GITHUB_STEP_SUMMARY"
fi
if [ "$compressed" -gt "$budget" ]; then
  echo "size-budget: FAIL, over budget by $(((compressed - budget) / 1024 / 1024)) MiB" >&2
  exit 1
fi
echo "size-budget: PASS"
