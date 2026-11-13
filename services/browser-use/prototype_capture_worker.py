"""Private unprivileged worker. No general browsing or model inference."""
import asyncio
import base64
import datetime
import ctypes
import errno
import json
import os
import resource
import platform
import socket
import stat
import sys

from prototype_capture import MAX_HTML_BYTES, MAX_PNG_BYTES, validate_capture_request

PROTOTYPE_CSP = (
    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; "
    "style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; "
    "media-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; "
    "form-action 'none'; object-src 'none'; frame-ancestors 'none'"
)


def reject_inherited_sockets():
    """Only pipes and files may cross the parent's close_fds boundary."""
    for name in os.listdir("/proc/self/fd"):
        try:
            mode = os.fstat(int(name)).st_mode
        except OSError as error:
            if error.errno == errno.EBADF:  # the closed directory iterator fd
                continue
            raise
        if stat.S_ISSOCK(mode):
            raise ValueError("prototype_capture_inherited_socket")


def install_transport_guard():
    """Kernel denial inherited by Node/Chromium, not just HTTP interception.

    Only private connected Unix stream/seqpacket socketpairs remain available
    for child IPC. Neither IP sockets nor connections to Unix brokers/proxies
    can be created. Missing filter support fails closed before browser loading.
    libseccomp API: https://github.com/seccomp/libseccomp/blob/main/include/seccomp.h.in
    """
    if sys.platform != "linux" or platform.machine() not in ("x86_64", "aarch64"):
        raise ValueError("prototype_capture_transport_guard_unavailable")
    reject_inherited_sockets()

    class Comparison(ctypes.Structure):
        _fields_ = [("arg", ctypes.c_uint), ("op", ctypes.c_int),
                    ("datum_a", ctypes.c_uint64), ("datum_b", ctypes.c_uint64)]

    lib = ctypes.CDLL("libseccomp.so.2", use_errno=True)
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    lib.seccomp_release.restype = None
    lib.seccomp_attr_set.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_uint32]
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_rule_add_array.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int,
                                          ctypes.c_uint, ctypes.POINTER(Comparison)]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    context = lib.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW
    if not context:
        raise ValueError("prototype_capture_transport_guard_unavailable")
    def checked(result):
        if result != 0:
            raise ValueError("prototype_capture_transport_guard_unavailable")
    def deny(name, comparison=None):
        number = lib.seccomp_syscall_resolve_name(name.encode("ascii"))
        if number < 0:
            raise ValueError("prototype_capture_transport_guard_unavailable")
        checked(lib.seccomp_rule_add_array(context, 0x00050000 | errno.EPERM,
            number, 0 if comparison is None else 1,
            None if comparison is None else ctypes.byref(comparison)))
    try:
        checked(lib.seccomp_attr_set(context, 3, 1))  # CTL_NNP: no setuid privilege gains
        for name in ("socket", "connect", "bind", "listen", "accept", "accept4",
                     "io_uring_setup", "pidfd_getfd", "ptrace", "process_vm_readv",
                     "process_vm_writev"):
            deny(name)
        deny("socketpair", Comparison(0, 1, socket.AF_UNIX, 0))  # NE
        deny("socketpair", Comparison(2, 1, 0, 0))
        for socket_type in range(16):
            if socket_type not in (socket.SOCK_STREAM, socket.SOCK_SEQPACKET):
                deny("socketpair", Comparison(1, 7, 0xf, socket_type))  # MASKED_EQ
        checked(lib.seccomp_load(context))
    finally:
        lib.seccomp_release(context)


def run_guarded_capture(source, playwright_loader):
    install_transport_guard()
    return asyncio.run(render_capture(source, playwright_loader()))


def load_playwright():
    from playwright.async_api import async_playwright
    return async_playwright


async def render_capture(source, playwright_factory):
    """The single logical source response is fulfilled locally, never fetched."""
    async with playwright_factory() as engine:
        browser = await engine.chromium.launch(
            executable_path=os.environ.get("CHROME_BIN", "/usr/bin/chromium"),
            headless=True, chromium_sandbox=True,
            args=["--disable-background-networking", "--disable-extensions",
                  "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=64"],
        )
        context = None
        try:
            context = await browser.new_context(
                viewport={"width": source["width"], "height": source["height"]},
                color_scheme=source["color_scheme"], device_scale_factor=1,
                service_workers="block", accept_downloads=False,
            )
            page = await context.new_page()
            admitted = False

            async def route_request(route):
                nonlocal admitted
                request = route.request
                if (not admitted and request.url == source["source_url"]
                        and request.is_navigation_request() and request.frame == page.main_frame):
                    admitted = True
                    await route.fulfill(status=200, body=source["html"], headers={
                        "Content-Type": "text/html; charset=utf-8",
                        "Content-Security-Policy": PROTOTYPE_CSP,
                        "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
                    })
                else:
                    await route.abort("blockedbyclient")

            async def block_socket(socket):
                await socket.close()

            async def close_popup(popup):
                await popup.close()

            async def dismiss_dialog(dialog):
                await dialog.dismiss()

            await context.route("**/*", route_request)
            await context.route_web_socket("**/*", block_socket)
            context.on("page", close_popup)
            page.on("dialog", dismiss_dialog)
            await page.goto(source["source_url"], wait_until="domcontentloaded", timeout=4000)
            pixels = await page.screenshot(type="png", full_page=False, animations="disabled",
                                           caret="hide", scale="css", timeout=4000)
            if not admitted or not pixels or len(pixels) > MAX_PNG_BYTES:
                raise ValueError("prototype_capture_output_size")
            return {"sha256": source["sha256"], "width": source["width"],
                    "height": source["height"], "color_scheme": source["color_scheme"],
                    "transport": "offline-qualified-bytes",
                    "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    "png_base64": base64.b64encode(pixels).decode("ascii")}
        finally:
            try:
                if context is not None:
                    await context.close()
            finally:
                await browser.close()


def main():
    if sys.platform != "linux" or os.geteuid() == 0:
        raise ValueError("prototype_capture_unprivileged_worker_required")
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_FSIZE, (16_000_000, 16_000_000))
    resource.setrlimit(resource.RLIMIT_NOFILE, (512, 512))
    raw = sys.stdin.buffer.read(MAX_HTML_BYTES * 6 + 4001)
    if len(raw) > MAX_HTML_BYTES * 6 + 4000:
        raise ValueError("prototype_capture_request_size")
    source = validate_capture_request(json.loads(raw))
    result = run_guarded_capture(source, load_playwright)
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
