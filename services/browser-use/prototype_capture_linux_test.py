"""Image qualification, not a live-install receipt. Requires Linux/root image.

Run only in the governed CI job, with the production modules imported from
/app. The host source tests deliberately do not stand in for these controls.
"""
import asyncio
import errno
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import prototype_capture as capture


UID = GID = 10001


def source(html="<!doctype html><style>body{background:red}</style><h1>Owned prototype</h1>"):
    return {"html": html, "sha256": hashlib.sha256(html.encode()).hexdigest(),
            "source_url": "https://prototype.invalid/owned/version-1", "width": 320,
            "height": 240, "color_scheme": "light"}


class ImageQualification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if sys.platform != "linux" or os.geteuid() != 0:
            raise RuntimeError("Linux image qualification requires its root controller")
        if capture.capture_identity("/profiles") != (UID, GID):
            raise RuntimeError("The image must reserve the capture identity")

    def run_worker_probe(self, code, pass_fds=()):
        with tempfile.TemporaryDirectory() as home:
            os.chown(home, UID, GID)
            result = subprocess.run([sys.executable, "-c", code],
                user=UID, group=GID, extra_groups=(), close_fds=True, pass_fds=pass_fds,
                env={**capture.child_environment(home, "/usr/bin/chromium"), "PYTHONPATH": "/app"},
                cwd=home, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr[-4000:])
        return result.stdout

    def test_kernel_blocks_ip_stun_unix_brokers_and_alternate_descriptor_paths(self):
        # Actual syscalls must return the filter's EPERM, not merely fail because
        # CI has no network. Stream pairs still carry child IPC bytes.
        self.run_worker_probe(r'''
import ctypes, errno, socket, subprocess, sys
from prototype_capture_worker import install_transport_guard
install_transport_guard()
def denied(call):
    try: call()
    except OSError as error: assert error.errno == errno.EPERM, error
    else: raise AssertionError("transport syscall was allowed")
for family in (socket.AF_INET, socket.AF_INET6, socket.AF_UNIX):
    for kind in (socket.SOCK_STREAM, socket.SOCK_DGRAM):
        denied(lambda: socket.socket(family, kind))
denied(lambda: socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM))
denied(lambda: socket.socketpair(socket.AF_INET, socket.SOCK_STREAM))
for kind in (socket.SOCK_STREAM, socket.SOCK_SEQPACKET):
    left, right = socket.socketpair(socket.AF_UNIX, kind)
    left.send(b"private IPC")
    assert right.recv(40) == b"private IPC"
    denied(lambda: left.connect("/tmp/foreign-broker.sock"))
    denied(lambda: left.bind("/tmp/foreign-listener.sock"))
    left.close(); right.close()
lib = ctypes.CDLL("libseccomp.so.2")
lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
libc = ctypes.CDLL(None, use_errno=True)
for name in (b"io_uring_setup", b"pidfd_getfd", b"ptrace", b"process_vm_readv", b"process_vm_writev"):
    number = lib.seccomp_syscall_resolve_name(name)
    assert number >= 0
    ctypes.set_errno(0)
    assert libc.syscall(number, -1, 0, 0, 0, 0, 0) == -1
    assert ctypes.get_errno() == errno.EPERM, name
# A fresh executable must inherit the kernel policy, without reinstalling it.
probe = "import socket,errno\ntry: socket.socket()\nexcept OSError as e: assert e.errno==errno.EPERM\nelse: raise AssertionError('exec escaped')"
subprocess.run([sys.executable, "-c", probe], check=True, timeout=3)
''')

    def test_inherited_socket_is_rejected_before_filter_or_browser_start(self):
        left, right = socket.socketpair()
        try:
            self.run_worker_probe('''
from prototype_capture_worker import install_transport_guard
try: install_transport_guard()
except ValueError as error: assert str(error) == "prototype_capture_inherited_socket"
else: raise AssertionError("inherited socket was accepted")
''', pass_fds=(left.fileno(),))
        finally:
            left.close()
            right.close()

    def test_actual_service_startup_hardens_its_owned_mount_roots(self):
        import server
        with tempfile.TemporaryDirectory() as base:
            profiles, evidence = Path(base) / "profiles", Path(base) / "evidence"
            profiles.mkdir(mode=0o755)
            evidence.mkdir(mode=0o755)
            (evidence / "saved.png").write_bytes(b"unchanged")
            async def exercise():
                with patch.object(server, "PROFILES_DIR", str(profiles)), \
                        patch.object(server, "EVIDENCE_DIR", str(evidence)):
                    await server.startup()
                    try:
                        self.assertEqual(profiles.stat().st_mode & 0o777, 0o700)
                        self.assertEqual(evidence.stat().st_mode & 0o777, 0o700)
                        self.assertEqual((evidence / "saved.png").read_bytes(), b"unchanged")
                    finally:
                        await server.shutdown()
            asyncio.run(exercise())

    def test_capture_setup_failure_preserves_ordinary_service_startup(self):
        import server
        async def exercise():
            with patch.object(server, "initialize_capture_directories", side_effect=ValueError("unsafe owner")):
                await server.startup()
                try:
                    self.assertIsNotNone(server.sessions._cleanup_task)
                finally:
                    await server.shutdown()
        asyncio.run(exercise())

    def test_dead_pidfd_never_signals_a_different_live_process(self):
        old = subprocess.Popen([sys.executable, "-c", "pass"])
        fd = os.pidfd_open(old.pid)
        old.wait(timeout=3)
        foreign = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(10)"])
        try:
            with self.assertRaises(ProcessLookupError):
                signal.pidfd_send_signal(fd, signal.SIGKILL)
            self.assertIsNone(foreign.poll())
        finally:
            os.close(fd)
            foreign.kill()
            foreign.wait(timeout=3)

    def test_real_sandboxed_browser_returns_bound_pixels_and_leaves_no_workers(self):
        result = asyncio.run(capture.render_prototype(source()))
        self.assertNotIn("error", result, result)
        self.assertEqual(result["mime_type"], "image/png")
        self.assertEqual(result["sha256"], source()["sha256"])
        self.assertGreater(result["bytes"], 100)
        self.assertEqual(capture.pin_capture_processes(UID), [])


class DetachedFamilyQualification(unittest.IsolatedAsyncioTestCase):
    async def test_timeout_reaps_setsid_grandchild_without_signalling_foreign_uid(self):
        if sys.platform != "linux" or os.geteuid() != 0:
            raise RuntimeError("Linux/root required")
        foreign = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(10)"])
        original_spawn = asyncio.create_subprocess_exec
        # A private test-only replacement for the trusted worker demonstrates
        # why killing its original process group is insufficient.
        detached = """
import os,time,sys
if os.fork():
    sys.stdin.buffer.read()
    os._exit(0)
os.setsid()
if os.fork(): os._exit(0)
time.sleep(30)
"""
        async def spawn(*_args, **kwargs):
            return await original_spawn(sys.executable, "-c", detached, **kwargs)
        try:
            with patch.object(capture.asyncio, "create_subprocess_exec", side_effect=spawn), \
                    patch.object(capture, "CAPTURE_SECONDS", 0.3):
                result = await capture.render_prototype(source())
            self.assertEqual(result, {"error": "prototype_capture_timeout"})
            self.assertEqual(capture.pin_capture_processes(UID), [])
            self.assertIsNone(foreign.poll())
        finally:
            foreign.kill()
            foreign.wait(timeout=3)

    async def test_cancellation_reaps_detached_family_before_returning(self):
        original_spawn = asyncio.create_subprocess_exec
        started = asyncio.Event()
        async def spawn(*_args, **kwargs):
            child = await original_spawn(sys.executable, "-c",
                "import os,time; from pathlib import Path; p=os.fork(); os.setsid() if p==0 else None; "
                "Path('detached-ready').touch() if p==0 else None; time.sleep(30)", **kwargs)
            marker = Path(kwargs["cwd"]) / "detached-ready"
            for _ in range(100):
                if marker.exists():
                    break
                await asyncio.sleep(0.01)
            else:
                raise AssertionError("detached child did not start")
            started.set()
            return child
        with patch.object(capture.asyncio, "create_subprocess_exec", side_effect=spawn):
            task = asyncio.create_task(capture.render_prototype(source()))
            await asyncio.wait_for(started.wait(), timeout=3)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(capture.pin_capture_processes(UID), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
