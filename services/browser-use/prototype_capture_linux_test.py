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

    def test_namespace_readiness_under_unchanged_qualification_policy(self):
        # This explicit harness marker is not an authority grant. The caller
        # must already hold normal CI/nonprod admission. Never run this transient
        # namespace experiment manually in the production browser container.
        if os.environ.get("DPF_CAPTURE_QUALIFICATION") != "1":
            raise RuntimeError("namespace probe requires the admitted qualification harness")
        capture.qualify_resource_boundary()
        from importlib.metadata import version
        packages = subprocess.run(["dpkg-query", "--show", "--showformat=${binary:Package}=${Version}\n",
            "chromium", "chromium-common", "chromium-sandbox", "libseccomp2"],
            capture_output=True, text=True, timeout=3)
        print("DPF_CAPTURE_PACKAGE_DIAGNOSTIC=" + json.dumps({
            "python": sys.version.split()[0], "playwright": version("playwright"),
            "packages": packages.stdout.splitlines(), "query_exit": packages.returncode,
            "missing_packages": packages.stderr[:1000]}, sort_keys=True))
        for guarded in (False, True):
            code = "GUARDED = " + repr(guarded) + r'''
import ctypes, errno, json, os, platform
from pathlib import Path
libc = ctypes.CDLL(None, use_errno=True)
libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
libc.prctl.restype = ctypes.c_int
libc.unshare.argtypes = [ctypes.c_int]
libc.unshare.restype = ctypes.c_int
assert libc.getpid() == os.getpid()  # positive syscall/control-path check
if GUARDED:
    from prototype_capture_worker import install_transport_guard
    install_transport_guard()
else:
    assert libc.prctl(38, 1, 0, 0, 0) == 0  # PR_SET_NO_NEW_PRIVS
status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
assert status["NoNewPrivs"].strip() == "1"
assert status["Seccomp"].strip() == "2"  # require the existing filtered boundary
assert int(status["CapEff"].strip(), 16) == 0
ctypes.set_errno(0)
unset = libc.prctl(38, 0, 0, 0, 0)
unset_errno = ctypes.get_errno()
assert unset == -1 and unset_errno == errno.EINVAL  # negative control: NNP cannot be removed
assert libc.prctl(39, 0, 0, 0, 0) == 1
def read(path):
    try: return Path(path).read_text().strip()
    except OSError as error: return {"unavailable_errno": error.errno}
uid, gid, groups = os.geteuid(), os.getegid(), os.getgroups()
assert uid == 10001 and gid == 10001 and groups == []
before = os.readlink("/proc/self/ns/user")
ctypes.set_errno(0)
zero_result = libc.unshare(0)  # no namespace requested; never changes identity
zero_errno = ctypes.get_errno()
assert os.readlink("/proc/self/ns/user") == before
ctypes.set_errno(0)
result = libc.unshare(0x10000000)  # Linux UAPI CLONE_NEWUSER; no map/mount/network writes
result_errno = ctypes.get_errno()
after = os.readlink("/proc/self/ns/user")
assert result in (0, -1)
assert (after != before) if result == 0 else (after == before)
print(json.dumps({"guarded": GUARDED, "uid_before": uid, "gid_before": gid, "groups": groups,
    "uid_after": os.geteuid(), "no_new_privs": libc.prctl(39, 0, 0, 0, 0),
    "seccomp": status["Seccomp"].strip(), "seccomp_filters": status.get("Seccomp_filters", "unavailable").strip(),
    "effective_capabilities_before": status["CapEff"].strip(),
    "nnp_unset_errno": unset_errno, "unshare_zero": {"result": zero_result, "errno": zero_errno},
    "unshare_user": {"result": result, "errno": result_errno, "namespace_changed": after != before},
    "kernel": platform.release(), "machine": platform.machine(),
    "unprivileged_userns_clone": read("/proc/sys/kernel/unprivileged_userns_clone"),
    "max_user_namespaces": read("/proc/sys/user/max_user_namespaces"),
    "lsm_label": read("/proc/self/attr/current"),
    "sandbox_helper_exists": Path("/usr/lib/chromium/chrome-sandbox").exists()}))
'''
            result = json.loads(self.run_worker_probe(code))
            print("DPF_CAPTURE_NAMESPACE_DIAGNOSTIC=" + json.dumps(result, sort_keys=True))
        # One child at a time, reaped by subprocess.run; this is availability
        # evidence for this image/host only, never permission to change policy.
        self.assertEqual(capture.pin_capture_processes(UID), [])

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
        diagnostics = bytearray()
        original_spawn = asyncio.create_subprocess_exec
        readers = []
        async def drain(stream):
            while True:
                chunk = await stream.read(4096)
                if not chunk:
                    return
                remaining = 8192 - len(diagnostics)
                if remaining > 0:
                    diagnostics.extend(chunk[:remaining])
        async def spawn(*args, **kwargs):
            # Fixture-only diagnostics. Production still exposes only its typed
            # unavailable result. Keep the real identity, guard and cleanup.
            kwargs["stderr"] = asyncio.subprocess.PIPE
            child = await original_spawn(*args, **kwargs)
            readers.append(asyncio.create_task(drain(child.stderr)))
            return child
        async def exercise():
            with patch.object(capture.asyncio, "create_subprocess_exec", side_effect=spawn):
                result = await capture.render_prototype(source())
            await asyncio.gather(*readers)
            return result
        result = asyncio.run(exercise())
        self.assertNotIn("error", result, {**result, "fixture_worker_stderr": diagnostics.decode("utf-8", errors="replace")})
        self.assertEqual(result["mime_type"], "image/png")
        self.assertEqual(result["sha256"], source()["sha256"])
        self.assertGreater(result["bytes"], 100)
        self.assertEqual(capture.pin_capture_processes(UID), [])


class DetachedFamilyQualification(unittest.IsolatedAsyncioTestCase):
    async def test_timeout_removes_temporary_profile_artifacts_with_owned_home(self):
        original_spawn = asyncio.create_subprocess_exec
        home = tempfile.mkdtemp(prefix="dpf-profile-cleanup-")
        artifacts = []
        async def spawn(*_args, **kwargs):
            child = await original_spawn(sys.executable, "-c",
                "import tempfile,time; from pathlib import Path; "
                "p=tempfile.mkdtemp(prefix='fixture-profile-'); "
                "Path('profile-locator').write_text(p); time.sleep(30)", **kwargs)
            marker = Path(home) / "profile-locator"
            for _ in range(200):
                if marker.exists():
                    artifacts.append(Path(marker.read_text()))
                    break
                await asyncio.sleep(0.01)
            else:
                raise AssertionError("fixture profile was not created")
            return child
        with patch.object(capture.asyncio, "create_subprocess_exec", side_effect=spawn), \
                patch.object(capture.tempfile, "mkdtemp", return_value=home), \
                patch.object(capture, "CAPTURE_SECONDS", 0.1):
            result = await capture.render_prototype(source())
        self.assertEqual(result, {"error": "prototype_capture_timeout"})
        self.assertEqual(len(artifacts), 1)
        self.assertTrue(artifacts[0].is_relative_to(home), artifacts[0])
        self.assertFalse(Path(home).exists())
        self.assertFalse(artifacts[0].exists())
        self.assertEqual(capture.pin_capture_processes(UID), [])

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
