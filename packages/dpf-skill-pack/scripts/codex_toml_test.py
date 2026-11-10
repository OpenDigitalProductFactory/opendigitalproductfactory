"""BI-90C9478D (S5 of BI-63672FBE): TOML on stock Python 3.9 through Codex's own parser.

Stock macOS ships Python 3.9, which has no tomllib, so since #6623 the updater
refused every Codex settings write there. Codex's app server reads and writes
its own configuration (config/read), so its parser stands in for the missing
library: no dependency, and exactly the parser Codex itself uses (spec
2026-10-27-self-converging-agent-toolchain, M4 and M5; DI-7591BDF26023).

Protocol cases run against a fake app server, so they pass on any runner. One
case runs against the real Codex CLI when this host has one.
"""

from __future__ import annotations

import json
import os
import stat
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import codex_toml  # noqa: E402
import update_agent_toolchain as updater  # noqa: E402

FAKE_SERVER = textwrap.dedent('''\
    #!{python}
    import json, os, sys
    mode = os.environ.get("FAKE_MODE", "ok")
    for line in sys.stdin:
        message = json.loads(line)
        if message.get("method") == "initialize":
            print(json.dumps({{"id": message["id"], "result": {{"codexHome": os.environ["CODEX_HOME"]}}}}), flush=True)
        elif message.get("method") == "config/read":
            if mode == "hang":
                continue
            if mode == "invalid":
                print(json.dumps({{"method": "configWarning", "params": {{"summary": "Invalid configuration; using defaults.", "details": "config.toml:2:8: unclosed table"}}}}), flush=True)
            if mode == "unknown-key":
                print(json.dumps({{"method": "configWarning", "params": {{"summary": "Codex is ignoring 1 unrecognized configuration setting."}}}}), flush=True)
            text = open(os.path.join(os.environ["CODEX_HOME"], "config.toml")).read()
            layer = {{"name": {{"type": "user"}}, "config": json.loads(os.environ["FAKE_PARSED"])}}
            print(json.dumps({{"id": message["id"], "result": {{"config": {{}}, "origins": {{}}, "layers": [layer, {{"name": {{"type": "system"}}, "config": {{}}}}]}}}}), flush=True)
''')


class FakeServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.binary = Path(self.tmp.name) / "codex"
        self.binary.write_text(FAKE_SERVER.format(python=sys.executable))
        self.binary.chmod(self.binary.stat().st_mode | stat.S_IEXEC)

    def _env(self, mode: str, parsed: object) -> dict[str, str]:
        return {"FAKE_MODE": mode, "FAKE_PARSED": json.dumps(parsed)}

    def test_returns_the_user_layer_exactly_as_codex_parsed_it(self) -> None:
        parsed = {"model": "o3", "a": {"b": {"c": [1, 2.5, True]}}}
        with patch.dict(os.environ, self._env("ok", parsed)):
            self.assertEqual(codex_toml.loads('model = "o3"\n', binary=str(self.binary)), parsed)

    def test_an_unrecognized_setting_is_not_a_parse_error(self) -> None:
        with patch.dict(os.environ, self._env("unknown-key", {"x": 1})):
            self.assertEqual(codex_toml.loads("x = 1\n", binary=str(self.binary)), {"x": 1})

    def test_invalid_toml_is_refused_with_codex_s_diagnosis(self) -> None:
        with patch.dict(os.environ, self._env("invalid", {})):
            with self.assertRaises(ValueError) as caught:
                codex_toml.loads("[broken\n", binary=str(self.binary))
        self.assertIn("unclosed table", str(caught.exception))

    def test_a_silent_server_times_out_instead_of_hanging(self) -> None:
        with patch.dict(os.environ, self._env("hang", {})):
            with self.assertRaises(codex_toml.CodexTomlUnavailable):
                codex_toml.loads("x = 1\n", binary=str(self.binary), timeout=2.0)

    def test_a_toml_date_time_is_refused_because_json_would_turn_it_into_a_string(self) -> None:
        with patch.dict(os.environ, self._env("ok", {"when": "1979-05-27"})):
            with self.assertRaises(codex_toml.UnsupportedToml):
                codex_toml.loads("when = 1979-05-27\n", binary=str(self.binary))
            # A date inside a string is only text and is fine.
            self.assertEqual(codex_toml.loads('when = "1979-05-27"\n', binary=str(self.binary)), {"when": "1979-05-27"})

    def test_the_probe_runs_in_a_private_codex_home_never_the_real_one(self) -> None:
        with patch.dict(os.environ, {**self._env("ok", {}), "CODEX_HOME": "/should/not/be/used"}):
            seen: dict[str, str] = {}
            real_popen = codex_toml.subprocess.Popen

            def spy(*args, **kwargs):
                seen["home"] = kwargs["env"]["CODEX_HOME"]
                return real_popen(*args, **kwargs)

            with patch.object(codex_toml.subprocess, "Popen", side_effect=spy):
                codex_toml.loads("x = 1\n", binary=str(self.binary))
        self.assertNotEqual(seen["home"], "/should/not/be/used")
        self.assertFalse(Path(seen["home"]).exists())


class LoadsAnyTest(unittest.TestCase):
    def test_no_parser_at_all_reports_the_missing_runtime(self) -> None:
        with patch.object(codex_toml, "_stdlib_parser", return_value=None), patch.object(codex_toml, "_codex_binary", return_value=None):
            self.assertFalse(codex_toml.available())
            with self.assertRaises(codex_toml.CodexTomlUnavailable):
                codex_toml.loads_any("x = 1\n")

    def test_the_stdlib_parser_is_preferred_when_present(self) -> None:
        class Parser:
            @staticmethod
            def loads(text: str) -> dict:
                return {"parsed": "stdlib"}

        with patch.object(codex_toml, "_stdlib_parser", return_value=Parser), patch.object(codex_toml, "loads") as via_codex:
            self.assertEqual(codex_toml.loads_any("x = 1\n"), {"parsed": "stdlib"})
            via_codex.assert_not_called()


class DiscoveryTest(unittest.TestCase):
    def test_the_codex_cli_bundled_in_the_chatgpt_app_is_found(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            bundled = Path(tmp) / "ChatGPT.app" / "Contents" / "Resources" / "codex-cli" / "bin" / "codex"
            bundled.parent.mkdir(parents=True)
            bundled.write_text("#!/bin/sh\n")
            bundled.chmod(0o755)
            with patch.object(updater, "MACOS_APP_DIRS", (Path(tmp),)), patch.object(updater.platform, "system", return_value="Darwin"), \
                    patch.object(updater.shutil, "which", return_value=None), patch.dict(os.environ, {"CODEX_CLI_PATH": ""}):
                self.assertEqual(updater.resolve_codex_binary(), str(bundled))


@unittest.skipUnless(updater.resolve_codex_binary(), "no Codex CLI on this host")
class RealCodexTest(unittest.TestCase):
    def test_codex_parses_a_real_config(self) -> None:
        parsed = codex_toml.loads('model = "o3"\n\n[mcp_servers.dpf]\nurl = "https://localhost/api/mcp/v1"\n')
        self.assertEqual(parsed, {"model": "o3", "mcp_servers": {"dpf": {"url": "https://localhost/api/mcp/v1"}}})

    def test_codex_refuses_broken_toml(self) -> None:
        with self.assertRaises(ValueError):
            codex_toml.loads('model = "o3"\n[broken\n')


if __name__ == "__main__":
    unittest.main()
