"""BI-3E66F76F (S4 of BI-63672FBE): each connector reports how the host agent last fared.

The portal shows why a client is behind and escalates a host that has been
failing for a day, from the `converge=status[:code][@since]` the connector
declares. Every case uses a fake HOME.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import toolchain_convergence as convergence  # noqa: E402


def _state(home: Path, **fields: object) -> None:
    path = home / ".dpf" / "toolchain-agent" / "state.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(fields))


class AgentConvergeTokenTest(unittest.TestCase):
    def test_no_agent_state_means_no_report(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(convergence.agent_converge_token(Path(tmp)))

    def test_a_failing_host_reports_its_code_and_first_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _state(Path(tmp), status="failed", code="exit-1", failureSince=1761500000.5)
            self.assertEqual(convergence.agent_converge_token(Path(tmp)), "failed:exit-1@1761500000")

    def test_a_healthy_host_reports_only_its_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _state(Path(tmp), status="ok", code=None, failureSince=None)
            self.assertEqual(convergence.agent_converge_token(Path(tmp)), "ok")

    def test_anything_outside_the_vocabulary_is_never_sent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _state(Path(tmp), status="great")
            self.assertIsNone(convergence.agent_converge_token(Path(tmp)))
            _state(Path(tmp), status="failed", code="has spaces; and=signs")
            self.assertEqual(convergence.agent_converge_token(Path(tmp)), "failed")


class DeclarationCarriesTheReportTest(unittest.TestCase):
    def test_header_and_query_carriers_include_it_and_a_rewrite_replaces_it(self) -> None:
        declared = convergence.Declarations.of("0.2.18", "a" * 64)
        declared.converge = "failed:exit-1@1761500000"
        self.assertEqual(declared.header_value("codex"),
                         f"pack=0.2.18;digest={'a' * 16};client=codex;converge=failed:exit-1@1761500000")
        url = declared.query_url("https://localhost/api/mcp/v1?tier=full&dpf_converge=ok", "grok")
        self.assertIn("dpf_converge=failed%3Aexit-1%401761500000", url)
        self.assertEqual(url.count("dpf_converge"), 1)

    def test_without_a_report_the_declaration_is_unchanged(self) -> None:
        declared = convergence.Declarations.of("0.2.18", "a" * 64)
        self.assertEqual(declared.header_value("codex"), f"pack=0.2.18;digest={'a' * 16};client=codex")


if __name__ == "__main__":
    unittest.main()
