"""BI-DE1E6485: --from-portal verifies before it runs anything.

Covers the pure-Python Ed25519 check (RFC 8032 vectors), the canonical form
shared with the portal, origin and pin rules, safe extraction, and the
end-to-end path against a local http.server serving a signed manifest and
pack: good signature, bad signature, wrong installation, digest and archive
mismatch, path traversal, untrusted origin and a changed identity.
"""

from __future__ import annotations

import base64
import hashlib
import http.server
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Optional
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ed25519_verify  # noqa: E402
import portal_source  # noqa: E402
import update_agent_toolchain as updater  # noqa: E402
from installed_copy_freshness import delivered_digest  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
SHARED_FIXTURE = REPO / "apps" / "web" / "lib" / "agent-toolchain" / "__fixtures__" / "signed-toolchain-manifest.json"

# RFC 8032 section 7.1, tests 1-3: (secret seed, public key, message, signature).
RFC8032 = (
    ("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
     "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "",
     "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"),
    ("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
     "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "72",
     "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00"),
    ("c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
     "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025", "af82",
     "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a"),
)
SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")


def _sign(seed: bytes, message: bytes) -> tuple[bytes, bytes]:
    """RFC 8032 signing, for fixtures only. Returns (public key, signature)."""
    digest = hashlib.sha512(seed).digest()
    scalar = int.from_bytes(digest[:32], "little")
    scalar &= (1 << 254) - 8
    scalar |= 1 << 254
    public = ed25519_verify._encode(ed25519_verify._multiply(scalar, ed25519_verify.BASE))
    r = int.from_bytes(hashlib.sha512(digest[32:] + message).digest(), "little") % ed25519_verify.GROUP_ORDER
    big_r = ed25519_verify._encode(ed25519_verify._multiply(r, ed25519_verify.BASE))
    k = int.from_bytes(hashlib.sha512(big_r + public + message).digest(), "little") % ed25519_verify.GROUP_ORDER
    s = (r + k * scalar) % ed25519_verify.GROUP_ORDER
    return public, big_r + s.to_bytes(32, "little")


SEED = bytes.fromhex(RFC8032[0][0])
OTHER_SEED = bytes.fromhex(RFC8032[1][0])


def signed_manifest(unsigned: dict[str, Any], seed: bytes = SEED) -> dict[str, Any]:
    public, _ = _sign(seed, b"")
    spki = SPKI_PREFIX + public
    _, signature = _sign(seed, portal_source.canonical_json(unsigned).encode("utf-8"))
    return {**unsigned, "deviceId": ed25519_verify.device_id(spki),
            "signingPublicKey": base64.b64encode(spki).decode(), "signature": base64.b64encode(signature).decode()}


def device_of(seed: bytes) -> str:
    public, _ = _sign(seed, b"")
    return ed25519_verify.device_id(SPKI_PREFIX + public)


class Ed25519Test(unittest.TestCase):
    def test_rfc8032_vectors_verify_and_tampering_fails(self) -> None:
        for seed, public, message, signature in RFC8032:
            with self.subTest(public=public[:8]):
                pub, msg, sig = bytes.fromhex(public), bytes.fromhex(message), bytes.fromhex(signature)
                self.assertTrue(ed25519_verify.verify(pub, msg, sig))
                self.assertFalse(ed25519_verify.verify(pub, msg + b"x", sig))
                self.assertFalse(ed25519_verify.verify(pub, msg, sig[:63] + bytes([sig[63] ^ 1])))
                self.assertEqual(_sign(bytes.fromhex(seed), msg), (pub, sig))

    def test_rejects_malformed_inputs(self) -> None:
        _, public, message, signature = RFC8032[0]
        pub, sig = bytes.fromhex(public), bytes.fromhex(signature)
        self.assertFalse(ed25519_verify.verify(pub[:31], b"", sig))
        self.assertFalse(ed25519_verify.verify(pub, b"", sig[:63]))
        too_big_s = (int.from_bytes(sig[32:], "little") + ed25519_verify.GROUP_ORDER).to_bytes(32, "little")
        self.assertFalse(ed25519_verify.verify(pub, b"", sig[:32] + too_big_s))
        self.assertFalse(ed25519_verify.verify(b"\xff" * 32, b"", sig))

    def test_spki_and_device_id(self) -> None:
        raw = bytes.fromhex(RFC8032[0][1])
        self.assertEqual(ed25519_verify.public_key_from_spki(SPKI_PREFIX + raw), raw)
        self.assertIsNone(ed25519_verify.public_key_from_spki(b"\x30" + raw))
        self.assertRegex(ed25519_verify.device_id(SPKI_PREFIX + raw), r"^did_[0-9a-f]{64}$")


class CanonicalJsonTest(unittest.TestCase):
    def test_sorts_by_code_unit_and_keeps_non_ascii(self) -> None:
        self.assertEqual(portal_source.canonical_json({"b": 1, "a": [True, None], "10": "é", "2": {}}),
                         '{"10":"é","2":{},"a":[true,null],"b":1}')

    @unittest.skipUnless(SHARED_FIXTURE.is_file(), "the portal fixture ships with the source repo only")
    def test_verifies_the_manifest_the_portal_code_signed(self) -> None:
        manifest = json.loads(SHARED_FIXTURE.read_text(encoding="utf-8"))
        portal_source.verify_manifest(manifest, manifest["deviceId"])
        with self.assertRaises(portal_source.PortalRefusal):
            portal_source.verify_manifest({**manifest, "releaseId": "other"}, manifest["deviceId"])


class OriginTest(unittest.TestCase):
    def test_normalizes_and_refuses_non_origins(self) -> None:
        self.assertEqual(portal_source.normalize_origin("HTTPS://Dpf.Example:443/"), "https://dpf.example")
        self.assertEqual(portal_source.normalize_origin("http://127.0.0.1:3000"), "http://127.0.0.1:3000")
        for bad in ("https://dpf.example/api", "ftp://dpf.example", "https://u:p@dpf.example", "https://x?y=1"):
            with self.subTest(bad=bad), self.assertRaises(portal_source.PortalRefusal):
                portal_source.normalize_origin(bad)

    def test_https_or_loopback_only(self) -> None:
        self.assertTrue(portal_source.transport_allowed("https://dpf.example"))
        self.assertTrue(portal_source.transport_allowed("http://localhost:3000"))
        self.assertFalse(portal_source.transport_allowed("http://dpf.example"))

    def test_configured_origins_come_from_the_host_connectors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            shared = updater.shared_managed_plugin_path(home)
            shared.mkdir(parents=True)
            (shared / "claude.mcp.json").write_text(json.dumps(
                {"mcpServers": {"dpf": {"url": "${DPF_MCP_URL:-https://dpf.example/api/mcp/v1?tier=full}"}}}))
            codex = updater.codex_config_path(home)
            codex.parent.mkdir(parents=True)
            codex.write_text('[mcp_servers.dpf]\nurl = "https://localhost/api/mcp/v1?tier=full"\n')
            origins = portal_source.configured_origins(home, {"DPF_MCP_URL": "https://other.example:8443/api/mcp/v1"})
        self.assertEqual(origins, ["https://other.example:8443", "https://dpf.example", "https://localhost"])

    def test_configured_origins_read_agy_serverurl_entries(self) -> None:
        # agy writes serverUrl, not url (BI-4CB3C923).
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            cfg = updater.antigravity_mcp_config_path(home)
            cfg.parent.mkdir(parents=True)
            cfg.write_text(json.dumps({"mcpServers": {"dpf": {"serverUrl": "https://agy.example/api/mcp/v1", "disabled": False}}}))
            origins = portal_source.configured_origins(home, {})
        self.assertEqual(origins, ["https://agy.example"])


def _tar(entries: list[tuple[str, bytes, bytes]]) -> bytes:
    """entries: (name, type flag, bytes or link target)."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, kind, data in entries:
            info = tarfile.TarInfo(name)
            info.type = kind
            if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                info.linkname = data.decode()
                tar.addfile(info)
            else:
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


class SafeExtractTest(unittest.TestCase):
    def test_extracts_regular_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            count = portal_source.safe_extract(_tar([("a/b.txt", tarfile.REGTYPE, b"x")]), Path(tmp) / "out")
            self.assertEqual(count, 1)
            self.assertEqual((Path(tmp) / "out" / "a" / "b.txt").read_bytes(), b"x")

    def test_refuses_traversal_absolute_and_links(self) -> None:
        cases = {
            "parent": [("../escape.txt", tarfile.REGTYPE, b"x")],
            "nested parent": [("a/../../escape.txt", tarfile.REGTYPE, b"x")],
            "absolute": [("/tmp/escape.txt", tarfile.REGTYPE, b"x")],
            "drive": [("C:/escape.txt", tarfile.REGTYPE, b"x")],
            "backslash": [("a\\..\\escape.txt", tarfile.REGTYPE, b"x")],
            "symlink": [("link", tarfile.SYMTYPE, b"/etc/passwd")],
            "hardlink": [("link", tarfile.LNKTYPE, b"a.txt")],
            "duplicate": [("a.txt", tarfile.REGTYPE, b"x"), ("a.txt", tarfile.REGTYPE, b"y")],
        }
        for label, entries in cases.items():
            with self.subTest(label), tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(portal_source.PortalRefusal) as caught:
                    portal_source.safe_extract(_tar(entries), Path(tmp) / "out")
                self.assertEqual(caught.exception.code, "unsafe_archive")
                self.assertFalse((Path(tmp) / "escape.txt").exists())


FAKE_UPDATER = """import json, os, sys
open(os.environ["DPF_TEST_CHILD_OUT"], "w").write(json.dumps(sys.argv[1:]))
"""


def _fixture_pack(root: Path) -> Path:
    pack = root / "fixture-pack"
    (pack / "scripts").mkdir(parents=True)
    (pack / "scripts" / "update_agent_toolchain.py").write_text(FAKE_UPDATER)
    (pack / "toolchain-version.json").write_text('{"packVersion": "0.3.0"}\n')
    (pack / "skills").mkdir()
    (pack / "skills" / "README.md").write_text("skills\n")
    return pack


def _pack_archive(pack: Path) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for path in sorted(p for p in pack.rglob("*") if p.is_file()):
            tar.add(str(path), arcname=path.relative_to(pack).as_posix())
    return buffer.getvalue()


class _Portal:
    """A local portal serving a manifest and a pack."""

    def __init__(self, routes: dict[str, bytes]) -> None:
        self.routes = routes
        portal = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                body = portal.routes.get(self.path)
                self.send_response(200 if body is not None else 404)
                self.end_headers()
                if body is not None:
                    self.wfile.write(body)

            def log_message(self, *args: Any) -> None:
                return

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


class FromPortalEndToEndTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.pack = _fixture_pack(self.root)
        self.archive = _pack_archive(self.pack)
        self.unsigned = {
            "schemaVersion": 1, "packVersion": "0.3.0", "packDigest": delivered_digest(self.pack),
            "archiveSha256": hashlib.sha256(self.archive).hexdigest(), "releaseId": "r1",
            "mcpEndpoint": "", "floor": {"minPackVersion": None, "graceStartsAt": None},
            "clients": {}, "updater": {"path": "scripts/update_agent_toolchain.py"},
        }
        self.portal = _Portal({})
        self.unsigned["mcpEndpoint"] = f"{self.portal.origin}/api/mcp/v1"
        self.serve(signed_manifest(self.unsigned), self.archive)
        self.child_out = self.root / "child.json"
        self.report = self.root / "report.json"
        self.env = {"DPF_MCP_URL": f"{self.portal.origin}/api/mcp/v1?tier=full"}

    def tearDown(self) -> None:
        self.portal.close()
        self.tmp.cleanup()

    def serve(self, manifest: dict[str, Any], archive: bytes) -> None:
        self.portal.routes = {portal_source.MANIFEST_PATH: json.dumps(manifest).encode(),
                              portal_source.PACK_PATH: archive}

    def run_portal(self, expect: Optional[str] = None, origin: Optional[str] = None,
                   approve: bool = False, env: Optional[dict[str, str]] = None) -> int:
        argv = ["--from-portal", origin or self.portal.origin, "--expect-installation", expect or device_of(SEED),
                "--report-json", str(self.report), "--skip-codex-cli-install"]
        args = SimpleNamespace(from_portal=origin or self.portal.origin, expect_installation=expect or device_of(SEED),
                               approve_identity_change=approve, report_json=str(self.report), mcp_url=None, dry_run=False)
        child_env = {**os.environ, "DPF_TEST_CHILD_OUT": str(self.child_out)}

        def runner(command: list[str]) -> Any:
            return subprocess.run(command, env=child_env)

        with patch("builtins.print"):
            return portal_source.run_from_portal(args, argv, self.home, self.env if env is None else env, runner)

    def refusal(self) -> str:
        return json.loads(self.report.read_text())["refusal"]["code"]

    def assert_nothing_ran(self) -> None:
        self.assertFalse(self.child_out.exists())
        self.assertEqual(portal_source.read_pins(self.home), {})

    def test_good_signature_runs_the_verified_updater_and_pins_the_identity(self) -> None:
        self.assertEqual(self.run_portal(), 0)
        child = json.loads(self.child_out.read_text())
        self.assertNotIn("--from-portal", child)
        self.assertNotIn("--expect-installation", child)
        self.assertIn("--skip-codex-cli-install", child)
        self.assertEqual(child[child.index("--report-json") + 1], str(self.report))
        self.assertEqual(child[child.index("--mcp-url") + 1], self.unsigned["mcpEndpoint"])
        self.assertIn("--portal-manifest", child)
        self.assertEqual(Path(child[child.index("--skill-pack-path") + 1]).name, "pack")
        self.assertEqual(portal_source.read_pins(self.home), {self.portal.origin: device_of(SEED)})

    def test_bad_signature_is_refused(self) -> None:
        manifest = signed_manifest(self.unsigned)
        manifest["packVersion"] = "9.9.9"
        self.serve(manifest, self.archive)
        self.assertEqual(self.run_portal(), portal_source.EXIT_REFUSED)
        self.assertEqual(self.refusal(), "bad_signature")
        self.assert_nothing_ran()

    def test_unsigned_manifest_is_refused(self) -> None:
        self.serve(self.unsigned, self.archive)
        self.assertEqual(self.run_portal(), portal_source.EXIT_REFUSED)
        self.assertEqual(self.refusal(), "unsigned")
        self.assert_nothing_ran()

    def test_wrong_installation_is_refused(self) -> None:
        self.serve(signed_manifest(self.unsigned, OTHER_SEED), self.archive)
        self.assertEqual(self.run_portal(), portal_source.EXIT_REFUSED)
        self.assertEqual(self.refusal(), "identity_mismatch")
        self.assert_nothing_ran()

    def test_archive_hash_mismatch_is_refused(self) -> None:
        self.serve(signed_manifest({**self.unsigned, "archiveSha256": "0" * 64}), self.archive)
        self.assertEqual(self.run_portal(), portal_source.EXIT_REFUSED)
        self.assertEqual(self.refusal(), "archive_mismatch")
        self.assert_nothing_ran()

    def test_tree_digest_mismatch_is_refused(self) -> None:
        self.serve(signed_manifest({**self.unsigned, "packDigest": "0" * 64}), self.archive)
        self.assertEqual(self.run_portal(), portal_source.EXIT_REFUSED)
        self.assertEqual(self.refusal(), "digest_mismatch")
        self.assert_nothing_ran()

    def test_path_traversal_in_a_correctly_signed_archive_is_refused(self) -> None:
        archive = _tar([("../../escape.txt", tarfile.REGTYPE, b"owned")])
        self.serve(signed_manifest({**self.unsigned, "archiveSha256": hashlib.sha256(archive).hexdigest()}), archive)
        self.assertEqual(self.run_portal(), portal_source.EXIT_REFUSED)
        self.assertEqual(self.refusal(), "unsafe_archive")
        self.assert_nothing_ran()

    def test_origin_not_configured_on_this_host_is_refused(self) -> None:
        env = {"DPF_MCP_URL": "https://dpf.example/api/mcp/v1?tier=full"}
        self.assertEqual(self.run_portal(env=env), portal_source.EXIT_REFUSED)
        self.assertEqual(self.refusal(), "untrusted_origin")
        self.assert_nothing_ran()

    def test_first_install_with_no_configured_origin_is_accepted(self) -> None:
        self.assertEqual(self.run_portal(env={}), 0)
        self.assertTrue(self.child_out.exists())

    def test_plain_http_off_loopback_is_refused(self) -> None:
        self.assertEqual(self.run_portal(origin="http://dpf.example"), portal_source.EXIT_REFUSED)
        self.assertEqual(self.refusal(), "insecure_origin")

    def test_missing_expected_installation_is_refused(self) -> None:
        self.assertEqual(self.run_portal(expect="did_a192…199d"), portal_source.EXIT_REFUSED)
        self.assertEqual(self.refusal(), "no_expected_identity")

    def test_changed_identity_needs_the_users_approval(self) -> None:
        portal_source.record_pin(self.home, self.portal.origin, device_of(OTHER_SEED))
        self.assertEqual(self.run_portal(), portal_source.EXIT_REFUSED)
        self.assertEqual(self.refusal(), "identity_changed")
        self.assertFalse(self.child_out.exists())
        self.assertEqual(self.run_portal(approve=True), 0)
        self.assertEqual(portal_source.read_pins(self.home), {self.portal.origin: device_of(SEED)})


class ChildArgvTest(unittest.TestCase):
    def test_preserves_client_selection_and_preview(self) -> None:
        for selector in ("--codex-only", "--claude-only"):
            with self.subTest(selector=selector):
                self.assertEqual(portal_source.child_argv([
                    "--from-portal", "https://x", "--expect-installation", "did_1",
                    selector, "--dry-run", "--project-root", "/repo",
                ]), [selector, "--dry-run", "--project-root", "/repo"])

    def test_strips_portal_flags_in_both_spellings(self) -> None:
        argv = ["--from-portal", "https://x", "--expect-installation=did_1", "--approve-identity-change",
                "--skill-pack-path", "/p", "--dry-run", "--report-json", "r.json"]
        self.assertEqual(portal_source.child_argv(argv), ["--dry-run", "--report-json", "r.json"])


if __name__ == "__main__":
    unittest.main()
