"""BI-DE1E6485: declaration, per-scope report and Claude scope repairs.

Fixture homes only (temporary directories); every client CLI is faked, so no
test touches this machine's real clients.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import toolchain_convergence as convergence  # noqa: E402
import update_agent_toolchain as updater  # noqa: E402
from installed_copy_freshness import delivered_digest  # noqa: E402

PACK = Path(__file__).resolve().parents[1]
TEMPLATE = "${DPF_MCP_URL:-https://localhost/api/mcp/v1?tier=full}"
CLAUDE_TEMPLATE = "${DPF_CLAUDE_MCP_URL:-https://localhost/api/mcp/v1?tier=full}"


class _Result:
    returncode = 0
    stdout = ""
    stderr = ""


def _Declared(manifest: Any = None) -> convergence.Declarations:
    """A declaration with a fixed digest, so a test needs no pack tree."""
    return convergence.Declarations.of("0.3.0", "0123456789abcdef" + "0" * 48, manifest)


class DeclarationTest(unittest.TestCase):
    def test_header_carrier_leaves_the_templated_url_alone(self) -> None:
        server = _Declared().declare_server({"type": "http", "url": TEMPLATE, "oauth": {"scopes": "x"}}, "claude-code")
        self.assertEqual(server["url"], TEMPLATE)
        self.assertEqual(server["headers"], {"X-DPF-Toolchain": "pack=0.3.0;digest=0123456789abcdef;client=claude-code"})
        self.assertEqual(server["oauth"], {"scopes": "x"})

    def test_bearer_header_is_kept_beside_the_declaration(self) -> None:
        bearer = {"Authorization": "Bearer ${DPF_MCP_BEARER_TOKEN:-}"}
        server = _Declared().declare_server({"url": TEMPLATE, "headers": bearer}, "antigravity")
        self.assertEqual(server["headers"]["Authorization"], bearer["Authorization"])
        self.assertIn("client=antigravity", server["headers"]["X-DPF-Toolchain"])

    def test_query_carrier_on_a_literal_url_replaces_an_older_declaration(self) -> None:
        declared = _Declared()
        url = "http://127.0.0.1:3000/api/mcp/v1?dpf_pack=0.2.9&dpf_digest=ffffffffffffffff&dpf_client=grok"
        server = declared.declare_server({"url": url, "bearer_token_file": "~/.grok/dpf-mcp-token"}, "grok")
        self.assertEqual(server["url"], "http://127.0.0.1:3000/api/mcp/v1?dpf_pack=0.3.0&dpf_digest=0123456789abcdef&dpf_client=grok")
        self.assertNotIn("headers", server)

    def test_query_carrier_on_a_template_falls_back_to_the_header(self) -> None:
        declared = _Declared({"clients": {"claude-code": {"declarationCarrier": "query"}}})
        self.assertEqual(declared.carrier("claude-code"), "query")
        server = declared.declare_server({"url": TEMPLATE}, "claude-code")
        self.assertEqual(server["url"], TEMPLATE)
        self.assertIn("X-DPF-Toolchain", server["headers"])

    def test_the_real_pack_declares_its_own_delivered_digest(self) -> None:
        declared = convergence.Declarations(PACK)
        self.assertTrue(declared.enabled())
        self.assertEqual(declared.digest, delivered_digest(PACK))
        self.assertEqual(declared.pack, json.loads((PACK / "toolchain-version.json").read_text())["packVersion"])

    def test_claude_descriptor_generator_carries_the_declaration_only_when_given(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pack = Path(tmp)
            updater.ensure_claude_repo_mcp_config(pack, updater.DEFAULT_MCP_URL, dry_run=False)
            plain = json.loads((pack / "claude.mcp.json").read_text())["mcpServers"]["dpf"]
            updater.ensure_claude_repo_mcp_config(pack, updater.DEFAULT_MCP_URL, dry_run=False, declarations=_Declared())
            declared = json.loads((pack / "claude.mcp.json").read_text())["mcpServers"]["dpf"]
        self.assertNotIn("headers", plain)
        self.assertEqual(declared["url"], plain["url"])
        self.assertEqual(declared["oauth"], plain["oauth"])
        self.assertEqual(list(declared["headers"]), ["X-DPF-Toolchain"])


class CodexDeclarationTest(unittest.TestCase):
    HEADER = "pack=0.3.0;digest=0123456789abcdef;client=codex"

    def test_header_line_is_added_once_and_rewritten_on_rerun(self) -> None:
        body = updater.codex_mcp_body("", "https://localhost/api/mcp/v1", self.HEADER)
        line = 'http_headers = { "X-DPF-Toolchain" = "pack=0.3.0;digest=0123456789abcdef;client=codex" }'
        self.assertIn(line, body)
        text = "[mcp_servers.dpf]\n" + "\n".join(body) + "\n"
        again = updater.codex_mcp_body(text, None, self.HEADER.replace("0.3.0", "0.3.1"))
        self.assertEqual(sum(1 for entry in again if entry.startswith("http_headers")), 1)
        self.assertIn("0.3.1", next(entry for entry in again if entry.startswith("http_headers")))

    def test_an_operator_headers_table_is_kept_and_not_merged(self) -> None:
        text = '[mcp_servers.dpf]\nurl = "https://localhost/api/mcp/v1?tier=full"\nhttp_headers = { "X-Org" = "1" }\n'
        body = updater.codex_mcp_body(text, None, self.HEADER)
        self.assertEqual([entry for entry in body if entry.startswith("http_headers")], ['http_headers = { "X-Org" = "1" }'])

    def test_an_operator_headers_subtable_is_not_duplicated(self) -> None:
        text = '[mcp_servers.dpf]\nurl = "https://localhost/api/mcp/v1"\n\n[mcp_servers.dpf.http_headers]\nX-Org = "1"\n'
        body = updater.codex_mcp_body(text, None, self.HEADER)
        self.assertFalse(any(entry.startswith("http_headers") for entry in body))

    def test_no_declaration_writes_no_header(self) -> None:
        self.assertFalse(any(entry.startswith("http_headers") for entry in updater.codex_mcp_body("", None)))


def _home(root: Path, entries: list[dict[str, Any]], claude_json: Any = None) -> Path:
    home = root / "home"
    path = updater.claude_installed_plugins_path(home)
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"version": 2, "plugins": {updater.CLAUDE_PLUGIN_ID: entries}}))
    if claude_json is not None:
        (home / ".claude.json").write_text(json.dumps(claude_json))
    return home


def _cache(root: Path, name: str, server: dict[str, Any]) -> Path:
    install = root / "cache" / name
    install.mkdir(parents=True)
    (install / "claude.mcp.json").write_text(json.dumps({"mcpServers": {"dpf": server}}))
    return install


class LocalScopeRetirementTest(unittest.TestCase):
    def test_backs_up_then_removes_through_the_cli_in_the_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "proj"
            project.mkdir()
            server = {"type": "http", "url": "http://127.0.0.1:3000/api/mcp/v1?tier=full", "headers": {"Authorization": "Bearer x"}}
            home = _home(root, [{"scope": "local", "projectPath": str(project)}], {"projects": {
                str(project): {"mcpServers": {"dpf": server, "other": {"url": "https://other/api"}}},
                str(root / "gone"): {"mcpServers": {"dpf": server}},
                str(root): {"mcpServers": {"dpf": {"url": "https://elsewhere.example/other"}}},
            }})
            with patch.object(updater, "resolve_claude_binary", return_value="/fake/claude"), \
                    patch("subprocess.run", return_value=_Result()) as run:
                rows = convergence.retire_local_scope_dpf_servers(home, dry_run=False)
            by_project = {row["project"]: row for row in rows}
            self.assertEqual(by_project[str(root / "gone")]["action"], "prunable")
            retired = by_project[str(project)]
            self.assertEqual(retired["action"], "retired")
            backup = json.loads(Path(retired["backupPath"]).read_text())
            self.assertEqual(backup, {"projectPath": str(project), "mcpServers": {"dpf": server}})
            self.assertNotIn(str(root), by_project)
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args[0][0], ["/fake/claude", "mcp", "remove", "dpf", "-s", "local"])
            self.assertEqual(run.call_args[1]["cwd"], str(project))

    def test_nothing_happens_without_the_plugin_connector(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp), [], {"projects": {tmp: {"mcpServers": {"dpf": {"url": "https://x/api/mcp/v1"}}}}})
            self.assertEqual(convergence.retire_local_scope_dpf_servers(home, dry_run=False), [])


class PinRecordDescriptorsTest(unittest.TestCase):
    def test_pins_every_existing_record_keeping_query_and_declaration_header(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            a, b = root / "a", root / "b"
            a.mkdir()
            b.mkdir()
            declared = {"type": "http", "url": TEMPLATE, "oauth": {"scopes": "s"},
                        "headers": {"X-DPF-Toolchain": "pack=0.3.0;digest=0123456789abcdef;client=claude-code"}}
            cache_a = _cache(root, "a", declared)
            cache_b = _cache(root, "b", {"url": TEMPLATE, "headers": {"Authorization": "Bearer x"}})
            cache_gone = _cache(root, "gone", {"url": TEMPLATE})
            home = _home(root, [
                {"scope": "project", "projectPath": str(a), "installPath": str(cache_a)},
                {"scope": "local", "projectPath": str(b), "installPath": str(cache_b)},
                {"scope": "project", "projectPath": str(root / "gone"), "installPath": str(cache_gone)},
            ])
            rows = convergence.pin_record_descriptors(home, "https://dpf.example/api/mcp/v1", {}, dry_run=False)
            pinned = json.loads((cache_a / "claude.mcp.json").read_text())["mcpServers"]["dpf"]
            self.assertEqual(pinned["url"], "https://dpf.example/api/mcp/v1?tier=full")
            self.assertEqual(pinned["headers"], declared["headers"])
            self.assertEqual(json.loads((cache_b / "claude.mcp.json").read_text())["mcpServers"]["dpf"]["url"], TEMPLATE)
            self.assertEqual(json.loads((cache_gone / "claude.mcp.json").read_text())["mcpServers"]["dpf"]["url"], TEMPLATE)
            self.assertEqual([row["action"] for row in rows], ["updated", "unchanged"])
            again = convergence.pin_record_descriptors(home, "https://dpf.example/api/mcp/v1", {}, dry_run=False)
            self.assertEqual([row["action"] for row in again], ["unchanged", "unchanged"])

    def test_target_follows_the_pin_hook_rule(self) -> None:
        self.assertEqual(convergence.resolve_pin_target(TEMPLATE, None, {"DPF_CLAUDE_MCP_URL": "https://h/api/mcp/v1?tier=full"}),
                         "https://h/api/mcp/v1?tier=full")
        # BI-D6A6462A: the shared DPF_MCP_URL never steers Claude's pin.
        self.assertEqual(convergence.resolve_pin_target(TEMPLATE, None, {"DPF_MCP_URL": "https://codex-only.example/api/mcp/v1"}),
                         "https://localhost/api/mcp/v1?tier=full")
        self.assertEqual(convergence.resolve_pin_target(CLAUDE_TEMPLATE, None, {}), "https://localhost/api/mcp/v1?tier=full")
        self.assertEqual(convergence.resolve_pin_target(TEMPLATE, None, {"DPF_MCP_URL": "http://[::1]:3000/api/mcp/v1"}),
                         "https://localhost/api/mcp/v1?tier=full")
        self.assertEqual(convergence.resolve_pin_target("http://127.0.0.1:3000/api/mcp/v1", None, {}),
                         convergence.CANONICAL_MCP_URL)
        self.assertEqual(convergence.preserve_query("https://h/api/mcp/v1", TEMPLATE), "https://h/api/mcp/v1?tier=full")


class ReportJsonTest(unittest.TestCase):
    """End to end through main(): every scope reported, every CLI faked."""

    def test_explicit_updated_action_cannot_override_stale_observed_content(self) -> None:
        declared = _Declared()
        key = ("claude-code", "project:fixture")
        stale = {"version": declared.pack, "digest": "old", "authMode": "oauth"}
        current = {**stale, "digest": declared.digest}
        for after, expected in ((stale, "failed"), (current, "converged")):
            with self.subTest(expected=expected), patch.object(convergence, "snapshot", side_effect=[{key: stale}, {key: after}]), patch.object(convergence, "cli_versions", return_value={}):
                report = convergence.ConvergenceReport(Path("fixture"), declared, None)
                report.add(*key, action="updated")
                observed = report.finish(False)
                self.assertEqual(observed["result"], expected)
                self.assertEqual(observed["clients"][0]["action"], "failed" if expected == "failed" else "updated")

    def test_disappeared_installed_record_cannot_reuse_the_before_digest(self) -> None:
        declared = _Declared()
        key = ("claude-code", "local:fixture")
        current = {"version": declared.pack, "digest": declared.digest, "authMode": "oauth"}
        with patch.object(convergence, "snapshot", side_effect=[{key: current}, {}]), patch.object(convergence, "cli_versions", return_value={}):
            report = convergence.ConvergenceReport(Path("fixture"), declared, None)
            report.add(*key, action="unchanged")
            self.assertEqual(report.finish(False)["result"], "failed")

    def test_missing_local_record_keeps_failed_install_in_the_report(self) -> None:
        with patch.object(convergence, "snapshot", return_value={}), patch.object(convergence, "cli_versions", return_value={}), patch.object(updater, "claude_plugin_records", return_value=[]):
            report = convergence.ConvergenceReport(Path("fixture"), _Declared(), None)
            convergence.record_claude_scopes(report, Path("fixture"), "failed: local content unverified", {}, None, [])
            self.assertEqual(report.finish(False)["result"], "failed")

    def test_report_names_each_client_and_scope(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            stale, gone = root / "stale", root / "gone"
            stale.mkdir()
            (stale / ".mcp.json").write_text(json.dumps({"mcpServers": {"dpf": {"url": "http://127.0.0.1:3000/api/mcp/v1"}}}))
            cache = _cache(root, "stale", {"type": "http", "url": TEMPLATE, "oauth": {"scopes": "s"}})
            dpf = {"type": "http", "url": "http://127.0.0.1:3000/api/mcp/v1?tier=full"}
            home = _home(root, [
                {"scope": "project", "projectPath": str(stale), "version": "0.2.5", "installPath": str(cache)},
                {"scope": "project", "projectPath": str(gone), "version": "0.2.5", "installPath": str(root / "nowhere")},
            ], {"mcpServers": {"dpf": dpf}, "projects": {str(stale): {"mcpServers": {"dpf": dpf}}}})
            report_path = root / "report.json"
            env = {"DPF_AGENT_TOOLCHAIN_HOME": str(home), "DPF_MCP_URL": "",
                   "DPF_CLAUDE_MCP_URL": "https://dpf.example/api/mcp/v1"}
            with patch.dict(os.environ, env), \
                    patch.object(updater, "resolve_claude_binary", return_value="/fake/claude"), \
                    patch.object(updater, "resolve_codex_binary", return_value=None), \
                    patch.object(updater, "resolve_grok_binary", return_value=None), \
                    patch.object(updater, "resolve_antigravity_binary", return_value=None), \
                    patch("subprocess.run", return_value=_Result()), patch("builtins.print"):
                code = updater.main(["--skill-pack-path", str(PACK), "--report-json", str(report_path),
                                     "--mcp-url", "https://dpf.example/api/mcp/v1"])
            # A successful fake CLI does not install any bytes: truthfully fail.
            self.assertEqual(code, 1)
            report = json.loads(report_path.read_text())
            rows = {(row["client"], row["scope"]): row for row in report["clients"]}
            digest = delivered_digest(PACK)
            self.assertEqual(report["packDigest"], digest)
            self.assertEqual(report["source"], {"kind": "local"})
            for row in report["clients"]:
                self.assertLessEqual({"before", "after", "action", "restartRequired", "cliVersion"}, set(row))
                self.assertIn(row["action"], ("updated", "unchanged", "retired", "prunable", "failed"))
            shared = rows[("shared", "copy")]
            self.assertEqual((shared["before"]["digest"], shared["after"]["digest"]), (None, digest))
            self.assertEqual(shared["action"], "updated")
            self.assertTrue(shared["restartRequired"])
            self.assertEqual(report["result"], "failed")
            self.assertEqual(rows[("claude-code", f"project:{stale}")]["action"], "failed")
            self.assertEqual(rows[("claude-code", f"project:{gone}")]["action"], "prunable")
            self.assertEqual(rows[("claude-code", f"project-mcp-json:{stale}")]["action"], "retired")
            self.assertTrue(Path(rows[("claude-code", f"project-mcp-json:{stale}")]["backupPath"]).exists())
            self.assertEqual(rows[("claude-code", "user-mcp")]["action"], "retired")
            self.assertTrue(Path(rows[("claude-code", "user-mcp")]["backupPath"]).exists())
            self.assertEqual(rows[("claude-code", f"local-mcp:{stale}")]["action"], "retired")
            self.assertIn(("codex", "user"), rows)
            self.assertIn(("grok", "user"), rows)

            managed = updater.shared_managed_plugin_path(home)
            header = f"pack={report['packVersion']};digest={digest[:16]};client=claude-code"
            self.assertEqual(json.loads((managed / "claude.mcp.json").read_text())["mcpServers"]["dpf"]["headers"],
                             {"X-DPF-Toolchain": header})
            grok_url = json.loads((managed / "grok.mcp.json").read_text())["mcp_servers"]["dpf"]["url"]
            self.assertIn(f"dpf_digest={digest[:16]}", grok_url)
            self.assertIn("dpf_client=grok", grok_url)
            codex = updater.codex_config_path(home).read_text()
            self.assertIn(f'"X-DPF-Toolchain" = "pack={report["packVersion"]};digest={digest[:16]};client=codex"', codex)
            pinned = json.loads((cache / "claude.mcp.json").read_text())["mcpServers"]["dpf"]["url"]
            self.assertEqual(pinned, "https://dpf.example/api/mcp/v1?tier=full")


if __name__ == "__main__":
    unittest.main()
