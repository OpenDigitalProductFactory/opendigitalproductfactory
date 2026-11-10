"""Negative controls for the release timeout proof, run in the doctools image."""

import importlib.util
import pathlib
import subprocess
import tempfile
import unittest


here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location("timeout_probe", here / "timeout-probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class TimeoutProof(unittest.TestCase):
    def test_real_deadline_kills_child_and_cleans_workspace(self):
        self.assertEqual(probe.verify_timeout(), 124)

    def assert_broken_renderer_is_rejected(self, original, replacement):
        source = pathlib.Path("/usr/local/bin/dpf-render").read_text()
        self.assertEqual(source.count(original), 1)
        with tempfile.TemporaryDirectory(prefix="timeout-negative-", dir="/tmp") as work:
            mutated = pathlib.Path(work) / "dpf-render"
            mutated.write_text(source.replace(original, replacement))
            with self.assertRaises((AssertionError, subprocess.TimeoutExpired)):
                probe.verify_timeout(str(mutated))

    def test_missing_alarm_cannot_pass_the_proof(self):
        self.assert_broken_renderer_is_rejected(
            "signal.alarm(TIMEOUT_SECONDS)", "signal.alarm(0)"
        )

    def test_missing_child_kill_cannot_pass_the_proof(self):
        self.assert_broken_renderer_is_rejected("            proc.kill()", "            pass")

    def test_ignored_timeout_configuration_cannot_pass_the_proof(self):
        self.assert_broken_renderer_is_rejected(
            'int(os.environ.get("DPF_RENDER_TIMEOUT_SECONDS", "200"))', "200"
        )


if __name__ == "__main__":
    unittest.main()
