"""Unit tests for agent_outcome (BI-1BAA177C). Stdlib-only, like url_policy_test.py."""

import unittest

from agent_outcome import agent_outcome


class FakeHistory:
    def __init__(self, done=None, successful=None, raise_on=None):
        self._done = done
        self._successful = successful
        self._raise_on = raise_on or set()

    def is_done(self):
        if "is_done" in self._raise_on:
            raise RuntimeError("boom")
        return self._done

    def is_successful(self):
        if "is_successful" in self._raise_on:
            raise RuntimeError("boom")
        return self._successful


class AgentOutcomeTest(unittest.TestCase):
    def test_none_history_is_degraded(self):
        ok, reason = agent_outcome(None)
        self.assertFalse(ok)
        self.assertIn("no history", reason)

    def test_aborted_run_is_degraded(self):
        # The live failure mode: consecutive BrowserStateRequestEvent
        # failures abort the run; history is not done.
        ok, reason = agent_outcome(FakeHistory(done=False, successful=None))
        self.assertFalse(ok)
        self.assertIn("stopped before completing", reason)

    def test_explicit_failure_is_degraded(self):
        ok, reason = agent_outcome(FakeHistory(done=True, successful=False))
        self.assertFalse(ok)
        self.assertIn("reported failure", reason)

    def test_successful_run_is_ok(self):
        ok, _ = agent_outcome(FakeHistory(done=True, successful=True))
        self.assertTrue(ok)

    def test_done_with_unknown_success_is_ok(self):
        # is_successful() returns None on some paths — never false-alarm.
        ok, _ = agent_outcome(FakeHistory(done=True, successful=None))
        self.assertTrue(ok)

    def test_api_drift_does_not_degrade(self):
        # Object without the expected methods (library API drift): stay ok.
        ok, _ = agent_outcome(object())
        self.assertTrue(ok)

    def test_inspection_exception_does_not_degrade(self):
        ok, reason = agent_outcome(FakeHistory(raise_on={"is_done"}))
        self.assertTrue(ok)
        self.assertIn("inspection unavailable", reason)


if __name__ == "__main__":
    unittest.main()
