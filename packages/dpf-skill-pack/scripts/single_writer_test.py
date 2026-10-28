"""BI-1DCF9F23 (spec M4, AC-SINGLE-WRITER): the client CLI is the single writer.

The updater runs against a fixture home with every client CLI faked, so a CLI
writes nothing. Any file that changes was written by DPF's own code, and must
be declared in client-capabilities.json `writes` as a direct write. A change to
a file the declaration says a CLI covers fails: the adapter bypassed the CLI.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Iterable, Optional
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import codex_toml  # noqa: E402
import update_agent_toolchain as updater  # noqa: E402

PACK = Path(__file__).resolve().parents[1]
PROFILE = PACK / "client-capabilities.json"


def declared_writes(profile: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    data = profile or json.loads(PROFILE.read_text(encoding="utf-8"))
    return [{**entry, "client": kind} for kind, row in data["clients"].items() for entry in row.get("writes") or []]


def _pattern(path: str) -> re.Pattern[str]:
    parts = re.split(r"(\*\*|\*)", path)
    body = "".join(".*" if part == "**" else "[^/]*" if part == "*" else re.escape(part) for part in parts)
    return re.compile(f"^{body}$")


def governing_write(path: str, writes: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """The most specific declaration covering `path`, or None when nothing declares it."""
    matches = [entry for entry in writes if _pattern(entry["path"]).match(path)]
    return max(matches, key=lambda entry: len(entry["path"])) if matches else None


def violations(changed: Iterable[str], writes: list[dict[str, Any]]) -> list[str]:
    problems = []
    for path in sorted(changed):
        entry = governing_write(path, writes)
        if entry is None:
            problems.append(f"{path}: written but not declared in client-capabilities.json writes")
        elif entry["writer"] == "cli":
            problems.append(f"{path}: written directly, but `{entry['cli']}` covers it ({entry['client']})")
    return problems


def _tree(root: Path, label: str) -> dict[str, str]:
    return {f"{label}/{path.relative_to(root).as_posix()}": hashlib.sha256(path.read_bytes()).hexdigest()
            for path in root.rglob("*") if path.is_file()}


class _Result:
    returncode = 0
    stdout = ""
    stderr = ""


def run_updater(root: Path) -> list[str]:
    """Every file the updater changed on a fixture host where each client CLI is faked."""
    home, project = root / "home", root / "project"
    project.mkdir(parents=True)
    (project / ".mcp.json").write_text(json.dumps({"mcpServers": {"dpf": {"url": "http://127.0.0.1:3000/api/mcp/v1"}}}))
    cache = home / ".claude" / "plugins" / "cache" / "dpf-platform-local" / "dpf-platform" / "0.2.5"
    cache.mkdir(parents=True)
    (cache / "claude.mcp.json").write_text(json.dumps({"mcpServers": {"dpf": {
        "type": "http", "url": "${DPF_MCP_URL:-https://localhost/api/mcp/v1?tier=full}"}}}))
    records = [{"scope": "project", "projectPath": str(project), "version": "0.2.5", "installPath": str(cache)},
               {"scope": "local", "projectPath": str(project), "version": "0.2.5", "installPath": str(cache)}]
    installed = updater.claude_installed_plugins_path(home)
    installed.parent.mkdir(parents=True, exist_ok=True)
    installed.write_text(json.dumps({"plugins": {updater.CLAUDE_PLUGIN_ID: records}}))
    dpf = {"type": "http", "url": "http://127.0.0.1:3000/api/mcp/v1?tier=full"}
    (home / ".claude.json").write_text(json.dumps({"mcpServers": {"dpf": dpf}, "projects": {str(project): {"mcpServers": {"dpf": dpf}}}}))
    before = {**_tree(home, "~"), **_tree(project, "<project>")}
    env = {"DPF_AGENT_TOOLCHAIN_HOME": str(home), "DPF_MCP_URL": "", "DPF_CLAUDE_MCP_URL": ""}
    with patch.dict(os.environ, env), \
            patch.object(updater, "resolve_claude_binary", return_value="/fake/claude"), \
            patch.object(updater, "resolve_codex_binary", return_value="/fake/codex"), \
            patch.object(updater, "resolve_grok_binary", return_value="/fake/grok"), \
            patch.object(updater, "resolve_antigravity_binary", return_value="/fake/agy"), \
            patch("subprocess.run", return_value=_Result()), patch("builtins.print"):
        updater.main(["--skill-pack-path", str(PACK), "--report-json", str(root / "report.json"),
                      "--mcp-url", "https://dpf.example/api/mcp/v1"])
    after = {**_tree(home, "~"), **_tree(project, "<project>")}
    return [path for path, digest in after.items() if before.get(path) != digest]


class SingleWriterTest(unittest.TestCase):
    @unittest.skipIf(codex_toml._stdlib_parser() is None,
                     "fakes the Codex CLI, so its TOML needs Python 3.11+ or tomli; CI runs it (BI-90C9478D)")
    def test_the_updater_writes_only_what_no_cli_covers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            changed = run_updater(Path(tmp))
        self.assertTrue(changed, "the fixture run wrote nothing; the test would prove nothing")
        self.assertEqual(violations(changed, declared_writes()), [])
        # agy now owns its own config: with agy faked, nothing wrote it.
        self.assertNotIn("~/.gemini/config/mcp_config.json", changed)

    def test_a_direct_write_to_a_cli_covered_file_fails(self) -> None:
        problems = violations(["~/.gemini/config/mcp_config.json", "~/.claude/plugins/installed_plugins.json"],
                              declared_writes())
        self.assertEqual(len(problems), 2, problems)
        self.assertTrue(any("agy mcp add" in problem for problem in problems), problems)

    def test_an_undeclared_write_fails(self) -> None:
        self.assertEqual(violations(["~/.somewhere/new.json"], declared_writes()),
                         ["~/.somewhere/new.json: written but not declared in client-capabilities.json writes"])

    def test_the_most_specific_declaration_governs(self) -> None:
        writes = declared_writes()
        self.assertEqual(governing_write("~/.claude/plugins/cache/x/dpf-platform/1/claude.mcp.json", writes)["writer"], "direct")
        self.assertEqual(governing_write("~/.claude/plugins/cache/x/dpf-platform/1/skills/a/SKILL.md", writes)["writer"], "cli")


if __name__ == "__main__":
    unittest.main()
