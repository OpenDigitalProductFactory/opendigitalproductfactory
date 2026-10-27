"""BI-4F9E3221 (S1 of BI-63672FBE): the delivered version carries a content digest.

Claude Code keys its plugin cache by version string, so a pack change merged
without a manual packVersion bump left every Claude cache on the old bytes: 29
of 39 pack commits since 2026-10-08 merged under an already-published version.
A spike on Claude Code 2.1.197 (spec 2026-10-27-self-converging-agent-toolchain
§3.1) showed any change of version string refreshes the cache, build metadata
included. So the updater stamps `<packVersion>+c.<digest12>` into every client
manifest it delivers, and the digest ignores the stamped value.

Every case builds a fake HOME; nothing reads the real one.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import installed_copy_freshness as freshness  # noqa: E402
import toolchain_convergence as convergence  # noqa: E402
import update_agent_toolchain as updater  # noqa: E402

CLIENT_MANIFESTS = (".claude-plugin", ".grok-plugin", ".antigravity-plugin")


def write_pack(root: Path, version: str = "0.2.18", skill: str = "v1") -> Path:
    pack = root / "pack"
    for client in CLIENT_MANIFESTS:
        target = pack / client / "plugin.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        # Hand-formatted on purpose: stamping must preserve every other byte.
        target.write_text('{\n  "name": "dpf-platform",\n  "version": "%s",\n  "description": "x"\n}\n' % version)
    updater.write_json(pack / ".codex-plugin" / "plugin.json", {"name": "dpf-platform", "version": f"{version}+codex.repo"})
    updater.write_json(pack / "toolchain-version.json", {"packVersion": version, "floor": {"minPackVersion": None, "graceStartsAt": None}})
    (pack / "skills" / "hello").mkdir(parents=True)
    (pack / "skills" / "hello" / "SKILL.md").write_text(f"---\nname: hello\n---\n{skill}\n")
    return pack


class DeliveredVersionTest(unittest.TestCase):
    def test_delivered_version_is_the_base_version_plus_a_twelve_hex_digest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pack = write_pack(Path(tmp))
            version = freshness.delivered_version(pack)
            self.assertEqual(version, f"0.2.18+c.{freshness.delivered_digest(pack)[:12]}")

    def test_one_changed_byte_at_the_same_base_version_changes_the_delivered_version(self) -> None:
        with tempfile.TemporaryDirectory() as one, tempfile.TemporaryDirectory() as two:
            first = freshness.delivered_version(write_pack(Path(one), skill="v1"))
            second = freshness.delivered_version(write_pack(Path(two), skill="v2"))
        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith("0.2.18+c.") and second.startswith("0.2.18+c."))

    def test_stamping_does_not_change_the_delivered_digest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pack = write_pack(Path(tmp))
            before = freshness.delivered_digest(pack)
            updater.stamp_delivered_version(pack, "0.2.18+c.abcdefabcdef")
            self.assertEqual(freshness.delivered_digest(pack), before)

    def test_a_real_manifest_change_still_changes_the_digest(self) -> None:
        # F1 was a plugin.json change (a duplicate hooks entry). Ignoring the
        # version value must not hide the rest of the manifest.
        with tempfile.TemporaryDirectory() as tmp:
            pack = write_pack(Path(tmp))
            before = freshness.delivered_digest(pack)
            manifest = pack / ".claude-plugin" / "plugin.json"
            manifest.write_text(manifest.read_text().replace('"description": "x"', '"description": "y"'))
            self.assertNotEqual(freshness.delivered_digest(pack), before)

    def test_stamping_rewrites_only_the_version_value_of_every_client_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pack = write_pack(Path(tmp))
            originals = {client: (pack / client / "plugin.json").read_text() for client in CLIENT_MANIFESTS}
            updater.stamp_delivered_version(pack, "0.2.18+c.abcdefabcdef")
            for client in CLIENT_MANIFESTS:
                text = (pack / client / "plugin.json").read_text()
                self.assertEqual(json.loads(text)["version"], "0.2.18+c.abcdefabcdef")
                self.assertEqual(text, originals[client].replace('"0.2.18"', '"0.2.18+c.abcdefabcdef"'))
            # Codex keeps its own +codex.<digest> suffix (#5541); stamping leaves it alone.
            self.assertEqual(updater.read_json(pack / ".codex-plugin" / "plugin.json", {})["version"], "0.2.18+codex.repo")

    def test_restamping_a_stamped_manifest_replaces_the_old_stamp(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pack = write_pack(Path(tmp))
            updater.stamp_delivered_version(pack, "0.2.18+c.111111111111")
            updater.stamp_delivered_version(pack, "0.2.18+c.222222222222")
            self.assertEqual(updater.read_json(pack / ".claude-plugin" / "plugin.json", {})["version"], "0.2.18+c.222222222222")

    def test_base_version_readers_ignore_the_stamp(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pack = write_pack(Path(tmp))
            updater.stamp_delivered_version(pack, "0.2.18+c.abcdefabcdef")
            self.assertEqual(freshness.pack_version(pack), "0.2.18")
            self.assertEqual(freshness.delivered_version(pack), f"0.2.18+c.{freshness.delivered_digest(pack)[:12]}")


class PortalParityTest(unittest.TestCase):
    """The portal publishes this digest; both homes must agree on stamped manifests."""

    FIXTURE = Path(__file__).resolve().parents[3] / "apps" / "web" / "lib" / "agent-toolchain" / "__fixtures__" / "pack-digest-stamped"
    # Same constant as apps/web/lib/agent-toolchain/toolchain-manifest.test.ts.
    FIXTURE_DIGEST = "6075905951582b21a22696782683fe5d9b4829f53f913a8612b083bab57237a3"

    def test_matches_the_portal_typescript_digest(self) -> None:
        self.assertEqual(freshness.delivered_digest(self.FIXTURE), self.FIXTURE_DIGEST)


class ClaudeRecordTest(unittest.TestCase):
    """A stamped record is current; an unstamped one at the same base is not."""

    def _home(self, root: Path, record_version: str, cache_skill: str) -> tuple[Path, dict]:
        home = root / "home"
        source = updater.shared_managed_plugin_path(home)
        updater.copy_skill_pack(write_pack(root / "src"), source, dry_run=False)
        delivered = freshness.delivered_version(source)
        updater.stamp_delivered_version(source, delivered)
        cache = root / "cache"
        updater.copy_skill_pack(write_pack(root / "old", skill=cache_skill), cache, dry_run=False)
        updater.stamp_delivered_version(cache, record_version)
        record = {"scope": "project", "projectPath": str(root), "version": record_version, "installPath": str(cache)}
        updater.write_json(updater.claude_installed_plugins_path(home),
                           {"version": 2, "plugins": {updater.CLAUDE_PLUGIN_ID: [record]}})
        return home, record

    def test_stamped_record_with_matching_bytes_is_current(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            delivered = freshness.delivered_version(write_pack(root / "probe"))
            home, record = self._home(root, delivered, cache_skill="v1")
            self.assertTrue(updater.claude_record_content_matches(home, record))

    def test_unstamped_record_at_the_same_base_with_stale_bytes_is_not_current(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home, record = self._home(Path(tmp), "0.2.18", cache_skill="v0")
            self.assertFalse(updater.claude_record_content_matches(home, record))

    def test_the_managed_marketplace_carries_the_delivered_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            updater.ensure_claude_marketplace(home, "0.2.18+c.abcdefabcdef", dry_run=False)
            data = updater.read_json(updater.claude_marketplace_path(home), {})
            self.assertEqual(data["metadata"]["version"], "0.2.18+c.abcdefabcdef")
            self.assertEqual(data["plugins"][0]["version"], "0.2.18+c.abcdefabcdef")


class ReportTest(unittest.TestCase):
    def test_report_requires_the_stamped_version_on_claude_records(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            declared = convergence.Declarations(write_pack(Path(tmp)))
        self.assertEqual(declared.delivered, f"{declared.pack}+c.{declared.digest[:12]}")
        key = ("claude-code", "project:fixture")
        unstamped = {"version": declared.pack, "digest": declared.digest, "authMode": "oauth"}
        stamped = {**unstamped, "version": declared.delivered}
        for after, expected in ((unstamped, "failed"), (stamped, "converged")):
            with self.subTest(expected=expected), patch.object(convergence, "snapshot", side_effect=[{key: unstamped}, {key: after}]), patch.object(convergence, "cli_versions", return_value={}):
                report = convergence.ConvergenceReport(Path("fixture"), declared, None)
                report.add(*key, action="updated")
                self.assertEqual(report.finish(False)["result"], expected)

    def test_declarations_from_a_known_digest_derive_the_same_delivered_version(self) -> None:
        declared = convergence.Declarations.of("0.2.18", "a" * 64)
        self.assertEqual(declared.delivered, "0.2.18+c.aaaaaaaaaaaa")
        # The connector still declares the base version: the floor compares it.
        self.assertEqual(declared.header_value("claude-code"), f"pack=0.2.18;digest={'a' * 16};client=claude-code")


if __name__ == "__main__":
    unittest.main()
