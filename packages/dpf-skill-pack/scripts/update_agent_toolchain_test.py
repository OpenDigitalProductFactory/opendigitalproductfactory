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


class McpCatalogTierTest(unittest.TestCase):
    def test_adds_full_tier_without_dropping_existing_query(self) -> None:
        self.assertEqual(
            updater.with_mcp_catalog_tier(
                "https://mcp.example.test/api/mcp/v1?tenant=demo&tier=core",
                "full",
            ),
            "https://mcp.example.test/api/mcp/v1?tenant=demo&tier=full",
        )


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
                    "--skip-codex-cli-install",
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
            # Derived, not hardcoded: adding a blocking guard to hooks.json must
            # not make this assertion rot (the drift tests above already pin the
            # roster itself against hooks.json).
            #
            # Count WIRED ENTRIES, not unique guard names. Those were the same
            # number only while every guard sat in exactly one matcher group;
            # workroom-claim-guard.mjs (BI-0B292D84) is wired on both the shell
            # and the write matcher, exactly as hooks.json wires it for Claude,
            # so len(GROK_HOOK_GUARDS) undercounts. The matchers are disjoint,
            # so a guard in two groups still fires at most once per call.
            wired_entries = sum(len(guards) for _matcher, guards in updater.GROK_PRETOOLUSE_GROUPS)
            self.assertIn(f"wired {wired_entries} PreToolUse guard", status)
            self.assertIn("matcher group", status)
            self.assertIn("SessionStart+Stop", status)
            hook_file = updater.grok_hooks_file(home)
            self.assertTrue(hook_file.exists())
            data = json.loads(hook_file.read_text())
            entries = data["hooks"]["PreToolUse"]
            # Matcher-scoped groups (not one group per script) so Grok does not
            # run every guard on every tool call.
            self.assertEqual(len(entries), 3)
            self.assertTrue(all(e.get("matcher") for e in entries))
            cmds = [h["command"] for e in entries for h in e["hooks"]]
            # Wired entries, not unique names — see the note above: a guard may be
            # wired on more than one disjoint matcher.
            self.assertEqual(len(cmds), wired_entries)
            self.assertTrue(any("lease-punt-guard.mjs" in c for c in cmds))
            shell_group = next(e for e in entries if "Shell" in str(e.get("matcher")))
            self.assertTrue(any("lease-guard.mjs" in h["command"] for h in shell_group["hooks"]))
            for guard in updater.GROK_HOOK_GUARDS:
                self.assertTrue((managed / "hooks" / guard).exists(), guard)
            session_cmds = [
                h["command"]
                for e in data["hooks"]["SessionStart"]
                for h in e["hooks"]
            ]
            self.assertTrue(any("grok-session-start.mjs" in c for c in session_cmds))
            self.assertTrue(any("worktree-session-hygiene.mjs" in c for c in session_cmds))
            stop_cmds = [h["command"] for e in data["hooks"]["Stop"] for h in e["hooks"]]
            self.assertTrue(any("uncommitted-work-guard.mjs" in c for c in stop_cmds))
            # BI-E5D810B8: Stop fires every turn, so it must never carry the
            # destructive reaper — that removed the worktree the session was
            # still working in, the moment its own PR merged.
            self.assertFalse(
                any("worktree-session-hygiene.mjs" in c for c in stop_cmds),
                f"worktree-session-hygiene must not run on Grok Stop: {stop_cmds}",
            )
            self.assertIn("SessionEnd", data["hooks"])
            end_cmds = [h["command"] for e in data["hooks"]["SessionEnd"] for h in e["hooks"]]
            self.assertTrue(any("worktree-session-hygiene.mjs" in c for c in end_cmds))

    def test_dry_run_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            status = updater.install_grok_hooks(home / "managed", home, dry_run=True)
            self.assertIn("dry-run", status)
            self.assertFalse(updater.grok_hooks_file(home).exists())

    def test_disable_competitive_grok_plugins_skips_when_no_cli(self) -> None:
        with patch.object(updater, "resolve_grok_binary", return_value=None):
            status = updater.disable_competitive_grok_plugins(dry_run=False)
            self.assertIn("skipped: Grok CLI not found", status)

    def test_disable_competitive_grok_plugins_dry_run(self) -> None:
        with patch.object(updater, "resolve_grok_binary", return_value="grok"):
            status = updater.disable_competitive_grok_plugins(dry_run=True)
            self.assertIn("dry-run", status)

    def test_disable_competitive_grok_plugins_disables_active(self) -> None:
        from unittest.mock import Mock

        list_payload = json.dumps(
            [
                {"name": "superpowers", "enabled": True, "status": "installed"},
                {"name": "dpf-platform", "enabled": True, "status": "installed"},
            ]
        )

        def fake_run(cmd, capture_output=True, text=True):  # type: ignore[no-untyped-def]
            if cmd[1:3] == ["plugin", "list"]:
                return Mock(returncode=0, stdout=list_payload, stderr="")
            if cmd[1:3] == ["plugin", "disable"]:
                return Mock(returncode=0, stdout="", stderr="")
            return Mock(returncode=1, stdout="", stderr="unexpected")

        with patch.object(updater, "resolve_grok_binary", return_value="grok"):
            with patch.object(updater.subprocess, "run", side_effect=fake_run):
                status = updater.disable_competitive_grok_plugins(dry_run=False)
        self.assertIn("disabled", status)
        self.assertIn("superpowers", status)


class ClaudeCompetitiveDisableTest(unittest.TestCase):
    """Claude competitive cleanup (BI-A4BEFE99) — disable-not-delete via CLI."""

    def test_disable_competitive_claude_plugins_skips_when_no_cli(self) -> None:
        with patch.object(updater, "resolve_claude_binary", return_value=None):
            status = updater.disable_competitive_claude_plugins(dry_run=False)
            self.assertIn("skipped: Claude CLI not found", status)

    def test_disable_competitive_claude_plugins_dry_run(self) -> None:
        with patch.object(updater, "resolve_claude_binary", return_value="claude"):
            status = updater.disable_competitive_claude_plugins(dry_run=True)
            self.assertIn("dry-run", status)

    def test_claude_plugin_matches_bare_and_qualified(self) -> None:
        self.assertTrue(
            updater._claude_plugin_matches("superpowers@openai-curated", "superpowers")
        )
        self.assertTrue(
            updater._claude_plugin_matches(
                "superpowers@openai-curated", "superpowers@openai-curated"
            )
        )
        self.assertFalse(
            updater._claude_plugin_matches(
                "superpowers@other-market", "superpowers@openai-curated"
            )
        )
        self.assertFalse(
            updater._claude_plugin_matches("dpf-platform@dpf-platform-local", "superpowers")
        )

    def test_disable_competitive_claude_plugins_disables_active_with_scope(self) -> None:
        from unittest.mock import Mock

        list_payload = json.dumps(
            [
                {
                    "id": "superpowers@openai-curated",
                    "enabled": True,
                    "scope": "user",
                },
                {
                    "id": "dpf-platform@dpf-platform-local",
                    "enabled": True,
                    "scope": "local",
                },
                {
                    "id": "code-review@claude-code-plugins",
                    "enabled": True,
                    "scope": "project",
                },
            ]
        )
        disable_cmds: list[list[str]] = []

        def fake_run(cmd, capture_output=True, text=True):  # type: ignore[no-untyped-def]
            if cmd[1:3] == ["plugin", "list"]:
                return Mock(returncode=0, stdout=list_payload, stderr="")
            if cmd[1:3] == ["plugin", "disable"]:
                disable_cmds.append(list(cmd))
                return Mock(returncode=0, stdout="", stderr="")
            return Mock(returncode=1, stdout="", stderr="unexpected")

        with patch.object(updater, "resolve_claude_binary", return_value="claude"):
            with patch.object(updater.subprocess, "run", side_effect=fake_run):
                status = updater.disable_competitive_claude_plugins(dry_run=False)

        self.assertIn("disabled", status)
        self.assertIn("superpowers@openai-curated", status)
        self.assertEqual(len(disable_cmds), 1)
        self.assertEqual(
            disable_cmds[0],
            ["claude", "plugin", "disable", "superpowers@openai-curated", "--scope", "user"],
        )
        # Must never disable dpf-platform or unrelated plugins
        self.assertNotIn("dpf-platform", status.split("disabled")[-1] if "disabled" in status else "")
        self.assertTrue(all("code-review" not in " ".join(c) for c in disable_cmds))

    def test_cleanup_policy_claude_reconciles(self) -> None:
        policy = updater.load_process_spine_cleanup_policy()
        claude = next(c for c in policy["clients"] if c["client"] == "claude")
        self.assertEqual(claude["status"], "reconciles-safe-config")
        self.assertEqual(claude["action"], "disable-plugin")
        antigravity = next(c for c in policy["clients"] if c["client"] == "antigravity")
        self.assertEqual(antigravity["status"], "unsupported-until-proven")
        self.assertIn("warn", antigravity["action"])


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
    def test_client_managed_paths_match_marketplace_resolution(self) -> None:
        home = Path("/operator-home")
        self.assertEqual(
            updater.codex_managed_plugin_path(home),
            home / "plugins" / "dpf-platform",
        )
        self.assertEqual(
            updater.shared_managed_plugin_path(home),
            home / ".agents" / "plugins" / "plugins" / "dpf-platform",
        )

    @unittest.skipIf(tomllib is None, "tomllib requires Python 3.11+")
    def test_converges_codex_and_claude_marketplaces_in_temp_home(self) -> None:
        skill_pack = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ, {"DPF_AGENT_TOOLCHAIN_HOME": tmp}, clear=False):
                code = updater.main([
                    "--skill-pack-path",
                    str(skill_pack),
                    "--skip-codex-cli-install",
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                ])

            self.assertEqual(code, 0)
            home = Path(tmp)

            codex_managed = home / "plugins" / "dpf-platform"
            shared_managed = home / ".agents" / "plugins" / "plugins" / "dpf-platform"
            for managed in (codex_managed, shared_managed):
                self.assertTrue((managed / ".codex-plugin" / "plugin.json").exists())
                self.assertTrue((managed / ".claude-plugin" / "plugin.json").exists())
                self.assertTrue((managed / "skills").exists())
                self.assertTrue((managed / "hooks" / "plan-backlog-coverage-guard.mjs").exists())

            codex_config = tomllib.loads((home / ".codex" / "config.toml").read_text())
            self.assertTrue(codex_config["plugins"]["dpf-platform@personal"]["enabled"])
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
                    "--skip-codex-cli-install",
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                    "--mcp-url",
                    "https://mcp.example.test/api/mcp/v1",
                ])

            data = tomllib.loads(config.read_text())
            self.assertEqual(data["model"], "gpt-5.5")
            self.assertFalse(data["plugins"]["dpf-platform@personal"]["enabled"])
            self.assertNotIn("dpf-platform", data["plugins"])
            self.assertEqual(
                data["mcp_servers"]["dpf"]["url"],
                "https://mcp.example.test/api/mcp/v1?tier=full",
            )

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
                    "--skip-codex-cli-install",
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                ])

            data = tomllib.loads(config.read_text())
            self.assertTrue(data["plugins"]["dpf-platform@personal"]["enabled"])
            self.assertFalse(data["plugins"]["superpowers@openai-curated"]["enabled"])
            self.assertTrue(data["plugins"]["custom-helper"]["enabled"])

    def test_cleanup_policy_names_safe_codex_reconciliation(self) -> None:
        policy = updater.load_process_spine_cleanup_policy()
        self.assertEqual(policy["mode"], "disable-not-delete")
        codex = next(client for client in policy["clients"] if client["client"] == "codex")
        self.assertIn("superpowers@openai-curated", codex["competitivePluginIds"])
        self.assertEqual(codex["action"], "disable-plugin")

    def test_installs_and_verifies_through_codex_registry(self) -> None:
        add_result = unittest.mock.Mock(returncode=0, stdout='{"installed":true}', stderr="")
        list_result = unittest.mock.Mock(
            returncode=0,
            stdout=json.dumps(
                {
                    "installed": [
                        {
                            "pluginId": "dpf-platform@personal",
                            "installed": True,
                            "enabled": True,
                        }
                    ]
                }
            ),
            stderr="",
        )
        with patch.object(
            updater, "resolve_codex_binary", return_value="/fake/codex"
        ), patch("subprocess.run", side_effect=[add_result, list_result]) as run:
            status = updater.install_codex_plugin(Path("/operator-home"), dry_run=False)

        self.assertEqual(status, "installed, enabled, and verified")
        self.assertEqual(
            run.call_args_list[0].args[0],
            ["/fake/codex", "plugin", "add", "dpf-platform@personal", "--json"],
        )
        self.assertEqual(
            run.call_args_list[1].args[0],
            [
                "/fake/codex",
                "plugin",
                "list",
                "--marketplace",
                "personal",
                "--json",
            ],
        )

    def test_refuses_to_claim_success_when_registry_does_not_install_plugin(self) -> None:
        add_result = unittest.mock.Mock(returncode=0, stdout="{}", stderr="")
        list_result = unittest.mock.Mock(returncode=0, stdout='{"installed":[]}', stderr="")
        with patch.object(
            updater, "resolve_codex_binary", return_value="/fake/codex"
        ), patch("subprocess.run", side_effect=[add_result, list_result]):
            status = updater.install_codex_plugin(Path("/operator-home"), dry_run=False)
        self.assertIn("failed", status)

    def test_migrates_bare_codex_plugin_table_to_registry_qualified_key(self) -> None:
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
                    "--skip-codex-cli-install",
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                ])

            raw = config.read_text()
            if tomllib is not None:
                data = tomllib.loads(raw)
                self.assertTrue(data["plugins"]["dpf-platform@personal"]["enabled"])
                self.assertNotIn("dpf-platform", data["plugins"])
            self.assertEqual(raw.count("dpf-platform"), 1)

    def test_reconverges_config_after_codex_plugin_install_recreates_legacy_alias(self) -> None:
        skill_pack = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config = home / ".codex" / "config.toml"

            def install_with_legacy_alias(_home: Path, _dry_run: bool) -> str:
                with config.open("a", encoding="utf-8") as handle:
                    handle.write('[plugins."dpf-platform"]\nenabled = true\n')
                return "installed, enabled, and verified"

            with patch.dict(
                os.environ,
                {"DPF_AGENT_TOOLCHAIN_HOME": tmp},
                clear=False,
            ), patch.object(
                updater,
                "install_codex_plugin",
                side_effect=install_with_legacy_alias,
            ):
                updater.main([
                    "--skill-pack-path",
                    str(skill_pack),
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                    "--skip-antigravity-cli-install",
                ])

            raw = config.read_text(encoding="utf-8")
            if tomllib is not None:
                data = tomllib.loads(raw)
                self.assertTrue(data["plugins"]["dpf-platform@personal"]["enabled"])
                self.assertNotIn("dpf-platform", data["plugins"])
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
                    "--skip-codex-cli-install",
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
                    "--skip-codex-cli-install",
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                ])

            self.assertEqual(code, 0)
            home = Path(tmp)
            managed = home / ".agents" / "plugins" / "plugins" / "dpf-platform"
            self.assertTrue((managed / ".codex-plugin" / "plugin.json").exists())
            self.assertTrue((managed / "skills" / "dpf-worktree-per-session" / "SKILL.md").exists())

            codex_config = tomllib.loads((home / ".codex" / "config.toml").read_text())
            self.assertTrue(codex_config["plugins"]["dpf-platform@personal"]["enabled"])
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
        marketplace_root = str(Path("/tmp/home") / ".agents" / "plugins")
        self.assertEqual(
            [call[0][0] for call in run.call_args_list],
            [
                ["/fake/claude", "plugin", "marketplace", "add", marketplace_root, "--scope", "local"],
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
                        "--skip-codex-cli-install",
                        "--skip-claude-cli-install",
                        "--skip-grok-cli-install",
                        "--require-codex-hook-trust",
                    ]
                )
            self.assertEqual(code, 2)


class ProbeGrokExposedSkillsTest(unittest.TestCase):
    """Grok active-skill exposure adapter, Python-fallback mirror (BI-BCA162CF)."""

    def setUp(self) -> None:
        self.skill_pack = Path(__file__).resolve().parents[1]

    def test_returns_none_when_grok_binary_not_found(self) -> None:
        with patch.object(updater, "resolve_grok_binary", return_value=None):
            self.assertIsNone(updater.probe_grok_exposed_skills(self.skill_pack))

    def test_returns_none_on_nonzero_exit(self) -> None:
        fake_result = unittest.mock.Mock(returncode=1, stdout="")
        with patch.object(updater, "resolve_grok_binary", return_value="/fake/grok"), patch(
            "subprocess.run", return_value=fake_result
        ):
            self.assertIsNone(updater.probe_grok_exposed_skills(self.skill_pack))

    def test_returns_none_on_invalid_json(self) -> None:
        fake_result = unittest.mock.Mock(returncode=0, stdout="not json")
        with patch.object(updater, "resolve_grok_binary", return_value="/fake/grok"), patch(
            "subprocess.run", return_value=fake_result
        ):
            self.assertIsNone(updater.probe_grok_exposed_skills(self.skill_pack))

    def test_exposes_all_dpf_replacements_when_dpf_platform_plugin_active(self) -> None:
        fake_result = unittest.mock.Mock(
            returncode=0, stdout=json.dumps([{"name": updater.PLUGIN_NAME}])
        )
        with patch.object(updater, "resolve_grok_binary", return_value="/fake/grok"), patch(
            "subprocess.run", return_value=fake_result
        ):
            exposed = updater.probe_grok_exposed_skills(self.skill_pack)
        self.assertIsNotNone(exposed)
        for entry in updater.load_process_spine_contract(self.skill_pack):
            self.assertIn(entry["dpfSkill"], exposed)
        self.assertFalse(any(item.startswith("superpowers") for item in exposed))

    def test_exposes_retired_surface_ids_when_competitive_plugin_active(self) -> None:
        fake_result = unittest.mock.Mock(returncode=0, stdout=json.dumps([{"name": "superpowers"}]))
        with patch.object(updater, "resolve_grok_binary", return_value="/fake/grok"), patch(
            "subprocess.run", return_value=fake_result
        ):
            exposed = updater.probe_grok_exposed_skills(self.skill_pack)
        self.assertIn("brainstorming", exposed)
        self.assertIn("superpowers:brainstorming", exposed)
        self.assertNotIn("dpf-brainstorming", exposed)

    def test_honors_explicit_enabled_false_without_requiring_the_field(self) -> None:
        fake_result = unittest.mock.Mock(
            returncode=0, stdout=json.dumps([{"name": updater.PLUGIN_NAME, "enabled": False}])
        )
        with patch.object(updater, "resolve_grok_binary", return_value="/fake/grok"), patch(
            "subprocess.run", return_value=fake_result
        ):
            exposed = updater.probe_grok_exposed_skills(self.skill_pack)
        self.assertEqual(exposed, [])

    def test_main_prefers_explicit_env_evidence_over_the_grok_probe(self) -> None:
        # exposed_process_spine_skills_from_env() must win when the operator/CI
        # already set an explicit evidence channel; the live probe is only a
        # fallback for when nothing else answered the question.
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(
                os.environ,
                {
                    "DPF_AGENT_TOOLCHAIN_HOME": tmp,
                    "DPF_PROCESS_SPINE_EXPOSED_SKILLS_JSON": json.dumps(["dpf-brainstorming"]),
                },
                clear=False,
            ), patch.object(updater, "probe_grok_exposed_skills") as mock_probe:
                code = updater.main(
                    [
                        "--skill-pack-path",
                        str(self.skill_pack),
                        "--skip-codex-cli-install",
                        "--skip-claude-cli-install",
                        "--skip-grok-cli-install",
                    ]
                )
            self.assertEqual(code, 0)
            mock_probe.assert_not_called()

    def test_main_never_uses_grok_evidence_for_multi_client_session_health(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            clean_env = {
                key: value
                for key, value in os.environ.items()
                if not key.startswith("DPF_PROCESS_SPINE_EXPOSED_SKILLS")
            }
            clean_env["DPF_AGENT_TOOLCHAIN_HOME"] = tmp
            with patch.dict(os.environ, clean_env, clear=True), patch.object(
                updater, "probe_grok_exposed_skills"
            ) as mock_probe:
                code = updater.main(
                    [
                        "--skill-pack-path",
                        str(self.skill_pack),
                        "--skip-codex-cli-install",
                        "--skip-claude-cli-install",
                        "--skip-grok-cli-install",
                    ]
                )
            self.assertEqual(code, 0)
            mock_probe.assert_not_called()


if __name__ == "__main__":
    unittest.main()
