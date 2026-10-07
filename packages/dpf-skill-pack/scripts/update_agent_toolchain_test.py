import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any, Optional
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


class CodexCacheVersionTest(unittest.TestCase):
    def test_changed_contents_refresh_same_source_version_and_reruns_are_stable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / ".codex-plugin" / "plugin.json"
            manifest.parent.mkdir()
            updater.write_json(manifest, {"name": "dpf-platform", "version": "0.2.5+codex.old"})
            script = root / "updater.py"
            script.write_text("legacy config")
            first = updater.codex_content_version(root)
            updater.write_json(manifest, {"name": "dpf-platform", "version": first})
            self.assertEqual(updater.codex_content_version(root), first)
            script.write_text("oauth config")
            self.assertNotEqual(updater.codex_content_version(root), first)
            self.assertTrue(first.startswith("0.2.5+codex."))

    def test_ignored_python_files_do_not_change_version_but_rename_does(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / ".codex-plugin" / "plugin.json"
            manifest.parent.mkdir()
            updater.write_json(manifest, {"name": "dpf-platform", "version": "0.2.5"})
            script = root / "a.py"
            script.write_text("same")
            first = updater.codex_content_version(root)
            cache = root / "__pycache__"
            cache.mkdir()
            (cache / "a.pyc").write_bytes(b"cache")
            (root / ".DS_Store").write_bytes(b"metadata")
            self.assertEqual(updater.codex_content_version(root), first)
            script.rename(root / "b.py")
            self.assertNotEqual(updater.codex_content_version(root), first)


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
            managed_manifest = json.loads((Path(tmp) / "plugins/dpf-platform/.codex-plugin/plugin.json").read_text())
            self.assertEqual(managed_manifest["version"], updater.codex_content_version(skill_pack))
            marketplace = json.loads(
                (Path(tmp) / ".agents" / "plugins" / "marketplace.json").read_text(),
            )
            self.assertEqual(marketplace["plugins"][0]["name"], "dpf-platform")

    def test_dry_run_leaves_source_manifest_and_home_untouched(self):
        skill_pack = Path(__file__).resolve().parents[1]
        manifest = skill_pack / ".codex-plugin/plugin.json"
        before = manifest.read_bytes()
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"DPF_AGENT_TOOLCHAIN_HOME": tmp}):
            self.assertEqual(updater.main(["--skill-pack-path", str(skill_pack), "--codex-only", "--dry-run"]), 0)
            self.assertEqual(list(Path(tmp).iterdir()), [])
        self.assertEqual(manifest.read_bytes(), before)

    def test_main_fails_when_codex_cache_verification_fails(self):
        skill_pack = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"DPF_AGENT_TOOLCHAIN_HOME": tmp}), patch.object(
            updater, "install_codex_plugin", return_value="failed: Codex plugin cache does not match the delivered skill pack"
        ):
            self.assertEqual(updater.main([
                "--skill-pack-path", str(skill_pack), "--codex-only",
                "--skip-grok-cli-install", "--skip-antigravity-cli-install",
            ]), 1)


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
                    if base and not str(hook.get("statusMessage", "")).strip():
                        missing.append(base)
        self.assertEqual(missing, [], f"hooks missing a statusMessage: {missing}")

    def test_roster_uses_canonical_purpose_not_a_second_dictionary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "hooks").mkdir()
            (root / "hooks" / "hooks.json").write_text(json.dumps({"hooks": {
                "Stop": [{"hooks": [{"type": "command", "command": 'node "hooks/test.mjs"',
                                      "statusMessage": "Preserve work before ending"}]}]}}))
            self.assertIn("Preserve work before ending", "\n".join(updater.hook_roster(root)))

    def test_reference_matches_all_canonical_handlers_and_is_current(self) -> None:
        root = Path(__file__).resolve().parents[1]
        reference = updater.hook_reference(root)
        self.assertEqual((root / "hooks" / "README.md").read_text(encoding="utf-8"), reference)
        data = json.loads((root / "hooks" / "hooks.json").read_text())
        for groups in data["hooks"].values():
            for group in groups:
                for hook in group["hooks"]:
                    self.assertIn(hook["statusMessage"], reference)
                    self.assertIn(updater.hook_script_basename(hook["command"]), reference)

    def test_codex_adapter_carries_purpose_from_canonical_definition(self) -> None:
        root = Path(__file__).resolve().parents[1]
        payload = updater.merge_codex_hooks_payload({}, root, dry_run=False)
        for group in payload["hooks"]["PreToolUse"]:
            for hook in group["hooks"]:
                self.assertTrue(hook.get("statusMessage"), hook["command"])

    def test_grok_lifecycle_purposes_match_event_not_just_script(self) -> None:
        root = Path(__file__).resolve().parents[1]
        payload = updater.build_grok_hooks_payload(root)
        for event, expected in [("SessionStart", "Check worktree location"),
                                ("SessionEnd", "Reap this checkout")]:
            hooks = [h for group in payload["hooks"][event] for h in group["hooks"]]
            hook = next(h for h in hooks if "worktree-session-hygiene.mjs" in h["command"])
            self.assertTrue(hook["statusMessage"].startswith(expected))

    def test_reference_check_is_read_only_and_detects_stale_content(self) -> None:
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp)
            import shutil
            shutil.copytree(root / "hooks", copy / "hooks")
            reference = copy / "hooks" / "README.md"
            reference.write_text("stale", encoding="utf-8")
            self.assertEqual(updater.main(["--skill-pack-path", str(copy), "--check-hook-reference"]), 1)
            self.assertEqual(reference.read_text(), "stale")

    def test_reference_rejects_missing_purpose(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "hooks").mkdir()
            (root / "hooks" / "test.mjs").write_text("")
            (root / "hooks" / "hooks.json").write_text(json.dumps({"hooks": {
                "Stop": [{"hooks": [{"type": "command", "command": "node hooks/test.mjs"}]}]}}))
            with self.assertRaisesRegex(ValueError, "purpose is missing"):
                updater.hook_reference(root)

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
            self.assertNotIn("bearer_token_env_var", codex_config["mcp_servers"]["dpf"])
            # The Codex CLI install was skipped, so no plugin cache exists and the
            # guards land in ~/.codex/hooks.json as the fallback (BI-2B634E68).
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

            # Once Codex has installed the delivered version into its plugin
            # cache, the next bootstrap retires the duplicate user-file copy.
            version = json.loads((codex_managed / ".codex-plugin" / "plugin.json").read_text())["version"]
            cached = home / ".codex" / "plugins" / "cache" / "personal" / "dpf-platform" / version / "hooks"
            cached.mkdir(parents=True)
            (cached / "hooks.json").write_text((skill_pack / "hooks" / "hooks.json").read_text(encoding="utf-8"), encoding="utf-8")
            with patch.dict(os.environ, {"DPF_AGENT_TOOLCHAIN_HOME": tmp}, clear=False):
                code = updater.main([
                    "--skill-pack-path",
                    str(skill_pack),
                    "--skip-codex-cli-install",
                    "--skip-claude-cli-install",
                    "--skip-grok-cli-install",
                ])
            self.assertEqual(code, 0)
            self.assertEqual(json.loads((home / ".codex" / "hooks.json").read_text()), {"hooks": {}})

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
        add_result = unittest.mock.Mock(returncode=0, stdout='{"installedPath":"/cache/dpf-platform"}', stderr="")
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
        ), patch("subprocess.run", side_effect=[add_result, list_result]) as run, patch.object(
            Path, "is_dir", return_value=True
        ), patch.object(updater, "codex_content_version", return_value="0.2.5+codex.match"):
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

    def test_refuses_stale_cache_even_when_codex_reports_install_success(self):
        result = unittest.mock.Mock(returncode=0, stdout='{"installedPath":"/cache/dpf-platform"}')
        with patch.object(updater, "resolve_codex_binary", return_value="/fake/codex"), patch(
            "subprocess.run", return_value=result
        ), patch.object(Path, "is_dir", return_value=True), patch.object(
            updater, "codex_content_version", side_effect=["0.2.5+codex.old", "0.2.5+codex.new"]
        ):
            status = updater.install_codex_plugin(Path("/operator-home"), dry_run=False)
        self.assertIn("cache does not match", status)

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
            self.assertNotIn("bearer_token_env_var", codex_config["mcp_servers"]["dpf"])


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


class ClaudeProjectScopeConvergenceTest(unittest.TestCase):
    """BI-B9F359AC: project-scope records and project .mcp.json leftovers."""

    class _Result:
        returncode = 0
        stdout = ""
        stderr = ""

    def _home(self, root: Path, entries: list[dict]) -> Path:
        home = root / "home"
        path = updater.claude_installed_plugins_path(home)
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"version": 2, "plugins": {updater.CLAUDE_PLUGIN_ID: entries}}))
        return home

    def _project(self, root: Path, name: str) -> Path:
        project = root / name
        project.mkdir()
        return project

    def test_stale_project_records_are_updated_in_their_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            stale = self._project(root, "stale")
            current = self._project(root, "current")
            home = self._home(root, [
                {"scope": "local", "projectPath": str(root), "version": "0.2.5"},
                {"scope": "project", "projectPath": str(stale), "version": "0.2.5"},
                {"scope": "project", "projectPath": str(current), "version": "0.2.8"},
            ])
            with patch.object(updater, "resolve_claude_binary", return_value="/fake/claude"), patch(
                "subprocess.run", return_value=self._Result()
            ) as run:
                result = updater.converge_claude_project_plugins(home, "0.2.8", dry_run=False)
        self.assertEqual(result["updated"], [str(stale)])
        self.assertEqual(result["current"], [str(current)])
        self.assertEqual(run.call_count, 1)
        self.assertEqual(
            run.call_args[0][0],
            ["/fake/claude", "plugin", "update", "dpf-platform@dpf-platform-local", "--scope", "project"],
        )
        self.assertEqual(run.call_args[1]["cwd"], str(stale))

    def test_build_metadata_on_the_pack_version_does_not_mark_current_records_stale(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            current = self._project(root, "current")
            home = self._home(root, [{"scope": "project", "projectPath": str(current), "version": "0.2.8"}])
            with patch.object(updater, "resolve_claude_binary", return_value="/fake/claude"), patch(
                "subprocess.run"
            ) as run:
                lines = updater.converge_claude_project_connectors(
                    home, "0.2.8+codex.20260726032301", dry_run=False
                )
        run.assert_not_called()
        self.assertIn("current 1", lines[0])

    def test_records_for_missing_projects_are_reported_not_touched(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gone = str(root / "gone")
            home = self._home(root, [{"scope": "project", "projectPath": gone, "version": "0.2.5"}])
            with patch.object(updater, "resolve_claude_binary", return_value="/fake/claude"), patch(
                "subprocess.run"
            ) as run:
                result = updater.converge_claude_project_plugins(home, "0.2.8", dry_run=False)
        self.assertEqual(result["pruned"], [gone])
        run.assert_not_called()

    def test_failed_update_is_reported(self) -> None:
        failed = self._Result()
        failed.returncode = 1
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            stale = self._project(root, "stale")
            home = self._home(root, [{"scope": "project", "projectPath": str(stale), "version": "0.2.5"}])
            with patch.object(updater, "resolve_claude_binary", return_value="/fake/claude"), patch(
                "subprocess.run", return_value=failed
            ):
                result = updater.converge_claude_project_plugins(home, "0.2.8", dry_run=False)
        self.assertEqual(result["failed"], [str(stale)])

    def test_dry_run_reports_without_running_or_writing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            stale = self._project(root, "stale")
            (stale / ".mcp.json").write_text(json.dumps(
                {"mcpServers": {"dpf": {"type": "http", "url": "https://localhost/api/mcp/v1?tier=full"}}}
            ))
            home = self._home(root, [{"scope": "project", "projectPath": str(stale), "version": "0.2.5"}])
            with patch.object(updater, "resolve_claude_binary", return_value="/fake/claude"), patch(
                "subprocess.run"
            ) as run:
                lines = updater.converge_claude_project_connectors(home, "0.2.8", dry_run=True)
            self.assertTrue((stale / ".mcp.json").exists())
            self.assertFalse((stale / ".mcp.json.legacy-bak").exists())
        run.assert_not_called()
        self.assertIn(f"    would update to 0.2.8: {stale}", lines)
        self.assertTrue(any("would disable duplicate dpf connector" in line for line in lines))

    def test_dpf_only_project_mcp_json_is_renamed_to_a_backup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            original = json.dumps({"mcpServers": {"dpf": {
                "type": "http", "url": "${DPF_MCP_URL:-http://127.0.0.1:3000/api/mcp/v1}",
                "headers": {"Authorization": "Bearer ${DPF_MCP_BEARER_TOKEN:-}"},
            }}})
            (project / ".mcp.json").write_text(original)
            backup = updater.retire_duplicate_project_mcp_json(project, dry_run=False)
            self.assertEqual(backup, str(project / ".mcp.json.legacy-bak"))
            self.assertFalse((project / ".mcp.json").exists())
            self.assertEqual((project / ".mcp.json.legacy-bak").read_text(), original)

    def test_existing_backup_is_never_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            (project / ".mcp.json.legacy-bak").write_text("older")
            (project / ".mcp.json").write_text(json.dumps(
                {"mcpServers": {"dpf": {"url": "https://localhost/api/mcp/v1?tier=full"}}}
            ))
            backup = updater.retire_duplicate_project_mcp_json(project, dry_run=False)
            self.assertEqual(backup, str(project / ".mcp.json.legacy-bak.1"))
            self.assertEqual((project / ".mcp.json.legacy-bak").read_text(), "older")

    def test_other_servers_survive_and_only_the_duplicate_is_dropped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            other = {"command": "npx", "args": ["other-server"]}
            (project / ".mcp.json").write_text(json.dumps({"mcpServers": {
                "dpf": {"url": "https://localhost/api/mcp/v1?tier=full"}, "other": other,
            }}))
            backup = updater.retire_duplicate_project_mcp_json(project, dry_run=False)
            kept = json.loads((project / ".mcp.json").read_text())
            self.assertEqual(kept, {"mcpServers": {"other": other}})
            self.assertIn("dpf", json.loads(Path(backup).read_text())["mcpServers"])

    def test_unrelated_or_absent_project_mcp_json_is_left_alone(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp)
            self.assertIsNone(updater.retire_duplicate_project_mcp_json(project, dry_run=False))
            content = json.dumps({"mcpServers": {"dpf": {"url": "https://example.com/other/endpoint"}}})
            (project / ".mcp.json").write_text(content)
            self.assertIsNone(updater.retire_duplicate_project_mcp_json(project, dry_run=False))
            self.assertEqual((project / ".mcp.json").read_text(), content)


class AntigravityMcpConfigTest(unittest.TestCase):
    def test_skipped_when_agy_absent(self) -> None:
        with patch.object(updater, "resolve_antigravity_binary", return_value=None):
            status = updater.ensure_antigravity_mcp_config(
                Path("/tmp/home"), updater.DEFAULT_MCP_URL, dry_run=False
            )
        self.assertEqual(status, "skipped: Antigravity CLI (agy) not found")

    def test_upserts_dpf_server_env_backed_and_idempotent(self) -> None:
        # Plain http: the header is the only credential path there. The https
        # default carries no header (OnePluginOwnedConnectorTest).
        http_url = "http://127.0.0.1:3000/api/mcp/v1"
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            with patch.object(updater, "resolve_antigravity_binary", return_value="/fake/agy"):
                first = updater.ensure_antigravity_mcp_config(
                    home, http_url, dry_run=False
                )
                second = updater.ensure_antigravity_mcp_config(
                    home, http_url, dry_run=False
                )
            self.assertEqual(first, "converged")
            self.assertEqual(second, "already current")
            cfg = json.loads(updater.antigravity_mcp_config_path(home).read_text())
            dpf = cfg["mcpServers"]["dpf"]
            self.assertEqual(dpf["type"], "http")
            self.assertEqual(dpf["url"], http_url)
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
    thing that wires a guard to Grok at all. Codex differs: it DOES load the
    plugin-bundled hooks.json from its plugin cache, so the CODEX_* tuples are
    the coverage proof install_codex_hooks checks that cache against before
    pruning its ~/.codex/hooks.json copy, and the guard set it merges there only
    as the fallback (BI-2B634E68).

    Because nothing type-checks these tuples against hooks.json, a new BLOCKING
    guard (one that calls emitDeny) added to hooks.json's PreToolUse wiring
    without a matching addition here silently never reaches Grok, nor Codex's
    fallback plane, and keeps Codex on the fallback --
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

    @staticmethod
    def _plugin_plane_home(home: Path, *, enabled: Optional[str] = "true", cache: bool = True,
                           cache_hooks: Optional[dict[str, Any]] = None) -> Path:
        """Home with a managed copy, a plugin enablement toggle and an installed cache."""
        skill_pack = Path(__file__).resolve().parents[1]
        managed = home / "plugins" / "dpf-platform"
        hooks_dir = managed / "hooks"
        hooks_dir.mkdir(parents=True)
        for guard in {*updater.CODEX_BASH_GUARDS, *updater.CODEX_ASK_GUARDS, *updater.CODEX_WRITE_GUARDS}:
            (hooks_dir / guard).write_text("// stub\n", encoding="utf-8")
        (managed / ".codex-plugin").mkdir()
        (managed / ".codex-plugin" / "plugin.json").write_text(
            json.dumps({"name": "dpf-platform", "version": "0.2.5+codex.test"}), encoding="utf-8"
        )
        (home / ".codex").mkdir()
        if enabled is not None:
            (home / ".codex" / "config.toml").write_text(
                f'[plugins."dpf-platform@personal"]\nenabled = {enabled}\n', encoding="utf-8"
            )
        if cache:
            cached = home / ".codex" / "plugins" / "cache" / "personal" / "dpf-platform" / "0.2.5+codex.test" / "hooks"
            cached.mkdir(parents=True)
            payload = cache_hooks if cache_hooks is not None else json.loads(
                (skill_pack / "hooks" / "hooks.json").read_text(encoding="utf-8")
            )
            (cached / "hooks.json").write_text(json.dumps(payload), encoding="utf-8")
        return managed

    @staticmethod
    def _duplicated_user_hooks(managed: Path) -> dict[str, Any]:
        """Today's ~/.codex/hooks.json: DPF guards plus one foreign hook and one foreign event."""
        payload = updater.merge_codex_hooks_payload({}, managed, dry_run=False)
        bash = next(g for g in payload["hooks"]["PreToolUse"] if g.get("matcher") == "Bash")
        bash["hooks"].append({"type": "command", "command": "node /foreign/wrapper.js"})
        payload["hooks"]["Stop"] = [{"hooks": [{"type": "command", "command": "node /foreign/stop.js"}]}]
        return payload

    def test_prunes_dpf_entries_and_keeps_foreign_hooks_when_the_plugin_cache_carries_hooks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            managed = self._plugin_plane_home(home)
            user_file = home / ".codex" / "hooks.json"
            user_file.write_text(json.dumps(self._duplicated_user_hooks(managed)), encoding="utf-8")

            status = updater.install_codex_hooks(managed, home, dry_run=False)

            self.assertIn("pruned", status)
            pruned = json.loads(user_file.read_text(encoding="utf-8"))
            commands = [
                hook["command"]
                for groups in pruned["hooks"].values()
                for group in groups
                for hook in group["hooks"]
            ]
            self.assertEqual(sorted(commands), ["node /foreign/stop.js", "node /foreign/wrapper.js"])
            # Groups left empty by the prune are dropped, not written as empty shells.
            self.assertEqual([g["matcher"] for g in pruned["hooks"]["PreToolUse"]], ["Bash"])
            # Trust is never forged: the updater does not touch Codex's trust state.
            self.assertNotIn("trusted_hash", (home / ".codex" / "config.toml").read_text(encoding="utf-8"))
            # Idempotent: a second bootstrap changes nothing.
            again = updater.install_codex_hooks(managed, home, dry_run=False)
            self.assertIn("unchanged", again)
            self.assertEqual(json.loads(user_file.read_text(encoding="utf-8")), pruned)

    def test_plugin_plane_writes_no_user_hook_file_when_none_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            managed = self._plugin_plane_home(home)
            status = updater.install_codex_hooks(managed, home, dry_run=False)
            self.assertIn("plugin", status)
            self.assertFalse((home / ".codex" / "hooks.json").exists())

    def test_falls_back_to_merge_when_the_plugin_is_disabled_missing_or_stale(self) -> None:
        stale = {"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [
            {"type": "command", "command": 'node "${CLAUDE_PLUGIN_ROOT}/hooks/lease-guard.mjs"'}
        ]}]}}
        cases = {
            "disabled": {"enabled": "false"},
            "not configured": {"enabled": None},
            "no cache": {"cache": False},
            "cache missing guards": {"cache_hooks": stale},
        }
        for name, kwargs in cases.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as tmp:
                home = Path(tmp)
                managed = self._plugin_plane_home(home, **kwargs)
                self.assertFalse(updater.codex_plugin_hooks_active(managed, home))
                status = updater.install_codex_hooks(managed, home, dry_run=False)
                self.assertIn("merged", status)
                merged = json.loads((home / ".codex" / "hooks.json").read_text(encoding="utf-8"))
                wired = {
                    updater.hook_script_basename(hook["command"])
                    for group in merged["hooks"]["PreToolUse"]
                    for hook in group["hooks"]
                }
                self.assertEqual(
                    wired,
                    {*updater.CODEX_BASH_GUARDS, *updater.CODEX_ASK_GUARDS, *updater.CODEX_WRITE_GUARDS},
                )

    def test_plugin_plane_trust_requires_plugin_hook_trust_not_stale_user_file_trust(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            self._plugin_plane_home(home)
            config = home / ".codex" / "config.toml"
            base = config.read_text(encoding="utf-8")
            config.write_text(
                base + "[hooks.state.'C:\\Users\\op\\.codex\\hooks.json:pre_tool_use:0:0']\n"
                'trusted_hash = "sha256:old"\n',
                encoding="utf-8",
            )
            self.assertTrue(updater.codex_hook_trust_pending(home, codex_present=True, plugin_plane=True))
            config.write_text(
                base + '[hooks.state."dpf-platform@personal:hooks/hooks.json:pre_tool_use:0:0"]\n'
                'trusted_hash = "sha256:new"\n',
                encoding="utf-8",
            )
            self.assertFalse(updater.codex_hook_trust_pending(home, codex_present=True, plugin_plane=True))
            notice = "\n".join(updater.codex_hook_trust_blocking_notice(plugin_plane=True))
            self.assertIn("once", notice)
            self.assertIn("dpf-platform", notice)

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


class ClaudeMcpConfigSchemeAwarenessTest(unittest.TestCase):
    """The bearer header and OAuth are mutually exclusive; the scheme decides.

    BI-FA2C46D7, mirroring mcpClientBearerHeaderRequired() in
    packages/integration-shared/src/mcp-client-credential-policy.ts (BI-46B636B0).

    Both directions are pinned deliberately. Dropping the header on http strands
    the install with no credential at all - that is what PR #5416 did. Keeping it
    on https disables the OAuth fallback and silently prevents the self-renewing
    path from engaging. Neither failure announces itself at write time, so the
    test is the thing that catches them.
    """

    def _write(self, url: str) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            pack = Path(tmp)
            updater.ensure_claude_repo_mcp_config(pack, url, dry_run=False)
            return json.loads((pack / "claude.mcp.json").read_text())

    def test_http_endpoint_keeps_the_bearer_header(self) -> None:
        server = self._write("http://127.0.0.1:3000/api/mcp/v1")["mcpServers"]["dpf"]
        self.assertIn("headers", server, "http has no OAuth path; the header is the only credential")
        self.assertEqual(
            server["headers"]["Authorization"], "Bearer ${DPF_MCP_BEARER_TOKEN:-}"
        )
        self.assertNotIn("oauth", server, "OAuth never runs over http; a pin there is noise")

    def test_https_endpoint_drops_the_bearer_header(self) -> None:
        server = self._write("https://localhost:3000/api/mcp/v1")["mcpServers"]["dpf"]
        self.assertNotIn("headers", server, "a pinned header disables the client's OAuth fallback")
        # BI-3D2FD68C: without the pin the consent grants only the advertised
        # read scope, so the OAuth path would be read-only for good.
        self.assertEqual(server["oauth"], {"scopes": "dpf.read dpf.work dpf.build"})
        self.assertEqual(server["oauth"]["scopes"], updater.MCP_CLIENT_OAUTH_SCOPE_PIN)

    def test_unparseable_endpoint_fails_safe_by_keeping_the_header(self) -> None:
        self.assertTrue(updater.mcp_client_bearer_header_required("not a url"))

    def test_predicate_matches_the_typescript_rule(self) -> None:
        for endpoint, required in [
            ("https://localhost:3000/api/mcp/v1", False),
            ("http://127.0.0.1:3000/api/mcp/v1", True),
            ("http://localhost:3000/api/mcp/v1", True),
        ]:
            with self.subTest(endpoint=endpoint):
                self.assertEqual(updater.mcp_client_bearer_header_required(endpoint), required)

    def test_checked_in_descriptor_matches_the_generator(self) -> None:
        """An edit to the JSON alone is reverted by the next bootstrap run."""
        repo_descriptor = Path(__file__).resolve().parents[1] / "claude.mcp.json"
        with tempfile.TemporaryDirectory() as tmp:
            pack = Path(tmp)
            updater.ensure_claude_repo_mcp_config(
                pack, updater.DEFAULT_MCP_URL, dry_run=False
            )
            generated = (pack / "claude.mcp.json").read_text()
        self.assertEqual(generated, repo_descriptor.read_text())


class OnePluginOwnedConnectorTest(unittest.TestCase):
    """BI-5201141C (design 12.4.4): the plugin descriptor is THE dpf connector.

    Claude Code matches a plugin server against configured servers by endpoint,
    so a descriptor whose default differs from the install's canonical origin
    loads beside any other connector instead of replacing it. Every shipped
    descriptor is therefore URL-only on the canonical loopback https origin,
    authenticates by OAuth (no bearer header), and Claude keeps its scope pin.
    Grok keeps its compatibility bearer until S6 (it has no OAuth client).
    """

    PACK = Path(__file__).resolve().parents[1]

    def _read(self, name: str) -> dict:
        return json.loads((self.PACK / name).read_text())

    def test_default_endpoint_is_the_canonical_loopback_https_origin(self) -> None:
        self.assertEqual(updater.DEFAULT_MCP_URL, "https://localhost/api/mcp/v1")

    def test_claude_descriptor_is_url_only_https_with_the_scope_pin(self) -> None:
        server = self._read("claude.mcp.json")["mcpServers"]["dpf"]
        self.assertEqual(server["url"], "${DPF_MCP_URL:-https://localhost/api/mcp/v1?tier=full}")
        self.assertNotIn("headers", server)
        self.assertEqual(server["oauth"], {"scopes": updater.MCP_CLIENT_OAUTH_SCOPE_PIN})

    def test_antigravity_descriptor_is_url_only_https(self) -> None:
        server = self._read("antigravity.mcp.json")["mcpServers"]["dpf"]
        self.assertEqual(server["url"], "${DPF_MCP_URL:-https://localhost/api/mcp/v1}")
        self.assertNotIn("headers", server)

    def test_checked_in_antigravity_descriptor_matches_the_generator(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pack = Path(tmp)
            updater.ensure_antigravity_plugin_descriptor(pack, updater.DEFAULT_MCP_URL, dry_run=False)
            generated = (pack / "antigravity.mcp.json").read_text()
        self.assertEqual(generated, (self.PACK / "antigravity.mcp.json").read_text())

    def test_antigravity_descriptor_keeps_the_header_only_where_oauth_cannot_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pack = Path(tmp)
            updater.ensure_antigravity_plugin_descriptor(pack, "http://127.0.0.1:3000/api/mcp/v1", dry_run=False)
            server = json.loads((pack / "antigravity.mcp.json").read_text())["mcpServers"]["dpf"]
        self.assertEqual(server["headers"]["Authorization"], "Bearer ${DPF_MCP_BEARER_TOKEN:-}")

    def test_grok_descriptor_keeps_its_compatibility_bearer_until_s6(self) -> None:
        server = self._read("grok.mcp.json")["mcp_servers"]["dpf"]
        self.assertEqual(server["bearer_token_env_var"], "DPF_MCP_BEARER_TOKEN")




class OAuthDefaultTest(unittest.TestCase):
    def test_policy_agrees_with_shared_fixtures(self):
        cases = json.loads(Path(__file__).with_name("mcp-credential-policy-cases.json").read_text())
        for case in cases:
            with self.subTest(case=case):
                self.assertEqual(updater.mcp_client_bearer_header_required(case["endpoint"], case["client"], case["mode"]), case["required"])

    def test_codex_updater_preserves_oauth_and_user_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            path = updater.codex_config_path(home)
            path.parent.mkdir(parents=True)
            path.write_text('[mcp_servers.dpf]\nurl="http://127.0.0.1:3000/api/mcp/v1"\nbearer_token_env_var="DPF_MCP_BEARER_TOKEN"\nstartup_timeout_sec=45\n[mcp_servers.other]\nurl="https://other.example/mcp"\n')
            updater.ensure_codex_config(home, "http://127.0.0.1:3000/api/mcp/v1", False)
            first = path.read_text()
            self.assertNotIn("bearer_token_env_var", first)
            self.assertIn("startup_timeout_sec=45", first)
            self.assertIn("https://other.example/mcp", first)
            updater.ensure_codex_config(home, "http://127.0.0.1:3000/api/mcp/v1", False)
            self.assertEqual(first, path.read_text())

class WrapperEndpointParityTest(unittest.TestCase):
    """BI-772023BC: the shell and PowerShell wrappers are twins of the Python
    updater. The default endpoint and auth mode have one source, the Python
    updater (DEFAULT_MCP_URL, DPF_MCP_URL, DPF_MCP_AUTH_MODE); a wrapper only
    forwards an endpoint the operator named. The .ps1 is parsed as text so the
    check runs without pwsh."""

    SCRIPTS = Path(__file__).resolve().parent
    URL_LITERAL = re.compile(r"""https?://[^\s"'$]+/api/mcp""")

    def wrappers(self):
        repo = Path(__file__).resolve().parents[3]
        found = {
            "pack.ps1": self.SCRIPTS / "update-agent-toolchain.ps1",
            "pack.sh": self.SCRIPTS / "update-agent-toolchain.sh",
        }
        repo_ps1 = repo / "scripts/update-dpf-agent-toolchain.ps1"
        if repo_ps1.exists():
            found["repo.ps1"] = repo_ps1
        return {name: path.read_text() for name, path in found.items()}

    def test_wrappers_hard_code_no_endpoint_or_auth_mode(self):
        for name, text in self.wrappers().items():
            with self.subTest(wrapper=name):
                self.assertIsNone(self.URL_LITERAL.search(text), "hard-coded MCP endpoint")
                self.assertNotIn("--auth-mode", text)
                self.assertNotIn(updater.TOKEN_ENV_VAR, text)

    def test_ps1_forwards_endpoint_only_when_named(self):
        text = self.wrappers()["pack.ps1"]
        self.assertRegex(text, r'\[string\]\$McpUrl\s*=\s*""')
        self.assertRegex(text, r'if \(\$McpUrl\) \{ \$argsList \+= @\("--mcp-url", \$McpUrl\) \}')
        self.assertNotRegex(text, r'"--mcp-url", \$McpUrl\s*\n\s*\)')

    def test_sh_forwards_no_default_endpoint(self):
        code = [line for line in self.wrappers()["pack.sh"].splitlines() if not line.lstrip().startswith("#")]
        self.assertNotIn("--mcp-url", "\n".join(code))

    def test_python_default_is_canonical_https_oauth(self):
        self.assertEqual(updater.DEFAULT_MCP_URL, "https://localhost/api/mcp/v1")
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DPF_MCP_AUTH_MODE", None)
            self.assertFalse(updater.mcp_client_bearer_header_required(updater.DEFAULT_MCP_URL))


class CodexRegistrationConvergenceTest(unittest.TestCase):
    def fixture(self, home, canonical=True, legacy=True):
        config = updater.codex_config_path(home)
        config.parent.mkdir(parents=True)
        config.write_text(
            f'[plugins."dpf-platform@personal"]\nenabled = {str(canonical).lower()}\ncustom = "keep"\n'
            f'[plugins."dpf-platform@dpf-platform-local"]\nenabled = {str(legacy).lower()}\n'
            '[plugins."other@personal"]\nenabled = true\n'
            '[hooks.state."dpf-platform@personal:hooks/hooks.json:hash"]\ntrusted = true\n',
            encoding="utf-8",
        )
        cache = home / ".codex/plugins/cache/dpf-platform-local/dpf-platform/version"
        cache.mkdir(parents=True)
        (cache / "preserved.txt").write_text("operator cache", encoding="utf-8")
        managed = updater.codex_managed_plugin_path(home)
        managed.mkdir(parents=True)
        calls = []

        def run(command, **kwargs):
            calls.append(command)
            if command[1:3] == ["plugin", "add"]:
                return unittest.mock.Mock(returncode=0, stdout=json.dumps({"installedPath": str(managed)}))
            text = config.read_text(encoding="utf-8")
            return unittest.mock.Mock(returncode=0, stdout=json.dumps({"installed": [
                {"pluginId": plugin_id, "name": "dpf-platform", "installed": True,
                 "enabled": updater.toml_table_enabled(text, f"plugins.{plugin_id}") is not False}
                for plugin_id in ["dpf-platform@personal", "dpf-platform@dpf-platform-local"]
                if "--marketplace" not in command or plugin_id.endswith("@personal")
            ]}))
        return config, cache, run, calls

    def install(self, home, run, dry_run=False):
        with patch.object(updater, "resolve_codex_binary", return_value="/fake/codex"), \
                patch.object(updater, "codex_content_version", return_value="verified"), \
                patch("subprocess.run", side_effect=run):
            return updater.install_codex_plugin(home, dry_run)

    def test_verified_replacement_disables_only_known_duplicate_and_converges(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config, cache, run, calls = self.fixture(home)
            self.assertNotIn("failed", self.install(home, run))
            once = config.read_text(encoding="utf-8")
            self.assertIs(updater.toml_table_enabled(once, "plugins.dpf-platform@dpf-platform-local"), False)
            self.assertIn('custom = "keep"', once)
            self.assertIn('trusted = true', once)
            self.assertIs(updater.toml_table_enabled(once, "plugins.other@personal"), True)
            self.assertTrue((cache / "preserved.txt").is_file())
            self.assertNotIn("failed", self.install(home, run))
            self.assertEqual(config.read_text(encoding="utf-8"), once)
            self.assertFalse(any("remove" in command for command in calls))

    def test_failed_install_leaves_legacy_usable(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config, _, _, _ = self.fixture(home)
            before = config.read_text(encoding="utf-8")
            status = self.install(home, lambda *a, **k: unittest.mock.Mock(returncode=1, stdout=""))
            self.assertIn("failed", status)
            self.assertEqual(config.read_text(encoding="utf-8"), before)

    def test_failed_cleanup_readback_restores_legacy_registration(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config, _, native, _ = self.fixture(home)
            lists = 0
            def run(command, **kwargs):
                nonlocal lists
                if command[1:3] == ["plugin", "list"]:
                    lists += 1
                    if lists == 2:
                        return unittest.mock.Mock(returncode=1, stdout="")
                return native(command, **kwargs)
            self.assertIn("failed", self.install(home, run))
            self.assertIs(updater.toml_table_enabled(config.read_text(), "plugins.dpf-platform@dpf-platform-local"), True)

    def test_explicitly_disabled_canonical_keeps_operator_choice_and_legacy(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config, _, native, _ = self.fixture(home, canonical=False)
            status = self.install(home, native)
            self.assertIn("disabled", status)
            self.assertNotIn("failed", status)
            self.assertIs(updater.toml_table_enabled(config.read_text(), "plugins.dpf-platform@personal"), False)
            self.assertIs(updater.toml_table_enabled(config.read_text(), "plugins.dpf-platform@dpf-platform-local"), True)

    def test_dry_run_changes_nothing_and_invokes_no_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config, _, native, calls = self.fixture(home)
            before = config.read_text()
            self.assertIn("dry-run", self.install(home, native, dry_run=True))
            self.assertEqual(config.read_text(), before)
            self.assertEqual(calls, [])

    def test_failed_native_add_cannot_enable_an_operator_disabled_plugin(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config, _, _, _ = self.fixture(home, canonical=False)
            def run(command, **kwargs):
                config.write_text(updater.set_codex_plugin_enabled(
                    config.read_text(), updater.CODEX_PLUGIN_ID, True))
                return unittest.mock.Mock(returncode=1, stdout="")
            self.assertIn("failed", self.install(home, run))
            self.assertIs(updater.toml_table_enabled(config.read_text(), "plugins.dpf-platform@personal"), False)
            self.assertIs(updater.toml_table_enabled(config.read_text(), "plugins.dpf-platform@dpf-platform-local"), True)

    def test_direct_install_inherits_disabled_legacy_preference(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config, _, native, _ = self.fixture(home)
            config.write_text('[plugins."dpf-platform@dpf-platform-local"]\nenabled = false\n')
            self.assertIn("disabled", self.install(home, native))
            self.assertIs(updater.toml_table_enabled(config.read_text(), "plugins.dpf-platform@personal"), False)

    def test_cache_mismatch_preserves_active_legacy_and_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config, cache, native, _ = self.fixture(home)
            with patch.object(updater, "resolve_codex_binary", return_value="/fake/codex"), \
                    patch.object(updater, "codex_content_version", side_effect=["stale", "current"]), \
                    patch("subprocess.run", side_effect=native):
                status = updater.install_codex_plugin(home, False)
            self.assertIn("cache does not match", status)
            self.assertIs(updater.toml_table_enabled(config.read_text(), "plugins.dpf-platform@dpf-platform-local"), True)
            self.assertTrue((cache / "preserved.txt").is_file())

    def test_repository_bootstraps_refresh_plugins_before_computing_config_plan(self):
        repo = Path(__file__).resolve().parents[3]
        if not (repo / "scripts/dpf-bootstrap-agent-toolchain.sh").exists():
            self.skipTest("Repository adapters are not shipped in standalone packs")
        # Ordering is the invariant: the plan must observe migrated preferences,
        # not overwrite a legacy disabled choice before the updater reads it.
        sh = (repo / "scripts/dpf-bootstrap-agent-toolchain.sh").read_text()
        ps = (repo / "scripts/dpf-bootstrap-agent-toolchain.ps1").read_text()
        self.assertLess(sh.index('bash "$PLUGIN_UPDATER"'), sh.index('if ! pnpm "${bridge_args[@]}"'))
        self.assertLess(ps.index('& $PluginUpdater'), ps.index('$planJson = & pnpm'))
        self.assertIn('--codex-plugin-only', sh[:sh.index('# --- Compute plan via Node bridge')])
        self.assertIn('-CodexPluginOnly', ps[:ps.index('# --- Compute plan via Node bridge')])

    def test_shell_bootstrap_refresh_propagates_failure_and_dry_run(self):
        source = Path(__file__).resolve().parents[3] / "scripts/dpf-bootstrap-agent-toolchain.sh"
        if not source.exists():
            self.skipTest("Repository adapter is not shipped in standalone packs")
        text = source.read_text()
        block = text[text.index('# Refresh native plugin registrations'):text.index('# --- Compute plan via Node bridge')]
        with tempfile.TemporaryDirectory() as tmp:
            stub = Path(tmp) / "packages/dpf-skill-pack/scripts/update-agent-toolchain.sh"
            stub.parent.mkdir(parents=True)
            stub.write_text('printf "%s\\n" "$@"\nexit "$DPF_TEST_EXIT"\n')
            for exit_code in (0, 7):
                result = subprocess.run(
                    ["bash", "-c", 'fail() { printf "%s\\n" "$1"; }\n' + block + '\nprintf "PLAN_REACHED\\n"'],
                    env={**os.environ, "REPO_ROOT": tmp, "MCP_ENDPOINT": "https://example.invalid/api/mcp/v1",
                         "DRY_RUN": "1", "DPF_TEST_EXIT": str(exit_code)},
                    capture_output=True, text=True,
                )
                self.assertIn("--dry-run", result.stdout)
                self.assertIn("--codex-plugin-only", result.stdout)
                self.assertIn("https://example.invalid/api/mcp/v1", result.stdout)
                self.assertEqual(result.returncode, 0 if exit_code == 0 else 1)
                self.assertEqual("PLAN_REACHED" in result.stdout, exit_code == 0)

    def test_registration_only_mode_does_not_write_connectors_or_other_clients(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config, _, native, _ = self.fixture(home)
            connector = '[mcp_servers.dpf]\nurl = "https://example.invalid/operator-choice"\ncustom = "retain"\n'
            config.write_text(config.read_text() + connector)
            with patch.dict(os.environ, {"DPF_AGENT_TOOLCHAIN_HOME": tmp}), \
                    patch.object(updater, "resolve_codex_binary", return_value="/fake/codex"), \
                    patch("subprocess.run", side_effect=native):
                code = updater.main(["--codex-plugin-only"])
            self.assertEqual(code, 0)
            self.assertIn(connector, config.read_text())
            self.assertIs(updater.toml_table_enabled(config.read_text(), "plugins.dpf-platform@dpf-platform-local"), False)
            for path in (home / ".claude", home / ".grok", home / ".gemini", updater.shared_managed_plugin_path(home)):
                self.assertFalse(path.exists(), str(path))

    def test_unknown_enabled_dpf_source_is_reported_without_retiring_known_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config, _, native, _ = self.fixture(home)
            def run(command, **kwargs):
                result = native(command, **kwargs)
                if command[1:3] == ["plugin", "list"]:
                    data = json.loads(result.stdout)
                    data["installed"].append({"pluginId": "dpf-platform@custom", "name": "dpf-platform", "installed": True, "enabled": True})
                    result.stdout = json.dumps(data)
                return result
            self.assertIn("failed", self.install(home, run))
            self.assertIs(updater.toml_table_enabled(config.read_text(), "plugins.dpf-platform@dpf-platform-local"), True)

    def test_config_migration_preserves_disabled_legacy_choice_and_plugin_options(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            config, _, _, _ = self.fixture(home)
            config.write_text('[plugins."dpf-platform@dpf-platform-local"]\nenabled = false\n')
            updater.ensure_codex_config(home, updater.DEFAULT_MCP_URL, False)
            self.assertIs(updater.toml_table_enabled(config.read_text(), "plugins.dpf-platform@personal"), False)
            config.write_text('[plugins."dpf-platform@personal"]\nenabled = false\ncustom = "keep"\n')
            updater.ensure_codex_config(home, updater.DEFAULT_MCP_URL, False)
            self.assertIn('custom = "keep"', config.read_text())

    def test_brand_asset_is_packaged_and_survives_standalone_copy(self):
        source = Path(__file__).resolve().parents[1]
        manifest = updater.read_json(source / ".codex-plugin/plugin.json", {})
        logo = manifest["interface"]["logo"]
        self.assertTrue(logo.startswith("./assets/"))
        self.assertTrue((source / logo).is_file())
        platform_logo = source.parents[1] / "apps/web/public/logos/open-digital-product-factory-logo.svg"
        if platform_logo.is_file():
            self.assertEqual((source / logo).read_bytes(), platform_logo.read_bytes())
        with tempfile.TemporaryDirectory() as tmp:
            copied = Path(tmp) / "standalone"
            updater.copy_skill_pack(source, copied, False)
            self.assertEqual((copied / logo).read_bytes(), (source / logo).read_bytes())
            version = updater.codex_content_version(copied)
            (copied / logo).write_text("changed brand asset", encoding="utf-8")
            self.assertNotEqual(updater.codex_content_version(copied), version)


if __name__ == "__main__":
    unittest.main()
