#!/bin/sh
# scripts/safety/dpf-shell-guard.test.sh
#
# Integration test for the POSIX shell guard. Stubs the gate via DPF_GATE_CMD
# (no live HTTP server in CI) + stubs the real-binary via the cached env file
# (no real docker invocation). Exercises each verdict path.

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

if ! command -v jq >/dev/null 2>&1; then
  echo "SKIP: jq not installed (guard requires it; CI hosts must install)" >&2
  exit 0
fi

# Set up a fake safety-bin: symlink the guard as `docker`, point DPF_REAL_DOCKER
# at /bin/echo so we can observe what `allow` execs without spinning up Docker.
mkdir -p "$TMPDIR/safety-bin"
ln -s "$HERE/dpf-shell-guard.sh" "$TMPDIR/safety-bin/docker"
ln -s "$HERE/dpf-shell-guard.sh" "$TMPDIR/safety-bin/git"
cp "$HERE/dpf-shell-guard-fallback-patterns.json" "$TMPDIR/safety-bin/"
printf 'DPF_REAL_DOCKER=/bin/echo\nDPF_REAL_GIT=/bin/echo\n' > "$TMPDIR/safety-bin/real-binaries.env"

run_case() {
  CASE_NAME="$1"
  EXPECTED_EXIT="$2"
  RESPONSE_JSON="$3"
  shift 3
  RESP_FILE="$TMPDIR/resp.json"
  printf '%s' "$RESPONSE_JSON" > "$RESP_FILE"
  set +e
  ACTUAL_OUT="$(env DPF_GATE_CMD="cat $RESP_FILE" "$@" 2>&1)"
  ACTUAL_EXIT=$?
  set -e
  if [ "$ACTUAL_EXIT" = "$EXPECTED_EXIT" ]; then
    echo "PASS: $CASE_NAME"
  else
    echo "FAIL: $CASE_NAME — expected exit=$EXPECTED_EXIT got exit=$ACTUAL_EXIT"
    echo "  Output: $ACTUAL_OUT"
    exit 1
  fi
}

# Case 1: allow → exec real binary (which we stubbed as /bin/echo)
run_case "allow → exec real" 0 '{"verdict":"allow"}' "$TMPDIR/safety-bin/docker" ps

# Case 2: refuse → exit 1
run_case "refuse → exit 1" 1 \
  '{"verdict":"refuse","principleSlug":"never-wipe-db-for-code-fixes","rationale":"wipes operator state"}' \
  "$TMPDIR/safety-bin/docker" volume rm dpf_pgdata

# Case 3: _unreachable + command matches static fallback → exit 1
run_case "_unreachable + fallback match → exit 1" 1 \
  '{"verdict":"_unreachable"}' \
  "$TMPDIR/safety-bin/docker" volume rm dpf_pgdata

# Case 4: _unreachable + benign command → fall through to exec
run_case "_unreachable + benign → exec" 0 \
  '{"verdict":"_unreachable"}' \
  "$TMPDIR/safety-bin/docker" ps

# Case 5: unknown verdict → refuse
run_case "unknown verdict → exit 1" 1 \
  '{"verdict":"bogus"}' \
  "$TMPDIR/safety-bin/docker" ps

# Case 6: malformed JSON response → _unreachable path; benign command exec'd
run_case "malformed JSON → fall through" 0 \
  'not even json' \
  "$TMPDIR/safety-bin/docker" ps

echo "all shell-guard tests passed"
