"""BI-D43723D7 (spec M10): records whose project path is gone are pruned through the Claude CLI.

`claude plugin uninstall --scope project` acts only on the record for the
directory it runs in (probed on Claude Code 2.1.197, 2026-10-27), and it writes
`.claude/settings.json` there. So the updater backs up installed_plugins.json,
recreates the gone directory empty, lets the CLI remove the record, reads the
record back, then removes the directory it made. A record whose parent is gone
too is left in place and reported. Fixture homes only; the CLI is faked.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update_agent_toolchain as updater  # noqa: E402


class _FakeClaude:
    """`claude plugin uninstall <id> --scope project`, as Claude Code 2.1.197 does it."""

    def __init__(self, home: Path, honest: bool = True) -> None:
        self.home = home
        self.honest = honest
        self.calls: list[tuple[list[str], str]] = []

    def __call__(self, command: list[str], **kwargs: Any) -> Any:
        cwd = kwargs["cwd"]
        self.calls.append((command, cwd))
        path = updater.claude_installed_plugins_path(self.home)
        data = json.loads(path.read_text())
        records = data["plugins"][updater.CLAUDE_PLUGIN_ID]
        if self.honest:
            data["plugins"][updater.CLAUDE_PLUGIN_ID] = [
                r for r in records if not (r.get("scope") == "project" and r.get("projectPath") == cwd)]
            path.write_text(json.dumps(data))
        settings = Path(cwd) / ".claude" / "settings.json"
        settings.parent.mkdir(parents=True, exist_ok=True)
        settings.write_text(json.dumps({"enabledPlugins": {}}))
        return type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})()


def _host(root: Path) -> tuple[Path, Path, Path, Path]:
    home = root / "home"
    live, gone = root / "worktrees" / "live", root / "worktrees" / "gone"
    orphan = root / "vanished-parent" / "child"
    live.mkdir(parents=True)
    path = updater.claude_installed_plugins_path(home)
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"plugins": {updater.CLAUDE_PLUGIN_ID: [
        {"scope": "project", "projectPath": str(p), "installPath": "/c", "version": "0.2.5"}
        for p in (live, gone, orphan)]}}))
    return home, live, gone, orphan


def _projects(home: Path) -> list[str]:
    return [r["projectPath"] for r in updater.claude_plugin_records(home)]


class PruneTest(unittest.TestCase):
    def test_a_gone_project_record_is_removed_through_the_cli_after_a_backup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home, live, gone, orphan = _host(Path(tmp))
            claude = _FakeClaude(home)
            results = updater.prune_claude_project_records(home, [str(gone), str(orphan)], False,
                                                           claude="/fake/claude", runner=claude)
            by = {row["project"]: row for row in results}
            self.assertEqual(by[str(gone)]["action"], "pruned")
            self.assertEqual(claude.calls[0][0], ["/fake/claude", "plugin", "uninstall", updater.CLAUDE_PLUGIN_ID,
                                                  "--scope", "project", "--keep-data"])
            self.assertEqual(claude.calls[0][1], str(gone))
            # The directory it recreated is gone again; the live project is untouched.
            self.assertFalse(gone.exists())
            self.assertEqual(sorted(_projects(home)), sorted([str(live), str(orphan)]))
            backup = Path(by[str(gone)]["backupPath"])
            self.assertEqual(len(json.loads(backup.read_text())["plugins"][updater.CLAUDE_PLUGIN_ID]), 3)

    def test_a_record_whose_parent_is_gone_too_is_left_in_place(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home, _live, _gone, orphan = _host(Path(tmp))
            claude = _FakeClaude(home)
            [row] = updater.prune_claude_project_records(home, [str(orphan)], False, claude="/fake/claude", runner=claude)
            self.assertEqual(row["action"], "prunable")
            self.assertIn("parent", row["detail"])
            self.assertEqual(claude.calls, [])
            self.assertFalse(orphan.parent.exists())

    def test_a_cli_that_exits_0_without_removing_the_record_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home, _live, gone, _orphan = _host(Path(tmp))
            [row] = updater.prune_claude_project_records(home, [str(gone)], False, claude="/fake/claude",
                                                         runner=_FakeClaude(home, honest=False))
            self.assertEqual(row["action"], "failed")
            self.assertIn(str(gone), _projects(home))
            self.assertFalse(gone.exists())

    def test_a_dry_run_and_a_missing_cli_touch_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home, _live, gone, _orphan = _host(Path(tmp))
            before = updater.claude_installed_plugins_path(home).read_text()
            claude = _FakeClaude(home)
            [preview] = updater.prune_claude_project_records(home, [str(gone)], True, claude="/fake/claude", runner=claude)
            [absent] = updater.prune_claude_project_records(home, [str(gone)], False, claude=None, runner=claude)
            self.assertEqual(preview["action"], "preview")
            self.assertEqual(absent["action"], "prunable")
            self.assertEqual(claude.calls, [])
            self.assertFalse(gone.exists())
            self.assertEqual(updater.claude_installed_plugins_path(home).read_text(), before)
            self.assertEqual(list(updater.claude_installed_plugins_path(home).parent.glob("*prune*")), [])

    def test_a_directory_that_reappears_with_content_is_not_removed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home, _live, gone, _orphan = _host(Path(tmp))

            def writes_more(command: list[str], **kwargs: Any) -> Any:
                result = _FakeClaude(home)(command, **kwargs)
                (Path(kwargs["cwd"]) / "someone-elses.txt").write_text("x")
                return result

            [row] = updater.prune_claude_project_records(home, [str(gone)], False, claude="/fake/claude", runner=writes_more)
            self.assertEqual(row["action"], "pruned")
            self.assertTrue((gone / "someone-elses.txt").exists())


if __name__ == "__main__":
    unittest.main()
