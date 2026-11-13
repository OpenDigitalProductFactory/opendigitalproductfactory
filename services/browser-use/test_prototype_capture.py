"""Offline prototype capture contracts; no provider or running service required."""
import hashlib
import contextlib
import tempfile
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
import prototype_capture_worker as worker
import prototype_capture as parent


class KernelBoundaryTest(unittest.TestCase):
    def test_service_setup_narrows_existing_root_directories_without_changing_contents(self):
        with tempfile.TemporaryDirectory() as base:
            profiles, evidence = Path(base) / "profiles", Path(base) / "evidence"
            profiles.mkdir(mode=0o755)
            evidence.mkdir(mode=0o755)
            (evidence / "saved.png").write_bytes(b"preserved")
            real_fstat = os.fstat
            def root_stat(fd):
                actual = real_fstat(fd)
                return SimpleNamespace(st_uid=0, st_mode=actual.st_mode)
            with patch.object(parent.os, "geteuid", return_value=0), \
                    patch.object(parent.sys, "platform", "linux"), \
                    patch.object(parent.os, "fstat", side_effect=root_stat):
                parent.initialize_capture_directories(str(profiles), str(evidence))
            self.assertEqual(profiles.stat().st_mode & 0o777, 0o700)
            self.assertEqual(evidence.stat().st_mode & 0o777, 0o700)
            self.assertEqual((evidence / "saved.png").read_bytes(), b"preserved")

    def test_service_setup_refuses_symlink_before_changing_either_directory(self):
        with tempfile.TemporaryDirectory() as base:
            profiles, evidence = Path(base) / "profiles", Path(base) / "evidence"
            profiles.mkdir(mode=0o755)
            evidence.symlink_to(profiles, target_is_directory=True)
            real_fstat = os.fstat
            def root_stat(fd):
                actual = real_fstat(fd)
                return SimpleNamespace(st_uid=0, st_mode=actual.st_mode)
            with patch.object(parent.os, "geteuid", return_value=0), \
                    patch.object(parent.sys, "platform", "linux"), \
                    patch.object(parent.os, "fstat", side_effect=root_stat):
                with self.assertRaises((ValueError, OSError)):
                    parent.initialize_capture_directories(str(profiles), str(evidence))
            self.assertEqual(profiles.stat().st_mode & 0o777, 0o755)

    def test_unbounded_container_cannot_admit_capture(self):
        with patch.object(parent.Path, "read_text", side_effect=["0::/\n", "max\n"]):
            with self.assertRaisesRegex(ValueError, "resource_boundary_unavailable"):
                parent.qualify_resource_boundary()

    def test_bounded_container_reports_actual_memory_and_process_budget(self):
        with patch.object(parent.Path, "read_text", side_effect=["0::/\n", "1073741824\n", "256\n"]):
            self.assertEqual(parent.qualify_resource_boundary(), (1073741824, 256))

    def test_guard_failure_prevents_loading_playwright(self):
        loader = MagicMock()
        with patch.object(worker, "install_transport_guard", create=True,
                          side_effect=ValueError("filter unavailable")) as guard:
            with self.assertRaisesRegex(ValueError, "filter unavailable"):
                worker.run_guarded_capture(request(), loader)
        guard.assert_called_once()
        loader.assert_not_called()

    def test_unreadable_process_inventory_is_not_an_empty_family(self):
        with patch.object(parent.Path, "iterdir", side_effect=PermissionError("proc hidden")):
            with self.assertRaisesRegex(ValueError, "inventory_unavailable"):
                parent.pin_capture_processes(10001)

    def test_descriptor_inventory_rejects_an_inherited_socket(self):
        with patch.object(worker.os, "listdir", return_value=["0", "7"]), \
                patch.object(worker.os, "fstat", return_value=SimpleNamespace(st_mode=0o140777)):
            with self.assertRaisesRegex(ValueError, "inherited_socket"):
                worker.reject_inherited_sockets()


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
    async def test_resource_refusal_precedes_worker_or_control_directory_creation(self):
        with patch.object(parent, "capture_identity", return_value=(10001, 10001)), \
                patch.object(parent, "qualify_resource_boundary", side_effect=ValueError("prototype_capture_resource_boundary_unavailable")), \
                patch.object(parent, "capture_lock", side_effect=AssertionError("resource refusal must precede admission")) as lock, \
                patch.object(parent.asyncio, "create_subprocess_exec", AsyncMock()) as spawn:
            with self.assertRaisesRegex(ValueError, "resource_boundary_unavailable"):
                await render_prototype(request())
        lock.assert_not_called()
        spawn.assert_not_awaited()

    def child(self, source):
        return SimpleNamespace(pid=987654321, returncode=0, wait=AsyncMock(return_value=0),
            stdin=SimpleNamespace(write=MagicMock(), drain=AsyncMock(), close=MagicMock()),
            stdout=SimpleNamespace(read=AsyncMock(side_effect=[json.dumps(pixel_output(source)).encode(), b""])))

    async def test_internal_pixels_use_a_dedicated_identity_clean_environment_and_process_group(self):
        source = request(width=320, height=240)
        child = self.child(source)
        with patch("prototype_capture.capture_identity", return_value=(10001, 10001)), \
                patch("prototype_capture.qualify_resource_boundary"), \
                patch("prototype_capture.os.chown"), \
                tempfile.TemporaryFile() as lock, \
                patch("prototype_capture.capture_lock", return_value=contextlib.nullcontext(lock.fileno())), \
                patch("prototype_capture._stop_child", AsyncMock()) as stop, \
                patch("prototype_capture.asyncio.create_subprocess_exec", AsyncMock(return_value=child)) as start:
            result = await render_prototype(source)
        self.assertEqual(result["mime_type"], "image/png")
        options = start.call_args.kwargs
        self.assertEqual((options["user"], options["group"], options["extra_groups"]), (10001, 10001, ()))
        self.assertTrue(options["start_new_session"])
        self.assertNotIn("OPENAI_API_KEY", options["env"])
        self.assertTrue(options["close_fds"])
        stop.assert_awaited_once_with(child, 10001)

    async def test_detached_family_is_signalled_by_pinned_identity_not_process_group(self):
        child = self.child(request(width=320, height=240))
        with patch.object(parent, "pin_capture_processes", side_effect=[[(789, 42, "birth")], []]), \
                patch.object(parent.signal, "pidfd_send_signal", create=True) as send, \
                patch.object(parent.os, "close"), patch.object(parent.os, "waitpid") as reap:
            await parent._stop_child(child, 10001)
        send.assert_called_once_with(42, parent.signal.SIGKILL)
        reap.assert_called_once_with(789, parent.os.WNOHANG)

    async def test_repeated_cancellation_and_failed_inventory_retain_directory_and_hold(self):
        source = request(width=320, height=240)
        child = self.child(source)
        exchange_started, cleanup_started, finish_cleanup = (asyncio.Event() for _ in range(3))
        async def hang(_size):
            exchange_started.set()
            await asyncio.Event().wait()
        async def failed_cleanup(*_args):
            cleanup_started.set()
            await finish_cleanup.wait()
            raise ValueError("prototype_capture_inventory_unavailable")
        child.stdout.read.side_effect = hang
        home = tempfile.mkdtemp(prefix="dpf-capture-test-")
        try:
            with patch.object(parent, "capture_identity", return_value=(10001, 10001)), \
                    patch.object(parent, "qualify_resource_boundary"), \
                    patch.object(parent.os, "chown"), patch.object(parent.os, "chmod"), \
                    tempfile.TemporaryFile() as lock, \
                    patch.object(parent, "capture_lock", return_value=contextlib.nullcontext(lock.fileno())), \
                    patch.object(parent.tempfile, "mkdtemp", return_value=home), \
                    patch.object(parent.shutil, "rmtree") as remove, \
                    patch.object(parent, "_stop_child", side_effect=failed_cleanup), \
                    patch.object(parent.asyncio, "create_subprocess_exec", AsyncMock(return_value=child)):
                task = asyncio.create_task(render_prototype(source))
                await exchange_started.wait()
                task.cancel()
                await cleanup_started.wait()
                task.cancel()
                await asyncio.sleep(0)
                self.assertFalse(task.done())
                finish_cleanup.set()
                with self.assertRaisesRegex(ValueError, "inventory_unavailable"):
                    await task
                self.assertEqual(os.pread(lock.fileno(), 32, 0), b"unsettled\n")
                remove.assert_not_called()
        finally:
            import shutil
            shutil.rmtree(home)
        child.stdin.close.assert_called_once()

    async def test_timeout_settles_the_owned_family_without_returning_pixels(self):
        source = request(width=320, height=240)
        child = self.child(source)
        child.returncode = None
        async def hang(_size):
            await asyncio.sleep(1)
            return b""
        child.stdout.read.side_effect = hang
        with patch("prototype_capture.capture_identity", return_value=(10001, 10001)), \
                patch("prototype_capture.qualify_resource_boundary"), \
                patch("prototype_capture.os.chown"), \
                tempfile.TemporaryFile() as lock, \
                patch("prototype_capture.capture_lock", return_value=contextlib.nullcontext(lock.fileno())), \
                patch("prototype_capture._stop_child", AsyncMock()) as stop, \
                patch("prototype_capture.CAPTURE_SECONDS", 0.01), \
                patch("prototype_capture.asyncio.create_subprocess_exec", AsyncMock(return_value=child)):
            result = await render_prototype(source)
        self.assertEqual(result, {"error": "prototype_capture_timeout"})
        stop.assert_awaited_once_with(child, 10001)


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

    def test_capture_identity_also_refuses_readable_shared_screenshot_volume(self):
        account = SimpleNamespace(pw_uid=10001, pw_gid=10001)
        with patch("prototype_capture.sys.platform", "linux"), patch("os.geteuid", return_value=0), \
                patch("pwd.getpwnam", return_value=account), \
                patch("os.lstat", side_effect=[SimpleNamespace(st_uid=0, st_mode=0o40700),
                    SimpleNamespace(st_uid=0, st_mode=0o40755)]):
            with self.assertRaisesRegex(ValueError, "private_evidence_required"):
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
