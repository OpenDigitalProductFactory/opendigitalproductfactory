"""BI-D43723D7 (spec M6): every run discovers installed clients; none is skipped silently.

A client shows it is installed through a binary or an app bundle. One DPF has
an adapter for converges as before; an installed client without one, or an
adapted client whose app is present but whose CLI is not, reports `unproven`.
Fixture app folders and a faked PATH only.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import toolchain_convergence as convergence  # noqa: E402
import update_agent_toolchain as updater  # noqa: E402


def _which(found: dict[str, str]):
    return lambda name: found.get(name)


class _NoClis:
    def __enter__(self) -> None:
        self.patches = [patch.object(updater, name, return_value=None) for name in
                        ("resolve_claude_binary", "resolve_codex_binary", "resolve_grok_binary", "resolve_antigravity_binary")]
        for active in self.patches:
            active.start()

    def __exit__(self, *_: object) -> None:
        for active in self.patches:
            active.stop()


class DiscoveryTest(unittest.TestCase):
    def test_binaries_and_app_bundles_are_found_and_config_folders_alone_are_not(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, _NoClis():
            apps = Path(tmp) / "Applications"
            (apps / "Cursor.app").mkdir(parents=True)
            (apps / "Antigravity.app").mkdir()
            home = Path(tmp) / "home"
            (home / ".grok").mkdir(parents=True)  # leftover config: not an install
            found = convergence.discover_clients(home, which=_which({"gemini": "/usr/local/bin/gemini"}), app_roots=[apps])
        self.assertEqual(found, {"cursor": [str(apps / "Cursor.app")], "antigravity": [str(apps / "Antigravity.app")],
                                 "gemini-cli": ["/usr/local/bin/gemini"]})

    def test_an_adapted_client_is_found_through_its_own_resolver(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, _NoClis(), \
                patch.object(updater, "resolve_codex_binary", return_value="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"):
            found = convergence.discover_clients(Path(tmp), which=_which({}), app_roots=[])
        self.assertEqual(found, {"codex": ["/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"]})


def _report(found: dict[str, list[str]], rows: list[tuple[str, str, str]]) -> dict:
    declared = convergence.Declarations.of("0.3.0", "0" * 64)
    with patch.object(convergence, "snapshot", return_value={}), patch.object(convergence, "cli_versions", return_value={}):
        report = convergence.ConvergenceReport(Path("fixture"), declared, None)
        for client, scope, status in rows:
            report.add(client, scope, status)
        report.add_discovery(found)
        return report.finish(False)


class DiscoveryReportTest(unittest.TestCase):
    def test_an_installed_client_without_an_adapter_is_reported_unproven(self) -> None:
        payload = _report({"cursor": ["/Applications/Cursor.app"]}, [])
        [row] = payload["clients"]
        self.assertEqual((row["client"], row["scope"], row["action"]), ("cursor", "discovery", "unproven"))
        self.assertIn("/Applications/Cursor.app", row["detail"])
        self.assertIn("Adding a client", row["detail"])
        self.assertEqual(payload["result"], "converged")
        self.assertFalse(row["restartRequired"])

    def test_an_adapted_client_whose_app_has_no_cli_is_unproven_not_absent(self) -> None:
        payload = _report({"antigravity": ["/Applications/Antigravity.app"]},
                          [("antigravity", "user", "absent: Antigravity CLI (agy) not found"),
                           ("grok", "user", "skipped: Grok CLI not found")])
        rows = {row["client"]: row for row in payload["clients"]}
        self.assertEqual(rows["antigravity"]["action"], "unproven")
        self.assertIn("Antigravity.app", rows["antigravity"]["detail"])
        self.assertEqual(rows["grok"]["action"], "absent")
        self.assertEqual(payload["result"], "converged")

    def test_an_adapted_client_found_by_discovery_adds_no_second_row(self) -> None:
        payload = _report({"codex": ["/usr/local/bin/codex"]}, [])
        self.assertEqual(payload["clients"], [])


if __name__ == "__main__":
    unittest.main()
