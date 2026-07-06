import json
import os
import tempfile
import unittest
from pathlib import Path
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
                ])
            self.assertEqual(code, 0)
            marketplace = json.loads(
                (Path(tmp) / ".agents" / "plugins" / "marketplace.json").read_text(),
            )
            self.assertEqual(marketplace["plugins"][0]["name"], "dpf-platform")


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
                ])

            self.assertEqual(code, 0)
            home = Path(tmp)

            managed = home / ".agents" / "plugins" / "plugins" / "dpf-platform"
            self.assertTrue((managed / ".codex-plugin" / "plugin.json").exists())
            self.assertTrue((managed / ".claude-plugin" / "plugin.json").exists())
            self.assertTrue((managed / "skills").exists())

            codex_config = tomllib.loads((home / ".codex" / "config.toml").read_text())
            self.assertTrue(codex_config["plugins"]["dpf-platform"]["enabled"])
            self.assertEqual(
                codex_config["mcp_servers"]["dpf"]["bearer_token_env_var"],
                "DPF_MCP_BEARER_TOKEN",
            )

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
                    "--mcp-url",
                    "https://mcp.example.test/api/mcp/v1",
                ])

            data = tomllib.loads(config.read_text())
            self.assertEqual(data["model"], "gpt-5.5")
            self.assertTrue(data["plugins"]["dpf-platform"]["enabled"])
            self.assertEqual(data["mcp_servers"]["dpf"]["url"], "https://mcp.example.test/api/mcp/v1")

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
                ])

            raw = config.read_text()
            if tomllib is not None:
                data = tomllib.loads(raw)
                self.assertTrue(data["plugins"]["dpf-platform"]["enabled"])
            self.assertEqual(raw.count("dpf-platform"), 1)

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


if __name__ == "__main__":
    unittest.main()
