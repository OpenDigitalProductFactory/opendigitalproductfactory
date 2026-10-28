"""BI-1DCF9F23 (spec M3): success means the client's own read-back.

Fixture homes only. In each case the write "succeeds" but the client's view
differs, and the row must report `failed`. A missing CLI reports `absent`; a
dry run reports `preview`. No test touches this machine's real clients.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Callable
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import toolchain_convergence as convergence  # noqa: E402
import update_agent_toolchain as updater  # noqa: E402

URL = "https://dpf.example/api/mcp/v1?tier=full"


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


class _Host:
    """A fixture host where every client holds the delivered pack."""

    def __init__(self, root: Path) -> None:
        self.home = root / "home"
        pack = root / "pack"
        _write(pack / ".claude-plugin" / "plugin.json", json.dumps({"name": "dpf-platform", "version": "0.3.0"}))
        _write(pack / "skills" / "dpf-a" / "SKILL.md", "---\nname: dpf-a\n---\nA\n")
        _write(pack / "skills" / "dpf-b" / "SKILL.md", "---\nname: dpf-b\n---\nB\n")
        self.declared = convergence.Declarations(pack)
        stamped = json.dumps({"name": "dpf-platform", "version": self.declared.delivered})
        self.shared = updater.shared_managed_plugin_path(self.home)
        self.codex = updater.codex_managed_plugin_path(self.home)
        self.grok = self.home / ".grok" / "installed-plugins" / "dpf-platform-0a51327f"
        self.cache = self.home / ".claude" / "plugins" / "cache" / "dpf-platform"
        for copy in (self.shared, self.codex, self.grok, self.cache):
            shutil.copytree(pack, copy)
            _write(copy / ".claude-plugin" / "plugin.json", stamped)
        _write(self.shared / "claude.mcp.json", json.dumps(
            {"mcpServers": {"dpf": {"type": "http", "url": "${DPF_CLAUDE_MCP_URL:-" + URL + "}"}}}))
        self.skills = self.home / ".gemini" / "antigravity" / "skills"
        shutil.copytree(pack / "skills", self.skills)
        _write(self.skills / "operator-own" / "SKILL.md", "not ours\n")
        self.agy_config = updater.antigravity_mcp_config_path(self.home)
        _write(self.agy_config, json.dumps({"mcpServers": {"dpf": {"serverUrl": URL, "disabled": False}}}))
        self.project = str(root / "project")
        _write(updater.claude_installed_plugins_path(self.home), json.dumps({"plugins": {updater.CLAUDE_PLUGIN_ID: [
            {"scope": "local", "projectPath": self.project, "version": self.declared.delivered,
             "installPath": str(self.cache)}]}}))

    def report(self) -> convergence.ConvergenceReport:
        report = convergence.ConvergenceReport(self.home, self.declared, None, endpoint=URL)
        report.add("shared", "copy", "copied")
        report.add("codex", "user", "installed, enabled, and verified")
        report.add("grok", "user", "installed")
        report.add("antigravity", "user", "MCP config converged; skills synced 2 skill(s)")
        report.add("claude-code", f"local:{self.project}", "installed and refreshed")
        return report


def _finish(host: _Host, damage: Callable[[_Host], None] = lambda _: None, dry_run: bool = False) -> dict[str, Any]:
    with patch.object(convergence, "grok_installed_copy", return_value=host.grok), \
            patch.object(convergence, "cli_versions", return_value={}):
        report = host.report()
        damage(host)
        return report.finish(dry_run)


def _rows(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {row["client"]: row for row in payload["clients"]}


def _drift(copy: Callable[[_Host], Path]) -> Callable[[_Host], None]:
    return lambda host: _write(copy(host) / "skills" / "dpf-a" / "SKILL.md", "stale\n")


class ReadbackTest(unittest.TestCase):
    def test_a_host_whose_clients_hold_the_pack_converges(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            payload = _finish(_Host(Path(tmp)))
        self.assertEqual(payload["result"], "converged", [r.get("detail") for r in payload["clients"]])

    def test_each_client_whose_read_back_differs_fails(self) -> None:
        cases = {
            "claude-code": _drift(lambda host: host.cache),
            "shared": _drift(lambda host: host.shared),
            "codex": _drift(lambda host: host.codex),
            "grok": _drift(lambda host: host.grok),
            "antigravity": lambda host: _write(host.skills / "dpf-a" / "SKILL.md", "stale\n"),
        }
        for client, damage in cases.items():
            with self.subTest(client=client), tempfile.TemporaryDirectory() as tmp:
                payload = _finish(_Host(Path(tmp)), damage)
                rows = _rows(payload)
                self.assertEqual(payload["result"], "failed")
                self.assertEqual(rows[client]["action"], "failed")
                self.assertIn("read-back", rows[client]["detail"])
                others = [name for name, row in rows.items() if name != client and row["action"] == "failed"]
                self.assertEqual(others, [])

    def test_a_connector_pointing_elsewhere_fails(self) -> None:
        elsewhere = "https://other.example/api/mcp/v1?tier=full"
        cases = {
            "shared": lambda host: _write(host.shared / "claude.mcp.json", json.dumps(
                {"mcpServers": {"dpf": {"url": elsewhere}}})),
            "antigravity": lambda host: _write(host.agy_config, json.dumps(
                {"mcpServers": {"dpf": {"serverUrl": elsewhere, "disabled": False}}})),
        }
        for client, damage in cases.items():
            with self.subTest(client=client), tempfile.TemporaryDirectory() as tmp:
                rows = _rows(_finish(_Host(Path(tmp)), damage))
                self.assertEqual(rows[client]["action"], "failed")
                self.assertIn("endpoint", rows[client]["detail"])

    def test_grok_is_read_from_its_own_store_not_the_shared_copy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            host = _Host(Path(tmp))
            payload = _finish(host, lambda h: shutil.rmtree(h.grok))
        self.assertEqual(_rows(payload)["grok"]["action"], "failed")
        self.assertIsNone(_rows(payload)["grok"]["after"]["digest"])

    def test_an_operator_skill_beside_ours_is_not_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            payload = _finish(_Host(Path(tmp)), lambda h: _write(h.skills / "operator-own" / "SKILL.md", "edited\n"))
        self.assertEqual(payload["result"], "converged")

    def test_a_missing_cli_is_absent_and_not_a_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            host = _Host(Path(tmp))
            with patch.object(convergence, "grok_installed_copy", return_value=None), \
                    patch.object(convergence, "cli_versions", return_value={}):
                report = convergence.ConvergenceReport(host.home, host.declared, None, endpoint=URL)
                report.add("grok", "user", "skipped: Grok CLI not found")
                report.add("antigravity", "user", "absent: Antigravity CLI (agy) not found")
                payload = report.finish(False)
        self.assertEqual([row["action"] for row in payload["clients"]], ["absent", "absent"])
        self.assertEqual(payload["result"], "converged")
        self.assertFalse(any(row["restartRequired"] for row in payload["clients"]))

    def test_a_dry_run_is_a_preview_never_converged(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            payload = _finish(_Host(Path(tmp)), _drift(lambda host: host.grok), dry_run=True)
        self.assertEqual(payload["result"], "preview")
        self.assertEqual({row["action"] for row in payload["clients"]}, {"preview"})
        self.assertFalse(any(row["restartRequired"] for row in payload["clients"]))


class GrokStoreTest(unittest.TestCase):
    def test_reads_the_installed_path_grok_reports(self) -> None:
        listing = json.dumps([{"name": "other", "path": "/x"},
                              {"name": "dpf-platform", "status": "installed", "path": "/g/dpf-platform-0a51327f"}])
        result = type("R", (), {"returncode": 0, "stdout": listing, "stderr": ""})()
        with patch.object(updater, "resolve_grok_binary", return_value="/fake/grok"), \
                patch("subprocess.run", return_value=result) as run:
            self.assertEqual(convergence.grok_installed_copy(), Path("/g/dpf-platform-0a51327f"))
        self.assertEqual(run.call_args.args[0], ["/fake/grok", "plugin", "list", "--json"])

    def test_no_cli_or_no_plugin_is_none(self) -> None:
        with patch.object(updater, "resolve_grok_binary", return_value=None):
            self.assertIsNone(convergence.grok_installed_copy())
        result = type("R", (), {"returncode": 0, "stdout": "[]", "stderr": ""})()
        with patch.object(updater, "resolve_grok_binary", return_value="/fake/grok"), \
                patch("subprocess.run", return_value=result):
            self.assertIsNone(convergence.grok_installed_copy())


if __name__ == "__main__":
    unittest.main()
