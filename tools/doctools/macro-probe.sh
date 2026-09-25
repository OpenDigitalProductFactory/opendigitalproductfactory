#!/usr/bin/env bash
# Macro-execution probe for the dpf-doctools smoke test (BI-15D69168).
#
# Runs INSIDE the image: smoke.sh passes this file as `bash -c` and the macro
# fixture on stdin, so no host path is mounted.
#
#   macro-probe.sh <profile: permissive|hardened|render> <MacroExecutionMode: 0-9>
#
# `render` is dpf-render's per-run profile: the hardened one with only
# DisableActiveContent lifted (dpf_render_uno.render_profile, BI-BFF142A1), so
# the probe proves macros stay off on the trusted rendering path as well.
#
# It loads the fixture through UNO as a VISIBLE document. That matters: headless
# `--convert-to` loads documents hidden and fires no document events at all,
# so a probe built on it would report "no macro ran" whatever the profile says.
# A visible load does fire them, which makes this a real control:
#   permissive profile + USE_CONFIG (3)          -> the marker MUST appear
#   hardened profile + ALWAYS_EXECUTE_NO_WARN (4) -> the marker must NOT appear
#   render profile + ALWAYS_EXECUTE_NO_WARN (4)   -> the marker must NOT appear
# Prints exactly one line: MARKER=present or MARKER=absent.
set -euo pipefail

PROFILE="${1:?profile: permissive|hardened|render}"
MODE="${2:?MacroExecutionMode}"
export HOME=/tmp/probe-home
mkdir -p "$HOME" /tmp/probe/profile/user /tmp/probe/out
cat > /tmp/probe/macro.fodt

case "$PROFILE" in
  hardened)
    cp /opt/dpf-doctools/profile/user/registrymodifications.xcu /tmp/probe/profile/user/ ;;
  render)
    sed 's#\(oor:name="DisableActiveContent" oor:op="fuse"><value>\)true#\1false#' \
      /opt/dpf-doctools/profile/user/registrymodifications.xcu > /tmp/probe/profile/user/registrymodifications.xcu
    grep -q 'oor:name="DisableActiveContent" oor:op="fuse"><value>false' /tmp/probe/profile/user/registrymodifications.xcu \
      || { echo "render profile: DisableActiveContent was not lifted" >&2; exit 2; } ;;
  permissive)
    cat > /tmp/probe/profile/user/registrymodifications.xcu <<'XCU'
<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
XCU
    ;;
  *) echo "unknown profile: $PROFILE" >&2; exit 2 ;;
esac

soffice --headless --invisible --norestore --nologo \
  "-env:UserInstallation=file:///tmp/probe/profile" \
  "--accept=pipe,name=dpfprobe;urp;" >/dev/null 2>&1 &
OFFICE_PID=$!
trap 'kill "$OFFICE_PID" 2>/dev/null || true' EXIT

cat > /tmp/probe/probe.py <<'PY'
import os, sys, time
import uno
from com.sun.star.beans import PropertyValue

def prop(name, value):
    p = PropertyValue()
    p.Name, p.Value = name, value
    return p

local = uno.getComponentContext()
resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
ctx = None
for _ in range(240):
    try:
        ctx = resolver.resolve("uno:pipe,name=dpfprobe;urp;StarOffice.ComponentContext")
        break
    except Exception:
        time.sleep(0.5)
if ctx is None:
    sys.exit("probe: LibreOffice did not start")
desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
doc = desktop.loadComponentFromURL(
    "file:///tmp/probe/macro.fodt", "_blank", 0,
    (prop("Hidden", False), prop("MacroExecutionMode", int(sys.argv[1]))))
if doc is None:
    sys.exit("probe: the fixture did not load")
doc.storeToURL("file:///tmp/probe/out/out.pdf", (prop("FilterName", "writer_pdf_Export"),))
doc.close(True)
time.sleep(1)
print("MARKER=present" if os.path.exists("/tmp/dpf-macro-marker") else "MARKER=absent")
PY
timeout 120 python3 /tmp/probe/probe.py "$MODE"
