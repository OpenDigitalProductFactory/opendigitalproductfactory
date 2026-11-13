"""Private unprivileged worker. No general browsing or model inference."""
import asyncio
import base64
import datetime
import json
import os
import resource
import sys

from prototype_capture import MAX_HTML_BYTES, MAX_PNG_BYTES, validate_capture_request

PROTOTYPE_CSP = (
    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; "
    "style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; "
    "media-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; "
    "form-action 'none'; object-src 'none'; frame-ancestors 'none'"
)


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
    from playwright.async_api import async_playwright
    result = asyncio.run(render_capture(source, async_playwright))
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
