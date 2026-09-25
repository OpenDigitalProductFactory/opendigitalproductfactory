#!/usr/bin/env bash
# Smoke test for the dpf-doctools image (BI-15D69168, AC-ODC-002).
#
#   tools/doctools/smoke.sh <image-ref>
#
# Every container runs the way the portal will run it (S2): no network, a
# read-only root, a /tmp tmpfs, all capabilities dropped, no-new-privileges,
# memory and pid limits, stdin in and stdout out, no host mounts.
#
# It checks, against the built image:
#   1. the runtime user is non-root;
#   2. dpf-convert's fixed exit codes (2 bad args or empty, 3 failed, 4 too large, 124 timeout);
#   3. .doc/.xls/.ppt/.rtf/.odt/.pptx (plus .docx/.xlsx/.ods/.odp) each convert to
#      PDF and to text, and the text carries the fixture's sentinel;
#   4. the auto-run macro fixture never executes: a permissive control proves the
#      fixture is live, then the hardened profile and dpf-convert must both leave
#      the marker file absent.
# The binary fixtures are produced from the committed flat-ODF sources by the
# image itself, so the repository carries no opaque office binaries.
#
# Exit 0 only when every check passed. Needs docker; a caller without docker
# must report this test as skipped, never as passed.
set -uo pipefail
export MSYS_NO_PATHCONV=1

IMAGE="${1:?usage: smoke.sh <image-ref>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES="$HERE/fixtures"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

RUN=(docker run --rm -i --network none --read-only --tmpfs /tmp:rw,size=512m
     --cap-drop ALL --security-opt no-new-privileges --memory 1g --pids-limit 256)

FAILURES=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILURES=$((FAILURES + 1)); }

# convert <to> <from> <input-file> <output-file> [docker env args...]
convert() {
  local to="$1" from="$2" input="$3" output="$4"; shift 4
  "${RUN[@]}" "$@" "$IMAGE" --to "$to" --from "$from" < "$input" > "$output" 2>"$output.err"
}

expect_exit() {  # expect_exit <name> <expected> <actual>
  if [ "$3" -eq "$2" ]; then pass "$1 (exit $3)"; else fail "$1: expected exit $2, got $3"; fi
}

docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "FAIL  image not found: $IMAGE"; exit 1; }

# 1. Non-root.
uid="$("${RUN[@]}" --entrypoint id "$IMAGE" -u 2>/dev/null || echo unknown)"
if [ "$uid" != "0" ] && [ "$uid" != "unknown" ]; then pass "runs as non-root uid $uid"; else fail "runtime uid is '$uid'"; fi

# 2. Exit-code contract.
convert pdf fodt "$FIXTURES/sample.fodt" "$WORK/sample.pdf"; rc=$?
if [ "$rc" -eq 0 ] && head -c 4 "$WORK/sample.pdf" | grep -q '%PDF'; then pass "fodt -> pdf"; else fail "fodt -> pdf (exit $rc): $(tail -3 "$WORK/sample.pdf.err")"; fi

"${RUN[@]}" "$IMAGE" --to bogus < "$FIXTURES/sample.fodt" >/dev/null 2>&1; expect_exit "unknown --to" 2 $?
"${RUN[@]}" "$IMAGE" < "$FIXTURES/sample.fodt" >/dev/null 2>&1; expect_exit "missing --to" 2 $?
"${RUN[@]}" "$IMAGE" --to pdf --from exe < "$FIXTURES/sample.fodt" >/dev/null 2>&1; expect_exit "unknown --from" 2 $?
"${RUN[@]}" -e DPF_CONVERT_MAX_BYTES=64 "$IMAGE" --to pdf --from fodt < "$FIXTURES/sample.fodt" >/dev/null 2>&1; expect_exit "input over DPF_CONVERT_MAX_BYTES" 4 $?
"${RUN[@]}" "$IMAGE" --to pdf --from odt < /dev/null >/dev/null 2>&1; expect_exit "empty input" 2 $?
convert xlsx pdf "$WORK/sample.pdf" "$WORK/impossible.xlsx"; expect_exit "no export path (pdf -> xlsx)" 3 $?
# A document long enough that laying it out takes well over one second.
{ sed -n "1,/<office:text>/p" "$FIXTURES/sample.fodt"
  for i in $(seq 1 20000); do printf '   <text:p>Paragraph %s of a long document used to exercise the timeout.</text:p>\n' "$i"; done
  sed -n '\#</office:text>#,$p' "$FIXTURES/sample.fodt"; } > "$WORK/long.fodt"
convert pdf fodt "$WORK/long.fodt" "$WORK/long.pdf" -e DPF_CONVERT_TIMEOUT_SECONDS=1; expect_exit "timeout" 124 $?

# 3. Produce the legacy and OOXML fixtures from the flat-ODF sources, then
#    convert each one to PDF and to text.
declare -A SOURCE=([doc]=fodt [rtf]=fodt [odt]=fodt [docx]=fodt
                   [xls]=fods [xlsx]=fods [ods]=fods
                   [ppt]=fodp [pptx]=fodp [odp]=fodp)
declare -A SENTINEL=([fodt]=DPFSENTINELWRITER [fods]=DPFSENTINELCALC [fodp]=DPFSENTINELIMPRESS)

for ext in doc xls ppt rtf odt pptx docx xlsx ods odp; do
  src="${SOURCE[$ext]}"
  fixture="$WORK/fixture.$ext"
  if ! convert "$ext" "$src" "$FIXTURES/sample.$src" "$fixture" || [ ! -s "$fixture" ]; then
    fail "produce .$ext fixture: $(tail -3 "$fixture.err")"; continue
  fi
  if convert pdf "$ext" "$fixture" "$WORK/out-$ext.pdf" && head -c 4 "$WORK/out-$ext.pdf" | grep -q '%PDF'; then
    pass ".$ext -> pdf ($(wc -c < "$WORK/out-$ext.pdf") bytes)"
  else
    fail ".$ext -> pdf: $(tail -3 "$WORK/out-$ext.pdf.err")"
  fi
  if convert txt "$ext" "$fixture" "$WORK/out-$ext.txt" && grep -q "${SENTINEL[$src]}" "$WORK/out-$ext.txt"; then
    pass ".$ext -> txt (sentinel found)"
  else
    fail ".$ext -> txt: sentinel ${SENTINEL[$src]} missing; $(tail -3 "$WORK/out-$ext.txt.err")"
  fi
done

# 4. Macro containment.
probe() {  # probe <profile> <mode>
  "${RUN[@]}" --entrypoint bash "$IMAGE" -c "$(cat "$HERE/macro-probe.sh")" macro-probe "$1" "$2" \
    < "$FIXTURES/macro.fodt" 2>/dev/null | tail -1
}
control="$(probe permissive 3)"
if [ "$control" = "MARKER=present" ]; then
  pass "control: the macro fixture runs under a permissive profile"
else
  fail "control: the macro fixture did not run under a permissive profile ($control); the absence checks below would prove nothing"
fi
hardened="$(probe hardened 4)"
if [ "$hardened" = "MARKER=absent" ]; then
  pass "hardened profile blocks the macro even when the caller asks ALWAYS_EXECUTE_NO_WARN"
else
  fail "hardened profile: $hardened"
fi
via_convert="$("${RUN[@]}" --entrypoint bash "$IMAGE" -c \
  '/usr/local/bin/dpf-convert --to pdf --from fodt > /tmp/macro.pdf 2>/dev/null || { echo "CONVERT_FAILED"; exit 0; }
   if [ -e /tmp/dpf-macro-marker ]; then echo MARKER=present; else echo MARKER=absent; fi' \
  < "$FIXTURES/macro.fodt" 2>/dev/null | tail -1)"
if [ "$via_convert" = "MARKER=absent" ]; then
  pass "dpf-convert converts the macro fixture and the marker file is absent"
else
  fail "dpf-convert on the macro fixture: $via_convert"
fi

echo
if [ "$FAILURES" -eq 0 ]; then echo "smoke: all checks passed for $IMAGE"; exit 0; fi
echo "smoke: $FAILURES check(s) failed for $IMAGE"
exit 1
