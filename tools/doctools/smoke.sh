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
#      PDF and to text, and the text carries the fixture's sentinel; a generated
#      Visio (.vsdx) converts to flat ODG, SVG and .odg (BI-4C17BF51); a PDF
#      reads to text through pdftotext alone (BI-D1B40D43);
#   4. the auto-run macro fixture never executes: a permissive control proves the
#      fixture is live, then the hardened profile and dpf-convert must both leave
#      the marker file absent;
#   5. dpf-render (BI-3A0E5413) fills a deck, report, letter, sheet and drawing from
#      the render-*.json specs into every format with PNG previews, renders the deck
#      twice to the same text layer, fills a clean flat-ODF template, refuses a
#      template with scripts, and keeps its exit codes (2 bad request, 4 too large
#      or empty, 124 timeout);
#   6. the trusted document path (BI-BFF142A1): dpf-convert refuses a flat ODS that
#      embeds a chart (DisableActiveContent stays on), dpf-render's document mode
#      exports it with the chart to .xlsx and .ods, refuses any other embedded
#      object, external link or script, and the macro probe stays negative under
#      the render profile.
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

# 3a. PDF to text (BI-D1B40D43): pdftotext reads a PDF directly, under the same
#     containment, with one form feed per page; LibreOffice never opens it.
if [ -s "$WORK/out-doc.pdf" ] && convert txt pdf "$WORK/out-doc.pdf" "$WORK/pdf.txt" \
   && grep -q DPFSENTINELWRITER "$WORK/pdf.txt" && grep -q $'\f' "$WORK/pdf.txt" \
   && ! grep -q 'using filter' "$WORK/pdf.txt.err"; then
  pass ".pdf -> txt through pdftotext (sentinel and page break found, no LibreOffice)"
else
  fail ".pdf -> txt: $(tail -3 "$WORK/pdf.txt.err" 2>/dev/null)"
fi
printf 'not a pdf' > "$WORK/bogus.pdf"
convert txt pdf "$WORK/bogus.pdf" "$WORK/bogus.txt"; expect_exit "unreadable .pdf -> txt" 3 $?

# 3b. Drawings (BI-4C17BF51): a Visio fixture, generated by the image's own
#     python3 from fixtures/sample-vsdx.py, converts to flat ODG (the XML the portal
#     reads for shape and connector text), to SVG and to .odg, and that .odg
#     converts back to flat ODG with the same text.
"${RUN[@]}" --entrypoint python3 "$IMAGE" - < "$FIXTURES/sample-vsdx.py" > "$WORK/fixture.vsdx" 2>"$WORK/fixture.vsdx.err"
if [ -s "$WORK/fixture.vsdx" ] && head -c 2 "$WORK/fixture.vsdx" | grep -q PK; then
  pass "produce .vsdx fixture ($(wc -c < "$WORK/fixture.vsdx") bytes)"
  if convert fodg vsdx "$WORK/fixture.vsdx" "$WORK/vsdx.fodg" && grep -q DPFSENTINELDRAW "$WORK/vsdx.fodg" && grep -q '<draw:line' "$WORK/vsdx.fodg"; then
    pass ".vsdx -> fodg (sentinel and connectors present)"
  else
    fail ".vsdx -> fodg: $(tail -3 "$WORK/vsdx.fodg.err")"
  fi
  if convert svg vsdx "$WORK/fixture.vsdx" "$WORK/vsdx.svg" && grep -q '<svg' "$WORK/vsdx.svg" && grep -q 'Order Service' "$WORK/vsdx.svg"; then
    pass ".vsdx -> svg"
  else
    fail ".vsdx -> svg: $(tail -3 "$WORK/vsdx.svg.err")"
  fi
  if convert odg vsdx "$WORK/fixture.vsdx" "$WORK/vsdx.odg" && head -c 2 "$WORK/vsdx.odg" | grep -q PK      && convert fodg odg "$WORK/vsdx.odg" "$WORK/odg.fodg" && grep -q DPFSENTINELDRAW "$WORK/odg.fodg"; then
    pass ".vsdx -> odg -> fodg (sentinel kept)"
  else
    fail ".vsdx -> odg -> fodg: $(tail -3 "$WORK/vsdx.odg.err" "$WORK/odg.fodg.err" 2>/dev/null)"
  fi
else
  fail "produce .vsdx fixture: $(tail -3 "$WORK/fixture.vsdx.err")"
fi

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

# 5. dpf-render (BI-3A0E5413): the same containment, the other entry point.
render() {  # render <request-file> <output-tar> [docker env args...]
  local request="$1" output="$2"; shift 2
  "${RUN[@]}" "$@" --entrypoint /usr/local/bin/dpf-render "$IMAGE" < "$request" > "$output" 2>"$output.err"
}
with_template() {  # with_template <ext> <template-file> <request-file>: the request with a flat-ODF template spliced in
  printf '{"template":{"ext":"%s","data":"%s"},%s' "$1" "$(base64 -w0 < "$2")" "$(tail -c +2 "$3")"
}
declare -A RENDERED=([deck]="pptx pdf" [report]="docx odt pdf" [letter]="docx pdf" [sheet]="xlsx ods pdf" [drawing]="odg svg pdf")
declare -A RENDER_SENTINEL=([deck]=DPFRENDERDECK [report]=DPFRENDERREPORT [letter]=DPFRENDERLETTER [sheet]=DPFRENDERSHEET [drawing]=DPFRENDERDRAWING)
for family in deck report letter sheet drawing; do
  out="$WORK/render-$family"
  mkdir -p "$out"
  if ! render "$FIXTURES/render-$family.json" "$out.tar" || ! tar -xf "$out.tar" -C "$out"; then
    fail "render $family: $(tail -3 "$out.tar.err")"; continue
  fi
  missing=""
  for fmt in ${RENDERED[$family]}; do [ -s "$out/document.$fmt" ] || missing="$missing document.$fmt"; done
  [ -s "$out/preview-001.png" ] || missing="$missing preview-001.png"
  [ -s "$out/manifest.json" ] || missing="$missing manifest.json"
  if [ -n "$missing" ]; then fail "render $family: missing$missing"; continue; fi
  if ! head -c 4 "$out/document.pdf" | grep -q '%PDF'; then fail "render $family: document.pdf is not a PDF"; continue; fi
  if grep -q "${RENDER_SENTINEL[$family]}" "$out/text.txt"; then
    pass "render $family -> ${RENDERED[$family]} + $(ls "$out" | grep -c '^preview-') preview(s), sentinel in the text layer"
  else
    fail "render $family: sentinel ${RENDER_SENTINEL[$family]} missing from text.txt"
  fi
done
# The deck acceptance shape: a title slide, five content slides, one chart, one image.
if grep -q '"pageCount": 6' "$WORK/render-deck/manifest.json" 2>/dev/null; then
  pass "render deck: six slides"
else
  fail "render deck: expected 6 slides, manifest says $(cat "$WORK/render-deck/manifest.json" 2>/dev/null)"
fi
# Determinism: the same spec renders to the same text layer and page count.
mkdir -p "$WORK/render-deck-again"
if render "$FIXTURES/render-deck.json" "$WORK/render-deck-again.tar" && tar -xf "$WORK/render-deck-again.tar" -C "$WORK/render-deck-again" \
   && cmp -s "$WORK/render-deck/text.txt" "$WORK/render-deck-again/text.txt" \
   && cmp -s "$WORK/render-deck/manifest.json" "$WORK/render-deck-again/manifest.json"; then
  pass "render deck twice: identical text layer and manifest"
else
  fail "render deck twice: the outputs differ"
fi
# A clean flat-ODF template is filled; one that carries scripts or event bindings is refused.
with_template fodt "$FIXTURES/sample.fodt" "$FIXTURES/render-report.json" > "$WORK/templated.json"
mkdir -p "$WORK/render-templated"
if render "$WORK/templated.json" "$WORK/render-templated.tar" && tar -xf "$WORK/render-templated.tar" -C "$WORK/render-templated" \
   && grep -q DPFSENTINELWRITER "$WORK/render-templated/text.txt" && grep -q DPFRENDERREPORT "$WORK/render-templated/text.txt"; then
  pass "render with a flat-ODF template keeps the template and adds the content"
else
  fail "render with a template: $(tail -3 "$WORK/render-templated.tar.err")"
fi
with_template fodt "$FIXTURES/macro.fodt" "$FIXTURES/render-report.json" > "$WORK/macro-template.json"
render "$WORK/macro-template.json" "$WORK/macro-template.tar"; expect_exit "render refuses a template with scripts" 2 $?
with_template fodp "$FIXTURES/sample.fodp" "$FIXTURES/render-report.json" > "$WORK/wrong-template.json"
render "$WORK/wrong-template.json" "$WORK/wrong-template.tar"; expect_exit "render refuses a template of the wrong family" 2 $?
printf 'not json' > "$WORK/bad.json"
render "$WORK/bad.json" "$WORK/bad.tar"; expect_exit "render refuses a request that is not JSON" 2 $?
printf '{"content":{"family":"deck"},"formats":["xlsx"]}' > "$WORK/bad-format.json"
render "$WORK/bad-format.json" "$WORK/bad-format.tar"; expect_exit "render refuses a format the family cannot make" 2 $?
render /dev/null "$WORK/empty.tar"; expect_exit "render refuses an empty request" 4 $?
render "$FIXTURES/render-deck.json" "$WORK/big.tar" -e DPF_RENDER_MAX_BYTES=64; expect_exit "render input over DPF_RENDER_MAX_BYTES" 4 $?
render "$FIXTURES/render-deck.json" "$WORK/slow.tar" -e DPF_RENDER_TIMEOUT_SECONDS=1; expect_exit "render timeout" 124 $?

# 6. The trusted document path (BI-BFF142A1). A flat ODS that embeds a chart:
#    dpf-convert, the path for customer files, must refuse it (its profile keeps
#    DisableActiveContent on); dpf-render's document mode must export it with
#    the chart; the document screen must refuse anything else embedded, any
#    script and any external link; and macros must stay off under the render
#    profile too.
convert xlsx fods "$FIXTURES/chart.fods" "$WORK/chart-convert.xlsx"; expect_exit "dpf-convert refuses a flat ODS with an embedded chart (DisableActiveContent on)" 3 $?
with_document() {  # with_document <ext> <file> <formats-json>: a document-mode request
  printf '{"document":{"ext":"%s","data":"%s"},"formats":%s}' "$1" "$(base64 -w0 < "$2")" "$3"
}
with_document fods "$FIXTURES/chart.fods" '["xlsx","ods"]' > "$WORK/chart-document.json"
mkdir -p "$WORK/chart-document"
if render "$WORK/chart-document.json" "$WORK/chart-document.tar" && tar -xf "$WORK/chart-document.tar" -C "$WORK/chart-document" \
   && grep -qa 'xl/charts/chart1.xml' "$WORK/chart-document/document.xlsx" \
   && grep -qa 'Object 1/' "$WORK/chart-document/document.ods" \
   && grep -q '"charts": 1' "$WORK/chart-document/manifest.json"; then
  pass "dpf-render document mode exports the chart to .xlsx (xl/charts/chart1.xml) and .ods (Object 1/)"
else
  fail "dpf-render document mode: $(tail -3 "$WORK/chart-document.tar.err")"
fi
if convert txt xlsx "$WORK/chart-document/document.xlsx" "$WORK/chart-document.txt" && grep -q DPFSENTINELCHART "$WORK/chart-document.txt"; then
  pass "the exported .xlsx reads back through dpf-convert (sentinel found)"
else
  fail "the exported .xlsx does not read back: $(tail -3 "$WORK/chart-document.txt.err")"
fi
sed 's#application/vnd.oasis.opendocument.chart#application/vnd.oasis.opendocument.text#' "$FIXTURES/chart.fods" > "$WORK/not-a-chart.fods"
with_document fods "$WORK/not-a-chart.fods" '["xlsx"]' > "$WORK/not-a-chart.json"
render "$WORK/not-a-chart.json" "$WORK/not-a-chart.tar"; expect_exit "document mode refuses an embedded object that is not a chart" 2 $?
sed 's#<chart:title>#<chart:title xlink:href="https://example.invalid/x">#' "$FIXTURES/chart.fods" > "$WORK/linked-chart.fods"
with_document fods "$WORK/linked-chart.fods" '["xlsx"]' > "$WORK/linked-chart.json"
render "$WORK/linked-chart.json" "$WORK/linked-chart.tar"; expect_exit "document mode refuses a chart with an external link" 2 $?
with_document fodt "$FIXTURES/macro.fodt" '["pdf"]' > "$WORK/macro-document.json"
render "$WORK/macro-document.json" "$WORK/macro-document.tar"; expect_exit "document mode refuses a document with scripts" 2 $?
with_document fodp "$FIXTURES/sample.fodp" '["pdf"]' > "$WORK/fodp-document.json"
render "$WORK/fodp-document.json" "$WORK/fodp-document.tar"; expect_exit "document mode refuses a family it does not export" 2 $?
render_profile="$(probe render 4)"
if [ "$render_profile" = "MARKER=absent" ]; then
  pass "the render profile (DisableActiveContent lifted) still blocks the macro under ALWAYS_EXECUTE_NO_WARN"
else
  fail "render profile macro probe: $render_profile"
fi

echo
if [ "$FAILURES" -eq 0 ]; then echo "smoke: all checks passed for $IMAGE"; exit 0; fi
echo "smoke: $FAILURES check(s) failed for $IMAGE"
exit 1
