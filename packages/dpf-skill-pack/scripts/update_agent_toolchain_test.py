import json
import os
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch
import sys

# tomllib is 3.11+; the updater itself must run on the system python3, which
# is 3.9 on stock macOS. Keep the suite importable there so the regression
# tests below run on the interpreter that actually ships with the platform.
try:
    import tomllib
except ImportError:  # Python < 3.11
    tomllib = None

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update_agent_toolchain as updater


class WriteTextIfChangedTest(unittest.TestCase):
    def test_writes_lf_bytes_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "nested" / "settings.json"
            self.assertTrue(updater.write_text_if_changed(target, '{"a": 1}\n'))
            self.assertEqual(target.read_bytes(), b'{"a": 1}\n')
            self.assertFalse(updater.write_text_if_changed(target, '{"a": 1}\n'))
            self.assertTrue(updater.write_text_if_changed(target, '{"a": 2}\n'))
            self.assertEqual(target.read_bytes(), b'{"a": 2}\n')

    def test_no_python310_only_write_text_newline_kwarg(self) -> None:
        # Regression: Path.write_text(newline=...) requires Python 3.10, but
        # scripts/dpf-bootstrap-agent-toolchain.sh runs this script with the
        # system python3 — 3.9 on stock macOS — where it raises TypeError.
        source = Path(updater.__file__).read_text(encoding="utf-8")
        self.assertNotRegex(source, r"write_text\([^)]*newline\s*=")

    def test_main_converges_on_system_python(self) -> None:
        # End-to-end repro of the macOS 3.9 crash: ensure_codex_marketplace
        # -> write_json -> write_text_if_changed raised TypeError. No tomllib
        # here so this test runs on 3.9 where the other suites must skip.
        skill_pack = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ, {"DPF_AGENT_TOOLCHAIN_HOME": tmp}, clear=False):
                code = updater.main([
                    "--skill-pack-path",
                    str(skill_pack),
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                ])
            self.assertEqual(code, 0)
            marketplace = json.loads(
                (Path(tmp) / ".agents" / "plugins" / "marketplace.json").read_text(),
            )
            self.assertEqual(marketplace["plugins"][0]["name"], "dpf-platform")


class InstallGrokHooksTest(unittest.TestCase):
    """The plane-1 guards reach Grok only via ~/.grok/hooks (BI-883FC2FC)."""

    def test_writes_global_hook_file_pointing_at_managed_guards(self) -> None:
        skill_pack = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            managed = home / ".agents" / "plugins" / "plugins" / "dpf-platform"
            updater.copy_skill_pack(skill_pack, managed, dry_run=False)
            status = updater.install_grok_hooks(managed, home, dry_run=False)
            self.assertIn("wired 6 guard", status)
            hook_file = updater.grok_hooks_file(home)
            self.assertTrue(hook_file.exists())
            data = json.loads(hook_file.read_text())
            entries = data["hooks"]["PreToolUse"]
            self.assertEqual(len(entries), 6)
            cmds = [h["command"] for e in entries for h in e["hooks"]]
            # Every command points at an existing managed guard script.
            self.assertTrue(any("lease-punt-guard.mjs" in c for c in cmds))
            self.assertTrue(any("decision-routing-guard.mjs" in c for c in cmds))
            self.assertTrue(any("plan-backlog-coverage-guard.mjs" in c for c in cmds))
            for guard in updater.GROK_HOOK_GUARDS:
                self.assertTrue((managed / "hooks" / guard).exists(), guard)

    def test_dry_run_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            status = updater.install_grok_hooks(home / "managed", home, dry_run=True)
            self.assertIn("dry-run", status)
            self.assertFalse(updater.grok_hooks_file(home).exists())


class HookRosterTest(unittest.TestCase):
    """The trust-UI roster must name+describe every hook (BI-276EC984)."""

    def test_every_hooks_json_command_hook_has_a_purpose(self) -> None:
        skill_pack = Path(__file__).resolve().parents[1]
        data = json.loads((skill_pack / "hooks" / "hooks.json").read_text())
        missing = []
        for groups in data.get("hooks", {}).values():
            for group in groups if isinstance(groups, list) else []:
                for hook in group.get("hooks", []) if isinstance(group, dict) else []:
                    base = updater.hook_script_basename(hook.get("command", ""))
                    if base and base not in updater.HOOK_PURPOSES:
                        missing.append(base)
        self.assertEqual(missing, [], f"hooks missing a HOOK_PURPOSES entry: {missing}")

    def test_roster_enumerates_named_hooks(self) -> None:
        skill_pack = Path(__file__).resolve().parents[1]
        lines = updater.hook_roster(skill_pack)
        self.assertTrue(lines and lines[0].startswith("Plugin hooks"))
        blob = "\n".join(lines)
        self.assertIn("lease-punt-guard.mjs", blob)
        self.assertIn("decision-routing-guard.mjs", blob)
        # numbered like the trust UI, and carries a purpose (em dash separator)
        self.assertRegex(blob, r"Hook 1[^\n]*: [A-Za-z0-9_.-]+\.mjs — ")

    def test_basename_extractor(self) -> None:
        self.assertEqual(
            updater.hook_script_basename('node "${CLAUDE_PLUGIN_ROOT}/hooks/lease-punt-guard.mjs"'),
            "lease-punt-guard.mjs",
        )
        self.assertIsNone(updater.hook_script_basename("echo hi"))


class UpdateAgentToolchainTest(unittest.TestCase):
    @unittest.skipIf(tomllib is None, "tomllib requires Python 3.11+")
    def test_converges_codex_and_claude_marketplaces_in_temp_home(self) -> None:
        skill_pack = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ, {"DPF_AGENT_TOOLCHAIN_HOME": tmp}, clear=False):
                code = updater.main([
                    "--skill-pack-path",
                    str(skill_pack),
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                ])

            self.assertEqual(code, 0)
            home = Path(tmp)

            managed = home / ".agents" / "plugins" / "plugins" / "dpf-platform"
            self.assertTrue((managed / ".codex-plugin" / "plugin.json").exists())
            self.assertTrue((managed / ".claude-plugin" / "plugin.json").exists())
            self.assertTrue((managed / "skills").exists())
            self.assertTrue((managed / "hooks" / "plan-backlog-coverage-guard.mjs").exists())

            codex_config = tomllib.loads((home / ".codex" / "config.toml").read_text())
            self.assertTrue(codex_config["plugins"]["dpf-platform"]["enabled"])
            self.assertEqual(
                codex_config["mcp_servers"]["dpf"]["bearer_token_env_var"],
                "DPF_MCP_BEARER_TOKEN",
            )
            codex_hooks = json.loads((home / ".codex" / "hooks.json").read_text())
            write_groups = [
                group for group in codex_hooks["hooks"]["PreToolUse"]
                if group.get("matcher") == "Write|Edit|MultiEdit"
            ]
            self.assertTrue(write_groups)
            self.assertTrue(any(
                "plan-backlog-coverage-guard.mjs" in hook.get("command", "")
                for group in write_groups for hook in group.get("hooks", [])
            ))

            codex_marketplace = json.loads(
                (home / ".agents" / "plugins" / "marketplace.json").read_text(),
            )
            self.assertEqual(codex_marketplace["plugins"][0]["name"], "dpf-platform")
            self.assertEqual(
                codex_marketplace["plugins"][0]["policy"]["installation"],
                "INSTALLED_BY_DEFAULT",
            )

            claude_marketplace = json.loads(
                (home / ".agents" / "plugins" / ".claude-plugin" / "marketplace.json").read_text(),
            )
            self.assertEqual(claude_marketplace["name"], "dpf-platform-local")
            self.assertEqual(claude_marketplace["plugins"][0]["source"], "./plugins/dpf-platform")

    @unittest.skipIf(tomllib is None, "tomllib requires Python 3.11+")
    def test_replaces_existing_codex_blocks_without_clobbering_other_settings(self) -> None:
        skill_pack = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config = home / ".codex" / "config.toml"
            config.parent.mkdir(parents=True)
            config.write_text(
                'model = "gpt-5.5"\n'
                '[plugins."dpf-platform"]\n'
                'enabled = false\n'
                '[mcp_servers.dpf]\n'
                'url = "http://old.example.test"\n',
                encoding="utf-8",
            )

            with patch.dict(os.environ, {"DPF_AGENT_TOOLCHAIN_HOME": tmp}, clear=False):
                updater.main([
                    "--skill-pack-path",
                    str(skill_pack),
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                    "--mcp-url",
                    "https://mcp.example.test/api/mcp/v1",
                ])

            data = tomllib.loads(config.read_text())
            self.assertEqual(data["model"], "gpt-5.5")
            self.assertTrue(data["plugins"]["dpf-platform"]["enabled"])
            self.assertEqual(data["mcp_servers"]["dpf"]["url"], "https://mcp.example.test/api/mcp/v1")

    @unittest.skipIf(tomllib is None, "tomllib requires Python 3.11+")
    def test_disables_competitive_codex_plugins_without_deleting_user_config(self) -> None:
        skill_pack = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config = home / ".codex" / "config.toml"
            config.parent.mkdir(parents=True)
            config.write_text(
                'model = "gpt-5.5"\n'
                '[plugins."superpowers@openai-curated"]\n'
                "enabled = true\n"
                '[plugins."custom-helper"]\n'
                "enabled = true\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {"DPF_AGENT_TOOLCHAIN_HOME": tmp}, clear=False):
                updater.main([
                    "--skill-pack-path",
                    str(skill_pack),
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                ])

            data = tomllib.loads(config.read_text())
            self.assertTrue(data["plugins"]["dpf-platform"]["enabled"])
            self.assertFalse(data["plugins"]["superpowers@openai-curated"]["enabled"])
            self.assertTrue(data["plugins"]["custom-helper"]["enabled"])

    def test_cleanup_policy_names_safe_codex_reconciliation(self) -> None:
        policy = updater.load_process_spine_cleanup_policy()
        self.assertEqual(policy["mode"], "disable-not-delete")
        codex = next(client for client in policy["clients"] if client["client"] == "codex")
        self.assertIn("superpowers@openai-curated", codex["competitivePluginIds"])
        self.assertEqual(codex["action"], "disable-plugin")

    def test_reuses_bare_codex_plugin_table_instead_of_appending_duplicate(self) -> None:
        skill_pack = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config = home / ".codex" / "config.toml"
            config.parent.mkdir(parents=True)
            config.write_text(
                'model = "gpt-5.5"\n'
                "[plugins.dpf-platform]\n"
                "enabled = true\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {"DPF_AGENT_TOOLCHAIN_HOME": tmp}, clear=False):
                updater.main([
                    "--skill-pack-path",
                    str(skill_pack),
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                ])

            raw = config.read_text()
            if tomllib is not None:
                data = tomllib.loads(raw)
                self.assertTrue(data["plugins"]["dpf-platform"]["enabled"])
            self.assertEqual(raw.count("dpf-platform"), 1)

    def test_heals_config_already_corrupted_with_duplicate_table(self) -> None:
        """A config a pre-#2657 updater left with a stray appended
        `[mcp_servers.dpf]` (a TOML redefinition error) is healed back to a single
        table on the next run, rather than forcing the operator to hand-delete the
        duplicate every time. Unrelated tables are left intact."""
        skill_pack = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config = home / ".codex" / "config.toml"
            config.parent.mkdir(parents=True)
            config.write_text(
                'model = "gpt-5.5"\n\n'
                "[mcp_servers.dpf]\n"
                'url = "http://127.0.0.1:3000/api/mcp/v1"\n'
                'bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"\n'
                "enabled = true\n\n"
                "[mcp_servers.node_repl]\n"
                'command = "node"\n\n'
                # The stray duplicate a pre-fix fallback run appended at the end.
                "[mcp_servers.dpf]\n"
                'url = "http://127.0.0.1:3000/api/mcp/v1"\n'
                'bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"\n'
                "enabled = true\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {"DPF_AGENT_TOOLCHAIN_HOME": tmp}, clear=False):
                updater.main([
                    "--skill-pack-path",
                    str(skill_pack),
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                ])

            raw = config.read_text()
            self.assertEqual(raw.count("[mcp_servers.dpf]"), 1)
            if tomllib is not None:
                data = tomllib.loads(raw)  # raises if a duplicate table survives
                self.assertEqual(data["mcp_servers"]["node_repl"]["command"], "node")
                self.assertEqual(data["model"], "gpt-5.5")

    @unittest.skipIf(tomllib is None, "tomllib requires Python 3.11+")
    def test_repairs_missing_managed_plugin_without_token_or_portal(self) -> None:
        skill_pack = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(
                os.environ,
                {"DPF_AGENT_TOOLCHAIN_HOME": tmp},
                clear=True,
            ):
                code = updater.main([
                    "--skill-pack-path",
                    str(skill_pack),
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                ])

            self.assertEqual(code, 0)
            home = Path(tmp)
            managed = home / ".agents" / "plugins" / "plugins" / "dpf-platform"
            self.assertTrue((managed / ".codex-plugin" / "plugin.json").exists())
            self.assertTrue((managed / "skills" / "dpf-worktree-per-session" / "SKILL.md").exists())

            codex_config = tomllib.loads((home / ".codex" / "config.toml").read_text())
            self.assertTrue(codex_config["plugins"]["dpf-platform"]["enabled"])
            self.assertEqual(
                codex_config["mcp_servers"]["dpf"]["bearer_token_env_var"],
                "DPF_MCP_BEARER_TOKEN",
            )


class GrokInstallTest(unittest.TestCase):
    def test_install_skipped_when_grok_binary_absent(self) -> None:
        with patch.object(updater, "resolve_grok_binary", return_value=None):
            status = updater.install_grok_plugin(Path("/tmp/managed"), dry_run=False)
        self.assertEqual(status, "skipped: Grok CLI not found")

    def test_dry_run_never_shells_out(self) -> None:
        with patch.object(updater, "resolve_grok_binary", return_value="/fake/grok"), patch(
            "subprocess.run"
        ) as run:
            status = updater.install_grok_plugin(Path("/tmp/managed"), dry_run=True)
        run.assert_not_called()
        self.assertIn("dry-run", status)

    def test_install_invokes_grok_plugin_install_trust_from_managed(self) -> None:
        class _Result:
            returncode = 0
            stdout = "[]"
            stderr = ""

        with patch.object(updater, "resolve_grok_binary", return_value="/fake/grok"), patch(
            "subprocess.run", return_value=_Result()
        ) as run:
            status = updater.install_grok_plugin(Path("/tmp/managed"), dry_run=False)
        self.assertEqual(status, "installed")
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[0][0][0], ["/fake/grok", "plugin", "list", "--json"])
        argv = run.call_args_list[1][0][0]
        self.assertEqual(argv, ["/fake/grok", "plugin", "install", str(Path("/tmp/managed")), "--trust"])

    def test_existing_grok_plugin_is_reinstalled_from_refreshed_managed_copy(self) -> None:
        class _Result:
            def __init__(self, stdout: str = "") -> None:
                self.returncode = 0
                self.stdout = stdout
                self.stderr = ""

        results = [
            _Result('[{"name":"dpf-platform","version":"0.2.2"}]'),
            _Result(),
            _Result(),
        ]
        with patch.object(updater, "resolve_grok_binary", return_value="/fake/grok"), patch(
            "subprocess.run", side_effect=results
        ) as run:
            status = updater.install_grok_plugin(Path("/tmp/managed"), dry_run=False)
        self.assertEqual(status, "reinstalled")
        self.assertEqual(
            [call[0][0] for call in run.call_args_list],
            [
                ["/fake/grok", "plugin", "list", "--json"],
                ["/fake/grok", "plugin", "uninstall", "dpf-platform", "--confirm", "--keep-data"],
                ["/fake/grok", "plugin", "install", str(Path("/tmp/managed")), "--trust"],
            ],
        )

    def test_install_reports_failure_without_raising(self) -> None:
        class _Result:
            returncode = 3
            stdout = ""
            stderr = "boom"

        with patch.object(updater, "resolve_grok_binary", return_value="/fake/grok"), patch(
            "subprocess.run", return_value=_Result()
        ):
            status = updater.install_grok_plugin(Path("/tmp/managed"), dry_run=False)
        self.assertIn("failed", status)


class ClaudeInstallTest(unittest.TestCase):
    def test_install_also_updates_an_existing_cached_plugin(self) -> None:
        class _Result:
            returncode = 0
            stdout = ""
            stderr = ""

        with patch.object(updater, "resolve_claude_binary", return_value="/fake/claude"), patch(
            "subprocess.run", return_value=_Result()
        ) as run:
            status = updater.install_claude_plugin(Path("/tmp/home"), dry_run=False)
        self.assertEqual(status, "installed and refreshed")
        self.assertEqual(
            [call[0][0] for call in run.call_args_list],
            [
                ["/fake/claude", "plugin", "marketplace", "add", "/tmp/home/.agents/plugins", "--scope", "local"],
                ["/fake/claude", "plugin", "install", "dpf-platform@dpf-platform-local", "--scope", "local"],
                ["/fake/claude", "plugin", "update", "dpf-platform@dpf-platform-local", "--scope", "local"],
            ],
        )


class AntigravityMcpConfigTest(unittest.TestCase):
    def test_skipped_when_agy_absent(self) -> None:
        with patch.object(updater, "resolve_antigravity_binary", return_value=None):
            status = updater.ensure_antigravity_mcp_config(
                Path("/tmp/home"), updater.DEFAULT_MCP_URL, dry_run=False
            )
        self.assertEqual(status, "skipped: Antigravity CLI (agy) not found")

    def test_upserts_dpf_server_env_backed_and_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            with patch.object(updater, "resolve_antigravity_binary", return_value="/fake/agy"):
                first = updater.ensure_antigravity_mcp_config(
                    home, updater.DEFAULT_MCP_URL, dry_run=False
                )
                second = updater.ensure_antigravity_mcp_config(
                    home, updater.DEFAULT_MCP_URL, dry_run=False
                )
            self.assertEqual(first, "converged")
            self.assertEqual(second, "already current")
            cfg = json.loads(updater.antigravity_mcp_config_path(home).read_text())
            dpf = cfg["mcpServers"]["dpf"]
            self.assertEqual(dpf["type"], "http")
            self.assertEqual(dpf["url"], updater.DEFAULT_MCP_URL)
            self.assertEqual(dpf["headers"]["Authorization"], "Bearer ${DPF_MCP_BEARER_TOKEN}")
            # No plaintext secret is ever written.
            self.assertNotIn("dpfmcp_", updater.antigravity_mcp_config_path(home).read_text())

    def test_merges_without_clobbering_other_servers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            cfg_path = updater.antigravity_mcp_config_path(home)
            cfg_path.parent.mkdir(parents=True, exist_ok=True)
            cfg_path.write_text(json.dumps({"mcpServers": {"other": {"url": "x"}}}))
            with patch.object(updater, "resolve_antigravity_binary", return_value="/fake/agy"):
                updater.ensure_antigravity_mcp_config(home, updater.DEFAULT_MCP_URL, dry_run=False)
            cfg = json.loads(cfg_path.read_text())
            self.assertIn("other", cfg["mcpServers"])
            self.assertIn("dpf", cfg["mcpServers"])

    def test_dry_run_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            with patch.object(updater, "resolve_antigravity_binary", return_value="/fake/agy"):
                status = updater.ensure_antigravity_mcp_config(
                    home, updater.DEFAULT_MCP_URL, dry_run=True
                )
            self.assertIn("dry-run", status)
            self.assertFalse(updater.antigravity_mcp_config_path(home).exists())


class GuardLivenessAdvisoryTest(unittest.TestCase):
    def test_advisory_names_codex_trust_and_grok_blocking_gap(self) -> None:
        text = "\n".join(updater.guard_liveness_advisory()).lower()
        # Codex: the fail-open-until-trusted condition must be named.
        self.assertIn("codex", text)
        self.assertIn("trust", text)
        # Grok: the blocking-hook-contract gap must be named, not hidden.
        self.assertIn("grok", text)
        self.assertIn("block", text)


class ProcessSpineHealthTest(unittest.TestCase):
    def test_replacement_contract_names_retired_process_equivalents(self) -> None:
        slugs = [entry["dpfSkill"] for entry in updater.load_process_spine_contract()]
        self.assertEqual(
            slugs,
            [
                "dpf-brainstorming",
                "dpf-writing-plans",
                "dpf-tdd",
                "dpf-systematic-debugging",
                "dpf-finishing-a-development-branch",
            ],
        )

    def test_reports_generic_brainstorming_exposed_without_dpf_replacement(self) -> None:
        skill_pack = Path(__file__).resolve().parents[1]
        verdict = updater.assess_process_spine_health(
            skill_pack,
            exposed_skills=["superpowers:brainstorming"],
        )
        self.assertTrue(verdict["installed"]["ok"])
        self.assertEqual(verdict["exposed"]["state"], "verified")
        self.assertEqual([c["dpfSkill"] for c in verdict["conflicts"]], ["dpf-brainstorming"])
        text = "\n".join(updater.render_process_spine_health(verdict))
        self.assertIn("DPF-native replacement skills are not active", text)

    def test_unknown_active_skill_evidence_is_readiness_warning(self) -> None:
        skill_pack = Path(__file__).resolve().parents[1]
        verdict = updater.assess_process_spine_health(skill_pack, exposed_skills=None)
        self.assertTrue(verdict["installed"]["ok"])
        self.assertEqual(verdict["exposed"]["state"], "unknown")
        self.assertEqual(verdict["severity"], "warn")
        text = "\n".join(updater.render_process_spine_health(verdict))
        self.assertIn("UNKNOWN", text)
        self.assertIn("cannot prove replacements are loaded", text)


class GrokCodexGuardSyncTest(unittest.TestCase):
    """Drift guard (BI-14E9F7CE, EP-CLIENT-HOOK-PLANE).

    GROK_HOOK_GUARDS / CODEX_BASH_GUARDS / CODEX_ASK_GUARDS / CODEX_WRITE_GUARDS
    are hand-maintained tuples, wholly independent of hooks/hooks.json. That is
    load-bearing, not incidental: live probe (BI-883FC2FC, Grok 0.2.87) proved
    Grok's hook-execution plane IGNORES the plugin-bundled hooks/hooks.json
    entirely (a plugin shows has_hooks=true in inventory yet contributes
    total_hooks=0) -- so hooks.json's `${CLAUDE_PLUGIN_ROOT}` tokens are inert
    for Grok's actual guard enforcement regardless of whether that variable
    resolves. The REAL enforcement path for Grok is the global
    ~/.grok/hooks/dpf-guards.json this script writes with fully pre-resolved
    absolute paths (install_grok_hooks) -- so GROK_HOOK_GUARDS is the only
    thing that wires a guard to Grok at all. Same shape for Codex's user hook
    plane (~/.codex/hooks.json / install_codex_hooks), which the plugin-bundled
    hooks.json also does not populate directly.

    Because nothing type-checks these tuples against hooks.json, a new BLOCKING
    guard (one that calls emitDeny) added to hooks.json's PreToolUse wiring
    without a matching addition here silently never reaches Grok or Codex --
    exactly the "guard hooks may silently not fire" failure mode this backlog
    item exists to close. These tests fail CI the moment that drift happens.
    """

    @staticmethod
    def _skill_pack() -> Path:
        return Path(__file__).resolve().parents[1]

    @classmethod
    def _hooks_json(cls) -> dict[str, Any]:
        return json.loads((cls._skill_pack() / "hooks" / "hooks.json").read_text())

    @classmethod
    def _pretooluse_guards_by_matcher(cls) -> dict[str, set[str]]:
        data = cls._hooks_json()
        by_matcher: dict[str, set[str]] = {}
        for group in data.get("hooks", {}).get("PreToolUse", []):
            matcher = str(group.get("matcher", ""))
            names = by_matcher.setdefault(matcher, set())
            for hook in group.get("hooks", []):
                base = updater.hook_script_basename(str(hook.get("command", "")))
                if base:
                    names.add(base)
        return by_matcher

    @classmethod
    def _is_blocking(cls, basename: str) -> bool:
        """A guard is BLOCKING (can deny a tool call) iff its source calls
        emitDeny(...) (hooks/lib/hook-io.mjs). Advisory prechecks only ever
        call emitContext(...) and must never fire on Grok/Codex's blocking
        planes -- Grok's PreToolUse hook has no non-blocking channel."""
        src = (cls._skill_pack() / "hooks" / basename).read_text(encoding="utf-8")
        return "emitDeny(" in src

    def test_grok_hook_guards_match_every_blocking_pretooluse_guard_in_hooks_json(self) -> None:
        by_matcher = self._pretooluse_guards_by_matcher()
        all_guards = {name for names in by_matcher.values() for name in names}
        blocking = {name for name in all_guards if self._is_blocking(name)}
        self.assertEqual(
            set(updater.GROK_HOOK_GUARDS),
            blocking,
            "GROK_HOOK_GUARDS has drifted from hooks/hooks.json's blocking PreToolUse "
            "guards. Grok's hook plane ignores plugin-bundled hooks.json (BI-883FC2FC) -- "
            "GROK_HOOK_GUARDS is the ONLY thing wiring a guard into Grok's global "
            "~/.grok/hooks/dpf-guards.json. Add/remove it there too or it silently never "
            "fires on Grok.",
        )

    def test_codex_guard_tuples_match_hooks_json_per_matcher(self) -> None:
        by_matcher = self._pretooluse_guards_by_matcher()

        def blocking_for(matcher: str) -> set[str]:
            return {name for name in by_matcher.get(matcher, set()) if self._is_blocking(name)}

        self.assertEqual(
            set(updater.CODEX_BASH_GUARDS),
            blocking_for("Bash"),
            "CODEX_BASH_GUARDS has drifted from hooks.json's blocking Bash-matcher guards.",
        )
        self.assertEqual(
            set(updater.CODEX_ASK_GUARDS),
            blocking_for("AskUserQuestion"),
            "CODEX_ASK_GUARDS has drifted from hooks.json's blocking AskUserQuestion-matcher guards.",
        )
        self.assertEqual(
            set(updater.CODEX_WRITE_GUARDS),
            blocking_for("Write|Edit|MultiEdit"),
            "CODEX_WRITE_GUARDS has drifted from hooks.json's blocking Write|Edit|MultiEdit guards.",
        )

    def test_no_blocking_guard_is_left_unwired_on_either_surface(self) -> None:
        by_matcher = self._pretooluse_guards_by_matcher()
        all_guards = {name for names in by_matcher.values() for name in names}
        blocking = {name for name in all_guards if self._is_blocking(name)}
        codex_all = (
            set(updater.CODEX_BASH_GUARDS)
            | set(updater.CODEX_ASK_GUARDS)
            | set(updater.CODEX_WRITE_GUARDS)
        )
        self.assertEqual(blocking, codex_all, "a blocking guard is missing from the Codex tuples")
        self.assertEqual(blocking, set(updater.GROK_HOOK_GUARDS), "a blocking guard is missing from GROK_HOOK_GUARDS")


class CodexHookTrustTest(unittest.TestCase):
    def test_trust_pending_when_no_state_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / ".codex").mkdir()
            (home / ".codex" / "config.toml").write_text("[features]\nhooks = true\n", encoding="utf-8")
            self.assertFalse(updater.codex_hook_trust_established(home))
            self.assertTrue(updater.codex_hook_trust_pending(home, codex_present=True))

    def test_trust_established_when_config_carries_trusted_hash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / ".codex").mkdir()
            (home / ".codex" / "config.toml").write_text(
                '[hooks.state."~/.codex/hooks.json:PreToolUse:0:0"]\n'
                'trusted_hash = "abc123"\n',
                encoding="utf-8",
            )
            self.assertTrue(updater.codex_hook_trust_established(home))
            self.assertFalse(updater.codex_hook_trust_pending(home, codex_present=True))

    def test_install_codex_hooks_merges_without_clobbering_foreign_hooks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            managed = home / "managed"
            hooks_dir = managed / "hooks"
            hooks_dir.mkdir(parents=True)
            for guard in updater.CODEX_BASH_GUARDS:
                (hooks_dir / guard).write_text("// stub\n", encoding="utf-8")
            for guard in updater.CODEX_ASK_GUARDS:
                (hooks_dir / guard).write_text("// stub\n", encoding="utf-8")
            (home / ".codex").mkdir()
            foreign = {
                "hooks": {
                    "PreToolUse": [
                        {
                            "matcher": "Bash",
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "node /foreign/wrapper.js",
                                }
                            ],
                        }
                    ]
                }
            }
            (home / ".codex" / "hooks.json").write_text(json.dumps(foreign), encoding="utf-8")
            status = updater.install_codex_hooks(managed, home, dry_run=False)
            self.assertIn("merged", status)
            merged = json.loads((home / ".codex" / "hooks.json").read_text())
            bash_group = next(
                g for g in merged["hooks"]["PreToolUse"] if g.get("matcher") == "Bash"
            )
            commands = [h["command"] for h in bash_group["hooks"]]
            self.assertIn("node /foreign/wrapper.js", commands)
            self.assertTrue(any("lease-punt-guard.mjs" in c for c in commands))

    def test_main_exits_2_when_trust_required_and_pending(self) -> None:
        skill_pack = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / ".codex").mkdir()
            with patch.object(updater, "home_dir", return_value=home), patch.object(
                updater, "resolve_codex_binary", return_value="/fake/codex"
            ), patch.object(updater, "copy_skill_pack", return_value=True), patch.object(
                updater, "ensure_codex_marketplace", return_value=True
            ), patch.object(
                updater, "ensure_codex_config", return_value=True
            ), patch.object(
                updater, "install_codex_hooks", return_value="merged"
            ), patch.object(
                updater, "install_grok_plugin", return_value="skipped"
            ), patch.object(
                updater, "install_grok_hooks", return_value="skipped"
            ), patch.dict(os.environ, {}, clear=False):
                os.environ.pop("DPF_REQUIRE_CODEX_HOOK_TRUST", None)
                code = updater.main(
                    [
                        "--skill-pack-path",
                        str(skill_pack),
                        "--skip-claude-cli-install",
                        "--skip-grok-cli-install",
                        "--require-codex-hook-trust",
                    ]
                )
            self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
