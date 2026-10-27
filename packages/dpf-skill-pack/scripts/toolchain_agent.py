"""Keep this host's DPF agent toolchain current with no person in the loop.

BI-65C17737 (S3 of BI-63672FBE; spec
docs/superpowers/specs/2026-10-27-self-converging-agent-toolchain-design.md M2).
The pack changes about eleven times a week. Detection already worked, but
nothing remediated until a person asked an agent to run the updater. This is
the per-user job that does it: hourly and at login, outside any client session.

It adds no new trust and no new update logic. Each run:

1. takes a single-instance lock (a second run exits `busy`);
2. honours `~/.dpf/toolchain-agent/config.json` (`{"enabled": false}` opts out;
   `{"origin": ...}` chooses among several paired portals);
3. reads the signed manifest for the origin and installation this host already
   pinned in `~/.dpf/trusted-installations.json` (a first agent-run update
   writes that pin; a changed identity is refused, never trusted here);
4. runs the same signed updater (`--from-portal ... --expect-installation ...`)
   only when something changed: a new release, a changed client binary, a
   retry after failure once its backoff elapsed, or a daily re-verification;
5. leaves alone a copy a contributor's source checkout delivered when that
   checkout contains the served release (spec row X15: `ahead-of-portal`);
6. writes `~/.dpf/toolchain-agent/state.json` atomically. That file is this
   job's own: the bootstrap's readiness record (`agent-toolchain-state.json`)
   has a different writer and is never touched here.

Standard library only, Python 3.9+, so it runs on the system python3 of every
supported OS. It handles no credentials: the manifest and archive are public
and the signature pin is the trust anchor.

Usage: toolchain_agent.py run | install | uninstall | status
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Mapping, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

HOUR = 3600.0
DAY = 24 * HOUR
LOCK_STALE_SECONDS = 30 * 60
AGENT_ENV = "DPF_TOOLCHAIN_AGENT"
# Set by whichever process holds the run lock, so the updater processes it
# starts (portal_source's verified child, the agent's run) do not wait on it.
LOCK_HELD_ENV = "DPF_TOOLCHAIN_LOCK_HELD"
# EX_TEMPFAIL: another convergence on this host owns the run; try later.
EXIT_BUSY = 75
LAUNCHD_LABEL = "local.dpf.toolchain-agent"
SYSTEMD_UNIT = "dpf-toolchain-agent"
WINDOWS_TASK = "DPF Toolchain Agent"
LOG_LIMIT_BYTES = 1_000_000


# ---------------------------------------------------------------- paths


def agent_dir(home: Path) -> Path:
    return home / ".dpf" / "toolchain-agent"


def state_path(home: Path) -> Path:
    return agent_dir(home) / "state.json"


def config_path(home: Path) -> Path:
    return agent_dir(home) / "config.json"


def lock_path(home: Path) -> Path:
    return agent_dir(home) / "run.lock"


def report_path(home: Path) -> Path:
    return agent_dir(home) / "last-report.json"


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    staged = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    staged.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(staged, path)


def _log(home: Path, now: float, line: str) -> None:
    path = agent_dir(home) / "agent.log"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and path.stat().st_size > LOG_LIMIT_BYTES:
            os.replace(path, path.with_suffix(".log.1"))
        with path.open("a", encoding="utf-8") as handle:
            handle.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now))} {line}\n")
    except OSError:
        # The log is a convenience; a full disk or unwritable folder must never fail a run.
        pass


def load_config(home: Path) -> dict[str, Any]:
    data = _read_json(config_path(home))
    return data if isinstance(data, dict) else {}


def load_state(home: Path) -> dict[str, Any]:
    data = _read_json(state_path(home))
    return data if isinstance(data, dict) else {}


# ---------------------------------------------------------------- lock


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        completed = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True)
        return str(pid) in (completed.stdout or "")
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def acquire_lock(home: Path, now: float, pid: Optional[int] = None) -> bool:
    """Take the run lock; take over one held by a dead process or older than 30 minutes."""
    path = lock_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    holder = {"pid": pid if pid is not None else os.getpid(), "at": now}
    for _ in range(2):
        try:
            descriptor = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            existing = _read_json(path)
            stale = (not isinstance(existing, dict)
                     or not _pid_alive(int(existing.get("pid") or 0))
                     or now - float(existing.get("at") or 0) > LOCK_STALE_SECONDS)
            if not stale:
                return False
            try:
                path.unlink()
            except FileNotFoundError:
                # Another run removed the stale lock first; retry the exclusive create.
                pass
            continue
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(holder))
        return True
    return False


def release_lock(home: Path) -> None:
    try:
        lock_path(home).unlink()
    except FileNotFoundError:
        # Already released (or removed by a stale-lock takeover): release is idempotent.
        pass


# ---------------------------------------------------------------- decisions


def backoff_seconds(failures: int) -> float:
    """1h, 2h, 4h ... capped at a day."""
    return min(DAY, HOUR * (2 ** max(0, failures - 1)))


def select_target(home: Path, config: Mapping[str, Any]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """(origin, pinned device id, problem code). Only an already-pinned pair is ever used."""
    import portal_source

    pins = portal_source.read_pins(home)
    chosen = config.get("origin")
    if isinstance(chosen, str) and chosen:
        try:
            chosen = portal_source.normalize_origin(chosen)
        except Exception:
            return None, None, "invalid-origin"
        return (chosen, pins[chosen], None) if chosen in pins else (None, None, "not-paired")
    if not pins:
        return None, None, "not-paired"
    if len(pins) > 1:
        return None, None, "ambiguous-origin"
    origin, device_id = next(iter(pins.items()))
    return origin, device_id, None


def decide(state: Mapping[str, Any], digest: str, versions: Mapping[str, Any], now: float) -> Optional[str]:
    """Why to run the updater now, or None when this host is already current."""
    if not state.get("lastAttemptAt"):
        return "first-run"
    # A new release or a changed client is new information: it runs even
    # inside a failure's backoff window.
    if state.get("manifestDigest") != digest:
        return "new-release"
    if dict(state.get("cliVersions") or {}) != dict(versions):
        return "client-changed"
    if state.get("status") in ("failed", "needs-operator"):
        until = state.get("backoffUntil")
        return "retry" if until is None or now >= float(until) else None
    last_success = state.get("lastSuccessAt")
    if last_success is None or now - float(last_success) >= DAY:
        return "periodic-verify"
    return None


def _fetch_manifest(origin: str, expected: str, home: Path, env: Mapping[str, str]) -> dict[str, Any]:
    import portal_source

    raw = portal_source.fetch(origin + portal_source.MANIFEST_PATH, portal_source.MAX_MANIFEST_BYTES, home, env)
    manifest = json.loads(raw.decode("utf-8"))
    portal_source.verify_manifest(manifest, expected)
    return manifest


def _git_is_ancestor(root: str, older: str, newer: str) -> Optional[bool]:
    """True when `older` is contained in `newer` in the checkout at `root`; None when git cannot tell."""
    try:
        completed = subprocess.run(["git", "-C", root, "merge-base", "--is-ancestor", older, newer],
                                   capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode == 0:
        return True
    if completed.returncode == 1:
        return False
    return None  # 128: an unknown commit, or not a repository


def _base_key(version: Any) -> Optional[tuple[int, ...]]:
    try:
        return tuple(int(part) for part in str(version).split("+", 1)[0].split("-", 1)[0].split("."))
    except ValueError:
        return None


def checkout_precedence(home: Path, manifest: Mapping[str, Any],
                        is_ancestor: Callable[[str, str, str], Optional[bool]]) -> Optional[str]:
    """Spec row X15: why a checkout-delivered copy must be left alone, or None to follow the portal.

    A contributor host's session bootstrap installs the pack from its source
    checkout. Reinstalling an older portal pack over it every hour would fight
    that writer, so a checkout that contains the served release wins.
    """
    import update_agent_toolchain as updater

    shared = updater.shared_managed_plugin_path(home)
    record = _read_json(shared / ".dpf-delivery.json")
    if not isinstance(record, dict) or record.get("source") != "checkout":
        return None
    release, commit, root = manifest.get("releaseId"), record.get("commit"), record.get("root")
    if isinstance(release, str) and isinstance(commit, str) and isinstance(root, str):
        verdict = is_ancestor(root, release, commit)
        if verdict is True:
            return "checkout contains the served release"
        if verdict is False:
            return None
    manifest_version = _read_json(shared / ".claude-plugin" / "plugin.json")
    installed = _base_key(manifest_version.get("version") if isinstance(manifest_version, dict) else None)
    served = _base_key(manifest.get("packVersion"))
    if installed is None or served is None:
        return None
    if installed > served:
        return "checkout base version is ahead of the served release"
    if installed == served:
        return "checkout order unverified at the same base version; the checkout keeps precedence"
    return None


def _client_versions() -> dict[str, Optional[str]]:
    import toolchain_convergence

    return toolchain_convergence.cli_versions()


def _summarize(report: Any) -> tuple[str, str]:
    """(result, one-line detail) from the updater's --report-json."""
    if not isinstance(report, dict):
        return "failed", "the updater wrote no report"
    result = str(report.get("result") or "failed")
    failed = [entry for entry in report.get("clients") or []
              if isinstance(entry, dict) and entry.get("action") in ("failed", "unrun")]
    names = sorted({f"{entry.get('client')} {entry.get('scope')}".strip() for entry in failed})
    detail = "; ".join(names[:6]) + (f" (+{len(names) - 6} more)" if len(names) > 6 else "")
    if failed:
        first = str(failed[0].get("detail") or "")[:200]
        detail = f"{detail}: {first}" if first else detail
    return result, detail


# ---------------------------------------------------------------- one run


def run_once(
    home: Path,
    env: Mapping[str, str],
    now: Optional[float] = None,
    fetch_manifest: Callable[..., dict[str, Any]] = _fetch_manifest,
    runner: Callable[..., Any] = subprocess.run,
    client_versions: Callable[[], dict[str, Optional[str]]] = _client_versions,
    is_ancestor: Callable[[str, str, str], Optional[bool]] = _git_is_ancestor,
) -> dict[str, Any]:
    """One convergence pass. Returns, and persists, this host's state."""
    import update_agent_toolchain as updater

    now = time.time() if now is None else now
    state: dict[str, Any] = {"schemaVersion": 1, **load_state(home)}
    state.setdefault("failureSince", None)
    state.setdefault("backoffUntil", None)
    state.setdefault("failures", 0)
    state["lastCheckAt"] = now
    state["python"] = sys.executable

    def finish(status: str, code: Optional[str] = None, detail: str = "", decision: Optional[str] = None) -> dict[str, Any]:
        state.update({"status": status, "code": code, "detail": detail, "lastDecision": decision})
        _write_json_atomic(state_path(home), state)
        _log(home, now, f"{status}{':' + code if code else ''} {decision or ''} {detail}".strip())
        return state

    config = load_config(home)
    if config.get("enabled") is False:
        return finish("opted-out")
    if not acquire_lock(home, now):
        # Another run owns the state file; report without writing over it.
        return {**state, "status": "busy"}
    try:
        origin, device_id, problem = select_target(home, config)
        if problem:
            return finish("needs-operator", problem)
        script = updater.shared_managed_plugin_path(home) / "scripts" / "update_agent_toolchain.py"
        if not script.is_file():
            return finish("needs-operator", "not-bootstrapped")
        try:
            manifest = fetch_manifest(origin, device_id, home, env)
        except OSError as error:
            return finish("offline", None, str(error)[:200])
        except Exception as error:  # PortalRefusal and malformed manifests
            code = getattr(error, "code", "manifest-refused")
            return finish("needs-operator", str(code), str(getattr(error, "message", error))[:200])
        ahead = checkout_precedence(home, manifest, is_ancestor)
        if ahead:
            return finish("ahead-of-portal", None, ahead, "checkout-precedence")
        digest = str(manifest.get("packDigest") or "")
        versions = client_versions()
        decision = decide(state, digest, versions, now)
        if decision is None:
            return finish(state.get("status") or "ok", state.get("code"), state.get("detail") or "", "current")
        report = report_path(home)
        try:
            report.unlink()
        except FileNotFoundError:
            # No report from a previous run: nothing to clear.
            pass
        command = [sys.executable, str(script), "--from-portal", str(origin),
                   "--expect-installation", str(device_id), "--report-json", str(report)]
        state["lastAttemptAt"] = now
        completed = runner(command, env={**env, AGENT_ENV: "1", LOCK_HELD_ENV: "1"}, capture_output=True, text=True)
        code_out = int(getattr(completed, "returncode", 1))
        parsed = _read_json(report)
        result, detail = _summarize(parsed)
        state["manifestDigest"] = digest
        state["deliveredVersion"] = manifest.get("deliveredVersion")
        state["cliVersions"] = versions
        if code_out == 0 and result == "converged":
            state.update({"lastSuccessAt": now, "failureSince": None, "backoffUntil": None, "failures": 0})
            return finish("ok", None, "", decision)
        state["failures"] = int(state.get("failures") or 0) + 1
        state["failureSince"] = state.get("failureSince") or now
        state["backoffUntil"] = now + backoff_seconds(state["failures"])
        refusal = parsed.get("refusal") if isinstance(parsed, dict) else None
        if result == "refused" or isinstance(refusal, dict):
            refusal_code = refusal.get("code") if isinstance(refusal, dict) else None
            return finish("needs-operator", str(refusal_code or "refused"), detail, decision)
        return finish("failed", f"exit-{code_out}" if code_out else result, detail, decision)
    finally:
        release_lock(home)


# ---------------------------------------------------------------- schedule


def _plist(python: str, script: str, log: Path) -> str:
    arguments = "".join(f"    <string>{value}</string>\n" for value in (python, script, "run"))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0">\n<dict>\n'
        f"  <key>Label</key><string>{LAUNCHD_LABEL}</string>\n"
        "  <key>ProgramArguments</key>\n  <array>\n" + arguments + "  </array>\n"
        "  <key>StartInterval</key><integer>3600</integer>\n"
        "  <key>RunAtLoad</key><true/>\n"
        "  <key>ProcessType</key><string>Background</string>\n"
        f"  <key>StandardOutPath</key><string>{log}</string>\n"
        f"  <key>StandardErrorPath</key><string>{log}</string>\n"
        "</dict>\n</plist>\n"
    )


def _systemd(python: str, script: str) -> tuple[str, str]:
    service = (
        "[Unit]\nDescription=DPF agent toolchain convergence (BI-65C17737)\n\n"
        f"[Service]\nType=oneshot\nExecStart={python} {script} run\n"
    )
    timer = (
        "[Unit]\nDescription=Converge the DPF agent toolchain hourly\n\n"
        "[Timer]\nOnBootSec=2min\nOnUnitActiveSec=1h\nPersistent=true\n\n"
        "[Install]\nWantedBy=timers.target\n"
    )
    return service, timer


def _write_if_changed(path: Path, content: str) -> bool:
    if path.is_file() and path.read_text(encoding="utf-8") == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def _remove_schedule(home: Path, platform: str, runner: Callable[..., Any], uid: int) -> None:
    if platform == "darwin":
        runner(["launchctl", "bootout", f"gui/{uid}/{LAUNCHD_LABEL}"], capture_output=True, text=True)
        plist = home / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist"
        if plist.exists():
            plist.unlink()
    elif platform.startswith("linux"):
        runner(["systemctl", "--user", "disable", "--now", f"{SYSTEMD_UNIT}.timer"], capture_output=True, text=True)
        for suffix in (".timer", ".service"):
            unit = home / ".config" / "systemd" / "user" / f"{SYSTEMD_UNIT}{suffix}"
            if unit.exists():
                unit.unlink()
    elif platform == "win32":
        runner(["schtasks", "/Delete", "/F", "/TN", WINDOWS_TASK], capture_output=True, text=True)


def ensure_schedule(
    home: Path,
    python: str,
    script: str,
    env: Mapping[str, str],
    platform: Optional[str] = None,
    runner: Callable[..., Any] = subprocess.run,
    uid: Optional[int] = None,
) -> str:
    """Register the hourly job for this user, idempotently. Returns a one-line status."""
    platform = platform or sys.platform
    uid = os.getuid() if uid is None and hasattr(os, "getuid") else (uid or 0)
    if env.get(AGENT_ENV) == "1":
        # Reloading a launchd job terminates the running instance: the agent
        # never re-registers itself from the updater it is running.
        return "skipped: running under the toolchain agent"
    if load_config(home).get("enabled") is False:
        _remove_schedule(home, platform, runner, uid)
        return "opted-out: no schedule (config.json enabled=false)"
    if platform == "darwin":
        plist = home / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist"
        if not _write_if_changed(plist, _plist(python, script, agent_dir(home) / "agent.out")):
            return f"unchanged: launchd {LAUNCHD_LABEL}"
        runner(["launchctl", "bootout", f"gui/{uid}/{LAUNCHD_LABEL}"], capture_output=True, text=True)
        completed = runner(["launchctl", "bootstrap", f"gui/{uid}", str(plist)], capture_output=True, text=True)
        if int(getattr(completed, "returncode", 1)) != 0:
            return f"failed: launchctl bootstrap exited {getattr(completed, 'returncode', '?')}"
        return f"scheduled: launchd {LAUNCHD_LABEL}, hourly and at login"
    if platform.startswith("linux"):
        unit_dir = home / ".config" / "systemd" / "user"
        service, timer = _systemd(python, script)
        changed = _write_if_changed(unit_dir / f"{SYSTEMD_UNIT}.service", service)
        changed = _write_if_changed(unit_dir / f"{SYSTEMD_UNIT}.timer", timer) or changed
        if not changed:
            return f"unchanged: systemd user timer {SYSTEMD_UNIT}.timer"
        runner(["systemctl", "--user", "daemon-reload"], capture_output=True, text=True)
        completed = runner(["systemctl", "--user", "enable", "--now", f"{SYSTEMD_UNIT}.timer"], capture_output=True, text=True)
        if int(getattr(completed, "returncode", 1)) != 0:
            return f"failed: systemctl --user enable exited {getattr(completed, 'returncode', '?')}"
        return f"scheduled: systemd user timer {SYSTEMD_UNIT}.timer, hourly and at boot"
    if platform == "win32":
        marker = agent_dir(home) / "schedule.json"
        wanted = {"python": python, "script": script}
        if _read_json(marker) == wanted:
            return f"unchanged: scheduled task {WINDOWS_TASK}"
        completed = runner(["schtasks", "/Create", "/F", "/SC", "HOURLY", "/TN", WINDOWS_TASK,
                            "/TR", f'"{python}" "{script}" run'], capture_output=True, text=True)
        if int(getattr(completed, "returncode", 1)) != 0:
            return f"failed: schtasks exited {getattr(completed, 'returncode', '?')}"
        _write_json_atomic(marker, wanted)
        return f"scheduled: task {WINDOWS_TASK}, hourly"
    return f"unsupported: no user scheduler for platform {platform}"


def schedule_status(home: Path, platform: Optional[str] = None) -> str:
    platform = platform or sys.platform
    if platform == "darwin":
        present = (home / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist").exists()
        return f"launchd {LAUNCHD_LABEL}: {'registered' if present else 'not registered'}"
    if platform.startswith("linux"):
        present = (home / ".config" / "systemd" / "user" / f"{SYSTEMD_UNIT}.timer").exists()
        return f"systemd {SYSTEMD_UNIT}.timer: {'registered' if present else 'not registered'}"
    if platform == "win32":
        present = (agent_dir(home) / "schedule.json").exists()
        return f"task {WINDOWS_TASK}: {'registered' if present else 'not registered'}"
    return f"unsupported platform {platform}"


def main(argv: Optional[list[str]] = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    command = argv[0] if argv else "run"
    import update_agent_toolchain as updater

    home = updater.home_dir()
    if command == "run":
        state = run_once(home, os.environ)
        print(json.dumps({key: state.get(key) for key in ("status", "code", "lastDecision", "detail")}))
        return 0 if state.get("status") in ("ok", "busy", "opted-out", "offline", "ahead-of-portal") else 1
    if command == "install":
        print(ensure_schedule(home, sys.executable, str(Path(__file__).resolve()), os.environ))
        return 0
    if command == "uninstall":
        _remove_schedule(home, sys.platform, subprocess.run, os.getuid() if hasattr(os, "getuid") else 0)
        print("removed")
        return 0
    if command == "status":
        print(schedule_status(home))
        print(json.dumps(load_state(home), indent=2, sort_keys=True))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
