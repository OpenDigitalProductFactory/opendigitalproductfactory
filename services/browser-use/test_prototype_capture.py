"""Offline prototype capture contracts; no provider or running service required."""
import hashlib
import os
import base64
from pathlib import Path
import shlex
import struct
import unittest
import zlib
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from prototype_capture import validate_capture_request, validate_capture_result
from prototype_capture import child_environment, capture_identity, render_prototype
from prototype_capture_worker import render_capture


def request(**changes):
    html = "<!doctype html><html><body>Prototype</body></html>"
    value = {"html": html, "sha256": hashlib.sha256(html.encode()).hexdigest(),
             "source_url": "https://localhost/api/documents/DOC-1/content?version=1&preview=prototype",
             "width": 1280, "height": 720, "color_scheme": "light"}
    return {**value, **changes}


def pixel_output(source):
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    width, height = source["width"], source["height"]
    pixels = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
              + chunk(b"IDAT", zlib.compress((b"\x00" + b"\x00\x00\x00\xff" * width) * height))
              + chunk(b"IEND", b""))
    return {"sha256": source["sha256"], "width": width, "height": height,
            "color_scheme": source["color_scheme"], "transport": "offline-qualified-bytes",
            "png_base64": base64.b64encode(pixels).decode()}


class ParentIsolationTest(unittest.IsolatedAsyncioTestCase):
    def child(self, source):
        return SimpleNamespace(pid=987654321, returncode=0, wait=AsyncMock(return_value=0),
            stdin=SimpleNamespace(write=MagicMock(), drain=AsyncMock(), close=MagicMock()),
            stdout=SimpleNamespace(read=AsyncMock(side_effect=[json.dumps(pixel_output(source)).encode(), b""])))

    async def test_internal_pixels_use_a_dedicated_identity_clean_environment_and_process_group(self):
        source = request(width=320, height=240)
        child = self.child(source)
        with patch("prototype_capture.capture_identity", return_value=(10001, 10001)), \
                patch("prototype_capture.os.chown"), patch("prototype_capture.os.killpg") as kill, \
                patch("prototype_capture.asyncio.create_subprocess_exec", AsyncMock(return_value=child)) as start:
            result = await render_prototype(source)
        self.assertEqual(result["mime_type"], "image/png")
        options = start.call_args.kwargs
        self.assertEqual((options["user"], options["group"], options["extra_groups"]), (10001, 10001, ()))
        self.assertTrue(options["start_new_session"])
        self.assertNotIn("OPENAI_API_KEY", options["env"])
        kill.assert_called_once()  # also when the leader has already exited
        child.stdin.close.assert_called_once()

    async def test_timeout_kills_the_entire_child_group_without_returning_pixels(self):
        source = request(width=320, height=240)
        child = self.child(source)
        child.returncode = None
        async def hang(_size):
            await asyncio.sleep(1)
            return b""
        child.stdout.read.side_effect = hang
        with patch("prototype_capture.capture_identity", return_value=(10001, 10001)), \
                patch("prototype_capture.os.chown"), patch("prototype_capture.os.killpg") as kill, \
                patch("prototype_capture.CAPTURE_SECONDS", 0.01), \
                patch("prototype_capture.asyncio.create_subprocess_exec", AsyncMock(return_value=child)):
            result = await render_prototype(source)
        self.assertEqual(result, {"error": "prototype_capture_timeout"})
        kill.assert_called_once()
        child.wait.assert_awaited()


class CaptureContractTest(unittest.TestCase):
    def test_runtime_image_copies_every_imported_capture_module(self):
        dockerfile = Path(__file__).with_name("Dockerfile").read_text()
        copied = set()
        for line in dockerfile.splitlines():
            if line.startswith("COPY "):
                copied.update(shlex.split(line)[1:-1])
        self.assertTrue({"server.py", "url_policy.py", "agent_outcome.py",
                         "prototype_capture.py", "prototype_capture_worker.py"} <= copied)

    def test_renderer_api_is_an_explicit_pinned_runtime_dependency(self):
        requirements = Path(__file__).with_name("requirements.txt").read_text().splitlines()
        self.assertIn("playwright==1.64.0", requirements)

    def test_valid_pixels_are_hashed_and_displaced_dimensions_are_rejected(self):
        source = validate_capture_request(request(width=320, height=240))
        def chunk(kind, body):
            return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
        png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 320, 240, 8, 6, 0, 0, 0))
               + chunk(b"IDAT", zlib.compress((b"\x00" + b"\x00\x00\x00\xff" * 320) * 240))
               + chunk(b"IEND", b""))
        output = {"sha256": source["sha256"], "width": 320, "height": 240,
                  "color_scheme": "light", "transport": "offline-qualified-bytes",
                  "png_base64": base64.b64encode(png).decode()}
        result = validate_capture_result(output, source)
        self.assertEqual(result["image_sha256"], hashlib.sha256(png).hexdigest())
        self.assertEqual(result["bytes"], len(png))
        with self.assertRaises(ValueError):
            validate_capture_result(output, {**source, "width": 321})
        corrupt = bytearray(png)
        corrupt[29] ^= 1
        with self.assertRaises(ValueError):
            validate_capture_result({**output, "png_base64": base64.b64encode(corrupt).decode()}, source)

    def test_profile_volume_must_be_private_and_capture_identity_nonroot(self):
        account = SimpleNamespace(pw_uid=10001, pw_gid=10001)
        with patch("prototype_capture.sys.platform", "linux"), patch("os.geteuid", return_value=0), \
                patch("pwd.getpwnam", return_value=account), \
                patch("os.lstat", return_value=SimpleNamespace(st_uid=0, st_mode=0o40700)):
            self.assertEqual(capture_identity("/profiles"), (10001, 10001))
            with patch("os.lstat", return_value=SimpleNamespace(st_uid=0, st_mode=0o40755)), self.assertRaises(ValueError):
                capture_identity("/profiles")
            with patch("os.lstat", return_value=SimpleNamespace(st_uid=0, st_mode=0o120700)), self.assertRaises(ValueError):
                capture_identity("/profiles")
            with patch("pwd.getpwnam", return_value=SimpleNamespace(pw_uid=0, pw_gid=0)), self.assertRaises(ValueError):
                capture_identity("/profiles")

    def test_child_does_not_inherit_service_credentials_or_profiles(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-secret", "HOME": "/profiles"}):
            env = child_environment("/tmp/isolated", "/usr/bin/chromium")
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("ANTHROPIC_API_KEY", env)
        self.assertEqual(env["HOME"], "/tmp/isolated")
        self.assertEqual(env["CHROME_BIN"], "/usr/bin/chromium")

    def test_unsupported_host_refuses_instead_of_using_unsafe_browser(self):
        with patch("prototype_capture.sys.platform", "darwin"), self.assertRaises(ValueError):
            capture_identity("/profiles")

    def test_exact_source_is_required_before_a_renderer_can_start(self):
        self.assertEqual(validate_capture_request(request())["width"], 1280)
        for change in ({"sha256": "0" * 64}, {"html": "changed"},
                       {"profile_path": "/profiles/operator"}, {"script": "arbitrary()"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_capture_request(request(**change))

    def test_resource_and_locator_bounds_are_not_coerced(self):
        for change in ({"width": True}, {"width": 0}, {"height": 20001},
                       {"width": 1920, "height": 1081}, {"color_scheme": "auto"},
                       {"html": "x" * 262145}, {"source_url": "file:///secret"},
                       {"source_url": "https://user:secret@localhost/"}):
            with self.subTest(change=list(change)), self.assertRaises(ValueError):
                validate_capture_request(request(**change))

    def test_success_is_bound_to_the_exact_bytes_and_real_pixel_metadata(self):
        source = validate_capture_request(request())
        output = {"sha256": source["sha256"], "width": 1280, "height": 720,
                  "color_scheme": "light", "transport": "offline-qualified-bytes",
                  "png_base64": "not-a-png"}
        with self.assertRaises(ValueError):
            validate_capture_result(output, source)
        for change in ({"sha256": "0" * 64}, {"transport": "live-fetch"}, {"width": 1}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_capture_result({**output, **change}, source)


class WorkerIsolationTest(unittest.IsolatedAsyncioTestCase):
    def setup_browser(self):
        page = SimpleNamespace(main_frame=object(), on=MagicMock(),
                               screenshot=AsyncMock(return_value=b"pixels"))
        context = SimpleNamespace(new_page=AsyncMock(return_value=page), route=AsyncMock(),
                                  route_web_socket=AsyncMock(), on=MagicMock(), close=AsyncMock())
        browser = SimpleNamespace(new_context=AsyncMock(return_value=context), close=AsyncMock())
        engine = SimpleNamespace(chromium=SimpleNamespace(launch=AsyncMock(return_value=browser)))
        manager = MagicMock()
        manager.__aenter__ = AsyncMock(return_value=engine)
        manager.__aexit__ = AsyncMock(return_value=False)
        source = validate_capture_request(request())
        page.goto = AsyncMock()
        return source, page, context, browser, engine, lambda: manager

    async def test_network_guards_precede_loading_and_only_exact_first_source_is_fulfilled(self):
        source, page, context, browser, engine, factory = self.setup_browser()
        routes = []
        async def navigate(*_args, **_kwargs):
            self.assertEqual(context.route.await_count, 1)
            self.assertEqual(context.route_web_socket.await_count, 1)
            handler = context.route.call_args.args[1]
            for url, navigation in ((source["source_url"], True),
                                    ("https://external.example/secret", False),
                                    (source["source_url"], True)):
                route = SimpleNamespace(request=SimpleNamespace(url=url,
                    is_navigation_request=lambda: navigation, frame=page.main_frame),
                    fulfill=AsyncMock(), abort=AsyncMock())
                await handler(route)
                routes.append(route)
        page.goto.side_effect = navigate
        result = await render_capture(source, factory)
        self.assertEqual(result["transport"], "offline-qualified-bytes")
        self.assertEqual(result["sha256"], source["sha256"])
        routes[0].fulfill.assert_awaited_once()
        first = routes[0].fulfill.call_args.kwargs
        self.assertEqual(first["body"], source["html"])
        self.assertIn("sandbox allow-scripts", first["headers"]["Content-Security-Policy"])
        self.assertNotIn("allow-same-origin", first["headers"]["Content-Security-Policy"])
        for route in routes[1:]:
            route.fulfill.assert_not_awaited()
            route.abort.assert_awaited_once_with("blockedbyclient")
        launch = engine.chromium.launch.call_args.kwargs
        self.assertTrue(launch["chromium_sandbox"])
        self.assertNotIn("--no-sandbox", launch["args"])
        options = browser.new_context.call_args.kwargs
        self.assertEqual(options["service_workers"], "block")
        self.assertFalse(options["accept_downloads"])
        self.assertNotIn("storage_state", options)
        context.close.assert_awaited_once()
        browser.close.assert_awaited_once()

    async def test_sandbox_failure_never_falls_back_to_unsafe_launch(self):
        source, page, context, browser, engine, factory = self.setup_browser()
        engine.chromium.launch.side_effect = RuntimeError("sandbox unavailable")
        with self.assertRaises(RuntimeError):
            await render_capture(source, factory)
        self.assertEqual(engine.chromium.launch.await_count, 1)
        page.goto.assert_not_awaited()

    async def test_navigation_failure_closes_context_and_browser_without_pixels(self):
        source, page, context, browser, engine, factory = self.setup_browser()
        page.goto.side_effect = RuntimeError("failed")
        with self.assertRaises(RuntimeError):
            await render_capture(source, factory)
        page.screenshot.assert_not_awaited()
        context.close.assert_awaited_once()
        browser.close.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
