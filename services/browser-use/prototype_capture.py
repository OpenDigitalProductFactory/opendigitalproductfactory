"""Bounded offline rendering. This is separate from ordinary browse navigation.

The portal must qualify engagement/source authority before calling this transport.
It receives pixels internally; model-facing callers receive document references.
"""
import asyncio
import contextlib
import ctypes
import fcntl
import base64
import hashlib
import json
import os
import signal
import shutil
import stat
import struct
import sys
import tempfile
import zlib
from pathlib import Path
from urllib.parse import urlsplit

MAX_HTML_BYTES = 262144
MAX_PNG_BYTES = 4_000_000
MAX_REPLY_BYTES = 5_400_000
CAPTURE_SECONDS = 15
CAPTURE_USER = "dpf-capture"
_slots = asyncio.Semaphore(1)


def validate_capture_request(value):
    keys = {"html", "sha256", "source_url", "width", "height", "color_scheme"}
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError("prototype_capture_invalid_request")
    html = value["html"]
    if not isinstance(html, str) or not html or len(html.encode("utf-8")) > MAX_HTML_BYTES:
        raise ValueError("prototype_capture_source_size")
    if hashlib.sha256(html.encode("utf-8")).hexdigest() != value["sha256"]:
        raise ValueError("prototype_capture_source_digest")
    if (type(value["width"]) is not int or type(value["height"]) is not int
            or not 320 <= value["width"] <= 1920 or not 240 <= value["height"] <= 1080
            or value["width"] * value["height"] > 2_073_600
            or value["color_scheme"] not in ("light", "dark")):
        raise ValueError("prototype_capture_viewport")
    url = value["source_url"]
    if not isinstance(url, str) or len(url) > 2000:
        raise ValueError("prototype_capture_source_locator")
    try:
        parsed = urlsplit(url)
        if (parsed.scheme not in ("https", "http") or not parsed.hostname
                or parsed.username or parsed.password or parsed.fragment):
            raise ValueError("prototype_capture_source_locator")
        _ = parsed.port
    except ValueError:
        raise ValueError("prototype_capture_source_locator") from None
    return dict(value)


def validate_capture_result(value, source):
    if (not isinstance(value, dict) or value.get("sha256") != source["sha256"]
            or value.get("transport") != "offline-qualified-bytes"
            or value.get("color_scheme") != source["color_scheme"]
            or value.get("width") != source["width"] or value.get("height") != source["height"]):
        raise ValueError("prototype_capture_result_binding")
    encoded = value.get("png_base64")
    if not isinstance(encoded, str) or len(encoded) > MAX_REPLY_BYTES:
        raise ValueError("prototype_capture_output_size")
    try:
        pixels = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error):
        raise ValueError("prototype_capture_output_encoding") from None
    if (len(pixels) < 33 or len(pixels) > MAX_PNG_BYTES
            or pixels[:8] != b"\x89PNG\r\n\x1a\n"
            or pixels[8:16] != b"\x00\x00\x00\x0dIHDR"
            or zlib.crc32(pixels[12:29]) != struct.unpack(">I", pixels[29:33])[0]
            or struct.unpack(">II", pixels[16:24]) != (source["width"], source["height"])):
        raise ValueError("prototype_capture_output_pixels")
    return {**value, "image_sha256": hashlib.sha256(pixels).hexdigest(),
            "bytes": len(pixels), "mime_type": "image/png"}


def child_environment(home, chrome_bin):
    """Do not inherit provider tokens, service profiles or browser debugging state."""
    return {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": home, "TMPDIR": home,
            "XDG_CACHE_HOME": home, "CHROME_BIN": chrome_bin,
            "PYTHONUNBUFFERED": "1", "LANG": "C.UTF-8"}


def initialize_capture_directories(profiles_dir, evidence_dir):
    """Service-startup convergence only; rendering never mutates secret mounts.

    Qualify both existing directories before narrowing either one. Root readers
    retain access; no file is traversed, read, removed or re-owned here.
    """
    if sys.platform != "linux" or os.geteuid() != 0:
        raise ValueError("prototype_capture_private_setup_unavailable")
    descriptors = []
    try:
        for path in (profiles_dir, evidence_dir):
            os.makedirs(path, mode=0o700, exist_ok=True)
            fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            descriptors.append(fd)
            st = os.fstat(fd)
            if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o022:
                raise ValueError("prototype_capture_private_setup_unavailable")
        for fd in descriptors:
            os.fchmod(fd, 0o700)
    finally:
        for fd in descriptors:
            os.close(fd)


def capture_identity(profiles_dir, evidence_dir="/evidence"):
    if sys.platform != "linux" or os.geteuid() != 0:
        raise ValueError("prototype_capture_isolation_unavailable")
    import pwd
    try:
        account = pwd.getpwnam(CAPTURE_USER)
    except KeyError:
        raise ValueError("prototype_capture_isolation_unavailable") from None
    if account.pw_uid == 0 or account.pw_gid == 0:
        raise ValueError("prototype_capture_isolation_unavailable")
    # Never change a mounted credential volume as a side effect of rendering.
    # Existing installs must qualify its permissions through normal runtime setup.
    for path, label in ((profiles_dir, "profiles"), (evidence_dir, "evidence")):
        st = os.lstat(path)
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o077:
            raise ValueError("prototype_capture_private_" + label + "_required")
    return account.pw_uid, account.pw_gid


def qualify_resource_boundary():
    """Require actual container-wide limits, never infer them from CI flags.

    The checked-in service has no declared limits. Capture stays unavailable
    unless its owning runtime actually applies equivalent finite limits.
    Only a private cgroup-v2 root is supported; ambiguous mappings fail closed.
    """
    try:
        if Path("/proc/self/cgroup").read_text().strip() != "0::/":
            raise ValueError("not a private cgroup root")
        memory = int(Path("/sys/fs/cgroup/memory.max").read_text().strip())
        processes = int(Path("/sys/fs/cgroup/pids.max").read_text().strip())
        if not 0 < memory <= 1_073_741_824 or not 0 < processes <= 256:
            raise ValueError("unqualified resource budget")
        return memory, processes
    except (OSError, ValueError) as error:
        raise ValueError("prototype_capture_resource_boundary_unavailable") from error


def pin_capture_processes(uid):
    """Pin before reading identity. Never signal a numeric PID from an old scan.

    The uid is reserved exclusively for captures. The cross-controller lock and
    empty preflight make later members ours, even after setsid/reparenting.
    An unreadable inventory is not evidence of an empty family.
    """
    pinned = []
    try:
        for entry in Path("/proc").iterdir():
            if not entry.name.isdecimal():
                continue
            fd = None
            try:
                pid = int(entry.name)
                fd = os.pidfd_open(pid, 0)
                status = (entry / "status").read_text()
                uids = next(line.split()[1:] for line in status.splitlines() if line.startswith("Uid:"))
                birth = (entry / "stat").read_text().rsplit(") ", 1)[1].split()[19]
                # A dead pinned process may already have had its number reused.
                # pidfd_send_signal validates the pinned identity, not that number.
                signal.pidfd_send_signal(fd, 0)
                info = Path("/proc/self/fdinfo", str(fd)).read_text()
                bound_pid = next(int(line.split()[1]) for line in info.splitlines() if line.startswith("Pid:"))
                if bound_pid != pid:
                    raise ValueError("prototype_capture_inventory_unavailable")
                if uid in [int(value) for value in uids]:
                    pinned.append((pid, fd, birth))
                    fd = None
            except (ProcessLookupError, FileNotFoundError):
                pass  # vanished before qualification, never signalled
            finally:
                if fd is not None:
                    os.close(fd)
        return pinned
    except (OSError, ValueError, StopIteration, IndexError, AttributeError) as error:
        for _, fd, _ in pinned:
            os.close(fd)
        raise ValueError("prototype_capture_inventory_unavailable") from error


@contextlib.contextmanager
def capture_lock(uid):
    """Root-owned cross-process admission; an unsettled cleanup stays blocked."""
    directory = Path("/run/dpf-capture")
    st = directory.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o077:
        raise ValueError("prototype_capture_lock_unavailable")
    fd = os.open(str(directory / "worker.lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o077:
            raise ValueError("prototype_capture_lock_unavailable")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("prototype_capture_busy") from None
        if os.read(fd, 32):
            raise ValueError("prototype_capture_cleanup_unsettled")
        if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            raise ValueError("prototype_capture_inventory_unavailable")
        stale = pin_capture_processes(uid)
        for _, process_fd, _ in stale:
            os.close(process_fd)
        if stale:
            raise ValueError("prototype_capture_existing_worker")
        libc = ctypes.CDLL(None, use_errno=True)
        # Adopt orphaned grandchildren so detached browser processes can be reaped.
        if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
            raise ValueError("prototype_capture_subreaper_unavailable")
        yield fd
    finally:
        os.close(fd)  # releases flock; never remove the lock inode


async def _stop_child(child, uid):
    """Keep admission locked until every reserved-uid descendant is gone."""
    for _ in range(40):
        pinned = pin_capture_processes(uid)
        try:
            for pid, fd, _birth in pinned:
                try:
                    signal.pidfd_send_signal(fd, signal.SIGKILL)
                    if child is None or pid != child.pid:
                        try:
                            os.waitpid(pid, os.WNOHANG)
                        except ChildProcessError:
                            pass  # still parented by another dying family member
                except ProcessLookupError:
                    pass
        finally:
            for _, fd, _ in pinned:
                os.close(fd)
        if not pinned:
            if child is not None:
                await asyncio.wait_for(child.wait(), timeout=1)
            return
        await asyncio.sleep(0.025)
    raise ValueError("prototype_capture_cleanup_unsettled")


async def render_prototype(value, chrome_bin="/usr/bin/chromium", profiles_dir="/profiles"):
    source = validate_capture_request(value)
    uid, gid = capture_identity(profiles_dir)
    qualify_resource_boundary()
    if _slots.locked():
        return {"error": "prototype_capture_busy"}
    async with _slots:
        with capture_lock(uid) as lock_fd:
            home = tempfile.mkdtemp(prefix="dpf-prototype-")
            try:
                return await _render_owned(source, uid, gid, home, chrome_bin, lock_fd)
            finally:
                # _render_owned owns process cleanup. Its failure marks the lock
                # before propagating; never erase a directory still in use.
                if os.pread(lock_fd, 32, 0):
                    os.chown(home, 0, 0)
                    os.chmod(home, 0o700)
                else:
                    shutil.rmtree(home)


async def _render_owned(source, uid, gid, home, chrome_bin, lock_fd):
    # capture_lock remains held by the caller across cancellation and cleanup.
    child = None
    os.pwrite(lock_fd, b"unsettled\n", 0)
    os.fsync(lock_fd)
    try:
        os.chown(home, uid, gid)
        launch = asyncio.create_task(asyncio.create_subprocess_exec(
            sys.executable, str(Path(__file__).with_name("prototype_capture_worker.py")),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, cwd=home,
            env=child_environment(home, chrome_bin), user=uid, group=gid,
            extra_groups=(), start_new_session=True, close_fds=True,
        ))
        cancelled = False
        while not launch.done():
            try:
                await asyncio.shield(launch)
            except asyncio.CancelledError:
                cancelled = True
        child = launch.result()
        if cancelled:
            raise asyncio.CancelledError()
        async def exchange():
            child.stdin.write(json.dumps(source).encode("utf-8"))
            await child.stdin.drain()
            child.stdin.close()
            output = await child.stdout.read(MAX_REPLY_BYTES + 1)
            # read(n) may return a partial frame; retain a strictly bounded buffer.
            while len(output) <= MAX_REPLY_BYTES:
                more = await child.stdout.read(min(65536, MAX_REPLY_BYTES + 1 - len(output)))
                if not more:
                    break
                output += more
            if len(output) > MAX_REPLY_BYTES:
                raise ValueError("prototype_capture_output_size")
            await child.wait()
            if child.returncode != 0:
                raise ValueError("prototype_capture_renderer_unavailable")
            return validate_capture_result(json.loads(output), source)
        try:
            return await asyncio.wait_for(exchange(), timeout=CAPTURE_SECONDS)
        except asyncio.TimeoutError:
            return {"error": "prototype_capture_timeout"}
        except (ValueError, OSError):
            return {"error": "prototype_capture_renderer_unavailable"}
    finally:
        cleanup = asyncio.create_task(_stop_child(child, uid))
        cancelled = False
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                cancelled = True  # repeated cancellation cannot release admission
        cleanup.result()  # a failure keeps the persisted marker and directory
        os.ftruncate(lock_fd, 0)
        os.fsync(lock_fd)
        if cancelled:
            raise asyncio.CancelledError()
