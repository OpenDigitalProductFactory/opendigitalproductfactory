"""Grok's own DPF credential in the updater (BI-84C1F526, DI-4B843FAF62F9).

A fixture Grok home: the updater points [mcp_servers.dpf] at bearer_token_file,
hands the credentials client to the existing refresher on standard input, runs
its first refresh, and never prints or writes a personal access token.
"""
from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import grok_credential as gc  # noqa: E402

SECRET = "dpfocs_fixture-secret"
CLIENT = json.dumps({"clientId": "dpfoc_fixture", "clientSecret": SECRET})


class FakeRunner:
    def __init__(self, codes: dict[str, int] | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.codes = codes or {}

    def __call__(self, argv: list[str], **kwargs: Any):
        command = argv[2]
        self.calls.append({"argv": argv, "input": kwargs.get("input")})
        code = self.codes.get(command, 0)
        stdout = {"write-client": "stored\n", "refresh": "refreshed\n"}[command] if code == 0 else ""

        class Done:
            returncode = code

        done = Done()
        done.stdout = stdout
        done.stderr = ""
        return done


class GrokCredentialTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        (self.home / ".grok").mkdir()
        self.config = self.home / ".grok" / "config.toml"
        self.config.write_text(
            '[cli]\nchannel = "stable"\n\n[mcp_servers.dpf]\nurl = "https://localhost/api/mcp/v1?tier=full"\n'
            'bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"\ntool_timeout_sec = 90\n\n[plugins]\nenabled = [ "dpf-platform" ]\n',
            encoding="utf-8",
        )
        self.refresher = self.home / "refresh-grok-mcp-credential.mjs"
        self.refresher.write_text("// fixture\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def converge(self, payload: str | None, runner: FakeRunner, dry_run: bool = False) -> tuple[str, str]:
        out = io.StringIO()
        with redirect_stdout(out):
            status = gc.converge_grok_credential(
                home=self.home, refresher=self.refresher, mcp_url=None, client_payload=payload,
                dry_run=dry_run, node="node", run=runner,
            )
        return status, out.getvalue()

    def test_points_grok_at_its_bearer_file_and_runs_the_refresher(self) -> None:
        runner = FakeRunner()
        status, printed = self.converge(CLIENT, runner)
        self.assertEqual(status, "converged: refreshed")
        text = self.config.read_text(encoding="utf-8")
        self.assertIn(f"bearer_token_file = {json.dumps(str(self.home / '.grok' / 'dpf-mcp-token'))}", text)
        self.assertNotIn("bearer_token_env_var", text)
        self.assertIn('url = "https://localhost/api/mcp/v1?tier=full"', text)
        self.assertIn("tool_timeout_sec = 90", text)
        self.assertIn('[plugins]\nenabled = [ "dpf-platform" ]', text)
        write, refresh = runner.calls
        self.assertEqual(write["argv"][2:], ["write-client", "--config", str(self.config)])
        self.assertEqual(write["input"], CLIENT)
        self.assertEqual(refresh["argv"][2:], ["refresh", "--mcp-url", "https://localhost/api/mcp/v1?tier=full", "--config", str(self.config)])
        for call in runner.calls:
            self.assertNotIn(SECRET, " ".join(call["argv"]))
        self.assertNotIn(SECRET, printed + status)

    def test_refuses_a_personal_access_token(self) -> None:
        runner = FakeRunner()
        pat = json.dumps({"clientId": "dpfoc_x", "clientSecret": "dpfmcp_ABCDEF"})
        status, printed = self.converge(pat, runner)
        self.assertTrue(status.startswith("failed:"))
        self.assertNotIn("dpfmcp_ABCDEF", status + printed)
        self.assertEqual(runner.calls, [])

    def test_refreshes_a_stored_client_without_a_new_payload(self) -> None:
        (self.home / ".grok" / "dpf-mcp-client.json").write_text(CLIENT, encoding="utf-8")
        runner = FakeRunner()
        status, _ = self.converge(None, runner)
        self.assertEqual(status, "converged: refreshed")
        self.assertEqual([call["argv"][2] for call in runner.calls], ["refresh"])

    def test_asks_for_the_credential_when_none_is_stored(self) -> None:
        runner = FakeRunner()
        status, _ = self.converge(None, runner)
        self.assertTrue(status.startswith("needs credential:"))
        self.assertIn("issue_grok_credentials_client", status)
        self.assertEqual(runner.calls, [])

    def test_reports_a_failed_refresh(self) -> None:
        status, _ = self.converge(CLIENT, FakeRunner({"refresh": 1}))
        self.assertEqual(status, "failed: Grok credential refresh exited 1")

    def test_dry_run_writes_nothing(self) -> None:
        before = self.config.read_text(encoding="utf-8")
        runner = FakeRunner()
        status, _ = self.converge(CLIENT, runner, dry_run=True)
        self.assertTrue(status.startswith("dry-run:"))
        self.assertEqual(self.config.read_text(encoding="utf-8"), before)
        self.assertEqual(runner.calls, [])

    def test_skips_a_host_without_grok_or_without_the_refresher(self) -> None:
        other = Path(self.tmp.name) / "empty-home"
        other.mkdir()
        status = gc.converge_grok_credential(home=other, refresher=self.refresher, mcp_url=None, client_payload=None, dry_run=False, node="node", run=FakeRunner())
        self.assertTrue(status.startswith("skipped:"))
        status = gc.converge_grok_credential(home=self.home, refresher=None, mcp_url=None, client_payload=CLIENT, dry_run=False, node="node", run=FakeRunner())
        self.assertTrue(status.startswith("failed:"))
        self.assertIn("refresher", status)

    def test_writes_a_new_dpf_table_when_none_exists(self) -> None:
        self.config.write_text('[cli]\nchannel = "stable"\n', encoding="utf-8")
        status, _ = self.converge(CLIENT, FakeRunner(), )
        self.assertEqual(status, "converged: refreshed")
        text = self.config.read_text(encoding="utf-8")
        self.assertIn("[mcp_servers.dpf]", text)
        self.assertIn("url = ", text)


    def test_the_refresher_ships_in_this_skill_pack(self) -> None:
        pack = Path(__file__).resolve().parent.parent
        self.assertEqual(gc.find_grok_refresher(pack), pack / "scripts" / "refresh-grok-mcp-credential.mjs")
        self.assertIsNone(gc.find_grok_refresher(self.home))


    def test_the_connector_url_carries_the_pack_declaration(self) -> None:
        import toolchain_convergence as convergence

        declarations = convergence.Declarations.of("0.3.0", "ab" * 32)
        runner = FakeRunner()
        out = io.StringIO()
        with redirect_stdout(out):
            gc.converge_grok_credential(
                home=self.home, refresher=self.refresher, mcp_url=None, client_payload=CLIENT, dry_run=False,
                node="node", run=runner, declare_url=lambda url: declarations.query_url(url, "grok"),
            )
        url = gc.existing_grok_mcp_url(self.config.read_text(encoding="utf-8"))
        self.assertEqual(url, "https://localhost/api/mcp/v1?tier=full&dpf_pack=0.3.0&dpf_digest=abababababababab&dpf_client=grok")
        with redirect_stdout(out):
            gc.converge_grok_credential(
                home=self.home, refresher=self.refresher, mcp_url=None, client_payload=None, dry_run=False,
                node="node", run=runner, declare_url=lambda url: declarations.query_url(url, "grok"),
            )
        self.assertEqual(gc.existing_grok_mcp_url(self.config.read_text(encoding="utf-8")), url)


if __name__ == "__main__":
    unittest.main()
