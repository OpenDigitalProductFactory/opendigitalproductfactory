import json
import os
import tempfile
import tomllib
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update_agent_toolchain as updater


class UpdateAgentToolchainTest(unittest.TestCase):
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
