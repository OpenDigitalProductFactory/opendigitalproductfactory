"""Smoke-only proof of the installed renderer's deadline and child cleanup.

The real main() validates a request and owns SIGALRM, ENGINES and cleanup.
Only its render callback is replaced, inside this isolated test process, so
the timeout does not depend on how fast LibreOffice renders a document.
"""

import io
import os
import runpy
import signal
import subprocess
import sys


def verify_timeout(renderer="/usr/local/bin/dpf-render"):
    os.environ["DPF_RENDER_TIMEOUT_SECONDS"] = "1"
    main = runpy.run_path(renderer, run_name="doctools_timeout_probe")["main"]
    runtime = main.__globals__
    children = []
    workspaces = []

    def controlled_render(request, work):
        workspaces.append(work)
        child = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            stdin=subprocess.DEVNULL,
        )
        children.append(child)
        runtime["ENGINES"].append(child)
        # If the real alarm is absent or swallowed, fail after three seconds.
        child.wait(timeout=3)

    runtime["render"] = controlled_render
    sys.stdin = io.TextIOWrapper(io.BytesIO(
        b'{"content":{"family":"deck"},"formats":["pdf"]}'
    ))
    code = None
    try:
        try:
            main()
        except SystemExit as error:
            code = error.code
        if code != 124 or len(children) != 1:
            raise AssertionError("real renderer did not time out with an active child")
        child = children[0]
        if child.wait(timeout=2) != -signal.SIGKILL:
            raise AssertionError("renderer did not kill its registered child")
        if any(os.path.exists(work) for work in workspaces):
            raise AssertionError("renderer left its temporary workspace behind")
        sys.stderr.write("timeout-probe: real deadline, child kill and workspace cleanup verified\n")
        return 124
    finally:
        signal.alarm(0)
        # Test cleanup never substitutes for the assertions above.
        for child in children:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=2)


if __name__ == "__main__":
    sys.exit(verify_timeout())
