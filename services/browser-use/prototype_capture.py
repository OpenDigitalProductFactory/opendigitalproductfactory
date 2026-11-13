"""Bounded offline rendering. This is separate from ordinary browse navigation.

The portal must qualify engagement/source authority before calling this transport.
It receives pixels internally; model-facing callers receive document references.
"""
import asyncio
import base64
import hashlib
import json
import os
import signal
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
    return {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": home,
            "XDG_CACHE_HOME": home, "CHROME_BIN": chrome_bin,
            "PYTHONUNBUFFERED": "1", "LANG": "C.UTF-8"}


def capture_identity(profiles_dir):
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
    st = os.lstat(profiles_dir)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o077:
        raise ValueError("prototype_capture_private_profiles_required")
    return account.pw_uid, account.pw_gid


async def _stop_child(child):
    # Reap descendants even when the worker leader already exited abnormally.
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    await child.wait()


async def render_prototype(value, chrome_bin="/usr/bin/chromium", profiles_dir="/profiles"):
    source = validate_capture_request(value)
    uid, gid = capture_identity(profiles_dir)
    if _slots.locked():
        return {"error": "prototype_capture_busy"}
    async with _slots:
        with tempfile.TemporaryDirectory(prefix="dpf-prototype-") as home:
            os.chown(home, uid, gid)
            child = await asyncio.create_subprocess_exec(
                sys.executable, str(Path(__file__).with_name("prototype_capture_worker.py")),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL, cwd=home,
                env=child_environment(home, chrome_bin), user=uid, group=gid,
                extra_groups=(), start_new_session=True,
            )
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
                await _stop_child(child)
