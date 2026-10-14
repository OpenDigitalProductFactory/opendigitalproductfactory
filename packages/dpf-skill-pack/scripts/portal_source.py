"""Pull the agent toolchain from a DPF portal, and prove it before running it.

BI-DE1E6485 (design docs/superpowers/specs/2026-10-07-agent-toolchain-release-delivery-design.md
§5.1 and §5.3). `update_agent_toolchain.py --from-portal <origin>` lands here.

The order is fixed, and every step fails closed:

1. The origin must be one this host already uses as a DPF connector (the
   shared copy's descriptor, Codex, Grok or Antigravity config, or
   DPF_MCP_URL), over https or loopback http. A host with no DPF connector yet
   is a first install, and the installer's own origin is accepted.
2. The manifest's Ed25519 signature must verify, and the signing key's device
   id must equal both `--expect-installation` (read by the agent from its own
   authenticated MCP connection) and this host's pin in
   ~/.dpf/trusted-installations.json. A changed identity is refused until the
   user approves it (`--approve-identity-change`).
3. Only then is the pack downloaded. Its sha256 must equal `archiveSha256`,
   it is extracted with path and link checks, and the extracted tree's
   delivered digest must equal `packDigest`.
4. The updater inside the verified pack is run, so the new code converges.
   The pin is written after it succeeds.

Standard library only (urllib, tarfile, hashlib), so it runs on the system
python3 on Windows, macOS and Linux.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Optional
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ed25519_verify  # noqa: E402

MANIFEST_PATH = "/api/agent-toolchain/manifest"
PACK_PATH = "/api/agent-toolchain/pack.tar.gz"
MAX_MANIFEST_BYTES = 1 << 20
MAX_PACK_BYTES = 64 << 20
MAX_EXTRACTED_BYTES = 256 << 20
FETCH_TIMEOUT_SECONDS = 60
DEVICE_ID_RE = re.compile(r"^did_[0-9a-f]{64}$")
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
SIGNATURE_FIELDS = ("deviceId", "signingPublicKey", "signature")
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
EXIT_REFUSED = 3
_TEMPLATE = re.compile(r"^\$\{DPF_MCP_URL:-([^}]+)\}$")
# Flags that select the portal path; the re-executed updater must not see them.
_PORTAL_FLAGS_WITH_VALUE = ("--from-portal", "--expect-installation", "--skill-pack-path", "--portal-manifest")
_PORTAL_FLAGS = ("--approve-identity-change",)


class PortalRefusal(Exception):
    """A check failed; nothing was extracted or run."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------- origins


def normalize_origin(value: str) -> str:
    """`scheme://host[:port]` for an http(s) origin; refuses a path, query or credentials."""
    try:
        parts = urlsplit(value.strip())
        port = parts.port
    except ValueError as error:
        raise PortalRefusal("bad_origin", f"{value!r} is not a valid origin") from error
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise PortalRefusal("bad_origin", f"{value!r} is not an http or https origin")
    if parts.username or parts.password or parts.query or parts.fragment or parts.path not in ("", "/"):
        raise PortalRefusal("bad_origin", f"{value!r} must be an origin only, with no path, query or credentials")
    return _origin(parts.scheme, parts.hostname, port)


def _origin(scheme: str, hostname: str, port: Optional[int]) -> str:
    host = hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    default = 443 if scheme == "https" else 80
    return f"{scheme}://{host}" if port in (None, default) else f"{scheme}://{host}:{port}"


def origin_of_endpoint(url: object) -> Optional[str]:
    """The origin of a connector URL (a `${DPF_MCP_URL:-…}` template yields its default)."""
    if not isinstance(url, str) or not url.strip():
        return None
    match = _TEMPLATE.match(url.strip())
    try:
        parts = urlsplit(match.group(1) if match else url.strip())
        if parts.scheme not in ("http", "https") or not parts.hostname:
            return None
        return _origin(parts.scheme, parts.hostname, parts.port)
    except ValueError:
        return None


def transport_allowed(origin: str) -> bool:
    parts = urlsplit(origin)
    return parts.scheme == "https" or (parts.scheme == "http" and (parts.hostname or "") in LOOPBACK_HOSTS)


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None


def _toml_dpf_url(path: Path) -> Optional[str]:
    import update_agent_toolchain as updater

    try:
        return updater.existing_codex_mcp_endpoint(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None


def _dpf_server_url(data: Any) -> Optional[object]:
    servers = data.get("mcpServers") if isinstance(data, dict) else None
    server = servers.get("dpf") if isinstance(servers, dict) else None
    return server.get("url") if isinstance(server, dict) else None


def configured_origins(home: Path, env: Mapping[str, str]) -> list[str]:
    """Every DPF connector origin this host is already configured for."""
    import update_agent_toolchain as updater

    urls: list[object] = [env.get("DPF_MCP_URL")]
    shared = updater.shared_managed_plugin_path(home)
    for path in (shared / "claude.mcp.json", shared / "antigravity.mcp.json",
                 updater.antigravity_mcp_config_path(home)):
        urls.append(_dpf_server_url(_read_json(path)))
    urls.append(_toml_dpf_url(updater.codex_config_path(home)))
    urls.append(_toml_dpf_url(home / ".grok" / "config.toml"))
    origins: list[str] = []
    for url in urls:
        origin = origin_of_endpoint(url)
        if origin and origin not in origins:
            origins.append(origin)
    return origins


# ---------------------------------------------------------------- signature


def _code_unit_key(key: str) -> bytes:
    # UTF-16 code-unit order, as canonicalJson sorts in JavaScript.
    return key.encode("utf-16-be", "surrogatepass")


def canonical_json(value: Any) -> str:
    """Byte-identical to canonicalJson in @dpf/integration-shared for JSON data."""
    if isinstance(value, dict):
        items = sorted(((k, v) for k, v in value.items()), key=lambda item: _code_unit_key(item[0]))
        return "{" + ",".join(f"{json.dumps(k, ensure_ascii=False)}:{canonical_json(v)}" for k, v in items) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(entry) for entry in value) + "]"
    if isinstance(value, float) and value.is_integer() and abs(value) < 1e21:
        return str(int(value))
    return json.dumps(value, ensure_ascii=False)


def verify_manifest(manifest: Any, expected_device_id: str) -> None:
    """Refuse unless the manifest is signed by the expected installation."""
    if not isinstance(manifest, dict):
        raise PortalRefusal("manifest_invalid", "the portal manifest is not a JSON object")
    for field in SIGNATURE_FIELDS:
        if not isinstance(manifest.get(field), str) or not manifest[field]:
            raise PortalRefusal("unsigned", f"the portal manifest has no {field}; an unsigned toolchain is never run")
    for field in ("packDigest", "archiveSha256"):
        if not isinstance(manifest.get(field), str) or not HEX64_RE.match(manifest[field]):
            raise PortalRefusal("manifest_invalid", f"the portal manifest has no valid {field}")
    if not isinstance(manifest.get("packVersion"), str):
        raise PortalRefusal("manifest_invalid", "the portal manifest has no packVersion")
    try:
        spki = base64.b64decode(manifest["signingPublicKey"], validate=True)
        signature = base64.b64decode(manifest["signature"], validate=True)
    except (binascii.Error, ValueError) as error:
        raise PortalRefusal("bad_signature", "the manifest signature or key is not valid base64") from error
    public_key = ed25519_verify.public_key_from_spki(spki)
    if public_key is None:
        raise PortalRefusal("bad_signature", "the manifest signing key is not an Ed25519 public key")
    signer = ed25519_verify.device_id(spki)
    if signer != manifest["deviceId"]:
        raise PortalRefusal("identity_mismatch", "the manifest device id does not match its signing key")
    if signer != expected_device_id:
        raise PortalRefusal(
            "identity_mismatch",
            f"the portal is signed by {signer}, not by the installation this session is connected to "
            f"({expected_device_id})",
        )
    unsigned = {key: value for key, value in manifest.items() if key not in SIGNATURE_FIELDS}
    try:
        message = canonical_json(unsigned).encode("utf-8")
    except UnicodeEncodeError as error:
        raise PortalRefusal("bad_signature", "the manifest cannot be put in canonical form") from error
    if not ed25519_verify.verify(public_key, message, signature):
        raise PortalRefusal("bad_signature", "the manifest signature does not verify")


# ---------------------------------------------------------------- trust pins


def trust_store_path(home: Path) -> Path:
    return home / ".dpf" / "trusted-installations.json"


def read_pins(home: Path) -> dict[str, str]:
    data = _read_json(trust_store_path(home))
    installations = data.get("installations") if isinstance(data, dict) else None
    if not isinstance(installations, dict):
        return {}
    return {
        origin: entry["deviceId"]
        for origin, entry in installations.items()
        if isinstance(entry, dict) and isinstance(entry.get("deviceId"), str)
    }


def check_pin(home: Path, origin: str, expected_device_id: str, approve_change: bool) -> None:
    pinned = read_pins(home).get(origin)
    if pinned and pinned != expected_device_id and not approve_change:
        raise PortalRefusal(
            "identity_changed",
            f"this portal's identity changed (pinned {pinned}, now {expected_device_id}). Ask the user: "
            "\"This portal's identity changed; update anyway?\" and rerun with --approve-identity-change only "
            "if they agree",
        )


def record_pin(home: Path, origin: str, device_id: str) -> None:
    path = trust_store_path(home)
    data = _read_json(path)
    if not isinstance(data, dict) or not isinstance(data.get("installations"), dict):
        data = {"installations": {}}
    data["installations"][origin] = {
        "deviceId": device_id,
        "pinnedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp{os.getpid()}")
    tmp.write_bytes((json.dumps(data, indent=2) + "\n").encode("utf-8"))
    os.replace(tmp, path)


# ---------------------------------------------------------------- transport


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise PortalRefusal("redirected", f"the portal redirected to {newurl}; redirects are not followed")


def _ssl_context(home: Path, env: Mapping[str, str]) -> ssl.SSLContext:
    context = ssl.create_default_context()
    for candidate in (env.get("DPF_PKI_TRUST_BUNDLE"), env.get("NODE_EXTRA_CA_CERTS"),
                      str(home / ".dpf" / "pki" / "root_ca.crt")):
        if candidate and Path(candidate).is_file():
            try:
                context.load_verify_locations(cafile=candidate)
            except (OSError, ssl.SSLError):
                continue
    return context


def fetch(url: str, limit: int, home: Path, env: Mapping[str, str]) -> bytes:
    host = urlsplit(url).hostname or ""
    handlers: list[Any] = [_NoRedirect(), urllib.request.HTTPSHandler(context=_ssl_context(home, env))]
    if host in LOOPBACK_HOSTS:
        handlers.append(urllib.request.ProxyHandler({}))
    opener = urllib.request.build_opener(*handlers)
    request = urllib.request.Request(url, headers={"User-Agent": "dpf-agent-toolchain-updater"})
    try:
        with opener.open(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
            body = response.read(limit + 1)
    except PortalRefusal:
        raise
    except urllib.error.HTTPError as error:
        raise PortalRefusal("unreachable", f"{url} answered HTTP {error.code}") from error
    except (urllib.error.URLError, OSError, ssl.SSLError) as error:
        raise PortalRefusal("unreachable", f"cannot reach {url}: {error}") from error
    if len(body) > limit:
        raise PortalRefusal("too_large", f"{url} is larger than {limit} bytes")
    return body


# ---------------------------------------------------------------- archive


def _safe_segments(name: str) -> list[str]:
    if not name or "\\" in name or name.startswith("/") or "\0" in name:
        raise PortalRefusal("unsafe_archive", f"archive entry {name!r} has an unsafe path")
    segments = name.rstrip("/").split("/")
    for segment in segments:
        if segment in ("", ".", "..") or ":" in segment:
            raise PortalRefusal("unsafe_archive", f"archive entry {name!r} has an unsafe path")
    return segments


def safe_extract(archive: bytes, destination: Path) -> int:
    """Extract regular files only, each inside `destination`. Returns the file count."""
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    seen: set[str] = set()
    total = 0
    try:
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
            for member in tar:
                segments = _safe_segments(member.name)
                target = root.joinpath(*segments)
                if os.path.commonpath([str(root), str(target.resolve())]) != str(root):
                    raise PortalRefusal("unsafe_archive", f"archive entry {member.name!r} escapes the pack")
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                if not member.isfile():
                    raise PortalRefusal("unsafe_archive", f"archive entry {member.name!r} is not a regular file")
                key = "/".join(segments)
                if key in seen:
                    raise PortalRefusal("unsafe_archive", f"archive entry {member.name!r} appears twice")
                seen.add(key)
                total += member.size
                if total > MAX_EXTRACTED_BYTES:
                    raise PortalRefusal("unsafe_archive", "the pack expands past the size limit")
                source = tar.extractfile(member)
                if source is None:
                    raise PortalRefusal("unsafe_archive", f"archive entry {member.name!r} cannot be read")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read())
                if os.name != "nt" and member.mode & 0o111:
                    target.chmod(0o755)
    except (tarfile.TarError, OSError, EOFError) as error:
        raise PortalRefusal("unsafe_archive", f"the pack is not a readable archive: {error}") from error
    return len(seen)


def fetch_verified_pack(
    origin: str, expected_device_id: str, workdir: Path, home: Path, env: Mapping[str, str]
) -> tuple[dict[str, Any], Path]:
    """Fetch, authenticate, download, check and extract. Returns (manifest, pack dir)."""
    try:
        manifest = json.loads(fetch(origin + MANIFEST_PATH, MAX_MANIFEST_BYTES, home, env).decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise PortalRefusal("manifest_invalid", "the portal manifest is not JSON") from error
    verify_manifest(manifest, expected_device_id)
    archive = fetch(origin + PACK_PATH, MAX_PACK_BYTES, home, env)
    if hashlib.sha256(archive).hexdigest() != manifest["archiveSha256"]:
        raise PortalRefusal("archive_mismatch", "the downloaded pack's sha256 does not match archiveSha256")
    pack = workdir / "pack"
    safe_extract(archive, pack)
    from installed_copy_freshness import delivered_digest

    if delivered_digest(pack) != manifest["packDigest"]:
        raise PortalRefusal("digest_mismatch", "the extracted pack's delivered digest does not match packDigest")
    if not (pack / "scripts" / "update_agent_toolchain.py").is_file():
        raise PortalRefusal("manifest_invalid", "the verified pack carries no updater")
    return manifest, pack


# ---------------------------------------------------------------- run


def child_argv(argv: list[str]) -> list[str]:
    """The caller's arguments minus the ones that select and authorize the portal path."""
    out: list[str] = []
    skip = False
    for token in argv:
        if skip:
            skip = False
            continue
        if token in _PORTAL_FLAGS:
            continue
        if token in _PORTAL_FLAGS_WITH_VALUE:
            skip = True
            continue
        if any(token.startswith(flag + "=") for flag in _PORTAL_FLAGS_WITH_VALUE):
            continue
        out.append(token)
    return out


def _write_refusal(report_path: Optional[str], origin: str, refusal: PortalRefusal) -> None:
    if not report_path:
        return
    payload = {
        "schemaVersion": 1,
        "source": {"kind": "portal", "origin": origin},
        "result": "refused",
        "refusal": {"code": refusal.code, "reason": refusal.message},
        "clients": [],
    }
    Path(report_path).write_bytes((json.dumps(payload, indent=2) + "\n").encode("utf-8"))


def run_from_portal(
    args: Any,
    argv: list[str],
    home: Path,
    env: Mapping[str, str],
    runner: Callable[..., Any] = subprocess.run,
) -> int:
    """Verify the portal's toolchain, then run the updater it ships."""
    origin = str(args.from_portal)
    try:
        origin = normalize_origin(origin)
        if not transport_allowed(origin):
            raise PortalRefusal("insecure_origin", f"{origin} is neither https nor a loopback address")
        expected = (args.expect_installation or "").strip()
        if not DEVICE_ID_RE.match(expected):
            raise PortalRefusal(
                "no_expected_identity",
                "--expect-installation did_<64 hex> is required: the device id from this session's "
                "authenticated DPF connection",
            )
        configured = configured_origins(home, env)
        if configured and origin not in configured:
            raise PortalRefusal(
                "untrusted_origin",
                f"{origin} is not a DPF connector origin this host already uses ({', '.join(configured)})",
            )
        check_pin(home, origin, expected, bool(args.approve_identity_change))
        workdir = Path(tempfile.mkdtemp(prefix="dpf-toolchain-"))
        try:
            manifest, pack = fetch_verified_pack(origin, expected, workdir, home, env)
            manifest_file = workdir / "manifest.json"
            manifest_file.write_bytes(json.dumps(manifest).encode("utf-8"))
            print(f"Verified the DPF toolchain {manifest['packVersion']} from {origin} "
                  f"(signed by {expected}); running its updater.")
            command = [sys.executable, str(pack / "scripts" / "update_agent_toolchain.py"),
                       *child_argv(argv), "--skill-pack-path", str(pack), "--portal-manifest", str(manifest_file)]
            if not getattr(args, "mcp_url", None) and isinstance(manifest.get("mcpEndpoint"), str):
                command += ["--mcp-url", manifest["mcpEndpoint"]]
            completed = runner(command)
            code = int(getattr(completed, "returncode", 1))
            if code == 0 and not args.dry_run:
                record_pin(home, origin, expected)
            return code
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
    except PortalRefusal as refusal:
        print(f"Refused: {refusal.message}. Nothing was downloaded into place or run; "
              f"the installed toolchain is unchanged. ({refusal.code})", file=sys.stderr)
        _write_refusal(getattr(args, "report_json", None), origin, refusal)
        return EXIT_REFUSED
