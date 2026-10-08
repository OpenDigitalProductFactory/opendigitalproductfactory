"""BI-16EAAB62: SessionStart flags an installed dpf-platform copy that drifted.

On 2026-10-01 the shared managed copy at ~/.agents/plugins/plugins/dpf-platform
stayed on 0.2.5 with the old http://127.0.0.1:3000 + bearer descriptor after the
connector moved to OAuth at https://localhost. The desktop app saw two server
URLs for "dpf" and refused sign-in, and no session-start check noticed, because
every check read the repository's descriptor rather than the copy a client
loads. BI-F4BE47B5 was the same class one directory over: a Claude plugin-cache
copy at the current version whose hook code predated two merges.

Every case builds a fake HOME; nothing reads the real one.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update_agent_toolchain as updater
import installed_copy_freshness as freshness

SCRIPT = Path(__file__).resolve().parent / "installed_copy_freshness.py"
STALE_URL = "http://127.0.0.1:3000/api/mcp/v1"
CLEAN_ENV: dict[str, str] = {}


def write_reference_pack(root: Path, version: str = "0.2.8") -> Path:
    pack = root / "repo" / "packages" / "dpf-skill-pack"
    updater.write_json(pack / ".claude-plugin" / "plugin.json", {"name": "dpf-platform", "version": version})
    updater.write_json(pack / ".codex-plugin" / "plugin.json", {"name": "dpf-platform", "version": f"{version}+codex.repo"})
    (pack / "skills").mkdir(parents=True)
    updater.write_text_if_changed(pack / "hooks" / "uncommitted-work-guard.mjs", "// current guard\n")
    updater.ensure_claude_repo_mcp_config(pack, updater.DEFAULT_MCP_URL, dry_run=False)
    return pack


def install_copy(reference: Path, destination: Path) -> Path:
    updater.copy_skill_pack(reference, destination, dry_run=False)
    return destination


def make_stale(copy: Path, version: str = "0.2.5") -> None:
    updater.write_json(copy / ".claude-plugin" / "plugin.json", {"name": "dpf-platform", "version": version})
    updater.write_json(
        copy / "claude.mcp.json",
        {"mcpServers": {"dpf": {
            "type": "http",
            "url": STALE_URL,
            "headers": {"Authorization": "Bearer ${DPF_MCP_BEARER_TOKEN:-}"},
        }}},
    )


def register_claude_install(home: Path, project: Path, install_path: Path, version: str, scope: str = "project") -> None:
    updater.write_json(
        updater.claude_installed_plugins_path(home),
        {"version": 2, "plugins": {updater.CLAUDE_PLUGIN_ID: [{
            "scope": scope,
            "projectPath": str(project),
            "installPath": str(install_path),
            "version": version,
        }]}},
    )


class InstalledCopyFreshnessTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.home = self.root / "home"
        self.project = self.root / "repo"
        self.reference = write_reference_pack(self.root)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def assess(self, env: dict[str, str] = CLEAN_ENV) -> list[str]:
        findings = freshness.assess_installed_copies(self.reference, self.home, self.project, env)
        return freshness.render_findings(findings, self.reference)

    def test_the_2026_10_01_stale_shared_copy_is_named_with_its_repair(self):
        shared = install_copy(self.reference, updater.shared_managed_plugin_path(self.home))
        make_stale(shared)
        lines = self.assess()
        self.assertEqual(len(lines), 1, lines)
        line = lines[0]
        self.assertTrue(line.startswith("WARN: "), line)
        self.assertIn(str(shared), line)
        self.assertIn("0.2.5", line)
        self.assertIn("0.2.8", line)
        self.assertIn(STALE_URL, line)
        self.assertIn("bearer", line)
        self.assertIn("https://localhost/api/mcp/v1", line)
        self.assertIn("OAuth", line)
        self.assertIn(str(self.reference / "scripts" / "update_agent_toolchain.py"), line)

    def test_current_copies_everywhere_stay_quiet(self):
        install_copy(self.reference, updater.shared_managed_plugin_path(self.home))
        codex = install_copy(self.reference, updater.codex_managed_plugin_path(self.home))
        # The updater rewrites the Codex manifest with a content version.
        updater.write_json(codex / ".codex-plugin" / "plugin.json", {"name": "dpf-platform", "version": "0.2.8+codex.abc"})
        cache = install_copy(self.reference, self.home / ".claude" / "plugins" / "cache" / "dpf-platform-local" / "dpf-platform" / "0.2.8")
        # The SessionStart pinner gives the cache descriptor a literal URL, and
        # Claude Code keeps a marker per loading process under .in_use/.
        server = json.loads((cache / "claude.mcp.json").read_text())
        server["mcpServers"]["dpf"]["url"] = "https://localhost/api/mcp/v1?tier=full"
        updater.write_json(cache / "claude.mcp.json", server)
        (cache / ".in_use").mkdir()
        (cache / ".in_use" / "17537").write_text('{"pid": 17537}')
        register_claude_install(self.home, self.project, cache, "0.2.8")
        self.assertEqual(self.assess(), [])

    def test_no_installed_copies_stay_quiet(self):
        self.assertEqual(self.assess(), [])

    def test_same_version_cache_copy_with_stale_hook_code_is_flagged(self):
        # BI-F4BE47B5: the version matched; the hook bytes did not.
        cache = install_copy(self.reference, self.home / ".claude" / "plugins" / "cache" / "dpf-platform-local" / "dpf-platform" / "0.2.8")
        updater.write_text_if_changed(cache / "hooks" / "uncommitted-work-guard.mjs", "// guard from before #5568\n")
        register_claude_install(self.home, self.project, cache, "0.2.8")
        lines = self.assess()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn(str(cache), lines[0])
        self.assertIn("content differs", lines[0])

    def test_cache_records_for_other_checkouts_are_not_this_sessions_concern(self):
        cache = install_copy(self.reference, self.home / ".claude" / "plugins" / "cache" / "dpf-platform-local" / "dpf-platform" / "0.2.5")
        make_stale(cache)
        register_claude_install(self.home, self.root / "some-other-worktree", cache, "0.2.5")
        self.assertEqual(self.assess(), [])

    def test_a_copy_newer_than_the_reference_is_not_called_stale(self):
        shared = install_copy(self.reference, updater.shared_managed_plugin_path(self.home))
        updater.write_json(shared / ".claude-plugin" / "plugin.json", {"name": "dpf-platform", "version": "0.2.9"})
        updater.write_text_if_changed(shared / "hooks" / "new-guard.mjs", "// newer\n")
        self.assertEqual(self.assess(), [])

    def test_expected_connector_follows_the_install_url_and_auth_mode(self):
        shared = install_copy(self.reference, updater.shared_managed_plugin_path(self.home))
        # What the updater writes for an install served on plain http.
        updater.ensure_claude_repo_mcp_config(shared, STALE_URL, dry_run=False)
        self.assertEqual(self.assess({"DPF_MCP_URL": STALE_URL}), [])
        lines = self.assess()
        self.assertEqual(len(lines), 1, lines)
        self.assertIn("connector", lines[0])

    def test_cli_warns_on_a_stale_copy_and_always_exits_zero(self):
        shared = install_copy(self.reference, updater.shared_managed_plugin_path(self.home))
        make_stale(shared)
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("WARN: ", result.stdout)
        self.assertIn(str(shared), result.stdout)

    def test_cli_never_fails_the_session_on_unreadable_state(self):
        path = updater.claude_installed_plugins_path(self.home)
        path.parent.mkdir(parents=True)
        path.write_text("{not json")
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_cli_resolves_the_root_clone_as_reference_from_a_linked_worktree(self):
        if shutil.which("git") is None:
            self.skipTest("git not available")
        git = ["git", "-c", "user.email=t@example.test", "-c", "user.name=t", "-c", "commit.gpgsign=false"]
        subprocess.run(git + ["init", "-q", str(self.project)], check=True)
        subprocess.run(git + ["-C", str(self.project), "add", "-A"], check=True)
        subprocess.run(git + ["-C", str(self.project), "commit", "-qm", "seed"], check=True)
        worktree = self.root / "wt"
        subprocess.run(git + ["-C", str(self.project), "worktree", "add", "-q", "-b", "topic", str(worktree)], check=True)
        self.assertEqual(
            freshness.resolve_reference_skill_pack(worktree).resolve(),
            self.reference.resolve(),
        )

    def run_cli(self) -> subprocess.CompletedProcess:
        env = {k: v for k, v in os.environ.items() if not k.startswith("DPF_")}
        env["HOME"] = str(self.home)
        env["USERPROFILE"] = str(self.home)
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--project-dir", str(self.project), "--skill-pack-path", str(self.reference)],
            capture_output=True, text=True, env=env, timeout=30,
        )


class DeliveredDigestParityTest(unittest.TestCase):
    """BI-52934B3E: the portal publishes this digest, so both homes must agree."""

    FIXTURE = Path(__file__).resolve().parents[3] / "apps" / "web" / "lib" / "agent-toolchain" / "__fixtures__" / "pack-digest"
    # Same constant as apps/web/lib/agent-toolchain/toolchain-manifest.test.ts.
    FIXTURE_DIGEST = "ca4afe3a58a8f22b62ae1f6e5be4e5ad976ed59a5abd0a89c0460519af10c28f"

    def test_matches_the_portal_typescript_digest(self):
        self.assertEqual(freshness.delivered_digest(self.FIXTURE), self.FIXTURE_DIGEST)

    def test_order_is_case_sensitive_by_segment(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "README.md").write_bytes(b"r")
            (root / "assets").mkdir()
            (root / "assets" / "a.txt").write_bytes(b"a")
            forward = freshness.delivered_digest(root)
        # Hash the two files explicitly in case-sensitive order and compare.
        import hashlib
        expected = hashlib.sha256()
        for rel, data in (("README.md", b"r"), ("assets/a.txt", b"a")):
            expected.update(rel.encode() + b"\x00")
            expected.update(hashlib.sha256(data).digest())
        self.assertEqual(forward, expected.hexdigest())


if __name__ == "__main__":
    unittest.main()
