"""BI-65C17737 (S3 of BI-63672FBE): the host convergence service.

Detection already worked; nothing remediated without a person asking an agent
to run the updater. The service runs the same signed updater hourly and at
login, outside any client session, against the origin and installation this
host already pinned. Spec 2026-10-27-self-converging-agent-toolchain, M2.

Every case builds a fake HOME and fakes the network, the updater and the
scheduler; nothing reads the real home or registers a real job.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import toolchain_agent as agent  # noqa: E402
import update_agent_toolchain as updater  # noqa: E402

ORIGIN = "https://localhost"
DID = "did_" + "a" * 64
OTHER_DID = "did_" + "b" * 64
HOUR = 3600.0


def _home(root: Path, pins: Optional[dict[str, str]] = None, bootstrapped: bool = True) -> Path:
    home = root / "home"
    home.mkdir()
    pins = {ORIGIN: DID} if pins is None else pins
    if pins:
        updater.write_json(home / ".dpf" / "trusted-installations.json",
                           {"installations": {origin: {"deviceId": did} for origin, did in pins.items()}})
    if bootstrapped:
        script = updater.shared_managed_plugin_path(home) / "scripts" / "update_agent_toolchain.py"
        script.parent.mkdir(parents=True)
        script.write_text("# fake updater\n")
    return home


class _Completed:
    def __init__(self, returncode: int) -> None:
        self.returncode = returncode


class Fakes:
    """A manifest source, an updater and a client-version probe, all recorded."""

    def __init__(self, digest: str = "1" * 64, result: str = "converged", code: int = 0,
                 refusal: Optional[str] = None, offline: bool = False,
                 versions: Optional[dict[str, Optional[str]]] = None) -> None:
        self.digest = digest
        self.result = result
        self.code = code
        self.refusal = refusal
        self.offline = offline
        self.versions = versions or {"claude-code": "2.1.197", "codex": None}
        self.runs: list[list[str]] = []

    def manifest(self, origin: str, expected: str, home: Path, env: Any) -> dict[str, Any]:
        if self.offline:
            raise OSError("connection refused")
        return {"packDigest": self.digest, "packVersion": "0.2.18", "deliveredVersion": f"0.2.18+c.{self.digest[:12]}"}

    def runner(self, command: list[str], **kwargs: Any) -> _Completed:
        self.runs.append(command)
        report = Path(command[command.index("--report-json") + 1])
        payload: dict[str, Any] = {"result": "refused" if self.refusal else self.result, "clients": [
            {"client": "claude-code", "scope": "local:/p", "action": "updated"},
            {"client": "codex", "scope": "user", "action": "failed" if self.result == "failed" else "updated",
             "detail": "failed: TOML updates require Python 3.11+ or tomli; configuration unchanged"},
        ]}
        if self.refusal:
            payload["refusal"] = {"code": self.refusal, "message": "x"}
        report.write_text(json.dumps(payload))
        return _Completed(self.code)

    def run(self, home: Path, now: float, env: Optional[dict[str, str]] = None) -> dict[str, Any]:
        return agent.run_once(home, env or {}, now=now, fetch_manifest=self.manifest,
                              runner=self.runner, client_versions=lambda: dict(self.versions))


class RunOnceTest(unittest.TestCase):
    def test_first_run_converges_through_the_signed_updater_for_the_pinned_installation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            fakes = Fakes()
            state = fakes.run(home, now=1000.0)
            self.assertEqual(state["status"], "ok")
            self.assertEqual(len(fakes.runs), 1)
            command = fakes.runs[0]
            self.assertIn("--from-portal", command)
            self.assertEqual(command[command.index("--from-portal") + 1], ORIGIN)
            self.assertEqual(command[command.index("--expect-installation") + 1], DID)
            self.assertTrue(command[1].endswith("dpf-platform/scripts/update_agent_toolchain.py"))
            on_disk = json.loads(agent.state_path(home).read_text())
            self.assertEqual(on_disk["manifestDigest"], "1" * 64)
            self.assertEqual(on_disk["lastSuccessAt"], 1000.0)

    def test_an_unchanged_release_with_verified_clients_does_not_run_the_updater(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            fakes = Fakes()
            fakes.run(home, now=1000.0)
            state = fakes.run(home, now=1000.0 + HOUR)
            self.assertEqual(len(fakes.runs), 1)
            self.assertEqual(state["status"], "ok")
            self.assertEqual(state["lastDecision"], "current")

    def test_a_new_release_runs_the_updater(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            Fakes(digest="1" * 64).run(home, now=1000.0)
            fakes = Fakes(digest="2" * 64)
            state = fakes.run(home, now=1000.0 + HOUR)
            self.assertEqual(len(fakes.runs), 1)
            self.assertEqual(state["lastDecision"], "new-release")

    def test_a_changed_client_binary_re_verifies(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            Fakes().run(home, now=1000.0)
            fakes = Fakes(versions={"claude-code": "2.1.300", "codex": None})
            state = fakes.run(home, now=1000.0 + HOUR)
            self.assertEqual(len(fakes.runs), 1)
            self.assertEqual(state["lastDecision"], "client-changed")

    def test_success_is_re_verified_daily_even_without_a_release(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            Fakes().run(home, now=1000.0)
            fakes = Fakes()
            state = fakes.run(home, now=1000.0 + 25 * HOUR)
            self.assertEqual(len(fakes.runs), 1)
            self.assertEqual(state["lastDecision"], "periodic-verify")

    def test_failure_backs_off_exponentially_and_keeps_its_first_failure_time(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            failing = Fakes(result="failed", code=1)
            first = failing.run(home, now=1000.0)
            self.assertEqual(first["status"], "failed")
            self.assertEqual(first["failureSince"], 1000.0)
            self.assertEqual(first["backoffUntil"], 1000.0 + HOUR)
            self.assertIn("codex", first["detail"])
            # Inside the backoff window nothing runs.
            failing.run(home, now=1000.0 + HOUR / 2)
            self.assertEqual(len(failing.runs), 1)
            second = failing.run(home, now=1000.0 + HOUR)
            self.assertEqual(len(failing.runs), 2)
            self.assertEqual(second["backoffUntil"], 1000.0 + HOUR + 2 * HOUR)
            self.assertEqual(second["failureSince"], 1000.0)

    def test_backoff_is_capped_at_a_day(self) -> None:
        self.assertEqual(agent.backoff_seconds(1), HOUR)
        self.assertEqual(agent.backoff_seconds(3), 4 * HOUR)
        self.assertEqual(agent.backoff_seconds(30), 24 * HOUR)

    def test_success_after_failure_clears_the_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            Fakes(result="failed", code=1).run(home, now=1000.0)
            state = Fakes().run(home, now=1000.0 + HOUR)
            self.assertEqual(state["status"], "ok")
            self.assertIsNone(state["failureSince"])
            self.assertIsNone(state["backoffUntil"])

    def test_an_identity_refusal_needs_the_operator_and_is_never_auto_trusted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            fakes = Fakes(refusal="identity_changed", code=3)
            state = fakes.run(home, now=1000.0)
            self.assertEqual(state["status"], "needs-operator")
            self.assertEqual(state["code"], "identity_changed")
            command = fakes.runs[0]
            self.assertNotIn("--approve-identity-change", command)

    def test_offline_keeps_the_last_good_state_and_does_not_count_as_a_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            Fakes().run(home, now=1000.0)
            offline = Fakes(offline=True)
            state = offline.run(home, now=1000.0 + 25 * HOUR)
            self.assertEqual(state["status"], "offline")
            self.assertEqual(state["lastSuccessAt"], 1000.0)
            self.assertIsNone(state["failureSince"])
            self.assertEqual(offline.runs, [])

    def test_opt_out_is_honoured_and_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            updater.write_json(agent.config_path(home), {"enabled": False})
            fakes = Fakes()
            state = fakes.run(home, now=1000.0)
            self.assertEqual(state["status"], "opted-out")
            self.assertEqual(fakes.runs, [])

    def test_a_host_with_no_pinned_installation_waits_for_its_first_agent_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp), pins={})
            fakes = Fakes()
            state = fakes.run(home, now=1000.0)
            self.assertEqual(state["status"], "needs-operator")
            self.assertEqual(state["code"], "not-paired")
            self.assertEqual(fakes.runs, [])

    def test_several_pins_need_a_chosen_origin(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp), pins={ORIGIN: DID, "https://other.example": OTHER_DID})
            fakes = Fakes()
            state = fakes.run(home, now=1000.0)
            self.assertEqual(state["code"], "ambiguous-origin")
            self.assertEqual(fakes.runs, [])
            updater.write_json(agent.config_path(home), {"origin": "https://other.example"})
            fakes.run(home, now=1001.0)
            command = fakes.runs[0]
            self.assertEqual(command[command.index("--expect-installation") + 1], OTHER_DID)

    def test_a_concurrent_run_exits_busy_without_running(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            self.assertTrue(agent.acquire_lock(home, now=1000.0, pid=os.getpid()))
            fakes = Fakes()
            state = fakes.run(home, now=1001.0)
            self.assertEqual(state["status"], "busy")
            self.assertEqual(fakes.runs, [])
            agent.release_lock(home)

    def test_a_stale_lock_from_a_dead_process_is_taken_over(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            lock = agent.lock_path(home)
            lock.parent.mkdir(parents=True, exist_ok=True)
            lock.write_text(json.dumps({"pid": 999999999, "at": 1000.0}))
            fakes = Fakes()
            state = fakes.run(home, now=1001.0)
            self.assertEqual(state["status"], "ok")
            self.assertFalse(lock.exists())

    def test_an_old_lock_is_taken_over_even_if_its_pid_was_reused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            lock = agent.lock_path(home)
            lock.parent.mkdir(parents=True, exist_ok=True)
            lock.write_text(json.dumps({"pid": os.getpid(), "at": 1000.0}))
            state = Fakes().run(home, now=1000.0 + 31 * 60)
            self.assertEqual(state["status"], "ok")

    def test_an_unbootstrapped_host_reports_it_instead_of_failing_silently(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp), bootstrapped=False)
            state = Fakes().run(home, now=1000.0)
            self.assertEqual(state["status"], "needs-operator")
            self.assertEqual(state["code"], "not-bootstrapped")

    def test_the_child_updater_knows_it_runs_under_the_agent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            seen: dict[str, Any] = {}
            fakes = Fakes()

            def runner(command: list[str], **kwargs: Any) -> _Completed:
                seen.update(kwargs.get("env") or {})
                return fakes.runner(command)

            agent.run_once(home, {"PATH": "/bin"}, now=1000.0, fetch_manifest=fakes.manifest,
                           runner=runner, client_versions=lambda: {})
            self.assertEqual(seen.get(agent.AGENT_ENV), "1")
            self.assertEqual(seen.get("PATH"), "/bin")


class _ClientFakes(Fakes):
    """The updater's report fails exactly the named clients' rows."""

    def __init__(self, failing: tuple[str, ...] = (), **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.failing = failing

    def runner(self, command: list[str], **kwargs: Any) -> _Completed:
        self.runs.append(command)
        report = Path(command[command.index("--report-json") + 1])
        rows = [{"client": client, "scope": "user", "action": "failed" if client in self.failing else "updated",
                 "detail": "read-back: Grok's plugin store does not hold the delivered pack." if client in self.failing else None}
                for client in ("claude-code", "grok")]
        report.write_text(json.dumps({"result": "failed" if self.failing else "converged", "clients": rows}))
        return _Completed(1 if self.failing else 0)


class CanaryTest(unittest.TestCase):
    """BI-D43723D7 (spec M7): a client whose new version breaks read-back is named unproven."""

    VERSIONS = {"claude-code": "2.1.197 (Claude Code)", "grok": "grok 1.0.67 (2fe064390d07) [stable]"}

    def _run(self, home: Path, now: float, versions: dict[str, str], failing: tuple[str, ...] = ()) -> dict[str, Any]:
        return _ClientFakes(failing=failing, versions=versions).run(home, now=now)

    def test_a_passing_run_records_each_client_version_as_verified(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            state = self._run(home, 1000.0, self.VERSIONS)
        self.assertEqual(state["verifiedVersions"], self.VERSIONS)
        self.assertEqual(state.get("unproven") or {}, {})

    def test_an_upgraded_client_that_fails_read_back_is_unproven_at_its_new_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            self._run(home, 1000.0, self.VERSIONS)
            upgraded = {**self.VERSIONS, "grok": "grok 1.0.68 (abc) [stable]"}
            state = self._run(home, 1000.0 + HOUR, upgraded, failing=("grok",))
        self.assertEqual(state["status"], "failed")
        self.assertEqual(state["code"], "unproven.grok.1.0.68")
        self.assertEqual(state["unproven"]["grok"]["version"], "grok 1.0.68 (abc) [stable]")
        self.assertIn("read-back", state["unproven"]["grok"]["detail"])
        # The last version that worked stays the reference.
        self.assertEqual(state["verifiedVersions"]["grok"], self.VERSIONS["grok"])
        self.assertEqual(state["verifiedVersions"]["claude-code"], self.VERSIONS["claude-code"])

    def test_a_failure_without_a_version_change_is_an_ordinary_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            self._run(home, 1000.0, self.VERSIONS)
            state = _ClientFakes(failing=("grok",), versions=self.VERSIONS, digest="2" * 64).run(home, now=1000.0 + HOUR)
        self.assertEqual(state["status"], "failed")
        self.assertFalse(str(state["code"]).startswith("unproven."))
        self.assertEqual(state.get("unproven") or {}, {})

    def test_a_later_pass_clears_the_unproven_client(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            self._run(home, 1000.0, self.VERSIONS)
            upgraded = {**self.VERSIONS, "grok": "grok 1.0.68"}
            self._run(home, 1000.0 + HOUR, upgraded, failing=("grok",))
            state = _ClientFakes(versions=upgraded, digest="3" * 64).run(home, now=1000.0 + 30 * HOUR)
        self.assertEqual(state["status"], "ok")
        self.assertEqual(state.get("unproven") or {}, {})
        self.assertEqual(state["verifiedVersions"]["grok"], "grok 1.0.68")

    def test_version_codes_stay_inside_the_converge_token_vocabulary(self) -> None:
        import re
        for raw, expected in (("2.1.197 (Claude Code)", "2.1.197"), ("codex-cli 0.165.0-alpha.1.2", "0.165.0-alpha.1.2"),
                              ("grok 1.0.67 (2fe064390d07) [stable]", "1.0.67"), ("weird", "unknown")):
            code = agent.unproven_code("codex", raw)
            self.assertEqual(code, f"unproven.codex.{expected}")
            self.assertRegex(code, re.compile(r"^[a-z0-9_.-]{1,48}$"))


class PrecedenceTest(unittest.TestCase):
    """Spec row X15: a source checkout ahead of the portal's release wins."""

    def _provenance(self, home: Path, record: dict[str, Any], base: str = "0.2.18") -> None:
        shared = updater.shared_managed_plugin_path(home)
        updater.write_json(shared / ".dpf-delivery.json", record)
        updater.write_json(shared / ".claude-plugin" / "plugin.json", {"name": "dpf-platform", "version": f"{base}+c.x"})

    def _run(self, home: Path, ancestor: Optional[bool], served_version: str = "0.2.18") -> tuple[dict[str, Any], Fakes]:
        fakes = Fakes()
        manifest = lambda *a, **k: {"packDigest": "1" * 64, "packVersion": served_version, "releaseId": "r" * 40}
        state = agent.run_once(home, {}, now=1000.0, fetch_manifest=manifest, runner=fakes.runner,
                               client_versions=lambda: {}, is_ancestor=lambda root, older, newer: ancestor)
        return state, fakes

    def test_a_checkout_that_contains_the_served_release_is_left_alone(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            self._provenance(home, {"source": "checkout", "root": "/repo", "commit": "c" * 40})
            state, fakes = self._run(home, ancestor=True)
            self.assertEqual(state["status"], "ahead-of-portal")
            self.assertEqual(fakes.runs, [])

    def test_a_checkout_behind_the_served_release_converges_from_the_portal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            self._provenance(home, {"source": "checkout", "root": "/repo", "commit": "c" * 40})
            state, fakes = self._run(home, ancestor=False)
            self.assertEqual(state["status"], "ok")
            self.assertEqual(len(fakes.runs), 1)

    def test_without_git_a_newer_base_version_still_wins(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            self._provenance(home, {"source": "checkout", "root": "/repo", "commit": "c" * 40}, base="0.2.19")
            state, fakes = self._run(home, ancestor=None, served_version="0.2.18")
            self.assertEqual(state["status"], "ahead-of-portal")
            self.assertEqual(fakes.runs, [])

    def test_without_git_an_older_base_version_converges(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            self._provenance(home, {"source": "checkout", "root": "/repo", "commit": "c" * 40}, base="0.2.17")
            state, fakes = self._run(home, ancestor=None, served_version="0.2.18")
            self.assertEqual(len(fakes.runs), 1)

    def test_a_portal_delivery_follows_the_portal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = _home(Path(tmp))
            self._provenance(home, {"source": "portal", "releaseId": "q" * 40})
            state, fakes = self._run(home, ancestor=True)
            self.assertEqual(len(fakes.runs), 1)


class ScheduleTest(unittest.TestCase):
    """The schedule is per user, idempotent, and never touched from inside the agent."""

    def _calls(self) -> tuple[list[list[str]], Any]:
        calls: list[list[str]] = []

        def runner(command: list[str], **kwargs: Any) -> _Completed:
            calls.append(command)
            return _Completed(0)

        return calls, runner

    def test_macos_writes_a_user_launch_agent_that_runs_hourly_and_at_login(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            calls, runner = self._calls()
            status = agent.ensure_schedule(home, "/usr/bin/python3", "/s/toolchain_agent.py", {}, platform="darwin",
                                           runner=runner, uid=501)
            plist = home / "Library" / "LaunchAgents" / f"{agent.LAUNCHD_LABEL}.plist"
            text = plist.read_text()
            self.assertIn("<string>/usr/bin/python3</string>", text)
            self.assertIn("<string>/s/toolchain_agent.py</string>", text)
            self.assertIn("<string>run</string>", text)
            self.assertIn("<key>StartInterval</key><integer>3600</integer>", text)
            self.assertIn("<key>RunAtLoad</key><true/>", text)
            self.assertEqual(calls[-1][:3], ["launchctl", "bootstrap", "gui/501"])
            self.assertTrue(status.startswith("scheduled"))

    def test_an_unchanged_schedule_is_a_no_op(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            calls, runner = self._calls()
            agent.ensure_schedule(home, "/usr/bin/python3", "/s/toolchain_agent.py", {}, platform="darwin", runner=runner, uid=501)
            first = len(calls)
            status = agent.ensure_schedule(home, "/usr/bin/python3", "/s/toolchain_agent.py", {}, platform="darwin", runner=runner, uid=501)
            self.assertEqual(len(calls), first)
            self.assertTrue(status.startswith("unchanged"))

    def test_inside_the_agent_the_schedule_is_never_reloaded(self) -> None:
        # launchctl bootout of a running job terminates it: the agent must not
        # re-register itself from the updater it is running.
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            calls, runner = self._calls()
            status = agent.ensure_schedule(home, "/usr/bin/python3", "/s/toolchain_agent.py", {agent.AGENT_ENV: "1"},
                                           platform="darwin", runner=runner, uid=501)
            self.assertEqual(calls, [])
            self.assertTrue(status.startswith("skipped"))

    def test_opted_out_hosts_are_not_scheduled_and_lose_an_existing_schedule(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            calls, runner = self._calls()
            agent.ensure_schedule(home, "/usr/bin/python3", "/s/toolchain_agent.py", {}, platform="darwin", runner=runner, uid=501)
            updater.write_json(agent.config_path(home), {"enabled": False})
            status = agent.ensure_schedule(home, "/usr/bin/python3", "/s/toolchain_agent.py", {}, platform="darwin", runner=runner, uid=501)
            self.assertFalse((home / "Library" / "LaunchAgents" / f"{agent.LAUNCHD_LABEL}.plist").exists())
            self.assertEqual(calls[-1][:2], ["launchctl", "bootout"])
            self.assertTrue(status.startswith("opted-out"))

    def test_linux_writes_a_user_timer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            calls, runner = self._calls()
            agent.ensure_schedule(home, "/usr/bin/python3", "/s/toolchain_agent.py", {}, platform="linux", runner=runner)
            unit_dir = home / ".config" / "systemd" / "user"
            service = (unit_dir / f"{agent.SYSTEMD_UNIT}.service").read_text()
            timer = (unit_dir / f"{agent.SYSTEMD_UNIT}.timer").read_text()
            self.assertIn("ExecStart=/usr/bin/python3 /s/toolchain_agent.py run", service)
            self.assertIn("OnBootSec=2min", timer)
            self.assertIn("OnUnitActiveSec=1h", timer)
            self.assertIn(["systemctl", "--user", "enable", "--now", f"{agent.SYSTEMD_UNIT}.timer"], calls)

    def test_windows_registers_an_hourly_user_task(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            calls, runner = self._calls()
            agent.ensure_schedule(home, "C:\\Python\\python.exe", "C:\\s\\toolchain_agent.py", {}, platform="win32", runner=runner)
            create = calls[-1]
            self.assertEqual(create[:2], ["schtasks", "/Create"])
            self.assertIn("/F", create)
            self.assertEqual(create[create.index("/SC") + 1], "HOURLY")
            self.assertEqual(create[create.index("/TN") + 1], agent.WINDOWS_TASK)
            self.assertIn('"C:\\Python\\python.exe" "C:\\s\\toolchain_agent.py" run', create[create.index("/TR") + 1])


class UpdaterIntegrationTest(unittest.TestCase):
    """The updater shares the agent's lock and registers the schedule after a portal run."""

    def test_a_second_convergence_exits_busy_instead_of_racing(self) -> None:
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"DPF_AGENT_TOOLCHAIN_HOME": tmp}, clear=False):
            os.environ.pop(agent.LOCK_HELD_ENV, None)
            home = Path(tmp)
            self.assertTrue(agent.acquire_lock(home, now=__import__("time").time(), pid=os.getpid()))
            try:
                with patch.object(updater, "_main", return_value=0) as inner:
                    self.assertEqual(updater.main(["--skill-pack-path", "x"]), agent.EXIT_BUSY)
                    inner.assert_not_called()
            finally:
                agent.release_lock(home)

    def test_the_lock_holder_passes_it_to_its_children(self) -> None:
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"DPF_AGENT_TOOLCHAIN_HOME": tmp}, clear=False):
            os.environ.pop(agent.LOCK_HELD_ENV, None)
            seen: list[Optional[str]] = []
            with patch.object(updater, "_main", side_effect=lambda argv: seen.append(os.environ.get(agent.LOCK_HELD_ENV)) or 0):
                self.assertEqual(updater.main(["--skill-pack-path", "x"]), 0)
            self.assertEqual(seen, ["1"])
            self.assertFalse(agent.lock_path(Path(tmp)).exists())
            self.assertIsNone(os.environ.get(agent.LOCK_HELD_ENV))
            # A child that inherits the held lock runs without taking it again.
            with patch.dict(os.environ, {agent.LOCK_HELD_ENV: "1"}), patch.object(updater, "_main", return_value=0) as inner:
                self.assertTrue(agent.acquire_lock(Path(tmp), now=__import__("time").time(), pid=os.getpid()))
                self.assertEqual(updater.main(["--skill-pack-path", "x"]), 0)
                inner.assert_called_once()
            agent.release_lock(Path(tmp))

    def test_a_portal_sourced_run_registers_the_agent_from_the_shared_copy(self) -> None:
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            script = updater.shared_managed_plugin_path(home) / "scripts" / "toolchain_agent.py"
            script.parent.mkdir(parents=True)
            script.write_text("# agent\n")
            with patch.object(agent, "ensure_schedule", return_value="scheduled: launchd") as ensure:
                line = updater.register_toolchain_agent(home, portal_sourced=True, dry_run=False, env={})
            ensure.assert_called_once()
            self.assertEqual(ensure.call_args[0][2], str(script))
            self.assertIn("scheduled", line)
            with patch.object(agent, "ensure_schedule") as ensure:
                self.assertIsNone(updater.register_toolchain_agent(home, portal_sourced=False, dry_run=False, env={}))
                self.assertIsNone(updater.register_toolchain_agent(home, portal_sourced=True, dry_run=True, env={}))
                ensure.assert_not_called()


if __name__ == "__main__":
    unittest.main()
